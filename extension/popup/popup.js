// popup.js — capture window UI logic

const global = globalThis;

let candidates = [];
let candidateStatuses = {};
let candidateAppliedAt = {};
let candidateLocked = {};
let existingJobId = null;
let currentTabUrl = '';
let currentSource = '';
let targetTabId = null;
let jobSavedInBackend = false;
let currentUser = null;
let candidateStacks = [];
const expandedCandidateIds = new Set();
let activeApplicationId = null;
let activeTaskId = null;
let detectedApplyTemplate = null;
let gptPipelineRunning = false;
let lastGptTaskStatus = null;
let gptDispatchSent = false;
let gptAppliedToForm = false;
let lastDevCapture = null;
let gptHandoffInProgress = false;
const gptDispatchWaiters = new Map();
let defaultCandidateId = null;
let filterCandidatesTimer = null;
let lastWorkspaceFetchAt = 0;

const CANDIDATE_CACHE_TTL_MS = 5 * 60 * 1000;
const WORKSPACE_BACKGROUND_REFRESH_MIN_MS = 45 * 1000;
const CANDIDATE_CACHE_KEY = 'qtsCandidateCache';
const SESSION_USER_KEY = 'qtsSessionUser';
const DEFAULT_CANDIDATE_KEY = 'qtsDefaultCandidateByBidder';
const AUTO_APPLY_ENABLED_KEY = 'qtsAutoApplyEnabled';

async function hydrateApplySessionStore() {
  const store = global.__qtsApplySessionStore;
  if (!store?.hydrate) return;
  await store.hydrate();
  const active = store.getActive();
  if (!active) return;
  if (active.applicationId != null) activeApplicationId = active.applicationId;
  if (active.taskId != null) activeTaskId = active.taskId;
}

async function persistActiveApplySession(patch) {
  const store = global.__qtsApplySessionStore;
  if (!store?.setActive) return null;
  const active = await store.setActive(patch);
  if (active?.applicationId != null) activeApplicationId = active.applicationId;
  if (active?.taskId != null) activeTaskId = active.taskId;
  return active;
}

let loadingCount = 0;

function showLoading(message = 'Loading…') {
  loadingCount += 1;
  const overlay = document.getElementById('loading-overlay');
  const text = document.getElementById('loading-text');
  if (text) text.textContent = message;
  if (overlay) {
    overlay.classList.add('is-visible');
    overlay.setAttribute('aria-busy', 'true');
  }
}

function hideLoading(force = false) {
  if (force) loadingCount = 0;
  else loadingCount = Math.max(0, loadingCount - 1);
  if (loadingCount > 0) return;

  const overlay = document.getElementById('loading-overlay');
  if (!overlay) return;
  overlay.classList.remove('is-visible');
  overlay.setAttribute('aria-busy', 'false');
}

async function withLoading(task, message = 'Loading…') {
  showLoading(message);
  try {
    return await task();
  } finally {
    hideLoading();
  }
}

const POPUP_WINDOW_WIDTH = 660;
const POPUP_WINDOW_HEIGHT_RATIO = 0.8;
const POPUP_WINDOW_MIN_HEIGHT = 480;

function getTargetWindowHeight() {
  const screenH = window.screen?.availHeight || window.screen?.height || 900;
  return Math.max(POPUP_WINDOW_MIN_HEIGHT, Math.round(screenH * POPUP_WINDOW_HEIGHT_RATIO));
}

function applyPopupScrollArea(windowHeight) {
  const scroll = document.querySelector('.popup-scroll');
  if (!scroll) return;
  const top = document.querySelector('.popup-top')?.offsetHeight || 0;
  const actionBar = document.getElementById('action-bar');
  const actions = actionBar?.classList.contains('hidden') ? 0 : (actionBar?.offsetHeight || 0);
  scroll.style.maxHeight = `${Math.max(120, windowHeight - top - actions - 8)}px`;
}

function fitPopupWindow() {
  if (!chrome.windows?.getCurrent) return;
  const height = getTargetWindowHeight();
  applyPopupScrollArea(height);
  chrome.windows.getCurrent((win) => {
    if (!win?.id || win.type !== 'popup') return;
    chrome.windows.update(win.id, {
      width: POPUP_WINDOW_WIDTH,
      height,
    });
  });
}

let fitPopupQueued = false;
function scheduleFitPopup() {
  if (fitPopupQueued) return;
  fitPopupQueued = true;
  requestAnimationFrame(() => {
    fitPopupQueued = false;
    fitPopupWindow();
  });
}

function getQueryTabId() {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get('tabId');
  if (!raw) return null;
  const tabId = parseInt(raw, 10);
  return Number.isFinite(tabId) ? tabId : null;
}

function settleGptDispatchWaiter(msg) {
  const taskId = msg?.taskId;
  if (!taskId) return false;
  const waiter = gptDispatchWaiters.get(taskId);
  if (!waiter) return false;
  clearTimeout(waiter.timer);
  gptDispatchWaiters.delete(taskId);
  if (msg.ok && msg.handoff?.sent !== false) {
    waiter.resolve(msg);
  } else {
    waiter.reject(new Error(msg.handoff?.error || msg.error || 'GPT handoff failed.'));
  }
  return true;
}

function waitForGptDispatchFinished(taskId, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      gptDispatchWaiters.delete(taskId);
      reject(new Error('Timed out waiting for Custom GPT handoff. Check the GPT tab or click Send PROCESS_TASK.'));
    }, timeoutMs);
    gptDispatchWaiters.set(taskId, { resolve, reject, timer });
  });
}

function sendGptTaskViaPort({ taskId, jobTabId, applicationId, pollAndApply, timeoutMs = 120000 }) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let port = null;

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      chrome.runtime.onMessage.removeListener(onBroadcast);
      try {
        port?.disconnect();
      } catch {
        // ignore
      }
      fn(value);
    };

    const onBroadcast = (msg) => {
      if (msg?.type !== 'GPT_DISPATCH_FINISHED') return;
      if (msg.taskId && taskId && msg.taskId !== taskId) return;
      if (msg.ok && msg.handoff?.sent !== false) {
        finish(resolve, msg);
        return;
      }
      finish(reject, new Error(msg.handoff?.error || msg.error || 'GPT handoff failed.'));
    };

    const timer = setTimeout(() => {
      finish(reject, new Error('Timed out waiting for Custom GPT handoff.'));
    }, timeoutMs);

    chrome.runtime.onMessage.addListener(onBroadcast);

    try {
      port = chrome.runtime.connect({ name: 'qts-gpt-handoff' });
    } catch (connectErr) {
      finish(reject, connectErr);
      return;
    }

    port.onMessage.addListener((msg) => {
      if (msg?.type !== 'GPT_HANDOFF_RESULT') return;
      if (msg.taskId && taskId && msg.taskId !== taskId) return;
      if (msg.ok && msg.handoff?.sent !== false) {
        finish(resolve, msg);
        return;
      }
      finish(reject, new Error(msg.handoff?.error || msg.error || 'GPT handoff failed.'));
    });

    port.onDisconnect.addListener(() => {
      if (settled) return;
      const errText = chrome.runtime.lastError?.message;
      if (errText) {
        finish(reject, new Error(errText));
      }
    });

    port.postMessage({
      type: 'SEND_GPT_TASK',
      taskId,
      jobTabId,
      applicationId,
      pollAndApply,
    });
  });
}

async function sendGptTaskToBackground({ taskId, jobTabId, applicationId, pollAndApply }) {
  const dispatchWaiter = waitForGptDispatchFinished(taskId);
  try {
    const startRes = await chrome.runtime.sendMessage({
      type: 'SEND_GPT_TASK',
      taskId,
      jobTabId,
      applicationId,
      pollAndApply,
      async: true,
    });
    if (!startRes?.started && !startRes?.ok) {
      throw new Error(startRes?.error || 'Could not start GPT handoff.');
    }
    return dispatchWaiter;
  } catch (messageErr) {
    try {
      return await sendGptTaskViaPort({ taskId, jobTabId, applicationId, pollAndApply });
    } catch (portErr) {
      throw new Error(portErr?.message || messageErr?.message || 'Could not start GPT handoff.');
    }
  }
}

async function resolveTargetTabOnLoad() {
  const fromQuery = getQueryTabId();
  if (fromQuery) return fromQuery;

  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'GET_CURRENT_TAB_URL' }, (res) => {
      if (chrome.runtime.lastError) {
        resolve(null);
        return;
      }
      const tabId = res?.tabId;
      const url = res?.url || '';
      if (!tabId || !url) {
        resolve(null);
        return;
      }
      if (url.includes('chatgpt.com') || url.startsWith('chrome://') || url.startsWith('chrome-extension://')) {
        resolve(null);
        return;
      }
      resolve(tabId);
    });
  });
}

// ---- Init ----
function applyGptDispatchResult(msg) {
  const handoff = msg.handoff || {};
  if (!msg.ok) {
    const detail = handoff.error || msg.error || 'Could not send PROCESS_TASK to Custom GPT.';
    setGptPipelineState('error', detail);
    showAlert('main-alert', detail, 'error');
    return { ok: false, error: detail };
  }
  if (!handoff.sent) {
    const prompt = window.__qtsCustomGpt?.buildPrompt?.(msg.taskId || activeTaskId);
    if (prompt) copyTextToClipboard(prompt);
    const detail = handoff.error || 'Could not send PROCESS_TASK automatically.';
    setGptPipelineState('waiting', 'GPT handoff failed — click GPT task to copy PROCESS_TASK, paste in Custom GPT tab.');
    showAlert('main-alert', `GPT auto-send failed: ${detail}. Copy PROCESS_TASK from GPT task button and paste manually.`, 'warn');
    updateCustomGptButton();
    return { ok: false, error: detail };
  } else {
    setGptPipelineState('waiting', 'Waiting for Custom GPT. Extension is clicking Allow automatically.');
    showAlert('main-alert', 'PROCESS_TASK sent. Extension will click Allow and monitor GPT Actions.', 'success');
  }
  updateCustomGptButton();
  return { ok: true, handoff };
}

