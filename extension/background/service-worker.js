// Background service worker — tab tracking, capture window, messages

importScripts(
  '../shared/job-detect.js',
  '../shared/api-prefetch.js',
  '../shared/custom-gpt.js',
  '../shared/bidder-auth-storage.js',
  '../shared/apply-session-store.js',
  '../shared/api-worker.js',
  '../shared/gpt-worker-handoff.js',
  '../shared/field-classifier.js',
  '../shared/candidate-matcher.js',
  '../shared/fill-policy.js',
  '../shared/auto-application-pipeline.js'
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
const detectSuccessToastShownKeys = new Set();

function detectSuccessToastKey(tabId, url) {
  const normalized = typeof normalizeJobUrl === 'function'
    ? normalizeJobUrl(url)
    : String(url || '').trim();
  return `${tabId}:${normalized}`;
}

function clearDetectSuccessToastsForTab(tabId) {
  const prefix = `${tabId}:`;
  for (const key of detectSuccessToastShownKeys) {
    if (key.startsWith(prefix)) detectSuccessToastShownKeys.delete(key);
  }
}

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
const APPLY_MODAL_WATCH_FILE = 'content/apply-modal-watch.js';
const APPLICATION_FLOW_FILE = 'shared/application-flow.js';
const FORM_SCAN_SCRIPT_FILES = [
  APPLICATION_FLOW_FILE,
  FORM_SCAN_FILE,
  TEMPLATE_REGISTRY_FILE,
  JUSTJOIN_EASY_APPLY_FILE,
  JUSTJOIN_EXTERNAL_APPLY_FILE,
  JUSTJOIN_APPLY_FILE,
  APPLICATION_DISCOVERY_FILE,
  APPLY_TEMPLATE_DETECTOR_FILE,
];
const APPLY_MODAL_WATCH_FILE_LIST = [APPLY_MODAL_WATCH_FILE];
const GPT_TAB_STORAGE_KEY = 'qtsCustomGptTabId';
const JOB_SOURCE_TAB_STORAGE_KEY = 'qtsJobSourceTabId';
const PENDING_GPT_DISPATCH_KEY = 'qtsPendingGptDispatch';
const APPLY_TEMPLATE_TAB_KEY = 'qtsApplyTemplateByTab';
let lastApplyMethodDetectKeyByTab = new Map();
let gptApprovalWatchTimer = null;
let gptPollApplyJob = null;
let gptDispatchInFlight = false;
let gptPrewarmPromise = null;
let gptPageWatchJob = null;
const autoPipelineInFlight = new Set();
const lastAutoPipelineKeyByTab = new Map();
const AUTO_PIPELINE_DELAY_MS = 1200;
let autoPipelineDepsReady = false;

function ensureAutoPipelineDeps() {
  if (autoPipelineDepsReady) return;
  self.__qtsAutoApplicationPipeline?.registerDeps?.({
    getTab,
    setJobSourceTab: async (tabId) => {
      lastSourceTabId = tabId;
      await chrome.storage.local.set({ [JOB_SOURCE_TAB_STORAGE_KEY]: tabId });
    },
    discoverApplicationFormOnTab,
    fillApplicationFormOnTab,
    detectApplyTemplateOnTab,
    executeSendGptTask,
    preloadCustomGptTab,
    releaseUiForGptHandoff,
    showPageDetectAlert,
  });
  autoPipelineDepsReady = true;
}

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

  let tabId = jobTabId;
  if (!tabId) {
    const stored = await chrome.storage.local.get([JOB_SOURCE_TAB_STORAGE_KEY]);
    tabId = stored[JOB_SOURCE_TAB_STORAGE_KEY] || lastSourceTabId;
  }
  if (!tabId) {
    throw new Error('No job tab found for GPT apply.');
  }

  const detectedTemplate = await getApplyTemplateForTab(tabId);
  const fillPolicy = self.__qtsFillPolicy?.getFillPolicyForTemplate?.(detectedTemplate?.templateId);
  let payload = [...fillFields, ...remainingFields, ...fileUploadFields];
  if (fillPolicy?.gptApplyDocumentsOnly) {
    payload = fileUploadFields;
  }

  if (!payload.length) {
    throw new Error('No GPT answers or documents found on server yet.');
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
    fillPolicy?.gptApplyDocumentsOnly
      ? `Resume uploaded from Custom GPT.${uploadNote} Review name, email & CV before submit.`
      : `GPT package applied (${filledCount} field(s)).${uploadNote} Review before submit.`,
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
const extractorInjectInFlight = new Map();

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

  const inFlight = extractorInjectInFlight.get(tabId);
  if (inFlight) return inFlight;

  const promise = (async () => {
    try {
      const [{ result: hasExtractors }] = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => typeof window.__extractJobData === 'function',
      });
      if (hasExtractors) {
        injectedExtractorTabs.add(tabId);
        return true;
      }

      await chrome.scripting.executeScript({ target: { tabId }, files: EXTRACTOR_FILES });
      injectedExtractorTabs.add(tabId);
      return true;
    } catch (err) {
      console.warn('[QTS_Startup] Skipped injection on', tab?.url, err?.message || err);
      return false;
    } finally {
      extractorInjectInFlight.delete(tabId);
    }
  })();

  extractorInjectInFlight.set(tabId, promise);
  return promise;
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
  chrome.runtime.sendMessage({ type: 'APPLY_TEMPLATE_DETECTED', tabId }).catch(() => {});
}

