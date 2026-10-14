import { queryAll, queryOne, withTransaction } from '../database/connection';
import {
  buildApplicationTemplateValidationReport,
  type ApplicationTemplateValidationEvidence,
} from './application-template-validation';

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

type ApplicationTemplateRow = {
  template_id: number;
  site_key: string;
  platform: string | null;
  host: string | null;
  template_version: string | null;
  page_signature: string | null;
  status: ApplicationTemplateStatus;
  coverage: Record<string, number> | null;
  navigation: Record<string, unknown> | null;
  verification: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  fields: ApplicationTemplateFieldSummary[] | null;
  validation_report: Record<string, unknown> | null;
  promoted_by: number | null;
  promoted_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

const SAFE_SELECTOR_HINTS = new Set([
  'id',
  'name',
  'type',
  'tagName',
  'role',
  'autocomplete',
  'data-testid',
]);

function normalizeSiteKey(siteKey?: string | null, platform?: string | null, host?: string | null, pageSignature?: string | null) {
  const raw = String(siteKey || '').trim();
  if (raw) return raw;
  const parts = [
    (platform ?? '').toString().trim(),
    (host ?? '').toString().trim().toLowerCase(),
    (pageSignature ?? '').toString().trim(),
  ].filter(Boolean);
  return parts.join(':') || 'unknown-site';
}

function normalizeCoverage(coverage?: Record<string, number> | null): Record<string, number> {
  const safe = coverage && typeof coverage === 'object' ? coverage : {};
  const count = (value: unknown) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.floor(Math.max(0, Math.min(10000, parsed))) : 0;
  };
  return {
    visibleFields: count(safe.visibleFields ?? safe.visible),
    matchedFields: count(safe.matchedFields),
    unresolvedFields: count(safe.unresolvedFields),
  };
}

function normalizeSelectorHints(hints?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!hints || typeof hints !== 'object') return undefined;
  const safeEntries = Object.entries(hints).filter(([key, value]) =>
    SAFE_SELECTOR_HINTS.has(key)
    && (typeof value === 'string' || typeof value === 'number')
    && String(value).length <= 255
  );
  return safeEntries.length ? Object.fromEntries(safeEntries) : undefined;
}

function normalizeFields(fields?: ApplicationTemplateFieldSummary[] | null): ApplicationTemplateFieldSummary[] {
  if (!Array.isArray(fields)) return [];
  return fields.slice(0, 500).map((field) => ({
    fieldId: String(field?.fieldId || 'unknown-field').slice(0, 255),
    question: typeof field?.question === 'string' ? field.question.slice(0, 1000) : null,
    fieldType: String(field?.fieldType || 'unknown').slice(0, 64),
    required: Boolean(field?.required),
    matchMethod: String(field?.matchMethod || 'unknown').slice(0, 64),
    confidence: Math.max(0, Math.min(1, Number(field?.confidence ?? 0) || 0)),
    status: field?.status === 'ambiguous' || field?.status === 'unresolved' ? field.status : 'matched',
    selectorHints: normalizeSelectorHints(field?.selectorHints),
  }));
}