document.addEventListener('DOMContentLoaded', async () => {
  const logoEl = document.getElementById('header-logo');
  if (logoEl) logoEl.src = chrome.runtime.getURL('assets/bidder-logo.png');
  targetTabId = getQueryTabId() || await resolveTargetTabOnLoad();
  if (targetTabId) {
    await chrome.storage.local.set({ qtsJobSourceTabId: targetTabId });
    chrome.runtime.sendMessage({ type: 'REGISTER_JOB_TAB', tabId: targetTabId }).catch(() => {});
  }
  try {
    await window.api.ensureServerUrl();
    await bootstrapPopupFast();
    checkConnection().catch(() => {});
  } catch {
    hideLoading(true);
    await showLogin();
  }

  document.getElementById('login-pass').addEventListener('keyup', e => { if (e.key === 'Enter') doLogin(); });
  document.getElementById('login-user').addEventListener('keyup', e => { if (e.key === 'Enter') doLogin(); });
  document.getElementById('login-default-candidate')?.addEventListener('keyup', (e) => {
    if (e.key === 'Enter') {
      startAutoApplyFromLoginStep().catch((err) => {
        showAlert('login-alert', err?.message || 'Could not start auto-apply.', 'error');
      });
    }
  });
  document.getElementById('btn-login').addEventListener('click', doLogin);
  document.getElementById('btn-start-auto-apply')?.addEventListener('click', () => {
    startAutoApplyFromLoginStep().catch((e) => {
      showAlert('login-alert', e?.message || 'Could not start auto-apply.', 'error');
    });
  });
  document.getElementById('btn-setup-not-now')?.addEventListener('click', () => {
    dismissSetupWithoutAutoApply().catch((e) => {
      showAlert('login-alert', e?.message || 'Could not save setup.', 'error');
    });
  });
  document.getElementById('login-default-candidate')?.addEventListener('change', (event) => {
    const nextId = parseInt(event.target.value, 10);
    if (Number.isFinite(nextId)) expandedCandidateIds.add(nextId);
  });
  document.getElementById('main-default-candidate')?.addEventListener('change', (event) => {
    onMainDefaultCandidateChange(event).catch((e) => {
      showAlert('main-alert', e?.message || 'Could not update default candidate.', 'error');
    });
  });
  document.getElementById('btn-start-default-candidate')?.addEventListener('click', () => {
    startApplicationWithDefault().catch((e) => {
      console.error('startApplicationWithDefault error:', e);
      showAlert('main-alert', e?.message || 'Could not start application.', 'error');
    });
  });
  document.getElementById('btn-toggle-auto-apply')?.addEventListener('click', () => {
    toggleAutoApplyFromPopup().catch((e) => {
      showAlert('main-alert', e?.message || 'Could not update auto-apply.', 'error');
    });
  });
  document.getElementById('btn-logout').addEventListener('click', doLogout);
  document.getElementById('btn-save').addEventListener('click', doSave);
  document.getElementById('btn-refresh').addEventListener('click', doRefresh);
  document.getElementById('btn-refresh-application')?.addEventListener('click', () => {
    refreshApplicationStatus().catch(() => {
      showAlert('main-alert', 'Could not refresh application session.', 'error');
    });
  });
  document.getElementById('application-session-id')?.addEventListener('click', () => {
    if (activeApplicationId) copyTextToClipboard(String(activeApplicationId));
  });
  document.getElementById('application-task-id')?.addEventListener('click', () => {
    if (activeTaskId && window.__qtsCustomGpt?.buildPrompt) {
      copyTextToClipboard(window.__qtsCustomGpt.buildPrompt(activeTaskId));
    }
  });
  document.getElementById('btn-open-custom-gpt')?.addEventListener('click', () => {
    dispatchGptTask(activeApplicationId, { pollAndApply: true }).catch((e) => {
      console.error('dispatchGptTask error:', e);
      showAlert('main-alert', e?.message || 'Could not send task to Custom GPT.', 'error');
    });
  });
  document.getElementById('btn-apply-gpt-package')?.addEventListener('click', () => {
    chrome.runtime.sendMessage({
      type: 'APPLY_GPT_PACKAGE_TO_TAB',
      applicationId: activeApplicationId,
      jobTabId: targetTabId,
    }).then((res) => {
      if (!res?.ok) {
        throw new Error(res?.error || 'Could not apply GPT package.');
      }
      gptAppliedToForm = true;
      const uploadNote = res.uploadedCount ? ` Uploaded ${res.uploadedCount} PDF(s).` : '';
      setGptPipelineState('ready', `Applied ${res.filledCount || 0} field(s) to the form.${uploadNote} Review before submit.`);
      renderGptActionSteps(lastGptTaskStatus);
      showAlert('main-alert', `Applied ${res.filledCount || 0} field(s).${uploadNote} Review the form before submitting.`, 'success');
      refreshApplicationStatus().catch(() => {});
    }).catch((e) => {
      console.error('applyGptAnswersToForm error:', e);
      showAlert('main-alert', e?.message || 'Could not apply GPT answers.', 'error');
    });
  });
  document.getElementById('btn-copy-dev-summary')?.addEventListener('click', () => {
    const el = document.getElementById('dev-capture-summary');
    if (el?.value) copyTextToClipboard(el.value);
  });
  document.getElementById('btn-copy-dev-raw')?.addEventListener('click', () => {
    const el = document.getElementById('dev-capture-raw');
    if (el?.value) copyTextToClipboard(el.value);
  });
  document.getElementById('cand-filter').addEventListener('input', () => filterCandidates());
  document.getElementById('cand-stack-filter').addEventListener('change', () => filterCandidates());
  document.getElementById('cand-list').addEventListener('change', onCandidateStatusChange);
  document.getElementById('cand-list').addEventListener('click', onCandidateCardClick);
  ['f-title', 'f-company', 'f-url'].forEach(id => {
    document.getElementById(id).addEventListener('input', updateJobSummary);
  });
  document.getElementById('f-desc').addEventListener('input', updateJobSummary);

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'AUTH_SESSION_EXPIRED') {
      clearAuthState()
        .then(() => {
          showAlert('login-alert', 'Session expired (24 hours). Please log in again.', 'warn');
          return showLogin();
        })
        .catch(() => {});
      sendResponse?.({ ok: true });
      return;
    }
    if (msg.type === 'GPT_DISPATCH_FINISHED') {
      if (settleGptDispatchWaiter(msg)) {
        sendResponse?.({ ok: true });
        return;
      }
      if (msg.taskId && activeTaskId && msg.taskId !== activeTaskId) {
        sendResponse?.({ ok: true, ignored: true });
        return;
      }
      if (gptHandoffInProgress) {
        sendResponse?.({ ok: true, ignored: true });
        return;
      }
      hideLoading(true);
      applyGptDispatchResult(msg);
      sendResponse?.({ ok: true });
      return;
    }
    if (msg.type === 'GPT_ACTION_APPROVAL_NEEDED') {
      setGptPipelineState('waiting', msg.message || 'Custom GPT Actions — auto-clicking Allow…');
      sendResponse?.({ ok: true });
      return;
    }
    if (msg.type === 'GPT_PAGE_STATUS') {
      if (msg.taskId && activeTaskId && msg.taskId !== activeTaskId) {
        sendResponse?.({ ok: true, ignored: true });
        return;
      }
      if (msg.allowClicked && msg.clickedLabel) {
        const action = msg.hasSubmitTaskPackage ? 'submitTaskPackage' : (msg.hasGetTaskContext ? 'getTaskContext' : 'GPT Action');
        setGptPipelineState('waiting', `Clicked Allow (${msg.clickedLabel}) for ${action}…`);
      } else if (msg.hasApprovalDialog && !msg.allowButtonCount) {
        setGptPipelineState('waiting', 'Approval dialog visible — searching for Allow button…');
      } else if (msg.hasApprovalDialog) {
        setGptPipelineState('waiting', 'Approval dialog visible — clicking Allow…');
      } else if (msg.thinking) {
        setGptPipelineState('waiting', 'Custom GPT is thinking…');
      } else if (msg.taskSaved) {
        setGptPipelineState('waiting', 'GPT package saved — waiting for server…');
      }
      sendResponse?.({ ok: true });
      return;
    }
    if (msg.type === 'GPT_PAGE_WATCH_FINISHED') {
      if (msg.taskId && activeTaskId && msg.taskId !== activeTaskId) {
        sendResponse?.({ ok: true, ignored: true });
        return;
      }
      if (msg.ok) {
        setGptPipelineState('waiting', `GPT Actions complete (${msg.totalAllowClicks || 0} Allow click(s)). Polling server…`);
      } else if (msg.error) {
        setGptPipelineState('error', msg.error);
      }
      sendResponse?.({ ok: true });
      return;
    }
    if (msg.type === 'GPT_APPLY_FINISHED') {
      if (msg.taskId && activeTaskId && msg.taskId !== activeTaskId) {
        sendResponse?.({ ok: true, ignored: true });
        return;
      }
      if (msg.success) {
        gptAppliedToForm = true;
        const uploadNote = msg.uploadedCount ? ` Uploaded ${msg.uploadedCount} PDF(s).` : '';
        setGptPipelineState('ready', `Applied ${msg.filledCount || 0} field(s) to the form.${uploadNote} Review before submit.`);
        renderGptActionSteps(lastGptTaskStatus);
        showAlert('main-alert', `GPT package applied to the job form.${uploadNote}`, 'success');
        refreshApplicationStatus().catch(() => {});
      } else if (msg.error) {
        setGptPipelineState('error', msg.error);
        showAlert('main-alert', msg.error, 'error');
      }
      sendResponse?.({ ok: true });
      return;
    }
    if (msg.type === 'SET_SOURCE_TAB' && msg.tabId) {
      Promise.all([
        chrome.storage.local.get(['qtsCustomGptTabId']),
        chrome.tabs.get(msg.tabId),
      ]).then(async ([stored, tab]) => {
        if (stored.qtsCustomGptTabId === msg.tabId) {
          sendResponse({ ok: false, ignored: true });
          return;
        }
        const gptId = window.__qtsCustomGpt?.CUSTOM_GPT_ID;
        const onGpt = Boolean(
          (gptId && tab?.url?.includes(gptId))
          || /qts[- ]job[- ]tracking/i.test(tab?.title || '')
        );
        if (onGpt) {
          sendResponse({ ok: false, ignored: true });
          return;
        }
        return switchSourceTab(msg.tabId)
          .then(() => sendResponse({ ok: true }))
          .catch((e) => sendResponse({ ok: false, error: e?.message || 'Failed' }));
      }).catch((e) => sendResponse({ ok: false, error: e?.message || 'Failed' }));
      return true;
    }
    if (msg.type === 'APPLY_TEMPLATE_DETECTED' && msg.tabId) {
      if (Number(msg.tabId) === Number(targetTabId)) {
        loadApplyTemplateForTab(msg.tabId)
          .then(() => sendResponse({ ok: true }))
          .catch((e) => sendResponse({ ok: false, error: e?.message || 'Failed' }));
        return true;
      }
      sendResponse({ ok: false, ignored: true });
      return false;
    }
    if (msg.type === 'JOB_DETECTED_UPDATE' && msg.tabId) {
      if (Number(msg.tabId) === Number(targetTabId)) {
        loadCurrentTab({ preferCache: true, allowExtract: false })
          .then(() => sendResponse({ ok: true }))
          .catch((e) => sendResponse({ ok: false, error: e?.message || 'Failed' }));
        return true;
      }
      sendResponse({ ok: false, ignored: true });
      return false;
    }
  });
});

async function bootstrapPopupFast() {
  const hydrated = await global.__qtsBidderAuth?.hydratePopupAuth?.();
  if (!hydrated) {
    hideLoading(true);
    await showLogin();
    return;
  }

  const token = await getStoredToken();
  if (!token) {
    hideLoading(true);
    await showLogin();
    return;
  }

  await hydrateApplySessionStore();

  const sessionUser = await readSessionUser();
  if (!sessionUser || !isBidderSession(sessionUser)) {
    await clearAuthState();
    hideLoading(true);
    await showLogin();
    return;
  }

  const cache = await readCandidateCache();
  if (Array.isArray(cache?.candidates) && cache.candidates.length) {
    applyCandidatesData(cache.candidates, cache.stacks || []);
  }
  defaultCandidateId = await readDefaultCandidateId(sessionUser.bidderId);
  if (await needsDefaultCandidateSelection(sessionUser)) {
    hideLoading(true);
    await showDefaultCandidateStep(sessionUser);
    return;
  }
  if (!(await readAutoApplyEnabled())) {
    hideLoading(true);
    setSession(sessionUser);
    showJobSection();
    await loadCurrentTab({ preferCache: true, allowExtract: false });
    updateJobSummary();
    updateDefaultCandidateUi();
    updateAutoApplyBarUi();
    scheduleFitPopup();
    refreshWorkspaceInBackground();
    return;
  }
  await global.__qtsBidderAuth?.armWorkerAuth?.();
  setSession(sessionUser);
  showJobSection();
  hideLoading(true);
  updateAutoApplyBarUi();
  await loadCurrentTab({ preferCache: true, allowExtract: false });
  updateJobSummary();
  updateDefaultCandidateUi();
  scheduleFitPopup();
  refreshWorkspaceInBackground();
}

async function refreshWorkspaceInBackground() {
  try {
    const cached = await readCandidateCache();
    if (cached?.savedAt && Date.now() - cached.savedAt < WORKSPACE_BACKGROUND_REFRESH_MIN_MS) {
      return;
    }
    const workspace = await fetchWorkspaceData(true);
    if (workspace?.success && workspace.user) {
      defaultCandidateId = await readDefaultCandidateId(workspace.user.bidderId);
      renderCandidates();
      updateJobSummary();
      updateDefaultCandidateUi();
    }
  } catch { /* non-fatal */ }
}

async function verifySavedJobOnServer(urls, { silent = false } = {}) {
  const saved = await findSavedJobByUrls(urls, { skipCache: true, showSpinner: true });
  if (!saved) return false;

  const currentUrl = document.getElementById('f-url')?.value?.trim() || currentTabUrl;
  const savedUrl = saved.url || '';
  if (currentUrl && savedUrl && prefetchSavedJobKey(currentUrl) !== prefetchSavedJobKey(savedUrl)) {
    return false;
  }

  loadExistingJob(saved, { silent });
  renderCandidates();
  updateJobSummary();
  scheduleFitPopup();
  return true;
}

// ---- Connection ----
async function checkConnection() {
  setStatus('checking');
  try {
    const r = await window.api.health();
    setStatus(r.success ? 'connected' : 'disconnected');
  } catch {
    setStatus('disconnected');
  }
}

function setStatus(state) {
  const el = document.getElementById('connection-status');
  const txt = document.getElementById('status-text');
  el.className = `status-pill status-${state}`;
  txt.textContent = state === 'connected' ? 'Connected' : state === 'checking' ? 'Checking…' : 'Disconnected';
}

// ---- Auth ----
function isBidderSession(user) {
  if (!user || user.role !== 'bidder') return false;
  const bidderId = Number(user.bidderId);
  return Number.isFinite(bidderId) && bidderId > 0;
}

function normalizeCandidateRecord(candidate) {
  if (!candidate) return null;
  const id = Number(candidate.id);
  if (!Number.isFinite(id)) return null;
  const rawActive = candidate.is_active ?? candidate.isActive;
  const isActive = rawActive !== false && rawActive !== 0 && rawActive !== 'f' && rawActive !== 'false';
  return { ...candidate, id, is_active: isActive };
}

function normalizeCandidateList(list) {
  return (list || [])
    .map(normalizeCandidateRecord)
    .filter((candidate) => candidate && candidate.is_active !== false);
}

function getBidderIdFromUser(user) {
  const bidderId = Number(user?.bidderId);
  return Number.isFinite(bidderId) && bidderId > 0 ? bidderId : null;
}

async function readDefaultCandidateMap() {
  const stored = await new Promise((resolve) => {
    chrome.storage.local.get([DEFAULT_CANDIDATE_KEY], (result) => resolve(result[DEFAULT_CANDIDATE_KEY] || {}));
  });
  return stored && typeof stored === 'object' ? stored : {};
}

async function readDefaultCandidateId(bidderId) {
  const id = getBidderIdFromUser({ bidderId });
  if (!id) return null;
  const map = await readDefaultCandidateMap();
  const candidateId = Number(map[String(id)]);
  return Number.isFinite(candidateId) ? candidateId : null;
}

async function storeDefaultCandidateId(bidderId, candidateId) {
  const id = getBidderIdFromUser({ bidderId });
  if (!id) throw new Error('Missing bidder account.');
  const numericCandidateId = Number(candidateId);
  if (!Number.isFinite(numericCandidateId)) throw new Error('Select a candidate.');
  const map = await readDefaultCandidateMap();
  map[String(id)] = numericCandidateId;
  await new Promise((resolve) => {
    chrome.storage.local.set({ [DEFAULT_CANDIDATE_KEY]: map }, resolve);
  });
  defaultCandidateId = numericCandidateId;
}

async function readAutoApplyEnabled() {
  const stored = await chrome.storage.local.get([AUTO_APPLY_ENABLED_KEY]);
  return stored[AUTO_APPLY_ENABLED_KEY] === true;
}

async function setAutoApplyEnabled(enabled) {
  await new Promise((resolve) => {
    chrome.storage.local.set({ [AUTO_APPLY_ENABLED_KEY]: Boolean(enabled) }, resolve);
  });
  if (enabled) {
    await global.__qtsBidderAuth?.armWorkerAuth?.();
  } else {
    await global.__qtsBidderAuth?.disarmWorkerAuth?.();
    chrome.runtime.sendMessage({ type: 'RESET_AUTO_PIPELINE_STATE' }).catch(() => {});
  }
  updateAutoApplyBarUi();
}

function getDefaultCandidate() {
  if (!defaultCandidateId) return null;
  return candidates.find((c) => Number(c.id) === Number(defaultCandidateId)) || null;
}

function isValidDefaultCandidateId(candidateId) {
  const id = Number(candidateId);
  if (!Number.isFinite(id)) return false;
  const candidate = candidates.find((c) => Number(c.id) === id);
  return Boolean(candidate && candidate.is_active !== false);
}

async function needsDefaultCandidateSelection(user) {
  const bidderId = getBidderIdFromUser(user);
  if (!bidderId) return false;
  const savedId = await readDefaultCandidateId(bidderId);
  if (!savedId) return true;
  if (!candidates.length) {
    defaultCandidateId = savedId;
    return false;
  }
  return !isValidDefaultCandidateId(savedId);
}

