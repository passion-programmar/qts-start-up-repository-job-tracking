import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApplicationTemplateValidationReport } from './application-template-validation';

const validEvidence = {
  observationSignatures: ['step-one', 'step-two'],
  validatedFieldIds: ['full-name'],
  authorizedTestEnvironmentConfirmed: true,
  manualReviewConfirmed: true,
  verificationReviewConfirmed: true,
};

test('template promotion requires distinct observed steps and reviewed stable fields', () => {
  const report = buildApplicationTemplateValidationReport({
    templateId: 1,
    templateStatus: 'partial',
    observedStepIds: ['step-one', 'step-two'],
    evidence: validEvidence,
    fields: [{
      fieldId: 'full-name',
      status: 'matched',
      confidence: 0.9,
      selectorHints: { name: 'fullName' },
    }],
  });

  assert.equal(report.passed, true);
  assert.equal(report.validatedFieldCount, 1);
});

test('template promotion fails if evidence is not observed or fields are unresolved', () => {
  const report = buildApplicationTemplateValidationReport({
    templateId: 2,
    templateStatus: 'partial',
    observedStepIds: ['step-one'],
    evidence: {
      ...validEvidence,
      observationSignatures: ['step-one', 'unseen-step'],
    },
    fields: [{
      fieldId: 'eligibility',
      status: 'unresolved',
      confidence: 0.99,
    }],
  });

  assert.equal(report.passed, false);
  assert.deepEqual(report.unobservedSignatures, ['unseen-step']);
  assert.deepEqual(report.unresolvedFieldIds, ['eligibility']);
});

test('deprecated templates cannot be promoted even with complete evidence', () => {
  const report = buildApplicationTemplateValidationReport({
    templateId: 3,
    templateStatus: 'deprecated',
    observedStepIds: ['step-one', 'step-two'],
    evidence: validEvidence,
    fields: [{
      fieldId: 'full-name',
      status: 'matched',
      confidence: 0.9,
      selectorHints: { id: 'fullName' },
    }],
  });

  assert.equal(report.passed, false);
});

test('all reviewer confirmations are required', () => {
  const report = buildApplicationTemplateValidationReport({
    templateId: 4,
    templateStatus: 'partial',
    observedStepIds: ['step-one', 'step-two'],
    evidence: {
      ...validEvidence,
      authorizedTestEnvironmentConfirmed: false,
    },
    fields: [{
      fieldId: 'full-name',
      status: 'matched',
      confidence: 0.9,
      selectorHints: { name: 'fullName' },
    }],
  });

  assert.equal(report.passed, false);
});

test('repeated observations of one step do not satisfy multi-step validation', () => {
  const report = buildApplicationTemplateValidationReport({
    templateId: 5,
    templateStatus: 'partial',
    observedStepIds: ['step-one'],
    evidence: {
      ...validEvidence,
      observationSignatures: ['step-one', 'step-one'],
    },
    fields: [{
      fieldId: 'full-name',
      status: 'matched',
      confidence: 0.9,
      selectorHints: { name: 'fullName' },
    }],
  });

  assert.equal(report.passed, false);
});
