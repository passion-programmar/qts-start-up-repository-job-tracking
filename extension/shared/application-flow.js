// Application flow types and display helpers (popup + content scripts)

(function initQtsApplicationFlow(global) {
  if (global.__qtsApplicationFlow) return;

  const APPLICATION_FLOW_TYPES = {
    INLINE_SINGLE: 'inline_single',
    MODAL: 'modal',
    MULTI_STEP: 'multi_step',
    EXTERNAL_REDIRECT: 'external_redirect',
    DYNAMIC: 'dynamic',
    UNKNOWN: 'unknown',
  };

  /** High-level apply strategy used by the extension (site-agnostic). */
  const APPLY_METHOD_TYPES = {
    EASY_APPLY: 'easy_apply',
    SINGLE_STEP: 'single_step',
    MULTI_STEP: 'multi_step',
    EXTERNAL_REDIRECT: 'external_redirect',
    UNKNOWN: 'unknown',
  };

  const FLOW_TYPE_LABELS = {
    inline_single: 'Single-page form',
    modal: 'Modal popup form',
    multi_step: 'Multi-step form',
    external_redirect: 'External apply link',
    dynamic: 'Dynamic form (fields appear after actions)',
    unknown: 'Unknown flow',
  };

  const APPLY_METHOD_LABELS = {
    easy_apply: 'Easy Apply',
    single_step: 'Single-step form',
    multi_step: 'Multi-step form',
    external_redirect: 'External apply',
    unknown: 'Unknown apply method',
  };

  const APPLY_METHOD_DESCRIPTIONS = {
    easy_apply: 'One-click Apply opens an in-page modal or overlay (guest apply, no job-board login).',
    single_step: 'All fields on one page after Apply (inline form, no wizard).',
    multi_step: 'Apply wizard with multiple steps (Next / step N of M).',
    external_redirect: 'Apply leaves the job board for employer ATS or career site.',
    unknown: 'Apply method not recognized yet — open Apply or run discovery.',
  };

  const FIELD_TYPE_LABELS = {
    text: 'Text',
    email: 'Email',
    tel: 'Phone',
    textarea: 'Long text',
    select: 'Dropdown',
    radio: 'Radio',
    checkbox: 'Checkbox',
    switch: 'Toggle',
    file: 'File upload',
    combobox: 'Combobox',
    listbox: 'List',
    contenteditable: 'Rich text',
  };

  const CATEGORY_LABELS = {
    candidate_profile: 'Profile',
    saved_answer: 'Saved answer',
    ai_generation: 'AI question',
    document_upload: 'Document upload',
    unknown: 'Unknown',
  };

  function detectPlatformFromUrl(url) {
    const host = String(url || '').toLowerCase();
    if (host.includes('justjoin.it')) return 'justjoin';
    if (host.includes('linkedin.com')) return 'linkedin';
    if (host.includes('indeed.com')) return 'indeed';
    if (host.includes('greenhouse.io')) return 'greenhouse';
    if (host.includes('lever.co')) return 'lever';
    if (host.includes('workable.com')) return 'workable';
    if (host.includes('smartrecruiters.com')) return 'smartrecruiters';
    return 'generic';
  }

  function formatFlowType(flowType) {
    return FLOW_TYPE_LABELS[flowType] || flowType || 'Unknown';
  }

  function formatApplyMethod(applyMethod) {
    return APPLY_METHOD_LABELS[applyMethod] || applyMethod || 'Unknown';
  }

  function cleanText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function detectMultiStepHints(scan, root = typeof document !== 'undefined' ? document : null) {
    const pageStep = cleanText(scan?.pageStep || '');
    if (/step\s+\d+\s+of\s+\d+/i.test(pageStep)) {
      const match = pageStep.match(/step\s+(\d+)\s+of\s+(\d+)/i);
      return {
        isMultiStep: true,
        currentStep: match ? Number(match[1]) : null,
        totalSteps: match ? Number(match[2]) : null,
        source: 'pageStep',
      };
    }
    if (root?.querySelector?.('[aria-current="step"], [data-testid*="step" i], [class*="stepper" i]')) {
      return { isMultiStep: true, currentStep: null, totalSteps: null, source: 'dom' };
    }
    return { isMultiStep: false, currentStep: null, totalSteps: null, source: null };
  }

  function resolveApplyMethod({ template, flowType, platform, signals, scan } = {}) {
    if (template?.applyMethod) return template.applyMethod;
    if (flowType === APPLICATION_FLOW_TYPES.EXTERNAL_REDIRECT || signals?.externalApplyLink) {
      return APPLY_METHOD_TYPES.EXTERNAL_REDIRECT;
    }
    const stepHints = detectMultiStepHints(scan);
    if (flowType === APPLICATION_FLOW_TYPES.MULTI_STEP || stepHints.isMultiStep) {
      return APPLY_METHOD_TYPES.MULTI_STEP;
    }
    if (flowType === APPLICATION_FLOW_TYPES.INLINE_SINGLE) {
      return APPLY_METHOD_TYPES.SINGLE_STEP;
    }
    if (
      flowType === APPLICATION_FLOW_TYPES.MODAL
      || template?.guestApply === true
      || template?.id === 'justjoin_easy_apply'
    ) {
      return APPLY_METHOD_TYPES.EASY_APPLY;
    }
    if (platform === 'justjoin' && signals?.nativeApplyButton && !signals?.externalApplyLink) {
      return APPLY_METHOD_TYPES.EASY_APPLY;
    }
    if (platform === 'justjoin' && signals?.externalApplyLink) {
      return APPLY_METHOD_TYPES.EXTERNAL_REDIRECT;
    }
    return APPLY_METHOD_TYPES.UNKNOWN;
  }

  function resolveFlowType({ template, adapter, scan, context, signals } = {}) {
    if (typeof adapter?.detectFlowType === 'function') {
      return adapter.detectFlowType(scan, context) || APPLICATION_FLOW_TYPES.UNKNOWN;
    }
    if (typeof template?.hooks?.detectFlowType === 'function') {
      return template.hooks.detectFlowType(scan, context) || APPLICATION_FLOW_TYPES.UNKNOWN;
    }
    const stepHints = detectMultiStepHints(scan);
    if (stepHints.isMultiStep) return APPLICATION_FLOW_TYPES.MULTI_STEP;
    if (context?.externalUrl || signals?.externalApplyLink) return APPLICATION_FLOW_TYPES.EXTERNAL_REDIRECT;
    if (signals?.modalOpen) return APPLICATION_FLOW_TYPES.MODAL;
    if (scan?.fields?.length) return APPLICATION_FLOW_TYPES.INLINE_SINGLE;
    if (template?.anticipatedFlowType) return template.anticipatedFlowType;
    return APPLICATION_FLOW_TYPES.UNKNOWN;
  }

  function formatFieldType(fieldType) {
    return FIELD_TYPE_LABELS[fieldType] || fieldType || 'Field';
  }

  function formatCategory(category) {
    return CATEGORY_LABELS[category] || category || 'Unknown';
  }

  function summarizeDiscoveryCounts(fields) {
    const list = fields || [];
    return {
      total: list.length,
      required: list.filter((f) => f.required).length,
      profile: list.filter((f) => f.category === 'candidate_profile').length,
      saved: list.filter((f) => f.category === 'saved_answer').length,
      ai: list.filter((f) => f.category === 'ai_generation').length,
      upload: list.filter((f) => f.category === 'document_upload' || f.fieldType === 'file').length,
      filled: list.filter((f) => f.fillStatus === 'filled').length,
      awaiting: list.filter((f) => f.fillStatus === 'awaiting_answer' || f.fillStatus === 'pending').length,
    };
  }

  const api = {
    APPLICATION_FLOW_TYPES,
    APPLY_METHOD_TYPES,
    FLOW_TYPE_LABELS,
    APPLY_METHOD_LABELS,
    APPLY_METHOD_DESCRIPTIONS,
    FIELD_TYPE_LABELS,
    CATEGORY_LABELS,
    detectPlatformFromUrl,
    formatFlowType,
    formatApplyMethod,
    formatFieldType,
    formatCategory,
    summarizeDiscoveryCounts,
    detectMultiStepHints,
    resolveApplyMethod,
    resolveFlowType,
  };

  global.__qtsApplicationFlow = api;

  if (typeof module !== 'undefined') {
    module.exports = {
      APPLICATION_FLOW_TYPES,
      APPLY_METHOD_TYPES,
      detectPlatformFromUrl,
      formatFlowType,
      formatApplyMethod,
      formatFieldType,
      formatCategory,
      summarizeDiscoveryCounts,
      resolveApplyMethod,
      resolveFlowType,
    };
  }
})(typeof window !== 'undefined' ? window : globalThis);
