import { type ApplicationTemplateValidationEvidence } from './application-template-validation';
export type ApplicationTemplateStatus = 'draft' | 'partial' | 'active' | 'deprecated';
export interface ApplicationTemplateFieldSummary {
    fieldId: string;
    question?: string | null;
    fieldType: string;
    required: boolean;
    matchMethod: string;
    confidence: number;
    status: 'matched' | 'ambiguous' | 'unresolved';
    selectorHints?: Record<string, unknown>;
}
export interface ApplicationTemplateInput {
    siteKey?: string | null;
    platform?: string | null;
    host?: string | null;
    templateVersion?: string | null;
    pageSignature?: string | null;
    status?: ApplicationTemplateStatus;
    coverage?: Record<string, number> | null;
    navigation?: Record<string, unknown> | null;
    verification?: Record<string, unknown> | null;
    metadata?: Record<string, unknown> | null;
    fields?: ApplicationTemplateFieldSummary[];
}
export interface ApplicationTemplateRecord {
    id: number;
    siteKey: string;
    platform: string | null;
    host: string | null;
    templateVersion: string | null;
    pageSignature: string | null;
    status: ApplicationTemplateStatus;
    coverage: Record<string, number>;
    navigation: Record<string, unknown>;
    verification: Record<string, unknown>;
    metadata: Record<string, unknown>;
    fields: ApplicationTemplateFieldSummary[];
    validationReport: Record<string, unknown>;
    promotedBy: number | null;
    promotedAt: string | null;
    createdAt: string;
    updatedAt: string;
}
export declare function listApplicationTemplates(): Promise<ApplicationTemplateRecord[]>;
export declare function getApplicationTemplate(id: number): Promise<ApplicationTemplateRecord | null>;
export declare function getApplicationTemplateBySiteKey(siteKey: string): Promise<ApplicationTemplateRecord | null>;
export declare function findReusableApplicationTemplateForSite(input?: {
    siteKey?: string | null;
    platform?: string | null;
    host?: string | null;
}): Promise<ApplicationTemplateRecord | null>;
export declare function upsertApplicationTemplate(input: ApplicationTemplateInput): Promise<ApplicationTemplateRecord>;
export declare function validateAndPromoteApplicationTemplate(templateId: number, reviewerId: number, evidence: ApplicationTemplateValidationEvidence): Promise<{
    template: ApplicationTemplateRecord;
    report: Record<string, unknown>;
}>;
export declare function createApplicationTemplateDraftFromDiscovery(discovery?: Record<string, unknown>): Promise<ApplicationTemplateRecord>;
//# sourceMappingURL=application-template-store.d.ts.map