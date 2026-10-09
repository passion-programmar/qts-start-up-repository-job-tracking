import { Router, Response } from 'express';
import { z } from 'zod';
import { execute, queryAll, queryOne, withTransaction } from '../../database/connection';
import { NewSchemaAuthRequest, requireNewSchemaAuth } from '../../middleware/new-schema-auth';

const router = Router();
router.use(requireNewSchemaAuth);

const managerOnly = (req: NewSchemaAuthRequest, res: Response): boolean => {
  if (req.newSchemaUser?.role === 'manager') return true;
  res.status(403).json({ success: false, message: 'Only Managers can manage bid application attempts.' });
  return false;
};

function workableJobKey(value: string): string | null {
  try {
    const url = new URL(value);
    if (!url.hostname.toLowerCase().endsWith('.workable.com')) return null;
    const match = url.pathname.match(/\/j\/([^/]+)/i);
    return match ? `${url.hostname.toLowerCase()}/j/${match[1].toUpperCase()}` : null;
  } catch {
    return null;
  }
}

router.get('/', async (req: NewSchemaAuthRequest, res: Response) => {
  if (!managerOnly(req, res)) return;
  const managerId = req.newSchemaUser!.id;
  const attempts = await queryAll(
    `WITH displayed_attempts AS (
       SELECT a.attempt_id, j.j_id AS job_id, j.title AS job_title, j.company, j.url,
              account.u_id AS account_user_id, account.name AS account_name,
              COALESCE(a.status, 'not_started') AS status,
              a.failure_reason, a.manager_note, a.started_at, a.submitted_at,
              a.updated_date, j.get_date AS job_date, assignment.position, FALSE AS historical
       FROM job_list j
       JOIN job_account_assignments assignment ON assignment.j_id = j.j_id
       JOIN users account ON account.u_id = assignment.account_user_id
         AND account.role = 'account' AND account.parent_user_id = j.u_id
       LEFT JOIN application_attempts a
         ON a.j_id = j.j_id AND a.account_user_id = account.u_id
       WHERE j.u_id = $1
       UNION ALL
       SELECT a.attempt_id, j.j_id AS job_id, j.title AS job_title, j.company, j.url,
              account.u_id AS account_user_id, account.name AS account_name,
              a.status, a.failure_reason, a.manager_note, a.started_at, a.submitted_at,
              a.updated_date, j.get_date AS job_date, 2147483647::bigint AS position, TRUE AS historical
       FROM application_attempts a
       JOIN job_list j ON j.j_id = a.j_id AND j.u_id = $1
       JOIN users account ON account.u_id = a.account_user_id
         AND account.role = 'account' AND account.parent_user_id = j.u_id
       LEFT JOIN job_account_assignments assignment
         ON assignment.j_id = j.j_id AND assignment.account_user_id = account.u_id
       WHERE assignment.j_id IS NULL
     )
     SELECT attempt_id, job_id, job_title, company, url, account_user_id, account_name,
            status, failure_reason, manager_note, started_at, submitted_at, updated_date
     FROM displayed_attempts
     ORDER BY job_date DESC, job_id DESC, historical ASC, position ASC`,
    [managerId]
  );
  res.json({ success: true, attempts });
});

