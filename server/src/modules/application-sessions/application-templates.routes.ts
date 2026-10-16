import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { AuthRequest, requireAuth, requireSuper } from '../../middleware/auth';
import { managerHasExtensionFeature } from '../new-schema/extension-feature-access';
import {
  createApplicationTemplateDraftFromDiscovery,
  deleteApplicationTemplate,
  findReusableApplicationTemplateForSite,
  getApplicationTemplate,
  getApplicationTemplateBySiteKey,
  listApplicationTemplates,
  validateAndPromoteApplicationTemplate,
  upsertApplicationTemplate,
} from '../../services/application-template-store';

const router = Router();
router.use(requireAuth);

function formatValidationMessage(issues: z.ZodIssue[]): string {
  const details = issues.slice(0, 3).map((issue) => (
    `${issue.path.join('.') || 'request'}: ${issue.message}`
  ));
  return details.length ? `Validation error: ${details.join('; ')}` : 'Validation error.';
}

const DomEvidenceNodeSchema = z.object({
  tag: z.string().max(40).optional(),
  role: z.string().max(80).optional(),
  classNames: z.array(z.string().max(80)).max(12).optional(),
  testId: z.string().max(200).optional(),
  automationId: z.string().max(200).optional(),
}).strict();

const LocatorEvidenceSchema = z.object({
  selectorHints: z.object({
    tag: z.string().max(40).optional(),
    id: z.string().max(200).optional(),
    name: z.string().max(200).optional(),
    role: z.string().max(80).optional(),
    testId: z.string().max(200).optional(),
    automationId: z.string().max(200).optional(),
  }).strict(),
  domEvidence: z.object({
    control: DomEvidenceNodeSchema,
    ancestors: z.array(DomEvidenceNodeSchema).max(8),
  }).strict(),
}).strict();

const ScannerInputValidationSchema = z.object({
  inputType: z.string().max(100),
  inputMode: z.string().max(40),
  numericOnly: z.boolean(),
  hint: z.string().max(1000).optional(),
  min: z.string().max(500).optional(),
  max: z.string().max(500).optional(),
  step: z.string().max(500).optional(),
  pattern: z.string().max(500).optional(),
  minLength: z.number().int().min(0).max(2147483647).optional(),
  maxLength: z.number().int().min(0).max(2147483647).optional(),
}).strict();

const ScannerFieldObservationSchema = z.object({
  label: z.string().max(1000),
  fieldType: z.string().max(64),
  required: z.boolean(),
  options: z.array(z.string().max(300)).max(100),
  validation: ScannerInputValidationSchema.optional(),
  section: z.string().max(200),
  selectorHints: z.object({
    tag: z.string().max(40).optional(),
    id: z.string().max(200).optional(),
    name: z.string().max(200).optional(),
    role: z.string().max(80).optional(),
    testId: z.string().max(200).optional(),
    automationId: z.string().max(200).optional(),
  }).strict(),
  domEvidence: z.object({
    control: DomEvidenceNodeSchema,
    ancestors: z.array(DomEvidenceNodeSchema).max(8),
  }).strict(),
}).strict();

const ScannerCaptureSchema = z.object({
  captureCount: z.number().int().min(1).max(2),
  captureVerified: z.boolean(),
  managerReviewed: z.boolean(),
  observations: z.array(LocatorEvidenceSchema.nullable()).max(2),
  fieldSnapshots: z.array(ScannerFieldObservationSchema.nullable()).max(2).optional(),
  issues: z.array(z.string().max(120)).max(10).optional(),
  classEvidenceChanged: z.boolean().optional(),
}).strict().superRefine((capture, context) => {
  if (capture.captureVerified
    && (capture.captureCount !== 2
      || capture.observations.length !== 2
      || capture.fieldSnapshots?.length !== 2)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Verified Scanner evidence must contain two captures.',
      path: ['captureVerified'],
    });
  }
});

const TemplateFieldSchema = z.object({
  fieldId: z.string().min(1).max(255),
  question: z.string().max(1000).nullable().optional(),
  fieldType: z.string().max(64).default('unknown'),
  required: z.boolean().optional().default(false),
  matchMethod: z.string().max(64).default('unknown'),
  confidence: z.number().min(0).max(1).default(0),
  status: z.enum(['matched', 'ambiguous', 'unresolved']).optional().default('matched'),
  selectorHints: z.record(z.unknown()).optional(),
  domEvidence: z.object({
    control: DomEvidenceNodeSchema,
    ancestors: z.array(DomEvidenceNodeSchema).max(8),
  }).strict().optional(),
  scannerCapture: ScannerCaptureSchema.optional(),
});