function populateDefaultCandidateSelect(selectEl, { includePlaceholder = true } = {}) {
  if (!selectEl) return;
  const previous = selectEl.value;
  const options = [];
  if (includePlaceholder) {
    options.push('<option value="">— Select candidate —</option>');
  } else {
    options.push('<option value="">Default…</option>');
  }
  candidates.forEach((candidate) => {
    const label = `${candidate.name}${candidate.stack ? ` (${candidate.stack})` : ''}`;
    options.push(`<option value="${candidate.id}">${escHtml(label)}</option>`);
  });
  selectEl.innerHTML = options.join('');
  if (previous && [...selectEl.options].some((opt) => opt.value === previous)) {
    selectEl.value = previous;
  } else if (defaultCandidateId) {
    selectEl.value = String(defaultCandidateId);
  }
}

function resetLoginFormView() {
  document.getElementById('login-form')?.classList.remove('hidden');
  document.getElementById('login-candidate-step')?.classList.add('hidden');
  const signedInEl = document.getElementById('login-signed-in-as');
  if (signedInEl) signedInEl.textContent = '';
}

async function showDefaultCandidateStep(user, { armOnly = false } = {}) {
  setSession(user);
  document.getElementById('login-section')?.classList.remove('hidden');
  document.getElementById('job-section')?.classList.add('hidden');
  document.getElementById('action-bar')?.classList.add('hidden');
  document.getElementById('login-form')?.classList.add('hidden');
  document.getElementById('login-candidate-step')?.classList.remove('hidden');

  const signedInEl = document.getElementById('login-signed-in-as');
  if (signedInEl) {
    const label = (user?.username || user?.bidderName || 'Bidder').trim();
    signedInEl.textContent = armOnly
      ? `Signed in as ${label} — press Start when you are ready to apply on job pages`
      : `Signed in as ${label}`;
  }

  if (!candidates.length) {
    showLoading('Loading candidates…');
    try {
      await fetchWorkspaceData(true);
    } finally {
      hideLoading(true);
    }
  }

  defaultCandidateId = await readDefaultCandidateId(user?.bidderId);
  const select = document.getElementById('login-default-candidate');
  populateDefaultCandidateSelect(select, { includePlaceholder: true });
  if (defaultCandidateId && isValidDefaultCandidateId(defaultCandidateId)) {
    select.value = String(defaultCandidateId);
  } else if (candidates.length === 1) {
    select.value = String(candidates[0].id);
  }

  clearAlert('login-alert');
  scheduleFitPopup();
}

function readSelectedDefaultCandidateId() {
  const select = document.getElementById('login-default-candidate');
  const candidateId = parseInt(select?.value, 10);
  if (!Number.isFinite(candidateId) || !isValidDefaultCandidateId(candidateId)) {
    throw new Error('Choose a default candidate first.');
  }
  return candidateId;
}

async function armAutoApplyOnCurrentJobTab() {
  const tabId = targetTabId || await resolveTargetTabOnLoad();
  if (!tabId) {
    throw new Error('Open a job page in your browser first.');
  }
  await chrome.storage.local.set({ qtsJobSourceTabId: tabId });
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: 'START_AUTO_APPLY_ON_TAB', jobTabId: tabId }, (res) => {
      if (chrome.runtime.lastError) {
        resolve(tabId);
        return;
      }
      if (res?.ok === false) {
        reject(new Error(res.error || 'Could not start auto-apply on the job page.'));
        return;
      }
      resolve(tabId);
    });
  });
}

async function startAutoApplyFromLoginStep() {
  const user = currentUser || await readSessionUser();
  if (!user || !isBidderSession(user)) {
    throw new Error('Sign in first.');
  }
  const candidateId = readSelectedDefaultCandidateId();
  await storeDefaultCandidateId(user.bidderId, candidateId);
  await setAutoApplyEnabled(true);
  expandedCandidateIds.add(candidateId);
  resetLoginFormView();
  await armAutoApplyOnCurrentJobTab();
}

async function dismissSetupWithoutAutoApply() {
  const user = currentUser || await readSessionUser();
  if (!user || !isBidderSession(user)) {
    throw new Error('Sign in first.');
  }
  const select = document.getElementById('login-default-candidate');
  const candidateId = parseInt(select?.value, 10);
  if (Number.isFinite(candidateId) && isValidDefaultCandidateId(candidateId)) {
    await storeDefaultCandidateId(user.bidderId, candidateId);
  }
  await setAutoApplyEnabled(false);
  resetLoginFormView();
  showToast('Auto-apply is off. Job pages will not run until you press Start.', 'info');
  await enterJobWorkspace(user, { skipBackgroundRefresh: false });
  chrome.runtime.sendMessage({
    type: 'DISMISS_CAPTURE_WINDOW',
    jobTabId: targetTabId,
  }).catch(() => {});
}

async function toggleAutoApplyFromPopup() {
  const user = currentUser || await readSessionUser();
  if (!user || !isBidderSession(user)) {
    throw new Error('Sign in first.');
  }
  if (!(await readAutoApplyEnabled())) {
    const select = document.getElementById('main-default-candidate');
    const fromMain = parseInt(select?.value, 10);
    if (Number.isFinite(fromMain) && isValidDefaultCandidateId(fromMain)) {
      await storeDefaultCandidateId(user.bidderId, fromMain);
    }
    if (!defaultCandidateId || !isValidDefaultCandidateId(defaultCandidateId)) {
      await showDefaultCandidateStep(user);
      throw new Error('Choose a default candidate, then press Start applying on job pages.');
    }
    await setAutoApplyEnabled(true);
    await armAutoApplyOnCurrentJobTab();
    return;
  }
  await setAutoApplyEnabled(false);
  chrome.runtime.sendMessage({ type: 'RESET_AUTO_PIPELINE_STATE' }).catch(() => {});
  showToast('Auto-apply stopped. Job pages will not run until you press Start again.', 'info');
}

function updateAutoApplyBarUi() {
  const bar = document.getElementById('auto-apply-bar');
  const statusEl = document.getElementById('auto-apply-status');
  const toggleBtn = document.getElementById('btn-toggle-auto-apply');
  if (!bar || !statusEl || !toggleBtn) return;

  readAutoApplyEnabled().then((enabled) => {
    bar.classList.remove('hidden');
    bar.classList.toggle('is-active', enabled);
    const def = getDefaultCandidate();
    if (enabled) {
      statusEl.textContent = def
        ? `Auto-apply: on (${def.name})`
        : 'Auto-apply: on';
      toggleBtn.textContent = 'Stop on job pages';
      toggleBtn.className = 'btn btn-ghost btn-sm';
    } else {
      statusEl.textContent = def
        ? `Auto-apply: off — default ${def.name}`
        : 'Auto-apply: off';
      toggleBtn.textContent = 'Start on job pages';
      toggleBtn.className = 'btn btn-primary btn-sm';
    }
  }).catch(() => {});
}

async function onMainDefaultCandidateChange(event) {
  const user = currentUser;
  if (!user || !isBidderSession(user)) return;
  const candidateId = parseInt(event.target.value, 10);
  if (!Number.isFinite(candidateId)) return;
  if (!isValidDefaultCandidateId(candidateId)) {
    event.target.value = defaultCandidateId ? String(defaultCandidateId) : '';
    throw new Error('That candidate is not available.');
  }
  await storeDefaultCandidateId(user.bidderId, candidateId);
  expandedCandidateIds.add(candidateId);
  renderCandidates();
  updateDefaultCandidateUi();
  showToast(`Default candidate: ${getDefaultCandidate()?.name || 'updated'}`, 'success');
}

function updateDefaultCandidateUi() {
  const quickBtn = document.getElementById('btn-start-default-candidate');
  const mainSelect = document.getElementById('main-default-candidate');
  const def = getDefaultCandidate();

  if (mainSelect) {
    if (candidates.length) {
      mainSelect.classList.remove('hidden');
      populateDefaultCandidateSelect(mainSelect, { includePlaceholder: false });
      mainSelect.value = defaultCandidateId ? String(defaultCandidateId) : '';
    } else {
      mainSelect.classList.add('hidden');
    }
  }

  if (quickBtn) {
    if (def && !isCandidateLocked(def.id)) {
      quickBtn.classList.remove('hidden');
      quickBtn.textContent = `Start Application (${def.name})`;
    } else {
      quickBtn.classList.add('hidden');
    }
  }
}

async function startApplicationWithDefault() {
  const def = getDefaultCandidate();
  if (!def) {
    throw new Error('Choose a default candidate on the login screen or from the Candidates dropdown.');
  }
  if (isCandidateLocked(def.id)) {
    throw new Error(`${def.name} is already marked applied for this job.`);
  }
  await startApplication(def.id);
}

async function ensureWorkspaceReady(user) {
  if (!user || !isBidderSession(user)) return false;
  if (await needsDefaultCandidateSelection(user)) {
    await showDefaultCandidateStep(user);
    return false;
  }
  defaultCandidateId = await readDefaultCandidateId(user.bidderId);
  updateAutoApplyBarUi();
  return true;
}

function setSession(user) {
  currentUser = user;
  const bar = document.getElementById('session-bar');
  const orgEl = document.getElementById('session-bidder');
  const userEl = document.getElementById('session-user');
  if (!user || !bar || !orgEl || !userEl) return;

  const orgLabel = (user.bidderName || `Organization #${user.bidderId}`).trim();
  const username = (user.username || '—').trim();
  const showBoth = orgLabel.toLowerCase() !== username.toLowerCase();

  if (showBoth) {
    orgEl.textContent = orgLabel;
    userEl.textContent = username;
    userEl.classList.remove('hidden');
  } else {
    orgEl.textContent = username;
    userEl.textContent = '';
    userEl.classList.add('hidden');
  }

  bar.classList.remove('hidden');
}

function clearSession() {
  currentUser = null;
  defaultCandidateId = null;
  const bar = document.getElementById('session-bar');
  if (bar) bar.classList.add('hidden');
}

async function doLogout() {
  try {
    await window.api.logout();
  } catch { /* non-fatal */ }
  await clearAuthState();
  await showLogin();
}

async function prepareLoginForm() {
  try {
    const status = await window.api.extensionStatus();
    const hint = document.getElementById('login-setup-hint');
    if (hint) {
      if (status.success && !status.hasBidderAccounts) {
        hint.classList.remove('hidden');
      } else {
        hint.classList.add('hidden');
      }
    }
  } catch { /* non-fatal */ }
}

async function checkAuth() {
  try {
    const token = await getStoredToken();
    if (!token) {
      await showLogin();
      return;
    }

    showLoading('Loading your account…');
    try {
      const workspace = await fetchWorkspaceData(false);
      if (workspace?.success && workspace.user && isBidderSession(workspace.user)) {
        await enterJobWorkspace(workspace.user, { skipBackgroundRefresh: true });
        return;
      }

      const httpStatus = workspace?._httpStatus;
      if (httpStatus === 401 || httpStatus === 403) {
        await clearAuthState();
        await showLogin();
        if (workspace?.message) {
          showAlert('login-alert', workspace.message, 'error');
        }
        return;
      }

      const sessionUser = await readSessionUser();
      const cached = await readCandidateCache();
      const fallbackUser = sessionUser || cached?.user;

      if (fallbackUser && isBidderSession(fallbackUser)) {
        const refreshed = await fetchWorkspaceData(true);
        if (!refreshed?.success && Array.isArray(cached?.candidates) && cached.candidates.length) {
          applyCandidatesData(cached.candidates, cached.stacks || []);
        }
        await enterJobWorkspace(fallbackUser, { skipBackgroundRefresh: Boolean(refreshed?.success) });
        if (!workspace?.success) {
          showAlert('main-alert', 'Server unreachable. Using your saved session.', 'warn');
        }
        return;
      }

      const me = await window.api.me();
      if (me.success && isBidderSession(me)) {
        await storeSessionUser(me);
        const loaded = await fetchWorkspaceData(true);
        if (!loaded?.success) {
          applyCandidatesData([], []);
        }
        await enterJobWorkspace(me, { skipBackgroundRefresh: true });
        return;
      }

      if (me._httpStatus === 401 || me._httpStatus === 403) {
        await clearAuthState();
      }
      await showLogin();
      if (!me.success && me._httpStatus !== 401 && me._httpStatus !== 403) {
        showAlert('login-alert', 'Cannot reach server. Your login is saved — try again shortly.', 'warn');
      }
    } finally {
      hideLoading();
    }
  } catch {
    hideLoading(true);
    await showLogin();
  }
}

async function doLogin() {
  await window.api.ensureServerUrl();
  const username = document.getElementById('login-user').value.trim();
  const password = document.getElementById('login-pass').value;
  if (!username || !password) {
    showAlert('login-alert', 'Username and password are required.', 'error');
    return;
  }

  const loginBtn = document.getElementById('btn-login');
  showLoading('Signing in…');
  if (loginBtn) loginBtn.disabled = true;
  try {
    if (!global.__qtsBidderAuth?.storePopupAuth) {
      throw new Error('Extension auth module not loaded. Reload the extension in chrome://extensions.');
    }
    const r = await window.api.login(username, password);
    if (r._httpStatus === 0) {
      showAlert(
        'login-alert',
        'Cannot reach the API. Confirm start-server.bat is running and https://qts-job-tracking.vercel.app/api/health shows online.',
        'error'
      );
      return;
    }
    if (r.success && isBidderSession(r)) {
      const sessionSnapshot = {
        id: r.id,
        username: r.username,
        role: r.role,
        bidderId: r.bidderId,
        bidderName: r.bidderName,
      };
      await global.__qtsBidderAuth.storePopupAuth(r.token, sessionSnapshot, r.expiresAt);
      window.api.setCachedToken(r.token);
      setSession(sessionSnapshot);
      clearAlert('login-alert');
      try {
        const workspace = await fetchWorkspaceData(true);
        if (workspace?.user) {
          setSession(workspace.user);
          await global.__qtsBidderAuth.storeSessionUser(workspace.user);
        }
      } catch { /* session already saved */ }
      defaultCandidateId = await readDefaultCandidateId(r.bidderId);
      if (await needsDefaultCandidateSelection(r)) {
        hideLoading(true);
        await showDefaultCandidateStep(currentUser || sessionSnapshot);
        return;
      }
      if (!(await readAutoApplyEnabled())) {
        hideLoading(true);
        await showDefaultCandidateStep(currentUser || sessionSnapshot, { armOnly: true });
        return;
      }
      await global.__qtsBidderAuth.armWorkerAuth();
      showJobSection();
      resetLoginFormView();
      hideLoading(true);
      await loadCurrentTab({ preferCache: true, allowExtract: false });
      updateJobSummary();
      updateDefaultCandidateUi();
      updateAutoApplyBarUi();
      scheduleFitPopup();
    } else if (r.success) {
      showAlert(
        'login-alert',
        'The extension requires a bidder account. Use QTS_Startup web for admin or caller access.',
        'error'
      );
    } else {
      showAlert('login-alert', r.message || 'Login failed.', 'error');
    }
  } catch (err) {
    console.error('doLogin error:', err);
    const detail = err instanceof Error ? err.message : String(err);
    showAlert(
      'login-alert',
      detail.includes('auth module')
        ? detail
        : `Login error: ${detail}. If this persists, reload the extension and confirm the server is running.`,
      'error'
    );
  } finally {
    if (loginBtn) loginBtn.disabled = false;
    hideLoading(true);
  }
}

