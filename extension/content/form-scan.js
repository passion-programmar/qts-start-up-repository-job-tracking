// Deterministic application form scan + fill (no AI)

(function initFormScan() {
  if (window.__scanApplicationForm) return;
  const HIDDEN_STYLE = ['none', 'hidden', 'collapse'];
  const INTERACTIVE_SELECTOR = [
    'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="image"]):not([disabled])',
    'textarea:not([disabled])',
    'select:not([disabled])',
    '[contenteditable="true"]',
    '[role="textbox"]:not([aria-disabled="true"])',
    '[role="combobox"]:not([aria-disabled="true"])',
    '[role="listbox"]:not([aria-disabled="true"])',
    '[role="spinbutton"]:not([aria-disabled="true"])',
    '[role="checkbox"]:not([aria-disabled="true"])',
    '[role="switch"]:not([aria-disabled="true"])',
  ].join(',');

  function cleanText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function isInApplicationDialog(el) {
    return Boolean(el?.closest('[role="dialog"], [aria-modal="true"], dialog, [class*="modal" i], [class*="Modal" i]'));
  }

  function isVisuallyHiddenInput(el) {
    if (!el) return false;
    const type = cleanText(el.type || '').toLowerCase();
    if (type === 'file' || type === 'checkbox' || type === 'radio') return true;
    const style = window.getComputedStyle(el);
    if (style.position === 'absolute' && (Number(style.width) <= 1 || Number(style.height) <= 1)) return true;
    if (Number(style.opacity) === 0 && (type === 'file' || type === 'checkbox')) return true;
    const rect = el.getBoundingClientRect();
    return rect.width <= 1 && rect.height <= 1;
  }

  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    const style = window.getComputedStyle(el);
    if (HIDDEN_STYLE.includes(style.display) || style.visibility === 'hidden') return false;

    const fieldType = inferFieldType(el);
    if (fieldType === 'file' || fieldType === 'checkbox' || fieldType === 'radio' || fieldType === 'switch') {
      if (isInApplicationDialog(el) || isVisuallyHiddenInput(el)) return true;
    }

    if (Number(style.opacity) === 0 && !isVisuallyHiddenInput(el)) return false;

    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) return true;

    return isVisuallyHiddenInput(el) && isInApplicationDialog(el);
  }

  function isVisibleRoot(node) {
    if (!node?.isConnected) return false;
    const style = window.getComputedStyle(node);
    return !HIDDEN_STYLE.includes(style.display) && style.visibility !== 'hidden';
  }

  function scoreModalAsApplicationForm(root) {
    if (!root) return 0;
    let score = 0;
    const text = cleanText(root.textContent).toLowerCase();

    if (root.querySelector('input[type="file"]')) score += 60;
    if (root.querySelector('input[type="email"], input[autocomplete*="email" i]')) score += 35;
    if (root.querySelector('textarea')) score += 20;
    if (root.querySelector('input[type="checkbox"], [role="checkbox"], [role="switch"]')) score += 15;
    if (root.querySelector('input[type="text"], input:not([type])')) score += 10;

    if (/apply|aplikuj|application|aplikacj/i.test(text)) score += 20;
    if (/wyrażam zgodę|personal data|danych osobowych|recruitment process/i.test(text)) score += 15;
    if (/add document|upload|cv|resume|załącz/i.test(text)) score += 15;

    if (/cookie|privacy settings|zarządzaj plikami cookie|pliki cookie/i.test(text)
      && !root.querySelector('input[type="file"]')) {
      score -= 90;
    }
    if ((/sign in|log in|zaloguj|create account|register/i.test(text))
      && !root.querySelector('input[type="file"]')) {
      score -= 50;
    }

    if (window.__qtsPlatformJustjoin?.scoreApplicationModal) {
      score = window.__qtsPlatformJustjoin.scoreApplicationModal(root, score);
    }

    return score;
  }

  function getVisibleModalRoots() {
    const selectors = [
      '[role="dialog"]',
      '[aria-modal="true"]',
      'dialog',
      '[class*="modal" i][class*="open" i]',
      '[data-testid*="modal" i]',
    ];
    const seen = new Set();
    const roots = [];
    selectors.forEach((selector) => {
      try {
        document.querySelectorAll(selector).forEach((node) => {
          if (seen.has(node) || !isVisibleRoot(node)) return;
          seen.add(node);
          roots.push(node);
        });
      } catch {
        // ignore invalid selectors
      }
    });
    return roots;
  }

  function pickBestApplicationRoots(roots) {
    if (!roots.length) return [];
    const scored = roots
      .map((root) => ({ root, score: scoreModalAsApplicationForm(root) }))
      .sort((a, b) => b.score - a.score);
    const best = scored[0];
    if (best && best.score > 0) return [best.root];
    const withInputs = roots.filter((root) => root.querySelector('input, textarea, select, [role="textbox"]'));
    if (withInputs.length) return [withInputs[withInputs.length - 1]];
    return roots;
  }

  function getScanRoots() {
    if (!window.__qtsResolvingApplyTemplate) {
      const platformRoots = window.__qtsPlatformJustjoin?.getApplicationScanRoots?.();
      if (platformRoots?.length) return platformRoots;
    }

    const dialogs = getVisibleModalRoots();
    if (dialogs.length) return pickBestApplicationRoots(dialogs);
    return [document];
  }

  function getLabelFromFor(el) {
    if (el.id) {
      const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (label) return cleanText(label.textContent);
    }
    const wrappingLabel = el.closest('label');
    if (wrappingLabel) return cleanText(wrappingLabel.textContent);
    return '';
  }

  function getAriaLabel(el) {
    return cleanText(el.getAttribute('aria-label'));
  }

  function getAriaLabelledBy(el) {
    const ids = cleanText(el.getAttribute('aria-labelledby')).split(/\s+/).filter(Boolean);
    if (!ids.length) return '';
    return cleanText(ids.map((id) => document.getElementById(id)?.textContent || '').join(' '));
  }

  function getUploadZoneLabel(el) {
    if (inferFieldType(el) !== 'file') return '';
    let node = el.parentElement;
    for (let depth = 0; node && depth < 5; depth += 1) {
      const text = cleanText(node.textContent);
      if (/add document|upload|cv|resume|attach/i.test(text)) {
        return text.slice(0, 180);
      }
      node = node.parentElement;
    }
    return '';
  }

  function getNearbyText(el) {
    const labelText = getLabelFromFor(el);
    if (labelText) return labelText.slice(0, 220);

    let node = el.parentElement;
    for (let depth = 0; node && depth < 4; depth += 1) {
      const clone = node.cloneNode(true);
      clone.querySelectorAll('input, textarea, select, button, script, style, svg').forEach((child) => child.remove());
      const text = cleanText(clone.textContent);
      if (text.length >= 8) return text.slice(0, 220);
      node = node.parentElement;
    }

    const uploadLabel = getUploadZoneLabel(el);
    if (uploadLabel) return uploadLabel;

    return '';
  }

  function getSectionHeading(el) {
    const fieldset = el.closest('fieldset');
    if (fieldset) {
      const legend = fieldset.querySelector('legend');
      if (legend) return cleanText(legend.textContent);
    }

    const dialog = el.closest('[role="dialog"], dialog, [aria-modal="true"]');
    const heading = dialog?.querySelector('h1, h2, h3, [role="heading"]');
    if (heading) return cleanText(heading.textContent).slice(0, 120);

    let node = el.parentElement;
    for (let depth = 0; node && depth < 6; depth += 1) {
      const localHeading = node.querySelector(':scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > legend, :scope > [role="heading"]');
      if (localHeading && localHeading !== el && !localHeading.contains(el)) {
        const text = cleanText(localHeading.textContent);
        if (text) return text;
      }
      node = node.parentElement;
    }
    return '';
  }

  function resolveLabel(el) {
    return getLabelFromFor(el)
      || getAriaLabel(el)
      || getAriaLabelledBy(el)
      || getUploadZoneLabel(el)
      || getNearbyText(el)
      || cleanText(el.getAttribute('placeholder'));
  }

  function detectRequired(el, label) {
    if (el.required || el.getAttribute('aria-required') === 'true') return true;
    const text = `${label} ${el.getAttribute('placeholder') || ''}`;
    if (/\brequired\b|\*/i.test(text)) return true;
    const describedBy = cleanText(el.getAttribute('aria-describedby'));
    if (describedBy) {
      const message = describedBy
        .split(/\s+/)
        .map((id) => cleanText(document.getElementById(id)?.textContent))
        .join(' ');
      if (/\brequired\b/i.test(message)) return true;
    }
    if (inferFieldType(el) === 'file') {
      return /\*|required|must|cv|resume/i.test(label);
    }
    return false;
  }

  function getValidationMessage(el) {
    if (typeof el.validationMessage === 'string' && el.validationMessage) return cleanText(el.validationMessage);
    const describedBy = cleanText(el.getAttribute('aria-describedby'));
    if (!describedBy) return '';
    return cleanText(
      describedBy
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent || '')
        .join(' ')
    );
  }

  function isSwitchControl(el) {
    const role = cleanText(el.getAttribute('role')).toLowerCase();
    if (role === 'switch') return true;
    if (el.closest('[role="switch"]')) return true;
    const switchWrapper = el.closest(
      '[class*="switch" i], [class*="toggle" i], [data-testid*="switch" i], [data-testid*="toggle" i]'
    );
    if (switchWrapper && switchWrapper !== el) return true;
    const type = cleanText(el.type || '').toLowerCase();
    if (type === 'checkbox') {
      const parent = el.parentElement;
      if (parent?.getAttribute('role') === 'switch') return true;
      const label = cleanText(
        el.closest('label')?.textContent
        || (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent)
      );
      if (/attach a message|message for the employer/i.test(label)) return true;
    }
    return false;
  }

  function inferFieldType(el) {
    const tag = el.tagName.toLowerCase();
    const role = cleanText(el.getAttribute('role')).toLowerCase();
    const type = cleanText(el.type || '').toLowerCase();

    if (role === 'switch') return 'switch';
    if (role === 'checkbox') return 'checkbox';
    if (tag === 'textarea') return 'textarea';
    if (tag === 'select') return 'select';
    if (type === 'checkbox' && isSwitchControl(el)) return 'switch';
    if (type === 'checkbox') return 'checkbox';
    if (type === 'radio') return 'radio';
    if (type === 'file') return 'file';
    if (el.isContentEditable) return 'contenteditable';
    if (role === 'combobox') return 'combobox';
    if (role === 'listbox') return 'listbox';
    if (role === 'textbox') return 'textbox';
    if (type) return type;
    return 'text';
  }

  function getOptions(el) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'select') {
      return Array.from(el.options || [])
        .map((opt) => cleanText(opt.textContent || opt.value))
        .filter(Boolean);
    }
    if (inferFieldType(el) === 'radio') {
      const name = el.name;
      if (!name) return [];
      return Array.from(document.querySelectorAll(`input[type="radio"][name="${CSS.escape(name)}"]`))
        .map((input) => resolveLabel(input) || cleanText(input.value))
        .filter(Boolean);
    }
    return [];
  }

  function getCurrentValue(el) {
    const type = inferFieldType(el);
    if (type === 'checkbox' || type === 'switch') {
      const checked = el.checked || el.getAttribute('aria-checked') === 'true';
      return checked ? 'true' : 'false';
    }
    if (type === 'radio') return el.checked ? cleanText(el.value) : '';
    if (type === 'file') return el.files?.[0]?.name || '';
    if (type === 'contenteditable') return cleanText(el.textContent);
    return cleanText(el.value);
  }

  function buildSelectorHints(el) {
    const hints = { tag: el.tagName.toLowerCase() };
    if (el.id) hints.id = el.id;
    if (el.name) hints.name = el.name;
    if (el.type) hints.type = el.type;
    if (el.getAttribute('role')) hints.role = el.getAttribute('role');
    if (el.getAttribute('data-testid')) hints.testId = el.getAttribute('data-testid');
    if (el.getAttribute('data-automation-id')) hints.automationId = el.getAttribute('data-automation-id');
    if (el.type === 'file' && el.getAttribute('accept')) {
      hints.accept = el.getAttribute('accept');
    }
    return hints;
  }

  function buildFingerprint(el, label, fieldType) {
    const parts = [
      fieldType,
      el.name || '',
      el.id || '',
      el.getAttribute('role') || '',
      label || '',
      el.getAttribute('autocomplete') || '',
      getSectionHeading(el) || '',
      window.location.pathname,
    ];
    return parts.join('|').toLowerCase();
  }

  function buildStableFieldId(el, fingerprint) {
    if (el.id) return `id:${el.id}`;
    if (el.name) return `name:${el.name}:${fieldTypeKey(el)}`;
    if (el.getAttribute('role')) return `role:${el.getAttribute('role')}:${hashString(fingerprint)}`;
    return `fp:${hashString(fingerprint)}`;
  }

  function fieldTypeKey(el) {
    return inferFieldType(el);
  }

  function hashString(value) {
    let hash = 0;
    const text = String(value || '');
    for (let i = 0; i < text.length; i += 1) {
      hash = ((hash << 5) - hash) + text.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash).toString(36);
  }

  function detectPageStep() {
    const stepSelectors = [
      '[aria-current="step"]',
      '.active-step',
      '[data-step].active',
      '.application-step.active',
    ];
    for (const selector of stepSelectors) {
      const node = document.querySelector(selector);
      if (node) return cleanText(node.textContent).slice(0, 120);
    }
    const stepMatch = document.body?.innerText?.match(/step\s+(\d+)\s+of\s+(\d+)/i);
    if (stepMatch) return `step ${stepMatch[1]} of ${stepMatch[2]}`;
    return '';
  }

  const APPLY_LABEL_EXACT = /^(apply(\s+(now|for(\s+this)?(\s+job)?|here|today))?|quick\s+apply|easy\s+apply|submit\s+application|start\s+application|apply\s+for\s+job|aplikuj|wyślij\s+aplikację)$/i;
  const APPLY_LABEL_PARTIAL = /\b(apply(\s+now|\s+for|\s+to)?|quick\s+apply|easy\s+apply|submit\s+application|start\s+application|aplikuj)\b/i;
  const APPLY_BUTTON_SELECTOR = [
    'button',
    'a[href]',
    '[role="button"]',
    'input[type="submit"]',
    'input[type="button"]',
  ].join(',');

  function getClickableLabel(el) {
    const parts = [
      el.getAttribute('aria-label'),
      el.getAttribute('title'),
      el.value,
      el.textContent,
    ];
    const label = cleanText(parts.filter(Boolean).join(' '));
    if (label) return label;
    const labelledBy = cleanText(el.getAttribute('aria-labelledby'));
    if (labelledBy) {
      return cleanText(
        labelledBy
          .split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent || '')
          .join(' ')
      );
    }
    return '';
  }

  function isExcludedApplyControl(el, label) {
    const text = label.toLowerCase();
    if (!text) return true;
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') return true;
    if (/already applied|applied on|view application|withdraw|cancel application|save job|bookmark|share job|report job|filter|sort by|search|sign in|log in|register/i.test(text)) {
      return true;
    }
    if (el.closest('form[role="search"], [role="search"], [class*="search" i], [id*="search" i]')) return true;
    return false;
  }

  function scoreApplyCandidate(el, label) {
    const trimmed = cleanText(label);
    if (!trimmed || trimmed.length > 80) return 0;
    if (isExcludedApplyControl(el, trimmed)) return 0;

    let score = 0;
    if (APPLY_LABEL_EXACT.test(trimmed)) score += 120;
    else if (APPLY_LABEL_PARTIAL.test(trimmed)) score += 70;
    else return 0;

    const testId = cleanText(el.getAttribute('data-testid'));
    if (/apply/i.test(testId)) score += 35;
    if (el.closest('[role="dialog"], dialog, [aria-modal="true"]')) score -= 40;
    if (el.closest('[class*="job" i], [class*="offer" i], [data-testid*="job"], [data-test*="job"]')) score += 25;
    if (el.closest('header, nav, footer, aside')) score -= 8;
    if (el.tagName === 'BUTTON' || el.getAttribute('role') === 'button') score += 12;
    if (el.tagName === 'A' && /apply|aplikuj/i.test(el.getAttribute('href') || '')) score += 15;
    if (window.__qtsPlatformJustjoin?.scoreApplyButton) {
      score = window.__qtsPlatformJustjoin.scoreApplyButton(el, score);
    }
    return score;
  }

  function findApplyButtons() {
    const scored = [];
    document.querySelectorAll(APPLY_BUTTON_SELECTOR).forEach((el) => {
      if (!isVisible(el)) return;
      const label = getClickableLabel(el);
      const score = scoreApplyCandidate(el, label);
      if (score <= 0) return;
      scored.push({ element: el, label, score });
    });
    scored.sort((a, b) => b.score - a.score);
    return scored;
  }

  function clickElement(el) {
    try {
      el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' });
    } catch {
      el.scrollIntoView();
    }
    el.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true, view: window }));
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    if (typeof el.click === 'function') el.click();
  }

  const APPLICATION_FIELD_HINTS = /\b(email|e-mail|phone|mobile|name|resume|cv|cover letter|document|upload|applicant|message)\b/i;

  function looksLikeApplicationForm(scan) {
    const fields = scan?.fields || [];
    if (!fields.length) return false;

    const hasFile = fields.some((field) => field.fieldType === 'file');
    const strongFields = fields.filter((field) => APPLICATION_FIELD_HINTS.test(
      `${field.label} ${field.placeholder} ${field.nameAttr} ${field.autocompleteAttr}`
    ));
    const hasEmail = fields.some((field) => /email/i.test(
      `${field.label} ${field.nameAttr} ${field.autocompleteAttr}`
    ));

    if (hasFile && (hasEmail || strongFields.length >= 2)) return true;
    if (hasEmail && strongFields.length >= 2) return true;
    if (strongFields.length >= 3) return true;
    if (fields.length >= 4 && strongFields.length >= 2) return true;
    return false;
  }

  function clickApplyToOpenForm() {
    const external = window.__qtsPlatformJustjoin?.detectExternalApplyLink?.();
    if (external?.external) {
      return {
        clicked: false,
        reason: 'external_link',
        externalUrl: external.url,
        initialFieldCount: 0,
        candidatesFound: 0,
      };
    }

    const initialScan = scanApplicationForm();
    if (looksLikeApplicationForm(initialScan)) {
      return {
        clicked: false,
        reason: 'form_already_open',
        initialFieldCount: initialScan.fields.length,
        candidatesFound: 0,
      };
    }

    const candidates = findApplyButtons();
    if (!candidates.length) {
      return {
        clicked: false,
        reason: 'no_apply_button',
        initialFieldCount: initialScan.fields.length,
        candidatesFound: 0,
      };
    }

    const best = candidates[0];
    clickElement(best.element);
    return {
      clicked: true,
      reason: 'clicked',
      label: best.label,
      score: best.score,
      initialFieldCount: initialScan.fields.length,
      candidatesFound: candidates.length,
    };
  }

  function shouldSkipRadio(el) {
    return inferFieldType(el) === 'radio'
      && !el.checked
      && document.querySelectorAll(`input[type="radio"][name="${CSS.escape(el.name || '')}"]`).length > 1;
  }

  function collectFieldFromElement(el, pageUrl, pageStep, seen, fields) {
    if (!isVisible(el)) return;
    if (shouldSkipRadio(el)) return;

    const label = resolveLabel(el);
    const fieldType = inferFieldType(el);
    const fingerprint = buildFingerprint(el, label, fieldType);
    if (seen.has(fingerprint)) return;
    seen.add(fingerprint);

    fields.push({
      stableFieldId: buildStableFieldId(el, fingerprint),
      label,
      fieldType,
      required: detectRequired(el, label),
      options: getOptions(el),
      currentValue: getCurrentValue(el),
      placeholder: cleanText(el.getAttribute('placeholder')),
      sectionHeading: getSectionHeading(el),
      pageStep,
      pageUrl,
      nameAttr: cleanText(el.name),
      autocompleteAttr: cleanText(el.getAttribute('autocomplete')),
      validationMessage: getValidationMessage(el),
      selectorHints: buildSelectorHints(el),
      fieldFingerprint: fingerprint,
    });
  }

  function scanApplicationForm() {
    const pageUrl = window.location.href;
    const pageStep = detectPageStep();
    const seen = new Set();
    const fields = [];

    getScanRoots().forEach((root) => {
      root.querySelectorAll(INTERACTIVE_SELECTOR).forEach((el) => {
        collectFieldFromElement(el, pageUrl, pageStep, seen, fields);
      });
    });

    return {
      pageUrl,
      pageTitle: document.title,
      pageStep,
      scannedAt: new Date().toISOString(),
      fields,
    };
  }

  function findTargetElement(field) {
    const hints = field.selectorHints || {};
    if (hints.id) {
      const byId = document.getElementById(hints.id);
      if (byId) return byId;
    }
    if (hints.role && hints.testId) {
      const byTest = document.querySelector(`[role="${CSS.escape(hints.role)}"][data-testid="${CSS.escape(hints.testId)}"]`);
      if (byTest) return byTest;
    }
    if (hints.name) {
      const selector = `${hints.tag || 'input'}[name="${CSS.escape(hints.name)}"]`;
      const byName = document.querySelector(selector);
      if (byName) return byName;
    }
    if (field.nameAttr) {
      const byName = document.querySelector(`[name="${CSS.escape(field.nameAttr)}"]`);
      if (byName) return byName;
    }

    if (field.fieldType === 'file' || field.category === 'document_upload') {
      const roots = window.__qtsPlatformJustjoin?.getApplicationScanRoots?.()
        || Array.from(document.querySelectorAll('[role="dialog"], [aria-modal="true"], dialog'));
      const searchRoots = roots?.length ? roots : [document];
      const fileInputs = [];
      searchRoots.forEach((root) => {
        root.querySelectorAll('input[type="file"]').forEach((input) => {
          if (isVisible(input)) fileInputs.push(input);
        });
      });
      if (fileInputs.length === 1) return fileInputs[0];
      if (fileInputs.length > 1) {
        const label = cleanText(field.label || field.placeholder || '').toLowerCase();
        const ranked = fileInputs.map((input) => {
          let score = 0;
          const inputLabel = cleanText(resolveLabel(input)).toLowerCase();
          if (label && inputLabel.includes(label.slice(0, 24))) score += 40;
          if (/add document|upload|cv|resume|załącz/i.test(inputLabel)) score += 20;
          if (/cover|message|letter/i.test(label) && /cover|message|letter/i.test(inputLabel)) score += 30;
          if (/cover|message|letter/i.test(label) && !/cover|message|letter/i.test(inputLabel)) score -= 20;
          return { input, score };
        }).sort((a, b) => b.score - a.score);
        if (ranked[0]?.score > 0) return ranked[0].input;
        return fileInputs[0];
      }
    }

    return null;
  }

  function canFillField(field) {
    if (field?.fillStatus === 'skipped') return false;
    if (field?.fieldType === 'file' || field?.category === 'document_upload') {
      return Boolean(field?.upload?.base64);
    }
    return field?.fillValue != null && field.fillValue !== '';
  }

  function setNativeValue(el, value) {
    const proto = el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(el, value);
    else el.value = value;
  }

  function dispatchInputEvents(el) {
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function fillFieldElement(el, field) {
    const value = field.fillValue;
    if (value == null || value === '') return { ok: false, reason: 'empty_value' };

    const fieldType = inferFieldType(el);
    if (fieldType === 'checkbox' || fieldType === 'switch') {
      const shouldCheck = /^(true|yes|1|on)$/i.test(String(value));
      const isChecked = el.checked === true || el.getAttribute('aria-checked') === 'true';
      if (shouldCheck !== isChecked) {
        el.click?.();
      } else {
        if (typeof el.checked === 'boolean') el.checked = shouldCheck;
        if (el.getAttribute('role') === 'checkbox' || el.getAttribute('role') === 'switch') {
          el.setAttribute('aria-checked', shouldCheck ? 'true' : 'false');
        }
        dispatchInputEvents(el);
      }
      return { ok: true };
    }

    if (fieldType === 'radio') {
      const name = el.name;
      const group = name
        ? Array.from(document.querySelectorAll(`input[type="radio"][name="${CSS.escape(name)}"]`))
        : [el];
      const target = group.find((input) => cleanText(input.value).toLowerCase() === String(value).toLowerCase())
        || group.find((input) => resolveLabel(input).toLowerCase().includes(String(value).toLowerCase()));
      if (!target) return { ok: false, reason: 'radio_not_found' };
      target.checked = true;
      dispatchInputEvents(target);
      return { ok: true };
    }

    if (fieldType === 'select') {
      const options = Array.from(el.options || []);
      const match = options.find((opt) => cleanText(opt.textContent).toLowerCase() === String(value).toLowerCase())
        || options.find((opt) => cleanText(opt.value).toLowerCase() === String(value).toLowerCase())
        || options.find((opt) => cleanText(opt.textContent).toLowerCase().includes(String(value).toLowerCase()));
      if (!match) return { ok: false, reason: 'option_not_found' };
      el.value = match.value;
      dispatchInputEvents(el);
      return { ok: true };
    }

    if (fieldType === 'contenteditable') {
      el.textContent = String(value);
      dispatchInputEvents(el);
      return { ok: true };
    }

    if (fieldType === 'file') {
      const upload = field.upload;
      if (!upload?.base64) {
        return { ok: false, reason: 'file_upload_manual' };
      }
      try {
        const binary = atob(upload.base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1) {
          bytes[i] = binary.charCodeAt(i);
        }
        const file = new File(
          [bytes],
          upload.fileName || 'document.pdf',
          { type: upload.mimeType || 'application/pdf' }
        );
        const transfer = new DataTransfer();
        transfer.items.add(file);
        el.files = transfer.files;
        dispatchInputEvents(el);
        return { ok: true };
      } catch {
        return { ok: false, reason: 'file_upload_failed' };
      }
    }

    setNativeValue(el, String(value));
    dispatchInputEvents(el);
    return { ok: true };
  }

  function fillApplicationFields(fields) {
    const results = [];
    for (const field of fields || []) {
      if (!canFillField(field)) {
        results.push({ stableFieldId: field?.stableFieldId, ok: false, reason: 'skipped' });
        continue;
      }
      const el = findTargetElement(field);
      if (!el) {
        results.push({ stableFieldId: field.stableFieldId, ok: false, reason: 'element_not_found' });
        continue;
      }
      const outcome = fillFieldElement(el, field);
      results.push({ stableFieldId: field.stableFieldId, ...outcome });
    }
    return { results };
  }

  window.__scanApplicationForm = scanApplicationForm;
  window.__looksLikeApplicationForm = looksLikeApplicationForm;
  window.__clickApplyToOpenForm = clickApplyToOpenForm;
  window.__fillApplicationFields = fillApplicationFields;
})();
