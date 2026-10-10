(function () {
  'use strict';

  if (window.__qtsWorkableApplicationInjected) return;
  window.__qtsWorkableApplicationInjected = true;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
  const normalizedQuestion = (value) => clean(value)
    .replace(/^\*\s*/, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

  function formSignature() {
    const controls = [...document.querySelectorAll('input:not([type="hidden"]), textarea, select')]
      .filter(visible)
      .map((element) => `${element.name || element.id || ''}:${element.type || 'control'}:${labelFor(element)}`)
      .join('|');
    const pageMarkers = [...document.querySelectorAll(
      'main h1, main h2, main h3, form legend, [aria-current="step"], [role="progressbar"]'
    )]
      .filter(visible)
      .map((element) => clean(element.innerText || element.getAttribute('aria-valuenow')))
      .filter(Boolean)
      .join('|');
    return `${pageMarkers}::${controls}`.slice(0, 8000);
  }

  function pageReady() {
    if (!chrome?.runtime?.id) return;
    chrome.runtime.sendMessage({
      type: 'QTS_WORKABLE_PAGE_READY',
      url: location.href,
      pageSignature: formSignature(),
    }).catch(() => {});
  }

  function isRequired(element) {
    if (element.required || element.getAttribute('aria-required') === 'true') return true;
    if (element.getAttribute('role') !== 'combobox') return false;
    return Boolean(element.closest('[data-ui]')?.querySelector('input[name][required]'));
  }

  function visible(element) {
    if (!element || !element.isConnected) return false;
    const style = getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden'
      && element.getClientRects().length > 0;
  }

  function labelledByText(element) {
    const ids = clean(element.getAttribute('aria-labelledby')).split(' ').filter(Boolean);
    return clean(ids.map((id) => document.getElementById(id)?.innerText || '').join(' '));
  }

  function accessibleName(element) {
    return labelledByText(element)
      || clean(element.getAttribute('aria-label'))
      || clean(element.getAttribute('title'))
      || clean(element.innerText);
  }

  function labelFor(element) {
    const accessible = labelledByText(element)
      || clean(element.getAttribute('aria-label'));
    if (accessible) return accessible;
    if (element.labels?.length) return clean([...element.labels].map((label) => label.innerText).join(' '));
    if (element.closest('label')) return clean(element.closest('label').innerText);
    const fieldLabel = element.closest('[data-ui]')?.querySelector('[id$="_label"]');
    if (fieldLabel) return clean(fieldLabel.innerText);
    const conventionalLabels = {
      city: 'City',
      postcode: 'Postal code',
      country: 'Country',
    };
    const conventionalLabel = conventionalLabels[String(element.name || element.id || '').toLowerCase()];
    if (conventionalLabel) return conventionalLabel;

    let current = element;
    for (let depth = 0; current && depth < 7; depth += 1, current = current.parentElement) {
      const siblingText = clean(current.previousElementSibling?.innerText);
      const parentControlCount = current.parentElement?.querySelectorAll(
        'input:not([type="hidden"]), textarea, select'
      ).length || 0;
      if (parentControlCount === 1 && siblingText && siblingText.length < 250) return siblingText;
    }
    return clean(element.getAttribute('name') || element.getAttribute('placeholder'));
  }

  function isCustomSelectProxy(element) {
    if (!(element instanceof HTMLInputElement) || element.matches('[role="combobox"]')) return false;
    const field = element.closest('[data-ui]');
    return Boolean(field?.querySelector('[role="combobox"]'));
  }

  function fieldIdentity(element) {
    if (element.getAttribute('role') === 'combobox') {
      const fieldId = element.closest('[data-ui]')?.getAttribute('data-ui');
      if (fieldId) return clean(fieldId);
    }
    return clean(
      element.name
      || element.getAttribute('data-ui')
      || element.closest('[data-ui]')?.getAttribute('data-ui')
      || element.id
      || labelFor(element)
    );
  }

  function questionForChoice(element) {
    const group = element.closest('fieldset, [role="radiogroup"], [role="group"]');
    const groupName = group && accessibleName(group);
    if (groupName) return groupName;
    const legend = clean(group?.querySelector('legend')?.innerText);
    if (legend) return legend;
    let current = element.parentElement;
    for (let depth = 0; current && depth < 5; depth += 1, current = current.parentElement) {
      const heading = current.querySelector(
        'legend, [role="heading"], h1, h2, h3, h4, [id$="_label"]'
      );
      const text = clean(heading?.innerText);
      if (text) return text;
    }
    return labelFor(element);
  }

  function sectionFor(element) {
    const section = element.closest('section[data-ui="section"], section, [role="region"]');
    if (!section) return '';
    const heading = section.querySelector('h1, h2, h3, h4, [role="heading"]');
    return clean(heading?.innerText || section.getAttribute('aria-label') || '');
  }

  function isManualReviewQuestion(label) {
    return /\b(terms and conditions|terms of service|privacy policy|gdpr|consent|marketing|equal opportunity|disability self identification|veteran status|background check authorization|certify that)\b/i
      .test(label);
  }

  function isConditionalReferralQuestion(label) {
    return /\bif (?:you were )?referred\b.*\bemployee\b|\breferral\b.*\b(if applicable|if any)\b/i
      .test(label);
  }

  function extractJobDescription() {
    const candidates = [
      ...document.querySelectorAll(
        '[data-ui*="job-description"], [data-testid*="job-description"], [class*="JobDescription"], [class*="job-description"], main article, [role="main"]'
      ),
    ]
      .filter(visible)
      .map((element) => clean(element.innerText))
      .filter((text) => text.length >= 100);

    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const parsed = JSON.parse(script.textContent || '');
        const entries = Array.isArray(parsed) ? parsed : [parsed];
        for (const entry of entries) {
          const description = typeof entry?.description === 'string' ? clean(entry.description) : '';
          if (description.length >= 100) candidates.push(description);
        }
      } catch {
        // Ignore invalid structured data and continue with visible page content.
      }
    }

    const description = candidates.sort((a, b) => b.length - a.length)[0] || '';
    return description.slice(0, 50000);
  }

  async function optionsForCombobox(control) {
    const listboxId = control.getAttribute('aria-controls') || control.getAttribute('aria-owns');
    const getOptions = () => {
      const listbox = listboxId ? document.getElementById(listboxId) : null;
      return [...(listbox?.querySelectorAll('[role="option"]') || [])]
        .filter(visible)
        .map((option) => accessibleName(option))
        .filter(Boolean);
    };
    let options = getOptions();
    let openedForScan = false;
    try {
      if (!options.length && control.getAttribute('aria-expanded') !== 'true') {
        control.dispatchEvent(new MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          view: control.ownerDocument.defaultView,
        }));
        openedForScan = true;
        for (let attempt = 0; attempt < 10 && !options.length; attempt += 1) {
          await sleep(50);
          options = getOptions();
        }
      }
      return options;
    } finally {
      if (openedForScan && control.getAttribute('aria-expanded') === 'true') {
        const view = control.ownerDocument.defaultView;
        document.body.dispatchEvent(new view.MouseEvent('mousedown', {
          bubbles: true,
          cancelable: true,
          view,
        }));
        document.body.dispatchEvent(new view.MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          view,
        }));
      }
    }
  }

  async function scanApplicationPage(pageNumber, {
    includeManualReview = false,
    includeJobDescription = true,
  } = {}) {
    const controls = [...document.querySelectorAll('input:not([type="hidden"]), textarea, select')]
      .filter((control) => visible(control) && !isCustomSelectProxy(control));
    const fields = [];
    const manualReviewFields = [];
    const seen = new Set();
    let index = 0;

    for (const control of controls) {
      const isChoice = control instanceof HTMLInputElement
        && (control.type === 'radio' || control.type === 'checkbox');
      const groupName = isChoice ? (control.name || `${control.type}:${control.id}`) : '';
      if (isChoice && seen.has(groupName)) continue;
      if (isChoice) seen.add(groupName);

      const label = isChoice ? questionForChoice(control) : labelFor(control);
      const manualReview = isManualReviewQuestion(label);
      if (!label || (manualReview && !includeManualReview)) {
        if (label && manualReview) {
          manualReviewFields.push(label);
        }
        continue;
      }

      const controlsInField = isChoice
        ? controls.filter((item) => item instanceof HTMLInputElement
          && (item.type === 'radio' || item.type === 'checkbox')
          && (item.name || `${item.type}:${item.id}`) === groupName)
        : [control];
      const first = controlsInField[0];
      const identity = fieldIdentity(first);
      const stableFieldId = `workable:${location.pathname}:${identity}:${index++}`
        .slice(0, 300);
      const fieldType = first.type === 'file'
        ? 'file'
        : isChoice
          ? (first.type === 'checkbox' ? 'checkbox' : 'radio')
          : first.getAttribute('role') === 'combobox'
            ? 'select'
            : first instanceof HTMLSelectElement
              ? 'select'
              : first instanceof HTMLTextAreaElement
                ? 'textarea'
                : String(first.type || 'text');
      const options = isChoice
        ? controlsInField.map((item) => labelFor(item) || String(item.value || ''))
        : first instanceof HTMLSelectElement
          ? [...first.options].filter((option) => option.value).map((option) => clean(option.textContent))
          : first.getAttribute('role') === 'combobox'
            ? await optionsForCombobox(first)
          : undefined;
      const documentSlot = fieldType === 'file' && /cover letter|cover_letter/i.test(label)
        ? 'cover_letter'
        : fieldType === 'file'
          ? 'resume'
          : undefined;

      fields.push({
        stableFieldId,
        label: label.slice(0, 1000),
        section: sectionFor(first).slice(0, 200),
        fieldType,
        fieldKey: identity.slice(0, 300),
        ...(manualReview ? { manualReview: true } : {}),
        ...(documentSlot ? { documentSlot } : {}),
        required: controlsInField.some(isRequired),
        ...(options?.length ? { options: options.slice(0, 100) } : {}),
        ...(clean(first.getAttribute('placeholder'))
          ? { placeholder: clean(first.getAttribute('placeholder')).slice(0, 1000) }
          : {}),
      });
    }

    const captchaPresent = Boolean(document.querySelector(
      'iframe[src*="turnstile"], iframe[src*="recaptcha"], .cf-turnstile, input[name*="turnstile"], input[name*="recaptcha"]'
    ));
    const pageDescription = includeJobDescription ? extractJobDescription() : '';
    return {
      pageUrl: location.href,
      pageTitle: clean(document.title).slice(0, 500),
      pageNumber,
      stepLabel: clean(document.querySelector(
        '[aria-current="step"], [role="progressbar"], form legend'
      )?.innerText || ''),
      pageSignature: formSignature(),
      fields,
      jobDescription: pageDescription || undefined,
      manualReviewFields: [...new Set(manualReviewFields)],
      captchaPresent,
    };
  }

  async function clickNextPage() {
    if (document.querySelector(
      'iframe[src*="turnstile"], iframe[src*="recaptcha"], .cf-turnstile, input[name*="turnstile"], input[name*="recaptcha"]'
    )) {
      return { ok: false, paused: true, reason: 'Security verification found; complete it manually.' };
    }
    const next = [...document.querySelectorAll('button, [role="button"]')]
      .filter(visible)
      .find((element) => /^(next|continue|continue to next step|save and continue)$/i.test(clean(element.innerText)));
    if (!next) return { ok: true, hasNext: false };
    const previousUrl = location.href;
    const previousSignature = formSignature();
    next.click();
    for (let attempt = 0; attempt < 12; attempt += 1) {
      await sleep(250);
      if (location.href !== previousUrl || formSignature() !== previousSignature) {
        return { ok: true, hasNext: true, url: location.href };
      }
    }
    return { ok: true, hasNext: false, pageUnchanged: true };
  }

  function isApplicationForm() {
    return /\/apply\/?$/i.test(location.pathname)
      || Boolean(document.querySelector('input[type="file"]'))
      || Boolean(document.querySelector('input[autocomplete="given-name"], input[name*="first_name"]'));
  }

  async function openApplicationForm() {
    if (isApplicationForm()) return { ok: true };
    const button = [...document.querySelectorAll('button, a, [role="button"]')]
      .filter(visible)
      .find((element) => /^apply( now| for this job)?$/i.test(clean(element.innerText)));
    if (!button) return { ok: false, error: 'Could not find the Workable Apply button.' };
    button.click();
    for (let attempt = 0; attempt < 80; attempt += 1) {
      await sleep(250);
      if (isApplicationForm()) return { ok: true };
    }
    return { ok: false, error: 'Workable application form did not open.' };
  }

  async function setControlValue(element, value) {
    const nextValue = String(value);
    if (element.getAttribute('role') === 'combobox') {
      element.click();
      const listboxId = element.getAttribute('aria-controls') || element.getAttribute('aria-owns');
      let options = [];
      for (let attempt = 0; attempt < 10 && !options.length; attempt += 1) {
        const listbox = listboxId ? document.getElementById(listboxId) : null;
        options = [...(listbox?.querySelectorAll('[role="option"]') || [])].filter(visible);
        if (!options.length) await sleep(50);
      }
      const answer = normalizedQuestion(nextValue);
      const option = options.find((item) => normalizedQuestion(accessibleName(item)) === answer);
      if (!option) return false;
      option.click();
      await sleep(100);
      return true;
    }
    if (element instanceof HTMLSelectElement) {
      const option = [...element.options].find((item) =>
        clean(item.textContent).toLowerCase() === nextValue.toLowerCase()
        || clean(item.textContent).toLowerCase().startsWith(`${nextValue.toLowerCase()} `)
        || item.value.toLowerCase() === nextValue.toLowerCase()
      );
      if (!option) return false;
      element.value = option.value;
    } else if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      const prototype = element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, nextValue);
    } else {
      return false;
    }
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }
  function textForSalary(question, managerAnswers) {
    const answers = managerAnswers.salaryAnswers || [];
    const normalized = normalizedQuestion(question);
    const hourly = /\bhourly\b/.test(normalized) || /\bper hour\b/.test(normalized);
    const currencyMatch = normalized.match(/\b(usd|eur|gbp|cad|aud|nzd|inr|jpy|chf|sek|nok|dkk|pln|ron|bgn)\b/);
    const explicitCodeMatch = normalized.match(/\bin\s+([a-z]{3})\b/);
    const requestedCurrency = (currencyMatch?.[1] || explicitCodeMatch?.[1])?.toUpperCase();
    const configured = answers.filter((entry) =>
      clean(entry.answer_text) || entry.minimum_amount != null || entry.maximum_amount != null
    );
    if (!requestedCurrency) {
      if (configured.length !== 1) return null;
      const answer = configured[0];
      const text = clean(answer.answer_text);
      if (text) {
        return /\d/.test(text) && !/\b[A-Z]{3}\b/i.test(text)
          ? `${text} ${answer.currency} per ${answer.pay_period}`
          : text;
      }
      const value = answer.minimum_amount != null && answer.maximum_amount != null
        ? `${answer.minimum_amount}-${answer.maximum_amount}`
        : String(answer.minimum_amount ?? answer.maximum_amount);
      return `${value} ${answer.currency} per ${answer.pay_period}`;
    }
    const period = hourly ? 'hour' : null;
    const matching = answers.filter((entry) =>
      String(entry.currency).toUpperCase() === requestedCurrency
      && (!period || entry.pay_period === period)
    );
    if (matching.length > 1) return null;
    const fallbacks = requestedCurrency === 'USD'
      ? []
      : answers.filter((entry) =>
        String(entry.currency).toUpperCase() === 'USD' && (!period || entry.pay_period === period)
      );
    if (!matching.length && fallbacks.length > 1) return null;
    const answer = matching[0] || fallbacks[0];
    const usedFallback = !matching.length && Boolean(answer);
    if (!answer) return null;
    if (clean(answer.answer_text)) {
      const text = clean(answer.answer_text);
      return usedFallback && !/\bUSD\b/i.test(text) ? `${text} USD` : text;
    }
    const minimum = answer.minimum_amount;
    const maximum = answer.maximum_amount;
    if (minimum == null && maximum == null) return null;
    const value = minimum != null && maximum != null
      ? `${minimum}-${maximum}`
      : String(minimum ?? maximum);
    return usedFallback ? `${value} USD` : value;
  }

  function answerForQuestion(question, managerAnswers, account, options = []) {
    const normalized = normalizedQuestion(question);
    const standard = managerAnswers || {};
    const customProfileField = (account?.custom_fields || []).find((field) => {
      const fieldName = normalizedQuestion(field.fieldName);
      if (fieldName.length < 4) return false;
      if (normalized === fieldName || normalized.includes(fieldName)) return true;
      const isExpiryQuestion = /expir|expire/.test(normalized)
        && /authorization|work permit|visa/.test(normalized);
      const isExpiryField = /expir|expire/.test(fieldName)
        && /authorization|work permit|visa/.test(fieldName);
      return isExpiryQuestion && isExpiryField;
    });
    if (customProfileField?.value) return clean(customProfileField.value);
    if (/salary|compensation|pay expectation/.test(normalized)) {
      return textForSalary(question, standard);
    }
    if (/authorized to work|legally authorized/.test(normalized)) {
      if (typeof standard.authorized_to_work === 'boolean') return standard.authorized_to_work ? 'YES' : 'NO';
    }
    if (/basis of (?:your )?(?:current )?work authorization|current work authorization basis/.test(normalized)) {
      return clean(standard.authorization_status) || null;
    }
    if (/work authorization status|authorization status|visa type/.test(normalized)) {
      return clean(standard.authorization_status) || null;
    }
    if (/sponsorship|visa sponsorship/.test(normalized)) {
      if (typeof standard.sponsorship_required === 'boolean') return standard.sponsorship_required ? 'YES' : 'NO';
    }
    if (/authorization.*expir|expire.*authorization/.test(normalized)) {
      return null;
    }
    if (/relocat|move to/.test(normalized)) {
      if (typeof standard.relocation_willing === 'boolean') return standard.relocation_willing ? 'YES' : 'NO';
    }
    if (/notice period|when can you start|availability to start/.test(normalized)) {
      if (clean(standard.notice_period_text)) return clean(standard.notice_period_text);
      if (standard.notice_period_value != null && standard.notice_period_unit) {
        return `${standard.notice_period_value} ${standard.notice_period_unit}`;
      }
    }
    const custom = (standard.customAnswers || []).find((entry) =>
      normalizedQuestion(entry.question) === normalized
    );
    if (custom) return clean(custom.answer);
    if (/highest(?: level of)? education|education level|degree level|highest degree|what degree|which degree|degree or qualification/.test(normalized)) {
      const availableOptions = options.map((option) => clean(option)).filter(Boolean);
      const matches = (account?.education || [])
        .map((record) => clean(record.qualification))
        .filter(Boolean)
        .map((qualification) => availableOptions.find((option) =>
          normalizedQuestion(option) === normalizedQuestion(qualification)
        ) || (availableOptions.length ? null : qualification))
        .filter(Boolean);
      const uniqueMatches = [...new Set(matches)];
      if (uniqueMatches.length === 1) return uniqueMatches[0];
    }
    return null;
  }

  function applyRadioOrCheckbox(group, answer) {
    const target = String(answer).trim().toLowerCase();
    const choice = group.find((input) => {
      const label = normalizedQuestion(labelFor(input));
      const value = String(input.value || '').toLowerCase();
      return (target === 'yes' || target === 'true')
        ? (value === 'true' || value === 'yes' || label === 'yes')
        : (target === 'no' || target === 'false')
          ? (value === 'false' || value === 'no' || label === 'no')
          : false;
    }) || group.find((input) =>
      normalizedQuestion(input.value) === normalizedQuestion(answer)
      || normalizedQuestion(labelFor(input)) === normalizedQuestion(answer)
    );
    if (!choice) return false;
    choice.click();
    choice.checked = true;
    choice.dispatchEvent(new Event('input', { bubbles: true }));
    choice.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  function mapAccountField(element, account) {
    const name = String(element.name || element.getAttribute('autocomplete') || '').toLowerCase();
    const label = normalizedQuestion(labelFor(element));
    if (/first.?name|given-name/.test(name) || label === 'first name') return account.first_name;
    if (/last.?name|family-name/.test(name) || label === 'last name') return account.last_name;
    if (/email/.test(name) || /\bemail\b/.test(label)) return account.email;
    if (/phone|tel/.test(name) || /\bphone\b/.test(label)) return account.phone;
    if (/address|street-address/.test(name) || /\baddress\b/.test(label)) return account.address;
    if (/\bcity\b|address-level2/.test(name) || /\bcity\b/.test(label)) return account.city;
    if (/\bcountry\b|country-name/.test(name) || /\bcountry\b/.test(label)) return account.country;
    if (/birth|bday/.test(name) || /date of birth|birthday/.test(label)) return account.birthday;
    if (/gender|sex/.test(name) || /\b(gender|sex)\b/.test(label)) return account.sex;
    return null;
  }

  async function updatePhoneCountry(account) {
    const phone = document.querySelector('input[name="phone"], input[autocomplete="tel"], input[type="tel"]');
    if (!phone || !account.phone) return { ok: true, value: account.phone };
    const button = [...document.querySelectorAll('button')].find((item) =>
      /country for phone number/i.test(item.getAttribute('aria-label') || '')
    );
    if (!button) return { ok: true, value: account.phone };
    const current = clean(button.getAttribute('aria-label'));
    if (!current.toLowerCase().includes(String(account.country || '').toLowerCase())) {
      button.click();
      const country = clean(account.country).toLowerCase();
      let option = null;
      for (let attempt = 0; attempt < 10 && !option; attempt += 1) {
        await sleep(100);
        option = [...document.querySelectorAll('[role="option"], button, li')]
          .find((item) => visible(item) && clean(item.innerText).toLowerCase().startsWith(country));
      }
      if (!option) return { ok: false, value: account.phone };
      option.click();
      await sleep(100);
    }
    const dialCode = (button.getAttribute('aria-label') || '').match(/\+\d{1,4}/)?.[0];
    const normalizedPhone = String(account.phone).trim();
    const phoneValue = dialCode && normalizedPhone.startsWith(dialCode)
      ? normalizedPhone.slice(dialCode.length).trim()
      : normalizedPhone;
    return { ok: true, value: phoneValue };
  }

  async function fillCollection(section, records, fields, preserveExisting) {
    if (!records?.length) return [];
    const errors = [];
    const addButton = [...document.querySelectorAll('button')].find((button) =>
      new RegExp(`add\\s+(?:work\\s+)?${section}`, 'i').test(accessibleName(button))
    );
    if (!addButton) return [`Could not find Workable's Add ${section} control.`];
    const sectionRoot = addButton.closest(`[data-ui="${section}"]`);
    if (preserveExisting && sectionRoot?.querySelector(
      'input:not([type="hidden"]), textarea, select, [role="combobox"]'
    )) return [];

    for (const record of records) {
      addButton.click();
      await sleep(150);
      const dialog = document.querySelector('[role="dialog"]');
      const root = dialog || document.querySelector('form') || document.body;
      for (const [key, labels] of Object.entries(fields)) {
        const value = record[key];
        if (value == null || value === '') continue;
        const candidates = [...root.querySelectorAll('input:not([type="hidden"]), textarea, select')]
          .filter(visible);
        const control = candidates.find((item) => {
          const label = normalizedQuestion(labelFor(item));
            return (item instanceof HTMLInputElement && item.type === 'checkbox' || !item.value)
              && labels.some((pattern) => pattern.test(label));
        });
        let filled = false;
        if (control instanceof HTMLInputElement && control.type === 'checkbox' && typeof value === 'boolean') {
            control.checked = value;
            control.dispatchEvent(new Event('change', { bubbles: true }));
            filled = true;
        } else if (control) {
            filled = await setControlValue(control, value);
        }
        if (!filled) {
            if (['school', 'qualification', 'employer', 'jobTitle'].includes(key)) {
              errors.push(`Could not fill required ${section.toLowerCase()} field: ${key}.`);
            }
        }
      }
      const saveButton = [...root.querySelectorAll('[role="dialog"] button')].find((button) =>
        /^(add|save|done)$/i.test(clean(button.innerText))
      );
      if (saveButton) {
        saveButton.click();
        await sleep(150);
      }
    }
    return errors;
  }

  async function fillForm(payload) {
    const {
      account,
      managerAnswers,
      resume,
      documents = {},
      answers = [],
      pageFields = [],
      manualReviewFields = [],
      profileFactFields = [],
      gptPackage = false,
      preserveExisting = false,
      submissionMode,
    } = payload;
    const failures = [];
    const manualAnswerFields = [];
    if (!isApplicationForm()) {
      return { ok: false, failures: ['Workable application form did not open.'] };
    }

    const answerById = new Map(answers.map((item) => [item.stableFieldId, item.answer]));
    const pageFieldByKey = new Map();
    for (const field of pageFields) {
      const answer = answerById.get(field.stableFieldId);
      if (answer == null) continue;
      const key = String(field.fieldKey || field.label || '');
      if (!pageFieldByKey.has(key)) pageFieldByKey.set(key, []);
      pageFieldByKey.get(key).push(answer);
    }
    const answerForGptField = (element, label) => {
      const key = fieldIdentity(element) || label;
      const values = pageFieldByKey.get(key) || pageFieldByKey.get(label) || [];
      return values.length ? values.shift() : null;
    };
    const optionsForField = (element, label) => {
      const key = fieldIdentity(element) || label;
      return pageFields.find((field) =>
        field.fieldKey === key || field.label === label
      )?.options || [];
    };
    const isManualReviewField = (label) => manualReviewFields.some(
      (item) => normalizedQuestion(item) === normalizedQuestion(label)
    );
    const isProfileFactField = (label) => profileFactFields.some(
      (item) => normalizedQuestion(item) === normalizedQuestion(label)
    );

    const phoneCountry = await updatePhoneCountry(account);
    if (!phoneCountry.ok) failures.push('Could not select the Account phone country.');
    const accountWithLocalPhone = { ...account, phone: phoneCountry.value };

    const controls = [...document.querySelectorAll('input:not([type="hidden"]), textarea, select')]
      .filter(visible);
    const radioGroups = new Map();
    for (const control of controls) {
      if (isCustomSelectProxy(control)) continue;
      if (control instanceof HTMLInputElement && (control.type === 'radio' || control.type === 'checkbox')) {
        const groupName = control.name || `${control.type}:${control.id}`;
        if (!radioGroups.has(groupName)) radioGroups.set(groupName, []);
        radioGroups.get(groupName).push(control);
        continue;
      }
      if (preserveExisting
        && (control.type === 'file' ? control.files?.length : String(control.value || '').trim())) {
        continue;
      }
      const mapped = mapAccountField(control, accountWithLocalPhone);
      if (mapped != null && mapped !== '') {
        if (!await setControlValue(control, mapped)) failures.push(`Could not fill ${labelFor(control) || control.name}.`);
        continue;
      }
      if (control.type === 'file') {
        const fieldKey = String(control.name || control.id || labelFor(control) || '');
        const descriptor = pageFields.find((field) =>
          String(field.fieldKey || field.label || '') === fieldKey
        );
        const slot = descriptor?.documentSlot
          || (/cover letter/i.test(labelFor(control)) ? 'cover_letter' : 'resume');
        const file = documents[slot] || (!gptPackage && slot === 'resume' ? resume : null);
        if (!file?.base64 && control.required) {
          failures.push(`Required ${slot === 'cover_letter' ? 'cover letter' : 'resume'} document is missing.`);
        } else if (file?.base64) {
          const binary = atob(file.base64);
          const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
          const upload = new File([bytes], file.fileName || 'resume.pdf', { type: 'application/pdf' });
          const transfer = new DataTransfer();
          transfer.items.add(upload);
          control.files = transfer.files;
          control.dispatchEvent(new Event('change', { bubbles: true }));
        }
        continue;
      }
      const question = labelFor(control);
      if (isManualReviewField(question)) continue;
      const profileFact = isProfileFactField(question);
      const answer = answerForQuestion(
        question,
        managerAnswers,
        account,
        optionsForField(control, question)
      ) ?? answerForGptField(control, question);
      if (answer != null) {
        if (!await setControlValue(control, answer)) {
          if (profileFact) manualAnswerFields.push(question);
          else failures.push(`Could not fill required answer: ${question}.`);
        }
      } else if (isRequired(control) && !control.value) {
        if (isConditionalReferralQuestion(question)) continue;
        if (profileFact) manualAnswerFields.push(question);
        else failures.push(`Unknown required question: ${question || 'question label unavailable'}.`);
      }
    }

    for (const group of radioGroups.values()) {
      if (preserveExisting && group.some((item) => item.checked)) continue;
      const first = group[0];
      const question = questionForChoice(first);
      if (isManualReviewField(question)) continue;
      const profileFact = isProfileFactField(question);
      const answer = mapAccountField(first, account)
        ?? answerForQuestion(
          question,
          managerAnswers,
          account,
          optionsForField(first, question)
        )
        ?? answerForGptField(first, question);
      if (answer != null && !applyRadioOrCheckbox(group, answer)) {
        if (profileFact) manualAnswerFields.push(question);
        else failures.push(`Could not select an answer for: ${question || 'required choice'}.`);
      } else if (answer == null && group.some(isRequired) &&
          !group.some((item) => item.checked)) {
        if (profileFact) manualAnswerFields.push(question);
        else failures.push(`Unknown required question: ${question || 'question label unavailable'}.`);
      }
    }

    failures.push(...await fillCollection('education', account.education, {
      school: [/school|institution|university|college/],
      qualification: [/degree|qualification|education level/],
      fieldOfStudy: [/field of study|major|subject/],
      startDate: [/start date|from/],
      endDate: [/end date|to|graduation/],
      description: [/description/],
    }, preserveExisting));
    failures.push(...await fillCollection('experience', account.work_experience, {
      employer: [/employer|company/],
      jobTitle: [/job title|position|title/],
      location: [/location/],
      startDate: [/start date|from/],
      endDate: [/end date|to/],
      currentRole: [/current role|currently work/],
      description: [/description/],
    }, preserveExisting));

    const invalid = controls.find((control) => {
      const question = control instanceof HTMLInputElement
        && (control.type === 'radio' || control.type === 'checkbox')
        ? questionForChoice(control)
        : labelFor(control);
      return isRequired(control)
        && !control.checkValidity()
        && !isConditionalReferralQuestion(question);
    });
    let invalidQuestion = '';
    if (invalid) {
      invalidQuestion = invalid instanceof HTMLInputElement
        && (invalid.type === 'radio' || invalid.type === 'checkbox')
        ? questionForChoice(invalid)
        : labelFor(invalid);
    }
    const isPendingManualAnswer = manualAnswerFields.some(
      (question) => normalizedQuestion(question) === normalizedQuestion(invalidQuestion)
    );
    if (invalid && !failures.length && !isPendingManualAnswer) {
      failures.push(`Required field is incomplete: ${invalidQuestion || invalid.name || 'unlabeled field'}.`);
    }
    return {
      ok: failures.length === 0,
      failures: [...new Set(failures)],
      manualAnswerFields: [...new Set(manualAnswerFields)],
      captchaPresent: Boolean(document.querySelector(
        'iframe[src*="turnstile"], iframe[src*="recaptcha"], .cf-turnstile, input[name*="turnstile"], input[name*="recaptcha"]'
      )),
      submissionMode,
    };
  }

  function submitApplication() {
    if (document.querySelector(
      'iframe[src*="turnstile"], iframe[src*="recaptcha"], .cf-turnstile, input[name*="turnstile"], input[name*="recaptcha"]'
    )) {
      return { ok: false, captchaPresent: true };
    }
    const form = [...document.querySelectorAll('form')].find(visible);
    if (form && !form.checkValidity()) {
      return { ok: false, error: 'The Workable form has incomplete or invalid required fields.' };
    }
    const submit = [...document.querySelectorAll('button[type="submit"], input[type="submit"]')]
      .filter(visible)
      .find((element) => /^(submit|submit application|apply)$/i.test(clean(element.innerText || element.value)));
    if (!submit) return { ok: false, error: 'Could not find the Workable Submit button.' };
    submit.click();
    return { ok: true };
  }

  function showNotice(message, type = 'warn', action) {
    const id = 'qts-workable-notice';
    document.getElementById(id)?.remove();
    const notice = document.createElement('div');
    notice.id = id;
    const text = document.createElement('span');
    text.textContent = `QTS: ${message}`;
    notice.appendChild(text);
    Object.assign(notice.style, {
      position: 'fixed',
      zIndex: '2147483647',
      top: '16px',
      right: '16px',
      maxWidth: '420px',
      padding: '14px 18px',
      borderRadius: '8px',
      color: '#fff',
      background: type === 'success' ? '#166534' : type === 'error' ? '#991b1b' : '#854d0e',
      boxShadow: '0 4px 18px rgba(0,0,0,.3)',
      font: '14px/1.45 sans-serif',
    });
    if (action?.type === 'QTS_WORKABLE_RESUME') {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = action.label || 'Continue';
      Object.assign(button.style, {
        display: 'block',
        marginTop: '10px',
        padding: '6px 12px',
        border: '1px solid rgba(255,255,255,.8)',
        borderRadius: '4px',
        color: '#fff',
        background: 'transparent',
        cursor: 'pointer',
        font: '600 14px/1.4 sans-serif',
      });
      button.addEventListener('click', () => {
        button.disabled = true;
        button.textContent = 'Continuing...';
        chrome.runtime.sendMessage({
          type: 'QTS_WORKABLE_RESUME',
          url: location.href,
          pageSignature: formSignature(),
        }).then((result) => {
          if (!result?.ok) throw new Error(result?.error || 'Could not resume the application.');
        }).catch((error) => {
          showNotice(error.message || 'Could not resume the application.', 'error');
        });
      });
      notice.appendChild(button);
    }
    document.documentElement.appendChild(notice);
    if (action?.type !== 'QTS_WORKABLE_RESUME') {
      setTimeout(() => notice.remove(), 12000);
    }
  }

  function detectOutcome() {
    const alerts = [...document.querySelectorAll(
      '[role="alert"], [aria-live], .Toastify__toast, .notification, .flash, .alert'
    )]
      .map((element) => clean(element.innerText))
      .filter(Boolean);
    const text = alerts.join(' ').toLowerCase();
    if (/thank you|application (has been )?submitted|successfully applied|we received your application/.test(text)) {
      return { outcome: 'submitted' };
    }
    if (/something went wrong|try again later|unable to submit|submission failed/.test(text)) {
      return { outcome: 'failed', reason: alerts[0] || 'Workable reported a submission error.' };
    }
    return null;
  }

  let observer = null;
  function watchOutcome() {
    observer?.disconnect();
    const check = () => {
      const outcome = detectOutcome();
      if (!outcome) return;
      observer?.disconnect();
      chrome.runtime.sendMessage({
        type: 'QTS_WORKABLE_OUTCOME',
        url: location.href,
        ...outcome,
      }).catch(() => {});
    };
    observer = new MutationObserver(check);
    observer.observe(document.body || document.documentElement, { childList: true, subtree: true, characterData: true });
    check();
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'QTS_WORKABLE_NOTICE') {
      showNotice(message.message, message.level, message.action);
      sendResponse({ ok: true });
      return false;
    }
    if (message.type === 'QTS_WORKABLE_OPEN_FORM') {
      openApplicationForm().then(sendResponse).catch((error) =>
        sendResponse({ ok: false, error: error.message || 'Could not open Workable form.' })
      );
      return true;
    }
    if (message.type === 'QTS_WORKABLE_CAPTURE_JOB') {
      sendResponse({ ok: true, jobDescription: extractJobDescription() });
      return false;
    }
    if (message.type === 'QTS_WORKABLE_SCAN_PAGE') {
      scanApplicationPage(Number(message.pageNumber) || 1).then((page) =>
        sendResponse({ ok: true, page })
      ).catch((error) => sendResponse({
        ok: false,
        error: error.message || 'Could not scan the Workable application page.',
      }));
      return true;
    }
    if (message.type === 'QTS_WORKABLE_STUDY_SCAN') {
      scanApplicationPage(Number(message.pageNumber) || 1, {
        includeManualReview: true,
        includeJobDescription: false,
      }).then((page) =>
        sendResponse({ ok: true, page })
      ).catch((error) => sendResponse({
        ok: false,
        error: error.message || 'Could not study the current Workable application step.',
      }));
      return true;
    }
    if (message.type === 'QTS_WORKABLE_NEXT_PAGE') {
      clickNextPage().then(sendResponse).catch((error) =>
        sendResponse({ ok: false, error: error.message || 'Could not continue to the next application page.' })
      );
      return true;
    }
    if (message.type === 'QTS_WORKABLE_FILL') {
      fillForm(message.payload).then(sendResponse).catch((error) =>
        sendResponse({ ok: false, failures: [error.message || 'Workable form fill failed.'] })
      );
      return true;
    }
    if (message.type === 'QTS_WORKABLE_SUBMIT') {
      sendResponse(submitApplication());
      return false;
    }
    if (message.type === 'QTS_WORKABLE_WATCH_OUTCOME') {
      watchOutcome();
      sendResponse({ ok: true });
      return false;
    }
    return false;
  });

  const notify = () => setTimeout(pageReady, 700);
  if (document.readyState === 'complete') notify();
  else window.addEventListener('load', notify, { once: true });
  let previousUrl = location.href;
  let previousSignature = formSignature();
  let pageChangeTimer = null;
  new MutationObserver(() => {
    if (location.href !== previousUrl) {
      previousUrl = location.href;
      notify();
      return;
    }
    clearTimeout(pageChangeTimer);
    pageChangeTimer = setTimeout(() => {
      const signature = formSignature();
      if (signature === previousSignature || !isApplicationForm()) return;
      previousSignature = signature;
      pageReady();
    }, 400);
  }).observe(document.documentElement, { childList: true, subtree: true });
})();
