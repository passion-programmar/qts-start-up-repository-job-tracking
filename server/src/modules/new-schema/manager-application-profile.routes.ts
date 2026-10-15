import { Router, Response } from 'express';
import { z } from 'zod';
import { queryAll, queryOne, withTransaction } from '../../database/connection';
import { NewSchemaAuthRequest, requireNewSchemaAuth } from '../../middleware/new-schema-auth';
import { requireManagerExtensionFeature } from './extension-feature-access';

const router = Router();
router.use(requireNewSchemaAuth);

const profileSchema = z.object({
  managedCountry: z.string().trim().max(100).nullable(),
  authorizedToWork: z.boolean().nullable(),
  authorizationStatus: z.string().trim().max(500).nullable(),
  sponsorshipRequired: z.boolean().nullable(),
  relocationWilling: z.boolean().nullable(),
  noticePeriodValue: z.number().int().min(0).max(10000).nullable(),
  noticePeriodUnit: z.enum(['days', 'weeks', 'months']).nullable(),
  noticePeriodText: z.string().trim().max(1000).nullable(),
  salaryAnswers: z.array(z.object({
    currency: z.string().trim().regex(/^[A-Za-z]{3}$/).transform((value) => value.toUpperCase()),
    minimumAmount: z.number().min(0).max(999999999999).nullable(),
    maximumAmount: z.number().min(0).max(999999999999).nullable(),
    payPeriod: z.enum(['hour', 'day', 'week', 'month', 'year']),
    answerText: z.string().trim().max(1000).nullable(),
  }).refine((entry) =>
    entry.minimumAmount === null || entry.maximumAmount === null ||
    entry.maximumAmount >= entry.minimumAmount,
  { message: 'Salary maximum must be greater than or equal to the minimum.' })
    .refine((entry) => entry.minimumAmount !== null || entry.maximumAmount !== null || Boolean(entry.answerText), {
      message: 'Each salary answer needs an amount or reusable text.',
    })).max(50),
  customAnswers: z.array(z.object({
    topic: z.string().trim().min(1).max(100),
    question: z.string().trim().min(1).max(1000),
    answer: z.string().trim().min(1).max(4000),
  })).max(100),
});

const scannerDomNodeSchema = z.object({
  tag: z.string().max(40).optional(),
  role: z.string().max(80).optional(),
  classNames: z.array(z.string().max(80)).max(12).optional(),
  testId: z.string().max(200).optional(),
  automationId: z.string().max(200).optional(),
}).strict();

const scannerLocatorEvidenceSchema = z.object({
  selectorHints: z.object({
    tag: z.string().max(40).optional(),
    id: z.string().max(200).optional(),
    name: z.string().max(200).optional(),
    role: z.string().max(80).optional(),
    testId: z.string().max(200).optional(),
    automationId: z.string().max(200).optional(),
  }).strict(),
  domEvidence: z.object({
    control: scannerDomNodeSchema,
    ancestors: z.array(scannerDomNodeSchema).max(8),
  }).strict(),
}).strict();

const scannerFieldObservationSchema = z.object({
  label: z.string().max(1000),
  fieldType: z.string().max(64),
  required: z.boolean(),
  options: z.array(z.string().max(300)).max(100),
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
    control: scannerDomNodeSchema,
    ancestors: z.array(scannerDomNodeSchema).max(8),
  }).strict(),
}).strict();