function normalizeDiscoveryCheckpoint(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const checkpoint = value as Record<string, unknown>;
  const rawSteps = (Array.isArray(checkpoint.steps) ? checkpoint.steps : [])
    .slice(-50)
    .filter((step) => step && typeof step === 'object');
  let remainingFields = 300;
  const steps = rawSteps.slice().reverse().map((step) => {
    const entry = step as Record<string, unknown>;
    const actions = Array.isArray(entry.actions) ? entry.actions.slice(0, 50) : [];
    const fields = Array.isArray(entry.fields) ? entry.fields.slice(0, remainingFields) : [];
    remainingFields -= fields.length;
    return {
      stepId: String(entry.stepId || '').slice(0, 255),
      pageStep: String(entry.pageStep || '').slice(0, 180),
      fieldCount: Math.max(0, Math.min(300, Number(entry.fieldCount) || 0)),
      fields: normalizeFields(fields as ApplicationTemplateFieldSummary[]),
      actions: actions.filter((action) => action && typeof action === 'object').map((action) => {
        const candidate = action as Record<string, unknown>;
        return {
          label: String(candidate.label || 'unknown').slice(0, 180),
          classification: String(candidate.classification || 'UNKNOWN_OR_SIDE_EFFECT').slice(0, 64),
          reason: String(candidate.reason || 'Action was detected but not activated.').slice(0, 240),
          tag: String(candidate.tag || '').slice(0, 24),
          type: String(candidate.type || '').slice(0, 24),
        };
      }),
      firstSeenAt: typeof entry.firstSeenAt === 'string' ? entry.firstSeenAt.slice(0, 40) : null,
      lastSeenAt: typeof entry.lastSeenAt === 'string' ? entry.lastSeenAt.slice(0, 40) : null,
    };
  }).reverse().filter((step) => step.stepId);
  const rawTransitions = Array.isArray(checkpoint.transitions) ? checkpoint.transitions : [];
  const transitions = rawTransitions.slice(0, 100).filter((transition) => transition && typeof transition === 'object').map((transition) => {
    const entry = transition as Record<string, unknown>;
    return {
      from: String(entry.from || '').slice(0, 255),
      to: String(entry.to || '').slice(0, 255),
      action: 'unobserved_user_navigation',
      status: 'observed_unverified',
      observedAt: typeof entry.observedAt === 'string' ? entry.observedAt.slice(0, 40) : null,
    };
  }).filter((transition) => transition.from && transition.to);

  return {
    schemaVersion: 1,
    siteKey: String(checkpoint.siteKey || '').slice(0, 255),
    platform: String(checkpoint.platform || '').slice(0, 64),
    host: String(checkpoint.host || '').toLowerCase().slice(0, 255),
    status: 'partial',
    currentStepId: String(checkpoint.currentStepId || '').slice(0, 255),
    steps,
    transitions,
    finalBoundaryFound: checkpoint.finalBoundaryFound === true,
    updatedAt: typeof checkpoint.updatedAt === 'string' ? checkpoint.updatedAt.slice(0, 40) : null,
  };
}

function normalizeNavigation(navigation?: Record<string, unknown> | null): Record<string, unknown> {
  if (!navigation || typeof navigation !== 'object') return {};
  const result: Record<string, unknown> = {};
  const checkpoint = normalizeDiscoveryCheckpoint(navigation.discoveryCheckpoint);
  if (checkpoint) result.discoveryCheckpoint = checkpoint;
  if (Array.isArray(navigation.candidates)) {
    result.candidates = navigation.candidates.slice(0, 50).filter((action) => action && typeof action === 'object').map((action) => {
      const candidate = action as Record<string, unknown>;
      return {
        label: String(candidate.label || 'unknown').slice(0, 180),
        classification: String(candidate.classification || 'UNKNOWN_OR_SIDE_EFFECT').slice(0, 64),
        reason: String(candidate.reason || 'Action was detected but not activated.').slice(0, 240),
        tag: String(candidate.tag || '').slice(0, 24),
        type: String(candidate.type || '').slice(0, 24),
      };
    });
  }
  return result;
}

function normalizeVerification(verification?: Record<string, unknown> | null): Record<string, unknown> {
  if (!verification || typeof verification !== 'object') return {};
  const result: Record<string, unknown> = {};
  for (const key of ['requiresAuth', 'hasCaptcha', 'hasOtp', 'requiresConsent']) {
    if (typeof verification[key] === 'boolean') result[key] = verification[key];
  }
  return result;
}

