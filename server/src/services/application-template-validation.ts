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

export function buildApplicationTemplateValidationReport(input: {
  templateId: number;
  templateStatus: 'draft' | 'partial' | 'active' | 'deprecated';
  fields: TemplateValidationField[];
  observedStepIds: string[];
  evidence: ApplicationTemplateValidationEvidence;
}) {
  const uniqueSignatures = [...new Set(input.evidence.observationSignatures.map((value) => value.trim()).filter(Boolean))];
  const observedStepIds = new Set(input.observedStepIds);
  const unobservedSignatures = uniqueSignatures.filter((signature) => !observedStepIds.has(signature));
  const requestedFields = new Set(input.evidence.validatedFieldIds);
  const unverifiedFields = input.fields.filter((field) =>
    field.status !== 'matched'
    || field.confidence < 0.8
    || !field.selectorHints
    || !['id', 'name', 'data-testid'].some((key) =>
      typeof field.selectorHints?.[key] === 'string' && field.selectorHints[key]
    )
    || !requestedFields.has(field.fieldId)
  );
  const report = {
    criteriaVersion: 1,
    templateId: input.templateId,
    observationCount: input.evidence.observationSignatures.length,
    uniquePageSignatures: uniqueSignatures.length,
    unobservedSignatures,
    fieldCount: input.fields.length,
    validatedFieldCount: input.fields.length - unverifiedFields.length,
    unresolvedFieldIds: unverifiedFields.map((field) => field.fieldId),
    authorizedTestEnvironmentConfirmed: input.evidence.authorizedTestEnvironmentConfirmed,
    manualReviewConfirmed: input.evidence.manualReviewConfirmed,
    verificationReviewConfirmed: input.evidence.verificationReviewConfirmed,
    criteria: [
      'At least two distinct observed discovery steps are independently rechecked.',
      'Every stored field has a stable selector hint, matched status, and confidence of at least 0.8.',
      'The reviewer confirms authorized test conditions, manual review, and verification/security review.',
    ],
    passed: false,
    evaluatedAt: new Date().toISOString(),
  };
  report.passed = input.templateStatus !== 'deprecated'
    && input.evidence.observationSignatures.length >= 2
    && uniqueSignatures.length >= 2
    && unobservedSignatures.length === 0
    && input.fields.length > 0
    && unverifiedFields.length === 0
    && input.evidence.authorizedTestEnvironmentConfirmed
    && input.evidence.manualReviewConfirmed
    && input.evidence.verificationReviewConfirmed;
  return report;
}