const scannerFieldSnapshotSchema = z.object({
  fieldType: z.string().max(64).optional(),
  required: z.boolean().optional(),
  options: z.array(z.string().max(300)).max(100).optional(),
  section: z.string().max(200).optional(),
  selectorHints: z.object({
    tag: z.string().max(40).optional(),
    id: z.string().max(200).optional(),
    name: z.string().max(200).optional(),
    role: z.string().max(80).optional(),
    testId: z.string().max(200).optional(),
    automationId: z.string().max(200).optional(),
  }).strict().optional(),
  domEvidence: z.object({
    control: scannerDomNodeSchema,
    ancestors: z.array(scannerDomNodeSchema).max(8),
  }).strict().nullable().optional(),
  captureCount: z.number().int().min(1).max(2).optional(),
  captureVerified: z.boolean().optional(),
  managerReviewed: z.boolean().optional(),
  observations: z.array(scannerLocatorEvidenceSchema.nullable()).max(2).optional(),
  fieldSnapshots: z.array(scannerFieldObservationSchema.nullable()).max(2).optional(),
}).strict().superRefine((snapshot, context) => {
  if (snapshot.captureVerified
    && (snapshot.captureCount !== 2
      || snapshot.observations?.length !== 2
      || snapshot.fieldSnapshots?.length !== 2)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Verified Scanner evidence must contain two captures.',
      path: ['captureVerified'],
    });
  }
});

const scannerRuleSchema = z.object({
  templateId: z.number().int().positive(),
  fieldId: z.string().trim().min(1).max(255),
  semanticKey: z.string().trim().min(1).max(255),
  question: z.string().trim().min(1).max(1000),
  strategy: z.enum(['profile', 'reusable', 'generated', 'manual']),
  profileFieldKey: z.string().trim().max(200).nullable().optional(),
  reusableAnswerId: z.number().int().positive().nullable().optional(),
  reusableAnswer: z.string().trim().min(1).max(4000).nullable().optional(),
  context: z.record(z.string().trim().max(300)).optional().default({}),
  fieldSnapshot: scannerFieldSnapshotSchema.optional().default({}),
}).strict().superRefine((value, context) => {
  if (value.strategy === 'profile' && !value.profileFieldKey) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Choose an Account profile field for Profile Answer.',
      path: ['profileFieldKey'],
    });
  }
  if (value.strategy === 'reusable' && !value.reusableAnswer && !value.reusableAnswerId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Provide or select an answer to save as reusable.',
      path: ['reusableAnswer'],
    });
  }
});

function resolveManagerId(req: NewSchemaAuthRequest, res: Response): number | null {
  const actor = req.newSchemaUser!;
  if (actor.role !== 'manager') {
    res.status(403).json({
      success: false,
      message: 'Only Managers can view or edit their own reusable application answers.',
    });
    return null;
  }
  return actor.id;
}

async function ensureTemplateRecord(templateId: number, managerId: number): Promise<number> {
  return withTransaction(async (tx) => {
    const existing = await tx.query(
      'SELECT template_id FROM application_site_templates WHERE template_id = $1 FOR UPDATE',
      [templateId]
    );
    if (existing.rows.length) {
      return Number((existing.rows[0] as { template_id: number }).template_id);
    }

    const siteKey = `manager:${managerId}:scanner-template:${templateId}`;
    const created = await tx.query(
      `INSERT INTO application_site_templates (
         template_id, site_key, platform, host, template_version, status
       ) VALUES ($1, $2, 'manager', NULL, 'manager-scanner-v1', 'partial')
       ON CONFLICT (template_id) DO NOTHING
       RETURNING template_id`,
      [templateId, siteKey]
    );
    const record = created.rows[0] as { template_id: number } | undefined;
    if (record) {
      await tx.query(
        `SELECT setval(
           pg_get_serial_sequence('application_site_templates', 'template_id'),
           GREATEST(
             (SELECT last_value FROM application_site_templates_template_id_seq),
             $1::bigint
           ),
           true
         )`,
        [templateId]
      );
      return Number(record.template_id);
    }

    const concurrent = await tx.query(
      'SELECT template_id FROM application_site_templates WHERE template_id = $1',
      [templateId]
    );
    const concurrentRecord = concurrent.rows[0] as { template_id: number } | undefined;
    if (!concurrentRecord) {
      throw new Error('Could not create or find the Scanner site template.');
    }
    return Number(concurrentRecord.template_id);
  });
}

