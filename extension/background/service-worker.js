// Background service worker — tab tracking, capture window, messages

importScripts(
  '../shared/job-detect.js',
  '../shared/api-prefetch.js',
  '../shared/custom-gpt.js',
  '../shared/api-worker.js',
  '../shared/chatgpt-composer-handoff.js'
);

function isExtractablePageUrl(url) {
  if (!url || typeof url !== 'string') return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function restrictedPageMessage(url) {
  if (!url) return 'No page URL available. Open a job listing tab first.';
  try {
    const protocol = new URL(url).protocol.replace(':', '');
    if (protocol === 'chrome' || protocol === 'chrome-extension' || protocol === 'edge' || protocol === 'about') {
      return 'Auto-extract works on web pages (http/https). Open a job listing tab, then click Refresh.';
    }
  } catch {
    // fall through
  }
  return 'This page cannot be auto-scraped. Open a job listing in your browser, or enter details manually.';
}

const CAPTURE_WINDOW_WIDTH = 660;
const CAPTURE_WINDOW_HEIGHT_RATIO = 0.8;
const CAPTURE_WINDOW_MIN_HEIGHT = 480;
let captureWindowId = null;
let lastSourceTabId = null;
const lastAutoOpenKeyByTab = new Map();
const detectGenerationByTab = new Map();

const EXTRACTOR_FILES = [
  'content/extractors/generic.js',
  'content/extractors/linkedin.js',
  'content/extractors/indeed.js',
  'content/extractors/glassdoor.js',
  'content/extractors/ats.js',
  'content/extractor-manager.js',
];
const DETECT_TOAST_FILE = 'content/detect-toast.js';
const FORM_SCAN_FILE = 'content/form-scan.js';
const TEMPLATE_REGISTRY_FILE = 'content/platforms/templates/template-registry.js';
const JUSTJOIN_EASY_APPLY_FILE = 'content/platforms/templates/justjoin-easy-apply.js';
const JUSTJOIN_EXTERNAL_APPLY_FILE = 'content/platforms/templates/justjoin-external-apply.js';
const JUSTJOIN_APPLY_FILE = 'content/platforms/justjoin-apply.js';
const APPLICATION_DISCOVERY_FILE = 'content/application-discovery.js';
const APPLY_TEMPLATE_DETECTOR_FILE = 'content/apply-template-detector.js';
const FORM_SCAN_SCRIPT_FILES = [
  FORM_SCAN_FILE,
  TEMPLATE_REGISTRY_FILE,
  JUSTJOIN_EASY_APPLY_FILE,
  JUSTJOIN_EXTERNAL_APPLY_FILE,
  JUSTJOIN_APPLY_FILE,
  APPLICATION_DISCOVERY_FILE,
  APPLY_TEMPLATE_DETECTOR_FILE,
];
const CHATGPT_HANDOFF_FILE = 'content/chatgpt-handoff.js';
const CHATGPT_MAIN_HANDOFF_FILE = 'content/chatgpt-main-handoff.js';
const GPT_TAB_STORAGE_KEY = 'qtsCustomGptTabId';
const JOB_SOURCE_TAB_STORAGE_KEY = 'qtsJobSourceTabId';
const APPLY_TEMPLATE_TAB_KEY = 'qtsApplyTemplateByTab';
let gptApprovalWatchTimer = null;
let gptPollApplyJob = null;

function stopGptPollAndApply() {
  gptPollApplyJob = null;
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const HUMAN_REVIEW_SAVED_KEYS = new Set([
  'terms_accepted',
  'gdpr_consent',
  'marketing_opt_in',
  'cover_message',
]);

async function applyGptPackageToJobTab(applicationId, jobTabId) {
  const api = self.__qtsApiWorker;
  if (!api?.workerApiRequest) {
    throw new Error('API worker helpers not loaded.');
  }

  const result = await api.workerApiRequest('GET', `/api/application-sessions/${applicationId}/result`);
  if (!result.success) {
    throw new Error(result.message || 'Could not load application result.');
  }

  const fillFields = (result.fields || [])
    .filter((field) => field.category === 'ai_generation' && field.generatedAnswer)
    .map((field) => ({
      ...field,
      fillValue: field.generatedAnswer,
      fillStatus: 'filled',
    }));

  const remainingFields = (result.fields || [])
    .filter((field) => field.fieldType !== 'file'
      && field.category !== 'ai_generation'
      && field.category !== 'candidate_profile'
      && !HUMAN_REVIEW_SAVED_KEYS.has(field.savedAnswerKey)
      && field.generatedAnswer
      && field.fillStatus !== 'filled')
    .map((field) => ({
      ...field,
      fillValue: field.generatedAnswer,
      fillStatus: 'filled',
    }));

  const fileUploadFields = await api.workerBuildFileUploadFields(applicationId, result.fields || []);
  const payload = [...fillFields, ...remainingFields, ...fileUploadFields];
  if (!payload.length) {
    throw new Error('No GPT answers or documents found on server yet.');
  }

  let tabId = jobTabId;
  if (!tabId) {
    const stored = await chrome.storage.local.get([JOB_SOURCE_TAB_STORAGE_KEY]);
    tabId = stored[JOB_SOURCE_TAB_STORAGE_KEY] || lastSourceTabId;
  }
  if (!tabId) {
    throw new Error('No job tab found for GPT apply.');
  }

  try {
    await chrome.tabs.update(tabId, { active: true });
    lastSourceTabId = tabId;
  } catch {
    // continue with stored tab id
  }

  await scanApplicationFormOnTab(tabId, { openApplyForm: true });
  const fillResponse = await fillApplicationFormOnTab(tabId, payload);
  if (fillResponse?.error) {
    throw new Error(fillResponse.error);
  }

  const uploadedCount = fillResponse?.fill?.results?.filter(
    (item) => item.ok && fileUploadFields.some((field) => field.stableFieldId === item.stableFieldId)
  ).length || 0;
  const filledCount = fillResponse?.fill?.results?.filter((item) => item.ok)?.length || 0;
  const uploadNote = uploadedCount ? ` Uploaded ${uploadedCount} PDF(s).` : '';

  await showPageDetectAlert(
    tabId,
    `GPT package applied (${filledCount} field(s)).${uploadNote} Review before submit.`,
    uploadedCount ? 'success' : 'warn'
  );

  return { fillResponse, filledCount, uploadedCount, tabId };
}

async function pollAndApplyGptTask({ taskId, applicationId, jobTabId, timeoutMs = 180000, intervalMs = 3000 }) {
  const api = self.__qtsApiWorker;
  const appId = Number(applicationId) || api?.workerParseApplicationId?.(taskId);
  if (!taskId || !appId) {
    throw new Error('Invalid GPT task for apply pipeline.');
  }

  stopGptPollAndApply();
  const job = { taskId, applicationId: appId, jobTabId, cancelled: false };
  gptPollApplyJob = job;

  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (gptPollApplyJob !== job || job.cancelled) {
      throw new Error('GPT apply pipeline cancelled.');
    }

    const status = await api.workerApiRequest('GET', `/api/application-tasks/${encodeURIComponent(taskId)}/status`);
    if (!status.success) {
      throw new Error(status.message || 'Could not read GPT task status.');
    }
    if (status.gptTaskStatus === 'ready' || status.readyToApply) {
      const applied = await applyGptPackageToJobTab(appId, jobTabId);
      chrome.runtime.sendMessage({
        type: 'GPT_APPLY_FINISHED',
        success: true,
        taskId,
        applicationId: appId,
        ...applied,
      }).catch(() => {});
      if (gptPollApplyJob === job) gptPollApplyJob = null;
      return applied;
    }
    if (status.gptTaskStatus === 'error') {
      throw new Error(status.error || 'GPT task failed on server.');
    }
    await sleep(intervalMs);
  }

  if (gptPollApplyJob === job) gptPollApplyJob = null;
  throw new Error('Timed out waiting for Custom GPT. Click Allow in the GPT tab, then use Apply GPT package.');
}

function startGptPollAndApply(options) {
  pollAndApplyGptTask(options).catch((e) => {
    chrome.runtime.sendMessage({
      type: 'GPT_APPLY_FINISHED',
      success: false,
      taskId: options?.taskId,
      applicationId: options?.applicationId,
      error: e?.message || String(e),
    }).catch(() => {});
    const tabId = options?.jobTabId || lastSourceTabId;
    if (tabId) {
      showPageDetectAlert(tabId, e?.message || 'GPT apply failed.', 'fail').catch(() => {});
    }
  });
}
const JOB_PANEL_WATCH_FILE = 'content/job-panel-watch.js';
const LINKEDIN_PANEL_WATCH_FILE = 'content/linkedin-panel-watch.js';
const AUTO_DETECT_DELAY_MS = 100;
const injectedExtractorTabs = new Set();

async function getTab(tabId) {
  try {
    return await chrome.tabs.get(tabId);
  } catch {
    return null;
  }
}

async function canInjectIntoTab(tab) {
  if (!tab?.id || !tab.url) return false;
  if (!isExtractablePageUrl(tab.url)) return false;
  if (tab.url.startsWith('chrome-extension://') || tab.url.startsWith('chrome://')) return false;
  return tab.status === 'complete' || tab.status === 'loading';
}

async function injectExtractors(tabId) {
  const tab = await getTab(tabId);
  if (!(await canInjectIntoTab(tab))) return false;
  if (injectedExtractorTabs.has(tabId)) return true;

  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: EXTRACTOR_FILES });
    injectedExtractorTabs.add(tabId);
    return true;
  } catch (err) {
    console.warn('[QTS_Startup] Skipped injection on', tab.url, err?.message || err);
    return false;
  }
}

