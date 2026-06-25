// popup.js — capture window UI logic

let candidates = [];
let candidateStatuses = {};
let candidateAppliedAt = {};
let candidateLocked = {};
let existingJobId = null;
let currentTabUrl = '';
let currentSource = '';
let targetTabId = null;
let jobSavedInBackend = false;
let currentUser = null;
let candidateStacks = [];
const expandedCandidateIds = new Set();

const POPUP_WINDOW_WIDTH = 660;
const POPUP_WINDOW_HEIGHT_RATIO = 0.8;
const POPUP_WINDOW_MIN_HEIGHT = 480;

function getTargetWindowHeight() {
  const screenH = window.screen?.availHeight || window.screen?.height || 900;
  return Math.max(POPUP_WINDOW_MIN_HEIGHT, Math.round(screenH * POPUP_WINDOW_HEIGHT_RATIO));
}

function applyPopupScrollArea(windowHeight) {
  const scroll = document.querySelector('.popup-scroll');
  if (!scroll) return;
  const top = document.querySelector('.popup-top')?.offsetHeight || 0;
  const actionBar = document.getElementById('action-bar');
  const actions = actionBar?.classList.contains('hidden') ? 0 : (actionBar?.offsetHeight || 0);
  scroll.style.maxHeight = `${Math.max(120, windowHeight - top - actions - 8)}px`;
}

function fitPopupWindow() {
  if (!chrome.windows?.getCurrent) return;
  const height = getTargetWindowHeight();
  applyPopupScrollArea(height);
  chrome.windows.getCurrent((win) => {
    if (!win?.id || win.type !== 'popup') return;
    chrome.windows.update(win.id, {
      width: POPUP_WINDOW_WIDTH,
      height,
    });
  });
}

let fitPopupQueued = false;
function scheduleFitPopup() {
  if (fitPopupQueued) return;
  fitPopupQueued = true;
  requestAnimationFrame(() => {
    fitPopupQueued = false;
    fitPopupWindow();
  });
}

function getQueryTabId() {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get('tabId');
  if (!raw) return null;
  const tabId = parseInt(raw, 10);
  return Number.isFinite(tabId) ? tabId : null;
}

// ---- Init ----
document.addEventListener('DOMContentLoaded', async () => {
  const logoEl = document.getElementById('header-logo');
  if (logoEl) logoEl.src = chrome.runtime.getURL('assets/bidder-logo.png');
  targetTabId = getQueryTabId();
  await loadServerUrlField();
  await checkConnection();
  await checkAuth();

  document.getElementById('login-pass').addEventListener('keyup', e => { if (e.key === 'Enter') doLogin(); });
  document.getElementById('btn-login').addEventListener('click', doLogin);
  const serverUrlInput = document.getElementById('login-server-url');
  if (serverUrlInput) {
    serverUrlInput.addEventListener('change', () => { saveServerUrlFromField().catch(() => {}); });
    serverUrlInput.addEventListener('blur', () => { saveServerUrlFromField().catch(() => {}); });
  }
  document.getElementById('btn-logout').addEventListener('click', doLogout);
  document.getElementById('btn-save').addEventListener('click', doSave);
  document.getElementById('btn-refresh').addEventListener('click', doRefresh);
  document.getElementById('cand-filter').addEventListener('input', () => filterCandidates());
  document.getElementById('cand-stack-filter').addEventListener('change', () => filterCandidates());
  document.getElementById('cand-list').addEventListener('change', onCandidateStatusChange);
  document.getElementById('cand-list').addEventListener('click', onCandidateCardClick);
  ['f-title', 'f-company', 'f-url'].forEach(id => {
    document.getElementById(id).addEventListener('input', updateJobSummary);
  });
  document.getElementById('f-desc').addEventListener('input', updateJobSummary);

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'SET_SOURCE_TAB' && msg.tabId) {
      switchSourceTab(msg.tabId)
        .then(() => sendResponse({ ok: true }))
        .catch((e) => sendResponse({ ok: false, error: e?.message || 'Failed' }));
      return true;
    }
    if (msg.type === 'JOB_DETECTED_UPDATE' && msg.tabId) {
      if (Number(msg.tabId) === Number(targetTabId)) {
        loadCurrentTab()
          .then(() => sendResponse({ ok: true }))
          .catch((e) => sendResponse({ ok: false, error: e?.message || 'Failed' }));
        return true;
      }
    }
  });
});

