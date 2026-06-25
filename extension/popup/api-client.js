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
  if (cachedAuthToken !== null) return cachedAuthToken;
  return new Promise(resolve => {
    chrome.storage.local.get(['authToken'], r => {
      cachedAuthToken = r.authToken || '';
      resolve(cachedAuthToken);
    });
  });
}

function setCachedToken(token) {
  cachedAuthToken = token || '';
}

function clearCachedToken() {
  cachedAuthToken = null;
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
    data.message = `Request failed (${response.status}).`;
  }

  data._httpStatus = response.status;
  return data;
}

window.api = {
  DEFAULT_SERVER,
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
};