async function readProfile(managerId: number) {
  const profile = await queryOne<Record<string, unknown>>(
    `SELECT u.managed_country, p.authorized_to_work, p.authorization_status,
            p.sponsorship_required, COALESCE(p.relocation_willing, FALSE) AS relocation_willing,
            p.notice_period_value, p.notice_period_unit, p.notice_period_text
     FROM users u
     LEFT JOIN manager_application_profiles p ON p.manager_user_id = u.u_id
     WHERE u.u_id = $1 AND u.role = 'manager'`,
    [managerId]
  );
  const salaryAnswers = await queryAll(
    `SELECT salary_answer_id, currency, minimum_amount, maximum_amount,
            pay_period, answer_text
     FROM manager_salary_answers
     WHERE manager_user_id = $1
     ORDER BY salary_answer_id`,
    [managerId]
  );
  const customAnswers = await queryAll(
    `SELECT custom_answer_id, topic, question, answer
     FROM manager_custom_application_answers
     WHERE manager_user_id = $1
     ORDER BY custom_answer_id`,
    [managerId]
  );
  return { ...profile, salaryAnswers, customAnswers };
}

router.get('/', async (req: NewSchemaAuthRequest, res: Response) => {
  const managerId = resolveManagerId(req, res);
  if (managerId === null) return;
  const profile = await readProfile(managerId);
  res.json({ success: true, profile });
});

router.get('/scanner-rules/:templateId', async (req: NewSchemaAuthRequest, res: Response) => {
  const managerId = resolveManagerId(req, res);
  if (managerId === null) return;
  if (!(await requireManagerExtensionFeature(req, res, 'job_site_scanner'))) return;
  const templateId = Number(req.params.templateId);
  if (!Number.isSafeInteger(templateId) || templateId <= 0) {
    res.status(400).json({ success: false, message: 'Invalid site template ID.' });
    return;
  }

  const effectiveTemplateId = await ensureTemplateRecord(templateId, managerId);
  const rules = await queryAll(
    `SELECT rule.rule_id, rule.template_id, rule.field_id, rule.semantic_key,
            rule.question, rule.strategy, rule.profile_field_key,
            rule.reusable_answer_id, answer.question AS reusable_question,
            answer.answer AS reusable_answer, rule.context, rule.field_snapshot,
            rule.history,
            rule.confirmed_at, rule.updated_at
     FROM manager_application_template_rules rule
     LEFT JOIN manager_custom_application_answers answer
       ON answer.custom_answer_id = rule.reusable_answer_id
      AND answer.manager_user_id = rule.manager_user_id
     WHERE rule.manager_user_id = $1 AND rule.template_id = $2
     ORDER BY rule.rule_id`,
    [managerId, effectiveTemplateId]
  );
  res.json({ success: true, rules });
});

