(function () {
  'use strict';

  const api = self.__qtsApiWorker;
  const stateKey = 'qtsWorkableAttemptByTab';
  const busyTabs = new Set();

  function workableHost(value) {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && url.hostname.toLowerCase().endsWith('.workable.com');
    } catch {
      return false;
    }
  }

  function workableUrl(value) {
    try {
      const url = new URL(value);
      return workableHost(value)
        && /\/j\/[^/]+/i.test(url.pathname);
    } catch {
      return false;
    }
  }

  function notify(tabId, message, level = 'warn') {
    chrome.tabs.sendMessage(tabId, {
      type: 'QTS_WORKABLE_NOTICE',
      message,
      level,
    }).catch(() => {});
  }

  async function readRun(tabId) {
    const stored = await chrome.storage.local.get(stateKey);
    return stored[stateKey]?.[tabId] || null;
  }

  async function saveRun(tabId, run) {
    const stored = await chrome.storage.local.get(stateKey);
    const runs = stored[stateKey] || {};
    runs[tabId] = run;
    await chrome.storage.local.set({ [stateKey]: runs });
  }

  async function clearRun(tabId) {
    const stored = await chrome.storage.local.get(stateKey);
    const runs = stored[stateKey] || {};
    delete runs[tabId];
    await chrome.storage.local.set({ [stateKey]: runs });
  }

  async function request(method, path, body) {
    const result = await api.workerApiRequest(method, path, body);
    if (!result.success) throw new Error(result.message || 'Application workflow API request failed.');
    return result;
  }

  function attemptPath(run) {
    return `/api/v2/application-attempts/${run.jobId}/${run.accountId}`;
  }

  async function setAttemptStatus(run, status, failureReason) {
    await request('PATCH', attemptPath(run), {
      status,
      ...(failureReason ? { failureReason } : {}),
    });
    run.status = status;
    await saveRun(run.tabId, run);
  }

  async function sendToTab(tabId, message) {
    return chrome.tabs.sendMessage(tabId, message);
  }

  async function watchForOutcome(tabId) {
    try {
      await sendToTab(tabId, { type: 'QTS_WORKABLE_WATCH_OUTCOME' });
    } catch (error) {
      console.warn('[QTS Workable] Could not monitor the application result:', error);
    }
  }

  async function loadContext(url) {
    return request('GET', `/api/v2/application-attempts/context?url=${encodeURIComponent(url)}`);
  }

  async function failAndContinue(run, reason) {
    try {
      await setAttemptStatus(run, 'failed', reason);
    } catch (error) {
      notify(run.tabId, `Could not record the failed attempt: ${error.message}`, 'error');
      console.error('[QTS Workable] Failed to save attempt status:', error);
      return;
    }
    notify(run.tabId, `Account ${run.accountName}: ${reason}`, 'error');
    await beginNext(run.tabId, run.jobUrl);
  }

  async function beginNext(tabId, jobUrl) {
    await clearRun(tabId);
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) return;
    if (tab.url === jobUrl) await chrome.tabs.reload(tabId);
    else await chrome.tabs.update(tabId, { url: jobUrl });
  }

  async function startAccount(tabId, context, account) {
    const job = context.job;
    const accountId = Number(account.account_user_id);
    let resume = null;
    if (account.has_resume) {
      const loaded = await api.workerFetchAccountResumeBase64(accountId);
      if (!loaded.success) {
        notify(tabId, loaded.message || 'Could not load the saved PDF resume.', 'error');
        return;
      }
      resume = { fileName: loaded.fileName, base64: loaded.base64 };
    }

    const started = await request(
      'POST',
      `/api/v2/application-attempts/${job.j_id}/${accountId}/start`
    );
    const run = {
      tabId,
      jobId: Number(job.j_id),
      accountId,
      jobUrl: job.url,
      accountName: account.name,
      status: started.attempt.status,
      phase: 'opening',
    };
    await saveRun(tabId, run);

    run.phase = 'filling';
    await saveRun(tabId, run);

    let opened;
    try {
      opened = await sendToTab(tabId, { type: 'QTS_WORKABLE_OPEN_FORM' });
    } catch (error) {
      await failAndContinue(run, error.message || 'Could not open the Workable application form.');
      return;
    }
    if (!opened?.ok) {
      await failAndContinue(run, opened?.error || 'Could not open the Workable application form.');
      return;
    }

    let fill;
    try {
      fill = await sendToTab(tabId, {
        type: 'QTS_WORKABLE_FILL',
        payload: {
          account,
          managerAnswers: context.managerAnswers,
          resume,
          submissionMode: context.submissionMode,
        },
      });
    } catch (error) {
      await failAndContinue(run, error.message || 'Could not fill the Workable application form.');
      return;
    }
    if (!fill?.ok) {
      await failAndContinue(run, (fill?.failures || ['Workable form could not be completed.']).join(' '));
      return;
    }

    run.phase = 'waiting';
    try {
      await setAttemptStatus(run, 'needs_review');
    } catch (error) {
      notify(tabId, `Form filled, but its status could not be saved: ${error.message}`, 'error');
      return;
    }
    await watchForOutcome(tabId);

    if (context.submissionMode !== 'auto' || fill.captchaPresent) {
      const message = fill.captchaPresent
        ? 'Security verification found. Complete it and submit manually; QTS will not bypass it.'
        : `Form filled for ${account.name}. Review it and submit manually to continue.`;
      notify(tabId, message, 'warn');
      return;
    }

    let submitted;
    try {
      submitted = await sendToTab(tabId, { type: 'QTS_WORKABLE_SUBMIT' });
    } catch (error) {
      notify(tabId, `Submission result is uncertain; review this application and do not retry. ${error.message}`, 'warn');
      return;
    }
    if (submitted?.captchaPresent) {
      notify(tabId, 'Security verification found. Complete it and submit manually; QTS will not bypass it.', 'warn');
    } else if (!submitted?.ok) {
      await failAndContinue(run, submitted?.error || 'Workable submission could not be started.');
    } else {
      notify(tabId, 'Waiting for Workable to confirm the submission.', 'warn');
    }
  }

  async function begin(tabId, url) {
    if (!workableUrl(url) || busyTabs.has(tabId)) return;
    busyTabs.add(tabId);
    try {
      if (!api?.workerApiRequest) throw new Error('Extension API helpers are unavailable.');
      const savedRun = await readRun(tabId);
      if (savedRun) {
        if (savedRun.phase === 'waiting') {
          await watchForOutcome(tabId);
          return;
        }
        notify(
          tabId,
          'An earlier Workable attempt is still in progress. Review this page; QTS will not restart or duplicate it.',
          'warn'
        );
        return;
      }

      let context;
      try {
        context = await loadContext(url);
      } catch (error) {
        if (!/not assigned|workable job url/i.test(error.message)) {
          notify(tabId, error.message, 'error');
        }
        return;
      }

      const accounts = context.accounts || [];
      const unfinished = accounts.find((account) =>
        account.status === 'in_progress' || account.status === 'needs_review'
      );
      if (unfinished) {
        notify(
          tabId,
          `${unfinished.name} already has an unfinished attempt. Finish or review it before processing another Account.`,
          'warn'
        );
        return;
      }
      const account = accounts.find((item) => item.status === 'not_started');
      if (!account) return;
      await startAccount(tabId, context, account);
    } catch (error) {
      console.error('[QTS Workable] Could not process assigned Account:', error);
      notify(tabId, error.message || 'Could not process the Workable application.', 'error');
    } finally {
      busyTabs.delete(tabId);
    }
  }

  async function handleOutcome(tabId, message) {
    if (!tabId) return;
    const run = await readRun(tabId);
    if (!run || run.phase !== 'waiting') return;
    if (message.outcome === 'submitted') {
      try {
        await setAttemptStatus(run, 'submitted');
      } catch (error) {
        notify(tabId, `Workable confirmed submission, but QTS could not save it: ${error.message}`, 'error');
        return;
      }
      notify(tabId, `Workable confirmed submission for ${run.accountName}.`, 'success');
      await beginNext(tabId, run.jobUrl);
    } else if (message.outcome === 'failed') {
      await failAndContinue(run, message.reason || 'Workable reported a submission error.');
    }
  }

  chrome.runtime.onMessage.addListener((message, sender) => {
    const tabId = sender.tab?.id;
    if (message.type === 'QTS_WORKABLE_PAGE_READY') {
      if (tabId && workableUrl(message.url)) void begin(tabId, message.url);
      else if (tabId && workableHost(message.url)) {
        void readRun(tabId).then((run) => {
          if (run?.phase === 'waiting') void watchForOutcome(tabId);
        });
      }
      return false;
    }
    if (message.type === 'QTS_WORKABLE_OUTCOME') {
      void handleOutcome(tabId, message).catch((error) =>
        console.error('[QTS Workable] Could not record the application result:', error)
      );
      return false;
    }
    return false;
  });
})();
