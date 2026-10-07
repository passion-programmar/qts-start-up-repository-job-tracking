"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_CANDIDATE_STACKS = exports.CANDIDATE_STACKS_SETTING_KEY = void 0;
exports.normalizeStackName = normalizeStackName;
exports.parseCandidateStacks = parseCandidateStacks;
exports.serializeCandidateStacks = serializeCandidateStacks;
exports.sanitizeCandidateStacksInput = sanitizeCandidateStacksInput;
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
    return parseCandidateStacks(serializeCandidateStacks(stacks.filter((item) => typeof item === 'string')));
}
//# sourceMappingURL=candidate-stacks.js.map