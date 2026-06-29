// API client for the extension popup

const DEFAULT_SERVER = 'https://qts-job-tracking.vercel.app';

let cachedAuthToken = null;

function normalizeServerUrl(url) {
  let normalized = String(url || '').trim().replace(/\/+$/, '');
  if (!normalized) return DEFAULT_SERVER;
  normalized = normalized.replace(/\/api\/health\/?$/i, '');
  normalized = normalized.replace(/\/api\/?$/i, '');
  normalized = normalized.replace(/\/+$/, '');
  return normalized || DEFAULT_SERVER;
}

async function getServerUrl() {
  return DEFAULT_SERVER;
}

async function ensureServerUrl() {
  return DEFAULT_SERVER;
}

async function getToken() {
  const auth = window.__qtsBidderAuth;
  if (auth?.getPopupAuthToken) {
    const token = await auth.getPopupAuthToken();
    cachedAuthToken = token || null;
    return token;
  }
  if (cachedAuthToken) return cachedAuthToken;
  return '';
}

function setCachedToken(token) {
  cachedAuthToken = token || '';
}

function clearCachedToken() {
  cachedAuthToken = null;
}

function formatApiMessage(data, fallback) {
  const base = data?.message || fallback;
  if (!Array.isArray(data?.errors) || !data.errors.length) return base;
  const detail = data.errors
    .slice(0, 3)
    .map((entry) => `${entry.field}: ${entry.message}`)
    .join('; ');
  return `${base} (${detail})`;
}

async function apiRequest(method, path, body) {
  const [serverUrl, token] = await Promise.all([getServerUrl(), getToken()]);
  const url = serverUrl.replace(/\/$/, '') + path;
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  };
  if (body !== undefined) opts.body = JSON.stringify(body);

  let response;
  try {
    response = await fetch(url, opts);
  } catch {
    return { success: false, message: 'Cannot connect to the server. Check that it is running.', _httpStatus: 0 };
  }

  let data;
  try {
    data = await response.json();
  } catch {
    return {
      success: false,
      message: `Server returned an invalid response (${response.status}).`,
    };
  }

  if (!response.ok && data.success !== false) {
    data.success = false;
  }

  if (!data.success && !data.message) {
    if (response.status === 404) {
      data.message = `API route not found (404): ${path}. Restart the server with stop-server.bat then start-server.bat.`;
    } else {
      data.message = `Request failed (${response.status}).`;
    }
  }

  if (
    !data.success
    && Array.isArray(data.errors)
    && data.errors.some((e) => String(e.message || '').includes('document_upload'))
  ) {
    data.message = `${data.message || 'Validation error.'} Server is outdated — run stop-server.bat then start-server.bat to load document upload support.`;
  }

  data._httpStatus = response.status;

  if (response.status === 401 && window.__qtsBidderAuth?.handleAuthExpired) {
    await window.__qtsBidderAuth.handleAuthExpired();
    clearCachedToken();
    data.message = data.message || 'Session expired. Please log in again.';
    data._sessionExpired = true;
  }

  return data;
}

async function fetchApplicationDocument(applicationId, docType) {
  const [serverUrl, token] = await Promise.all([getServerUrl(), getToken()]);
  const url = `${serverUrl.replace(/\/$/, '')}/api/application-sessions/${applicationId}/documents/${encodeURIComponent(docType)}`;
  let response;
  try {
    response = await fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  } catch {
    return { success: false, message: 'Cannot download document from server.' };
  }

  if (!response.ok) {
    let message = `Document download failed (${response.status}).`;
    try {
      const err = await response.json();
      if (err.message) message = err.message;
    } catch {
      // ignore
    }
    return { success: false, message };
  }

  const blob = await response.blob();
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  const base64 = btoa(binary);

  let fileName = docType === 'cover-letter' ? 'cover-letter.pdf' : 'resume.pdf';
  const disposition = response.headers.get('Content-Disposition') || '';
  const match = disposition.match(/filename="?([^"]+)"?/i);
  if (match?.[1]) fileName = match[1];

  return {
    success: true,
    fileName,
    mimeType: blob.type || 'application/pdf',
    base64,
  };
}

window.api = {
  DEFAULT_SERVER,
  formatApiMessage,
  getServerUrl,
  ensureServerUrl,
  setCachedToken,
  clearCachedToken,
  login: (username, password) =>
    apiRequest('POST', '/api/auth/login', { username, password, extension: true }),
  logout: () => apiRequest('POST', '/api/auth/logout'),
  me: () => apiRequest('GET', '/api/auth/me'),
  extensionBootstrap: () => apiRequest('GET', '/api/auth/extension-bootstrap'),
  extensionStatus: () => apiRequest('GET', '/api/auth/extension-status'),
  health: () => apiRequest('GET', '/api/health'),
  getCandidates: () => apiRequest('GET', '/api/candidates?active=true'),
  getCandidateStacks: () => apiRequest('GET', '/api/settings/candidate-stacks'),
  getJob: (id) => apiRequest('GET', `/api/jobs/${id}`),
  getJobByUrl: (url) => apiRequest('GET', `/api/jobs/by-url?url=${encodeURIComponent(url)}`),
  upsertJob: (data) => apiRequest('POST', '/api/jobs/upsert', data),
  getCandidate: (id) => apiRequest('GET', `/api/candidates/${id}`),
  createApplicationSession: (data) => apiRequest('POST', '/api/application-sessions', data),
  patchApplicationSessionFields: (applicationId, data) =>
    apiRequest('PATCH', `/api/application-sessions/${applicationId}/fields`, data),
  getApplicationSession: (applicationId) =>
    apiRequest('GET', `/api/application-sessions/${applicationId}`),
  getPendingApplicationFields: (applicationId) =>
    apiRequest('GET', `/api/application-sessions/${applicationId}/pending-fields`),
  submitApplicationAnswers: (applicationId, data) =>
    apiRequest('POST', `/api/application-sessions/${applicationId}/answers`, data),
  getApplicationResult: (applicationId) =>
    apiRequest('GET', `/api/application-sessions/${applicationId}/result`),
  dispatchApplicationTask: (taskId) =>
    apiRequest('POST', `/api/application-tasks/${encodeURIComponent(taskId)}/dispatch`),
  getApplicationTaskStatus: (taskId) =>
    apiRequest('GET', `/api/application-tasks/${encodeURIComponent(taskId)}/status`),
  getApplicationTaskContext: (taskId) =>
    apiRequest('GET', `/api/application-tasks/${encodeURIComponent(taskId)}/context`),
  fetchApplicationDocument: (applicationId, docType) =>
    fetchApplicationDocument(applicationId, docType),
};
