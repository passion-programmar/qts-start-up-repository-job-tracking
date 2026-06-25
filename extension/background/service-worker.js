// Background service worker — tab tracking, capture window, messages

importScripts('../shared/job-detect.js');

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
const JOB_PANEL_WATCH_FILE = 'content/job-panel-watch.js';
const LINKEDIN_PANEL_WATCH_FILE = 'content/linkedin-panel-watch.js';
const AUTO_DETECT_DELAY_MS = 700;

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

  for (const file of EXTRACTOR_FILES) {
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: [file] });
    } catch (err) {
      console.warn('[QTS_Startup] Skipped injection on', tab.url, file, err?.message || err);
      return false;
    }
  }
  return true;
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
});

chrome.tabs.onActivated.addListener((activeInfo) => {
  runDetectForActiveTab(activeInfo.tabId).catch(() => {});
  if (captureWindowId !== null) {
    lastSourceTabId = activeInfo.tabId;
    chrome.runtime.sendMessage({ type: 'SET_SOURCE_TAB', tabId: activeInfo.tabId }).catch(() => {});
  }
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
  removeDetectedJobForTab(tabId).catch(() => {});
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