// ---- Connection ----
async function loadServerUrlField() {
  const input = document.getElementById('login-server-url');
  if (!input) return;
  input.value = await window.api.getServerUrl();
}

async function saveServerUrlFromField() {
  const input = document.getElementById('login-server-url');
  if (!input) return;
  const raw = input.value.trim();
  if (!raw) {
    input.value = await window.api.getServerUrl();
    return;
  }
  try {
    const parsed = new URL(raw);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('invalid protocol');
  } catch {
    showAlert('login-alert', 'Enter a valid API URL, e.g. http://192.168.1.5:1028', 'error');
    return;
  }
  const saved = await window.api.setServerUrl(raw);
  input.value = saved;
  if (/\/api(\/health)?\/?$/i.test(raw.trim())) {
    showAlert('login-alert', 'Use the base server URL only (no /api/health). Saved as ' + saved, 'info');
  }
  await checkConnection();
  if (document.getElementById('connection-status')?.classList.contains('status-connected')) {
    clearAlert('login-alert');
  }
}

async function checkConnection() {
  setStatus('checking');
  try {
    const r = await window.api.health();
    setStatus(r.success ? 'connected' : 'disconnected');
  } catch {
    setStatus('disconnected');
  }
}

function setStatus(state) {
  const el = document.getElementById('connection-status');
  const txt = document.getElementById('status-text');
  el.className = `status-pill status-${state}`;
  txt.textContent = state === 'connected' ? 'Connected' : state === 'checking' ? 'Checking…' : 'Disconnected';
}

// ---- Auth ----
function isBidderSession(user) {
  return user && user.role === 'bidder' && user.bidderId;
}

function setSession(user) {
  currentUser = user;
  const bar = document.getElementById('session-bar');
  const orgEl = document.getElementById('session-bidder');
  const userEl = document.getElementById('session-user');
  if (!user || !bar || !orgEl || !userEl) return;

  const orgLabel = (user.bidderName || `Organization #${user.bidderId}`).trim();
  const username = (user.username || '—').trim();
  const showBoth = orgLabel.toLowerCase() !== username.toLowerCase();

  if (showBoth) {
    orgEl.textContent = orgLabel;
    userEl.textContent = username;
    userEl.classList.remove('hidden');
  } else {
    orgEl.textContent = username;
    userEl.textContent = '';
    userEl.classList.add('hidden');
  }

  bar.classList.remove('hidden');
}

function clearSession() {
  currentUser = null;
  const bar = document.getElementById('session-bar');
  if (bar) bar.classList.add('hidden');
}

async function doLogout() {
  try {
    await window.api.logout();
  } catch { /* non-fatal */ }
  await clearToken();
  clearSession();
  await showLogin();
}

async function prepareLoginForm() {
  try {
    const status = await window.api.extensionStatus();
    const hint = document.getElementById('login-setup-hint');
    if (hint) {
      if (status.success && !status.hasBidderAccounts) {
        hint.classList.remove('hidden');
      } else {
        hint.classList.add('hidden');
      }
    }
  } catch { /* non-fatal */ }
}

async function checkAuth() {
  try {
    const token = await getStoredToken();
    if (!token) {
      await showLogin();
      return;
    }
    const r = await window.api.me();
    if (r.success && isBidderSession(r)) {
      setSession(r);
      showJobSection();
      await loadAll();
    } else {
      clearToken();
      clearSession();
      await showLogin();
      if (r.success && !isBidderSession(r)) {
        showAlert(
          'login-alert',
          'The extension requires a bidder account. Use QTS_Startup web for admin or caller access.',
          'error'
        );
      }
    }
  } catch {
    await showLogin();
  }
}

async function doLogin() {
  await saveServerUrlFromField();
  const username = document.getElementById('login-user').value.trim();
  const password = document.getElementById('login-pass').value;
  if (!username || !password) {
    showAlert('login-alert', 'Username and password are required.', 'error');
    return;
  }
  try {
    const r = await window.api.login(username, password);
    if (r.success && isBidderSession(r)) {
      await storeToken(r.token);
      setSession(r);
      clearAlert('login-alert');
      showJobSection();
      await loadAll();
    } else if (r.success) {
      showAlert(
        'login-alert',
        'The extension requires a bidder account. Use QTS_Startup web for admin or caller access.',
        'error'
      );
    } else {
      showAlert('login-alert', r.message || 'Login failed.', 'error');
    }
  } catch {
    showAlert('login-alert', 'Cannot connect to the server. Check API Server URL and that QTS_Startup is running.', 'error');
  }
}