async function injectJobPanelWatch(tabId, pageUrl) {
  const url = pageUrl || (await getTab(tabId))?.url || '';
  const watchFile = url.includes('linkedin.com')
    ? LINKEDIN_PANEL_WATCH_FILE
    : JOB_PANEL_WATCH_FILE;
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: [watchFile] });
    return true;
  } catch {
    return false;
  }
}

async function extractJobFromTab(tabId) {
  const tab = await getTab(tabId);
  if (!tab?.id) {
    return { error: 'No active tab', tab: null };
  }
  if (!isExtractablePageUrl(tab.url)) {
    return { error: restrictedPageMessage(tab.url), tab, manualOnly: true };
  }

  try {
    const injected = await injectExtractors(tab.id);
    if (!injected) {
      return {
        error: 'Could not access this page for extraction.',
        tab,
        manualOnly: true,
      };
    }
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => (window.__extractJobData ? window.__extractJobData() : null),
    });
    return {
      data: results[0]?.result || null,
      url: tab.url,
      title: tab.title,
      tab,
    };
  } catch (e) {
    return {
      error: e.message || 'Extraction failed.',
      tab,
      manualOnly: true,
    };
  }
}

async function verifyFormScanScripts(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => ({
        scan: typeof window.__scanApplicationForm === 'function',
        discover: typeof window.__discoverApplicationForm === 'function',
        registry: typeof window.__qtsTemplateRegistry === 'object',
        justjoin: typeof window.__qtsPlatformJustjoin === 'object',
      }),
    });
    return results[0]?.result || {};
  } catch {
    return {};
  }
}

async function ensureFormScanScripts(tabId) {
  const tab = await getTab(tabId);
  if (!(await canInjectIntoTab(tab))) {
    return { ok: false, reason: 'cannot_inject', status: {} };
  }

  let status = await verifyFormScanScripts(tabId);
  if (status.discover && status.scan) {
    return { ok: true, status };
  }

  for (const file of FORM_SCAN_SCRIPT_FILES) {
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: [file] });
    } catch (e) {
      console.warn('[QTS] inject failed:', file, e?.message || e);
    }
  }

  status = await verifyFormScanScripts(tabId);
  return { ok: Boolean(status.discover && status.scan), status };
}

async function injectFormScan(tabId) {
  const result = await ensureFormScanScripts(tabId);
  return result.ok;
}

function isTemplateCandidateUrl(url) {
  if (!url || typeof url !== 'string') return false;
  if (/justjoin\.it\/job-offer\//i.test(url)) return true;
  return false;
}

async function readApplyTemplateMap() {
  const stored = await chrome.storage.session.get([APPLY_TEMPLATE_TAB_KEY]);
  return stored[APPLY_TEMPLATE_TAB_KEY] || {};
}

async function setApplyTemplateForTab(tabId, detection) {
  const map = await readApplyTemplateMap();
  map[String(tabId)] = detection;
  await chrome.storage.session.set({ [APPLY_TEMPLATE_TAB_KEY]: map });
}

async function getApplyTemplateForTab(tabId) {
  const map = await readApplyTemplateMap();
  return map[String(tabId)] || null;
}

async function removeApplyTemplateForTab(tabId) {
  const map = await readApplyTemplateMap();
  delete map[String(tabId)];
  await chrome.storage.session.set({ [APPLY_TEMPLATE_TAB_KEY]: map });
}

function notifyApplyTemplateDetected(tabId) {
  if (captureWindowId === null) return;
  if (lastSourceTabId !== tabId) return;
  chrome.runtime.sendMessage({ type: 'APPLY_TEMPLATE_DETECTED', tabId }).catch(() => {});
}

async function detectApplyTemplateOnTab(tabId, url) {
  const pageUrl = url || (await getTab(tabId))?.url;
  if (!pageUrl || !isTemplateCandidateUrl(pageUrl)) {
    await removeApplyTemplateForTab(tabId);
    return null;
  }

  const injected = await injectFormScan(tabId);
  if (!injected) return null;

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => (window.__detectApplyTemplateOnPage
        ? window.__detectApplyTemplateOnPage()
        : null),
    });
    const detection = results[0]?.result;
    if (!detection?.templateId) {
      await removeApplyTemplateForTab(tabId);
      return detection;
    }
    await setApplyTemplateForTab(tabId, detection);
    notifyApplyTemplateDetected(tabId);
    return detection;
  } catch {
    return null;
  }
}

async function runFormScanScript(tabId, func, args = []) {
  const tab = await getTab(tabId);
  if (!tab?.id) return { error: 'No active tab' };
  if (!isExtractablePageUrl(tab.url)) {
    return { error: restrictedPageMessage(tab.url), manualOnly: true };
  }
  const injected = await injectFormScan(tab.id);
  if (!injected) return { error: 'Could not access this page for form scanning.' };
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func,
      args,
    });
    return { success: true, result: results[0]?.result ?? null, url: tab.url, title: tab.title };
  } catch (e) {
    return { error: e.message || 'Form scan failed.' };
  }
}

async function waitForTabSettled(tabId, timeoutMs = 12000) {
  const tab = await getTab(tabId);
  if (!tab?.id) return;
  if (tab.status === 'complete') {
    await sleep(1500);
    return;
  }
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    const listener = (updatedTabId, info) => {
      if (updatedTabId !== tabId || info.status !== 'complete') return;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      setTimeout(resolve, 1500);
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function ensureChatGptHandoffScript(tabId) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: [CHATGPT_HANDOFF_FILE] });
    return true;
  } catch {
    return false;
  }
}

async function ensureChatGptMainHandoffScript(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      files: ['shared/chatgpt-composer-handoff.js', CHATGPT_MAIN_HANDOFF_FILE],
    });
    return true;
  } catch {
    return false;
  }
}

