// In-page toast alerts

(function () {
  'use strict';

  const TOAST_HOST_ID = 'qts-toast-host';
  const STYLE_ID = 'qts-toast-style';
  const AUTO_HIDE_MS = 2800;

  function normalizeToastType(typeOrSuccess) {
    if (typeof typeOrSuccess === 'boolean') {
      return typeOrSuccess ? 'success' : 'fail';
    }
    const type = String(typeOrSuccess || 'info').toLowerCase();
    if (['success', 'fail', 'error', 'info', 'warn'].includes(type)) return type;
    return 'info';
  }

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${TOAST_HOST_ID} {
        position: fixed;
        top: 16px;
        right: 16px;
        z-index: 2147483646;
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 8px;
        pointer-events: none;
      }
      .qts-toast {
        max-width: min(340px, calc(100vw - 32px));
        padding: 12px 16px;
        border-radius: 10px;
        font: 600 13px/1.35 system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
        color: #fff;
        box-shadow: 0 10px 30px rgba(15, 23, 42, 0.22);
        opacity: 0;
        transform: translateY(-8px);
        transition: opacity 0.2s ease, transform 0.2s ease;
      }
      .qts-toast.is-visible {
        opacity: 1;
        transform: translateY(0);
      }
      .qts-toast--success { background: #15803d; border: 1px solid #166534; }
      .qts-toast--fail { background: #475569; border: 1px solid #334155; }
      .qts-toast--error { background: #b91c1c; border: 1px solid #991b1b; }
      .qts-toast--info { background: #1d4ed8; border: 1px solid #1e40af; }
      .qts-toast--warn { background: #b45309; border: 1px solid #92400e; }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function ensureHost() {
    let host = document.getElementById(TOAST_HOST_ID);
    if (!host) {
      host = document.createElement('div');
      host.id = TOAST_HOST_ID;
      (document.body || document.documentElement).appendChild(host);
    }
    return host;
  }

  window.__showQtsDetectToast = function showQtsToast(message, typeOrSuccess = 'info') {
    ensureStyles();
    const host = ensureHost();
    const type = normalizeToastType(typeOrSuccess);

    host.querySelectorAll('.qts-toast').forEach((node) => node.remove());

    const toast = document.createElement('div');
    toast.className = `qts-toast qts-toast--${type}`;
    toast.setAttribute('role', 'alert');
    toast.textContent = message;
    host.appendChild(toast);

    requestAnimationFrame(() => {
      toast.classList.add('is-visible');
    });

    window.setTimeout(() => {
      toast.classList.remove('is-visible');
      window.setTimeout(() => toast.remove(), 220);
    }, AUTO_HIDE_MS);
  };
})();
