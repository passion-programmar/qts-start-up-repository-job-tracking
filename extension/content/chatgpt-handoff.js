// Injected on chatgpt.com — experimental PROCESS_TASK composer handoff (manual Action approval).
(function initChatGptHandoff() {
  if (window.__qtsChatGptHandoffLoaded) return;
  window.__qtsChatGptHandoffLoaded = true;
  const ALLOW_LABELS = /^(allow|always allow|confirm|run|approve|yes|continue)$/i;

  function isAllowLabel(label) {
    const text = cleanText(label).toLowerCase();
    if (!text || text.length > 48) return false;
    if (/always allow/.test(text)) return true;
    if (/^allow(\b|$|\.)/.test(text)) return true;
    if (ALLOW_LABELS.test(text)) return true;
    return false;
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function cleanText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function parseTaskId(message) {
    const match = String(message || '').match(/task_[\w-]+/i);
    return match ? match[0] : null;
  }

  function getClickableLabel(el) {
    if (!el) return '';
    return cleanText(el.textContent || el.getAttribute('aria-label') || el.getAttribute('title'));
  }

  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.pointerEvents === 'none') {
      return false;
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 4 && rect.height > 4;
  }

  function isExcludedStarterZone(el) {
    return Boolean(el.closest(
      'nav, header, footer, aside, [role="navigation"], form, [data-testid="profile-button"]'
    ));
  }

  function resolveClickTarget(el) {
    if (!el) return null;
    const direct = el.closest('button, [role="button"], a, [tabindex="0"]');
    if (direct && isVisible(direct)) return direct;
    if (el.matches('button, [role="button"], a, [tabindex="0"]') && isVisible(el)) return el;
    return isVisible(el) ? el : null;
  }

  function starterMatchesLabel(label, taskId, message) {
    const text = label.toLowerCase();
    if (!text) return false;
    const full = cleanText(message).toLowerCase();
    if (taskId && text === taskId.toLowerCase()) return true;
    if (full && text === full) return true;
    if (taskId && text.includes(taskId.toLowerCase())) return true;
    if (full && text.includes(full)) return true;
    if (taskId) {
      const num = taskId.replace(/^task_/, '');
      if (num && (text === num || text.includes(`session ${num}`) || text.includes(`application id ${num}`))) {
        return true;
      }
    }
    return /^process_task:\s*task_[\w-]+$/i.test(text);
  }

  function findExactTextStarter(taskId) {
    if (!taskId) return null;
    const tid = taskId.toLowerCase();
    const matches = [];
    document.querySelectorAll('button, [role="button"], a, div, span').forEach((el) => {
      if (!isVisible(el) || isExcludedStarterZone(el)) return;
      const label = getClickableLabel(el);
      if (label.toLowerCase() !== tid) return;
      const target = resolveClickTarget(el);
      if (target) matches.push({ el: target, label, size: label.length });
    });
    matches.sort((a, b) => a.size - b.size);
    return matches[0]?.el || null;
  }

  function scoreStarter(el, label, taskId) {
    let score = 10;
    const text = label.toLowerCase();
    const tid = (taskId || '').toLowerCase();
    if (tid && text === tid) score += 100;
    if (/^process_task:/i.test(label)) score += 60;
    if (el.matches('button')) score += 20;
    if (el.getAttribute('role') === 'button') score += 15;
    if (el.closest('main, [role="main"], #thread, [class*="thread" i]')) score += 10;
    if (isExcludedStarterZone(el)) score -= 100;
    return score;
  }

  function findConversationStarter(taskId, message) {
    const exact = findExactTextStarter(taskId);
    if (exact) return exact;

    if (!taskId && !message) return null;
    const candidates = new Set();
    ['button', '[role="button"]', 'a', '[tabindex="0"]', '[data-testid*="conversation" i]'].forEach((selector) => {
      try {
        document.querySelectorAll(selector).forEach((el) => candidates.add(el));
      } catch {
        // ignore
      }
    });

    const matches = [];
    for (const raw of candidates) {
      const el = resolveClickTarget(raw);
      if (!el || !isVisible(el) || isExcludedStarterZone(el)) continue;
      const label = getClickableLabel(el);
      if (!starterMatchesLabel(label, taskId, message)) continue;
      matches.push({ el, label, score: scoreStarter(el, label, taskId) });
    }
    matches.sort((a, b) => b.score - a.score);
    return matches[0]?.el || null;
  }

  function clickElement(el) {
    const target = resolveClickTarget(el) || el;
    try {
      target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' });
    } catch {
      target.scrollIntoView();
    }
    target.focus?.();
    target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, view: window }));
    target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
    target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    if (typeof target.click === 'function') target.click();
  }

  function findAllowButtons() {
    const matches = [];
    document.querySelectorAll('button, [role="button"], a').forEach((el) => {
      if (!isVisible(el)) return;
      const label = getClickableLabel(el);
      if (!label || label.length > 48) return;
      if (!isAllowLabel(label)) return;
      if (el.closest('nav, header, footer')) return;
      let score = 10;
      if (/always allow/i.test(label)) score += 30;
      if (/^allow$/i.test(label)) score += 20;
      matches.push({ el, label, score });
    });
    matches.sort((a, b) => b.score - a.score);
    return matches.map((m) => m.el);
  }

  function clickAllowButtons() {
    const buttons = findAllowButtons();
    let clicked = 0;
    for (const btn of buttons) {
      clickElement(btn);
      clicked += 1;
    }
    return { clicked, labels: buttons.map((b) => getClickableLabel(b)) };
  }

  async function clickConversationStarter(taskId, message) {
    const tid = taskId || parseTaskId(message);
    const msg = cleanText(message) || (tid ? `PROCESS_TASK: ${tid}` : '');
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const starter = findConversationStarter(tid, msg);
      if (starter) {
        clickElement(starter);
        await sleep(800);
        return {
          ok: true,
          sent: true,
          attempt,
          method: 'conversation_starter',
          label: getClickableLabel(starter),
          taskId: tid,
        };
      }
      await sleep(350);
    }
    return { ok: false, sent: false, taskId: tid, found: false };
  }

  function resolveEditable(el) {
    if (!el) return null;
    if (el instanceof HTMLTextAreaElement) return el;
    if (el instanceof HTMLElement && el.isContentEditable) return el;
    const parentEditable = el.closest?.('[contenteditable="true"]');
    if (parentEditable instanceof HTMLElement) return parentEditable;
    const inner = el.querySelector?.('[contenteditable="true"], .ProseMirror, textarea');
    if (inner instanceof HTMLTextAreaElement) return inner;
    if (inner instanceof HTMLElement && inner.isContentEditable) return inner;
    return null;
  }

  function isConnectedVisible(el) {
    if (!el || !el.isConnected || el.offsetParent === null) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 40 && rect.height > 12;
  }

  function findPromptEditor() {
    const selectors = [
      'div#prompt-textarea[contenteditable="true"]',
      '#prompt-textarea',
      'div[contenteditable="true"][data-id]',
      'div[role="textbox"][contenteditable="true"]',
      '[data-testid="message-input"]',
      '[data-testid="composer-text-input"]',
      'form[data-type="unified-composer"] [contenteditable="true"]',
      'form div.ProseMirror[contenteditable="true"]',
      'div.ProseMirror[contenteditable="true"]',
      'main div[contenteditable="true"]',
      'textarea[placeholder*="Ask" i]',
      'textarea[placeholder*="Message" i]',
    ];

    for (const selector of selectors) {
      try {
        const el = document.querySelector(selector);
        const editable = resolveEditable(el);
        if (editable && isConnectedVisible(editable)) return editable;
      } catch {
        // ignore
      }
    }

    const positioned = [];
    document.querySelectorAll('div[contenteditable="true"], textarea').forEach((el) => {
      if (!isConnectedVisible(el)) return;
      if (el.closest('nav, header, aside, [role="navigation"]')) return;
      const rect = el.getBoundingClientRect();
      if (rect.bottom < window.innerHeight * 0.45) return;
      positioned.push({ el, score: rect.bottom * 2 + rect.width });
    });
    positioned.sort((a, b) => b.score - a.score);
    if (positioned[0]?.el) return resolveEditable(positioned[0].el) || positioned[0].el;

    const askNode = Array.from(document.querySelectorAll('p, div, span')).find((node) => (
      /ask anything|message chatgpt|ask chatgpt/i.test(String(node.textContent || node.getAttribute?.('data-placeholder') || ''))
    ));
    if (askNode instanceof HTMLElement) {
      askNode.click();
      const editable = resolveEditable(askNode) || askNode.closest?.('[contenteditable="true"]');
      if (editable instanceof HTMLElement) return editable;
    }

    return null;
  }

  function activateComposer() {
    const editor = findPromptEditor();
    if (!editor) return null;
    try {
      editor.scrollIntoView({ block: 'center', behavior: 'auto' });
    } catch {
      editor.scrollIntoView?.();
    }
    editor.click();
    editor.focus();
    return editor;
  }

  function runHandoffStep(text) {
    const shared = window.__qtsChatGptComposerHandoff?.runUnifiedComposerHandoff?.(text);
    if (shared && (shared.sent || shared.needsManualSend || shared.phase !== 'no_editor')) {
      return shared;
    }

    const message = cleanText(text);
    if (!message) return { ok: false, sent: false, phase: 'empty', error: 'Empty message.' };

    const editor = activateComposer();
    if (!editor) {
      return { ok: false, sent: false, phase: 'no_editor', error: 'Waiting for ChatGPT composer…' };
    }

    const target = resolveEditable(editor) || editor;
    if (!(target instanceof HTMLElement)) {
      return { ok: false, sent: false, phase: 'no_editable', error: 'Composer not editable.' };
    }

    const before = readEditorText(target);
    if (!before.includes(message.slice(0, 8))) {
      if (!insertTextIntoEditor(target, message)) {
        return { ok: false, sent: false, phase: 'insert_failed', error: 'Could not type into composer.' };
      }
    }

    const after = readEditorText(target);
    if (!after.includes(message.slice(0, 8))) {
      return { ok: false, sent: false, phase: 'insert_failed', error: 'Text did not appear in composer.' };
    }

    const submit = performSubmitWithFallback(target);
    if (submit.sent) {
      return { ok: true, sent: true, method: submit.method, phase: 'typed_and_sent' };
    }

    return {
      ok: true,
      sent: false,
      needsManualSend: true,
      method: submit.method,
      phase: 'typed_needs_enter',
      editorText: after,
      message,
    };
  }

  function showHandoffToast(message, type) {
    const root = document.body || document.documentElement;
    if (!root) return;
    const id = 'qts-gpt-handoff-toast';
    let el = document.getElementById(id);
    if (!el) {
      el = document.createElement('div');
      el.id = id;
      el.style.cssText = [
        'position:fixed', 'top:16px', 'left:50%', 'transform:translateX(-50%)',
        'z-index:2147483647', 'max-width:min(520px,92vw)', 'padding:12px 16px',
        'border-radius:10px', 'font:14px/1.4 system-ui,sans-serif',
        'box-shadow:0 8px 24px rgba(0,0,0,.25)', 'color:#fff',
      ].join(';');
      root.appendChild(el);
    }
    el.style.background = type === 'success' ? '#15803d' : type === 'error' ? '#b91c1c' : '#b45309';
    el.textContent = message;
  }

  async function waitForComposer(maxMs = 45000) {
    const started = Date.now();
    while (Date.now() - started < maxMs) {
      const editor = findPromptEditor();
      if (editor) return editor;
      await sleep(400);
    }
    return null;
  }

  function readEditorText(editor) {
    if (!editor) return '';
    if (editor instanceof HTMLTextAreaElement) return String(editor.value || '').trim();
    return cleanText(editor.textContent || '');
  }

  function insertTextIntoEditor(editor, text) {
    const target = resolveEditable(editor) || editor;
    if (!target) return false;

    try {
      target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' });
    } catch {
      target.scrollIntoView?.();
    }

    target.focus();
    clickElement(target);

    if (target instanceof HTMLTextAreaElement) {
      target.value = text;
      target.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        inputType: 'insertText',
        data: text,
        composed: true,
      }));
      target.dispatchEvent(new Event('change', { bubbles: true }));
      return readEditorText(target).includes(text.slice(0, 8));
    }

    if (!(target instanceof HTMLElement) || !target.isContentEditable) return false;

    try {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(target);
      selection?.removeAllRanges();
      selection?.addRange(range);
      document.execCommand('selectAll', false, null);
      document.execCommand('delete', false, null);
    } catch {
      // ignore
    }

    let inserted = false;
    try {
      inserted = document.execCommand('insertText', false, text);
    } catch {
      inserted = false;
    }

    if (!inserted || !readEditorText(target).includes(text.slice(0, 8))) {
      try {
        target.textContent = text;
        target.dispatchEvent(new InputEvent('input', {
          bubbles: true,
          cancelable: true,
          composed: true,
          inputType: 'insertText',
          data: text,
        }));
        inserted = readEditorText(target).length > 0;
      } catch {
        inserted = false;
      }
    }

    return inserted && readEditorText(target).length > 0;
  }

  function findSendButton() {
    const selectors = [
      'button[data-testid="send-button"]',
      'button[aria-label="Send prompt"]',
      'button[aria-label="Send message"]',
      'button[aria-label="Send"]',
      'button[type="submit"]',
    ];
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el instanceof HTMLButtonElement && isVisible(el) && !el.disabled) return el;
    }
    return null;
  }

  function performSubmitWithFallback(editor) {
    const sendBtn = findSendButton();
    if (sendBtn) {
      clickElement(sendBtn);
      if (readEditorText(editor) === '') {
        return { sent: true, method: 'composer_send' };
      }
    }

    editor.focus();
    for (const eventType of ['keydown', 'keypress', 'keyup']) {
      editor.dispatchEvent(new KeyboardEvent(eventType, {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13,
        bubbles: true,
        cancelable: true,
        composed: true,
      }));
    }

    if (readEditorText(editor) === '') {
      return { sent: true, method: 'composer_enter' };
    }

    editor.dispatchEvent(new InputEvent('beforeinput', {
      inputType: 'insertParagraph',
      bubbles: true,
      cancelable: true,
      composed: true,
    }));

    if (readEditorText(editor) === '') {
      return { sent: true, method: 'composer_insert_paragraph' };
    }

    return { sent: false, method: 'composer_paste' };
  }

  async function trySendFromComposer(message, { maxWaitMs = 45000 } = {}) {
    const text = cleanText(message);
    if (!text) return { ok: false, sent: false, error: 'Empty PROCESS_TASK message.' };

    const editor = await waitForComposer(maxWaitMs);
    if (!editor) {
      return { ok: false, sent: false, error: 'ChatGPT composer not ready yet.' };
    }

    if (!insertTextIntoEditor(editor, text)) {
      return { ok: false, sent: false, error: 'Could not insert text into ChatGPT composer.' };
    }

    await sleep(500);

    for (let attempt = 0; attempt < 8; attempt += 1) {
      const submit = await performSubmitWithFallback(editor);
      if (submit.sent) {
        return { ok: true, sent: true, method: submit.method, attempt };
      }
      await sleep(350);
    }

    return {
      ok: true,
      sent: false,
      method: 'composer_paste',
      needsManualSend: true,
      message: text,
    };
  }

  async function runHandoff({ taskId, message, preferStarter = true, composerWaitMs = 45000 } = {}) {
    const tid = taskId || parseTaskId(message);
    const fullMessage = cleanText(message) || (tid ? `PROCESS_TASK: ${tid}` : '');

    if (preferStarter && tid) {
      const starterResult = await clickConversationStarter(tid, fullMessage);
      if (starterResult.sent) return starterResult;
    }

    const composerResult = await trySendFromComposer(fullMessage, { maxWaitMs: composerWaitMs });
    if (composerResult?.sent) {
      return { ...composerResult, taskId: tid };
    }
    if (composerResult?.needsManualSend) {
      return { ...composerResult, taskId: tid };
    }

    return {
      ok: false,
      sent: false,
      error: composerResult?.error || 'ChatGPT composer not ready — paste PROCESS_TASK manually.',
      taskId: tid,
    };
  }

  async function insertTaskMessage(message, options = {}) {
    return runHandoff({
      taskId: options.taskId,
      message,
      preferStarter: options.preferStarter !== false,
    });
  }

  if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg.type === 'QTS_GPT_HANDOFF_STEP') {
        try {
          sendResponse(runHandoffStep(msg.message));
        } catch (e) {
          sendResponse({ ok: false, error: e.message, phase: 'error' });
        }
        return false;
      }
      if (msg.type === 'QTS_GPT_SHOW_TOAST') {
        showHandoffToast(msg.message, msg.toastType || 'warn');
        sendResponse({ ok: true });
        return false;
      }
      if (msg.type === 'QTS_GPT_RUN_HANDOFF') {
        runHandoff({
          taskId: msg.taskId,
          message: msg.message,
          preferStarter: msg.preferStarter !== false,
          composerWaitMs: msg.composerWaitMs || 45000,
        }).then(sendResponse).catch((e) => sendResponse({ ok: false, error: e.message }));
        return true;
      }
      if (msg.type === 'QTS_GPT_CLICK_ALLOW') {
        sendResponse({ clicked: 0, skipped: true, reason: 'manual_approval_required' });
        return false;
      }
      return false;
    });
  }

  window.__qtsChatGptHandoff = {
    insertTaskMessage,
    runHandoff,
    runHandoffStep,
    showHandoffToast,
    clickConversationStarter,
    clickAllowButtons,
    findConversationStarter,
    findPromptEditor,
    waitForComposer,
    parseTaskId,
  };
})();
