"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const auth_1 = require("../../middleware/auth");
const application_template_store_1 = require("../../services/application-template-store");
const router = (0, express_1.Router)();
router.use(auth_1.requireAuth);
const DomEvidenceNodeSchema = zod_1.z.object({
    tag: zod_1.z.string().max(40).optional(),
    role: zod_1.z.string().max(80).optional(),
    classNames: zod_1.z.array(zod_1.z.string().max(80)).max(12).optional(),
    testId: zod_1.z.string().max(200).optional(),
    automationId: zod_1.z.string().max(200).optional(),
}).strict();
const LocatorEvidenceSchema = zod_1.z.object({
    selectorHints: zod_1.z.object({
        tag: zod_1.z.string().max(40).optional(),
        id: zod_1.z.string().max(200).optional(),
        name: zod_1.z.string().max(200).optional(),
        role: zod_1.z.string().max(80).optional(),
        testId: zod_1.z.string().max(200).optional(),
        automationId: zod_1.z.string().max(200).optional(),
    }).strict(),
    domEvidence: zod_1.z.object({
        control: DomEvidenceNodeSchema,
        ancestors: zod_1.z.array(DomEvidenceNodeSchema).max(8),
    }).strict(),
}).strict();
const ScannerFieldObservationSchema = zod_1.z.object({
    label: zod_1.z.string().max(1000),
    fieldType: zod_1.z.string().max(64),
    required: zod_1.z.boolean(),
    options: zod_1.z.array(zod_1.z.string().max(300)).max(100),
    section: zod_1.z.string().max(200),
    selectorHints: zod_1.z.object({
        tag: zod_1.z.string().max(40).optional(),
        id: zod_1.z.string().max(200).optional(),
        name: zod_1.z.string().max(200).optional(),
        role: zod_1.z.string().max(80).optional(),
        testId: zod_1.z.string().max(200).optional(),
        automationId: zod_1.z.string().max(200).optional(),
    }).strict(),
    domEvidence: zod_1.z.object({
        control: DomEvidenceNodeSchema,
        ancestors: zod_1.z.array(DomEvidenceNodeSchema).max(8),
    }).strict(),
}).strict();
const ScannerCaptureSchema = zod_1.z.object({
    captureCount: zod_1.z.number().int().min(1).max(2),
    captureVerified: zod_1.z.boolean(),
    managerReviewed: zod_1.z.boolean(),
    observations: zod_1.z.array(LocatorEvidenceSchema.nullable()).max(2),
    fieldSnapshots: zod_1.z.array(ScannerFieldObservationSchema.nullable()).max(2).optional(),
    issues: zod_1.z.array(zod_1.z.string().max(120)).max(10).optional(),
    classEvidenceChanged: zod_1.z.boolean().optional(),
}).strict().superRefine((capture, context) => {
    if (capture.captureVerified
        && (capture.captureCount !== 2
            || capture.observations.length !== 2
            || capture.fieldSnapshots?.length !== 2)) {
        context.addIssue({
            code: zod_1.z.ZodIssueCode.custom,
            message: 'Verified Scanner evidence must contain two captures.',
            path: ['captureVerified'],
        });
    }
});
const TemplateFieldSchema = zod_1.z.object({
    fieldId: zod_1.z.string().min(1).max(255),
    question: zod_1.z.string().max(1000).nullable().optional(),
    fieldType: zod_1.z.string().max(64).default('unknown'),
    required: zod_1.z.boolean().optional().default(false),
    matchMethod: zod_1.z.string().max(64).default('unknown'),
    confidence: zod_1.z.number().min(0).max(1).default(0),
    status: zod_1.z.enum(['matched', 'ambiguous', 'unresolved']).optional().default('matched'),
    selectorHints: zod_1.z.record(zod_1.z.unknown()).optional(),
    domEvidence: zod_1.z.object({
        control: DomEvidenceNodeSchema,
        ancestors: zod_1.z.array(DomEvidenceNodeSchema).max(8),
    }).strict().optional(),
    scannerCapture: ScannerCaptureSchema.optional(),
});
const TemplatePayloadSchema = zod_1.z.object({
    siteKey: zod_1.z.string().max(255).optional().nullable(),
    platform: zod_1.z.string().max(64).optional().nullable(),
    host: zod_1.z.string().max(255).optional().nullable(),
    templateVersion: zod_1.z.string().max(64).optional().nullable(),
    pageSignature: zod_1.z.string().max(255).optional().nullable(),
    status: zod_1.z.enum(['draft', 'partial', 'deprecated']).optional(),
    coverage: zod_1.z.record(zod_1.z.coerce.number()).optional(),
    navigation: zod_1.z.record(zod_1.z.unknown()).optional(),
    verification: zod_1.z.record(zod_1.z.unknown()).optional(),
    metadata: zod_1.z.record(zod_1.z.unknown()).optional(),
    fields: zod_1.z.array(TemplateFieldSchema).max(300).optional(),
});
const TemplateValidationSchema = zod_1.z.object({
    observationSignatures: zod_1.z.array(zod_1.z.string().min(1).max(255)).min(2).max(10),
    validatedFieldIds: zod_1.z.array(zod_1.z.string().min(1).max(255)).max(300),
    authorizedTestEnvironmentConfirmed: zod_1.z.boolean(),
    manualReviewConfirmed: zod_1.z.boolean(),
    verificationReviewConfirmed: zod_1.z.boolean(),
});
router.get('/', async (_req, res, next) => {
    try {
        res.json({
            success: true,
            templates: await (0, application_template_store_1.listApplicationTemplates)(),
        });
    }
    catch (error) {
        next(error);
    }
});
router.get('/reuse', async (req, res, next) => {
    try {
        const siteKey = typeof req.query.siteKey === 'string' ? decodeURIComponent(req.query.siteKey) : undefined;
        const platform = typeof req.query.platform === 'string' ? req.query.platform : undefined;
        const host = typeof req.query.host === 'string' ? req.query.host : undefined;
        const template = await (0, application_template_store_1.findReusableApplicationTemplateForSite)({ siteKey, platform, host });
        if (!template) {
            res.status(404).json({
                success: false,
                message: 'No reusable application template was found for this site.',
                safeToReuse: false,
            });
            return;
        }
        res.json({
            success: true,
            template,
            safeToReuse: template.status === 'active' || template.status === 'partial',
        });
    }
    catch (error) {
        next(error);
    }
});
router.get('/by-site/:siteKey', async (req, res, next) => {
    try {
        const siteKey = decodeURIComponent(req.params.siteKey ?? '');
        if (!siteKey) {
            res.status(400).json({ success: false, message: 'A siteKey is required.' });
            return;
        }
        const template = await (0, application_template_store_1.getApplicationTemplateBySiteKey)(siteKey);
        if (!template) {
            res.status(404).json({ success: false, message: 'Application template not found for siteKey.' });
            return;
        }
        res.json({ success: true, template });
    }
    catch (error) {
        next(error);
    }
});
router.post('/:id/validate', auth_1.requireSuper, async (req, res, next) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isSafeInteger(id) || id <= 0) {
            res.status(400).json({ success: false, message: 'Invalid template id.' });
            return;
        }
        const parsed = TemplateValidationSchema.safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json({
                success: false,
                message: 'Validation evidence is invalid.',
                errors: parsed.error.errors.map((error) => ({ field: error.path.join('.'), message: error.message })),
            });
            return;
        }
        if (!req.userId) {
            res.status(401).json({ success: false, message: 'Authenticated reviewer identity is required.' });
            return;
        }
        const existing = await (0, application_template_store_1.getApplicationTemplate)(id);
        if (!existing) {
            res.status(404).json({ success: false, message: 'Application template not found.' });
            return;
        }
        const result = await (0, application_template_store_1.validateAndPromoteApplicationTemplate)(id, req.userId, parsed.data);
        res.status(result.report.passed ? 200 : 422).json({
            success: result.report.passed,
            template: result.template,
            validationReport: result.report,
            message: result.report.passed
                ? 'Validation passed; template promoted to active.'
                : 'Validation evidence did not meet the promotion criteria. Template remains inactive.',
        });
    }
    catch (error) {
        next(error);
    }
});
router.get('/:id', async (req, res, next) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isFinite(id)) {
            res.status(400).json({ success: false, message: 'Invalid template id.' });
            return;
        }
        const template = await (0, application_template_store_1.getApplicationTemplate)(id);
        if (!template) {
            res.status(404).json({ success: false, message: 'Application template not found.' });
            return;
        }
        res.json({ success: true, template });
    }
    catch (error) {
        next(error);
    }
});
router.post('/', async (req, res, next) => {
    try {
        const parsed = TemplatePayloadSchema.safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json({
                success: false,
                message: 'Validation error.',
                errors: parsed.error.errors.map((error) => ({ field: error.path.join('.'), message: error.message })),
            });
            return;
        }
        const template = await (0, application_template_store_1.upsertApplicationTemplate)(parsed.data);
        res.status(201).json({ success: true, template });
    }
    catch (error) {
        next(error);
    }
});
router.post('/from-discovery', async (req, res, next) => {
    try {
        const parsed = TemplatePayloadSchema.safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json({
                success: false,
                message: 'Validation error.',
                errors: parsed.error.errors.map((error) => ({ field: error.path.join('.'), message: error.message })),
            });
            return;
        }
        const template = await (0, application_template_store_1.createApplicationTemplateDraftFromDiscovery)(parsed.data);
        res.status(201).json({ success: true, template });
    }
    catch (error) {
        next(error);
    }
});
exports.default = router;
//# sourceMappingURL=application-templates.routes.js.map