// ---- Load all data ----
async function loadAll(forceRefreshCandidates = false) {
  await fetchWorkspaceData(forceRefreshCandidates);
  await loadCurrentTab();
  updateJobSummary();
  scheduleFitPopup();
}

async function switchSourceTab(tabId) {
  targetTabId = tabId;
  const url = new URL(window.location.href);
  url.searchParams.set('tabId', String(tabId));
  window.history.replaceState(null, '', url.toString());
  document.getElementById('main-alert').innerHTML = '';
  existingJobId = null;
  jobSavedInBackend = false;
  await loadCurrentTab({ preferCache: true, allowExtract: false });
  await loadApplyTemplateForTab(tabId);
  updateJobSummary();
  scheduleFitPopup();
}

function applyCandidatesData(nextCandidates, nextStacks) {
  candidates = normalizeCandidateList(nextCandidates);
  candidateStacks = nextStacks || [];
  candidateStatuses = {};
  candidateAppliedAt = {};
  candidateLocked = {};
  for (const c of candidates) {
    candidateStatuses[c.id] = 'none';
    candidateLocked[c.id] = false;
  }
  if (defaultCandidateId && isValidDefaultCandidateId(defaultCandidateId)) {
    expandedCandidateIds.add(defaultCandidateId);
  }
  populateStackFilter();
  renderCandidates();
  updateDefaultCandidateUi();
}

async function applyWorkspaceCustomGpt(customGpt, user) {
  if (!customGpt?.url || !global.__qtsCustomGpt?.persistCustomGptConfig) return;
  await global.__qtsCustomGpt.persistCustomGptConfig({
    url: customGpt.url,
    id: customGpt.id,
    source: customGpt.source || 'bidder',
    bidderId: user?.bidderId ?? null,
  });
}

async function fetchWorkspaceFromApi() {
  const boot = await window.api.extensionBootstrap();
  if (boot.success && boot.user) {
    return {
      success: true,
      user: boot.user,
      candidates: normalizeCandidateList(boot.candidates),
      stacks: boot.stacks || [],
      customGpt: boot.customGpt || null,
      _httpStatus: boot._httpStatus,
    };
  }

  const [meRes, candidatesRes, stacksRes] = await Promise.all([
    window.api.me(),
    window.api.getCandidates(),
    window.api.getCandidateStacks(),
  ]);

  if (!meRes.success || !isBidderSession(meRes)) {
    return {
      success: false,
      message: boot.message || meRes.message || 'Could not load bidder workspace.',
      _httpStatus: boot._httpStatus || meRes._httpStatus,
    };
  }

  return {
    success: true,
    user: meRes,
    candidates: normalizeCandidateList(candidatesRes.success ? candidatesRes.candidates : []),
    stacks: stacksRes.success ? (stacksRes.stacks || []) : [],
    _httpStatus: 200,
  };
}

async function fetchWorkspaceData(forceRefresh = false) {
  if (!forceRefresh) {
    const cached = await readCandidateCache();
    if (cached?.user && Array.isArray(cached.candidates) && cached.candidates.length > 0) {
      applyCandidatesData(cached.candidates, cached.stacks || []);
      return { success: true, user: cached.user, fromCache: true };
    }
  }

  const workspace = await fetchWorkspaceFromApi();
  if (!workspace.success) return workspace;

  lastWorkspaceFetchAt = Date.now();
  applyCandidatesData(workspace.candidates, workspace.stacks);
  if (workspace.user) await storeSessionUser(workspace.user);
  if (workspace.customGpt) await applyWorkspaceCustomGpt(workspace.customGpt, workspace.user);
  if (workspace.candidates.length) {
    await writeCandidateCache(workspace.candidates, workspace.stacks, workspace.user);
  } else {
    await clearCandidateCache();
  }
  return workspace;
}

async function readCandidateCache() {
  return new Promise(resolve => {
    chrome.storage.local.get([CANDIDATE_CACHE_KEY], (result) => {
      const cache = result[CANDIDATE_CACHE_KEY];
      if (!cache || !cache.savedAt) {
        resolve(null);
        return;
      }
      if (Date.now() - cache.savedAt > CANDIDATE_CACHE_TTL_MS) {
        resolve(null);
        return;
      }
      resolve(cache);
    });
  });
}

async function writeCandidateCache(nextCandidates, nextStacks, user) {
  return new Promise(resolve => {
    chrome.storage.local.set({
      [CANDIDATE_CACHE_KEY]: {
        savedAt: Date.now(),
        user: user || null,
        candidates: nextCandidates || [],
        stacks: nextStacks || [],
      },
    }, resolve);
  });
}

async function clearCandidateCache() {
  return new Promise(resolve => {
    chrome.storage.local.remove([CANDIDATE_CACHE_KEY], resolve);
  });
}

async function enterJobWorkspace(user, { skipBackgroundRefresh = false } = {}) {
  if (!(await ensureWorkspaceReady(user))) return;
  setSession(user);
  showJobSection();
  resetLoginFormView();
  hideLoading(true);
  await loadCurrentTab({ preferCache: true, allowExtract: false });
  updateJobSummary();
  renderCandidates();
  updateDefaultCandidateUi();
  updateAutoApplyBarUi();
  scheduleFitPopup();
  if (!skipBackgroundRefresh) {
    refreshWorkspaceInBackground();
  }
}

async function persistSession(user, nextCandidates, nextStacks) {
  if (user) await storeSessionUser(user);
  if (Array.isArray(nextCandidates)) {
    const normalized = normalizeCandidateList(nextCandidates);
    applyCandidatesData(normalized, nextStacks || []);
    if (normalized.length) {
      await writeCandidateCache(normalized, nextStacks || [], user);
    }
  }
}

async function readSessionUser() {
  if (global.__qtsBidderAuth?.readPopupSessionUser) {
    return global.__qtsBidderAuth.readPopupSessionUser();
  }
  return null;
}

async function storeSessionUser(user) {
  if (!user) return;
  const snapshot = {
    id: user.id,
    username: user.username,
    role: user.role,
    bidderId: user.bidderId != null ? Number(user.bidderId) : null,
    bidderName: user.bidderName ?? null,
  };
  if (global.__qtsBidderAuth?.storeSessionUser) {
    await global.__qtsBidderAuth.storeSessionUser(snapshot);
    return;
  }
}

async function clearSessionUser() {
  // cleared via clearAuthState()
}

async function clearAuthState() {
  await clearToken();
  await global.__qtsBidderAuth?.clearAuth?.();
  await clearCandidateCache();
  await global.__qtsApplySessionStore?.clearActive?.();
  await new Promise((resolve) => {
    chrome.storage.local.remove([AUTO_APPLY_ENABLED_KEY], resolve);
  });
  await new Promise((resolve) => {
    chrome.storage.local.remove(['qtsCustomGptConfig', 'qtsCustomGptTabId'], resolve);
  });
  global.__qtsCustomGpt?.applyCustomGptConfig?.(null);
  chrome.runtime.sendMessage({ type: 'RESET_AUTO_PIPELINE_STATE' }).catch(() => {});
  clearSession();
}

async function loadCandidates(forceRefresh = false) {
  try {
    await fetchWorkspaceData(forceRefresh);
  } catch { /* non-fatal */ }
}

function populateStackFilter() {
  const select = document.getElementById('cand-stack-filter');
  if (!select) return;

  const previous = select.value;
  const fromCandidates = candidates.map((c) => c.stack).filter(Boolean);
  const allStacks = [...new Set([...candidateStacks, ...fromCandidates])]
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

  select.innerHTML = '<option value="">All stacks</option>' +
    allStacks.map((stack) => `<option value="${escAttr(stack)}">${escHtml(stack)}</option>`).join('');

  if ([...select.options].some((opt) => opt.value === previous)) {
    select.value = previous;
  }
}

function getCandidateFilters() {
  return {
    text: (document.getElementById('cand-filter')?.value || '').trim(),
    stack: document.getElementById('cand-stack-filter')?.value || '',
  };
}

function candidateMatchesFilters(candidate, filters) {
  const stack = (candidate.stack || '').trim();
  const matchesStack = !filters.stack
    || stack.toLowerCase() === filters.stack.toLowerCase();

  if (!filters.text) return matchesStack;

  const text = filters.text.toLowerCase();
  const matchesText = candidate.name.toLowerCase().includes(text)
    || (candidate.email || '').toLowerCase().includes(text)
    || stack.toLowerCase().includes(text);

  return matchesStack && matchesText;
}

async function loadCurrentTab({ preferCache = false, allowExtract = true } = {}) {
  try {
    let tab = null;
    if (targetTabId) {
      tab = await chrome.tabs.get(targetTabId);
    } else {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      tab = activeTab;
    }
    if (!tab) return;

    currentTabUrl = tab.url || '';
    document.getElementById('f-url').value = currentTabUrl;

    const urlCandidates = [currentTabUrl, document.getElementById('f-url').value.trim()];

    if (preferCache) {
      const cachedSaved = await findSavedJobByUrls(urlCandidates, { cacheOnly: true });
      if (cachedSaved) {
        loadExistingJob(cachedSaved, { silent: true });
        renderCandidates();
      }
    } else {
      const saved = await findSavedJobByUrls(urlCandidates, { showSpinner: true });
      if (saved) {
        loadExistingJob(saved);
        renderCandidates();
        return;
      }
    }

    if (!existingJobId) {
      jobSavedInBackend = false;
      candidateLocked = {};
      for (const c of candidates) {
        candidateStatuses[c.id] = 'none';
        candidateAppliedAt[c.id] = null;
        candidateLocked[c.id] = false;
      }

      if (isExtractablePageUrl(currentTabUrl)) {
        const applied = await applyDetectedJobForTab(tab.id, currentTabUrl, { allowExtract, silent: preferCache });
        if (!applied) {
          extractFromPage(tab.id, currentTabUrl).catch(() => {});
        }
      } else {
        showAlert('main-alert', restrictedPageMessage(currentTabUrl), 'info');
      }
    }

    renderCandidates();
    document.getElementById('btn-save').textContent = existingJobId ? 'Update Job' : 'Save Job';

    await loadApplyTemplateForTab(tab.id);

    if (preferCache && urlCandidates.some((url) => url && url.startsWith('http'))) {
      await verifySavedJobOnServer(urlCandidates, { silent: true });
    }
  } catch (e) {
    console.error('loadCurrentTab error:', e);
    showAlert('main-alert', 'Could not read the current page. Try clicking Refresh.', 'error');
  }
}

async function applyDetectedJobForTab(tabId, pageUrl, { allowExtract = true, silent = false } = {}) {
  const normalizedPageUrl = normalizeJobUrl(pageUrl);
  const detected = await getDetectedJobForTab(tabId);
  if (detected && detected.url === normalizedPageUrl) {
    if (detected.valid && detected.data) {
      populateForm(detected.data);
      if (!silent) showAlert('main-alert', DETECT_SUCCESS_MESSAGE, 'success');
      onJobDetected();
      return true;
    }
    if (!silent) showAlert('main-alert', DETECT_FAIL_MESSAGE, 'fail');
    onJobDetected();
    return true;
  }

  if (!allowExtract) return false;
  await extractFromPage(tabId, pageUrl);
  return true;
}

async function findSavedJobByUrls(urls, { cacheOnly = false, skipCache = false, showSpinner = false } = {}) {
  const seen = new Set();
  const uniqueUrls = [];
  for (const raw of urls) {
    const url = (raw || '').trim();
    if (!url || !url.startsWith('http')) continue;
    const key = typeof normalizeJobUrl === 'function' ? normalizeJobUrl(url) : url;
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueUrls.push(url);
  }

  if (!skipCache) {
    for (const url of uniqueUrls) {
      const cached = await readSavedJobFromCache(url);
      if (cached) return cached;
    }
    if (cacheOnly) return null;
  }

  if (!uniqueUrls.length) return null;

  if (showSpinner) showLoading('Checking if this job is saved…');
  try {
    for (const url of uniqueUrls) {
      const saved = await fetchJobByUrl(url);
      if (saved) {
        await writeSavedJobToCache(url, saved);
        return saved;
      }
      if (!cacheOnly) {
        await writeSavedJobToCache(url, null);
      }
    }
    return null;
  } finally {
    if (showSpinner) hideLoading();
  }
}

async function fetchJobByUrl(url) {
  try {
    const r = await window.api.getJobByUrl(url);
    if (r.success && r.job) return r.job;
    if (r._httpStatus && r._httpStatus !== 404) {
      console.warn('fetchJobByUrl failed:', r.message);
    }
  } catch (e) {
    console.warn('fetchJobByUrl error:', e);
  }
  return null;
}

async function extractFromPage(tabId, pageUrl) {
  if (!isExtractablePageUrl(pageUrl)) return;
  try {
    const response = await chrome.runtime.sendMessage({ type: 'EXTRACT_JOB', tabId });
    if (response?.error) {
      if (!response.manualOnly) console.warn('Extraction failed:', response.error);
      if (response.manualOnly) {
        showAlert('main-alert', response.error, 'info');
      } else {
        showAlert('main-alert', DETECT_FAIL_MESSAGE, 'fail');
        onJobDetected();
      }
      return;
    }

    const valid = Boolean(response?.detected);
    if (valid && response?.data) {
      populateForm(normalizeDetectedJobData(response.data, response.url || pageUrl));
      showAlert('main-alert', DETECT_SUCCESS_MESSAGE, 'success');
      onJobDetected();
      return;
    }

    showAlert('main-alert', DETECT_FAIL_MESSAGE, 'fail');
    onJobDetected();
  } catch (e) {
    console.warn('Extraction failed:', e);
    showAlert('main-alert', DETECT_FAIL_MESSAGE, 'fail');
    onJobDetected();
  }
}