async function injectApplyModalWatch(tabId, url) {
  if (!/justjoin\.it\/job-offer\//i.test(url || '')) return false;
  await injectFormScan(tabId);
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: APPLY_MODAL_WATCH_FILE_LIST,
    });
    return true;
  } catch {
    return false;
  }
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
    if (!detection) {
      await removeApplyTemplateForTab(tabId);
      return null;
    }
    if (!detection.templateId && !detection.applyMethod && !detection.platform) {
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

function isChatGptHostUrl(url) {
  const worker = self.__qtsGptWorkerHandoff;
  if (worker?.isChatGptHost) {
    return worker.isChatGptHost(url || '');
  }
  try {
    const host = new URL(url || '').hostname.replace(/^www\./, '').toLowerCase();
    return host === 'chatgpt.com' || host === 'chat.openai.com';
  } catch {
    return /chatgpt\.com|chat\.openai\.com/i.test(String(url || ''));
  }
}

function isCustomGptUrl(url, title = '') {
  const worker = self.__qtsGptWorkerHandoff;
  if (worker?.isQtsGptTab) {
    return worker.isQtsGptTab({ url: url || '', title: title || '' });
  }
  const gptId = self.__qtsCustomGpt?.CUSTOM_GPT_ID;
  return Boolean(url && gptId && url.includes(gptId));
}

async function getPinnedGptTabId() {
  const worker = self.__qtsGptWorkerHandoff;
  if (worker?.readPinnedGptTabId) {
    return worker.readPinnedGptTabId(GPT_TAB_STORAGE_KEY);
  }
  const stored = await chrome.storage.local.get([GPT_TAB_STORAGE_KEY]);
  return stored[GPT_TAB_STORAGE_KEY] || null;
}

async function isPinnedGptTab(tabId) {
  const worker = self.__qtsGptWorkerHandoff;
  if (worker?.isPinnedGptTabId) {
    return worker.isPinnedGptTabId(tabId, GPT_TAB_STORAGE_KEY);
  }
  const pinnedId = await getPinnedGptTabId();
  return Number(pinnedId) === Number(tabId);
}

function isExtensionOrInternalUrl(url) {
  if (!url) return true;
  try {
    const protocol = new URL(url).protocol.replace(':', '');
    return protocol === 'chrome' || protocol === 'chrome-extension' || protocol === 'edge' || protocol === 'about';
  } catch {
    return false;
  }
}

async function resolveJobTabIdForCapture(preferredTabId) {
  const tab = preferredTabId ? await getTab(preferredTabId) : null;
  if (tab?.id && tab.url && !isExtensionOrInternalUrl(tab.url) && !(await isPinnedGptTab(tab.id))) {
    return tab.id;
  }

  const stored = await chrome.storage.local.get([JOB_SOURCE_TAB_STORAGE_KEY]);
  const storedTabId = stored[JOB_SOURCE_TAB_STORAGE_KEY];
  if (storedTabId) {
    const storedTab = await getTab(storedTabId);
    if (storedTab?.id && storedTab.url && !isExtensionOrInternalUrl(storedTab.url) && !(await isPinnedGptTab(storedTab.id))) {
      return storedTab.id;
    }
  }

  if (lastSourceTabId) {
    const lastTab = await getTab(lastSourceTabId);
    if (lastTab?.id && lastTab.url && !isExtensionOrInternalUrl(lastTab.url) && !(await isPinnedGptTab(lastTab.id))) {
      return lastTab.id;
    }
  }

  const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (activeTab?.id && activeTab.url && !isExtensionOrInternalUrl(activeTab.url) && !(await isPinnedGptTab(activeTab.id))) {
    return activeTab.id;
  }

  return null;
}

async function focusCaptureUi(jobTabId) {
  if (captureWindowId == null) return false;
  try {
    await chrome.windows.update(captureWindowId, { focused: true, drawAttention: true });
    return true;
  } catch {
    captureWindowId = null;
    return false;
  }
}

async function closeCaptureWindow() {
  if (captureWindowId == null) return;
  const windowId = captureWindowId;
  captureWindowId = null;
  try {
    await chrome.windows.remove(windowId);
  } catch {
    // window may already be closed
  }
}

async function focusBrowserWindowForTab(tabId) {
  if (!tabId) return;
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab?.windowId == null) return;
    await chrome.windows.update(tab.windowId, { focused: true, drawAttention: true });
    await chrome.tabs.update(tabId, { active: true });
  } catch {
    // tab or window may be closed
  }
}

async function releaseUiForGptHandoff({ jobTabId, gptTabId } = {}) {
  await closeCaptureWindow();
  const focusTabId = gptTabId || await getPinnedGptTabId();
  if (focusTabId) {
    await focusBrowserWindowForTab(focusTabId);
  } else if (jobTabId) {
    await focusBrowserWindowForTab(jobTabId);
  }
}

function stopGptApprovalWatcher() {
  if (gptApprovalWatchTimer) {
    clearInterval(gptApprovalWatchTimer);
    gptApprovalWatchTimer = null;
  }
  const tabId = gptPageWatchJob?.tabId;
  if (tabId) {
    void self.__qtsGptWorkerHandoff?.stopAllowWatchInTab?.(tabId);
  }
  gptPageWatchJob = null;
}

function notifyGptPageStatus(payload) {
  chrome.runtime.sendMessage({
    type: 'GPT_PAGE_STATUS',
    ...payload,
  }).catch(() => {});
}

function startGptPageWatch(tabId, taskId, options = {}) {
  stopGptApprovalWatcher();
  const job = {
    tabId,
    taskId,
    applicationId: options.applicationId,
    pollAndApply: options.pollAndApply,
    jobTabId: options.jobTabId,
    cancelled: false,
  };
  gptPageWatchJob = job;

  (async () => {
    const worker = self.__qtsGptWorkerHandoff;
    if (!worker?.watchGptTabAfterSend) return;

    try {
      await releaseUiForGptHandoff({
        jobTabId: options.jobTabId || lastSourceTabId,
        gptTabId: tabId,
      });

      const result = await worker.watchGptTabAfterSend(tabId, taskId, {
        timeoutMs: options.timeoutMs || 180000,
        pollMs: options.pollMs || 1200,
        defocusWindowId: captureWindowId,
        onStatus: (snap) => {
          if (gptPageWatchJob !== job || job.cancelled) return;
          notifyGptPageStatus(snap);
        },
      });

      if (gptPageWatchJob !== job || job.cancelled) return;

      chrome.runtime.sendMessage({
        type: 'GPT_PAGE_WATCH_FINISHED',
        taskId,
        applicationId: options.applicationId,
        ...result,
      }).catch(() => {});

      if (options.pollAndApply && options.applicationId) {
        if (result.ok || (result.totalAllowClicks || 0) > 0) {
          startGptPollAndApply({
            taskId,
            applicationId: options.applicationId,
            jobTabId: options.jobTabId || lastSourceTabId,
          });
        }
      }
    } catch (e) {
      chrome.runtime.sendMessage({
        type: 'GPT_PAGE_WATCH_FINISHED',
        taskId,
        applicationId: options.applicationId,
        ok: false,
        error: e?.message || String(e),
      }).catch(() => {});
    } finally {
      if (gptPageWatchJob === job) gptPageWatchJob = null;
      await worker?.stopAllowWatchInTab?.(tabId);
      await restoreJobBrowserFocus(options.jobTabId || job.jobTabId || lastSourceTabId);
    }
  })();
}

