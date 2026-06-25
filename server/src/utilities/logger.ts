const timestamp = () => new Date().toISOString();

export const logger = {
  info: (msg: string, meta?: Record<string, unknown>) => {
    const safe = sanitize(meta);
    console.log(`[${timestamp()}] INFO: ${msg}`, safe ? JSON.stringify(safe) : '');
  },
  warn: (msg: string, meta?: Record<string, unknown>) => {
    const safe = sanitize(meta);
    console.warn(`[${timestamp()}] WARN: ${msg}`, safe ? JSON.stringify(safe) : '');
  },
  error: (msg: string, err?: unknown) => {
    const errMsg = err instanceof Error ? err.message : String(err || '');
    console.error(`[${timestamp()}] ERROR: ${msg}`, errMsg);
  },
};

const SENSITIVE_KEYS = ['password', 'password_hash', 'token', 'secret', 'authorization', 'jwt'];

function sanitize(obj?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!obj) return undefined;
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (SENSITIVE_KEYS.some(s => k.toLowerCase().includes(s))) {
      result[k] = '[REDACTED]';
    } else {
      result[k] = v;
    }
  }
  return result;
}