router.get('/context', async (req: NewSchemaAuthRequest, res: Response) => {
  if (!managerOnly(req, res)) return;
  const url = z.string().url().safeParse(req.query.url);
  const key = url.success ? workableJobKey(url.data) : null;
  if (!key) {
    res.status(400).json({ success: false, message: 'Provide a Workable job URL.' });
    return;
  }

  const managerId = req.newSchemaUser!.id;
  const jobs = await queryAll<{ j_id: number; title: string; company: string; url: string }>(
    'SELECT j_id, title, company, url FROM job_list WHERE u_id = $1',
    [managerId]
  );
  const job = jobs.find((item) => workableJobKey(item.url) === key);
  if (!job) {
    res.status(404).json({ success: false, message: 'This Workable job is not assigned in your job list.' });
    return;
  }

  const accounts = await queryAll(
    `SELECT account.u_id AS account_user_id, account.name,
            account.email, account.phone, account.address, account.city,
            account.country, account.sex, account.birthday,
            profile.first_name, profile.last_name, profile.resume_file_name,
            (profile.resume_content IS NOT NULL) AS has_resume,
            profile.education, profile.work_experience,
            COALESCE(attempt.status, 'not_started') AS status
     FROM job_account_assignments assignment
     JOIN users account ON account.u_id = assignment.account_user_id
       AND account.role = 'account' AND account.parent_user_id = $2
       AND account.blocked_date IS NULL
     LEFT JOIN account_application_profiles profile ON profile.account_user_id = account.u_id
     LEFT JOIN application_attempts attempt
       ON attempt.j_id = $1 AND attempt.account_user_id = account.u_id
     WHERE assignment.j_id = $1
     ORDER BY assignment.position`,
    [job.j_id, managerId]
  );
  const applicationProfile = await queryOne(
    `SELECT u.managed_country, p.authorized_to_work, p.authorization_status,
            p.sponsorship_required, p.authorization_expires_on,
            p.relocation_willing, p.relocation_details,
            p.notice_period_value, p.notice_period_unit, p.notice_period_text
     FROM users u
     LEFT JOIN manager_application_profiles p ON p.manager_user_id = u.u_id
     WHERE u.u_id = $1 AND u.role = 'manager'`,
    [managerId]
  );
  const [salaryAnswers, customAnswers, setting] = await Promise.all([
    queryAll(
      `SELECT currency, minimum_amount, maximum_amount, pay_period, answer_text
       FROM manager_salary_answers WHERE manager_user_id = $1 ORDER BY salary_answer_id`,
      [managerId]
    ),
    queryAll(
      `SELECT topic, question, answer
       FROM manager_custom_application_answers WHERE manager_user_id = $1 ORDER BY custom_answer_id`,
      [managerId]
    ),
    queryOne<{ setting_value: string }>(
      "SELECT setting_value FROM app_settings WHERE setting_name = 'application_submission_mode'"
    ),
  ]);

  res.json({
    success: true,
    job,
    accounts,
    managerAnswers: { ...applicationProfile, salaryAnswers, customAnswers },
    submissionMode: setting?.setting_value === 'auto' ? 'auto' : 'manual',
  });
});

router.post('/claim-next', async (req: NewSchemaAuthRequest, res: Response) => {
  if (!managerOnly(req, res)) return;
  const managerId = req.newSchemaUser!.id;

  const claimed = await withTransaction(async (tx) => {
    const candidateResult = await tx.query(
      `SELECT j.j_id, j.title, j.company, j.url, j.status,
              assignment.account_user_id, account.name AS account_name,
              attempt.attempt_id AS existing_attempt_id
       FROM job_list j
       JOIN job_account_assignments assignment ON assignment.j_id = j.j_id
       JOIN users account ON account.u_id = assignment.account_user_id
         AND account.role = 'account' AND account.parent_user_id = j.u_id
         AND account.blocked_date IS NULL
       LEFT JOIN application_attempts attempt
         ON attempt.j_id = j.j_id
         AND attempt.account_user_id = assignment.account_user_id
       WHERE j.u_id = $1 AND j.status = 'todo'
         AND j.url ~* '^https?://[^/]*[.]workable[.]com/j/'
         AND (
           attempt.attempt_id IS NULL
           OR (attempt.status = 'in_progress'
             AND attempt.updated_date < NOW() - INTERVAL '10 minutes')
         )
       ORDER BY j.get_date DESC, j.j_id DESC, assignment.position ASC`,
      [managerId]
    );

    for (const row of candidateResult.rows as Array<{
      j_id: number;
      title: string;
      company: string;
      url: string;
      status: string;
      account_user_id: number;
      account_name: string;
      existing_attempt_id: number | null;
    }>) {
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(row.url);
      } catch {
        continue;
      }
      if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') continue;

      const lockedJob = await tx.query(
        `SELECT j_id FROM job_list
         WHERE j_id = $1 AND u_id = $2 AND status = 'todo'
           AND EXISTS (
             SELECT 1 FROM job_account_assignments assignment
             WHERE assignment.j_id = job_list.j_id
               AND assignment.account_user_id = $3
           )
         FOR UPDATE SKIP LOCKED`,
        [row.j_id, managerId, row.account_user_id]
      );
      if (!lockedJob.rows.length) continue;

      const attemptResult = row.existing_attempt_id
        ? await tx.query(
          `UPDATE application_attempts
           SET started_at = NOW(), updated_date = NOW(), failure_reason = NULL
           WHERE attempt_id = $1 AND manager_user_id = $2 AND status = 'in_progress'
             AND updated_date < NOW() - INTERVAL '10 minutes'
           RETURNING attempt_id, status`,
          [row.existing_attempt_id, managerId]
        )
        : await tx.query(
          `INSERT INTO application_attempts (manager_user_id, j_id, account_user_id, status)
           VALUES ($1, $2, $3, 'in_progress')
           ON CONFLICT (j_id, account_user_id) DO NOTHING
           RETURNING attempt_id, status`,
          [managerId, row.j_id, row.account_user_id]
        );
      const attempt = attemptResult.rows[0] as { attempt_id: number; status: string } | undefined;
      if (!attempt) continue;

      return {
        job: {
          id: row.j_id,
          title: row.title,
          company: row.company,
          url: row.url,
          status: row.status,
        },
        account: {
          id: row.account_user_id,
          name: row.account_name,
        },
        attempt,
      };
    }

    return null;
  });

  res.json({
    success: true,
    claimed: Boolean(claimed),
    ...(claimed || {}),
  });
});