function populateForm(data) {
  if (data.title) document.getElementById('f-title').value = data.title;
  if (data.company) document.getElementById('f-company').value = data.company;
  if (data.url) document.getElementById('f-url').value = data.url;
  if (data.description) document.getElementById('f-desc').value = data.description;
  currentSource = data.source || '';
  updateJobSummary();
}

function loadExistingJob(job, { silent = false } = {}) {
  existingJobId = job.id;
  jobSavedInBackend = true;
  document.getElementById('f-title').value = job.title || '';
  document.getElementById('f-company').value = job.company || '';
  document.getElementById('f-url').value = job.url || '';
  document.getElementById('f-desc').value = job.description || '';
  currentSource = job.source || '';
  syncCandidateStatusesFromJob(job.candidateStatuses || []);
  updateJobSummary();

  if (!silent) {
    const appliedCount = Object.values(candidateStatuses).filter(s => s === 'applied').length;
    const editableCount = candidates.length - appliedCount;
    let msg = 'This job is already saved in the database.';
    if (appliedCount > 0) {
      msg += ` ${appliedCount} candidate(s) already applied (locked).`;
    }
    if (editableCount > 0) {
      msg += ` You can mark the remaining ${editableCount} as applied.`;
    }
    showAlert('main-alert', msg, 'info');
  }
  document.getElementById('btn-save').textContent = 'Update Job';
}

function syncCandidateStatusesFromJob(statuses) {
  for (const c of candidates) {
    candidateStatuses[c.id] = 'none';
    candidateAppliedAt[c.id] = null;
    candidateLocked[c.id] = false;
  }

  for (const cs of statuses) {
    const status = cs.status || 'none';
    candidateStatuses[cs.candidate_id] = status;
    candidateAppliedAt[cs.candidate_id] = cs.applied_at || null;
    candidateLocked[cs.candidate_id] = status === 'applied';
  }
}

function isCandidateLocked(candidateId) {
  return !!candidateLocked[candidateId];
}

function updateApplyTemplateSummary() {
  const el = document.getElementById('summary-apply-template');
  if (!el) return;
  if (!detectedApplyTemplate?.applyMethod && !detectedApplyTemplate?.templateName) {
    el.textContent = '—';
    el.title = '';
    return;
  }
  const method = detectedApplyTemplate.applyMethodLabel
    || detectedApplyTemplate.templateName
    || '—';
  const flowNote = detectedApplyTemplate.flowTypeLabel
    ? ` · ${detectedApplyTemplate.flowTypeLabel}`
    : '';
  const formNote = (detectedApplyTemplate.formOpen || detectedApplyTemplate.signals?.applyModalConfirmed)
    ? ' · form open'
    : '';
  const stepNote = detectedApplyTemplate.stepHints?.isMultiStep
    ? ` · step ${detectedApplyTemplate.stepHints.currentStep || '?'}/${detectedApplyTemplate.stepHints.totalSteps || '?'}`
    : '';
  el.textContent = `${method}${flowNote}${formNote}${stepNote}`;
  const titleParts = [
    detectedApplyTemplate.applyMethodDescription,
    detectedApplyTemplate.templateDescription,
    detectedApplyTemplate.templateId,
    detectedApplyTemplate.externalUrl ? `External: ${detectedApplyTemplate.externalUrl}` : '',
  ].filter(Boolean);
  el.title = titleParts.join(' — ');
}

async function loadApplyTemplateForTab(tabId) {
  if (!tabId) {
    detectedApplyTemplate = null;
    updateApplyTemplateSummary();
    return null;
  }
  try {
    const res = await chrome.runtime.sendMessage({ type: 'GET_APPLY_TEMPLATE', tabId });
    detectedApplyTemplate = res?.detection || null;
  } catch {
    detectedApplyTemplate = null;
  }
  updateApplyTemplateSummary();
  return detectedApplyTemplate;
}

function updateJobSummary() {
  const summary = document.getElementById('job-summary');
  summary.classList.remove('hidden');
  document.getElementById('summary-source').textContent = currentSource || '—';
  updateApplyTemplateSummary();

  const isSaved = !!existingJobId;
  const statusEl = document.getElementById('summary-status');
  statusEl.textContent = isSaved ? 'Saved' : 'New';
  statusEl.className = `job-summary-status-pill ${isSaved ? 'is-saved' : 'is-new'}`;

  const appliedCount = Object.values(candidateStatuses).filter(s => s === 'applied').length;
  const noneCount = candidates.length - appliedCount;
  document.getElementById('summary-applied').textContent = String(appliedCount);
  document.getElementById('summary-not-applied').textContent = String(noneCount);
}

function pickCandidateColor(candidate, index = 0) {
  return normalizeCandidateColor(candidate?.color, Number(candidate?.id) || index);
}

function formatCopyableDetailValue(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  return `<button type="button" class="cand-copyable" data-copy-value="${escAttr(text)}" title="Hover and click to copy" aria-label="Copy ${escAttr(text)}">${escHtml(text)}</button>`;
}

function formatCandidateDetails(candidate, status, appliedAt, locked) {
  const rows = [];

  if (candidate.email) {
    rows.push(['Email', formatCopyableDetailValue(candidate.email)]);
  }
  if (candidate.phone) {
    rows.push(['Phone', formatCopyableDetailValue(candidate.phone)]);
  }
  if (candidate.linkedin_url) {
    rows.push(['LinkedIn', formatCopyableDetailValue(candidate.linkedin_url)]);
  }
  if (candidate.stack) {
    rows.push(['Stack', escHtml(candidate.stack)]);
  }
  if (candidate.notes) {
    rows.push(['Notes', escHtml(candidate.notes)]);
  }

  const statusText = status === 'applied'
    ? (locked ? 'Applied (locked)' : 'Applied')
    : 'Not applied';
  rows.push(['Application', escHtml(statusText)]);
  if (status === 'applied' && appliedAt) {
    rows.push(['Applied at', escHtml(formatDate(appliedAt))]);
  }

  if (!rows.length) {
    return '<p class="cand-details-empty">No additional information.</p>';
  }

  return rows.map(([label, value]) => `
    <div class="cand-detail-row">
      <span class="cand-detail-label">${label}</span>
      <span class="cand-detail-value">${value}</span>
    </div>`).join('');
}

// ---- Candidates ----
function collapseAllCandidateCards() {
  expandedCandidateIds.clear();
  document.querySelectorAll('.cand-card.is-expanded').forEach((card) => {
    card.classList.remove('is-expanded');
    const btn = card.querySelector('.cand-expand-btn');
    if (btn) btn.setAttribute('aria-expanded', 'false');
  });
}

function onJobDetected() {
  collapseAllCandidateCards();
  renderCandidates();
}

async function copyTextToClipboard(text) {
  const value = String(text || '').trim();
  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
    showToast(`Copied: ${value}`, 'success');
  } catch {
    const ta = document.createElement('textarea');
    ta.value = value;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    showToast(`Copied: ${value}`, 'success');
  }
}

async function dispatchGptTask(applicationId, { pollAndApply = false, taskId: explicitTaskId } = {}) {
  const gpt = window.__qtsCustomGpt;
  if (!gpt?.buildPrompt) {
    throw new Error('Custom GPT helper not loaded.');
  }
  const id = Number(applicationId);
  if (!id) {
    throw new Error('No application session yet. Click Start Application first.');
  }

  activeTaskId = explicitTaskId || activeTaskId;
  if (!activeTaskId) {
    throw new Error('No GPT task ID yet. Click Start Application first.');
  }
  const taskId = activeTaskId;
  const prompt = gpt.buildPrompt(taskId);

  if (targetTabId) {
    await chrome.storage.local.set({ qtsJobSourceTabId: targetTabId });
  }

  const dispatchRes = await window.api.dispatchApplicationTask(taskId);
  if (!dispatchRes.success) {
    throw new Error(dispatchRes.message || 'Could not register GPT task on server.');
  }

  setGptPipelineState('dispatching', `Sending ${taskId} to Custom GPT…`);
  gptDispatchSent = true;
  renderGptActionSteps(lastGptTaskStatus);
  hideLoading(true);

  let handoffResult;
  gptHandoffInProgress = true;
  try {
    handoffResult = await sendGptTaskToBackground({
      taskId,
      jobTabId: targetTabId,
      applicationId: id,
      pollAndApply,
    });
  } catch (sendErr) {
    throw new Error(sendErr?.message || 'Could not send PROCESS_TASK to Custom GPT.');
  } finally {
    gptHandoffInProgress = false;
  }

  if (!handoffResult?.ok || handoffResult?.handoff?.sent === false) {
    throw new Error(handoffResult?.handoff?.error || handoffResult?.error || 'GPT handoff failed.');
  }

  applyGptDispatchResult({ ...handoffResult, taskId });
  updateCustomGptButton();

  return { taskId, prompt, ...handoffResult };
}

async function pollTaskUntilReady(taskId, { timeoutMs = 180000, intervalMs = 3000 } = {}) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const status = await window.api.getApplicationTaskStatus(taskId);
    if (!status.success) {
      throw new Error(status.message || 'Could not read GPT task status.');
    }
    if (status.gptTaskStatus === 'ready' || status.readyToApply) {
      lastGptTaskStatus = status;
      renderGptActionSteps(status);
      updateCustomGptButton(status);
      return status;
    }
    if (status.gptTaskStatus === 'error') {
      lastGptTaskStatus = status;
      renderGptActionSteps(status);
      throw new Error(status.error || 'GPT task failed on server.');
    }
    lastGptTaskStatus = status;
    renderGptActionSteps(status);
    setGptPipelineState('waiting', `GPT Actions: getTaskContext → submitTaskPackage (${taskId})…`);
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error('Timed out waiting for Custom GPT. Check the pinned GPT tab and try again.');
}

function inferFileDocumentType(field) {
  const slot = String(field.generatedAnswer || field.documentSlot || field.fillValue || '').toLowerCase();
  if (slot.includes('cover')) return 'cover-letter';
  const text = `${field.label || ''} ${field.nameAttr || ''} ${field.placeholder || ''}`.toLowerCase();
  if (/cover|message|letter/.test(text)) return 'cover-letter';
  return 'resume';
}

async function buildFileUploadFields(applicationId, fields) {
  const fileFields = (fields || []).filter((field) => field.fieldType === 'file');
  if (!fileFields.length) return [];

  const uploads = [];
  for (const field of fileFields) {
    const docType = inferFileDocumentType(field);
    const doc = await window.api.fetchApplicationDocument(applicationId, docType);
    if (!doc.success) {
      throw new Error(doc.message || `Could not load ${docType} PDF from server.`);
    }
    uploads.push({
      ...field,
      category: 'document_upload',
      fillStatus: 'filled',
      fillValue: doc.fileName,
      upload: {
        fileName: doc.fileName,
        mimeType: doc.mimeType,
        base64: doc.base64,
      },
    });
  }
  return uploads;
}

async function applyGptAnswersToForm(applicationId, { skipPreview = false } = {}) {
  const id = Number(applicationId);
  if (!id) throw new Error('No application session to apply.');

  showLoading('Applying GPT answers to form…');
  try {
    const stored = await chrome.storage.local.get(['qtsJobSourceTabId']);
    const jobTabId = stored.qtsJobSourceTabId || targetTabId;
    if (jobTabId) {
      try {
        await chrome.tabs.update(jobTabId, { active: true });
        targetTabId = jobTabId;
      } catch {
        // keep current targetTabId
      }
    }

    const result = await window.api.getApplicationResult(id);
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

    const HUMAN_REVIEW_SAVED_KEYS = new Set([
      'terms_accepted', 'gdpr_consent', 'marketing_opt_in', 'cover_message',
    ]);
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

    const allFill = [...fillFields, ...remainingFields];
    const fileUploadFields = await buildFileUploadFields(id, result.fields || []);
    const payload = [...allFill, ...fileUploadFields];

    if (!payload.length) {
      throw new Error('No GPT answers or documents found on server yet.');
    }

    await chrome.runtime.sendMessage({
      type: 'SCAN_APPLICATION_FORM',
      tabId: targetTabId,
      openApplyForm: true,
    });

    let confirmedPayload = payload;
    if (!skipPreview) {
      const previewFields = payload.map((field) => ({
        ...field,
        category: field.category || (field.upload ? 'document_upload' : 'ai_generation'),
        label: field.label || field.stableFieldId,
      }));
      const previewResult = await showApplicationPreview(
        { flowType: 'modal', warnings: ['GPT package ready — confirm before writing to the job form.'] },
        previewFields
      );
      if (!previewResult.confirmed || !previewResult.fields) {
        throw new Error('Apply cancelled — form was not updated.');
      }
      confirmedPayload = previewResult.fields;
    }

    const fillResponse = await chrome.runtime.sendMessage({
      type: 'FILL_APPLICATION_FORM',
      tabId: targetTabId,
      fields: confirmedPayload,
    });

    if (fillResponse?.error) {
      throw new Error(fillResponse.error);
    }

    const filledCount = fillResponse?.fill?.results?.filter((item) => item.ok)?.length || 0;
    const uploadedCount = fillResponse?.fill?.results?.filter((item) => item.ok && fileUploadFields.some((f) => f.stableFieldId === item.stableFieldId))?.length || 0;
    gptAppliedToForm = true;
    const uploadNote = uploadedCount ? ` Uploaded ${uploadedCount} PDF(s).` : '';
    setGptPipelineState('ready', `Applied ${filledCount} field(s) to the form.${uploadNote} Review before submit.`);
    renderGptActionSteps(lastGptTaskStatus);
    showAlert('main-alert', `Applied ${filledCount} field(s).${uploadNote} Review the form before submitting.`, 'success');
    await refreshApplicationStatus();
    return fillResponse;
  } finally {
    hideLoading(true);
  }
}

async function runGptTaskPipeline(applicationId, taskId) {
  if (gptPipelineRunning) return;
  gptPipelineRunning = true;
  try {
    setGptPipelineState('waiting', `Waiting for Custom GPT to finish ${taskId}…`);
    await pollTaskUntilReady(taskId);
    setGptPipelineState('applying', `GPT package ready — filling form…`);
    await applyGptAnswersToForm(applicationId);
  } finally {
    gptPipelineRunning = false;
    chrome.runtime.sendMessage({ type: 'STOP_GPT_APPROVAL_WATCH' }).catch(() => {});
  }
}