async function notifyGptActionApprovalNeeded(jobTabId, taskId) {
  const message = 'Custom GPT is waiting for Action approval. Open the pinned GPT tab and click Allow.';
  const pinnedGptTabId = await getPinnedGptTabId();
  if (pinnedGptTabId) {
    await focusBrowserWindowForTab(pinnedGptTabId);
  }
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
    if (tab?.id && !isCustomGptUrl(tab.url, tab.title) && !(await isPinnedGptTab(tab.id))) {
      await chrome.tabs.update(jobTabId, { active: true });
    }
  } catch {
    // tab may be closed
  }
}

async function preloadCustomGptTab() {
  if (gptPrewarmPromise) return gptPrewarmPromise;

  gptPrewarmPromise = (async () => {
    const worker = self.__qtsGptWorkerHandoff;
    if (!worker?.ensurePinnedGptTab) {
      throw new Error('GPT worker handoff module not loaded.');
    }

    return worker.ensurePinnedGptTab({
      storageKey: GPT_TAB_STORAGE_KEY,
      focus: false,
      preparePage: true,
      pinInBrowser: true,
    });
  })().finally(() => {
    gptPrewarmPromise = null;
  });

  return gptPrewarmPromise;
}

function isJobPageCandidateUrl(url) {
  return isExtractablePageUrl(url) && !isIgnoredSite(url) && !isChatGptHostUrl(url);
}

async function maybePrewarmCustomGptOnJobPage(url) {
  if (!isJobPageCandidateUrl(url)) return;
  if (!(await isAutoApplyArmed())) return;
  preloadCustomGptTab().catch(() => {});
}

async function restoreCaptureWindowFocus() {
  if (captureWindowId == null) return;
  try {
    await chrome.windows.update(captureWindowId, { focused: true });
  } catch {
    captureWindowId = null;
  }
}

async function restoreJobBrowserFocus(jobTabId) {
  if (jobTabId) {
    await focusBrowserWindowForTab(jobTabId);
    return;
  }
  if (lastSourceTabId) {
    await focusBrowserWindowForTab(lastSourceTabId);
  }
}

async function persistPendingGptDispatch(payload) {
  if (!payload?.taskId) return;
  await chrome.storage.local.set({
    [PENDING_GPT_DISPATCH_KEY]: {
      ...payload,
      startedAt: Date.now(),
    },
  });
}

async function clearPendingGptDispatch() {
  await chrome.storage.local.remove(PENDING_GPT_DISPATCH_KEY);
}

async function readPendingGptDispatch() {
  const stored = await chrome.storage.local.get([PENDING_GPT_DISPATCH_KEY]);
  return stored[PENDING_GPT_DISPATCH_KEY] || null;
}

function notifyGptDispatchFinished(payload) {
  chrome.runtime.sendMessage({
    type: 'GPT_DISPATCH_FINISHED',
    ...payload,
  }).catch(() => {});
}

async function resumePendingGptDispatchIfAny() {
  if (gptDispatchInFlight) return null;
  const pending = await readPendingGptDispatch();
  if (!pending?.taskId || pending.sent) return null;
  if (Date.now() - (pending.startedAt || 0) < 2000) return null;

  const result = await runSendGptTask({
    taskId: pending.taskId,
    jobTabId: pending.jobTabId,
    applicationId: pending.applicationId,
    pollAndApply: pending.pollAndApply,
  });

  if (result.handoff?.sent) {
    await clearPendingGptDispatch();
    notifyGptDispatchFinished({
      taskId: pending.taskId,
      applicationId: pending.applicationId,
      ...result,
    });
  }

  return result;
}

