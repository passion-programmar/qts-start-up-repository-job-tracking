"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const application_template_validation_1 = require("./application-template-validation");
const validEvidence = {
    observationSignatures: ['step-one', 'step-two'],
    validatedFieldIds: ['full-name'],
    authorizedTestEnvironmentConfirmed: true,
    manualReviewConfirmed: true,
    verificationReviewConfirmed: true,
};
(0, node_test_1.default)('template promotion requires distinct observed steps and reviewed stable fields', () => {
    const report = (0, application_template_validation_1.buildApplicationTemplateValidationReport)({
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
    strict_1.default.equal(report.passed, true);
    strict_1.default.equal(report.validatedFieldCount, 1);
});
(0, node_test_1.default)('template promotion fails if evidence is not observed or fields are unresolved', () => {
    const report = (0, application_template_validation_1.buildApplicationTemplateValidationReport)({
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
    strict_1.default.equal(report.passed, false);
    strict_1.default.deepEqual(report.unobservedSignatures, ['unseen-step']);
    strict_1.default.deepEqual(report.unresolvedFieldIds, ['eligibility']);
});
(0, node_test_1.default)('deprecated templates cannot be promoted even with complete evidence', () => {
    const report = (0, application_template_validation_1.buildApplicationTemplateValidationReport)({
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
    strict_1.default.equal(report.passed, false);
});
(0, node_test_1.default)('all reviewer confirmations are required', () => {
    const report = (0, application_template_validation_1.buildApplicationTemplateValidationReport)({
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
    strict_1.default.equal(report.passed, false);
});
(0, node_test_1.default)('repeated observations of one step do not satisfy multi-step validation', () => {
    const report = (0, application_template_validation_1.buildApplicationTemplateValidationReport)({
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
    strict_1.default.equal(report.passed, false);
});
//# sourceMappingURL=application-template-validation.test.js.map