async function focusComposerBoxForDebugger(tabId) {
  await ensureChatGptComposerHandoffScript(tabId);
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: () => {
      const handoff = window.__qtsChatGptComposerHandoff;
      const editor = handoff?.findUnifiedComposerEditor?.()
        || document.querySelector('div#prompt-textarea.ProseMirror[contenteditable="true"]');
      if (!(editor instanceof HTMLElement)) return null;
      handoff?.activateComposer?.(editor);
      const rect = editor.getBoundingClientRect();
      if (rect.width < 24 || rect.height < 8) return null;
      return {
        x: Math.round(rect.left + rect.width / 2),
        y: Math.round(rect.top + rect.height / 2),
      };
    },
  });
  return results?.[0]?.result || null;
}

async function typeViaDebugger(tabId, text) {
  const debuggee = { tabId };
  let attached = false;
  try {
    const box = await focusComposerBoxForDebugger(tabId);
    if (!box) {
      return { ok: false, sent: false, phase: 'no_editor', error: 'Composer not ready for trusted typing.' };
    }

    await chrome.debugger.attach(debuggee, '1.3');
    attached = true;

    await chrome.debugger.sendCommand(debuggee, 'Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: box.x,
      y: box.y,
      button: 'left',
      clickCount: 1,
    });
    await chrome.debugger.sendCommand(debuggee, 'Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: box.x,
      y: box.y,
      button: 'left',
      clickCount: 1,
    });
    await sleep(250);

    await chrome.debugger.sendCommand(debuggee, 'Input.insertText', { text: String(text || '') });
    await sleep(400);

    const verify = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: (snippet) => {
        const editor = window.__qtsChatGptComposerHandoff?.findUnifiedComposerEditor?.();
        const current = window.__qtsChatGptComposerHandoff?.readEditorText?.(editor) || '';
        return current.includes(snippet);
      },
      args: [String(text || '').slice(0, 8)],
    });
    if (!verify?.[0]?.result) {
      return { ok: false, sent: false, phase: 'insert_failed', error: 'Trusted typing did not update composer.' };
    }

    await chrome.debugger.sendCommand(debuggee, 'Input.dispatchKeyEvent', {
      type: 'rawKeyDown',
      windowsVirtualKeyCode: 13,
      unmodifiedText: '\r',
      text: '\r',
    });
    await chrome.debugger.sendCommand(debuggee, 'Input.dispatchKeyEvent', {
      type: 'keyUp',
      windowsVirtualKeyCode: 13,
      key: 'Enter',
      code: 'Enter',
    });
    await sleep(600);

    const cleared = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: () => {
        const editor = window.__qtsChatGptComposerHandoff?.findUnifiedComposerEditor?.();
        return window.__qtsChatGptComposerHandoff?.readEditorText?.(editor) === '';
      },
    });
    if (cleared?.[0]?.result) {
      return { ok: true, sent: true, method: 'debugger_insertText', phase: 'typed_and_sent' };
    }

    return {
      ok: true,
      sent: false,
      needsManualSend: true,
      method: 'debugger_insertText',
      phase: 'typed_needs_enter',
    };
  } catch (e) {
    return {
      ok: false,
      sent: false,
      phase: 'debugger_failed',
      error: e?.message || 'Trusted keyboard input failed.',
    };
  } finally {
    if (attached) {
      try {
        await chrome.debugger.detach(debuggee);
      } catch {
        // ignore
      }
    }
  }
}

async function installGptClickPasteOverlay(tabId, message) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: (msg) => {
        document.getElementById('qts-gpt-paste-overlay')?.remove();
        const root = document.body || document.documentElement;
        if (!root) return;

        const overlay = document.createElement('div');
        overlay.id = 'qts-gpt-paste-overlay';
        overlay.style.cssText = [
          'position:fixed', 'inset:0', 'z-index:2147483646',
          'background:rgba(15,23,42,.55)', 'display:flex', 'align-items:center', 'justify-content:center',
        ].join(';');

        const card = document.createElement('button');
        card.type = 'button';
        card.style.cssText = [
          'background:#fff', 'border:0', 'border-radius:12px', 'padding:22px 26px',
          'max-width:min(520px,92vw)', 'text-align:center', 'cursor:pointer',
          'box-shadow:0 16px 48px rgba(0,0,0,.35)', 'font:15px/1.45 system-ui,sans-serif',
        ].join(';');
        card.innerHTML = [
          '<div style="font-weight:700;color:#b45309;margin-bottom:8px">QTS Job Tracking</div>',
          '<div>Click here to paste <strong>PROCESS_TASK</strong> into ChatGPT</div>',
          '<div style="font-size:13px;color:#64748b;margin-top:10px">Then press Enter and click Allow for Actions</div>',
        ].join('');

        card.addEventListener('click', () => {
          const run = window.__qtsChatGptComposerHandoff?.runUnifiedComposerHandoff?.(msg);
          if (!run?.sent && !run?.needsManualSend) {
            try {
              navigator.clipboard.writeText(msg);
            } catch {
              // ignore
            }
            const editor = window.__qtsChatGptComposerHandoff?.findUnifiedComposerEditor?.();
            if (editor) {
              window.__qtsChatGptComposerHandoff?.activateComposer?.(editor);
              try {
                document.execCommand('insertText', false, msg);
              } catch {
                // ignore
              }
            }
          }
          overlay.remove();
        }, { once: true });

        overlay.appendChild(card);
        root.appendChild(overlay);
      },
      args: [message],
    });
  } catch {
    // non-fatal
  }
}

async function runGptMainWorldHandoff(tabId, message, timeoutMs = 90000) {
  const started = Date.now();
  let lastPhase = 'no_editor';
  let lastError = 'ChatGPT composer not ready — wait for the page to finish loading.';

  while (Date.now() - started < timeoutMs) {
    try {
      const tab = await getTab(tabId);
      if (!tab?.id || !String(tab.url || '').includes('chatgpt.com')) {
        lastError = 'Custom GPT tab navigated away during handoff.';
        await sleep(800);
        continue;
      }

      const step = await executeGptHandoffStep(tabId, message);
      if (!step) {
        lastError = 'GPT handoff script could not run on this tab.';
      } else if (step.fatal) {
        return { ok: false, sent: false, error: step.error || lastError, phase: step.phase };
      } else if (step.sent) {
        return { ok: true, sent: true, method: step.method, phase: step.phase };
      } else if (step.needsManualSend) {
        return {
          ok: true,
          sent: false,
          needsManualSend: true,
          method: step.method,
          phase: step.phase,
          message,
        };
      } else {
        if (step.phase) lastPhase = step.phase;
        if (step.error) lastError = step.error;
      }
    } catch (e) {
      lastError = e.message || lastError;
    }
    await sleep(900);
  }

  return { ok: false, sent: false, error: lastError, phase: lastPhase };
}

function gptHandoffStepInline(text) {
  const handoff = self.__qtsChatGptComposerHandoff?.runUnifiedComposerHandoff?.(text);
  return handoff || { ok: false, sent: false, phase: 'no_module', error: 'Composer handoff module missing.' };
}

async function ensureChatGptComposerHandoffScript(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      world: 'MAIN',
      files: ['shared/chatgpt-composer-handoff.js'],
    });
    return true;
  } catch {
    return false;
  }
}