async function runSendGptTask(msg) {
  const taskId = String(msg?.taskId || '').trim();
  if (!taskId) throw new Error('Missing task id');

  const worker = self.__qtsGptWorkerHandoff;
  if (!worker?.sendTaskToCustomGpt) {
    throw new Error('GPT worker handoff module not loaded.');
  }

  let sourceTabId = msg.jobTabId || lastSourceTabId;
  if (sourceTabId) {
    try {
      const sourceTab = await getTab(sourceTabId);
      if (!sourceTab?.id || isCustomGptUrl(sourceTab.url, sourceTab.title) || await isPinnedGptTab(sourceTab.id)) {
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

  const prompt = self.__qtsCustomGpt?.buildPrompt?.(taskId) || `PROCESS_TASK: ${taskId}`;
  await persistPendingGptDispatch({
    taskId,
    prompt,
    jobTabId: sourceTabId,
    applicationId: msg.applicationId,
    pollAndApply: msg.pollAndApply,
    sent: false,
  });

  if (gptPrewarmPromise) {
    await gptPrewarmPromise.catch(() => {});
  }

  const sendResult = await worker.sendTaskToCustomGpt(taskId, {
    storageKey: GPT_TAB_STORAGE_KEY,
    loadTimeoutMs: 45000,
    composerTimeoutMs: 30000,
    sendTimeoutMs: 15000,
  });

  if (sendResult.tabId) {
    await releaseUiForGptHandoff({ jobTabId: sourceTabId, gptTabId: sendResult.tabId });
  }

  const handoff = sendResult.handoff || {
    ok: sendResult.ok,
    sent: Boolean(sendResult.ok && sendResult.handoff?.sent !== false),
    error: sendResult.error,
    message: sendResult.message || prompt,
  };

  if (handoff.sent) {
    await clearPendingGptDispatch();
  } else {
    await persistPendingGptDispatch({
      taskId,
      prompt,
      jobTabId: sourceTabId,
      applicationId: msg.applicationId,
      pollAndApply: msg.pollAndApply,
      sent: false,
      error: handoff.error,
    });
  }

  if (sourceTabId) {
    const handoffNote = handoff.sent
      ? 'PROCESS_TASK sent. Extension is clicking Allow and watching Custom GPT Actions.'
      : `GPT handoff failed: ${handoff.error || 'Could not send PROCESS_TASK.'}`;
    await showPageDetectAlert(sourceTabId, handoffNote, handoff.sent ? 'success' : 'warn');
  }

  if (!handoff.sent) {
    await chrome.storage.local.set({ qtsLastProcessTaskPrompt: prompt });
  }

  if (handoff.sent && sendResult.tabId) {
    startGptPageWatch(sendResult.tabId, taskId, {
      applicationId: msg.applicationId,
      pollAndApply: msg.pollAndApply,
      jobTabId: sourceTabId,
    });
  } else {
    await notifyGptActionApprovalNeeded(sourceTabId, taskId);
  }

  return {
    ok: Boolean(handoff.sent || sendResult.ok),
    tabId: sendResult.tabId || null,
    taskId,
    handoff,
    gptWatchStarted: Boolean(handoff.sent && sendResult.tabId),
  };
}

async function executeSendGptTask(msg) {
  if (gptDispatchInFlight) {
    throw new Error('GPT handoff already in progress.');
  }
  gptDispatchInFlight = true;
  const keepalive = setInterval(() => {
    chrome.runtime.getPlatformInfo(() => {});
  }, 3000);
  try {
    return await runSendGptTask(msg);
  } finally {
    gptDispatchInFlight = false;
    clearInterval(keepalive);
  }
}

async function dispatchCustomGptTask(taskId, prompt, jobTabId, options = {}) {
  const worker = self.__qtsGptWorkerHandoff;
  const message = prompt || self.__qtsCustomGpt?.buildPrompt(taskId);
  const keepalive = setInterval(() => {
    chrome.runtime.getPlatformInfo(() => {});
  }, 4000);
  let handoff = null;
  let gptTabId = null;

  if (gptDispatchInFlight) {
    throw new Error('GPT handoff already in progress.');
  }
  gptDispatchInFlight = true;

  try {
    let sourceTabId = jobTabId || lastSourceTabId;

    if (sourceTabId) {
      try {
        const sourceTab = await getTab(sourceTabId);
        if (!sourceTab?.id || isCustomGptUrl(sourceTab.url, sourceTab.title) || await isPinnedGptTab(sourceTab.id)) {
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

    if (!worker?.sendTaskToCustomGpt) {
      throw new Error('GPT worker handoff module not loaded.');
    }

    await persistPendingGptDispatch({
      taskId,
      prompt: message,
      jobTabId: sourceTabId,
      applicationId: options.applicationId,
      pollAndApply: options.pollAndApply,
      sent: false,
    });

    const sendResult = await worker.sendTaskToCustomGpt(taskId || message, {
      storageKey: GPT_TAB_STORAGE_KEY,
      loadTimeoutMs: 45000,
      composerTimeoutMs: 30000,
      sendTimeoutMs: 15000,
    });
    gptTabId = sendResult.tabId || null;
    handoff = sendResult.handoff || {
      ok: sendResult.ok,
      sent: Boolean(sendResult.ok),
      method: 'gpt_worker_dom',
      error: sendResult.error,
      message: sendResult.message || message,
    };

    if (handoff.sent) {
      await clearPendingGptDispatch();
    } else {
      await persistPendingGptDispatch({
        taskId,
        prompt: message,
        jobTabId: sourceTabId,
        applicationId: options.applicationId,
        pollAndApply: options.pollAndApply,
        sent: false,
        error: handoff.error,
      });
    }

    if (sourceTabId) {
      const handoffNote = handoff.sent
        ? 'PROCESS_TASK sent. Extension is clicking Allow and watching Custom GPT Actions.'
        : `GPT handoff failed: ${handoff.error || 'Could not send PROCESS_TASK.'}`;
      await showPageDetectAlert(sourceTabId, handoffNote, handoff.sent ? 'success' : 'warn');
    }

    if (handoff.sent && gptTabId) {
      startGptPageWatch(gptTabId, taskId, {
        applicationId: options.applicationId,
        pollAndApply: options.pollAndApply,
        jobTabId: sourceTabId,
      });
    } else if (!handoff.sent) {
      await notifyGptActionApprovalNeeded(sourceTabId, taskId);
      await chrome.storage.local.set({ qtsLastProcessTaskPrompt: message });
    }

    const result = {
      ok: Boolean(handoff.sent || handoff.ok),
      tabId: gptTabId,
      jobTabId: sourceTabId,
      taskId,
      handoff,
    };

    if (options.notify) {
      notifyGptDispatchFinished(result);
    }

    return result;
  } finally {
    gptDispatchInFlight = false;
    clearInterval(keepalive);
  }
}

async function injectDetectToast(tabId) {
  try {
    const [{ result: hasToast }] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => typeof window.__showQtsDetectToast === 'function',
    });
    if (!hasToast) {
      await chrome.scripting.executeScript({ target: { tabId }, files: [DETECT_TOAST_FILE] });
    }
    return true;
  } catch {
    return false;
  }
}

async function showPageDetectAlert(tabId, message, type, durationMs, options = {}) {
  const tab = await getTab(tabId);
  const tabUrl = tab?.url || tab?.pendingUrl || '';
  if (isChatGptHostUrl(tabUrl) && !options.allowOnGptTab) return;

  if (!(await injectDetectToast(tabId))) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (msg, toastType, hideMs, oncePerPage) => {
        window.__showQtsDetectToast?.(msg, toastType, hideMs, oncePerPage);
      },
      args: [message, type, durationMs ?? null, options.oncePerPage === true],
    });
  } catch {
    // non-fatal
  }
}

async function isAutoApplyArmed() {
  return Boolean(await self.__qtsAutoApplicationPipeline?.isExtensionOperational?.());
}

function disarmJobPageActivity() {
  lastAutoOpenKeyByTab.clear();
  lastAutoPipelineKeyByTab.clear();
  lastApplyMethodDetectKeyByTab.clear();
  detectSuccessToastShownKeys.clear();
  autoPipelineInFlight.clear();
  detectGenerationByTab.clear();
  stopGptApprovalWatcher();
  stopGptPollAndApply();
}

async function autoDetectJob(tabId, url, { showAlert = true, forcePipeline = false } = {}) {
  if (!forcePipeline && !(await isAutoApplyArmed())) return;

  if (!isExtractablePageUrl(url) || isIgnoredSite(url) || isChatGptHostUrl(url)) return;

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

  if (showAlert) {
    const toastAction = getDetectToastAction(pageUrl, entry);
    if (toastAction === 'success') {
      const toastKey = detectSuccessToastKey(tabId, pageUrl);
      if (!detectSuccessToastShownKeys.has(toastKey)) {
        detectSuccessToastShownKeys.add(toastKey);
        await showPageDetectAlert(tabId, DETECT_SUCCESS_MESSAGE, 'success', null, {
          oncePerPage: true,
        });
      }
    } else if (toastAction === 'fail') {
      await showPageDetectAlert(tabId, DETECT_FAIL_MESSAGE, 'fail');
    }
  }

  notifyCapturePopup(tabId);
  maybeStartAutoApplicationPipeline(tabId, pageUrl, entry, {
    force: Boolean(forcePipeline),
  }).catch(() => {});
}

async function startAutoApplyOnJobTab(tabId) {
  const tab = await getTab(tabId);
  if (!tab?.id || !tab.url) {
    throw new Error('Open a job page in your browser first.');
  }
  if (!isExtractablePageUrl(tab.url) || isIgnoredSite(tab.url)) {
    throw new Error('This tab is not a supported job page.');
  }

  const pipeline = self.__qtsAutoApplicationPipeline;
  if (!(await pipeline?.isExtensionOperational?.())) {
    throw new Error('Sign in, turn on auto-apply, and choose a default candidate first.');
  }

  lastAutoPipelineKeyByTab.delete(tabId);
  lastAutoOpenKeyByTab.delete(tabId);
  lastSourceTabId = tabId;
  await chrome.storage.local.set({ [JOB_SOURCE_TAB_STORAGE_KEY]: tabId });

  await closeCaptureWindow();
  await restoreJobBrowserFocus(tabId);
  preloadCustomGptTab().catch(() => {});
  await showPageDetectAlert(tabId, 'QTS: Discovering job details and starting application…', 'info');
  await autoDetectJob(tabId, tab.url, { showAlert: false, forcePipeline: true });
}

async function maybeStartAutoApplicationPipeline(tabId, url, detectedEntry, options = {}) {
  ensureAutoPipelineDeps();
  const pipeline = self.__qtsAutoApplicationPipeline;
  if (!pipeline?.runAutoApplicationPipeline) return;

  if (!(await pipeline.isAutoApplyEnabled())) return;
  const candidateId = await pipeline.resolveDefaultCandidateId();
  if (!candidateId) return;
  if (autoPipelineInFlight.has(tabId)) return;

  const normalizedUrl = pipeline.normalizePipelineUrl(url);
  const pipelineKey = `${tabId}:${normalizedUrl}`;
  const force = Boolean(options.force);
  if (!force && lastAutoPipelineKeyByTab.get(tabId) === pipelineKey) return;

  autoPipelineInFlight.add(tabId);
  preloadCustomGptTab().catch(() => {});
  try {
    if (!force) {
      await sleep(AUTO_PIPELINE_DELAY_MS);
    } else {
      await sleep(200);
    }
    const tab = await getTab(tabId);
    if (!tab?.id || pipeline.normalizePipelineUrl(tab.url) !== normalizedUrl) return;

    const result = await pipeline.runAutoApplicationPipeline(tabId, {
      candidateId,
      jobUrl: normalizedUrl,
      detectedJob: detectedEntry,
    });

    if (result?.ok || result?.reason === 'already_applied') {
      lastAutoPipelineKeyByTab.set(tabId, pipelineKey);
    }
  } catch (err) {
    const message = err?.message || String(err);
    if (!/no application fields|external apply|apply button/i.test(message)) {
      await showPageDetectAlert(tabId, `QTS auto-apply: ${message}`, 'warn');
    }
  } finally {
    autoPipelineInFlight.delete(tabId);
  }
}

function notifyCapturePopup(tabId) {
  if (captureWindowId === null || lastSourceTabId !== tabId) return;
  chrome.runtime.sendMessage({ type: 'JOB_DETECTED_UPDATE', tabId }).catch(() => {});
}

function maybeDetectApplyMethodOnOpen(tabId, url) {
  (async () => {
    if (!(await isAutoApplyArmed())) return;
    if (!url || isIgnoredSite(url)) return;
    if (!isTemplateCandidateUrl(url)) return;
    const autoKey = `${tabId}:${url}`;
    if (lastApplyMethodDetectKeyByTab.get(tabId) === autoKey) {
      injectApplyModalWatch(tabId, url).catch(() => {});
      return;
    }
    lastApplyMethodDetectKeyByTab.set(tabId, autoKey);
    detectApplyTemplateOnTab(tabId, url)
      .then(() => injectApplyModalWatch(tabId, url))
      .catch(() => {});
  })().catch(() => {});
}

async function runDetectForActiveTab(tabId) {
  if (!(await isAutoApplyArmed())) return;
  const tab = await getTab(tabId);
  if (!tab?.id || !tab.url) return;
  if (!isExtractablePageUrl(tab.url) || isIgnoredSite(tab.url) || isChatGptHostUrl(tab.url)) return;
  lastAutoOpenKeyByTab.delete(tabId);
  await autoDetectJob(tabId, tab.url).catch(() => {});
}

function maybeTrackAutoOpen(tabId, url) {
  if (!isJobPageCandidateUrl(url)) return;
  (async () => {
    if (!(await isAutoApplyArmed())) return;
    maybePrewarmCustomGptOnJobPage(url);
    const autoKey = `${tabId}:${url}`;
    if (lastAutoOpenKeyByTab.get(tabId) === autoKey) return;
    lastAutoOpenKeyByTab.set(tabId, autoKey);
    await autoDetectJob(tabId, url, { showAlert: true });
  })().catch(() => {});
}

chrome.action.onClicked.addListener((tab) => {
  if (!tab?.id) return;

  (async () => {
    const tabUrl = tab.url || '';

    if (isCustomGptUrl(tabUrl, tab.title) || await isPinnedGptTab(tab.id)) {
      const jobTabId = await resolveJobTabIdForCapture(null);
      if (jobTabId) {
        await openCaptureWindow(jobTabId);
      } else if (captureWindowId != null) {
        await focusCaptureUi();
      }
      return;
    }

    if (isExtensionOrInternalUrl(tabUrl)) {
      const jobTabId = await resolveJobTabIdForCapture(null);
      if (jobTabId) {
        await openCaptureWindow(jobTabId);
      }
      return;
    }

    await clearPendingGptDispatch();
    await openCaptureWindow(tab.id, { focus: true });
  })().catch((err) => {
    console.warn('[QTS_Startup] Could not open capture window:', err);
  });
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'qts-gpt-handoff') return;

  port.onMessage.addListener((msg) => {
    if (msg?.type !== 'SEND_GPT_TASK') return;

    executeSendGptTask(msg)
      .then((result) => {
        const payload = { type: 'GPT_HANDOFF_RESULT', ...result };
        port.postMessage(payload);
        notifyGptDispatchFinished(result);
      })
      .catch((e) => {
        const payload = {
          type: 'GPT_HANDOFF_RESULT',
          ok: false,
          taskId: msg.taskId,
          error: e.message || 'Could not send PROCESS_TASK.',
          handoff: { ok: false, sent: false, error: e.message || 'Could not send PROCESS_TASK.' },
        };
        port.postMessage(payload);
        notifyGptDispatchFinished(payload);
      });
  });
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'AUTH_SESSION_EXPIRED') {
    disarmJobPageActivity();
    sendResponse({ ok: true });
    return false;
  }
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

  if (msg.type === 'REGISTER_JOB_TAB') {
    (async () => {
      const tabId = msg.tabId || lastSourceTabId;
      const jobTabId = await resolveJobTabIdForCapture(tabId);
      if (jobTabId) {
        lastSourceTabId = jobTabId;
        await chrome.storage.local.set({ [JOB_SOURCE_TAB_STORAGE_KEY]: jobTabId });
      }
      sendResponse({ ok: true, tabId: jobTabId || tabId || null });
    })().catch((e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }

  if (msg.type === 'GET_CURRENT_TAB_URL') {
    (async () => {
      const jobTabId = await resolveJobTabIdForCapture(msg.tabId || lastSourceTabId);
      if (jobTabId) {
        const tab = await getTab(jobTabId);
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

  if (msg.type === 'APPLY_MODAL_CHANGED') {
    const tabId = sender.tab?.id;
    const url = msg.url || sender.tab?.url;
    if (!tabId || !url || !isTemplateCandidateUrl(url)) return false;
    (async () => {
      if (!(await isAutoApplyArmed())) return;
      detectApplyTemplateOnTab(tabId, url).catch(() => {});
    })().catch(() => {});
    return false;
  }

  if (msg.type === 'JOB_PANEL_CHANGED') {
    const tabId = sender.tab?.id;
    const url = msg.url || sender.tab?.url;
    if (!tabId || !url || !isExtractablePageUrl(url) || isIgnoredSite(url)) return false;
    (async () => {
      if (!(await isAutoApplyArmed())) return;
      lastAutoOpenKeyByTab.delete(tabId);
      lastAutoPipelineKeyByTab.delete(tabId);
      await autoDetectJob(tabId, url).catch(() => {});
    })().catch(() => {});
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

  if (msg.type === 'SEND_GPT_TASK') {
    const run = async () => executeSendGptTask(msg);

    if (msg.async !== false) {
      run()
        .then((result) => notifyGptDispatchFinished({ taskId: msg.taskId, applicationId: msg.applicationId, ...result }))
        .catch((e) => notifyGptDispatchFinished({
          taskId: msg.taskId,
          applicationId: msg.applicationId,
          ok: false,
          error: e.message || 'Could not send PROCESS_TASK.',
          handoff: { ok: false, sent: false, error: e.message || 'Could not send PROCESS_TASK.' },
        }));
      sendResponse({ ok: true, started: true });
      return false;
    }

    run()
      .then((result) => sendResponse({ ...result }))
      .catch((e) => sendResponse({ ok: false, error: e.message || 'Could not send PROCESS_TASK.' }));
    return true;
  }

  if (msg.type === 'DISPATCH_GPT_TASK') {
    const runDispatch = async () => {
      const taskId = msg.taskId;
      const prompt = msg.prompt || self.__qtsCustomGpt?.buildPrompt(taskId);
      if (!taskId) {
        return { ok: false, error: 'taskId is required.' };
      }
      const result = await dispatchCustomGptTask(taskId, prompt, msg.jobTabId, {
        applicationId: msg.applicationId,
        pollAndApply: msg.pollAndApply,
        focus: msg.focus === true,
        notify: Boolean(msg.async),
      });
      if (msg.async) {
        notifyGptDispatchFinished({
          taskId,
          applicationId: msg.applicationId,
          ...result,
        });
      }
      return result;
    };

    if (msg.async) {
      runDispatch().catch((e) => {
        notifyGptDispatchFinished({
          taskId: msg.taskId,
          applicationId: msg.applicationId,
          ok: false,
          error: e.message || 'Could not dispatch GPT task.',
          handoff: { ok: false, sent: false, error: e.message || 'Could not dispatch GPT task.' },
        });
      });
      sendResponse({ ok: true, started: true });
      return false;
    }

    runDispatch()
      .then(sendResponse)
      .catch((e) => sendResponse({ ok: false, error: e.message || 'Could not dispatch GPT task.' }));
    return true;
  }

  if (msg.type === 'START_AUTO_APPLY_ON_TAB') {
    (async () => {
      const stored = await chrome.storage.local.get([JOB_SOURCE_TAB_STORAGE_KEY]);
      const jobTabId = msg.jobTabId || stored[JOB_SOURCE_TAB_STORAGE_KEY] || lastSourceTabId;
      if (!jobTabId) {
        sendResponse({ ok: false, error: 'No job tab found. Open a job listing first.' });
        return;
      }
      await startAutoApplyOnJobTab(jobTabId);
      sendResponse({ ok: true, tabId: jobTabId });
    })().catch((e) => sendResponse({ ok: false, error: e?.message || String(e) }));
    return true;
  }

  if (msg.type === 'RESET_AUTO_PIPELINE_STATE') {
    disarmJobPageActivity();
    sendResponse({ ok: true });
    return false;
  }

  if (msg.type === 'DISMISS_CAPTURE_WINDOW') {
    (async () => {
      const stored = await chrome.storage.local.get([JOB_SOURCE_TAB_STORAGE_KEY]);
      const jobTabId = msg.jobTabId || stored[JOB_SOURCE_TAB_STORAGE_KEY] || lastSourceTabId;
      await closeCaptureWindow();
      await restoreJobBrowserFocus(jobTabId);
      sendResponse({ ok: true });
    })().catch((e) => sendResponse({ ok: false, error: e?.message || String(e) }));
    return true;
  }

  if (msg.type === 'RELEASE_UI_FOR_GPT') {
    releaseUiForGptHandoff({ jobTabId: msg.jobTabId || lastSourceTabId, gptTabId: msg.gptTabId })
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: e?.message || String(e) }));
    return true;
  }

  if (msg.type === 'GPT_ALLOW_AUTO_CLICKED') {
    notifyGptPageStatus({
      taskId: gptPageWatchJob?.taskId,
      tabId: sender?.tab?.id,
      totalAllowClicks: msg.clicked || (msg.allowClicked ? 1 : 0),
      allowClicked: Boolean(msg.allowClicked || msg.clicked),
      clickedLabel: msg.clickedLabel || msg.labels?.[0],
      allowButtonCount: msg.allowButtonCount,
      hasApprovalDialog: msg.hasApprovalDialog,
      hasGetTaskContext: msg.hasGetTaskContext,
      hasSubmitTaskPackage: msg.hasSubmitTaskPackage,
      taskSaved: msg.taskSaved,
      thinking: msg.thinking,
      stoppedThinking: msg.stoppedThinking,
      snippet: msg.snippet,
      source: 'content_auto_watch',
    });
    sendResponse({ ok: true });
    return false;
  }

  if (msg.type === 'STOP_GPT_APPROVAL_WATCH') {
    stopGptApprovalWatcher();
    sendResponse({ ok: true });
    return false;
  }

  if (msg.type === 'ENSURE_CUSTOM_GPT_TAB' || msg.type === 'PREWARM_CUSTOM_GPT_TAB') {
    (async () => {
      try {
        const worker = self.__qtsGptWorkerHandoff;
        if (!worker?.ensurePinnedGptTab) {
          throw new Error('GPT worker handoff module not loaded.');
        }
        const background = msg.type === 'PREWARM_CUSTOM_GPT_TAB' || msg.background !== false;
        const result = await worker.ensurePinnedGptTab({
          storageKey: GPT_TAB_STORAGE_KEY,
          focus: !background,
          preparePage: true,
          pinInBrowser: true,
        });
        sendResponse({ ...result, prewarmed: background });
      } catch (e) {
        sendResponse({ ok: false, error: e.message || 'Could not open Custom GPT tab.' });
      }
    })().catch((e) => sendResponse({ ok: false, error: e.message || 'Could not open Custom GPT tab.' }));
    return true;
  }

  if (msg.type === 'GET_PINNED_GPT_TAB') {
    (async () => {
      const tabId = await getPinnedGptTabId();
      sendResponse({ ok: true, tabId });
    })().catch(() => sendResponse({ ok: false, tabId: null }));
    return true;
  }
});

chrome.runtime.onStartup.addListener(() => {
  prefetchWorkspaceIfStale().catch(() => {});
});

let authTokenPrefetchTimer = null;

const AUTO_APPLY_ENABLED_KEY = 'qtsAutoApplyEnabled';

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.authToken) {
    if (!changes.authToken.newValue) {
      disarmJobPageActivity();
      return;
    }
    if (authTokenPrefetchTimer) clearTimeout(authTokenPrefetchTimer);
    authTokenPrefetchTimer = setTimeout(() => {
      authTokenPrefetchTimer = null;
      prefetchWorkspace(true).catch(() => {});
    }, 400);
    return;
  }
  if (area === 'local' && changes[AUTO_APPLY_ENABLED_KEY] && !changes[AUTO_APPLY_ENABLED_KEY].newValue) {
    disarmJobPageActivity();
  }
});

