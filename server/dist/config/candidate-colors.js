"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CANDIDATE_COLOR_VALUES = exports.CANDIDATE_NAME_COLORS = void 0;
exports.isCandidateColor = isCandidateColor;
exports.normalizeCandidateColor = normalizeCandidateColor;
exports.nextCandidateColor = nextCandidateColor;
/** Curated palette for candidate name colors — keep in sync with shared/candidate-colors.ts */
exports.CANDIDATE_NAME_COLORS = [
    { value: '#2563EB', label: 'Blue' },
    { value: '#4F46E5', label: 'Indigo' },
    { value: '#7C3AED', label: 'Violet' },
    { value: '#9333EA', label: 'Purple' },
    { value: '#DB2777', label: 'Pink' },
    { value: '#E11D48', label: 'Rose' },
    { value: '#DC2626', label: 'Red' },
    { value: '#EA580C', label: 'Orange' },
    { value: '#D97706', label: 'Amber' },
    { value: '#CA8A04', label: 'Gold' },
    { value: '#16A34A', label: 'Green' },
    { value: '#059669', label: 'Emerald' },
    { value: '#0F766E', label: 'Teal' },
    { value: '#0891B2', label: 'Cyan' },
];
exports.CANDIDATE_COLOR_VALUES = exports.CANDIDATE_NAME_COLORS.map((c) => c.value);
function isCandidateColor(color) {
    if (!color)
        return false;
    return exports.CANDIDATE_COLOR_VALUES.some((c) => c.toLowerCase() === color.toLowerCase());
}
function normalizeCandidateColor(color, fallbackIndex = 0) {
    if (isCandidateColor(color)) {
        return exports.CANDIDATE_COLOR_VALUES.find((c) => c.toLowerCase() === color.toLowerCase());
    }
    const index = Math.abs(fallbackIndex) % exports.CANDIDATE_COLOR_VALUES.length;
    return exports.CANDIDATE_COLOR_VALUES[index];
}
function nextCandidateColor(count) {
    return normalizeCandidateColor(null, count);
}
//# sourceMappingURL=candidate-colors.js.map