async function executeGptHandoffAllFrames(tabId, message) {
  try {
    await ensureChatGptComposerHandoffScript(tabId);

    const mainResults = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: (text) => {
        const handoff = window.__qtsChatGptComposerHandoff?.runUnifiedComposerHandoff?.(text);
        return handoff || { ok: false, sent: false, phase: 'no_module', error: 'Composer handoff module missing.' };
      },
      args: [message],
    });
    const mainStep = mainResults?.[0]?.result;
    if (mainStep?.sent || mainStep?.needsManualSend) return mainStep;
    if (mainStep && mainStep.phase && mainStep.phase !== 'no_editor') return mainStep;

    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      world: 'MAIN',
      func: (text) => {
        const handoff = window.__qtsChatGptComposerHandoff?.runUnifiedComposerHandoff?.(text);
        return handoff || { ok: false, sent: false, phase: 'no_module', error: 'Composer handoff module missing.' };
      },
      args: [message],
    });
    for (const entry of results || []) {
      const step = entry?.result;
      if (step?.sent || step?.needsManualSend) return step;
    }
    for (const entry of results || []) {
      const step = entry?.result;
      if (step && step.phase && step.phase !== 'no_editor') return step;
    }
    return mainStep || results?.[0]?.result || null;
  } catch {
    return null;
  }
}

async function forceQtsGptBanner(tabId, message, type = 'warn') {
  const bg = type === 'success' ? '#15803d' : type === 'error' ? '#b91c1c' : '#b45309';
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      world: 'MAIN',
      func: (msg, color) => {
        const root = document.body || document.documentElement;
        if (!root) return { ok: false, href: location.href };
        let el = document.getElementById('qts-gpt-handoff-toast');
        if (!el) {
          el = document.createElement('div');
          el.id = 'qts-gpt-handoff-toast';
          el.style.cssText = [
            'position:fixed', 'top:12px', 'left:50%', 'transform:translateX(-50%)',
            'z-index:2147483647', 'max-width:min(560px,94vw)', 'padding:12px 16px',
            'border-radius:10px', 'font:14px/1.4 system-ui,sans-serif',
            'box-shadow:0 8px 24px rgba(0,0,0,.3)', 'color:#fff',
          ].join(';');
          root.appendChild(el);
        }
        el.style.background = color;
        el.textContent = msg;
        return { ok: true, href: location.href, top: window.top === window.self };
      },
      args: [message, bg],
    });
    return true;
  } catch (e) {
    await chrome.storage.local.set({ qtsLastGptBannerError: String(e?.message || e) });
    return false;
  }
}

async function executeGptHandoffStep(tabId, message) {
  const allFrames = await executeGptHandoffAllFrames(tabId, message);
  if (allFrames?.sent || allFrames?.needsManualSend) {
    await chrome.storage.local.set({
      qtsLastGptHandoffDebug: { at: Date.now(), tabId, response: allFrames, via: 'allFrames' },
    });
    return allFrames;
  }

  await ensureChatGptHandoffScript(tabId);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const response = await chrome.tabs.sendMessage(tabId, {
        type: 'QTS_GPT_HANDOFF_STEP',
        message,
      });
      if (response) {
        await chrome.storage.local.set({
          qtsLastGptHandoffDebug: { at: Date.now(), tabId, response, via: 'sendMessage' },
        });
        return response;
      }
    } catch (e) {
      await sleep(600);
    }
  }

  try {
    const isolated = await chrome.scripting.executeScript({
      target: { tabId },
      func: (text) => window.__qtsChatGptHandoff?.runHandoffStep?.(text),
      args: [message],
    });
    if (isolated[0]?.result) {
      await chrome.storage.local.set({
        qtsLastGptHandoffDebug: { at: Date.now(), tabId, response: isolated[0].result, via: 'isolated' },
      });
      return isolated[0].result;
    }
  } catch {
    // fall through
  }

  try {
    await ensureChatGptMainHandoffScript(tabId);
    const loaded = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: (text) => window.__qtsRunChatGptMainHandoffStep?.(text),
      args: [message],
    });
    if (loaded[0]?.result) return loaded[0].result;
  } catch {
    // fall through
  }

  try {
    await ensureChatGptComposerHandoffScript(tabId);
    const inline = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      world: 'MAIN',
      func: (text) => window.__qtsChatGptComposerHandoff?.runUnifiedComposerHandoff?.(text),
      args: [message],
    });
    return inline[0]?.result || null;
  } catch {
    return null;
  }
}

async function showGptTabHandoffToast(tabId, message, type = 'warn') {
  if (await forceQtsGptBanner(tabId, message, type)) return;
  await ensureChatGptHandoffScript(tabId);
  try {
    await chrome.tabs.sendMessage(tabId, {
      type: 'QTS_GPT_SHOW_TOAST',
      message,
      toastType: type,
    });
    return;
  } catch {
    // fall through
  }
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (msg, toastType) => window.__qtsChatGptHandoff?.showHandoffToast?.(msg, toastType),
      args: [message, type],
    });
  } catch {
    // non-fatal
  }
}

async function waitForGptComposer(tabId, timeoutMs = 45000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      await ensureChatGptComposerHandoffScript(tabId);
      const results = await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        world: 'MAIN',
        func: () => Boolean(window.__qtsChatGptComposerHandoff?.findUnifiedComposerEditor?.()),
      });
      if (results.some((entry) => entry?.result)) return true;
    } catch {
      // tab may still be loading
    }
    await sleep(500);
  }
  return false;
}

async function scanApplicationFormOnTab(tabId, options = {}) {
  const openApplyForm = options.openApplyForm !== false;
  let applyFlow = null;

  let scanResult = await runFormScanScript(tabId, () => (
    window.__scanApplicationForm ? window.__scanApplicationForm() : null
  ));
  if (scanResult.error) return scanResult;

  let scan = scanResult.result;
  let hasForm = await runFormScanScript(
    tabId,
    (payload) => window.__looksLikeApplicationForm?.(payload),
    [scan]
  );
  let formDetected = Boolean(hasForm.result);

  if (openApplyForm && !formDetected) {
    const clickResult = await runFormScanScript(tabId, () => (
      window.__clickApplyToOpenForm ? window.__clickApplyToOpenForm() : { clicked: false, reason: 'unavailable' }
    ));
    if (clickResult.error) return clickResult;

    applyFlow = clickResult.result || { clicked: false, reason: 'unknown' };
    if (applyFlow.clicked) {
      await waitForTabSettled(tabId);
      for (let attempt = 0; attempt < 14; attempt += 1) {
        await sleep(500);
        scanResult = await runFormScanScript(tabId, () => (
          window.__scanApplicationForm ? window.__scanApplicationForm() : null
        ));
        if (scanResult.error) return scanResult;
        scan = scanResult.result;
        hasForm = await runFormScanScript(
          tabId,
          (payload) => window.__looksLikeApplicationForm?.(payload),
          [scan]
        );
        formDetected = Boolean(hasForm.result);
        if (formDetected) break;
      }
      applyFlow.formAppeared = formDetected;
      applyFlow.finalFieldCount = scan?.fields?.length || 0;
    }
  }

  return {
    success: true,
    scan,
    url: scanResult.url,
    title: scanResult.title,
    applyFlow,
    formDetected,
  };
}

