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
    return element.required || element.getAttribute('aria-required') === 'true';
  }

  function visible(element) {
    if (!element || !element.isConnected) return false;
    const style = getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden'
      && element.getClientRects().length > 0;
  }

  function labelFor(element) {
    if (element.labels?.length) return clean([...element.labels].map((label) => label.innerText).join(' '));
    const aria = clean(element.getAttribute('aria-label'));
    if (aria) return aria;
    if (element.closest('label')) return clean(element.closest('label').innerText);

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

  function questionForChoice(element) {
    const fieldset = element.closest('fieldset');
    const legend = clean(fieldset?.querySelector('legend')?.innerText);
    if (legend) return legend;
    let current = element.parentElement;
    for (let depth = 0; current && depth < 5; depth += 1, current = current.parentElement) {
      const heading = current.querySelector('legend, [role="heading"], h1, h2, h3, h4');
      const text = clean(heading?.innerText);
      if (text) return text;
    }
    return labelFor(element);
  }

  function isManualReviewQuestion(label) {
    return /\b(terms and conditions|terms of service|privacy policy|gdpr|consent|marketing|equal opportunity|disability self identification|veteran status|background check authorization|certify that)\b/i
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

  function scanApplicationPage(pageNumber) {
    const controls = [...document.querySelectorAll('input:not([type="hidden"]), textarea, select')]
      .filter(visible);
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
      if (!label || isManualReviewQuestion(label)) {
        if (label && isManualReviewQuestion(label)) {
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
      const identity = String(first.name || first.id || label).trim();
      const stableFieldId = `workable:${location.pathname}:${identity}:${index++}`
        .slice(0, 300);
      const fieldType = first.type === 'file'
        ? 'file'
        : isChoice
          ? (first.type === 'checkbox' ? 'checkbox' : 'radio')
          : first instanceof HTMLSelectElement
            ? 'select'
            : first instanceof HTMLTextAreaElement
              ? 'textarea'
              : String(first.type || 'text');
      const options = isChoice
        ? controlsInField.map((item) => labelFor(item) || String(item.value || ''))
        : first instanceof HTMLSelectElement
          ? [...first.options].filter((option) => option.value).map((option) => clean(option.textContent))
          : undefined;
      const documentSlot = fieldType === 'file' && /cover letter|cover_letter/i.test(label)
        ? 'cover_letter'
        : fieldType === 'file'
          ? 'resume'
          : undefined;

      fields.push({
        stableFieldId,
        label: label.slice(0, 1000),
        fieldType,
        fieldKey: identity.slice(0, 300),
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
    const pageDescription = extractJobDescription();
    return {
      pageUrl: location.href,
      pageTitle: clean(document.title).slice(0, 500),
      pageNumber,
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

  function setControlValue(element, value) {
    const nextValue = String(value);
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
    if (!requestedCurrency) {
      const answer = answers.find((entry) => clean(entry.answer_text));
      return answer ? clean(answer.answer_text) : null;
    }
    const period = hourly ? 'hour' : null;
    const matching = answers.find((entry) =>
      String(entry.currency).toUpperCase() === requestedCurrency
      && (!period || entry.pay_period === period)
    );
    const fallback = requestedCurrency === 'USD'
      ? null
      : answers.find((entry) =>
        String(entry.currency).toUpperCase() === 'USD' && (!period || entry.pay_period === period)
      );
    const answer = matching || fallback;
    if (!answer) return null;
    if (clean(answer.answer_text)) {
      const text = clean(answer.answer_text);
      return fallback && !/\bUSD\b/i.test(text) ? `${text} USD` : text;
    }
    const minimum = answer.minimum_amount;
    const maximum = answer.maximum_amount;
    if (minimum == null && maximum == null) return null;
    const value = minimum != null && maximum != null
      ? `${minimum}-${maximum}`
      : String(minimum ?? maximum);
    return fallback ? `${value} USD` : value;
  }

  function answerForQuestion(question, managerAnswers) {
    const normalized = normalizedQuestion(question);
    const standard = managerAnswers || {};
    if (/salary|compensation|pay expectation/.test(normalized)) {
      return textForSalary(question, standard);
    }
    if (/authorized to work|legally authorized/.test(normalized)) {
      if (typeof standard.authorized_to_work === 'boolean') return standard.authorized_to_work ? 'YES' : 'NO';
    }
    if (/work authorization status|authorization status|visa type/.test(normalized)) {
      return clean(standard.authorization_status) || null;
    }
    if (/sponsorship|visa sponsorship/.test(normalized)) {
      if (typeof standard.sponsorship_required === 'boolean') return standard.sponsorship_required ? 'YES' : 'NO';
    }
    if (/authorization.*expir|expire.*authorization/.test(normalized)) {
      return standard.authorization_expires_on ? String(standard.authorization_expires_on).slice(0, 10) : null;
    }
    if (/relocat|move to/.test(normalized)) {
      if (typeof standard.relocation_willing === 'boolean') return standard.relocation_willing ? 'YES' : 'NO';
      if (clean(standard.relocation_details)) return clean(standard.relocation_details);
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
    return custom ? clean(custom.answer) : null;
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

  async function fillCollection(section, records, fields) {
    if (!records?.length) return [];
    const errors = [];
    const addButton = [...document.querySelectorAll('button')].find((button) =>
      new RegExp(`add\\s+(?:work\\s+)?${section}`, 'i').test(clean(button.innerText))
    );
    if (!addButton) return [`Could not find Workable's Add ${section} control.`];

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
            filled = setControlValue(control, value);
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
      gptPackage = false,
      submissionMode,
    } = payload;
    const failures = [];
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
      const key = String(element.name || element.id || label || '');
      const values = pageFieldByKey.get(key) || pageFieldByKey.get(label) || [];
      return values.length ? values.shift() : null;
    };
    const isManualReviewField = (label) => manualReviewFields.some(
      (item) => normalizedQuestion(item) === normalizedQuestion(label)
    );

    const phoneCountry = await updatePhoneCountry(account);
    if (!phoneCountry.ok) failures.push('Could not select the Account phone country.');
    const accountWithLocalPhone = { ...account, phone: phoneCountry.value };

    const controls = [...document.querySelectorAll('input:not([type="hidden"]), textarea, select')]
      .filter(visible);
    const radioGroups = new Map();
    for (const control of controls) {
      if (control instanceof HTMLInputElement && (control.type === 'radio' || control.type === 'checkbox')) {
        const groupName = control.name || `${control.type}:${control.id}`;
        if (!radioGroups.has(groupName)) radioGroups.set(groupName, []);
        radioGroups.get(groupName).push(control);
        continue;
      }
      const mapped = mapAccountField(control, accountWithLocalPhone);
      if (mapped != null && mapped !== '') {
        if (!setControlValue(control, mapped)) failures.push(`Could not fill ${labelFor(control) || control.name}.`);
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
      const answer = answerForQuestion(question, managerAnswers) ?? answerForGptField(control, question);
      if (answer != null) {
        if (!setControlValue(control, answer)) failures.push(`Could not fill required answer: ${question}.`);
      } else if (isRequired(control) && !control.value) {
        failures.push(`Unknown required question: ${question || 'question label unavailable'}.`);
      }
    }

    for (const group of radioGroups.values()) {
      const first = group[0];
      const question = questionForChoice(first);
      if (isManualReviewField(question)) continue;
      const answer = mapAccountField(first, account)
        ?? answerForQuestion(question, managerAnswers)
        ?? answerForGptField(first, question);
      if (answer != null && !applyRadioOrCheckbox(group, answer)) {
        failures.push(`Could not select an answer for: ${question || 'required choice'}.`);
      } else if (answer == null && group.some(isRequired) &&
          !group.some((item) => item.checked)) {
        failures.push(`Unknown required question: ${question || 'question label unavailable'}.`);
      }
    }

    failures.push(...await fillCollection('education', account.education, {
      school: [/school|institution|university|college/],
      qualification: [/degree|qualification|education level/],
      fieldOfStudy: [/field of study|major|subject/],
      startDate: [/start date|from/],
      endDate: [/end date|to|graduation/],
      description: [/description/],
    }));
    failures.push(...await fillCollection('experience', account.work_experience, {
      employer: [/employer|company/],
      jobTitle: [/job title|position|title/],
      location: [/location/],
      startDate: [/start date|from/],
      endDate: [/end date|to/],
      currentRole: [/current role|currently work/],
      description: [/description/],
    }));

    const invalid = controls.find((control) => isRequired(control) && !control.checkValidity());
    if (invalid && !failures.length) {
      failures.push(`Required field is incomplete: ${labelFor(invalid) || invalid.name || 'unlabeled field'}.`);
    }
    return {
      ok: failures.length === 0,
      failures: [...new Set(failures)],
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

  function showNotice(message, type = 'warn') {
    const id = 'qts-workable-notice';
    document.getElementById(id)?.remove();
    const notice = document.createElement('div');
    notice.id = id;
    notice.textContent = `QTS: ${message}`;
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
    document.documentElement.appendChild(notice);
    setTimeout(() => notice.remove(), 12000);
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
      showNotice(message.message, message.level);
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
      sendResponse({ ok: true, page: scanApplicationPage(Number(message.pageNumber) || 1) });
      return false;
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
