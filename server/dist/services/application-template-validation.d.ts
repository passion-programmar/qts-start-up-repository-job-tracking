export interface TemplateValidationField {
    fieldId: string;
    status: 'matched' | 'ambiguous' | 'unresolved';
    confidence: number;
    selectorHints?: Record<string, unknown>;
}
export interface ApplicationTemplateValidationEvidence {
    observationSignatures: string[];
    validatedFieldIds: string[];
    authorizedTestEnvironmentConfirmed: boolean;
    manualReviewConfirmed: boolean;
    verificationReviewConfirmed: boolean;
}
export declare function buildApplicationTemplateValidationReport(input: {
    templateId: number;
    templateStatus: 'draft' | 'partial' | 'active' | 'deprecated';
    fields: TemplateValidationField[];
    observedStepIds: string[];
    evidence: ApplicationTemplateValidationEvidence;
}): {
    criteriaVersion: number;
    templateId: number;
    observationCount: number;
    uniquePageSignatures: number;
    unobservedSignatures: string[];
    fieldCount: number;
    validatedFieldCount: number;
    unresolvedFieldIds: string[];
    authorizedTestEnvironmentConfirmed: boolean;
    manualReviewConfirmed: boolean;
    verificationReviewConfirmed: boolean;
    criteria: string[];
    passed: boolean;
    evaluatedAt: string;
};
//# sourceMappingURL=application-template-validation.d.ts.map