async function discoverApplicationFormOnTab(tabId, options = {}) {
  const tab = await getTab(tabId);
  if (!tab?.id) return { error: 'No active tab' };
  if (!isExtractablePageUrl(tab.url)) {
    return { error: restrictedPageMessage(tab.url), manualOnly: true };
  }

  const preDetectedTemplate = options.preDetectedTemplate
    || await getApplyTemplateForTab(tab.id);

  const scriptReady = await ensureFormScanScripts(tab.id);
  if (!scriptReady.ok) {
    return {
      error: 'Could not load form discovery scripts on this page.',
      debug: scriptReady.status,
    };
  }

  const discoveryOptions = {
    openApplyForm: options.openApplyForm,
    expandDynamic: options.expandDynamic,
    dynamicWaitMs: options.dynamicWaitMs,
    preDetectedTemplate,
  };

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (opts) => {
        const run = window.__runDiscoverApplicationForm || window.__discoverApplicationForm;
        if (!run) {
          return {
            __qtsDiscoveryError: 'Form discovery scripts are not available on this tab.',
            debug: {
              scan: !!window.__scanApplicationForm,
              discover: !!window.__discoverApplicationForm,
            },
          };
        }
        return run(opts);
      },
      args: [discoveryOptions],
    });
    const discovery = results[0]?.result;
    if (!discovery) {
      return { error: 'Form discovery returned no result. Reload the job tab and try again.' };
    }
    if (discovery.__qtsDiscoveryError) {
      return {
        error: discovery.__qtsDiscoveryError,
        warnings: discovery.warnings,
        debug: discovery.debug,
      };
    }
    return {
      success: true,
      discovery,
      scan: {
        pageUrl: discovery.scanMeta?.pageUrl || tab.url,
        pageTitle: discovery.scanMeta?.pageTitle || tab.title,
        pageStep: discovery.scanMeta?.pageStep || '',
        scannedAt: discovery.discoveredAt,
        fields: discovery.fields || [],
      },
      url: tab.url,
      title: tab.title,
      formDetected: discovery.formDetected,
      applyFlow: discovery.applyFlow,
    };
  } catch (e) {
    return { error: e.message || 'Form discovery failed.' };
  }
}

async function fillApplicationFormOnTab(tabId, fields) {
  const tab = await getTab(tabId);
  if (!tab?.id) return { error: 'No active tab' };
  const injected = await injectFormScan(tab.id);
  if (!injected) return { error: 'Could not access this page for form filling.' };
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (payload) => window.__fillApplicationFields?.(payload) || { results: [] },
      args: [fields],
    });
    return { success: true, fill: results[0]?.result || { results: [] } };
  } catch (e) {
    return { error: e.message || 'Form fill failed.' };
  }
}

function isCustomGptUrl(url) {
  const gptId = self.__qtsCustomGpt?.CUSTOM_GPT_ID;
  return Boolean(url && gptId && url.includes(gptId));
}

function needsFreshGptConversation(url) {
  return self.__qtsCustomGpt?.needsFreshGptConversation?.(url) ?? (
    isCustomGptUrl(url) && /\/c\//.test(String(url))
  );
}

async function waitForTabComplete(tabId, timeoutMs = 45000) {
  const tab = await getTab(tabId);
  if (!tab?.id) throw new Error('GPT tab not found.');
  if (tab.status === 'complete') return tab;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error('Custom GPT tab load timeout.'));
    }, timeoutMs);

    function listener(updatedTabId, info) {
      if (updatedTabId !== tabId || info.status !== 'complete') return;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      getTab(tabId).then(resolve).catch(reject);
    }

    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function ensureCustomGptTab({ active = false } = {}) {
  const gpt = self.__qtsCustomGpt;
  if (!gpt?.CUSTOM_GPT_URL) throw new Error('Custom GPT URL is not configured.');

  const stored = await chrome.storage.local.get([GPT_TAB_STORAGE_KEY]);
  if (stored[GPT_TAB_STORAGE_KEY]) {
    try {
      const tab = await chrome.tabs.get(stored[GPT_TAB_STORAGE_KEY]);
      if (tab?.id && isCustomGptUrl(tab.url)) {
        await chrome.tabs.update(tab.id, { pinned: true, active });
        return tab.id;
      }
    } catch {
      // stale tab id
    }
  }

  const tabs = await chrome.tabs.query({ url: 'https://chatgpt.com/*' });
  const existing = tabs.find((tab) => isCustomGptUrl(tab.url));
  if (existing?.id) {
    await chrome.tabs.update(existing.id, { pinned: true, active });
    if (!isCustomGptUrl(existing.url)) {
      await chrome.tabs.update(existing.id, { url: gpt.CUSTOM_GPT_URL, active });
    }
    await chrome.storage.local.set({ [GPT_TAB_STORAGE_KEY]: existing.id });
    return existing.id;
  }

  const created = await chrome.tabs.create({
    url: gpt.CUSTOM_GPT_URL,
    pinned: true,
    active,
  });
  await chrome.storage.local.set({ [GPT_TAB_STORAGE_KEY]: created.id });
  return created.id;
}

async function injectChatGptTask(tabId, prompt, taskId, options = {}) {
  if (!prompt && !taskId) return { ok: false, error: 'Missing GPT task prompt.' };
  const message = prompt || self.__qtsCustomGpt?.buildPrompt(taskId);
  const tid = taskId || String(message || '').match(/task_[\w-]+/i)?.[0] || null;
  const preferStarter = options.preferStarter === true;
  const composerWaitMs = options.composerWaitMs || 45000;

  await waitForTabComplete(tabId, 45000).catch(() => {});
  await waitForGptComposer(tabId, composerWaitMs);
  await ensureChatGptHandoffScript(tabId);
  await sleep(300);

  try {
    const response = await chrome.tabs.sendMessage(tabId, {
      type: 'QTS_GPT_RUN_HANDOFF',
      taskId: tid,
      message,
      preferStarter,
      composerWaitMs,
    });
    if (response) return response;
  } catch {
    // fall through to executeScript
  }

  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: (msg, id, preferStarter, waitMs) => window.__qtsChatGptHandoff?.runHandoff({
      message: msg,
      taskId: id,
      preferStarter,
      composerWaitMs: waitMs,
    }),
    args: [message, tid, preferStarter, composerWaitMs],
  });
  return results[0]?.result || { ok: false, error: 'GPT handoff script returned no result.' };
}

function stopGptApprovalWatcher() {
  if (gptApprovalWatchTimer) {
    clearInterval(gptApprovalWatchTimer);
    gptApprovalWatchTimer = null;
  }
}

async function notifyGptActionApprovalNeeded(jobTabId, taskId) {
  const message = 'Custom GPT is waiting for Action approval. Open the pinned GPT tab and click Allow.';
  if (jobTabId) {
    await showPageDetectAlert(jobTabId, message, 'warn');
  }
  chrome.runtime.sendMessage({
    type: 'GPT_ACTION_APPROVAL_NEEDED',
    taskId,
    message,
  }).catch(() => {});
}

async function focusJobTab(jobTabId) {
  if (!jobTabId) return;
  try {
    const tab = await getTab(jobTabId);
    if (tab?.id && !isCustomGptUrl(tab.url)) {
      await chrome.tabs.update(jobTabId, { active: true });
    }
  } catch {
    // tab may be closed
  }
}

async function activateGptTabForHandoff(gptTabId) {
  const tab = await getTab(gptTabId);
  if (!tab?.id) throw new Error('Custom GPT tab not found.');
  if (tab.windowId) {
    await chrome.windows.update(tab.windowId, { focused: true, drawAttention: true });
  }
  await chrome.tabs.update(gptTabId, { active: true, highlighted: true });
  await sleep(900);
  return tab;
}

async function restoreCaptureWindowFocus() {
  if (captureWindowId == null) return;
  try {
    await chrome.windows.update(captureWindowId, { focused: true });
  } catch {
    captureWindowId = null;
  }
}

