"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
const timestamp = () => new Date().toISOString();
exports.logger = {
    info: (msg, meta) => {
        const safe = sanitize(meta);
        console.log(`[${timestamp()}] INFO: ${msg}`, safe ? JSON.stringify(safe) : '');
    },
    warn: (msg, meta) => {
        const safe = sanitize(meta);
        console.warn(`[${timestamp()}] WARN: ${msg}`, safe ? JSON.stringify(safe) : '');
    },
    error: (msg, err) => {
        const errMsg = err instanceof Error ? err.message : String(err || '');
        console.error(`[${timestamp()}] ERROR: ${msg}`, errMsg);
    },
};
const SENSITIVE_KEYS = ['password', 'password_hash', 'token', 'secret', 'authorization', 'jwt'];
function sanitize(obj) {
    if (!obj)
        return undefined;
    const result = {};
    for (const [k, v] of Object.entries(obj)) {
        if (SENSITIVE_KEYS.some(s => k.toLowerCase().includes(s))) {
            result[k] = '[REDACTED]';
        }
        else {
            result[k] = v;
        }
    }
    return result;
}
//# sourceMappingURL=logger.js.map