/** Curated palette for candidate name colors — keep in sync with shared/candidate-colors.ts */
export declare const CANDIDATE_NAME_COLORS: readonly [{
    readonly value: "#2563EB";
    readonly label: "Blue";
}, {
    readonly value: "#4F46E5";
    readonly label: "Indigo";
}, {
    readonly value: "#7C3AED";
    readonly label: "Violet";
}, {
    readonly value: "#9333EA";
    readonly label: "Purple";
}, {
    readonly value: "#DB2777";
    readonly label: "Pink";
}, {
    readonly value: "#E11D48";
    readonly label: "Rose";
}, {
    readonly value: "#DC2626";
    readonly label: "Red";
}, {
    readonly value: "#EA580C";
    readonly label: "Orange";
}, {
    readonly value: "#D97706";
    readonly label: "Amber";
}, {
    readonly value: "#CA8A04";
    readonly label: "Gold";
}, {
    readonly value: "#16A34A";
    readonly label: "Green";
}, {
    readonly value: "#059669";
    readonly label: "Emerald";
}, {
    readonly value: "#0F766E";
    readonly label: "Teal";
}, {
    readonly value: "#0891B2";
    readonly label: "Cyan";
}];
export declare const CANDIDATE_COLOR_VALUES: ("#2563EB" | "#4F46E5" | "#7C3AED" | "#9333EA" | "#DB2777" | "#E11D48" | "#DC2626" | "#EA580C" | "#D97706" | "#CA8A04" | "#16A34A" | "#059669" | "#0F766E" | "#0891B2")[];
export type CandidateColor = (typeof CANDIDATE_COLOR_VALUES)[number];
export declare function isCandidateColor(color: string | null | undefined): color is CandidateColor;
export declare function normalizeCandidateColor(color: string | null | undefined, fallbackIndex?: number): CandidateColor;
export declare function nextCandidateColor(count: number): CandidateColor;
//# sourceMappingURL=candidate-colors.d.ts.map