chrome.runtime.onInstalled.addListener(() => {
  self.__qtsCustomGpt?.loadCustomGptConfigFromStorage?.().catch(() => {});
  prefetchWorkspaceIfStale().catch(() => {});
});

self.__qtsCustomGpt?.loadCustomGptConfigFromStorage?.().catch(() => {});

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const tab = await getTab(activeInfo.tabId);
  const onPinnedGpt = await isPinnedGptTab(activeInfo.tabId);
  if (tab?.url && !onPinnedGpt && (await isAutoApplyArmed())) {
    maybeDetectApplyMethodOnOpen(activeInfo.tabId, tab.url);
    runDetectForActiveTab(activeInfo.tabId).catch(() => {});
    prefetchTabContext(activeInfo.tabId).catch(() => {});
  }
  if (captureWindowId === null) return;
  if (onPinnedGpt) return;
  lastSourceTabId = activeInfo.tabId;
  chrome.runtime.sendMessage({ type: 'SET_SOURCE_TAB', tabId: activeInfo.tabId }).catch(() => {});
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'loading') {
    lastAutoOpenKeyByTab.delete(tabId);
    lastAutoPipelineKeyByTab.delete(tabId);
    lastApplyMethodDetectKeyByTab.delete(tabId);
    clearDetectSuccessToastsForTab(tabId);
    return;
  }

  const url = changeInfo.url || tab.url;
  if (!url || !isExtractablePageUrl(url)) return;
  if (changeInfo.status === 'complete' || changeInfo.url) {
    (async () => {
      if (!(await isAutoApplyArmed())) return;
      maybeDetectApplyMethodOnOpen(tabId, url);
      maybeTrackAutoOpen(tabId, url);
    })().catch(() => {});
  }
});

chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId !== 0) return;
  if (!isExtractablePageUrl(details.url)) return;
  if (isChatGptHostUrl(details.url)) return;
  injectedExtractorTabs.delete(details.tabId);
  maybePrewarmCustomGptOnJobPage(details.url);
  (async () => {
    if (!(await isAutoApplyArmed())) return;
    injectExtractors(details.tabId).catch(() => {});
    if (details.transitionQualifiers?.includes('reload') || details.transitionType === 'reload') {
      lastAutoOpenKeyByTab.delete(details.tabId);
      lastApplyMethodDetectKeyByTab.delete(details.tabId);
      clearDetectSuccessToastsForTab(details.tabId);
      maybeTrackAutoOpen(details.tabId, details.url);
    }
    maybeDetectApplyMethodOnOpen(details.tabId, details.url);
  })().catch(() => {});
});

chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
  if (details.frameId !== 0) return;
  if (!isExtractablePageUrl(details.url)) return;
  (async () => {
    if (!(await isAutoApplyArmed())) return;
    maybeDetectApplyMethodOnOpen(details.tabId, details.url);
    maybeTrackAutoOpen(details.tabId, details.url);
  })().catch(() => {});
});

chrome.tabs.onRemoved.addListener((tabId) => {
  lastAutoOpenKeyByTab.delete(tabId);
  lastAutoPipelineKeyByTab.delete(tabId);
  lastApplyMethodDetectKeyByTab.delete(tabId);
  clearDetectSuccessToastsForTab(tabId);
  autoPipelineInFlight.delete(tabId);
  injectedExtractorTabs.delete(tabId);
  extractorInjectInFlight.delete(tabId);
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
      'chatgpt.com',
      'chat.openai.com',
    ]);
    return ignored.has(host);
  } catch {
    return false;
  }
}

