export declare const CANDIDATE_STACKS_SETTING_KEY = "candidate_stacks";
export declare const DEFAULT_CANDIDATE_STACKS: readonly ["Full Stack", "Frontend", "Backend", "DevOps", "Mobile", "Data / ML"];
export declare function normalizeStackName(name: string): string;
export declare function parseCandidateStacks(value?: string | null): string[];
export declare function serializeCandidateStacks(stacks: string[]): string;
export declare function sanitizeCandidateStacksInput(stacks: unknown): string[];
export declare function getCandidateStacks(): Promise<string[]>;
export declare function saveCandidateStacks(stacks: string[]): Promise<string[]>;
export declare function resolveCanonicalStack(stack: string | null | undefined): Promise<string | null>;
export declare function isValidCandidateStack(stack: string | null | undefined): Promise<boolean>;
//# sourceMappingURL=candidate-stacks.d.ts.map