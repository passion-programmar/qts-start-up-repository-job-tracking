"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseLegacySessionId = parseLegacySessionId;
exports.isPublicTaskId = isPublicTaskId;
exports.createPublicTaskId = createPublicTaskId;
exports.readPublicTaskId = readPublicTaskId;
exports.formatTaskId = formatTaskId;
exports.parseTaskId = parseTaskId;
const node_crypto_1 = require("node:crypto");
/** Legacy numeric alias: task_8 → session id 8 */
function parseLegacySessionId(taskId) {
    const raw = String(taskId || '').trim();
    const match = raw.match(/^task_(\d+)$/i);
    if (match)
        return parseInt(match[1], 10);
    if (/^\d+$/.test(raw))
        return parseInt(raw, 10);
    return null;
}
function isPublicTaskId(taskId) {
    return /^task_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(taskId || '').trim());
}
function createPublicTaskId() {
    return `task_${(0, node_crypto_1.randomUUID)()}`;
}
function readPublicTaskId(metadata) {
    const raw = metadata?.publicTaskId ?? metadata?.taskId;
    if (typeof raw === 'string' && raw.startsWith('task_'))
        return raw;
    return null;
}
/** @deprecated Use readPublicTaskId + session id from DB. Kept for backward compatibility. */
function formatTaskId(sessionId, publicTaskId) {
    if (publicTaskId)
        return publicTaskId;
    return `task_${sessionId}`;
}
/** @deprecated Use resolveSessionIdFromTaskId for API routes. */
function parseTaskId(taskId) {
    return parseLegacySessionId(taskId);
}
//# sourceMappingURL=application-task-id.js.map