// ---- Load all data ----
async function loadAll() {
  await loadCandidates();
  await loadCurrentTab();
  updateJobSummary();
  scheduleFitPopup();
}

async function switchSourceTab(tabId) {
  targetTabId = tabId;
  const url = new URL(window.location.href);
  url.searchParams.set('tabId', String(tabId));
  window.history.replaceState(null, '', url.toString());
  document.getElementById('main-alert').innerHTML = '';
  existingJobId = null;
  jobSavedInBackend = false;
  await loadAll();
}

async function loadCandidates() {
  try {
    const [candidatesRes, stacksRes] = await Promise.all([
      window.api.getCandidates(),
      window.api.getCandidateStacks(),
    ]);
    candidates = (candidatesRes.candidates || []).filter((c) => c.is_active);
    candidateStacks = stacksRes?.stacks || [];
    candidateStatuses = {};
    candidateAppliedAt = {};
    candidateLocked = {};
    for (const c of candidates) {
      candidateStatuses[c.id] = 'none';
      candidateLocked[c.id] = false;
    }
    populateStackFilter();
  } catch { /* non-fatal */ }
}

function populateStackFilter() {
  const select = document.getElementById('cand-stack-filter');
  if (!select) return;

  const previous = select.value;
  const fromCandidates = candidates.map((c) => c.stack).filter(Boolean);
  const allStacks = [...new Set([...candidateStacks, ...fromCandidates])]
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

  select.innerHTML = '<option value="">All stacks</option>' +
    allStacks.map((stack) => `<option value="${escAttr(stack)}">${escHtml(stack)}</option>`).join('');

  if ([...select.options].some((opt) => opt.value === previous)) {
    select.value = previous;
  }
}

function getCandidateFilters() {
  return {
    text: (document.getElementById('cand-filter')?.value || '').trim(),
    stack: document.getElementById('cand-stack-filter')?.value || '',
  };
}

function candidateMatchesFilters(candidate, filters) {
  const stack = (candidate.stack || '').trim();
  const matchesStack = !filters.stack
    || stack.toLowerCase() === filters.stack.toLowerCase();

  if (!filters.text) return matchesStack;

  const text = filters.text.toLowerCase();
  const matchesText = candidate.name.toLowerCase().includes(text)
    || (candidate.email || '').toLowerCase().includes(text)
    || stack.toLowerCase().includes(text);

  return matchesStack && matchesText;
}

async function loadCurrentTab() {
  try {
    let tab = null;
    if (targetTabId) {
      tab = await chrome.tabs.get(targetTabId);
    } else {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      tab = activeTab;
    }
    if (!tab) return;

    currentTabUrl = tab.url || '';
    document.getElementById('f-url').value = currentTabUrl;

    const saved = await findSavedJobByUrls([
      document.getElementById('f-url').value.trim(),
      currentTabUrl,
    ]);

    if (saved) {
      loadExistingJob(saved);
      renderCandidates();
      return;
    }

    jobSavedInBackend = false;
    existingJobId = null;
    candidateLocked = {};
    for (const c of candidates) {
      candidateStatuses[c.id] = 'none';
      candidateAppliedAt[c.id] = null;
      candidateLocked[c.id] = false;
    }

    if (isExtractablePageUrl(currentTabUrl)) {
      await applyDetectedJobForTab(tab.id, currentTabUrl);
    } else {
      showAlert('main-alert', restrictedPageMessage(currentTabUrl), 'info');
    }

    renderCandidates();
    document.getElementById('btn-save').textContent = 'Save Job';
  } catch (e) {
    console.error('loadCurrentTab error:', e);
    showAlert('main-alert', 'Could not read the current page. Try clicking Refresh.', 'error');
  }
}

async function applyDetectedJobForTab(tabId, pageUrl) {
  const normalizedPageUrl = normalizeJobUrl(pageUrl);
  const detected = await getDetectedJobForTab(tabId);
  if (detected && detected.url === normalizedPageUrl) {
    if (detected.valid && detected.data) {
      populateForm(detected.data);
      showAlert('main-alert', DETECT_SUCCESS_MESSAGE, 'success');
      onJobDetected();
      return;
    }
    showAlert('main-alert', DETECT_FAIL_MESSAGE, 'fail');
    onJobDetected();
    return;
  }

  await extractFromPage(tabId, pageUrl);
}

