import { Router, Response } from 'express';
import { z } from 'zod';
import { queryAll, queryOne, withTransaction } from '../../database/connection';
import { NewSchemaAuthRequest, requireNewSchemaAuth } from '../../middleware/new-schema-auth';

const router = Router();
router.use(requireNewSchemaAuth);

const profileSchema = z.object({
  managedCountry: z.string().trim().max(100).nullable(),
  authorizedToWork: z.boolean().nullable(),
  authorizationStatus: z.string().trim().max(500).nullable(),
  sponsorshipRequired: z.boolean().nullable(),
  authorizationExpiresOn: z.string().date().nullable(),
  relocationWilling: z.boolean().nullable(),
  relocationDetails: z.string().trim().max(2000).nullable(),
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

async function resolveManagerId(
  req: NewSchemaAuthRequest,
  res: Response
): Promise<number | null> {
  const actor = req.newSchemaUser!;
  if (actor.role === 'manager') return actor.id;
  if (actor.role !== 'super') {
    res.status(403).json({ success: false, message: 'Manager or Super access required.' });
    return null;
  }
  const managerId = Number(req.query.managerId);
  if (!Number.isSafeInteger(managerId) || managerId <= 0) {
    res.status(400).json({ success: false, message: 'Select a valid Manager.' });
    return null;
  }
  const manager = await queryOne<{ u_id: number }>(
    "SELECT u_id FROM users WHERE u_id = $1 AND role = 'manager'",
    [managerId]
  );
  if (!manager) {
    res.status(404).json({ success: false, message: 'Manager not found.' });
    return null;
  }
  return manager.u_id;
}

async function readProfile(managerId: number) {
  const profile = await queryOne<Record<string, unknown>>(
    `SELECT u.managed_country, p.authorized_to_work, p.authorization_status,
            p.sponsorship_required, p.authorization_expires_on,
            p.relocation_willing, p.relocation_details,
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
  const managerId = await resolveManagerId(req, res);
  if (managerId === null) return;
  const profile = await readProfile(managerId);
  res.json({ success: true, profile });
});

router.put('/', async (req: NewSchemaAuthRequest, res: Response) => {
  const managerId = await resolveManagerId(req, res);
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
        sponsorship_required, authorization_expires_on, relocation_willing,
        relocation_details, notice_period_value, notice_period_unit,
        notice_period_text, updated_date
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
      ON CONFLICT (manager_user_id) DO UPDATE SET
        authorized_to_work = EXCLUDED.authorized_to_work,
        authorization_status = EXCLUDED.authorization_status,
        sponsorship_required = EXCLUDED.sponsorship_required,
        authorization_expires_on = EXCLUDED.authorization_expires_on,
        relocation_willing = EXCLUDED.relocation_willing,
        relocation_details = EXCLUDED.relocation_details,
        notice_period_value = EXCLUDED.notice_period_value,
        notice_period_unit = EXCLUDED.notice_period_unit,
        notice_period_text = EXCLUDED.notice_period_text,
        updated_date = NOW()`,
      [
        managerId, data.authorizedToWork, data.authorizationStatus || null,
        data.sponsorshipRequired, data.authorizationExpiresOn, data.relocationWilling,
        data.relocationDetails || null, data.noticePeriodValue, data.noticePeriodUnit,
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