async function dispatchCustomGptTask(taskId, prompt, jobTabId) {
  const message = prompt || self.__qtsCustomGpt?.buildPrompt(taskId);
  const keepalive = setInterval(() => {
    chrome.runtime.getPlatformInfo(() => {});
  }, 15000);
  let handoff = null;
  let gptTabId = null;

  try {
  let sourceTabId = jobTabId || lastSourceTabId;

  if (sourceTabId) {
    try {
      const sourceTab = await getTab(sourceTabId);
      if (!sourceTab?.id || isCustomGptUrl(sourceTab.url)) {
        sourceTabId = null;
      }
    } catch {
      sourceTabId = null;
    }
  }

  if (sourceTabId) {
    await chrome.storage.local.set({ [JOB_SOURCE_TAB_STORAGE_KEY]: sourceTabId });
    lastSourceTabId = sourceTabId;
  }

  gptTabId = await ensureCustomGptTab({ active: false });
  const gptUrl = self.__qtsCustomGpt?.CUSTOM_GPT_URL;
  const currentGptTab = await getTab(gptTabId);
  const currentUrl = currentGptTab?.url || '';
  const onGptBase = self.__qtsCustomGpt?.isCustomGptBaseUrl?.(currentUrl) ?? false;
  const mustOpenFreshChat = gptUrl && (needsFreshGptConversation(currentUrl) || !isCustomGptUrl(currentUrl));

  await chrome.tabs.update(gptTabId, { pinned: true });
  await activateGptTabForHandoff(gptTabId);
  await forceQtsGptBanner(gptTabId, 'QTS: extension connected — starting handoff…', 'warn');

  if (mustOpenFreshChat) {
    await forceQtsGptBanner(gptTabId, 'QTS: opening fresh Custom GPT conversation…', 'warn');
    await chrome.tabs.update(gptTabId, { url: gptUrl, active: true });
    await waitForTabComplete(gptTabId, 60000).catch(() => {});
    await activateGptTabForHandoff(gptTabId);
    await waitForGptComposer(gptTabId, 45000);
    await sleep(2500);
  } else {
    await sleep(1500);
    await waitForGptComposer(gptTabId, 20000);
  }

  await chrome.storage.local.set({
    qtsLastGptHandoffDebug: {
      at: Date.now(),
      tabId: gptTabId,
      urlBefore: currentUrl,
      onGptBase,
      mustOpenFreshChat,
    },
  });
  await forceQtsGptBanner(gptTabId, 'QTS: typing PROCESS_TASK into composer…', 'warn');

  await activateGptTabForHandoff(gptTabId);
  handoff = await runGptMainWorldHandoff(gptTabId, message, 12000);

  if (!handoff?.sent && !handoff?.needsManualSend) {
    await forceQtsGptBanner(gptTabId, 'QTS: using trusted keyboard input…', 'warn');
    await activateGptTabForHandoff(gptTabId);
    const debuggerHandoff = await typeViaDebugger(gptTabId, message);
    if (debuggerHandoff?.sent || debuggerHandoff?.needsManualSend) {
      handoff = debuggerHandoff;
    }
  }

  if (!handoff?.sent && !handoff?.needsManualSend) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await sleep(2000);
      await activateGptTabForHandoff(gptTabId);
      const fallback = await injectChatGptTask(gptTabId, message, taskId, {
        preferStarter: false,
        composerWaitMs: 20000,
      });
      if (fallback?.sent || fallback?.needsManualSend) {
        handoff = fallback;
        break;
      }
      handoff = fallback;
    }
  }

  if (!handoff?.sent && !handoff?.needsManualSend) {
    handoff = {
      ok: true,
      sent: false,
      needsManualSend: true,
      method: 'clipboard_fallback',
      phase: 'manual_paste_required',
      error: handoff?.error || 'Could not type into ChatGPT automatically.',
      message,
    };
    await installGptClickPasteOverlay(gptTabId, message);
  }

  if (handoff?.sent) {
    await showGptTabHandoffToast(gptTabId, 'PROCESS_TASK sent. Click Allow when ChatGPT asks.', 'success');
  } else if (handoff?.needsManualSend) {
    await showGptTabHandoffToast(
      gptTabId,
      'PROCESS_TASK is in the box below — press Enter, then click Allow.',
      'warn'
    );
  } else {
    await showGptTabHandoffToast(
      gptTabId,
      handoff?.error || 'Could not type PROCESS_TASK — paste from clipboard (click GPT task in extension).',
      'error'
    );
  }

  if (sourceTabId) {
    const handoffNote = handoff?.sent
      ? 'PROCESS_TASK sent to Custom GPT. Click Allow if ChatGPT asks.'
      : handoff?.needsManualSend
        ? 'PROCESS_TASK is in the Custom GPT composer — press Enter, then click Allow.'
        : handoff?.error
          ? `GPT handoff: ${handoff.error}`
          : 'GPT handoff failed — paste PROCESS_TASK manually in the pinned GPT tab.';
    await showPageDetectAlert(sourceTabId, handoffNote, handoff?.sent ? 'success' : 'warn');
  }

  await notifyGptActionApprovalNeeded(sourceTabId, taskId);

  if (sourceTabId && handoff?.sent) {
    await focusJobTab(sourceTabId);
  }

  if (!handoff?.sent) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: gptTabId },
        world: 'MAIN',
        func: (text) => {
          window.__qtsLastProcessTask = text;
          try {
            navigator.clipboard.writeText(text);
          } catch {
            // ignore
          }
        },
        args: [message],
      });
    } catch {
      // ignore
    }
    await chrome.storage.local.set({ qtsLastProcessTaskPrompt: message });
  }

  return {
    ok: Boolean(handoff?.sent || handoff?.needsManualSend || handoff?.ok),
    tabId: gptTabId,
    jobTabId: sourceTabId,
    handoff,
  };
  } finally {
    clearInterval(keepalive);
    if (handoff?.sent) {
      await restoreCaptureWindowFocus();
    } else if (gptTabId) {
      await activateGptTabForHandoff(gptTabId);
    }
  }
}

async function injectDetectToast(tabId) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: [DETECT_TOAST_FILE] });
    return true;
  } catch {
    return false;
  }
}

async function showPageDetectAlert(tabId, message, type) {
  if (!(await injectDetectToast(tabId))) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (msg, toastType) => {
        window.__showQtsDetectToast?.(msg, toastType);
      },
      args: [message, type],
    });
  } catch {
    // non-fatal
  }
}

async function autoDetectJob(tabId, url, { showAlert = true } = {}) {
  if (!isExtractablePageUrl(url) || isIgnoredSite(url)) return;

  const generation = (detectGenerationByTab.get(tabId) || 0) + 1;
  detectGenerationByTab.set(tabId, generation);

  await new Promise((resolve) => setTimeout(resolve, AUTO_DETECT_DELAY_MS));

  if (detectGenerationByTab.get(tabId) !== generation) return;

  const tab = await getTab(tabId);
  if (!tab?.id || tab.url !== url) return;

  const result = await extractJobFromTab(tabId);
  if (detectGenerationByTab.get(tabId) !== generation) return;

  const pageUrl = result.tab?.url || url;
  const entry = buildDetectedJobEntry(tabId, pageUrl, result.data);
  if (result.error) {
    entry.valid = false;
    entry.data = null;
  }

  await setDetectedJobForTab(entry);
  await injectJobPanelWatch(tabId, pageUrl);
  prefetchTabContext(tabId).catch(() => {});
  detectApplyTemplateOnTab(tabId, pageUrl).catch(() => {});

  if (!showAlert) return;

  const toastAction = getDetectToastAction(pageUrl, entry);
  if (toastAction === 'success') {
    await showPageDetectAlert(tabId, DETECT_SUCCESS_MESSAGE, 'success');
  } else if (toastAction === 'fail') {
    await showPageDetectAlert(tabId, DETECT_FAIL_MESSAGE, 'fail');
  }

  notifyCapturePopup(tabId);
}

function notifyCapturePopup(tabId) {
  if (captureWindowId === null || lastSourceTabId !== tabId) return;
  chrome.runtime.sendMessage({ type: 'JOB_DETECTED_UPDATE', tabId }).catch(() => {});
}

async function runDetectForActiveTab(tabId) {
  const tab = await getTab(tabId);
  if (!tab?.id || !tab.url) return;
  if (!isExtractablePageUrl(tab.url) || isIgnoredSite(tab.url)) return;
  lastAutoOpenKeyByTab.delete(tabId);
  await autoDetectJob(tabId, tab.url).catch(() => {});
}

