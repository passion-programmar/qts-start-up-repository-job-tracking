// Shared ChatGPT unified-composer handoff (ProseMirror #prompt-textarea).
// Loaded in content scripts and service worker (importScripts).
(function initQtsChatGptComposerHandoff(global) {
  if (global.__qtsChatGptComposerHandoff) return;

  function cleanText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function isVisible(el) {
    if (!el?.isConnected) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 24 && rect.height > 8;
  }

  function readEditorText(editor) {
    if (!editor) return '';
    if (editor instanceof HTMLTextAreaElement) return cleanText(editor.value);
    return cleanText(editor.textContent || editor.innerText || '');
  }

  function findUnifiedComposerEditor() {
    const form = document.querySelector('form[data-type="unified-composer"]');
    if (form) {
      const editor = form.querySelector(
        'div#prompt-textarea.ProseMirror[contenteditable="true"],' +
        'div.ProseMirror#prompt-textarea[role="textbox"],' +
        'div.ProseMirror[contenteditable="true"][role="textbox"]'
      );
      if (editor instanceof HTMLElement && isVisible(editor)) return editor;
    }

    const selectors = [
      'div#prompt-textarea.ProseMirror[contenteditable="true"]',
      '#thread-bottom div#prompt-textarea[contenteditable="true"]',
      'form[data-type="unified-composer"] div[contenteditable="true"]',
      'div[role="textbox"][contenteditable="true"]#prompt-textarea',
    ];
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el instanceof HTMLElement && el.isContentEditable && isVisible(el)) return el;
    }

    const placeholder = document.querySelector(
      'p[data-placeholder="Ask anything"], p.placeholder[data-empty-paragraph="true"]'
    );
    if (placeholder instanceof HTMLElement) {
      const editable = placeholder.closest('[contenteditable="true"]');
      if (editable instanceof HTMLElement && isVisible(editable)) return editable;
    }

    return null;
  }

  function activateComposer(editor) {
    const surface = editor.closest('[data-composer-surface="true"]');
    if (surface instanceof HTMLElement) {
      surface.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      surface.click();
    }

    const placeholder = editor.querySelector(
      'p[data-placeholder="Ask anything"], p.placeholder[data-empty-paragraph="true"], p[data-empty-paragraph]'
    );
    if (placeholder instanceof HTMLElement) {
      placeholder.click();
    }

    editor.scrollIntoView({ block: 'center', behavior: 'auto' });
    editor.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    editor.click();
    editor.focus();

    try {
      const selection = window.getSelection();
      const range = document.createRange();
      const para = editor.querySelector('p') || editor;
      range.selectNodeContents(para);
      range.collapse(false);
      selection?.removeAllRanges();
      selection?.addRange(range);
    } catch {
      // ignore
    }
  }

  function dispatchInput(editor, text, inputType) {
    const before = new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      composed: true,
      inputType,
      data: text,
    });
    editor.dispatchEvent(before);
    if (!before.defaultPrevented) {
      editor.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        composed: true,
        inputType,
        data: text,
      }));
    }
  }

  function syncFallbackTextarea(editor, text) {
    const form = editor.closest('form[data-type="unified-composer"]');
    const fallback = form?.querySelector('textarea[name="prompt-textarea"]');
    if (!(fallback instanceof HTMLTextAreaElement)) return false;
    fallback.value = text;
    fallback.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      composed: true,
      inputType: 'insertText',
      data: text,
    }));
    fallback.dispatchEvent(new Event('change', { bubbles: true }));
    return readEditorText(editor).includes(text.slice(0, 8)) || fallback.value.includes(text.slice(0, 8));
  }

  function isVoiceOrDictationButton(btn) {
    if (!(btn instanceof HTMLButtonElement)) return false;
    const label = (btn.getAttribute('aria-label') || '').toLowerCase();
    return /voice|dictation|microphone|start voice/i.test(label);
  }

  function insertViaFallbackTextarea(editor, text) {
    const form = editor.closest('form[data-type="unified-composer"]');
    const fallback = form?.querySelector('textarea[name="prompt-textarea"]');
    if (!(fallback instanceof HTMLTextAreaElement)) return false;

    activateComposer(editor);
    fallback.focus();

    const nativeSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      'value'
    )?.set;
    if (nativeSetter) {
      nativeSetter.call(fallback, text);
    } else {
      fallback.value = text;
    }

    fallback.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      composed: true,
      inputType: 'insertText',
      data: text,
    }));
    fallback.dispatchEvent(new Event('change', { bubbles: true }));

    editor.focus();
  }

  function typeLikeUser(editor, text) {
    activateComposer(editor);
    const target = editor;
    target.focus();
    for (const ch of text) {
      target.dispatchEvent(new KeyboardEvent('keydown', {
        key: ch, code: `Key${ch.toUpperCase()}`, bubbles: true, cancelable: true, composed: true,
      }));
      try {
        document.execCommand('insertText', false, ch);
      } catch {
        // ignore
      }
      target.dispatchEvent(new InputEvent('input', {
        bubbles: true, composed: true, inputType: 'insertText', data: ch,
      }));
      target.dispatchEvent(new KeyboardEvent('keyup', {
        key: ch, code: `Key${ch.toUpperCase()}`, bubbles: true, composed: true,
      }));
    }
  }

  function insertCharByChar(editor, text) {
    activateComposer(editor);
    editor.focus();
    typeLikeUser(editor, text);
    for (const ch of text) {
      try {
        document.execCommand('insertText', false, ch);
      } catch {
        // ignore
      }
    }
  }

  function insertIntoProseMirror(editor, text) {
    if (!(editor instanceof HTMLElement) || !editor.isContentEditable) return false;
    activateComposer(editor);

    if (readEditorText(editor).includes(text.slice(0, 8))) return true;

    insertViaFallbackTextarea(editor, text);
    if (readEditorText(editor).includes(text.slice(0, 8))) return true;

    try {
      document.execCommand('selectAll', false, null);
      document.execCommand('delete', false, null);
      if (document.execCommand('insertText', false, text)) {
        if (readEditorText(editor).includes(text.slice(0, 8))) return true;
      }
    } catch {
      // ignore
    }

    dispatchInput(editor, text, 'insertText');
    if (readEditorText(editor).includes(text.slice(0, 8))) return true;

    dispatchInput(editor, text, 'insertFromPaste');
    if (readEditorText(editor).includes(text.slice(0, 8))) return true;

    try {
      const dt = new DataTransfer();
      dt.setData('text/plain', text);
      editor.dispatchEvent(new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        composed: true,
        clipboardData: dt,
      }));
    } catch {
      // ignore
    }
    if (readEditorText(editor).includes(text.slice(0, 8))) return true;

    const para = editor.querySelector('p');
    if (para instanceof HTMLElement) {
      while (para.firstChild) para.removeChild(para.firstChild);
      para.appendChild(document.createTextNode(text));
      para.removeAttribute('data-empty-paragraph');
      para.classList.remove('placeholder');
      dispatchInput(editor, text, 'insertText');
      if (readEditorText(editor).includes(text.slice(0, 8))) return true;
    }

    insertCharByChar(editor, text);
    if (readEditorText(editor).includes(text.slice(0, 8))) return true;

    return syncFallbackTextarea(editor, text);
  }

  function findSendButton() {
    const form = document.querySelector('form[data-type="unified-composer"]');
    const scope = form || document;
    const selectors = [
      'button[data-testid="send-button"]',
      'button[aria-label="Send prompt"]',
      'button[aria-label="Send message"]',
      'button.composer-submit-button-color',
    ];
    for (const selector of selectors) {
      const nodes = scope.querySelectorAll(selector);
      for (const el of nodes) {
        if (!(el instanceof HTMLButtonElement) || !isVisible(el) || el.disabled) continue;
        if (isVoiceOrDictationButton(el)) continue;
        const label = (el.getAttribute('aria-label') || '').toLowerCase();
        if (label.includes('send') || el.getAttribute('data-testid') === 'send-button') return el;
      }
    }
    return null;
  }

  function spinWait(testFn, maxMs = 1500) {
    const start = Date.now();
    while (Date.now() - start < maxMs) {
      if (testFn()) return true;
    }
    return testFn();
  }

  function trySubmit(editor) {
    spinWait(() => Boolean(findSendButton()), 3000);
    const sendBtn = findSendButton();
    if (sendBtn) {
      sendBtn.click();
      spinWait(() => readEditorText(editor) === '', 1500);
      if (readEditorText(editor) === '') {
        return { sent: true, method: 'unified_send_button' };
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

    spinWait(() => readEditorText(editor) === '', 1000);
    if (readEditorText(editor) === '') {
      return { sent: true, method: 'unified_enter_key' };
    }

    const form = editor.closest('form[data-type="unified-composer"]');
    if (form instanceof HTMLFormElement && typeof form.requestSubmit === 'function') {
      form.requestSubmit();
      spinWait(() => readEditorText(editor) === '', 1000);
      if (readEditorText(editor) === '') {
        return { sent: true, method: 'unified_form_submit' };
      }
    }

    return { sent: false, method: 'unified_needs_manual_send' };
  }

  function runUnifiedComposerHandoff(text) {
    const message = cleanText(text);
    if (!message) {
      return { ok: false, sent: false, phase: 'empty', error: 'Empty message.' };
    }

    const editor = findUnifiedComposerEditor();
    if (!editor) {
      return {
        ok: false,
        sent: false,
        phase: 'no_editor',
        error: 'Waiting for ChatGPT composer…',
        pageUrl: location.href,
      };
    }

    if (!insertIntoProseMirror(editor, message)) {
      return {
        ok: false,
        sent: false,
        phase: 'insert_failed',
        error: 'Could not type into ProseMirror composer.',
        pageUrl: location.href,
        editorText: readEditorText(editor),
      };
    }

    const after = readEditorText(editor);
    if (!after.includes(message.slice(0, 8))) {
      return {
        ok: false,
        sent: false,
        phase: 'insert_failed',
        error: 'Text did not appear in composer.',
        pageUrl: location.href,
        editorText: after,
      };
    }

    const submit = trySubmit(editor);
    if (submit.sent) {
      return { ok: true, sent: true, method: submit.method, phase: 'typed_and_sent', pageUrl: location.href };
    }

    return {
      ok: true,
      sent: false,
      needsManualSend: true,
      method: submit.method,
      phase: 'typed_needs_enter',
      editorText: after,
      pageUrl: location.href,
    };
  }

  global.__qtsChatGptComposerHandoff = {
    runUnifiedComposerHandoff,
    findUnifiedComposerEditor,
    insertIntoProseMirror,
    activateComposer,
    readEditorText,
  };
})(typeof self !== 'undefined' ? self : window);