function setGptPipelineState(state, message) {
  const el = document.getElementById('application-gpt-pipeline');
  if (!el) return;
  if (!message) {
    el.classList.add('hidden');
    el.textContent = '';
    return;
  }
  el.classList.remove('hidden');
  el.textContent = message;
  el.dataset.state = state || '';
}

function formatGptTaskStatusLabel(status) {
  const map = {
    waiting_for_gpt: 'Waiting for GPT',
    pending_gpt: 'Pending GPT',
    ready: 'Ready',
    error: 'Error',
  };
  return map[status] || (status ? String(status) : '—');
}

function resolveGptActionStepState(stepId, taskStatus) {
  const gptStatus = taskStatus?.gptTaskStatus || lastGptTaskStatus?.gptTaskStatus;
  const ready = taskStatus?.readyToApply || gptStatus === 'ready';
  const errored = gptStatus === 'error';

  switch (stepId) {
    case 'dispatch':
      if (errored && !gptDispatchSent) return 'error';
      return gptDispatchSent ? 'done' : 'pending';
    case 'getTaskContext':
      if (errored) return gptDispatchSent ? 'error' : 'pending';
      if (ready) return 'done';
      return gptDispatchSent ? 'active' : 'pending';
    case 'submitTaskPackage':
      if (errored) return gptDispatchSent ? 'error' : 'pending';
      if (ready) return 'done';
      return gptDispatchSent ? 'active' : 'pending';
    case 'getTaskStatus':
      if (errored) return 'error';
      if (ready) return 'done';
      return gptDispatchSent ? 'active' : 'pending';
    case 'apply':
      if (gptAppliedToForm) return 'done';
      if (ready) return 'active';
      return 'pending';
    default:
      return 'pending';
  }
}

function renderGptActionSteps(taskStatus) {
  const wrap = document.getElementById('application-gpt-steps');
  const list = document.getElementById('application-gpt-steps-list');
  const steps = window.__qtsCustomGpt?.ACTION_STEPS || [];
  if (!wrap || !list || !activeTaskId || !steps.length) {
    wrap?.classList.add('hidden');
    if (list) list.innerHTML = '';
    return;
  }

  const iconFor = (state) => {
    if (state === 'done') return '✓';
    if (state === 'active') return '…';
    if (state === 'error') return '✕';
    return '○';
  };

  list.innerHTML = steps.map((step) => {
    const state = resolveGptActionStepState(step.id, taskStatus);
    const actor = step.actor === 'gpt' ? 'GPT Action' : 'Extension';
    return `<li class="application-gpt-step is-${state}">
      <span class="application-gpt-step-icon">${iconFor(state)}</span>
      <span><strong>${escHtml(step.label)}</strong> <span class="text-muted">(${escHtml(actor)})</span></span>
    </li>`;
  }).join('');

  wrap.classList.remove('hidden');
}

function syncTaskIdDisplay() {
  const taskEl = document.getElementById('application-task-id');
  if (!taskEl) return;
  if (activeTaskId) {
    taskEl.textContent = activeTaskId;
    taskEl.title = `Click to copy: PROCESS_TASK: ${activeTaskId}`;
  } else if (activeApplicationId) {
    taskEl.textContent = '…';
    taskEl.title = 'Task ID loads after session is created';
  } else {
    taskEl.textContent = '—';
    taskEl.title = 'Task id appears after Start Application';
  }
}

async function fetchAndSyncGptTaskStatus() {
  if (!activeTaskId) return null;
  const status = await window.api.getApplicationTaskStatus(activeTaskId);
  if (status?.success) {
    lastGptTaskStatus = status;
    renderGptActionSteps(status);
    updateCustomGptButton(status);
  }
  return status;
}

function updateCustomGptButton(taskStatus) {
  const openBtn = document.getElementById('btn-open-custom-gpt');
  const applyBtn = document.getElementById('btn-apply-gpt-package');
  const visible = Boolean(activeApplicationId);
  const ready = taskStatus?.readyToApply || taskStatus?.gptTaskStatus === 'ready'
    || lastGptTaskStatus?.readyToApply || lastGptTaskStatus?.gptTaskStatus === 'ready';

  openBtn?.classList.toggle('hidden', !visible);
  applyBtn?.classList.toggle('hidden', !visible || !ready);
}

function renderCandidates() {
  const list = document.getElementById('cand-list');
  const empty = document.getElementById('cand-empty');
  const filters = getCandidateFilters();
  const filtered = candidates.filter((c) => candidateMatchesFilters(c, filters));

  if (!candidates.length) {
    list.innerHTML = '';
    empty.classList.remove('hidden');
    scheduleFitPopup();
    return;
  }

  empty.classList.add('hidden');

  if (!filtered.length) {
    list.innerHTML = '<div style="color:#9ca3af;padding:8px 0;font-size:12px">No candidates match your filter.</div>';
    scheduleFitPopup();
    return;
  }

  list.innerHTML = filtered.map((c, i) => {
    const status = candidateStatuses[c.id] || 'none';
    const locked = isCandidateLocked(c.id);
    const appliedAt = candidateAppliedAt[c.id];
    const nameColor = pickCandidateColor(c, i);
    const isExpanded = expandedCandidateIds.has(c.id);
    const isDefault = Number(defaultCandidateId) === Number(c.id);
    const defaultBadge = isDefault ? '<span class="cand-default-badge">DEFAULT</span>' : '';

    const statusLabel = locked ? 'APPLIED' : (status === 'applied' ? 'APPLIED' : 'NOT APPLIED');

    const statusControl = locked
      ? `<label class="status-toggle is-locked is-on" title="Already applied — cannot be changed">
          <span class="status-toggle-text">${statusLabel}</span>
          <input type="checkbox" class="status-toggle-input" data-cid="${c.id}" checked disabled aria-label="Applied (locked)" />
          <span class="status-toggle-track" aria-hidden="true"></span>
        </label>`
      : `<label class="status-toggle ${status === 'applied' ? 'is-on' : ''}" title="Toggle applied status">
          <span class="status-toggle-text">${statusLabel}</span>
          <input type="checkbox" class="status-toggle-input" data-cid="${c.id}" ${status === 'applied' ? 'checked' : ''} aria-label="Mark ${escAttr(c.name)} as applied" />
          <span class="status-toggle-track" aria-hidden="true"></span>
        </label>`;

    const stackHtml = c.stack
      ? `<span class="cand-stack">${escHtml(c.stack)}</span>`
      : '';

    return `
      <div class="cand-card ${locked ? 'locked' : ''} ${isExpanded ? 'is-expanded' : ''}" data-cid="${c.id}">
        <div class="cand-card-head">
          <button type="button" class="cand-expand-btn" aria-expanded="${isExpanded ? 'true' : 'false'}" aria-label="Show details for ${escAttr(c.name)}">
            <span class="cand-expand-icon" aria-hidden="true">▸</span>
            <span class="cand-info">
              <span class="cand-name-line">
                <span class="cand-name" style="color:${nameColor}">${escHtml(c.name)}</span>${defaultBadge}${stackHtml}
              </span>
            </span>
          </button>
          <div class="cand-status-wrap" onclick="event.stopPropagation()">
            ${statusControl}
          </div>
        </div>
        <div class="cand-card-details">
          ${formatCandidateDetails(c, status, appliedAt, locked)}
          <div class="cand-actions">
            <button type="button" class="btn btn-primary btn-start-application" data-cid="${c.id}">
              Start Application
            </button>
          </div>
        </div>
      </div>`;
  }).join('');
  scheduleFitPopup();
}

function onCandidateCardClick(event) {
  if (event.target.closest('.status-toggle')) return;

  const startBtn = event.target.closest('.btn-start-application');
  if (startBtn) {
    event.stopPropagation();
    event.preventDefault();
    const candidateId = parseInt(startBtn.dataset.cid, 10);
    if (Number.isFinite(candidateId)) {
      startApplication(candidateId).catch((e) => {
        console.error('startApplication error:', e);
        showAlert('main-alert', 'Could not start application workflow.', 'error');
      });
    }
    return;
  }

  const copyBtn = event.target.closest('.cand-copyable');
  if (copyBtn) {
    event.stopPropagation();
    event.preventDefault();
    copyTextToClipboard(copyBtn.dataset.copyValue || copyBtn.textContent || '');
    return;
  }

  if (event.target.closest('.cand-card-details')) return;

  const head = event.target.closest('.cand-card-head');
  if (!head) return;

  const card = head.closest('.cand-card');
  if (!card) return;

  const candidateId = parseInt(card.dataset.cid, 10);
  if (!Number.isFinite(candidateId)) return;

  const isExpanded = card.classList.toggle('is-expanded');
  if (isExpanded) expandedCandidateIds.add(candidateId);
  else expandedCandidateIds.delete(candidateId);

  const btn = card.querySelector('.cand-expand-btn');
  if (btn) btn.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');

  scheduleFitPopup();
}

function onCandidateStatusChange(event) {
  const input = event.target;
  if (!input.classList.contains('status-toggle-input')) return;

  const candidateId = parseInt(input.dataset.cid, 10);
  if (isCandidateLocked(candidateId)) {
    input.checked = true;
    return;
  }

  const newStatus = input.checked ? 'applied' : 'none';
  if (newStatus === 'none' && jobSavedInBackend) {
    input.checked = candidateStatuses[candidateId] === 'applied';
    return;
  }

  candidateStatuses[candidateId] = newStatus;

  if (newStatus === 'applied') {
    if (!candidateAppliedAt[candidateId]) {
      candidateAppliedAt[candidateId] = new Date().toISOString();
    }
  } else {
    candidateAppliedAt[candidateId] = null;
  }

  const label = input.closest('.status-toggle');
  const textEl = label?.querySelector('.status-toggle-text');
  if (label) {
    label.classList.toggle('is-on', newStatus === 'applied');
  }
  if (textEl) {
    textEl.textContent = newStatus === 'applied' ? 'APPLIED' : 'NOT APPLIED';
  }

  const card = input.closest('.cand-card');
  if (card && card.classList.contains('is-expanded')) {
    const details = card.querySelector('.cand-card-details');
    const candidate = candidates.find((c) => Number(c.id) === candidateId);
    if (details && candidate) {
      details.innerHTML = formatCandidateDetails(
        candidate,
        newStatus,
        candidateAppliedAt[candidateId],
        isCandidateLocked(candidateId)
      );
    }
  }

  updateJobSummary();
}

function filterCandidates() {
  if (filterCandidatesTimer) clearTimeout(filterCandidatesTimer);
  filterCandidatesTimer = setTimeout(() => {
    filterCandidatesTimer = null;
    renderCandidates();
  }, 180);
}

function formatApiError(response) {
  if (response?.errors?.length) {
    return response.errors.map(e => `${e.field}: ${e.message}`).join(' · ');
  }
  return response?.message || 'Could not save the job.';
}

function detectPlatformFromUrl(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
    if (host.includes('linkedin.com')) return 'linkedin';
    if (host.includes('indeed.com')) return 'indeed';
    if (host.includes('glassdoor.com')) return 'glassdoor';
    if (host.includes('greenhouse.io')) return 'greenhouse';
    if (host.includes('lever.co')) return 'lever';
    if (host.includes('workable.com')) return 'workable';
    if (host.includes('smartrecruiters.com')) return 'smartrecruiters';
    if (host.includes('ashbyhq.com')) return 'ashby';
    if (host.includes('justjoin.it')) return 'justjoin';
    return host;
  } catch {
    return currentSource || 'unknown';
  }
}

function renderApplicationStatus(result, taskStatus) {
  const panel = document.getElementById('application-status');
  const sessionIdEl = document.getElementById('application-session-id');
  const gridEl = document.getElementById('application-status-grid');
  const pendingWrap = document.getElementById('application-pending-wrap');
  const pendingList = document.getElementById('application-pending-list');
  const hintEl = document.getElementById('application-status-hint');
  if (!panel || !gridEl || !sessionIdEl) return;

  const summary = result?.summary || {};
  const session = result?.session || {};
  const pendingAiFields = result?.pendingAiFields || [];
  const ts = taskStatus || lastGptTaskStatus;

  activeApplicationId = session.applicationId || activeApplicationId;
  if (taskStatus?.taskId) {
    activeTaskId = taskStatus.taskId;
  }
  persistActiveApplySession({
    applicationId: activeApplicationId,
    taskId: activeTaskId,
    status: ts?.gptTaskStatus || null,
  }).catch(() => {});
  sessionIdEl.textContent = activeApplicationId ? `#${activeApplicationId}` : '—';
  syncTaskIdDisplay();

  const gptLabel = formatGptTaskStatusLabel(ts?.gptTaskStatus);
  gridEl.innerHTML = [
    ['Filled', summary.filled ?? 0],
    ['AI pending', summary.aiPending ?? 0],
    ['GPT status', gptLabel],
  ].map(([label, value]) => `
    <div class="application-stat">
      <span class="application-stat-value">${escHtml(String(value))}</span>
      <span class="application-stat-label">${escHtml(label)}</span>
    </div>`).join('');

  if (pendingAiFields.length && pendingList && pendingWrap) {
    pendingWrap.classList.remove('hidden');
    pendingList.innerHTML = pendingAiFields.map((field) => {
      const label = field.label || field.stableFieldId || 'Untitled question';
      const required = field.required ? ' (required)' : '';
      return `<li>${escHtml(label)}${escHtml(required)}</li>`;
    }).join('');
  } else if (pendingWrap) {
    pendingWrap.classList.add('hidden');
    if (pendingList) pendingList.innerHTML = '';
  }

  if (hintEl) {
    if (ts?.readyToApply || ts?.gptTaskStatus === 'ready') {
      hintEl.textContent = 'GPT Actions complete (submitTaskPackage). Click Apply answers or wait for auto-fill.';
    } else if ((summary.aiPending ?? 0) > 0) {
      hintEl.textContent = `Extension sends PROCESS_TASK: ${activeTaskId || 'task_?'} → GPT runs getTaskContext + submitTaskPackage.`;
    } else if ((summary.totalFields ?? 0) > 0) {
      hintEl.textContent = 'All detected fields were profile/saved answers, or no narrative AI questions were found on this page.';
    } else {
      hintEl.textContent = 'No fields were saved for this session.';
    }
  }

  renderGptActionSteps(ts);
  updateCustomGptButton(ts);
  panel.classList.remove('hidden');
  scheduleFitPopup();
}