function normalizeMetadata(metadata?: Record<string, unknown> | null): Record<string, unknown> {
  if (!metadata || typeof metadata !== 'object') return {};
  const result: Record<string, unknown> = {};
  if (Number.isFinite(Number(metadata.schemaVersion))) result.schemaVersion = Math.max(1, Number(metadata.schemaVersion));
  if (typeof metadata.source === 'string') result.source = metadata.source.slice(0, 64);
  if (typeof metadata.finalBoundaryFound === 'boolean') result.finalBoundaryFound = metadata.finalBoundaryFound;
  if (Number.isFinite(Number(metadata.testedPageCount))) result.testedPageCount = Math.max(0, Number(metadata.testedPageCount));
  return result;
}

function mapTemplateRow(row: ApplicationTemplateRow): ApplicationTemplateRecord {
  return {
    id: Number(row.template_id),
    siteKey: row.site_key,
    platform: row.platform,
    host: row.host,
    templateVersion: row.template_version,
    pageSignature: row.page_signature,
    status: row.status,
    coverage: normalizeCoverage(row.coverage),
    navigation: normalizeNavigation(row.navigation),
    verification: normalizeVerification(row.verification),
    metadata: normalizeMetadata(row.metadata),
    fields: normalizeFields(row.fields),
    validationReport: row.validation_report ?? {},
    promotedBy: row.promoted_by == null ? null : Number(row.promoted_by),
    promotedAt: row.promoted_at ? new Date(row.promoted_at).toISOString() : null,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

const TEMPLATE_PROJECTION = `
  template_id, site_key, platform, host, template_version, page_signature,
  status, coverage, navigation, verification, metadata, fields, validation_report,
  promoted_by, promoted_at, created_at, updated_at
`;

export async function listApplicationTemplates(): Promise<ApplicationTemplateRecord[]> {
  const rows = await queryAll<ApplicationTemplateRow>(
    `SELECT ${TEMPLATE_PROJECTION} FROM application_site_templates ORDER BY updated_at DESC`
  );
  return rows.map(mapTemplateRow);
}

export async function getApplicationTemplate(id: number): Promise<ApplicationTemplateRecord | null> {
  const row = await queryOne<ApplicationTemplateRow>(
    `SELECT ${TEMPLATE_PROJECTION} FROM application_site_templates WHERE template_id = $1`,
    [id]
  );
  return row ? mapTemplateRow(row) : null;
}

export async function deleteApplicationTemplate(id: number): Promise<boolean> {
  return withTransaction(async (client) => {
    const deleted = await client.query(
      `DELETE FROM application_site_templates
       WHERE template_id = $1
       RETURNING template_id`,
      [id]
    );
    if (!deleted.rows.length) return false;

    await client.query(
      `UPDATE application_field_semantics
       SET source_template_id = NULL, updated_at = NOW()
       WHERE source_template_id = $1`,
      [id]
    );
    return true;
  });
}

export async function getApplicationTemplateBySiteKey(siteKey: string): Promise<ApplicationTemplateRecord | null> {
  const row = await queryOne<ApplicationTemplateRow>(
    `SELECT ${TEMPLATE_PROJECTION}
     FROM application_site_templates
     WHERE site_key = $1
     ORDER BY updated_at DESC
     LIMIT 1`,
    [siteKey]
  );
  return row ? mapTemplateRow(row) : null;
}

export async function findReusableApplicationTemplateForSite(input: {
  siteKey?: string | null;
  platform?: string | null;
  host?: string | null;
} = {}): Promise<ApplicationTemplateRecord | null> {
  const host = String(input.host || '').trim().toLowerCase();
  const siteKey = String(input.siteKey || '').trim();
  const platform = String(input.platform || '').trim();
  const row = await queryOne<ApplicationTemplateRow>(
    `SELECT ${TEMPLATE_PROJECTION}
     FROM application_site_templates
     WHERE status IN ('active', 'partial')
       AND (
         ($1 <> '' AND site_key = $1)
         OR ($2 <> '' AND lower(host) = $2)
         OR ($3 <> '' AND platform = $3 AND COALESCE(host, '') = '')
       )
     ORDER BY
       CASE
         WHEN $1 <> '' AND site_key = $1 THEN 0
         WHEN $2 <> '' AND lower(host) = $2 THEN 1
         ELSE 2
       END,
       CASE status WHEN 'active' THEN 0 ELSE 1 END,
       COALESCE((coverage->>'matchedFields')::int, 0) DESC,
       updated_at DESC
     LIMIT 1`,
    [siteKey, host, platform]
  );
  return row ? mapTemplateRow(row) : null;
}

export async function upsertApplicationTemplate(input: ApplicationTemplateInput): Promise<ApplicationTemplateRecord> {
  const siteKey = normalizeSiteKey(input.siteKey, input.platform, input.host, input.pageSignature);
  const templateVersion = String(input.templateVersion || 'discovery-v1').slice(0, 64);
  const status = input.status === 'partial' || input.status === 'deprecated' ? input.status : 'draft';
  const normalizedCoverage = normalizeCoverage(input.coverage);
  const fields = normalizeFields(input.fields);
  const row = await queryOne<ApplicationTemplateRow>(
    `INSERT INTO application_site_templates (
       site_key, platform, host, template_version, page_signature, status,
       coverage, navigation, verification, metadata, fields
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb, $10::jsonb, $11::jsonb
     )
     ON CONFLICT (site_key, template_version) DO UPDATE SET
       platform = EXCLUDED.platform,
       host = EXCLUDED.host,
       page_signature = EXCLUDED.page_signature,
       status = CASE
         WHEN application_site_templates.status = 'deprecated' THEN 'deprecated'
         WHEN application_site_templates.status = 'active'
           AND (
             application_site_templates.page_signature IS DISTINCT FROM EXCLUDED.page_signature
             OR application_site_templates.fields IS DISTINCT FROM EXCLUDED.fields
             OR application_site_templates.navigation IS DISTINCT FROM EXCLUDED.navigation
           ) THEN 'partial'
         WHEN application_site_templates.status = 'active' THEN 'active'
         WHEN EXCLUDED.status = 'deprecated' THEN 'deprecated'
         ELSE EXCLUDED.status
       END,
       coverage = EXCLUDED.coverage,
       navigation = EXCLUDED.navigation,
       verification = EXCLUDED.verification,
       metadata = EXCLUDED.metadata,
       fields = EXCLUDED.fields,
       validation_report = CASE
         WHEN application_site_templates.status = 'active'
           AND application_site_templates.page_signature IS NOT DISTINCT FROM EXCLUDED.page_signature
           AND application_site_templates.fields IS NOT DISTINCT FROM EXCLUDED.fields
           AND application_site_templates.navigation IS NOT DISTINCT FROM EXCLUDED.navigation
           THEN application_site_templates.validation_report
         ELSE '{}'::jsonb
       END,
       promoted_by = CASE
         WHEN application_site_templates.status = 'active'
           AND application_site_templates.page_signature IS NOT DISTINCT FROM EXCLUDED.page_signature
           AND application_site_templates.fields IS NOT DISTINCT FROM EXCLUDED.fields
           AND application_site_templates.navigation IS NOT DISTINCT FROM EXCLUDED.navigation
           THEN application_site_templates.promoted_by
         ELSE NULL
       END,
       promoted_at = CASE
         WHEN application_site_templates.status = 'active'
           AND application_site_templates.page_signature IS NOT DISTINCT FROM EXCLUDED.page_signature
           AND application_site_templates.fields IS NOT DISTINCT FROM EXCLUDED.fields
           AND application_site_templates.navigation IS NOT DISTINCT FROM EXCLUDED.navigation
           THEN application_site_templates.promoted_at
         ELSE NULL
       END,
       updated_at = NOW()
     RETURNING ${TEMPLATE_PROJECTION}`,
    [
      siteKey,
      input.platform ?? null,
      input.host ? input.host.toLowerCase() : null,
      templateVersion,
      input.pageSignature ?? null,
      status,
      JSON.stringify(normalizedCoverage),
      JSON.stringify(normalizeNavigation(input.navigation)),
      JSON.stringify(normalizeVerification(input.verification)),
      JSON.stringify(normalizeMetadata(input.metadata)),
      JSON.stringify(fields),
    ]
  );
  if (!row) throw new Error('Template upsert did not return a persisted record.');
  return mapTemplateRow(row);
}

export async function validateAndPromoteApplicationTemplate(
  templateId: number,
  reviewerId: number,
  evidence: ApplicationTemplateValidationEvidence
): Promise<{ template: ApplicationTemplateRecord; report: Record<string, unknown> }> {
  const template = await getApplicationTemplate(templateId);
  if (!template) throw new Error('Application template not found.');

  const checkpoint = template.navigation.discoveryCheckpoint;
  const observedSteps = checkpoint && typeof checkpoint === 'object'
    && Array.isArray((checkpoint as Record<string, unknown>).steps)
    ? (checkpoint as { steps: Array<{ stepId?: string }> }).steps
    : [];
  const report = buildApplicationTemplateValidationReport({
    templateId,
    templateStatus: template.status,
    fields: template.fields,
    observedStepIds: observedSteps.map((step) => String(step.stepId || '')).filter(Boolean),
    evidence,
  });
  const passed = report.passed;

  const row = await queryOne<ApplicationTemplateRow>(
    `UPDATE application_site_templates
     SET status = CASE
           WHEN $2 THEN 'active'
           WHEN status = 'active' THEN 'partial'
           ELSE status
         END,
         validation_report = $3::jsonb,
         promoted_by = CASE WHEN $2 THEN $4 ELSE promoted_by END,
         promoted_at = CASE WHEN $2 THEN NOW() ELSE promoted_at END,
         updated_at = NOW()
     WHERE template_id = $1
     RETURNING ${TEMPLATE_PROJECTION}`,
    [templateId, passed, JSON.stringify(report), reviewerId]
  );
  if (!row) throw new Error('Template validation report could not be persisted.');
  return { template: mapTemplateRow(row), report };
}

export async function createApplicationTemplateDraftFromDiscovery(discovery: Record<string, unknown> = {}) {
  const fields = Array.isArray(discovery.fields) ? discovery.fields.map((field) => ({
    fieldId: String(field?.fieldId || field?.stableFieldId || 'unknown-field'),
    question: typeof field?.question === 'string' ? field.question : (typeof field?.label === 'string' ? field.label : null),
    fieldType: String(field?.fieldType || field?.type || 'unknown'),
    required: Boolean(field?.required),
    matchMethod: String(field?.matchMethod || 'unknown'),
    confidence: Number(field?.confidence ?? 0) || 0,
    status: field?.status === 'ambiguous' || field?.status === 'unresolved' ? field.status : 'matched',
    selectorHints: field?.selectorHints && typeof field?.selectorHints === 'object' ? field.selectorHints : undefined,
  })) : [];

  return upsertApplicationTemplate({
    siteKey: typeof discovery.siteKey === 'string' ? discovery.siteKey : undefined,
    platform: typeof discovery.platform === 'string' ? discovery.platform : null,
    host: typeof discovery.host === 'string' ? discovery.host : null,
    templateVersion: typeof discovery.templateVersion === 'string' ? discovery.templateVersion : 'discovery-v1',
    pageSignature: typeof discovery.pageSignature === 'string' ? discovery.pageSignature : null,
    status: typeof discovery.status === 'string' && ['draft', 'partial', 'deprecated'].includes(discovery.status)
      ? discovery.status as ApplicationTemplateStatus
      : 'draft',
    coverage: typeof discovery.coverage === 'object' && discovery.coverage ? discovery.coverage as Record<string, number> : undefined,
    navigation: discovery.navigation && typeof discovery.navigation === 'object' ? discovery.navigation as Record<string, unknown> : {},
    verification: discovery.verification && typeof discovery.verification === 'object' ? discovery.verification as Record<string, unknown> : {},
    metadata: discovery.metadata && typeof discovery.metadata === 'object' ? discovery.metadata as Record<string, unknown> : {},
    fields,
  });
}