const TemplatePayloadSchema = z.object({
  siteKey: z.string().max(255).optional().nullable(),
  platform: z.string().max(64).optional().nullable(),
  host: z.string().max(255).optional().nullable(),
  templateVersion: z.string().max(64).optional().nullable(),
  pageSignature: z.string().max(255).optional().nullable(),
  status: z.enum(['draft', 'partial', 'deprecated']).optional(),
  coverage: z.record(z.coerce.number()).optional(),
  navigation: z.record(z.unknown()).optional(),
  verification: z.record(z.unknown()).optional(),
  metadata: z.record(z.unknown()).optional(),
  fields: z.array(TemplateFieldSchema).max(300).optional(),
});

const TemplateValidationSchema = z.object({
  observationSignatures: z.array(z.string().min(1).max(255)).min(2).max(10),
  validatedFieldIds: z.array(z.string().min(1).max(255)).max(300),
  authorizedTestEnvironmentConfirmed: z.boolean(),
  manualReviewConfirmed: z.boolean(),
  verificationReviewConfirmed: z.boolean(),
});

router.get('/', async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    res.json({
      success: true,
      templates: await listApplicationTemplates(),
    });
  } catch (error) {
    next(error);
  }
});

router.get('/reuse', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const siteKey = typeof req.query.siteKey === 'string' ? decodeURIComponent(req.query.siteKey) : undefined;
    const platform = typeof req.query.platform === 'string' ? req.query.platform : undefined;
    const host = typeof req.query.host === 'string' ? req.query.host : undefined;

    const template = await findReusableApplicationTemplateForSite({ siteKey, platform, host });
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
  } catch (error) {
    next(error);
  }
});

router.get('/by-site/:siteKey', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const siteKey = decodeURIComponent(req.params.siteKey ?? '');
    if (!siteKey) {
      res.status(400).json({ success: false, message: 'A siteKey is required.' });
      return;
    }

    const template = await getApplicationTemplateBySiteKey(siteKey);
    if (!template) {
      res.status(404).json({ success: false, message: 'Application template not found for siteKey.' });
      return;
    }

    res.json({ success: true, template });
  } catch (error) {
    next(error);
  }
});

router.post('/:id/validate', requireSuper, async (req: AuthRequest, res: Response, next: NextFunction) => {
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

    const existing = await getApplicationTemplate(id);
    if (!existing) {
      res.status(404).json({ success: false, message: 'Application template not found.' });
      return;
    }
    const result = await validateAndPromoteApplicationTemplate(id, req.userId, parsed.data);
    res.status(result.report.passed ? 200 : 422).json({
      success: result.report.passed,
      template: result.template,
      validationReport: result.report,
      message: result.report.passed
        ? 'Validation passed; template promoted to active.'
        : 'Validation evidence did not meet the promotion criteria. Template remains inactive.',
    });
  } catch (error) {
    next(error);
  }
});

router.delete('/:id', requireSuper, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) {
      res.status(400).json({ success: false, message: 'Invalid template id.' });
      return;
    }

    const deleted = await deleteApplicationTemplate(id);
    if (!deleted) {
      res.status(404).json({ success: false, message: 'Application template not found.' });
      return;
    }

    res.json({
      success: true,
      message: 'Application template and its Manager-specific field rules were deleted. Shared field semantics were retained.',
    });
  } catch (error) {
    next(error);
  }
});

router.get('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ success: false, message: 'Invalid template id.' });
      return;
    }

    const template = await getApplicationTemplate(id);
    if (!template) {
      res.status(404).json({ success: false, message: 'Application template not found.' });
      return;
    }

    res.json({ success: true, template });
  } catch (error) {
    next(error);
  }
});

router.post('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = TemplatePayloadSchema.safeParse(req.body);
    if (!parsed.success) {
      const errors = parsed.error.errors.map((error) => ({ field: error.path.join('.'), message: error.message }));
      res.status(400).json({
        success: false,
        message: formatValidationMessage(parsed.error.errors),
        errors,
      });
      return;
    }

    const template = await upsertApplicationTemplate(parsed.data);
    res.status(201).json({ success: true, template });
  } catch (error) {
    next(error);
  }
});

router.post('/from-discovery', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (req.role === 'manager' &&
        (!Number.isSafeInteger(req.userId) || !req.userId ||
         !(await managerHasExtensionFeature(req.userId, 'job_site_scanner')))) {
      res.status(403).json({
        success: false,
        code: 'EXTENSION_FEATURE_NOT_ASSIGNED',
        message: 'Your Super administrator has not assigned Scanner access to your Manager account.',
      });
      return;
    }
    const parsed = TemplatePayloadSchema.safeParse(req.body);
    if (!parsed.success) {
      const errors = parsed.error.errors.map((error) => ({ field: error.path.join('.'), message: error.message }));
      res.status(400).json({
        success: false,
        message: formatValidationMessage(parsed.error.errors),
        errors,
      });
      return;
    }

    const template = await createApplicationTemplateDraftFromDiscovery(parsed.data as Record<string, unknown>);
    res.status(201).json({ success: true, template });
  } catch (error) {
    next(error);
  }
});

export default router;