async function findSavedJobByUrls(urls) {
  const seen = new Set();
  for (const raw of urls) {
    const url = (raw || '').trim();
    if (!url || !url.startsWith('http') || seen.has(url)) continue;
    seen.add(url);
    const saved = await fetchJobByUrl(url);
    if (saved) return saved;
  }
  return null;
}

async function fetchJobByUrl(url) {
  try {
    const r = await window.api.getJobByUrl(url);
    if (r.success && r.job) return r.job;
    if (r._httpStatus && r._httpStatus !== 404) {
      console.warn('fetchJobByUrl failed:', r.message);
    }
  } catch (e) {
    console.warn('fetchJobByUrl error:', e);
  }
  return null;
}

async function extractFromPage(tabId, pageUrl) {
  if (!isExtractablePageUrl(pageUrl)) return;
  try {
    const response = await chrome.runtime.sendMessage({ type: 'EXTRACT_JOB', tabId });
    if (response?.error) {
      if (!response.manualOnly) console.warn('Extraction failed:', response.error);
      if (response.manualOnly) {
        showAlert('main-alert', response.error, 'info');
      } else {
        showAlert('main-alert', DETECT_FAIL_MESSAGE, 'fail');
        onJobDetected();
      }
      return;
    }

    const valid = Boolean(response?.detected);
    if (valid && response?.data) {
      populateForm(normalizeDetectedJobData(response.data, response.url || pageUrl));
      showAlert('main-alert', DETECT_SUCCESS_MESSAGE, 'success');
      onJobDetected();
      return;
    }

    showAlert('main-alert', DETECT_FAIL_MESSAGE, 'fail');
    onJobDetected();
  } catch (e) {
    console.warn('Extraction failed:', e);
    showAlert('main-alert', DETECT_FAIL_MESSAGE, 'fail');
    onJobDetected();
  }
}

function populateForm(data) {
  if (data.title) document.getElementById('f-title').value = data.title;
  if (data.company) document.getElementById('f-company').value = data.company;
  if (data.url) document.getElementById('f-url').value = data.url;
  if (data.description) document.getElementById('f-desc').value = data.description;
  currentSource = data.source || '';
  updateJobSummary();
}

function loadExistingJob(job) {
  existingJobId = job.id;
  jobSavedInBackend = true;
  document.getElementById('f-title').value = job.title || '';
  document.getElementById('f-company').value = job.company || '';
  document.getElementById('f-url').value = job.url || '';
  document.getElementById('f-desc').value = job.description || '';
  currentSource = job.source || '';
  syncCandidateStatusesFromJob(job.candidateStatuses || []);
  updateJobSummary();

  const appliedCount = Object.values(candidateStatuses).filter(s => s === 'applied').length;
  const editableCount = candidates.length - appliedCount;
  let msg = 'This job is already saved in the database.';
  if (appliedCount > 0) {
    msg += ` ${appliedCount} candidate(s) already applied (locked).`;
  }
  if (editableCount > 0) {
    msg += ` You can mark the remaining ${editableCount} as applied.`;
  }
  showAlert('main-alert', msg, 'info');
  document.getElementById('btn-save').textContent = 'Update Job';
}

function syncCandidateStatusesFromJob(statuses) {
  for (const c of candidates) {
    candidateStatuses[c.id] = 'none';
    candidateAppliedAt[c.id] = null;
    candidateLocked[c.id] = false;
  }

  for (const cs of statuses) {
    const status = cs.status || 'none';
    candidateStatuses[cs.candidate_id] = status;
    candidateAppliedAt[cs.candidate_id] = cs.applied_at || null;
    candidateLocked[cs.candidate_id] = status === 'applied';
  }
}

function isCandidateLocked(candidateId) {
  return !!candidateLocked[candidateId];
}

function updateJobSummary() {
  const summary = document.getElementById('job-summary');
  summary.classList.remove('hidden');
  document.getElementById('summary-source').textContent = currentSource || '—';

  const isSaved = !!existingJobId;
  const statusEl = document.getElementById('summary-status');
  statusEl.textContent = isSaved ? 'Saved' : 'New';
  statusEl.className = `job-summary-status-pill ${isSaved ? 'is-saved' : 'is-new'}`;

  const appliedCount = Object.values(candidateStatuses).filter(s => s === 'applied').length;
  const noneCount = candidates.length - appliedCount;
  document.getElementById('summary-applied').textContent = String(appliedCount);
  document.getElementById('summary-not-applied').textContent = String(noneCount);
}

