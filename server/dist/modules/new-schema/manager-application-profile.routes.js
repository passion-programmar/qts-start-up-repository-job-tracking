"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const connection_1 = require("../../database/connection");
const new_schema_auth_1 = require("../../middleware/new-schema-auth");
const router = (0, express_1.Router)();
router.use(new_schema_auth_1.requireNewSchemaAuth);
const profileSchema = zod_1.z.object({
    managedCountry: zod_1.z.string().trim().max(100).nullable(),
    authorizedToWork: zod_1.z.boolean().nullable(),
    authorizationStatus: zod_1.z.string().trim().max(500).nullable(),
    sponsorshipRequired: zod_1.z.boolean().nullable(),
    relocationWilling: zod_1.z.boolean().nullable(),
    noticePeriodValue: zod_1.z.number().int().min(0).max(10000).nullable(),
    noticePeriodUnit: zod_1.z.enum(['days', 'weeks', 'months']).nullable(),
    noticePeriodText: zod_1.z.string().trim().max(1000).nullable(),
    salaryAnswers: zod_1.z.array(zod_1.z.object({
        currency: zod_1.z.string().trim().regex(/^[A-Za-z]{3}$/).transform((value) => value.toUpperCase()),
        minimumAmount: zod_1.z.number().min(0).max(999999999999).nullable(),
        maximumAmount: zod_1.z.number().min(0).max(999999999999).nullable(),
        payPeriod: zod_1.z.enum(['hour', 'day', 'week', 'month', 'year']),
        answerText: zod_1.z.string().trim().max(1000).nullable(),
    }).refine((entry) => entry.minimumAmount === null || entry.maximumAmount === null ||
        entry.maximumAmount >= entry.minimumAmount, { message: 'Salary maximum must be greater than or equal to the minimum.' })
        .refine((entry) => entry.minimumAmount !== null || entry.maximumAmount !== null || Boolean(entry.answerText), {
        message: 'Each salary answer needs an amount or reusable text.',
    })).max(50),
    customAnswers: zod_1.z.array(zod_1.z.object({
        topic: zod_1.z.string().trim().min(1).max(100),
        question: zod_1.z.string().trim().min(1).max(1000),
        answer: zod_1.z.string().trim().min(1).max(4000),
    })).max(100),
});
function resolveManagerId(req, res) {
    const actor = req.newSchemaUser;
    if (actor.role !== 'manager') {
        res.status(403).json({
            success: false,
            message: 'Only Managers can view or edit their own reusable application answers.',
        });
        return null;
    }
    return actor.id;
}
async function readProfile(managerId) {
    const profile = await (0, connection_1.queryOne)(`SELECT u.managed_country, p.authorized_to_work, p.authorization_status,
            p.sponsorship_required, COALESCE(p.relocation_willing, FALSE) AS relocation_willing,
            p.notice_period_value, p.notice_period_unit, p.notice_period_text
     FROM users u
     LEFT JOIN manager_application_profiles p ON p.manager_user_id = u.u_id
     WHERE u.u_id = $1 AND u.role = 'manager'`, [managerId]);
    const salaryAnswers = await (0, connection_1.queryAll)(`SELECT salary_answer_id, currency, minimum_amount, maximum_amount,
            pay_period, answer_text
     FROM manager_salary_answers
     WHERE manager_user_id = $1
     ORDER BY salary_answer_id`, [managerId]);
    const customAnswers = await (0, connection_1.queryAll)(`SELECT custom_answer_id, topic, question, answer
     FROM manager_custom_application_answers
     WHERE manager_user_id = $1
     ORDER BY custom_answer_id`, [managerId]);
    return { ...profile, salaryAnswers, customAnswers };
}
router.get('/', async (req, res) => {
    const managerId = resolveManagerId(req, res);
    if (managerId === null)
        return;
    const profile = await readProfile(managerId);
    res.json({ success: true, profile });
});
router.put('/', async (req, res) => {
    const managerId = resolveManagerId(req, res);
    if (managerId === null)
        return;
    const parsed = profileSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({
            success: false,
            message: parsed.error.issues[0]?.message || 'Provide valid application profile answers.',
        });
        return;
    }
    const data = parsed.data;
    await (0, connection_1.withTransaction)(async (tx) => {
        await tx.query(`UPDATE users SET managed_country = $1 WHERE u_id = $2 AND role = 'manager'`, [data.managedCountry || null, managerId]);
        await tx.query(`INSERT INTO manager_application_profiles (
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
        updated_date = NOW()`, [
            managerId, data.authorizedToWork, data.authorizationStatus || null,
            data.sponsorshipRequired, data.relocationWilling ?? false,
            data.noticePeriodValue, data.noticePeriodUnit,
            data.noticePeriodText || null,
        ]);
        await tx.query('DELETE FROM manager_salary_answers WHERE manager_user_id = $1', [managerId]);
        for (const answer of data.salaryAnswers) {
            await tx.query(`INSERT INTO manager_salary_answers (
          manager_user_id, currency, minimum_amount, maximum_amount, pay_period, answer_text
        ) VALUES ($1, $2, $3, $4, $5, $6)`, [
                managerId, answer.currency, answer.minimumAmount, answer.maximumAmount,
                answer.payPeriod, answer.answerText || null,
            ]);
        }
        await tx.query('DELETE FROM manager_custom_application_answers WHERE manager_user_id = $1', [managerId]);
        for (const answer of data.customAnswers) {
            await tx.query(`INSERT INTO manager_custom_application_answers (manager_user_id, topic, question, answer)
         VALUES ($1, $2, $3, $4)`, [managerId, answer.topic, answer.question, answer.answer]);
        }
    });
    res.json({ success: true, profile: await readProfile(managerId) });
});
exports.default = router;
//# sourceMappingURL=manager-application-profile.routes.js.map