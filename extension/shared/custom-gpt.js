// Custom GPT handoff — pinned tab reuse + PROCESS_TASK protocol.
(function (global) {
  const CUSTOM_GPT_URL =
    'https://chatgpt.com/g/g-6a3dc5525fac819198dccf1c216e3fc0-qts-job-tracking';
  const CUSTOM_GPT_ID = 'g-6a3dc5525fac819198dccf1c216e3fc0';
  const TASK_PREFIX = 'PROCESS_TASK:';

  function buildTaskId(applicationId) {
    const id = Number(applicationId);
    if (!Number.isFinite(id) || id < 1) {
      throw new Error('Valid application session ID required');
    }
    return `task_${id}`;
  }

  function buildPrompt(taskId) {
    const id = String(taskId || '').trim();
    if (!id) throw new Error('Task ID required');
    return `${TASK_PREFIX} ${id}`;
  }

  function openForSession(applicationId) {
    const taskId = buildTaskId(applicationId);
    return {
      url: CUSTOM_GPT_URL,
      taskId,
      prompt: buildPrompt(taskId),
    };
  }

  function isCustomGptBaseUrl(url) {
    if (!url) return false;
    try {
      const base = new URL(CUSTOM_GPT_URL);
      const current = new URL(url);
      if (current.origin !== base.origin) return false;
      const norm = (path) => path.replace(/\/+$/, '');
      return norm(current.pathname) === norm(base.pathname);
    } catch {
      return false;
    }
  }

  /** True when tab is on Custom GPT but inside an existing /c/ conversation (needs fresh chat). */
  function needsFreshGptConversation(url) {
    if (!url || !url.includes(CUSTOM_GPT_ID)) return true;
    return !isCustomGptBaseUrl(url);
  }

  global.__qtsCustomGpt = {
    CUSTOM_GPT_URL,
    CUSTOM_GPT_ID,
    TASK_PREFIX,
    /** Mirrors Custom GPT Actions operationIds + extension steps */
    ACTION_STEPS: [
      { id: 'dispatch', label: 'PROCESS_TASK → pinned GPT tab', actor: 'extension' },
      { id: 'getTaskContext', label: 'getTaskContext', actor: 'gpt' },
      { id: 'submitTaskPackage', label: 'submitTaskPackage', actor: 'gpt' },
      { id: 'getTaskStatus', label: 'getTaskStatus (ready)', actor: 'gpt' },
      { id: 'apply', label: 'Apply answers on job form', actor: 'extension' },
    ],
    buildTaskId,
    buildPrompt,
    openForSession,
    isCustomGptBaseUrl,
    needsFreshGptConversation,
  };
})(typeof window !== 'undefined' ? window : self);