router.post('/:jobId/:accountId/start', async (req: NewSchemaAuthRequest, res: Response) => {
  if (!managerOnly(req, res)) return;
  const jobId = Number.parseInt(req.params.jobId, 10);
  const accountId = Number.parseInt(req.params.accountId, 10);
  if (!Number.isSafeInteger(jobId) || jobId <= 0 || !Number.isSafeInteger(accountId) || accountId <= 0) {
    res.status(400).json({ success: false, message: 'Provide a valid job and Account.' });
    return;
  }
  const managerId = req.newSchemaUser!.id;
  const allowed = await queryOne<{ j_id: number }>(
    `SELECT j.j_id
     FROM job_list j
     JOIN users account ON account.u_id = $2 AND account.role = 'account'
       AND account.parent_user_id = j.u_id AND account.blocked_date IS NULL
     WHERE j.j_id = $1 AND j.u_id = $3
       AND EXISTS (
         SELECT 1 FROM job_account_assignments assignment
         WHERE assignment.j_id = j.j_id AND assignment.account_user_id = $2
       )`,
    [jobId, accountId, managerId]
  );
  if (!allowed) {
    res.status(404).json({ success: false, message: 'This Account is not assigned to that job.' });
    return;
  }
  const attempt = await queryOne(
    `INSERT INTO application_attempts (manager_user_id, j_id, account_user_id, status)
     VALUES ($1, $2, $3, 'in_progress')
     ON CONFLICT (j_id, account_user_id) DO NOTHING
     RETURNING attempt_id, status`,
    [managerId, jobId, accountId]
  );
  if (!attempt) {
    const existing = await queryOne<{ status: string }>(
      'SELECT status FROM application_attempts WHERE j_id = $1 AND account_user_id = $2',
      [jobId, accountId]
    );
    res.status(409).json({
      success: false,
      message: 'This Account already has an application attempt for this job.',
      status: existing?.status,
    });
    return;
  }
  res.status(201).json({ success: true, attempt });
});

const attemptUpdateSchema = z.object({
  status: z.enum(['needs_review', 'submitted', 'failed']).optional(),
  failureReason: z.string().trim().max(2000).nullable().optional(),
  managerNote: z.string().trim().max(2000).nullable().optional(),
}).refine((data) => Object.keys(data).length > 0, { message: 'Provide an attempt status or note.' });

