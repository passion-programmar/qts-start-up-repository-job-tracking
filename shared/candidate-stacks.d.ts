export declare const CANDIDATE_STACKS_SETTING_KEY = "candidate_stacks";
export declare const DEFAULT_CANDIDATE_STACKS: readonly ["Full Stack", "Frontend", "Backend", "DevOps", "Mobile", "Data / ML"];
export declare function normalizeStackName(name: string): string;
export declare function parseCandidateStacks(value?: string | null): string[];
export declare function serializeCandidateStacks(stacks: string[]): string;
export declare function sanitizeCandidateStacksInput(stacks: unknown): string[];
//# sourceMappingURL=candidate-stacks.d.ts.map