function pickCandidateColor(candidate, index = 0) {
  return normalizeCandidateColor(candidate?.color, Number(candidate?.id) || index);
}

function formatCopyableDetailValue(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  return `<button type="button" class="cand-copyable" data-copy-value="${escAttr(text)}" title="Hover and click to copy" aria-label="Copy ${escAttr(text)}">${escHtml(text)}</button>`;
}

function formatCandidateDetails(candidate, status, appliedAt, locked) {
  const rows = [];

  if (candidate.email) {
    rows.push(['Email', formatCopyableDetailValue(candidate.email)]);
  }
  if (candidate.phone) {
    rows.push(['Phone', formatCopyableDetailValue(candidate.phone)]);
  }
  if (candidate.linkedin_url) {
    rows.push(['LinkedIn', formatCopyableDetailValue(candidate.linkedin_url)]);
  }
  if (candidate.stack) {
    rows.push(['Stack', escHtml(candidate.stack)]);
  }
  if (candidate.notes) {
    rows.push(['Notes', escHtml(candidate.notes)]);
  }

  const statusText = status === 'applied'
    ? (locked ? 'Applied (locked)' : 'Applied')
    : 'Not applied';
  rows.push(['Application', escHtml(statusText)]);
  if (status === 'applied' && appliedAt) {
    rows.push(['Applied at', escHtml(formatDate(appliedAt))]);
  }

  if (!rows.length) {
    return '<p class="cand-details-empty">No additional information.</p>';
  }

  return rows.map(([label, value]) => `
    <div class="cand-detail-row">
      <span class="cand-detail-label">${label}</span>
      <span class="cand-detail-value">${value}</span>
    </div>`).join('');
}

// ---- Candidates ----
function collapseAllCandidateCards() {
  expandedCandidateIds.clear();
  document.querySelectorAll('.cand-card.is-expanded').forEach((card) => {
    card.classList.remove('is-expanded');
    const btn = card.querySelector('.cand-expand-btn');
    if (btn) btn.setAttribute('aria-expanded', 'false');
  });
}

function onJobDetected() {
  collapseAllCandidateCards();
  renderCandidates();
}

async function copyTextToClipboard(text) {
  const value = String(text || '').trim();
  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
    showToast(`Copied: ${value}`, 'success');
  } catch {
    const ta = document.createElement('textarea');
    ta.value = value;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    showToast(`Copied: ${value}`, 'success');
  }
}

function renderCandidates() {
  const list = document.getElementById('cand-list');
  const empty = document.getElementById('cand-empty');
  const filters = getCandidateFilters();
  const filtered = candidates.filter((c) => candidateMatchesFilters(c, filters));

  if (!candidates.length) {
    list.innerHTML = '';
    empty.classList.remove('hidden');
    scheduleFitPopup();
    return;
  }

  empty.classList.add('hidden');

  if (!filtered.length) {
    list.innerHTML = '<div style="color:#9ca3af;padding:8px 0;font-size:12px">No candidates match your filter.</div>';
    scheduleFitPopup();
    return;
  }

  list.innerHTML = filtered.map((c, i) => {
    const status = candidateStatuses[c.id] || 'none';
    const locked = isCandidateLocked(c.id);
    const appliedAt = candidateAppliedAt[c.id];
    const nameColor = pickCandidateColor(c, i);
    const isExpanded = expandedCandidateIds.has(c.id);

    const statusLabel = locked ? 'APPLIED' : (status === 'applied' ? 'APPLIED' : 'NOT APPLIED');

    const statusControl = locked
      ? `<label class="status-toggle is-locked is-on" title="Already applied — cannot be changed">
          <span class="status-toggle-text">${statusLabel}</span>
          <input type="checkbox" class="status-toggle-input" data-cid="${c.id}" checked disabled aria-label="Applied (locked)" />
          <span class="status-toggle-track" aria-hidden="true"></span>
        </label>`
      : `<label class="status-toggle ${status === 'applied' ? 'is-on' : ''}" title="Toggle applied status">
          <span class="status-toggle-text">${statusLabel}</span>
          <input type="checkbox" class="status-toggle-input" data-cid="${c.id}" ${status === 'applied' ? 'checked' : ''} aria-label="Mark ${escAttr(c.name)} as applied" />
          <span class="status-toggle-track" aria-hidden="true"></span>
        </label>`;

    const stackHtml = c.stack
      ? `<span class="cand-stack">${escHtml(c.stack)}</span>`
      : '';

    return `
      <div class="cand-card ${locked ? 'locked' : ''} ${isExpanded ? 'is-expanded' : ''}" data-cid="${c.id}">
        <div class="cand-card-head">
          <button type="button" class="cand-expand-btn" aria-expanded="${isExpanded ? 'true' : 'false'}" aria-label="Show details for ${escAttr(c.name)}">
            <span class="cand-expand-icon" aria-hidden="true">▸</span>
            <span class="cand-info">
              <span class="cand-name-line">
                <span class="cand-name" style="color:${nameColor}">${escHtml(c.name)}</span>${stackHtml}
              </span>
            </span>
          </button>
          <div class="cand-status-wrap" onclick="event.stopPropagation()">
            ${statusControl}
          </div>
        </div>
        <div class="cand-card-details">
          ${formatCandidateDetails(c, status, appliedAt, locked)}
        </div>
      </div>`;
  }).join('');
  scheduleFitPopup();
}

