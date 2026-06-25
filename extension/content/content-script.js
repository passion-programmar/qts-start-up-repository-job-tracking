// Content script — injected into all pages
// Loads extractors and exposes window.__extractJobData

(function () {
  'use strict';

  // Guard against double injection
  if (window.__jobCaptureInjected) return;
  window.__jobCaptureInjected = true;

  // Track URL for SPA navigation (job sites only — manifest limits injection)
  const root = document.body || document.documentElement;
  if (!root) return;

  let lastUrl = location.href;
  const urlObserver = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      chrome.runtime.sendMessage({ type: 'URL_CHANGED', url: location.href }).catch(() => {});
    }
  });
  urlObserver.observe(root, { childList: true, subtree: true });

  // Intercept history API
  const origPush = history.pushState.bind(history);
  const origReplace = history.replaceState.bind(history);
  history.pushState = function (...args) { origPush(...args); chrome.runtime.sendMessage({ type: 'URL_CHANGED', url: location.href }).catch(() => {}); };
  history.replaceState = function (...args) { origReplace(...args); chrome.runtime.sendMessage({ type: 'URL_CHANGED', url: location.href }).catch(() => {}); };
})();
