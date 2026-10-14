'use client';

import { LoadingState } from '@/components/LoadingState';
import { useAuth } from '@/components/AuthProvider';
import { api } from '@/lib/api';
import { useCallback, useEffect, useMemo, useState } from 'react';

type TemplateField = {
  fieldId: string;
  question?: string | null;
  fieldType: string;
  required: boolean;
  matchMethod: string;
  confidence: number;
  status: 'matched' | 'ambiguous' | 'unresolved';
  selectorHints?: Record<string, unknown>;
};

type TemplateStep = {
  stepId: string;
  pageStep: string;
  fieldCount: number;
  firstSeenAt?: string | null;
  lastSeenAt?: string | null;
};

type ValidationReport = {
  passed?: boolean;
  evaluatedAt?: string;
  observationCount?: number;
  uniquePageSignatures?: number;
  validatedFieldCount?: number;
  fieldCount?: number;
  unresolvedFieldIds?: string[];
  unobservedSignatures?: string[];
  authorizedTestEnvironmentConfirmed?: boolean;
  manualReviewConfirmed?: boolean;
  verificationReviewConfirmed?: boolean;
  criteria?: string[];
};

type ApplicationTemplate = {
  id: number;
  siteKey: string;
  platform: string | null;
  host: string | null;
  templateVersion: string | null;
  pageSignature: string | null;
  status: 'draft' | 'partial' | 'active' | 'deprecated';
  fields: TemplateField[];
  navigation: Record<string, unknown>;
  validationReport: ValidationReport;
  promotedBy: number | null;
  promotedAt: string | null;
  updatedAt: string;
};

type TemplateListResponse = {
  success: boolean;
  message?: string;
  templates?: ApplicationTemplate[];
};

type TemplateValidationResponse = {
  success: boolean;
  message?: string;
  template?: ApplicationTemplate;
  validationReport?: ValidationReport;
};

type DiscoveryCheckpoint = {
  steps?: TemplateStep[];
};

function getSteps(template: ApplicationTemplate): TemplateStep[] {
  const checkpoint = template.navigation.discoveryCheckpoint as DiscoveryCheckpoint | undefined;
  return Array.isArray(checkpoint?.steps) ? checkpoint.steps : [];
}

function formatSelectorHints(hints?: Record<string, unknown>): string {
  if (!hints) return 'No stable selector hint';
  const entries = Object.entries(hints)
    .filter(([, value]) => typeof value === 'string' || typeof value === 'number')
    .map(([key, value]) => `${key}: ${String(value)}`);
  return entries.length ? entries.join(' · ') : 'No stable selector hint';
}

