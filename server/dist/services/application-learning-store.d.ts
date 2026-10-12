export type LearningPolicyType = 'reusable_profile' | 'generated_ai' | 'requires_review' | 'manual_only' | 'ignore';
export declare function normalizeQuestion(question?: string | null): string;
export declare function hashQuestion(question?: string | null): string;
export declare function scoreSemanticMatch(target: {
    question?: string | null;
    fieldType?: string | null;
    sectionHeading?: string | null;
}, candidate: {
    question?: string | null;
    fieldType?: string | null;
    sectionHeading?: string | null;
}): number;
export declare function upsertSemanticMapping(input: {
    stableFieldId: string;
    question?: string | null;
    fieldType?: string | null;
    sectionHeading?: string | null;
    confidence?: number;
    sourceSessionId?: number | null;
    sourceTemplateId?: number | null;
    inferredSemanticGroup?: string;
}): Promise<{
    id: number;
    stable_field_id: string;
    normalized_question: string;
    question_hash: string;
    field_type: string | null;
    section_heading: string | null;
    inferred_semantic_group: string;
    confidence: number;
    source_session_id: number | null;
    source_template_id: number | null;
} | null>;
export declare function upsertAnswerPolicy(input: {
    semanticId: number;
    policyType: LearningPolicyType;
    confidence?: number;
    answerSource?: string | null;
    approvedByUser?: boolean;
    observedAnswer?: string | null;
    editedAnswer?: string | null;
}): Promise<{
    id: number;
    semantic_id: number;
    policy_type: LearningPolicyType;
    answer_source: string | null;
    approved_by_user: boolean;
    confidence: number;
    observed_answer: string | null;
    edited_answer: string | null;
} | null>;
export declare function listLearningQueue(sessionId: number): Promise<Record<string, unknown>[] | {
    stableFieldId: string;
    label: string | null;
    fieldType: string;
    currentAnswer: string | null;
    fillStatus: string;
    category: string;
    sectionHeading: string | null;
    pageStep: string | null;
    updatedAt: string;
}[]>;
export declare function getLearningSummary(sessionId: number): Promise<{
    totalFields: number;
    reusableProfileCount: number;
    generatedAiCount: number;
    reviewRequiredCount: number;
    unresolvedCount: number;
    confidenceAverage: number;
}>;
export declare function getReplayConfidence(sessionId: number): Promise<{
    semanticGroup: {};
    confidence: number;
    policyType: string;
    lastSeenAt: unknown;
    evidenceCount: number;
}[]>;
export declare function evaluateAssistDecision(sessionId: number, input: {
    stableFieldId?: string | null;
    question?: string | null;
    fieldType?: string | null;
    sectionHeading?: string | null;
}): Promise<{
    allowed: boolean;
    reason: string;
    confidence: number;
    policyType: string;
    semanticGroup: string | null;
    requiresReview: boolean;
}>;
//# sourceMappingURL=application-learning-store.d.ts.map