router.patch('/:jobId/:accountId', async (req: NewSchemaAuthRequest, res: Response) => {
  if (!managerOnly(req, res)) return;
  const jobId = Number.parseInt(req.params.jobId, 10);
  const accountId = Number.parseInt(req.params.accountId, 10);
  const parsed = attemptUpdateSchema.safeParse(req.body);
  if (!Number.isSafeInteger(jobId) || jobId <= 0 || !Number.isSafeInteger(accountId) ||
      accountId <= 0 || !parsed.success) {
    res.status(400).json({ success: false, message: 'Provide valid application status details.' });
    return;
  }
  const managerId = req.newSchemaUser!.id;
  const existing = await queryOne<{ status: string }>(
    `SELECT status FROM application_attempts
     WHERE j_id = $1 AND account_user_id = $2 AND manager_user_id = $3`,
    [jobId, accountId, managerId]
  );
  if (!existing) {
    res.status(404).json({ success: false, message: 'Application attempt not found.' });
    return;
  }
  const update = parsed.data;
  const allowedTransition =
    (existing.status === 'in_progress' && ['needs_review', 'submitted', 'failed'].includes(update.status || '')) ||
    (existing.status === 'needs_review' && ['submitted', 'failed'].includes(update.status || ''));
  if (update.status && !allowedTransition) {
    res.status(409).json({ success: false, message: 'This application attempt is already closed or cannot use that status.' });
    return;
  }

  const attempt = await withTransaction(async (tx) => {
    await tx.query(
      `UPDATE application_attempts
       SET status = COALESCE($1, status),
           failure_reason = COALESCE($2, failure_reason),
           manager_note = COALESCE($3, manager_note),
           submitted_at = CASE WHEN $1 = 'submitted' THEN NOW() ELSE submitted_at END,
           updated_date = NOW()
       WHERE j_id = $4 AND account_user_id = $5 AND manager_user_id = $6`,
      [
        update.status ?? null, update.failureReason ?? null, update.managerNote ?? null,
        jobId, accountId, managerId,
      ]
    );
    if (update.status === 'submitted') {
      const jobResult = await tx.query(
        'SELECT title, company, url, status FROM job_list WHERE j_id = $1 AND u_id = $2',
        [jobId, managerId]
      );
      const job = jobResult.rows[0] as { title: string; company: string; url: string; status: string } | undefined;
      if (!job) throw new Error('Assigned job disappeared while recording the application.');
      await tx.query(
        `INSERT INTO bids (
          u_id, j_id, manager_user_id, job_title, company, job_url, job_status, resume_path
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (u_id, j_id) DO NOTHING`,
        [accountId, jobId, managerId, job.title, job.company, job.url, job.status, `account-profile:${accountId}`]
      );
    }
    const result = await tx.query(
      `SELECT j_id AS job_id, account_user_id, status, failure_reason, manager_note,
              started_at, submitted_at, updated_date
       FROM application_attempts
       WHERE j_id = $1 AND account_user_id = $2 AND manager_user_id = $3`,
      [jobId, accountId, managerId]
    );
    return result.rows[0];
  });
  res.json({ success: true, attempt });
});

router.put('/:jobId/:accountId/note', async (req: NewSchemaAuthRequest, res: Response) => {
  if (!managerOnly(req, res)) return;
  const jobId = Number.parseInt(req.params.jobId, 10);
  const accountId = Number.parseInt(req.params.accountId, 10);
  const parsed = z.object({ managerNote: z.string().trim().max(2000).nullable() }).safeParse(req.body);
  if (!Number.isSafeInteger(jobId) || jobId <= 0 || !Number.isSafeInteger(accountId) ||
      accountId <= 0 || !parsed.success) {
    res.status(400).json({ success: false, message: 'Provide a valid Manager note.' });
    return;
  }
  const result = await execute(
    `UPDATE application_attempts SET manager_note = $1, updated_date = NOW()
     WHERE j_id = $2 AND account_user_id = $3 AND manager_user_id = $4`,
    [parsed.data.managerNote, jobId, accountId, req.newSchemaUser!.id]
  );
  if (result.rowCount === 0) {
    res.status(404).json({ success: false, message: 'Application attempt not found.' });
    return;
  }
  res.json({ success: true });
});

export default router;