router.post('/scanner-rules', async (req: NewSchemaAuthRequest, res: Response) => {
  const managerId = resolveManagerId(req, res);
  if (managerId === null) return;
  if (!(await requireManagerExtensionFeature(req, res, 'job_site_scanner'))) return;
  const parsed = scannerRuleSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      message: parsed.error.issues[0]?.message || 'Provide a valid Scanner field decision.',
      errors: parsed.error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
      })),
    });
    return;
  }

  const data = parsed.data;
  const effectiveTemplateId = await ensureTemplateRecord(data.templateId, managerId);

  if (data.reusableAnswerId) {
    const existingAnswer = await queryOne<{ custom_answer_id: number }>(
      `SELECT custom_answer_id
       FROM manager_custom_application_answers
       WHERE custom_answer_id = $1 AND manager_user_id = $2`,
      [data.reusableAnswerId, managerId]
    );
    if (!existingAnswer) {
      res.status(404).json({ success: false, message: 'Reusable answer not found for this Manager.' });
      return;
    }
  }

  const rule = await withTransaction(async (tx) => {
    let reusableAnswerId: number | null = null;
    if (data.strategy === 'reusable') {
      if (data.reusableAnswerId) {
        reusableAnswerId = data.reusableAnswerId;
        if (data.reusableAnswer) {
          await tx.query(
            `UPDATE manager_custom_application_answers
             SET topic = $1, question = $2, answer = $3
             WHERE custom_answer_id = $4 AND manager_user_id = $5`,
            [data.semanticKey, data.question, data.reusableAnswer, reusableAnswerId, managerId]
          );
        }
      } else {
        const existingAnswer = await tx.query(
          `SELECT custom_answer_id
           FROM manager_custom_application_answers
           WHERE manager_user_id = $1 AND topic = $2
           ORDER BY custom_answer_id
           LIMIT 1
           FOR UPDATE`,
          [managerId, data.semanticKey]
        );
        const existingRow = existingAnswer.rows[0] as { custom_answer_id: number } | undefined;
        if (existingRow) {
          reusableAnswerId = Number(existingRow.custom_answer_id);
          await tx.query(
            `UPDATE manager_custom_application_answers
             SET question = $1, answer = $2
             WHERE custom_answer_id = $3 AND manager_user_id = $4`,
            [data.question, data.reusableAnswer, reusableAnswerId, managerId]
          );
        } else {
          const inserted = await tx.query(
            `INSERT INTO manager_custom_application_answers (manager_user_id, topic, question, answer)
             VALUES ($1, $2, $3, $4)
             RETURNING custom_answer_id`,
            [managerId, data.semanticKey, data.question, data.reusableAnswer]
          );
          reusableAnswerId = Number((inserted.rows[0] as { custom_answer_id: number }).custom_answer_id);
        }
      }
    }

    const previousResult = await tx.query(
      `SELECT semantic_key, question, strategy, profile_field_key,
              reusable_answer_id, context, field_snapshot, history, confirmed_at
       FROM manager_application_template_rules
       WHERE manager_user_id = $1 AND template_id = $2 AND field_id = $3
       FOR UPDATE`,
      [managerId, effectiveTemplateId, data.fieldId]
    );
    const previous = previousResult.rows[0] as Record<string, unknown> | undefined;
    const existingHistory = Array.isArray(previous?.history) ? previous.history : [];
    const historyEntry = previous ? {
      semanticKey: previous.semantic_key,
      question: previous.question,
      strategy: previous.strategy,
      profileFieldKey: previous.profile_field_key,
      reusableAnswerId: previous.reusable_answer_id,
      context: previous.context,
      fieldSnapshot: previous.field_snapshot,
      confirmedAt: previous.confirmed_at,
    } : null;
    const nextHistory = historyEntry ? [...existingHistory, historyEntry].slice(-20) : [];
    const saved = await tx.query(
      `INSERT INTO manager_application_template_rules (
         manager_user_id, template_id, field_id, semantic_key, question, strategy,
         profile_field_key, reusable_answer_id, context, field_snapshot, history,
         confirmed_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11::jsonb, NOW(), NOW())
       ON CONFLICT (manager_user_id, template_id, field_id) DO UPDATE SET
         semantic_key = EXCLUDED.semantic_key,
         question = EXCLUDED.question,
         strategy = EXCLUDED.strategy,
         profile_field_key = EXCLUDED.profile_field_key,
         reusable_answer_id = EXCLUDED.reusable_answer_id,
         context = EXCLUDED.context,
         field_snapshot = EXCLUDED.field_snapshot,
         history = EXCLUDED.history,
         confirmed_at = NOW(),
         updated_at = NOW()
       RETURNING rule_id, template_id, field_id, semantic_key, question, strategy,
                 profile_field_key, reusable_answer_id, context, field_snapshot,
                 history, confirmed_at, updated_at`,
      [
        managerId,
        effectiveTemplateId,
        data.fieldId,
        data.semanticKey,
        data.question,
        data.strategy,
        data.strategy === 'profile' ? data.profileFieldKey : null,
        reusableAnswerId,
        JSON.stringify(data.context),
        JSON.stringify(data.fieldSnapshot),
        JSON.stringify(nextHistory),
      ]
    );
    return saved.rows[0];
  });

  res.json({ success: true, rule });
});

