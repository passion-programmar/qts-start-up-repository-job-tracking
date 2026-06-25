// LinkedIn split-view watcher — left job list + right job description panel

(function () {
  'use strict';

  if (window.__qtsLinkedInWatchActive) return;
  window.__qtsLinkedInWatchActive = true;

  const DETAIL_SELECTORS = [
    '.jobs-description-content__text',
    '.jobs-description__content',
    '.job-details-jobs-unified-top-card__job-title',
    '.jobs-unified-top-card__job-title',
    '[class*="jobs-description"]',
  ];

  const TITLE_SELECTORS = [
    '.job-details-jobs-unified-top-card__job-title',
    '.jobs-unified-top-card__job-title',
    'h1',
  ];

  const LIST_CLICK_SELECTORS = [
    '.jobs-search-results__list-item',
    '.job-card-container',
    '.job-card-list__title',
    '.base-search-card__title',
    '[data-job-id]',
    'a[href*="/jobs/view/"]',
  ].join(',');

  let debounceTimer = null;
  let lastFingerprint = '';

  function getDetailText() {
    for (const sel of DETAIL_SELECTORS) {
      try {
        const el = document.querySelector(sel);
        const text = el?.innerText?.trim() || '';
        if (text.length >= 40) return text.slice(0, 400);
      } catch { /* skip */ }
    }
    return '';
  }

  function getTitleText() {
    for (const sel of TITLE_SELECTORS) {
      try {
        const el = document.querySelector(sel);
        const text = el?.innerText?.trim() || '';
        if (text.length >= 3) return text.slice(0, 160);
      } catch { /* skip */ }
    }
    return '';
  }

  function getJobFingerprint() {
    const jobId = window.__linkedInExtractJobId?.() || '';
    const title = getTitleText();
    const panel = getDetailText();
    const currentJobId = new URL(location.href).searchParams.get('currentJobId') || '';
    return `${location.href}::${jobId || currentJobId}::${title}::${panel}`;
  }

  function notifyPanelChanged() {
    const fingerprint = getJobFingerprint();
    if (!fingerprint || fingerprint === lastFingerprint) return;
    lastFingerprint = fingerprint;
    chrome.runtime.sendMessage({
      type: 'JOB_PANEL_CHANGED',
      url: location.href,
      fingerprint,
    }).catch(() => {});
  }

  function scheduleNotify() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(notifyPanelChanged, 900);
  }

  function resetAndNotify() {
    lastFingerprint = '';
    scheduleNotify();
  }

  const root = document.body || document.documentElement;
  if (!root) return;

  const observer = new MutationObserver(scheduleNotify);
  observer.observe(root, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  document.addEventListener('click', (event) => {
    const target = event.target?.closest?.(LIST_CLICK_SELECTORS);
    if (target) resetAndNotify();
  }, true);

  document.addEventListener('keyup', (event) => {
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown' || event.key === 'Enter') {
      resetAndNotify();
    }
  }, true);

  const origPush = history.pushState.bind(history);
  const origReplace = history.replaceState.bind(history);
  history.pushState = function (...args) {
    origPush(...args);
    resetAndNotify();
  };
  history.replaceState = function (...args) {
    origReplace(...args);
    resetAndNotify();
  };

  window.addEventListener('popstate', resetAndNotify);
  scheduleNotify();
})();
