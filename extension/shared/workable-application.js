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
    if (run.status === status) return;
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

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function captureJobDescription(tabId) {
    const captured = await sendToTab(tabId, { type: 'QTS_WORKABLE_CAPTURE_JOB' });
    const description = String(captured?.jobDescription || '').trim();
    if (!captured?.ok || description.length < 100) {
      throw new Error('Could not capture the job description. Keep the listing page open and add or confirm the description before continuing.');
    }
    return description;
  }

  async function scanPage(tabId, pageNumber) {
    const scanned = await sendToTab(tabId, { type: 'QTS_WORKABLE_SCAN_PAGE', pageNumber });
    if (!scanned?.ok || !scanned.page) {
      throw new Error(scanned?.error || 'Could not read the current application page.');
    }
    return scanned.page;
  }

  async function getGptPackage(taskId, tabId) {
    const dispatch = self.__qtsDispatchActiveApplicationTask;
    if (typeof dispatch !== 'function') {
      throw new Error('Custom GPT task dispatch is unavailable in this extension version.');
    }
    const sent = await dispatch({ taskId, jobTabId: tabId });
    if (!sent?.handoff?.sent) {
      throw new Error(sent?.handoff?.error || 'The task was not sent to the assigned Custom GPT.');
    }

    const timeoutAt = Date.now() + 240000;
    while (Date.now() < timeoutAt) {
      const status = await request(
        'GET',
        `/api/v2/gpt-application-tasks/${encodeURIComponent(taskId)}/extension-status`
      );
      if (status.status === 'ready') return status.package || {};
      if (status.status === 'failed' || status.status === 'completed') {
        throw new Error(`Custom GPT task ended unexpectedly (${status.status}).`);
      }
      await delay(2500);
    }
    throw new Error('Timed out waiting for the Custom GPT. Check its chat and Action error, then resume the task.');
  }

  async function getGeneratedDocuments(taskId, packageData) {
    const documents = {};
    for (const [slot, documentType] of [['resume', 'resume'], ['coverLetter', 'cover_letter']]) {
      if (!packageData.documents?.[slot]) continue;
      const result = await api.workerFetchGptTaskDocumentBase64(taskId, documentType);
      if (!result.success) throw new Error(result.message || `Could not download the generated ${slot}.`);
      documents[documentType] = result;
    }
    return documents;
  }

  async function processPage(tabId, run, account, managerAnswers, pageNumber, jobDescription) {
    const page = await scanPage(tabId, pageNumber);
    run.pageSignature = page.pageSignature || '';
    run.pageUrl = page.pageUrl || '';
    if (page.captchaPresent) {
      run.phase = 'paused';
      run.pageNumber = pageNumber;
      await saveRun(tabId, run);
      await setAttemptStatus(run, 'needs_review');
      await watchForOutcome(tabId);
      notify(tabId, 'Security verification found. Complete it manually; QTS will not bypass it.', 'warn');
      return { paused: true };
    }
    if (!page.fields.length) {
      run.phase = 'paused';
      run.pageNumber = pageNumber;
      await saveRun(tabId, run);
      await setAttemptStatus(run, 'needs_review');
      await watchForOutcome(tabId);
      notify(tabId, 'No application fields were detected on this page. Review it and continue manually.', 'warn');
      return { paused: true };
    }

    const taskId = run.taskId;
    const pagePayload = {
      pageUrl: page.pageUrl,
      pageTitle: page.pageTitle,
      pageNumber: page.pageNumber,
      fields: page.fields,
      ...(jobDescription ? { jobDescription } : {}),
    };
    const pageSaved = await request(
      'PUT',
      `/api/v2/gpt-application-tasks/${encodeURIComponent(taskId)}/page`,
      pagePayload
    );
    if (!pageSaved.success) throw new Error(pageSaved.message || 'Could not save the current page for the Custom GPT.');

    lastProgress(tabId, `Custom GPT is preparing answers for page ${pageNumber}…`);
    const packageData = await getGptPackage(taskId, tabId);
    const documents = await getGeneratedDocuments(taskId, packageData);
    const fill = await sendToTab(tabId, {
      type: 'QTS_WORKABLE_FILL',
      payload: {
        account,
        managerAnswers,
        answers: packageData.answers || [],
        pageFields: page.fields,
        manualReviewFields: page.manualReviewFields || [],
        documents,
        gptPackage: true,
      },
    });
    if (!fill?.ok) {
      run.phase = 'paused';
      run.pageNumber = pageNumber;
      await saveRun(tabId, run);
      await setAttemptStatus(run, 'needs_review');
      await watchForOutcome(tabId);
      notify(tabId, (fill?.failures || ['Some fields need your review.']).join(' '), 'warn');
      return { paused: true };
    }

    const unresolved = packageData.unresolvedFields || [];
    if (unresolved.length || (page.manualReviewFields || []).length) {
      run.phase = 'paused';
      run.pageNumber = pageNumber;
      await saveRun(tabId, run);
      await setAttemptStatus(run, 'needs_review');
      await watchForOutcome(tabId);
      const reason = unresolved.length
        ? `The GPT needs facts for: ${unresolved.map((field) => field.question).join('; ')}.`
        : `Please review the consent/declaration fields: ${page.manualReviewFields.join('; ')}.`;
      notify(tabId, `${reason} Complete them yourself, then continue.`, 'warn');
      return { paused: true };
    }

    const next = await sendToTab(tabId, { type: 'QTS_WORKABLE_NEXT_PAGE' });
    if (!next?.ok) throw new Error(next?.error || 'Could not continue the application.');
    if (next.pageUnchanged) {
      run.phase = 'paused';
      run.pageNumber = pageNumber;
      await saveRun(tabId, run);
      await setAttemptStatus(run, 'needs_review');
      await watchForOutcome(tabId);
      notify(tabId, 'Workable did not advance to another page. Review validation messages and continue manually.', 'warn');
      return { paused: true };
    }
    if (!next.hasNext) {
      run.phase = 'waiting';
      run.pageNumber = pageNumber;
      await saveRun(tabId, run);
      await setAttemptStatus(run, 'needs_review');
      await watchForOutcome(tabId);
      notify(tabId, `Application form filled for ${account.name}. Review it and click the final Submit button yourself.`, 'warn');
      return { completedPages: true, finalPage: true };
    }

    run.phase = 'processing';
    run.pageNumber = pageNumber;
    await saveRun(tabId, run);
    await delay(1000);
    return { completedPages: true, nextPage: true };
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

  async function startAccount(tabId, context, account, claimedRun = null, pageState = {}) {
    const job = context.job;
    const accountId = Number(account.account_user_id);
    const resumingPaused = claimedRun?.phase === 'paused';
    const run = claimedRun || {
      tabId,
      jobId: Number(job.j_id),
      accountId,
      jobUrl: job.url,
      accountName: account.name,
      status: 'in_progress',
      phase: 'opening',
      pageNumber: 0,
    };

    if (!claimedRun) {
      const started = await request(
        'POST',
        `/api/v2/application-attempts/${job.j_id}/${accountId}/start`
      );
      run.status = started.attempt.status;
      run.attemptId = Number(started.attempt.attempt_id);
    }
    if (!run.attemptId) throw new Error('Application attempt ID is missing.');
    if (!resumingPaused) run.phase = 'opening';
    await saveRun(tabId, run);

    let jobDescription = String(run.jobDescription || '').trim();
    if (!jobDescription && !run.taskId) jobDescription = await captureJobDescription(tabId);
    const task = await request(
      'POST',
      `/api/v2/gpt-application-tasks/attempts/${run.attemptId}`,
      {
        sourcePlatform: 'workable',
        ...(jobDescription ? { jobDescription } : {}),
      }
    );
    if (run.taskId && task.taskId !== run.taskId) {
      throw new Error('The server returned a different GPT task for this application attempt.');
    }
    run.taskId = task.taskId;
    if (jobDescription) run.jobDescription = jobDescription;
    await saveRun(tabId, run);

    if (!resumingPaused) {
      const opened = await sendToTab(tabId, { type: 'QTS_WORKABLE_OPEN_FORM' });
      if (!opened?.ok) throw new Error(opened?.error || 'Could not open the Workable application form.');
    }

    const baseTask = await request(
      'GET',
      `/api/v2/gpt-application-tasks/${encodeURIComponent(run.taskId)}/extension-status`
    );
    if (!jobDescription) {
      const captured = await sendToTab(tabId, { type: 'QTS_WORKABLE_CAPTURE_JOB' });
      jobDescription = String(captured?.jobDescription || baseTask?.jobContext?.jobDescription || '').trim();
    }
    if (jobDescription.length < 100) {
      run.phase = 'paused';
      await saveRun(tabId, run);
      await setAttemptStatus(run, 'needs_review');
      notify(tabId, 'QTS could not capture the job description. Add or confirm it before continuing with the GPT.', 'warn');
      return;
    }
    run.jobDescription = jobDescription;
    const pageChangedAfterPause = resumingPaused
      && (run.pageUrl !== pageState.url || run.pageSignature !== pageState.pageSignature);
    let pageNumber = Math.max(1, Number(run.pageNumber || 0) + (pageChangedAfterPause ? 1 : 0));
    if (resumingPaused && !pageChangedAfterPause) {
      notify(tabId, 'This application page is paused. Complete the requested fields and continue to the next page.', 'warn');
      return;
    }
    while (pageNumber <= 50) {
      run.phase = 'processing';
      run.pageNumber = pageNumber;
      await saveRun(tabId, run);
      const result = await processPage(
        tabId,
        run,
        account,
        context.managerAnswers,
        pageNumber,
        jobDescription
      );
      if (!result.nextPage) return;
      pageNumber += 1;
    }
    run.phase = 'paused';
    await saveRun(tabId, run);
    await setAttemptStatus(run, 'needs_review');
    await watchForOutcome(tabId);
    notify(tabId, 'This application has more than 50 pages. Continue manually and review before submitting.', 'warn');
  }

  async function begin(tabId, url, pageSignature = '') {
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
        if (savedRun.phase === 'paused'
          && savedRun.pageSignature === pageSignature
          && savedRun.pageUrl === url) {
          return;
        }
        if (savedRun.phase !== 'claimed' && savedRun.phase !== 'paused') {
          notify(
            tabId,
            'An earlier Workable attempt is still in progress. Review this page; QTS will not restart or duplicate it.',
            'warn'
          );
          return;
        }
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
      if (savedRun?.phase === 'claimed' || savedRun?.phase === 'paused') {
        const claimedAccount = accounts.find(
          (account) => Number(account.account_user_id) === Number(savedRun.accountId)
        );
        if (Number(context.job?.j_id) !== Number(savedRun.jobId)
          || !claimedAccount
          || (claimedAccount.status !== 'in_progress'
            && !(savedRun.phase === 'paused' && claimedAccount.status === 'needs_review'))) {
          notify(tabId, 'The reserved job or Account no longer matches this page. Review the Manager job list before retrying.', 'error');
          return;
        }
        await startAccount(tabId, context, claimedAccount, savedRun, {
          url,
          pageSignature,
        });
        return;
      }

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
      const run = await readRun(tabId).catch(() => null);
      if (run && ['opening', 'processing'].includes(run.phase)) {
        run.phase = 'paused';
        await saveRun(tabId, run);
        if (run.attemptId) {
          try {
            await setAttemptStatus(run, 'needs_review');
            await watchForOutcome(tabId);
          } catch (statusError) {
            console.error('[QTS Workable] Could not record the paused GPT task:', statusError);
          }
        }
      }
      notify(tabId, error.message || 'Could not process the Workable application.', 'error');
    } finally {
      busyTabs.delete(tabId);
    }
  }

  async function registerClaim(tabId, claim) {
    const jobId = Number(claim?.job?.id);
    const accountId = Number(claim?.account?.id);
    if (!Number.isSafeInteger(tabId) || !Number.isSafeInteger(jobId) || !Number.isSafeInteger(accountId)) {
      throw new Error('The reserved job claim is incomplete.');
    }
    await saveRun(tabId, {
      tabId,
      jobId,
      accountId,
      attemptId: Number(claim?.attempt?.attempt_id) || null,
      jobUrl: claim.job.url,
      accountName: claim.account.name,
      status: 'in_progress',
      phase: 'claimed',
    });
  }

  async function discardClaim(tabId) {
    const run = await readRun(tabId);
    if (run?.phase === 'claimed') await clearRun(tabId);
  }

  async function handleOutcome(tabId, message) {
    if (!tabId) return;
    const run = await readRun(tabId);
    if (!run || (run.phase !== 'waiting' && run.phase !== 'paused')) return;
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
      if (tabId && workableUrl(message.url)) void begin(tabId, message.url, message.pageSignature);
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

  self.__qtsWorkableApplication = { registerClaim, discardClaim };
})();