function maybeTrackAutoOpen(tabId, url) {
  if (!isExtractablePageUrl(url) || isIgnoredSite(url)) return;
  const autoKey = `${tabId}:${url}`;
  if (lastAutoOpenKeyByTab.get(tabId) === autoKey) return;
  lastAutoOpenKeyByTab.set(tabId, autoKey);
  autoDetectJob(tabId, url).catch(() => {});
}

chrome.action.onClicked.addListener((tab) => {
  if (!tab?.id) return;
  openCaptureWindow(tab.id).catch((err) => {
    console.warn('[QTS_Startup] Could not open capture window:', err);
  });
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'EXTRACT_JOB') {
    (async () => {
      let tab = null;
      if (msg.tabId) tab = await getTab(msg.tabId);
      if (!tab && lastSourceTabId) tab = await getTab(lastSourceTabId);
      if (!tab) {
        const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        tab = activeTab;
      }
      if (!tab?.id) {
        sendResponse({ error: 'No active tab' });
        return;
      }

      const result = await extractJobFromTab(tab.id);
      if (result.error) {
        sendResponse({
          error: result.error,
          manualOnly: result.manualOnly,
          url: tab.url,
          title: tab.title,
        });
        return;
      }

      const pageUrl = result.url || tab.url;
      const entry = buildDetectedJobEntry(tab.id, pageUrl, result.data);
      await setDetectedJobForTab(entry);

      sendResponse({
        data: result.data,
        url: pageUrl,
        title: tab.title,
        detected: entry.valid,
        detectMessage: entry.valid ? DETECT_SUCCESS_MESSAGE : DETECT_FAIL_MESSAGE,
      });
    })().catch((e) => sendResponse({ error: e.message || 'Extraction failed.', manualOnly: true }));
    return true;
  }

  if (msg.type === 'GET_CURRENT_TAB_URL') {
    (async () => {
      const tabId = msg.tabId || lastSourceTabId;
      if (tabId) {
        const tab = await getTab(tabId);
        if (tab) {
          sendResponse({ url: tab.url, title: tab.title, tabId: tab.id });
          return;
        }
      }
      const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      sendResponse({
        url: activeTab?.url,
        title: activeTab?.title,
        tabId: activeTab?.id ?? null,
      });
    })().catch(() => sendResponse({ url: null, title: null, tabId: null }));
    return true;
  }

  if (msg.type === 'URL_CHANGED') {
    const tabId = sender.tab?.id;
    if (tabId && msg.url) maybeTrackAutoOpen(tabId, msg.url);
    return false;
  }

  if (msg.type === 'JOB_PANEL_CHANGED') {
    const tabId = sender.tab?.id;
    const url = msg.url || sender.tab?.url;
    if (!tabId || !url || !isExtractablePageUrl(url) || isIgnoredSite(url)) return false;
    lastAutoOpenKeyByTab.delete(tabId);
    autoDetectJob(tabId, url).catch(() => {});
    return false;
  }

  if (msg.type === 'DISCOVER_APPLICATION_FORM') {
    (async () => {
      let tabId = msg.tabId || lastSourceTabId;
      if (!tabId) {
        const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        tabId = activeTab?.id;
      }
      if (!tabId) {
        sendResponse({ error: 'No active tab' });
        return;
      }
      const preDetectedTemplate = await getApplyTemplateForTab(tabId);
      sendResponse(await discoverApplicationFormOnTab(tabId, {
        openApplyForm: msg.openApplyForm,
        expandDynamic: msg.expandDynamic,
        dynamicWaitMs: msg.dynamicWaitMs || 4000,
        preDetectedTemplate,
      }));
    })().catch((e) => sendResponse({ error: e.message || 'Form discovery failed.' }));
    return true;
  }

  if (msg.type === 'GET_APPLY_TEMPLATE') {
    (async () => {
      const tabId = msg.tabId || lastSourceTabId;
      if (!tabId) {
        sendResponse({ success: false, error: 'No tab' });
        return;
      }
      let detection = await getApplyTemplateForTab(tabId);
      const tab = await getTab(tabId);
      if (!detection && tab?.url && isTemplateCandidateUrl(tab.url)) {
        detection = await detectApplyTemplateOnTab(tabId, tab.url);
      }
      sendResponse({ success: true, detection });
    })().catch((e) => sendResponse({ success: false, error: e.message }));
    return true;
  }

  if (msg.type === 'DETECT_APPLY_TEMPLATE') {
    (async () => {
      const tabId = msg.tabId || lastSourceTabId;
      if (!tabId) {
        sendResponse({ success: false, error: 'No tab' });
        return;
      }
      const tab = await getTab(tabId);
      const detection = await detectApplyTemplateOnTab(tabId, tab?.url);
      sendResponse({ success: true, detection });
    })().catch((e) => sendResponse({ success: false, error: e.message }));
    return true;
  }

  if (msg.type === 'SCAN_APPLICATION_FORM') {
    (async () => {
      let tabId = msg.tabId || lastSourceTabId;
      if (!tabId) {
        const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        tabId = activeTab?.id;
      }
      if (!tabId) {
        sendResponse({ error: 'No active tab' });
        return;
      }
      sendResponse(await scanApplicationFormOnTab(tabId, {
        openApplyForm: msg.openApplyForm !== false,
      }));
    })().catch((e) => sendResponse({ error: e.message || 'Form scan failed.' }));
    return true;
  }

  if (msg.type === 'FILL_APPLICATION_FORM') {
    (async () => {
      let tabId = msg.tabId || lastSourceTabId;
      if (!tabId) {
        const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        tabId = activeTab?.id;
      }
      if (!tabId) {
        sendResponse({ error: 'No active tab' });
        return;
      }
      sendResponse(await fillApplicationFormOnTab(tabId, msg.fields || []));
    })().catch((e) => sendResponse({ error: e.message || 'Form fill failed.' }));
    return true;
  }

  if (msg.type === 'POLL_AND_APPLY_GPT_TASK') {
    startGptPollAndApply({
      taskId: msg.taskId,
      applicationId: msg.applicationId,
      jobTabId: msg.jobTabId || lastSourceTabId,
    });
    sendResponse({ ok: true, started: true });
    return false;
  }

  if (msg.type === 'STOP_GPT_POLL_AND_APPLY') {
    stopGptPollAndApply();
    sendResponse({ ok: true });
    return false;
  }

  if (msg.type === 'APPLY_GPT_PACKAGE_TO_TAB') {
    (async () => {
      try {
        const applied = await applyGptPackageToJobTab(msg.applicationId, msg.jobTabId || lastSourceTabId);
        sendResponse({ ok: true, ...applied });
      } catch (e) {
        sendResponse({ ok: false, error: e.message || 'Could not apply GPT package.' });
      }
    })().catch((e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }

  if (msg.type === 'DISPATCH_GPT_TASK') {
    const runDispatch = async () => {
      const taskId = msg.taskId;
      const prompt = msg.prompt || self.__qtsCustomGpt?.buildPrompt(taskId);
      if (!taskId) {
        return { ok: false, error: 'taskId is required.' };
      }
      const result = await dispatchCustomGptTask(taskId, prompt, msg.jobTabId);
      if (msg.pollAndApply && result.ok) {
        startGptPollAndApply({
          taskId,
          applicationId: msg.applicationId,
          jobTabId: msg.jobTabId || lastSourceTabId,
        });
      }
      if (msg.async) {
        chrome.runtime.sendMessage({
          type: 'GPT_DISPATCH_FINISHED',
          taskId,
          applicationId: msg.applicationId,
          ...result,
        }).catch(() => {});
      }
      return result;
    };

    if (msg.async) {
      runDispatch().catch((e) => {
        chrome.runtime.sendMessage({
          type: 'GPT_DISPATCH_FINISHED',
          taskId: msg.taskId,
          applicationId: msg.applicationId,
          ok: false,
          error: e.message || 'Could not dispatch GPT task.',
        }).catch(() => {});
      });
      sendResponse({ ok: true, started: true });
      return false;
    }

    runDispatch()
      .then(sendResponse)
      .catch((e) => sendResponse({ ok: false, error: e.message || 'Could not dispatch GPT task.' }));
    return true;
  }

  if (msg.type === 'STOP_GPT_APPROVAL_WATCH') {
    stopGptApprovalWatcher();
    sendResponse({ ok: true });
    return false;
  }

  if (msg.type === 'ENSURE_CUSTOM_GPT_TAB') {
    (async () => {
      try {
        const tabId = await ensureCustomGptTab({ active: Boolean(msg.active) });
        sendResponse({ ok: true, tabId });
      } catch (e) {
        sendResponse({ ok: false, error: e.message || 'Could not open Custom GPT tab.' });
      }
    })().catch((e) => sendResponse({ ok: false, error: e.message || 'Could not open Custom GPT tab.' }));
    return true;
  }
});

chrome.runtime.onStartup.addListener(() => {
  prefetchWorkspaceIfStale().catch(() => {});
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.authToken) return;
  if (changes.authToken.newValue) {
    prefetchWorkspace(true).catch(() => {});
  }
});