async function maybeOpenCaptureWindow(tabId, url) {
  if (!isExtractablePageUrl(url) || isIgnoredSite(url)) return;

  const prefs = await chrome.storage.local.get(['autoOpenPopup']);
  if (prefs.autoOpenPopup === false) return;
  if (!(await isAutoApplyArmed())) return;

  await openCaptureWindow(tabId, { focus: false });
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

async function focusCaptureWindow(tabId, options = {}) {
  if (captureWindowId === null) return false;
  const shouldFocus = options.focus === true;
  const height = await getCaptureWindowHeight(tabId);

  try {
    const existing = await chrome.windows.get(captureWindowId, { populate: true });
    if (!existing) {
      captureWindowId = null;
      return false;
    }

    const popupTab = existing.tabs?.[0];
    if (popupTab?.id) {
      const nextUrl = captureWindowUrl(tabId);
      const currentUrl = popupTab.url || popupTab.pendingUrl || '';
      if (!currentUrl.includes(`tabId=${tabId}`)) {
        await chrome.tabs.update(popupTab.id, { url: nextUrl });
      }
    }

    await chrome.windows.update(captureWindowId, {
      focused: shouldFocus,
      drawAttention: shouldFocus,
      width: CAPTURE_WINDOW_WIDTH,
      height,
      state: 'normal',
    });
    lastSourceTabId = tabId;
    return true;
  } catch {
    captureWindowId = null;
  }

  return false;
}

async function openCaptureWindow(tabId, options = {}) {
  const jobTabId = await resolveJobTabIdForCapture(tabId);
  if (!jobTabId) {
    console.warn('[QTS_Startup] No job tab available for capture window.');
    return;
  }

  const shouldFocus = options.focus === true;

  if (await isAutoApplyArmed()) {
    runDetectForActiveTab(jobTabId).catch(() => {});
    prefetchTabContext(jobTabId).catch(() => {});
  }

  if (captureWindowId !== null) {
    try {
      await chrome.windows.get(captureWindowId);
    } catch {
      captureWindowId = null;
    }
  }

  if (await focusCaptureWindow(jobTabId, { focus: shouldFocus })) {
    lastSourceTabId = jobTabId;
    await chrome.storage.local.set({ [JOB_SOURCE_TAB_STORAGE_KEY]: jobTabId });
    if (!shouldFocus) {
      await focusBrowserWindowForTab(jobTabId);
    }
    return;
  }

  lastSourceTabId = jobTabId;
  await chrome.storage.local.set({ [JOB_SOURCE_TAB_STORAGE_KEY]: jobTabId });
  const placement = await captureWindowPlacement(jobTabId);
  const height = await getCaptureWindowHeight(jobTabId);
  const win = await chrome.windows.create({
    url: captureWindowUrl(jobTabId),
    type: 'popup',
    width: CAPTURE_WINDOW_WIDTH,
    height,
    focused: shouldFocus,
    state: 'normal',
    ...placement,
  });

  captureWindowId = win.id;
  if (shouldFocus) {
    await chrome.windows.update(captureWindowId, { focused: true, drawAttention: true });
  } else {
    await focusBrowserWindowForTab(jobTabId);
  }
}