export function ApplicationTemplateReviewView() {
  const { user } = useAuth();
  const [templates, setTemplates] = useState<ApplicationTemplate[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selectedSignatures, setSelectedSignatures] = useState<string[]>([]);
  const [validatedFieldIds, setValidatedFieldIds] = useState<string[]>([]);
  const [authorizedTestEnvironmentConfirmed, setAuthorizedTestEnvironmentConfirmed] = useState(false);
  const [manualReviewConfirmed, setManualReviewConfirmed] = useState(false);
  const [verificationReviewConfirmed, setVerificationReviewConfirmed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const loadTemplates = useCallback(async () => {
    setLoading(true);
    const result = await api<TemplateListResponse>('GET', '/api/application-templates');
    if (!result.success) {
      setError(result.message || 'Could not load application templates.');
      setLoading(false);
      return;
    }
    const loaded = result.templates || [];
    setTemplates(loaded);
    setSelectedId((current) => current && loaded.some((template) => template.id === current)
      ? current
      : loaded[0]?.id ?? null);
    setError(null);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (user?.role !== 'super') return;
    // Load saved template records for Super reviewers.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadTemplates();
  }, [loadTemplates, user?.role]);

  const selectedTemplate = useMemo(
    () => templates.find((template) => template.id === selectedId) ?? null,
    [selectedId, templates]
  );
  const steps = useMemo(
    () => selectedTemplate ? getSteps(selectedTemplate) : [],
    [selectedTemplate]
  );
  const fields = selectedTemplate?.fields ?? [];
  const reviewComplete = authorizedTestEnvironmentConfirmed
    && manualReviewConfirmed
    && verificationReviewConfirmed;
  const canSubmit = !!selectedTemplate
    && selectedTemplate.status !== 'deprecated'
    && selectedSignatures.length >= 2
    && reviewComplete
    && !submitting;

  function selectTemplate(id: number) {
    setSelectedId(id);
    setSelectedSignatures([]);
    setValidatedFieldIds([]);
    setAuthorizedTestEnvironmentConfirmed(false);
    setManualReviewConfirmed(false);
    setVerificationReviewConfirmed(false);
    setError(null);
    setMessage(null);
  }

  function toggleValue(value: string, values: string[], update: (next: string[]) => void) {
    update(values.includes(value) ? values.filter((entry) => entry !== value) : [...values, value]);
  }

  async function submitValidation(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedTemplate || !canSubmit) return;
    setSubmitting(true);
    setError(null);
    setMessage(null);

    const result = await api<TemplateValidationResponse>(
      'POST',
      `/api/application-templates/${selectedTemplate.id}/validate`,
      {
        observationSignatures: selectedSignatures,
        validatedFieldIds,
        authorizedTestEnvironmentConfirmed,
        manualReviewConfirmed,
        verificationReviewConfirmed,
      }
    );

    if (result.template) {
      setTemplates((current) => current.map((template) =>
        template.id === result.template?.id ? result.template : template
      ));
    }
    if (!result.success) {
      setError(result.message || 'Validation failed. Review the persisted report below.');
    } else {
      setMessage(result.message || 'Template validation passed and the template is active.');
      setValidatedFieldIds(fields.map((field) => field.fieldId));
    }
    setSubmitting(false);
  }

  async function deleteTemplate(template: ApplicationTemplate) {
    const confirmed = window.confirm(
      `Delete "${template.siteKey}" (${template.host || template.platform || 'unknown site'})?\n\nThis permanently removes the saved template and its Manager-specific field rules. This cannot be undone.`
    );
    if (!confirmed) return;

    setDeletingId(template.id);
    setError(null);
    setMessage(null);
    const result = await api<TemplateListResponse>(
      'DELETE',
      `/api/application-templates/${template.id}`
    );
    if (!result.success) {
      setError(result.message || 'Could not delete the application template.');
      setDeletingId(null);
      return;
    }

    const remaining = templates.filter((item) => item.id !== template.id);
    setTemplates(remaining);
    setSelectedId((current) => current === template.id ? remaining[0]?.id ?? null : current);
    setSelectedSignatures([]);
    setValidatedFieldIds([]);
    setAuthorizedTestEnvironmentConfirmed(false);
    setManualReviewConfirmed(false);
    setVerificationReviewConfirmed(false);
    setMessage(result.message || `Deleted template "${template.siteKey}".`);
    setDeletingId(null);
  }

  if (user?.role !== 'super') {
    return <div className="alert alert-error">Super access is required to review application templates.</div>;
  }

  return (
    <div className="template-review">
      <section className="card template-review__intro">
        <span className="template-review__eyebrow">SUPER REVIEW WORKFLOW</span>
        <h2>Application template review</h2>
        <p>Inspect stored discovery evidence and record validation before promoting a template.</p>
        <div className="alert alert-warn" role="note">
          This page does not scan or verify a live ATS page. The API checks the signatures and
          field confirmations you submit against the saved discovery checkpoint only. Confirm
          observations from an authorized test environment; do not use this workflow to test
          or automate a genuine application.
        </div>
      </section>

      {error && <div className="alert alert-error" role="alert">{error}</div>}
      {message && <div className="alert alert-success" role="status">{message}</div>}

      <div className="template-review__layout">
        <section className="card template-review__list">
          <div className="template-review__section-heading">
            <h3>Saved templates</h3>
            <button className="btn btn-ghost btn-sm" type="button" disabled={loading} onClick={() => { void loadTemplates(); }}>
              Refresh
            </button>
          </div>
          {loading ? <LoadingState label="Loading templates…" size="inline" /> : (
            <div className="template-review__template-list">
              {templates.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  className={`template-review__template${template.id === selectedId ? ' is-selected' : ''}`}
                  aria-pressed={template.id === selectedId}
                  onClick={() => selectTemplate(template.id)}
                >
                  <span className="template-review__template-title">{template.siteKey}</span>
                  <span className={`template-review__status template-review__status--${template.status}`}>
                    {template.status}
                  </span>
                  <span className="template-review__template-meta">
                    {template.host || template.platform || 'Unknown site'} · {template.fields.length} fields
                  </span>
                </button>
              ))}
              {!templates.length && <p className="text-muted">No saved application templates.</p>}
            </div>
          )}
        </section>

        <section className="card template-review__detail">
          {!selectedTemplate ? (
            <p className="text-muted">Select a saved template to inspect its checkpoint and report.</p>
          ) : (
            <>
              <div className="template-review__section-heading">
                <div>
                  <h3>{selectedTemplate.siteKey}</h3>
                  <p className="text-muted">
                    {selectedTemplate.host || 'No host'} · {selectedTemplate.templateVersion || 'No version'} · Updated {new Date(selectedTemplate.updatedAt).toLocaleString()}
                  </p>
                </div>
                <span className={`template-review__status template-review__status--${selectedTemplate.status}`}>
                  {selectedTemplate.status}
                </span>
                <button
                  className="btn btn-danger btn-sm"
                  type="button"
                  disabled={loading || deletingId !== null || submitting}
                  onClick={() => { void deleteTemplate(selectedTemplate); }}
                >
                  {deletingId === selectedTemplate.id ? 'Deleting…' : 'Delete template'}
                </button>
              </div>

              <div className="alert alert-info" role="note">
                Step and field checkboxes record reviewer attestations. They do not prove that a
                live page was independently scanned or that an ATS workflow was tested.
              </div>

              {selectedTemplate.status === 'deprecated' && (
                <div className="alert alert-warn">Deprecated templates cannot be promoted.</div>
              )}
              {!steps.length && (
                <div className="alert alert-warn">This template has no saved discovery steps and cannot pass promotion criteria.</div>
              )}
              {!fields.length && (
                <div className="alert alert-warn">This template has no stored fields and cannot pass promotion criteria.</div>
              )}

              <form onSubmit={(event) => { void submitValidation(event); }}>
                <fieldset className="template-review__fieldset">
                  <legend>Observed discovery steps (select at least two)</legend>
                  {steps.map((step) => (
                    <label className="template-review__choice" key={step.stepId}>
                      <input
                        type="checkbox"
                        checked={selectedSignatures.includes(step.stepId)}
                        onChange={() => toggleValue(step.stepId, selectedSignatures, setSelectedSignatures)}
                      />
                      <span>
                        <strong>{step.pageStep || step.stepId}</strong>
                        <small>{step.stepId} · {step.fieldCount} fields</small>
                      </span>
                    </label>
                  ))}
                  {!steps.length && <p className="text-muted">No stored steps.</p>}
                </fieldset>

                <fieldset className="template-review__fieldset">
                  <legend>Field mappings (select each field you manually reviewed)</legend>
                  {fields.map((field) => (
                    <label className="template-review__choice" key={field.fieldId}>
                      <input
                        type="checkbox"
                        checked={validatedFieldIds.includes(field.fieldId)}
                        onChange={() => toggleValue(field.fieldId, validatedFieldIds, setValidatedFieldIds)}
                      />
                      <span>
                        <strong>{field.question || field.fieldId}</strong>
                        <small>
                          {field.fieldId} · {field.status} · confidence {field.confidence.toFixed(2)}
                          {' · '}{formatSelectorHints(field.selectorHints)}
                        </small>
                      </span>
                    </label>
                  ))}
                  {!fields.length && <p className="text-muted">No stored fields.</p>}
                </fieldset>

                <fieldset className="template-review__fieldset">
                  <legend>Reviewer confirmations</legend>
                  <label className="template-review__choice">
                    <input
                      type="checkbox"
                      checked={authorizedTestEnvironmentConfirmed}
                      onChange={(event) => setAuthorizedTestEnvironmentConfirmed(event.target.checked)}
                    />
                    <span>I confirm this validation is limited to an authorized test environment.</span>
                  </label>
                  <label className="template-review__choice">
                    <input
                      type="checkbox"
                      checked={manualReviewConfirmed}
                      onChange={(event) => setManualReviewConfirmed(event.target.checked)}
                    />
                    <span>I manually reviewed the selected steps and stored field mappings.</span>
                  </label>
                  <label className="template-review__choice">
                    <input
                      type="checkbox"
                      checked={verificationReviewConfirmed}
                      onChange={(event) => setVerificationReviewConfirmed(event.target.checked)}
                    />
                    <span>I reviewed verification, consent, and security boundaries for this template.</span>
                  </label>
                </fieldset>

                <div className="template-review__actions">
                  <button className="btn btn-primary" type="submit" disabled={!canSubmit}>
                    {submitting ? 'Submitting…' : 'Record validation'}
                  </button>
                  <span className="text-muted">
                    Promotion requires two saved steps, every field reviewed, stable high-confidence selectors, and all confirmations.
                  </span>
                </div>
              </form>

              <section className="template-review__report" aria-labelledby="template-review-report-heading">
                <h4 id="template-review-report-heading">Latest persisted validation report</h4>
                {selectedTemplate.validationReport && Object.keys(selectedTemplate.validationReport).length ? (
                  <>
                    <div className={`alert ${selectedTemplate.validationReport.passed ? 'alert-success' : 'alert-warn'}`}>
                      {selectedTemplate.validationReport.passed ? 'Passed' : 'Not passed'}
                      {selectedTemplate.validationReport.evaluatedAt
                        ? ` · ${new Date(selectedTemplate.validationReport.evaluatedAt).toLocaleString()}`
                        : ''}
                      {' · '}Fields validated: {selectedTemplate.validationReport.validatedFieldCount ?? 0}/{selectedTemplate.validationReport.fieldCount ?? fields.length}
                    </div>
                    {selectedTemplate.validationReport.unobservedSignatures?.length ? (
                      <p className="text-muted">Unobserved signatures: {selectedTemplate.validationReport.unobservedSignatures.join(', ')}</p>
                    ) : null}
                    {selectedTemplate.validationReport.unresolvedFieldIds?.length ? (
                      <p className="text-muted">Fields not meeting criteria: {selectedTemplate.validationReport.unresolvedFieldIds.join(', ')}</p>
                    ) : null}
                    <ul className="template-review__criteria">
                      {selectedTemplate.validationReport.criteria?.map((criterion) => <li key={criterion}>{criterion}</li>)}
                    </ul>
                  </>
                ) : (
                  <p className="text-muted">No validation report has been recorded.</p>
                )}
              </section>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