function onCandidateCardClick(event) {
  if (event.target.closest('.status-toggle')) return;

  const copyBtn = event.target.closest('.cand-copyable');
  if (copyBtn) {
    event.stopPropagation();
    event.preventDefault();
    copyTextToClipboard(copyBtn.dataset.copyValue || copyBtn.textContent || '');
    return;
  }

  if (event.target.closest('.cand-card-details')) return;

  const head = event.target.closest('.cand-card-head');
  if (!head) return;

  const card = head.closest('.cand-card');
  if (!card) return;

  const candidateId = parseInt(card.dataset.cid, 10);
  if (!Number.isFinite(candidateId)) return;

  const isExpanded = card.classList.toggle('is-expanded');
  if (isExpanded) expandedCandidateIds.add(candidateId);
  else expandedCandidateIds.delete(candidateId);

  const btn = card.querySelector('.cand-expand-btn');
  if (btn) btn.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');

  scheduleFitPopup();
}

function onCandidateStatusChange(event) {
  const input = event.target;
  if (!input.classList.contains('status-toggle-input')) return;

  const candidateId = parseInt(input.dataset.cid, 10);
  if (isCandidateLocked(candidateId)) {
    input.checked = true;
    return;
  }

  const newStatus = input.checked ? 'applied' : 'none';
  if (newStatus === 'none' && jobSavedInBackend) {
    input.checked = candidateStatuses[candidateId] === 'applied';
    return;
  }

  candidateStatuses[candidateId] = newStatus;

  if (newStatus === 'applied') {
    if (!candidateAppliedAt[candidateId]) {
      candidateAppliedAt[candidateId] = new Date().toISOString();
    }
  } else {
    candidateAppliedAt[candidateId] = null;
  }

  const label = input.closest('.status-toggle');
  const textEl = label?.querySelector('.status-toggle-text');
  if (label) {
    label.classList.toggle('is-on', newStatus === 'applied');
  }
  if (textEl) {
    textEl.textContent = newStatus === 'applied' ? 'APPLIED' : 'NOT APPLIED';
  }

  const card = input.closest('.cand-card');
  if (card && card.classList.contains('is-expanded')) {
    const details = card.querySelector('.cand-card-details');
    const candidate = candidates.find((c) => Number(c.id) === candidateId);
    if (details && candidate) {
      details.innerHTML = formatCandidateDetails(
        candidate,
        newStatus,
        candidateAppliedAt[candidateId],
        isCandidateLocked(candidateId)
      );
    }
  }

  updateJobSummary();
}

function filterCandidates() {
  renderCandidates();
}

function formatApiError(response) {
  if (response?.errors?.length) {
    return response.errors.map(e => `${e.field}: ${e.message}`).join(' · ');
  }
  return response?.message || 'Could not save the job.';
}