function formatDevFieldLine(field, index) {
  const category = field.category || 'unknown';
  const status = field.fillStatus || 'pending';
  const type = field.fieldType || '?';
  const label = (field.label || field.placeholder || field.stableFieldId || 'no label').slice(0, 80);
  const required = field.required ? 'required' : 'optional';
  const parts = [
    `[${index + 1}] ${category}`,
    status.toUpperCase(),
    type,
    `"${label}"`,
    required,
  ];
  if (field.profileKey) parts.push(`profile→${field.profileKey}`);
  if (field.savedAnswerKey) parts.push(`saved→${field.savedAnswerKey}`);
  if (field.fillValue) parts.push(`fill→${String(field.fillValue).slice(0, 60)}`);
  if (field.currentValue) parts.push(`page→${String(field.currentValue).slice(0, 40)}`);
  if (field.stableFieldId) parts.push(`id:${field.stableFieldId}`);
  return parts.join(' | ');
}

function buildDevCaptureSummary(capture) {
  if (!capture) return '';
  const lines = [];
  lines.push(`Session #${capture.applicationId ?? '—'} | ${capture.platform || 'unknown'} | ${capture.pageUrl || '—'}`);
  lines.push(`Scanned: ${capture.scannedCount ?? 0} | Saved to server: ${capture.fields?.length ?? 0}`);
  lines.push(`Filled: ${capture.counts?.filled ?? 0} | AI pending: ${capture.counts?.aiPending ?? 0} | Unknown: ${capture.counts?.unknown ?? 0} | Errors: ${capture.counts?.errors ?? 0}`);
  lines.push('---');
  (capture.fields || []).forEach((field, index) => {
    lines.push(formatDevFieldLine(field, index));
  });
  if (!capture.fields?.length) {
    lines.push('(no fields captured)');
  }
  return lines.join('\n');
}

function renderDevCaptureDebug(capture) {
  const panel = document.getElementById('dev-capture-debug');
  const summaryEl = document.getElementById('dev-capture-summary');
  const rawEl = document.getElementById('dev-capture-raw');
  if (!panel || !summaryEl || !rawEl) return;

  if (!capture) {
    panel.classList.add('hidden');
    summaryEl.value = '';
    rawEl.value = '';
    return;
  }

  lastDevCapture = capture;
  summaryEl.value = buildDevCaptureSummary(capture);
  rawEl.value = JSON.stringify(capture, null, 2);
  panel.classList.remove('hidden');
  scheduleFitPopup();
}

function buildDevCaptureFromWorkflow({
  applicationId,
  platform,
  scanMeta,
  scannedFields,
  classifiedFields,
  fillResults,
  serverResult,
  discovery,
}) {
  const fields = serverResult?.fields || classifiedFields || [];
  const counts = {
    filled: fields.filter((f) => f.fillStatus === 'filled').length,
    aiPending: fields.filter(
      (f) => (f.category === 'ai_generation' || f.category === 'document_upload')
        && (f.fillStatus === 'pending' || f.fillStatus === 'awaiting_answer')
    ).length,
    unknown: fields.filter((f) => f.category === 'unknown').length,
    errors: fields.filter((f) => f.fillStatus === 'error').length,
    profile: fields.filter((f) => f.category === 'candidate_profile').length,
    saved: fields.filter((f) => f.category === 'saved_answer').length,
    ai: fields.filter((f) => f.category === 'ai_generation').length,
    upload: fields.filter((f) => f.category === 'document_upload' || f.fieldType === 'file').length,
  };

  return {
    capturedAt: new Date().toISOString(),
    applicationId,
    platform,
    flowType: discovery?.flowType || null,
    pageUrl: scanMeta?.pageUrl || null,
    pageTitle: scanMeta?.pageTitle || null,
    pageStep: scanMeta?.pageStep || null,
    scannedCount: scannedFields?.length ?? 0,
    counts,
    fields,
    discovery: discovery || null,
    fillResults: fillResults || [],
    serverSummary: serverResult?.summary || null,
    _devNote: 'Temporary debug payload — remove dev-capture-debug UI before production',
  };
}

