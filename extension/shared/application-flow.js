// Application flow types and display helpers (popup + content scripts)

const APPLICATION_FLOW_TYPES = {
  INLINE_SINGLE: 'inline_single',
  MODAL: 'modal',
  MULTI_STEP: 'multi_step',
  EXTERNAL_REDIRECT: 'external_redirect',
  DYNAMIC: 'dynamic',
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

if (typeof window !== 'undefined') {
  window.__qtsApplicationFlow = {
    APPLICATION_FLOW_TYPES,
    FLOW_TYPE_LABELS,
    FIELD_TYPE_LABELS,
    CATEGORY_LABELS,
    detectPlatformFromUrl,
    formatFlowType,
    formatFieldType,
    formatCategory,
    summarizeDiscoveryCounts,
  };
}

if (typeof module !== 'undefined') {
  module.exports = {
    APPLICATION_FLOW_TYPES,
    detectPlatformFromUrl,
    formatFlowType,
    formatFieldType,
    formatCategory,
    summarizeDiscoveryCounts,
  };
}