router.post('/scanner-rules/evidence', async (req: NewSchemaAuthRequest, res: Response) => {
  const managerId = resolveManagerId(req, res);
  if (managerId === null) return;
  if (!(await requireManagerExtensionFeature(req, res, 'job_site_scanner'))) return;
  const parsed = z.object({
    templateId: z.number().int().positive(),
    fieldId: z.string().trim().min(1).max(255),
    fieldSnapshot: scannerFieldSnapshotSchema,
  }).strict().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      message: parsed.error.issues[0]?.message || 'Provide valid Scanner locator evidence.',
    });
    return;
  }
  const effectiveTemplateId = await ensureTemplateRecord(parsed.data.templateId, managerId);
  const updated = await queryOne<{ rule_id: number }>(
    `UPDATE manager_application_template_rules
     SET field_snapshot = $1::jsonb, updated_at = NOW()
     WHERE manager_user_id = $2 AND template_id = $3 AND field_id = $4
     RETURNING rule_id`,
    [
      JSON.stringify(parsed.data.fieldSnapshot),
      managerId,
      effectiveTemplateId,
      parsed.data.fieldId,
    ]
  );
  if (!updated) {
    res.status(404).json({ success: false, message: 'Confirmed Scanner rule was not found for this Manager and template.' });
    return;
  }
  res.json({ success: true, updated: true });
});

router.put('/', async (req: NewSchemaAuthRequest, res: Response) => {
  const managerId = resolveManagerId(req, res);
  if (managerId === null) return;
  const parsed = profileSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      message: parsed.error.issues[0]?.message || 'Provide valid application profile answers.',
    });
    return;
  }
  const data = parsed.data;
  await withTransaction(async (tx) => {
    await tx.query(
      `UPDATE users SET managed_country = $1 WHERE u_id = $2 AND role = 'manager'`,
      [data.managedCountry || null, managerId]
    );
    await tx.query(
      `INSERT INTO manager_application_profiles (
        manager_user_id, authorized_to_work, authorization_status,
        sponsorship_required, relocation_willing, notice_period_value, notice_period_unit,
        notice_period_text, updated_date
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
      ON CONFLICT (manager_user_id) DO UPDATE SET
        authorized_to_work = EXCLUDED.authorized_to_work,
        authorization_status = EXCLUDED.authorization_status,
        sponsorship_required = EXCLUDED.sponsorship_required,
        relocation_willing = EXCLUDED.relocation_willing,
        notice_period_value = EXCLUDED.notice_period_value,
        notice_period_unit = EXCLUDED.notice_period_unit,
        notice_period_text = EXCLUDED.notice_period_text,
        updated_date = NOW()`,
      [
        managerId, data.authorizedToWork, data.authorizationStatus || null,
        data.sponsorshipRequired, data.relocationWilling ?? false,
        data.noticePeriodValue, data.noticePeriodUnit,
        data.noticePeriodText || null,
      ]
    );
    await tx.query('DELETE FROM manager_salary_answers WHERE manager_user_id = $1', [managerId]);
    for (const answer of data.salaryAnswers) {
      await tx.query(
        `INSERT INTO manager_salary_answers (
          manager_user_id, currency, minimum_amount, maximum_amount, pay_period, answer_text
        ) VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          managerId, answer.currency, answer.minimumAmount, answer.maximumAmount,
          answer.payPeriod, answer.answerText || null,
        ]
      );
    }
    await tx.query('DELETE FROM manager_custom_application_answers WHERE manager_user_id = $1', [managerId]);
    for (const answer of data.customAnswers) {
      await tx.query(
        `INSERT INTO manager_custom_application_answers (manager_user_id, topic, question, answer)
         VALUES ($1, $2, $3, $4)`,
        [managerId, answer.topic, answer.question, answer.answer]
      );
    }
  });
  res.json({ success: true, profile: await readProfile(managerId) });
});

export default router;
