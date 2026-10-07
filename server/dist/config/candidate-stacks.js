"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_CANDIDATE_STACKS = exports.CANDIDATE_STACKS_SETTING_KEY = void 0;
exports.normalizeStackName = normalizeStackName;
exports.parseCandidateStacks = parseCandidateStacks;
exports.serializeCandidateStacks = serializeCandidateStacks;
exports.sanitizeCandidateStacksInput = sanitizeCandidateStacksInput;
exports.getCandidateStacks = getCandidateStacks;
exports.saveCandidateStacks = saveCandidateStacks;
exports.resolveCanonicalStack = resolveCanonicalStack;
exports.isValidCandidateStack = isValidCandidateStack;
/** Candidate stack options — keep in sync with shared/candidate-stacks.ts */
const connection_1 = require("../database/connection");
const logger_1 = require("../utilities/logger");
exports.CANDIDATE_STACKS_SETTING_KEY = 'candidate_stacks';
exports.DEFAULT_CANDIDATE_STACKS = [
    'Full Stack',
    'Frontend',
    'Backend',
    'DevOps',
    'Mobile',
    'Data / ML',
];
function normalizeStackName(name) {
    return name.trim().replace(/\s+/g, ' ');
}
function parseCandidateStacks(value) {
    if (!value)
        return [...exports.DEFAULT_CANDIDATE_STACKS];
    try {
        const parsed = JSON.parse(value);
        if (!Array.isArray(parsed))
            return [...exports.DEFAULT_CANDIDATE_STACKS];
        const stacks = parsed
            .filter((item) => typeof item === 'string')
            .map(normalizeStackName)
            .filter(Boolean);
        return stacks.length ? stacks : [...exports.DEFAULT_CANDIDATE_STACKS];
    }
    catch {
        return [...exports.DEFAULT_CANDIDATE_STACKS];
    }
}
function serializeCandidateStacks(stacks) {
    const unique = [];
    for (const stack of stacks) {
        const normalized = normalizeStackName(stack);
        if (!normalized)
            continue;
        if (!unique.some((existing) => existing.toLowerCase() === normalized.toLowerCase())) {
            unique.push(normalized);
        }
    }
    return JSON.stringify(unique);
}
function sanitizeCandidateStacksInput(stacks) {
    if (!Array.isArray(stacks))
        return [];
    const unique = [];
    for (const item of stacks) {
        if (typeof item !== 'string')
            continue;
        const normalized = normalizeStackName(item);
        if (!normalized)
            continue;
        if (!unique.some((existing) => existing.toLowerCase() === normalized.toLowerCase())) {
            unique.push(normalized);
        }
    }
    return unique;
}
async function getCandidateStacks() {
    const row = await (0, connection_1.queryOne)('SELECT value FROM settings WHERE key = $1', [exports.CANDIDATE_STACKS_SETTING_KEY]);
    return parseCandidateStacks(row?.value);
}
async function saveCandidateStacks(stacks) {
    const sanitized = sanitizeCandidateStacksInput(stacks);
    if (!sanitized.length) {
        throw new Error('At least one stack option is required.');
    }
    const previous = await getCandidateStacks();
    const serialized = serializeCandidateStacks(sanitized);
    await (0, connection_1.execute)(`INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, NOW())
     ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`, [exports.CANDIDATE_STACKS_SETTING_KEY, serialized]);
    const removed = previous.filter((name) => !sanitized.includes(name));
    for (const name of removed) {
        try {
            await (0, connection_1.execute)('UPDATE candidates SET stack = NULL, updated_at = NOW() WHERE stack = $1', [name]);
        }
        catch (err) {
            logger_1.logger.warn('Could not clear removed stack from candidates', { name, err });
        }
    }
    return sanitized;
}
async function resolveCanonicalStack(stack) {
    if (!stack?.trim())
        return null;
    const normalized = normalizeStackName(stack);
    const stacks = await getCandidateStacks();
    return stacks.find((s) => normalizeStackName(s).toLowerCase() === normalized.toLowerCase()) ?? null;
}
async function isValidCandidateStack(stack) {
    if (!stack?.trim())
        return true;
    return (await resolveCanonicalStack(stack)) !== null;
}
//# sourceMappingURL=candidate-stacks.js.map