// ---- Save / Update ----
async function doSave() {
  clearErrors();
  const title = document.getElementById('f-title').value.trim();
  const company = document.getElementById('f-company').value.trim();
  const url = document.getElementById('f-url').value.trim();
  const description = document.getElementById('f-desc').value.trim();

  let valid = true;
  if (!title) { showFieldError('err-title'); valid = false; }
  if (!company) { showFieldError('err-company'); valid = false; }
  if (!url) { showFieldError('err-url'); valid = false; }
  if (!valid) return;

  const candidateStatusesArr = candidates.map(c => ({
    candidateId: Number(c.id),
    status: isCandidateLocked(c.id) ? 'applied' : (candidateStatuses[c.id] || 'none'),
  }));

  const payload = {
    title,
    company,
    url,
    description,
    ...(currentSource ? { source: currentSource } : {}),
    candidateStatuses: candidateStatusesArr,
  };

  const saveBtn = document.getElementById('btn-save');
  const wasUpdate = !!existingJobId;

  try {
    saveBtn.disabled = true;
    const r = await window.api.upsertJob(payload);

    if (r.success) {
      showAlert('main-alert', wasUpdate ? 'Job updated!' : 'Job saved!', 'success');
      if (r.job) {
        existingJobId = r.job.id;
        jobSavedInBackend = true;
        syncCandidateStatusesFromJob(r.job.candidateStatuses || []);
        currentSource = r.job.source || currentSource;
        renderCandidates();
        updateJobSummary();
      }
      saveBtn.textContent = 'Update Job';
    } else {
      showAlert('main-alert', formatApiError(r), 'error');
    }
  } catch (e) {
    console.error('doSave error:', e);
    showAlert('main-alert', 'The local server is not available. Check that it is running.', 'error');
  } finally {
    saveBtn.disabled = false;
  }
}

async function doRefresh() {
  existingJobId = null;
  jobSavedInBackend = false;
  candidateStatuses = {};
  candidateAppliedAt = {};
  candidateLocked = {};
  currentSource = '';
  clearErrors();
  clearAlert('main-alert');
  document.getElementById('btn-save').textContent = 'Save Job';
  ['f-title', 'f-company', 'f-url', 'f-desc'].forEach(id => document.getElementById(id).value = '');
  updateJobSummary();
  await loadAll();
}

// ---- UI helpers ----
function showLogin() {
  document.getElementById('login-section').classList.remove('hidden');
  document.getElementById('job-section').classList.add('hidden');
  document.getElementById('action-bar').classList.add('hidden');
  clearSession();
  scheduleFitPopup();
  return prepareLoginForm();
}

function showJobSection() {
  document.getElementById('login-section').classList.add('hidden');
  document.getElementById('job-section').classList.remove('hidden');
  document.getElementById('action-bar').classList.remove('hidden');
  scheduleFitPopup();
}

let toastHideTimer = null;

function normalizeToastType(type) {
  const value = String(type || 'info').toLowerCase();
  if (['success', 'fail', 'error', 'info', 'warn'].includes(value)) return value;
  return 'info';
}

function showToast(msg, type = 'info') {
  const host = document.getElementById('qts-toast-host');
  if (!host) return;

  const toastType = normalizeToastType(type);
  host.querySelectorAll('.qts-toast').forEach((node) => node.remove());
  clearTimeout(toastHideTimer);

  const toast = document.createElement('div');
  toast.className = `qts-toast qts-toast--${toastType} is-visible`;
  toast.setAttribute('role', 'alert');
  toast.textContent = msg;
  host.appendChild(toast);

  toastHideTimer = setTimeout(() => {
    toast.classList.remove('is-visible');
    setTimeout(() => toast.remove(), 220);
  }, 2800);
}

function showAlert(id, msg, type = 'info') {
  showToast(msg, type);
  const el = document.getElementById(id);
  if (el) el.innerHTML = '';
}

function clearAlert(id) {
  clearTimeout(toastHideTimer);
  const host = document.getElementById('qts-toast-host');
  if (host) host.innerHTML = '';
  const el = document.getElementById(id);
  if (el) el.innerHTML = '';
}

function showFieldError(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('visible');
}

function clearErrors() {
  document.querySelectorAll('.field-error').forEach(e => e.classList.remove('visible'));
}

function formatDate(value) {
  if (!value) return '—';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function escHtml(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function escAttr(s) {
  return escHtml(s).replace(/'/g, '&#39;');
}

function storeToken(token) {
  return new Promise(res => chrome.storage.local.set({ authToken: token }, res));
}

function getStoredToken() {
  return new Promise(res => chrome.storage.local.get(['authToken'], r => res(r.authToken || '')));
}

function clearToken() {
  return new Promise(res => chrome.storage.local.remove(['authToken'], res));
}