chrome.runtime.onInstalled.addListener(() => {
  prefetchWorkspaceIfStale().catch(() => {});
});

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const tab = await getTab(activeInfo.tabId);
  if (tab?.url && !isCustomGptUrl(tab.url)) {
    runDetectForActiveTab(activeInfo.tabId).catch(() => {});
  }
  prefetchTabContext(activeInfo.tabId).catch(() => {});
  if (captureWindowId === null) return;
  if (tab?.url && isCustomGptUrl(tab.url)) return;
  lastSourceTabId = activeInfo.tabId;
  chrome.runtime.sendMessage({ type: 'SET_SOURCE_TAB', tabId: activeInfo.tabId }).catch(() => {});
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'loading') {
    lastAutoOpenKeyByTab.delete(tabId);
    return;
  }

  const url = changeInfo.url || tab.url;
  if (!url || !isExtractablePageUrl(url)) return;
  if (changeInfo.status === 'complete' || changeInfo.url) {
    maybeTrackAutoOpen(tabId, url);
  }
});

chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId !== 0) return;
  if (!isExtractablePageUrl(details.url)) return;
  injectExtractors(details.tabId).catch(() => {});
  if (details.transitionQualifiers?.includes('reload') || details.transitionType === 'reload') {
    lastAutoOpenKeyByTab.delete(details.tabId);
    maybeTrackAutoOpen(details.tabId, details.url);
  }
});

chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
  if (details.frameId !== 0) return;
  if (!isExtractablePageUrl(details.url)) return;
  maybeTrackAutoOpen(details.tabId, details.url);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  lastAutoOpenKeyByTab.delete(tabId);
  injectedExtractorTabs.delete(tabId);
  detectGenerationByTab.delete(tabId);
  removeDetectedJobForTab(tabId).catch(() => {});
  removeApplyTemplateForTab(tabId).catch(() => {});
  chrome.storage.local.get([GPT_TAB_STORAGE_KEY], (stored) => {
    if (stored[GPT_TAB_STORAGE_KEY] === tabId) {
      chrome.storage.local.remove(GPT_TAB_STORAGE_KEY);
    }
  });
});

chrome.windows.onRemoved.addListener((windowId) => {
  if (windowId === captureWindowId) captureWindowId = null;
});

function isIgnoredSite(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
    const ignored = new Set([
      'google.com',
      'mail.google.com',
      'docs.google.com',
      'drive.google.com',
      'youtube.com',
      'facebook.com',
      'instagram.com',
      'twitter.com',
      'x.com',
      'reddit.com',
      'amazon.com',
      'github.com',
      'stackoverflow.com',
      'chromewebstore.google.com',
      'chrome.google.com',
    ]);
    return ignored.has(host);
  } catch {
    return false;
  }
}

async function maybeOpenCaptureWindow(tabId, url) {
  if (!isExtractablePageUrl(url) || isIgnoredSite(url)) return;

  const prefs = await chrome.storage.local.get(['autoOpenPopup', 'authToken']);
  if (prefs.autoOpenPopup === false) return;
  if (!prefs.authToken) return;

  await openCaptureWindow(tabId);
}

function captureWindowUrl(tabId) {
  return chrome.runtime.getURL(`popup/popup.html?tabId=${tabId}`);
}

async function getCaptureWindowHeight(sourceTabId) {
  try {
    const tab = await chrome.tabs.get(sourceTabId);
    if (tab?.windowId) {
      const win = await chrome.windows.get(tab.windowId);
      if (win?.height) {
        return Math.max(
          CAPTURE_WINDOW_MIN_HEIGHT,
          Math.round(win.height * CAPTURE_WINDOW_HEIGHT_RATIO)
        );
      }
    }
  } catch {
    // fall through
  }
  return Math.max(CAPTURE_WINDOW_MIN_HEIGHT, Math.round(900 * CAPTURE_WINDOW_HEIGHT_RATIO));
}

async function captureWindowPlacement(sourceTabId) {
  try {
    const tab = await chrome.tabs.get(sourceTabId);
    if (!tab?.windowId) return {};
    const browserWin = await chrome.windows.get(tab.windowId);
    const width = browserWin.width || 1200;
    const left = Math.max(0, (browserWin.left || 0) + width - CAPTURE_WINDOW_WIDTH - 16);
    const top = Math.max(0, (browserWin.top || 0) + 48);
    return { left, top };
  } catch {
    return {};
  }
}

async function focusCaptureWindow(tabId) {
  if (captureWindowId === null) return false;
  const height = await getCaptureWindowHeight(tabId);

  try {
    const existing = await chrome.windows.get(captureWindowId, { populate: true });
    if (!existing) {
      captureWindowId = null;
      return false;
    }

    if (lastSourceTabId === tabId) {
      await chrome.windows.update(captureWindowId, {
        focused: true,
        width: CAPTURE_WINDOW_WIDTH,
        height,
      });
      return true;
    }

    try {
      await chrome.runtime.sendMessage({ type: 'SET_SOURCE_TAB', tabId });
      await chrome.windows.update(captureWindowId, {
        focused: true,
        width: CAPTURE_WINDOW_WIDTH,
        height,
      });
      return true;
    } catch {
      const popupTab = existing.tabs?.[0];
      if (popupTab?.id) {
        await chrome.tabs.update(popupTab.id, { url: captureWindowUrl(tabId) });
        await chrome.windows.update(captureWindowId, {
          focused: true,
          width: CAPTURE_WINDOW_WIDTH,
          height,
        });
        return true;
      }
    }
  } catch {
    captureWindowId = null;
  }

  return false;
}

async function openCaptureWindow(tabId) {
  runDetectForActiveTab(tabId).catch(() => {});
  prefetchTabContext(tabId).catch(() => {});

  if (await focusCaptureWindow(tabId)) {
    lastSourceTabId = tabId;
    return;
  }

  lastSourceTabId = tabId;
  const placement = await captureWindowPlacement(tabId);
  const height = await getCaptureWindowHeight(tabId);
  const win = await chrome.windows.create({
    url: captureWindowUrl(tabId),
    type: 'popup',
    width: CAPTURE_WINDOW_WIDTH,
    height,
    focused: true,
    ...placement,
  });

  captureWindowId = win.id;
}