function showApplicationPreview(discovery, classifiedFields, fillPolicy = null, fillPolicyContext = null, options = {}) {
  const preview = window.__qtsApplicationPreview;
  return new Promise((resolve) => {
    const panel = document.getElementById('application-preview');
    const flowEl = document.getElementById('application-preview-flow');
    const statsEl = document.getElementById('application-preview-stats');
    const warningsEl = document.getElementById('application-preview-warnings');
    const noteEl = document.getElementById('application-preview-note');
    const bodyEl = document.getElementById('application-preview-body');
    const confirmBtn = document.getElementById('btn-preview-confirm');
    const cancelBtn = document.getElementById('btn-preview-cancel');
    if (!panel || !bodyEl || !confirmBtn || !cancelBtn) {
      resolve({ confirmed: true, fields: classifiedFields });
      return;
    }

    hideLoading(true);
    const flow = window.__qtsApplicationFlow;
    const counts = flow?.summarizeDiscoveryCounts(classifiedFields) || { total: classifiedFields.length };
    const willUseCustomGpt = options.willUseCustomGpt !== false
      && (options.willUseCustomGpt === true || needsCustomGptHandoff(classifiedFields));

    if (willUseCustomGpt) {
      prewarmCustomGptTab();
      if (noteEl) {
        noteEl.textContent = 'Review discovered fields, then click Confirm. Custom GPT is preloading in the background for resume/PDF generation. After confirm, profile fields fill on the job page, then PROCESS_TASK is sent automatically.';
      }
    } else if (noteEl) {
      noteEl.textContent = 'Review discovered fields, then click Confirm. Profile fields fill on the job page. You submit manually on the job site.';
    }
    if (flowEl) {
      const templateLabel = discovery?.templateName ? `${discovery.templateName} · ` : '';
      flowEl.textContent = `${templateLabel}${flow?.formatFlowType(discovery?.flowType) || 'Application form'}`;
    }
    if (statsEl) {
      statsEl.innerHTML = [
        `<span class="application-preview-stat">${counts.total} fields</span>`,
        `<span class="application-preview-stat">${counts.required || 0} required</span>`,
        `<span class="application-preview-stat">${counts.profile || 0} profile</span>`,
        `<span class="application-preview-stat">${counts.upload || 0} uploads</span>`,
        `<span class="application-preview-stat">${counts.ai || 0} AI</span>`,
      ].join('');
    }

    const warnings = discovery?.warnings || [];
    if (warningsEl) {
      if (warnings.length) {
        warningsEl.innerHTML = warnings.map((w) => `<li>${escHtml(w)}</li>`).join('');
        warningsEl.classList.remove('hidden');
      } else {
        warningsEl.innerHTML = '';
        warningsEl.classList.add('hidden');
      }
    }

    bodyEl.innerHTML = classifiedFields.map((field, index) => {
      const label = escHtml((field.label || field.placeholder || field.stableFieldId || 'Field').slice(0, 100));
      const type = escHtml(flow?.formatFieldType(field.fieldType) || field.fieldType || 'Field');
      const category = escHtml(flow?.formatCategory(field.category) || field.category || 'Unknown');
      const required = field.required ? ' *' : '';
      const valueCell = preview?.renderPreviewInput(field, index, escHtml, escAttr)
        || `<span class="application-preview-readonly">—</span>`;
      return `<tr>
        <td>${label}${required}</td>
        <td>${type}</td>
        <td>${category}</td>
        <td>${valueCell}</td>
      </tr>`;
    }).join('');

    if (!classifiedFields.length) {
      bodyEl.innerHTML = `<tr><td colspan="4" class="application-preview-readonly">No fields captured yet. ${escHtml(discovery?.externalUrl ? `Open external apply page: ${discovery.externalUrl}` : 'Open the apply form on the job tab and try again.')}</td></tr>`;
    }

    const cleanup = () => {
      panel.classList.add('hidden');
      panel.setAttribute('aria-hidden', 'true');
      confirmBtn.removeEventListener('click', onConfirm);
      cancelBtn.removeEventListener('click', onCancel);
    };

    const onCancel = () => {
      cleanup();
      resolve({ confirmed: false, fields: null });
    };

    const onConfirm = () => {
      if (willUseCustomGpt) {
        prewarmCustomGptTab();
      }
      let nextFields = preview?.applyPreviewEdits(classifiedFields) || classifiedFields;
      if (fillPolicy && window.__qtsFillPolicy?.applyFillPolicy) {
        nextFields = window.__qtsFillPolicy.applyFillPolicy(nextFields, fillPolicy, fillPolicyContext || {});
      }
      cleanup();
      resolve({ confirmed: true, fields: nextFields });
    };

    confirmBtn.addEventListener('click', onConfirm);
    cancelBtn.addEventListener('click', onCancel);
    panel.classList.remove('hidden');
    panel.setAttribute('aria-hidden', 'false');
    try {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch {
      window.scrollTo(0, 0);
    }
    scheduleFitPopup();
  });
}

async function refreshApplicationStatus() {
  if (!activeApplicationId) {
    showAlert('main-alert', 'No application session yet. Click Start Application first.', 'info');
    return;
  }
  showLoading('Checking application session…');
  try {
    const [result, taskStatus] = await Promise.all([
      window.api.getApplicationResult(activeApplicationId),
      activeTaskId ? window.api.getApplicationTaskStatus(activeTaskId) : Promise.resolve(null),
    ]);
    if (!result.success) {
      showAlert('main-alert', result.message || 'Could not load application session.', 'error');
      return;
    }
    if (taskStatus?.success) {
      lastGptTaskStatus = taskStatus;
    }
    renderApplicationStatus(result, taskStatus?.success ? taskStatus : null);
    if (lastDevCapture) {
      renderDevCaptureDebug(buildDevCaptureFromWorkflow({
        applicationId: activeApplicationId,
        platform: lastDevCapture.platform,
        scanMeta: {
          pageUrl: lastDevCapture.pageUrl,
          pageTitle: lastDevCapture.pageTitle,
          pageStep: lastDevCapture.pageStep,
        },
        scannedFields: lastDevCapture.fields,
        classifiedFields: result.fields,
        fillResults: lastDevCapture.fillResults,
        serverResult: result,
      }));
    } else {
      renderDevCaptureDebug(buildDevCaptureFromWorkflow({
        applicationId: activeApplicationId,
        platform: result.session?.platform,
        scanMeta: { pageUrl: result.session?.jobUrl },
        classifiedFields: result.fields,
        serverResult: result,
      }));
    }
    const pending = result.summary?.aiPending ?? 0;
    const filled = result.summary?.filled ?? 0;
    const gpt = lastGptTaskStatus?.gptTaskStatus ? `, GPT ${lastGptTaskStatus.gptTaskStatus}` : '';
    showAlert('main-alert', `Session #${activeApplicationId} (${activeTaskId || '—'}): ${filled} filled, ${pending} AI pending${gpt}.`, 'success');
  } finally {
    hideLoading(true);
  }
}

function needsCustomGptHandoff(fields) {
  return (fields || []).some((field) => field.category === 'ai_generation'
    || field.category === 'document_upload'
    || field.fieldType === 'file');
}

function prewarmCustomGptTab() {
  chrome.runtime.sendMessage({ type: 'PREWARM_CUSTOM_GPT_TAB', background: true }).catch(() => {});
}

async function startApplication(candidateId) {
  const candidate = candidates.find((c) => Number(c.id) === Number(candidateId));
  if (!candidate) {
    showAlert('main-alert', 'Candidate not found.', 'error');
    return;
  }

  const jobUrl = document.getElementById('f-url')?.value?.trim() || currentTabUrl;
  const jobTitle = document.getElementById('f-title')?.value?.trim();
  const company = document.getElementById('f-company')?.value?.trim();
  const jobDescription = document.getElementById('f-desc')?.value?.trim() || '';

  if (!jobUrl || !jobUrl.startsWith('http')) {
    showAlert('main-alert', 'Open a job application page and ensure the URL is filled in first.', 'error');
    return;
  }

  showLoading('Loading candidate profile…');
  try {
    if (targetTabId) {
      await chrome.storage.local.set({ qtsJobSourceTabId: targetTabId });
    }

    const profileRes = await window.api.getCandidate(candidateId);
    if (!profileRes.success || !profileRes.candidate) {
      showAlert('main-alert', window.api.formatApiMessage(profileRes, 'Could not load candidate profile.'), 'error');
      return;
    }

    const fullCandidate = profileRes.candidate;

    showLoading('Discovering application form…');
    hideLoading(true);
    const discoverResponse = await chrome.runtime.sendMessage({
      type: 'DISCOVER_APPLICATION_FORM',
      tabId: targetTabId,
      openApplyForm: true,
      expandDynamic: false,
    });

    if (discoverResponse?.error) {
      const debugNote = discoverResponse.debug
        ? ` (${JSON.stringify(discoverResponse.debug)})`
        : '';
      showAlert('main-alert', `${discoverResponse.error}${debugNote}`, 'error');
      return;
    }

    await chrome.runtime.sendMessage({ type: 'DETECT_APPLY_TEMPLATE', tabId: targetTabId }).catch(() => {});
    await loadApplyTemplateForTab(targetTabId);

    const discovery = discoverResponse.discovery || {};
    const scanMeta = discoverResponse.scan || discovery.scanMeta || {};
    const scannedFields = discoverResponse.scan?.fields || discovery.fields || [];

    if (discovery.flowType === 'external_redirect' && discovery.externalUrl) {
      showAlert(
        'main-alert',
        `This job applies on an external site: ${discovery.externalUrl}. Open that page and run Start Application there.`,
        'warn'
      );
      return;
    }

    if (!scannedFields.length) {
      const applyFlow = discovery.applyFlow || discoverResponse.applyFlow;
      if (applyFlow?.clicked && applyFlow?.formAppeared === false) {
        showAlert(
          'main-alert',
          'Clicked Apply but no application form appeared. Open the job page, click Apply to show the form, then try Start Application again.',
          'warn'
        );
      } else if (applyFlow?.reason === 'no_apply_button') {
        showAlert(
          'main-alert',
          'No Apply button found on this page. Open the application form manually and try again.',
          'warn'
        );
      } else {
        showAlert('main-alert', 'No application fields detected on this page. Open the apply form and try again.', 'warn');
      }
      return;
    }

    showLoading('Creating application session…');
    const sessionRes = await window.api.createApplicationSession({
      candidateId,
      jobId: existingJobId || null,
      jobUrl,
      jobTitle: jobTitle || null,
      company: company || null,
      jobDescription,
      platform: detectPlatformFromUrl(jobUrl),
      currentStep: 'scan',
      metadata: {
        sourceTabId: targetTabId,
        extensionVersion: chrome.runtime.getManifest().version,
      },
    });

    if (!sessionRes.success || !sessionRes.session) {
      showAlert('main-alert', window.api.formatApiMessage(sessionRes, 'Could not create application session.'), 'error');
      return;
    }

    activeApplicationId = sessionRes.session.applicationId;
    activeTaskId = sessionRes.session?.metadata?.publicTaskId
      || sessionRes.session?.metadata?.taskId
      || sessionRes.taskId
      || null;
    await persistActiveApplySession({
      applicationId: activeApplicationId,
      taskId: activeTaskId,
      jobTabId: targetTabId,
      jobUrl,
      candidateId,
      status: 'started',
    });
    if (!activeTaskId) {
      console.warn('Server did not return taskId for session', activeApplicationId);
    }
    gptDispatchSent = false;
    gptAppliedToForm = false;
    lastGptTaskStatus = null;
    const savedAnswers = sessionRes.savedAnswers || [];

    let classifiedFields = window.__qtsFieldClassifier.classifyFields(scannedFields);
    classifiedFields = window.__qtsCandidateMatcher.applyFieldClassificationFill(
      classifiedFields,
      fullCandidate,
      savedAnswers
    );

    const fillPolicy = window.__qtsFillPolicy?.getFillPolicyForTemplate?.(discovery.templateId);
    const fillPolicyContext = { candidate: fullCandidate, savedAnswers };
    if (fillPolicy) {
      classifiedFields = window.__qtsFillPolicy.applyFillPolicy(
        classifiedFields,
        fillPolicy,
        fillPolicyContext
      );
    }

    renderDevCaptureDebug(buildDevCaptureFromWorkflow({
      applicationId: activeApplicationId,
      platform: detectPlatformFromUrl(jobUrl),
      scanMeta,
      scannedFields,
      classifiedFields,
      discovery,
    }));
    const devPanel = document.getElementById('dev-capture-debug');
    if (devPanel && classifiedFields.length) {
      devPanel.classList.remove('hidden');
    }

    hideLoading(true);
    const willUseCustomGpt = needsCustomGptHandoff(classifiedFields);
    const previewResult = await showApplicationPreview(
      discovery,
      classifiedFields,
      fillPolicy,
      fillPolicyContext,
      { willUseCustomGpt }
    );
    if (!previewResult.confirmed || !previewResult.fields) {
      showAlert('main-alert', 'Application cancelled — nothing was filled on the job page.', 'info');
      return;
    }
    classifiedFields = previewResult.fields;

    if (willUseCustomGpt) {
      setGptPipelineState('dispatching', 'Fields confirmed — finishing profile fill, then Custom GPT…');
    }

    const fillableFields = classifiedFields.filter(
      (field) => field.category !== 'ai_generation'
        && field.category !== 'document_upload'
        && field.fillValue
        && field.fillStatus === 'filled'
    );

    showLoading('Filling confirmed fields…');
    const fillResponse = await chrome.runtime.sendMessage({
      type: 'FILL_APPLICATION_FORM',
      tabId: targetTabId,
      fields: fillableFields,
    });

    const fillResults = fillResponse?.fill?.results || [];
    const fillResultById = new Map(fillResults.map((item) => [item.stableFieldId, item]));

    classifiedFields = classifiedFields.map((field) => {
      if (field.category === 'ai_generation' || field.category === 'document_upload') return field;
      const outcome = fillResultById.get(field.stableFieldId);
      if (!outcome) return field;
      if (outcome.ok) return { ...field, fillStatus: 'filled' };
      return { ...field, fillStatus: 'error' };
    });

    showLoading('Saving discovered fields…');
    const healthRes = await window.api.health();
    if (healthRes?.success && healthRes.features?.documentUploadCategory !== true) {
      showAlert(
        'main-alert',
        'Server is missing document upload support. Run stop-server.bat then start-server.bat (do not skip — old server must restart).',
        'error'
      );
      return;
    }

    const patchRes = await window.api.patchApplicationSessionFields(activeApplicationId, {
      fields: classifiedFields,
      currentStep: scanMeta.pageStep || 'scan',
      discoveredPages: (discovery.pages || [{
        pageUrl: scanMeta.pageUrl || jobUrl,
        pageTitle: scanMeta.pageTitle || '',
        pageStep: scanMeta.pageStep || '',
        scannedAt: scanMeta.scannedAt || new Date().toISOString(),
        fieldCount: classifiedFields.length,
        flowType: discovery.flowType,
      }]).map((page) => ({
        ...page,
        flowType: discovery.flowType,
      })),
      status: 'awaiting_ai',
    });

    if (!patchRes.success) {
      showAlert('main-alert', window.api.formatApiMessage(patchRes, 'Could not save application fields.'), 'error');
      return;
    }

    const pendingRes = await window.api.getPendingApplicationFields(activeApplicationId);
    const pendingCount = pendingRes?.pendingFields?.length || patchRes.pendingAiCount || 0;
    const filledCount = classifiedFields.filter((field) => field.fillStatus === 'filled').length;

    const resultRes = await window.api.getApplicationResult(activeApplicationId);
    const taskStatusRes = activeTaskId
      ? await window.api.getApplicationTaskStatus(activeTaskId)
      : null;
    if (taskStatusRes?.success) lastGptTaskStatus = taskStatusRes;
    if (resultRes?.success) {
      renderApplicationStatus(resultRes, taskStatusRes?.success ? taskStatusRes : null);
      renderDevCaptureDebug(buildDevCaptureFromWorkflow({
        applicationId: activeApplicationId,
        platform: detectPlatformFromUrl(jobUrl),
        scanMeta,
        scannedFields,
        classifiedFields,
        fillResults,
        serverResult: resultRes,
        discovery,
      }));
    } else {
      renderDevCaptureDebug(buildDevCaptureFromWorkflow({
        applicationId: activeApplicationId,
        platform: detectPlatformFromUrl(jobUrl),
        scanMeta,
        scannedFields,
        classifiedFields,
        fillResults,
        discovery,
      }));
    }

    const pendingUploadCount = (pendingRes?.pendingFields || []).filter(
      (field) => field.category === 'document_upload' || field.fieldType === 'file'
    ).length;
    const pendingTextCount = pendingCount - pendingUploadCount;

    if (willUseCustomGpt && activeTaskId) {
      try {
        await chrome.runtime.sendMessage({
          type: 'RELEASE_UI_FOR_GPT',
          jobTabId: targetTabId,
        }).catch(() => {});
        await dispatchGptTask(activeApplicationId, { pollAndApply: true, taskId: activeTaskId });
      } catch (e) {
        showAlert(
          'main-alert',
          `Session #${activeApplicationId} saved, but Custom GPT handoff failed: ${e?.message || e}. Use "Send PROCESS_TASK".`,
          'warn'
        );
      }
    } else if (pendingCount > 0) {
      showAlert(
        'main-alert',
        `Session #${activeApplicationId}: ${filledCount} filled, ${pendingCount} field(s) still pending.`,
        'warn'
      );
    } else {
      showAlert(
        'main-alert',
        `Session #${activeApplicationId}: filled ${filledCount}. No AI questions on this page.`,
        'success'
      );
    }
  } finally {
    hideLoading(true);
  }
}

// ---- Save / Update ----
async function doSave() {
  clearErrors();
  const title = document.getElementById('f-title').value.trim();
  const company = document.getElementById('f-company').value.trim();
  const url = document.getElementById('f-url').value.trim();
  const description = document.getElementById('f-desc').value.trim();

  let valid = true;
  if (!title) { showFieldError('err-title'); valid = false; }
  if (!company) { showFieldError('err-company'); valid = false; }
  if (!url) { showFieldError('err-url'); valid = false; }
  if (!valid) return;

  const candidateStatusesArr = candidates.map(c => ({
    candidateId: Number(c.id),
    status: isCandidateLocked(c.id) ? 'applied' : (candidateStatuses[c.id] || 'none'),
  }));

  const payload = {
    title,
    company,
    url,
    description,
    ...(currentSource ? { source: currentSource } : {}),
    candidateStatuses: candidateStatusesArr,
  };

  const saveBtn = document.getElementById('btn-save');
  const wasUpdate = !!existingJobId;
  const refreshBtn = document.getElementById('btn-refresh');

  showLoading(wasUpdate ? 'Updating job…' : 'Saving job…');
  try {
    saveBtn.disabled = true;
    if (refreshBtn) refreshBtn.disabled = true;
    const r = await window.api.upsertJob(payload);

    if (r.success) {
      showAlert('main-alert', wasUpdate ? 'Job updated!' : 'Job saved!', 'success');
      if (r.job) {
        existingJobId = r.job.id;
        jobSavedInBackend = true;
        syncCandidateStatusesFromJob(r.job.candidateStatuses || []);
        currentSource = r.job.source || currentSource;
        await writeSavedJobToCache(r.job.url || url, r.job);
        renderCandidates();
        updateJobSummary();
      }
      saveBtn.textContent = 'Update Job';
    } else {
      showAlert('main-alert', formatApiError(r), 'error');
    }
  } catch (e) {
    console.error('doSave error:', e);
    showAlert('main-alert', 'The local server is not available. Check that it is running.', 'error');
  } finally {
    saveBtn.disabled = false;
    if (refreshBtn) refreshBtn.disabled = false;
    hideLoading(true);
  }
}

async function doRefresh() {
  const refreshBtn = document.getElementById('btn-refresh');
  const saveBtn = document.getElementById('btn-save');
  showLoading('Refreshing…');
  if (refreshBtn) refreshBtn.disabled = true;
  if (saveBtn) saveBtn.disabled = true;
  try {
    existingJobId = null;
    jobSavedInBackend = false;
    candidateStatuses = {};
    candidateAppliedAt = {};
    candidateLocked = {};
    currentSource = '';
    clearErrors();
    clearAlert('main-alert');
    document.getElementById('btn-save').textContent = 'Save Job';
    ['f-title', 'f-company', 'f-url', 'f-desc'].forEach(id => document.getElementById(id).value = '');
    updateJobSummary();
    await loadAll(true);
  } finally {
    if (refreshBtn) refreshBtn.disabled = false;
    if (saveBtn) saveBtn.disabled = false;
    hideLoading(true);
  }
}

// ---- UI helpers ----
function showLogin() {
  document.getElementById('login-section').classList.remove('hidden');
  document.getElementById('job-section').classList.add('hidden');
  document.getElementById('action-bar').classList.add('hidden');
  clearSession();
  resetLoginFormView();
  scheduleFitPopup();
  return prepareLoginForm();
}

function showJobSection() {
  document.getElementById('login-section').classList.add('hidden');
  document.getElementById('job-section').classList.remove('hidden');
  document.getElementById('action-bar').classList.remove('hidden');
  scheduleFitPopup();
}

let popupToastSeq = 0;
const popupToastTimers = new WeakMap();
const TOAST_AUTO_HIDE_MS = 6000;
const TOAST_MIN_HIDE_MS = 5000;
const TOAST_MAX_VISIBLE = 8;
const TOAST_EXIT_MS = 320;

function normalizeToastType(type) {
  const value = String(type || 'info').toLowerCase();
  if (['success', 'fail', 'error', 'info', 'warn', 'applied'].includes(value)) return value;
  return 'info';
}

function dismissPopupToast(toast) {
  if (!toast || !toast.isConnected) return;
  const timer = popupToastTimers.get(toast);
  if (timer) clearTimeout(timer);
  popupToastTimers.delete(toast);
  toast.classList.remove('is-visible');
  toast.classList.add('is-leaving');
  setTimeout(() => toast.remove(), TOAST_EXIT_MS);
}

function trimPopupToastStack(host) {
  while (host.children.length > TOAST_MAX_VISIBLE) {
    dismissPopupToast(host.children[0]);
  }
}

function showToast(msg, type = 'info', durationMs = TOAST_AUTO_HIDE_MS) {
  const host = document.getElementById('qts-toast-host');
  if (!host) return;

  const toastType = normalizeToastType(type);
  const hideMs = Number.isFinite(durationMs) && durationMs >= TOAST_MIN_HIDE_MS
    ? durationMs
    : TOAST_AUTO_HIDE_MS;

  popupToastSeq += 1;

  const toast = document.createElement('div');
  toast.className = `qts-toast qts-toast--${toastType}`;
  toast.setAttribute('role', 'alert');

  const indexEl = document.createElement('span');
  indexEl.className = 'qts-toast-index';
  indexEl.textContent = String(popupToastSeq);

  const textEl = document.createElement('span');
  textEl.className = 'qts-toast-text';
  textEl.textContent = String(msg || '');

  toast.appendChild(indexEl);
  toast.appendChild(textEl);
  host.appendChild(toast);
  trimPopupToastStack(host);

  requestAnimationFrame(() => {
    requestAnimationFrame(() => toast.classList.add('is-visible'));
  });

  const timer = setTimeout(() => dismissPopupToast(toast), hideMs);
  popupToastTimers.set(toast, timer);
}

function showAlert(id, msg, type = 'info') {
  showToast(msg, type);
  const el = document.getElementById(id);
  if (el) el.innerHTML = '';
}

function clearAlert(id) {
  const host = document.getElementById('qts-toast-host');
  if (host) {
    [...host.children].forEach((toast) => dismissPopupToast(toast));
  }
  const el = document.getElementById(id);
  if (el) el.innerHTML = '';
}

function showFieldError(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('visible');
}

function clearErrors() {
  document.querySelectorAll('.field-error').forEach(e => e.classList.remove('visible'));
}

function formatDate(value) {
  if (!value) return '—';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function escHtml(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function escAttr(s) {
  return escHtml(s).replace(/'/g, '&#39;');
}

async function storeToken(token) {
  window.api.setCachedToken(token);
  if (global.__qtsBidderAuth?.setPopupAuthToken) {
    return global.__qtsBidderAuth.setPopupAuthToken(token);
  }
  return global.__qtsBidderAuth?.setPopupCachedToken?.(token);
}

async function getStoredToken() {
  if (global.__qtsBidderAuth?.getPopupAuthToken) {
    const token = await global.__qtsBidderAuth.getPopupAuthToken();
    window.api.setCachedToken(token);
    return token;
  }
  return '';
}

function clearToken() {
  window.api.clearCachedToken();
  global.__qtsBidderAuth?.clearPopupCachedToken?.();
  return Promise.resolve();
}
