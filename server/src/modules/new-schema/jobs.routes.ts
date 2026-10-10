import { Router, Response } from 'express';
import { z } from 'zod';
import { DbQueryable, execute, queryAll, queryOne, withTransaction } from '../../database/connection';
import {
  NewSchemaAuthRequest,
  requireNewSchemaAuth,
} from '../../middleware/new-schema-auth';
import { normalizeUrl } from '../../utilities/normalize-url';
import { logger } from '../../utilities/logger';

const router = Router();
router.use(requireNewSchemaAuth);

const JobSchema = z.object({
  url: z.string().url().max(2000),
  company: z.string().trim().min(1).max(300),
  title: z.string().trim().min(1).max(300),
  categoryIds: z.array(z.number().int().positive()).optional().default([]),
  selectedAccountUserIds: z.array(z.number().int().positive()).optional().default([]),
  status: z.enum(['processing', 'todo', 'did', 'failed']).optional(),
});

function applicationTypeForUrl(value: string): string {
  const url = new URL(value);
  const hostname = url.hostname.toLowerCase().replace(/^www[.]/, '');
  return hostname.endsWith('.workable.com') && /\/j\/[^/]+/i.test(url.pathname)
    ? 'workable'
    : hostname;
}

function jobScope(user: NonNullable<NewSchemaAuthRequest['newSchemaUser']>, index = 1): {
  clause: string;
  params: unknown[];
} {
  switch (user.role) {
    case 'super':
      return { clause: '', params: [] };
    case 'admin':
      return {
        clause: `j.u_id IN (
          SELECT manager.u_id FROM users manager
          WHERE manager.role = 'manager' AND manager.parent_user_id = $${index}
        )`,
        params: [user.id],
      };
    case 'manager':
      return { clause: `j.u_id = $${index}`, params: [user.id] };
    default:
      return { clause: 'FALSE', params: [] };
  }
}

async function validateJobAssignments(
  managerId: number,
  categoryIds: number[],
  accountIds: number[]
): Promise<string | null> {
  const uniqueCategoryIds = [...new Set(categoryIds)];
  const uniqueAccountIds = [...new Set(accountIds)];
  if (uniqueCategoryIds.length !== categoryIds.length || uniqueAccountIds.length !== accountIds.length) {
    return 'Category and Account selections must not contain duplicates.';
  }
  if (uniqueCategoryIds.length) {
    const categories = await queryAll<{ category_id: number }>(
      'SELECT category_id FROM categories WHERE category_id = ANY($1::int[])',
      [uniqueCategoryIds]
    );
    if (categories.length !== uniqueCategoryIds.length) return 'Select existing categories only.';
  }
  if (uniqueAccountIds.length) {
    const accounts = await queryAll<{ u_id: number; category_id: number }>(
      `SELECT u_id, category_id FROM users
       WHERE u_id = ANY($1::int[]) AND role = 'account'
         AND parent_user_id = $2 AND blocked_date IS NULL`,
      [uniqueAccountIds, managerId]
    );
    if (accounts.length !== uniqueAccountIds.length) {
      return 'Every selected Account must be active and assigned to you.';
    }
    if (uniqueCategoryIds.length && accounts.some((account) => !uniqueCategoryIds.includes(account.category_id))) {
      return 'Every selected Account must match at least one selected job category.';
    }
  }
  return null;
}

function jobProjection(): string {
  return `SELECT j.j_id AS id, j.u_id AS manager_id, j.url, j.application_type, j.company, j.title,
                 j.category_ids,
                 COALESCE((
                   SELECT array_agg(assignment.account_user_id ORDER BY assignment.position)
                   FROM job_account_assignments assignment
                   WHERE assignment.j_id = j.j_id
                 ), ARRAY[]::INTEGER[]) AS selected_account_u_ids,
                 COALESCE((
                   SELECT json_agg(json_build_object(
                     'account_user_id', assignment.account_user_id,
                     'name', account.name,
                     'status', j.status
                   ) ORDER BY assignment.position)
                   FROM job_account_assignments assignment
                   JOIN users account ON account.u_id = assignment.account_user_id
                   WHERE assignment.j_id = j.j_id
                 ), '[]'::json) AS selected_accounts,
                 j.status, j.get_date
          FROM job_list j`;
}

async function synchronizeAccountJobRows(
  tx: DbQueryable,
  managerId: number,
  url: string,
  applicationType: string,
  company: string,
  title: string,
  categoryIds: number[],
  selectedAccountIds: number[]
): Promise<{ rows: Array<{ j_id: number; account_user_id: number }>; blockedRemovalCount: number }> {
  await tx.query('SELECT pg_advisory_xact_lock($1, hashtext($2))', [managerId, url]);
  await tx.query(
    `DELETE FROM job_list job
     WHERE job.u_id = $1 AND job.url = $2 AND job.status = 'todo'
       AND NOT EXISTS (
         SELECT 1 FROM job_account_assignments assignment
         WHERE assignment.j_id = job.j_id
       )`,
    [managerId, url]
  );
  const existingResult = await tx.query(
    `SELECT job.j_id, job.status, assignment.account_user_id
     FROM job_list job
     JOIN job_account_assignments assignment ON assignment.j_id = job.j_id
     WHERE job.u_id = $1 AND job.url = $2
     ORDER BY assignment.position, job.j_id
     FOR UPDATE OF job`,
    [managerId, url]
  );
  const existingRows = existingResult.rows as Array<{
    j_id: number;
    status: 'processing' | 'todo' | 'did' | 'failed';
    account_user_id: number;
  }>;
  const existingByAccount = new Map(existingRows.map((row) => [Number(row.account_user_id), row]));
  const selectedIds = new Set(selectedAccountIds);
  const rows: Array<{ j_id: number; account_user_id: number }> = [];
  let blockedRemovalCount = 0;

  for (const row of existingRows) {
    const accountId = Number(row.account_user_id);
    if (selectedIds.has(accountId)) continue;
    if (row.status !== 'todo') {
      blockedRemovalCount += 1;
      rows.push({ j_id: Number(row.j_id), account_user_id: accountId });
      continue;
    }
    await tx.query('DELETE FROM job_list WHERE j_id = $1 AND u_id = $2', [row.j_id, managerId]);
  }

  for (const accountId of selectedAccountIds) {
    const existing = existingByAccount.get(accountId);
    if (existing) {
      await tx.query(
        `UPDATE job_list SET application_type = $1, company = $2, title = $3, category_ids = $4::int[]
         WHERE j_id = $5 AND u_id = $6`,
        [applicationType, company, title, categoryIds, existing.j_id, managerId]
      );
      rows.push({ j_id: Number(existing.j_id), account_user_id: accountId });
      continue;
    }

    const inserted = await tx.query(
      `INSERT INTO job_list (u_id, url, application_type, company, title, category_ids, status)
       VALUES ($1, $2, $3, $4, $5, $6::int[], 'todo')
       RETURNING j_id`,
      [managerId, url, applicationType, company, title, categoryIds]
    );
    const jobId = Number((inserted.rows[0] as { j_id: number }).j_id);
    await tx.query(
      `INSERT INTO job_account_assignments (j_id, account_user_id, position)
       VALUES ($1, $2, 1)`,
      [jobId, accountId]
    );
    rows.push({ j_id: jobId, account_user_id: accountId });
  }

  return { rows, blockedRemovalCount };
}

router.get('/', async (req: NewSchemaAuthRequest, res: Response) => {
  const user = req.newSchemaUser!;
  const scope = jobScope(user);
  const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
  const status = typeof req.query.status === 'string' ? req.query.status : '';
  const conditions: string[] = [];
  const params = [...scope.params];
  if (scope.clause) conditions.push(scope.clause);
  if (search) {
    params.push(`%${search}%`);
    conditions.push(`(j.title ILIKE $${params.length} OR j.company ILIKE $${params.length})`);
  }
  if (status && ['processing', 'todo', 'did', 'failed'].includes(status)) {
    params.push(status);
    conditions.push(`j.status = $${params.length}`);
  }
  let query = jobProjection();
  if (conditions.length) query += ` WHERE ${conditions.join(' AND ')}`;
  query += ' ORDER BY j.get_date DESC, j.j_id DESC';
  const jobs = await queryAll(query, params);
  res.json({ success: true, jobs });
});

router.get('/check-url', async (req: NewSchemaAuthRequest, res: Response) => {
  const user = req.newSchemaUser!;
  if (user.role !== 'manager') {
    res.status(403).json({ success: false, message: 'Only Managers can check saved job URLs.' });
    return;
  }
  const parsedUrl = z.string().url().max(2000).safeParse(req.query.url);
  if (!parsedUrl.success) {
    res.status(400).json({ success: false, message: 'Provide a valid job URL.' });
    return;
  }

  const url = normalizeUrl(parsedUrl.data);
  const [jobs, applied] = await Promise.all([
    queryAll(`${jobProjection()} WHERE j.u_id = $1 AND j.url = $2 ORDER BY j.j_id`, [user.id, url]),
    queryOne<{ already_applied: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM bids bid
         WHERE bid.manager_user_id = $1 AND bid.job_url = $2
           AND NOT EXISTS (
             SELECT 1 FROM job_list job
             WHERE job.u_id = $1 AND job.url = $2
               AND job.status IN ('todo', 'processing')
           )
       ) AS already_applied`,
      [user.id, url]
    ),
  ]);
  const grouped = jobs.length
    ? {
      ...jobs[0],
      selected_account_u_ids: [...new Set(jobs.flatMap((job) =>
        Array.isArray(job.selected_account_u_ids) ? job.selected_account_u_ids.map(Number) : []
      ))],
      selected_accounts: jobs.flatMap((job) =>
        Array.isArray(job.selected_accounts) ? job.selected_accounts : []
      ),
      job_ids: jobs.map((job) => Number(job.id)),
    }
    : null;
  res.json({ success: true, alreadyApplied: Boolean(applied?.already_applied), job: grouped });
});

router.post('/claim-next', async (req: NewSchemaAuthRequest, res: Response) => {
  const user = req.newSchemaUser!;
  if (user.role !== 'manager') {
    res.status(403).json({ success: false, message: 'Only Managers can start jobs from their job list.' });
    return;
  }
  const parsedBody = z.object({
    url: z.string().url().max(2000).optional(),
    accountUserId: z.number().int().positive(),
    applyRunId: z.string().uuid(),
    supportedTypes: z.array(z.string().regex(/^[a-z0-9.-]{1,253}$/i)).min(1).max(20),
  }).safeParse(req.body || {});
  if (!parsedBody.success) {
    res.status(400).json({ success: false, message: 'Provide an Account, Apply run ID, supported application types, and an optional current job URL.' });
    return;
  }
  const requestedUrl = parsedBody.data.url ? normalizeUrl(parsedBody.data.url) : null;
  const supportedTypes = parsedBody.data.supportedTypes;
  const { accountUserId: accountId, applyRunId } = parsedBody.data;
  const claim = await withTransaction(async (tx) => {
    const accountResult = await tx.query(
      `SELECT u_id FROM users
       WHERE u_id = $1 AND parent_user_id = $2
         AND role = 'account' AND blocked_date IS NULL
       FOR UPDATE`,
      [accountId, user.id]
    );
    if (!accountResult.rows.length) return { invalidAccount: true as const };

    const activeJob = await tx.query(
      `SELECT job.j_id
       FROM job_list job
       JOIN job_account_assignments assignment ON assignment.j_id = job.j_id
       WHERE job.u_id = $1 AND assignment.account_user_id = $2
         AND job.status = 'processing'
       LIMIT 1`,
      [user.id, accountId]
    );
    if (activeJob.rows.length) return { busy: true as const };

    const existingRun = await tx.query(
      `SELECT run_id, (last_activity_at > NOW() - INTERVAL '24 hours') AS is_active
       FROM account_apply_runs
       WHERE account_user_id = $1
       FOR UPDATE`,
      [accountId]
    );
    const activeRun = existingRun.rows[0] as {
      run_id: string;
      is_active: boolean;
    } | undefined;
    if (activeRun
      && activeRun.run_id !== applyRunId
      && activeRun.is_active) {
      return { busy: true as const };
    }
    await tx.query(
      `INSERT INTO account_apply_runs (account_user_id, manager_user_id, run_id, last_activity_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (account_user_id) DO UPDATE
       SET manager_user_id = EXCLUDED.manager_user_id,
           run_id = EXCLUDED.run_id,
           last_activity_at = NOW()`,
      [accountId, user.id, applyRunId]
    );

    const candidate = await tx.query(
      `SELECT job.j_id, job.title, job.company, job.url, job.application_type, job.status,
              assignment.account_user_id, account.name AS account_name
       FROM job_list job
       JOIN job_account_assignments assignment ON assignment.j_id = job.j_id
       JOIN users account ON account.u_id = assignment.account_user_id
         AND account.role = 'account' AND account.parent_user_id = job.u_id
         AND account.blocked_date IS NULL
       WHERE job.u_id = $1 AND job.status = 'todo'
         AND assignment.account_user_id = $4
         AND job.application_type = ANY($2::text[])
         AND ($3::text IS NULL OR job.url = $3)
       ORDER BY CASE WHEN $3::text IS NOT NULL AND job.url = $3 THEN 0 ELSE 1 END,
                job.get_date DESC, job.j_id DESC
       LIMIT 1
       FOR UPDATE OF job SKIP LOCKED`,
      [user.id, supportedTypes, requestedUrl, accountId]
    );
    const row = candidate.rows[0] as {
      j_id: number;
      title: string;
      company: string;
      url: string;
      application_type: string;
      account_user_id: number;
      account_name: string;
    } | undefined;
    if (!row) {
      await tx.query(
        'DELETE FROM account_apply_runs WHERE account_user_id = $1 AND run_id = $2',
        [accountId, applyRunId]
      );
      return { empty: true as const };
    }
    const changed = await tx.query(
      `UPDATE job_list SET status = 'processing'
       WHERE j_id = $1 AND u_id = $2 AND status = 'todo'
       RETURNING j_id`,
      [row.j_id, user.id]
    );
    if (!changed.rows.length) {
      await tx.query(
        'DELETE FROM account_apply_runs WHERE account_user_id = $1 AND run_id = $2',
        [accountId, applyRunId]
      );
      return { empty: true as const };
    }
    return {
      claimed: true as const,
      applyRunId,
      job: {
        id: Number(row.j_id),
        title: row.title,
        company: row.company,
        url: row.url,
        applicationType: row.application_type,
      },
      account: { id: Number(row.account_user_id), name: row.account_name },
    };
  });
  if ('invalidAccount' in claim) {
    res.status(404).json({ success: false, message: 'Selected Account is not active or is not assigned to you.' });
    return;
  }
  if ('busy' in claim) {
    res.status(409).json({
      success: false,
      message: 'This Account already has an application in progress. Finish or resolve it before starting another Apply run.',
    });
    return;
  }
  if ('empty' in claim) {
    res.json({ success: true, claimed: false });
    return;
  }
  res.json({ success: true, ...claim });
});

router.get('/statuses', async (req: NewSchemaAuthRequest, res: Response) => {
  if (req.newSchemaUser?.role !== 'manager') {
    res.status(403).json({ success: false, message: 'Only Managers can view application statuses.' });
    return;
  }
  const rows = await queryAll(
    `SELECT job.j_id AS job_id, job.title AS job_title, job.company, job.url,
            job.application_type,
            job.status, job.get_date, assignment.account_user_id,
            account.name AS account_name
     FROM job_list job
     JOIN job_account_assignments assignment ON assignment.j_id = job.j_id
     JOIN users account ON account.u_id = assignment.account_user_id
     WHERE job.u_id = $1
     ORDER BY job.get_date DESC, job.j_id DESC`,
    [req.newSchemaUser.id]
  );
  res.json({ success: true, jobs: rows });
});

router.get('/apply-accounts', async (req: NewSchemaAuthRequest, res: Response) => {
  const user = req.newSchemaUser!;
  if (user.role !== 'manager') {
    res.status(403).json({ success: false, message: 'Only Managers can choose an Account for Apply.' });
    return;
  }
  const typesParam = typeof req.query.supportedTypes === 'string'
    ? req.query.supportedTypes.split(',').filter(Boolean)
    : [];
  const parsedTypes = z.array(z.string().regex(/^[a-z0-9.-]{1,253}$/i)).min(1).max(20).safeParse(typesParam);
  if (!parsedTypes.success) {
    res.status(400).json({ success: false, message: 'Provide the application types supported by this extension.' });
    return;
  }
  const accounts = await queryAll(
    `SELECT account.u_id AS account_user_id, account.name AS account_name,
            COUNT(job.j_id)::int AS total_count,
            COUNT(job.j_id) FILTER (WHERE job.status = 'did')::int AS did_count,
            COUNT(job.j_id) FILTER (WHERE job.status = 'processing')::int AS processing_count,
            COUNT(job.j_id) FILTER (
              WHERE job.status = 'todo'
                AND job.application_type = ANY($2::text[])
            )::int AS available_count,
            (
              COUNT(job.j_id) FILTER (WHERE job.status = 'processing') > 0
              OR EXISTS (
                SELECT 1 FROM account_apply_runs active_run
                WHERE active_run.account_user_id = account.u_id
                  AND active_run.last_activity_at > NOW() - INTERVAL '24 hours'
              )
            ) AS is_busy
     FROM users account
     LEFT JOIN job_account_assignments assignment
       ON assignment.account_user_id = account.u_id
     LEFT JOIN job_list job ON job.j_id = assignment.j_id AND job.u_id = account.parent_user_id
     WHERE account.u_id IS NOT NULL AND account.role = 'account'
       AND account.parent_user_id = $1 AND account.blocked_date IS NULL
     GROUP BY account.u_id, account.name
     ORDER BY account.name, account.u_id`,
    [user.id, parsedTypes.data]
  );
  res.json({ success: true, accounts });
});

router.post('/apply-runs/release', async (req: NewSchemaAuthRequest, res: Response) => {
  const user = req.newSchemaUser!;
  if (user.role !== 'manager') {
    res.status(403).json({ success: false, message: 'Only Managers can release an Apply run.' });
    return;
  }
  const parsed = z.object({
    accountUserId: z.number().int().positive(),
    applyRunId: z.string().uuid(),
  }).safeParse(req.body || {});
  if (!parsed.success) {
    res.status(400).json({ success: false, message: 'Provide a valid Account and Apply run ID.' });
    return;
  }
  const result = await withTransaction(async (tx) => {
    const account = await tx.query(
      `SELECT u_id FROM users
       WHERE u_id = $1 AND parent_user_id = $2 AND role = 'account'
       FOR UPDATE`,
      [parsed.data.accountUserId, user.id]
    );
    if (!account.rows.length) return { invalidAccount: true as const };
    const activeJob = await tx.query(
      `SELECT job.j_id FROM job_list job
       JOIN job_account_assignments assignment ON assignment.j_id = job.j_id
       WHERE job.u_id = $1 AND assignment.account_user_id = $2
         AND job.status = 'processing'
       LIMIT 1`,
      [user.id, parsed.data.accountUserId]
    );
    if (activeJob.rows.length) return { busy: true as const };
    await tx.query(
      `DELETE FROM account_apply_runs
       WHERE account_user_id = $1 AND manager_user_id = $2 AND run_id = $3`,
      [parsed.data.accountUserId, user.id, parsed.data.applyRunId]
    );
    return { released: true as const };
  });
  if ('invalidAccount' in result) {
    res.status(404).json({ success: false, message: 'Selected Account is not assigned to you.' });
    return;
  }
  if ('busy' in result) {
    res.status(409).json({ success: false, message: 'The Account still has a job in progress; its Apply run cannot be released.' });
    return;
  }
  res.json({ success: true, released: result.released });
});

router.get('/:id/application-context', async (req: NewSchemaAuthRequest, res: Response) => {
  if (req.newSchemaUser?.role !== 'manager') {
    res.status(403).json({ success: false, message: 'Only Managers can load application context.' });
    return;
  }
  const jobId = Number.parseInt(req.params.id, 10);
  if (!Number.isSafeInteger(jobId) || jobId <= 0) {
    res.status(400).json({ success: false, message: 'Provide a valid job row ID.' });
    return;
  }
  const managerId = req.newSchemaUser.id;
  const [job, account, applicationProfile, salaryAnswers, customAnswers, setting] = await Promise.all([
    queryOne(
      `SELECT job.j_id, job.title, job.company, job.url, job.application_type, job.status,
              assignment.account_user_id
       FROM job_list job
       JOIN job_account_assignments assignment ON assignment.j_id = job.j_id
       WHERE job.j_id = $1 AND job.u_id = $2 AND job.status = 'processing'`,
      [jobId, managerId]
    ),
    queryOne(
      `SELECT account.u_id AS account_user_id, account.name,
              account.email, account.phone, account.address, account.city,
              account.country, account.sex, account.birthday,
              profile.first_name, profile.last_name, profile.resume_file_name,
              (profile.resume_content IS NOT NULL) AS has_resume,
              profile.education, profile.work_experience, profile.custom_fields
       FROM job_account_assignments assignment
       JOIN users account ON account.u_id = assignment.account_user_id
         AND account.role = 'account' AND account.parent_user_id = $2
         AND account.blocked_date IS NULL
       LEFT JOIN account_application_profiles profile ON profile.account_user_id = account.u_id
       WHERE assignment.j_id = $1`,
      [jobId, managerId]
    ),
    queryOne(
      `SELECT u.managed_country, p.authorized_to_work, p.authorization_status,
              p.sponsorship_required, COALESCE(p.relocation_willing, FALSE) AS relocation_willing,
              p.notice_period_value, p.notice_period_unit, p.notice_period_text
       FROM users u
       LEFT JOIN manager_application_profiles p ON p.manager_user_id = u.u_id
       WHERE u.u_id = $1 AND u.role = 'manager'`,
      [managerId]
    ),
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
  if (!job || !account) {
    res.status(404).json({ success: false, message: 'Processing job row or assigned Account not found.' });
    return;
  }
  res.json({
    success: true,
    job,
    account,
    managerAnswers: { ...applicationProfile, salaryAnswers, customAnswers },
    submissionMode: setting?.setting_value === 'auto' ? 'auto' : 'manual',
  });
});

router.get('/:id', async (req: NewSchemaAuthRequest, res: Response) => {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isSafeInteger(id) || id <= 0) {
    res.status(400).json({ success: false, message: 'Invalid job ID.' });
    return;
  }
  const scope = jobScope(req.newSchemaUser!, 2);
  let query = `${jobProjection()} WHERE j.j_id = $1`;
  const params: unknown[] = [id];
  if (scope.clause) {
    query += ` AND ${scope.clause}`;
    params.push(...scope.params);
  }
  const job = await queryOne(query, params);
  if (!job) {
    res.status(404).json({ success: false, message: 'Job not found.' });
    return;
  }
  res.json({ success: true, job });
});

router.patch('/:id/status', async (req: NewSchemaAuthRequest, res: Response) => {
  if (req.newSchemaUser?.role !== 'manager') {
    res.status(403).json({ success: false, message: 'Only Managers can update application status.' });
    return;
  }
  const jobId = Number.parseInt(req.params.id, 10);
  const parsed = z.object({
    status: z.enum(['todo', 'did', 'failed']),
    applyRunId: z.string().uuid().optional(),
  }).safeParse(req.body);
  if (!Number.isSafeInteger(jobId) || jobId <= 0 || !parsed.success) {
    res.status(400).json({ success: false, message: 'Provide a valid job status.' });
    return;
  }

  const managerId = req.newSchemaUser.id;
  const updated = await withTransaction(async (tx) => {
    const assignmentResult = await tx.query(
      `SELECT assignment.account_user_id
       FROM job_account_assignments assignment
       JOIN job_list job ON job.j_id = assignment.j_id
       WHERE job.j_id = $1 AND job.u_id = $2`,
      [jobId, managerId]
    );
    const accountId = Number(
      (assignmentResult.rows[0] as { account_user_id: number } | undefined)?.account_user_id
    );
    if (!accountId) {
      if (parsed.data.status === 'did') {
        const existingBid = await tx.query(
          'SELECT 1 FROM bids WHERE j_id = $1 AND manager_user_id = $2 LIMIT 1',
          [jobId, managerId]
        );
        if (existingBid.rows.length) {
          return { notFound: false as const, status: 'did' as const };
        }
      }
      return { notFound: true as const };
    }
    await tx.query(
      'SELECT u_id FROM users WHERE u_id = $1 AND role = \'account\' FOR UPDATE',
      [accountId]
    );
    const jobResult = await tx.query(
      `SELECT job.j_id, job.u_id, job.title, job.company, job.url, job.status,
              assignment.account_user_id
       FROM job_list job
       JOIN job_account_assignments assignment ON assignment.j_id = job.j_id
       WHERE job.j_id = $1 AND job.u_id = $2
       FOR UPDATE OF job`,
      [jobId, managerId]
    );
    const job = jobResult.rows[0] as {
      j_id: number; u_id: number; title: string; company: string; url: string;
      status: string; account_user_id: number;
    } | undefined;
    if (!job) return { notFound: true as const };
    if (job.status === parsed.data.status) {
      return { notFound: false as const, status: parsed.data.status };
    }
    if (parsed.data.status === 'todo') {
      if (job.status !== 'failed') {
        return { conflict: true as const, status: job.status };
      }
      const activeRun = await tx.query(
        `SELECT 1
         WHERE EXISTS (
           SELECT 1 FROM account_apply_runs
           WHERE account_user_id = $1
             AND last_activity_at > NOW() - INTERVAL '24 hours'
         )
         OR EXISTS (
           SELECT 1 FROM job_list active_job
           JOIN job_account_assignments active_assignment
             ON active_assignment.j_id = active_job.j_id
           WHERE active_job.u_id = $2
             AND active_assignment.account_user_id = $1
             AND active_job.status = 'processing'
         )`,
        [accountId, managerId]
      );
      if (activeRun.rows.length) return { busy: true as const };

      await tx.query(
        `UPDATE job_list SET status = 'todo' WHERE j_id = $1 AND u_id = $2`,
        [jobId, managerId]
      );
      await tx.query(
        `DELETE FROM gpt_application_tasks WHERE job_id = $1 AND status = 'failed'`,
        [jobId]
      );
      return { notFound: false as const, status: 'todo' as const };
    }

    if (parsed.data.status === 'did') {
      if (!['processing', 'todo', 'failed'].includes(job.status)) {
        return { conflict: true as const, status: job.status };
      }
      if (job.status === 'processing' && !parsed.data.applyRunId) {
        return { conflict: true as const, status: job.status };
      }
      if (job.status !== 'processing') {
        const activeRun = await tx.query(
          `SELECT 1
           WHERE EXISTS (
             SELECT 1 FROM account_apply_runs
             WHERE account_user_id = $1
               AND last_activity_at > NOW() - INTERVAL '24 hours'
           )
           OR EXISTS (
             SELECT 1 FROM job_list active_job
             JOIN job_account_assignments active_assignment
               ON active_assignment.j_id = active_job.j_id
             WHERE active_job.u_id = $2
               AND active_assignment.account_user_id = $1
               AND active_job.status = 'processing'
           )`,
          [accountId, managerId]
        );
        if (activeRun.rows.length) return { busy: true as const };
      }
      await tx.query(
        `INSERT INTO bids (
           u_id, j_id, manager_user_id, job_title, company, job_url, resume_path
         ) VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (u_id, j_id) DO NOTHING`,
        [
          accountId, job.j_id, managerId, job.title, job.company,
          job.url, `account-profile:${accountId}`,
        ]
      );
      await tx.query(
        `UPDATE gpt_application_tasks
         SET status = 'completed',
             task_context = jsonb_build_object('jobContext', COALESCE(task_context->'jobContext', '{}'::jsonb)),
             resume_text = NULL, resume_text_expires_at = NULL,
             last_activity_at = NOW(), updated_at = NOW()
         WHERE job_id = $1 AND status <> 'failed'`,
        [jobId]
      );
      await tx.query('DELETE FROM job_list WHERE j_id = $1 AND u_id = $2', [jobId, managerId]);
      if (parsed.data.applyRunId) {
        await tx.query(
          `UPDATE account_apply_runs SET last_activity_at = NOW()
           WHERE account_user_id = $1 AND manager_user_id = $2 AND run_id = $3`,
          [accountId, managerId, parsed.data.applyRunId]
        );
      } else {
        await tx.query(
          `DELETE FROM account_apply_runs
           WHERE account_user_id = $1 AND manager_user_id = $2`,
          [accountId, managerId]
        );
      }
      return { notFound: false as const, status: 'did' as const, movedToBids: true as const };
    }

    if (parsed.data.status !== 'failed'
      || (job.status !== 'processing' && job.status !== 'todo')) {
      return { conflict: true as const, status: job.status };
    }
    if (job.status === 'processing' && !parsed.data.applyRunId) {
      return { conflict: true as const, status: job.status };
    }
    if (job.status === 'todo') {
      const activeRun = await tx.query(
        `SELECT 1
         WHERE EXISTS (
           SELECT 1 FROM account_apply_runs
           WHERE account_user_id = $1
             AND last_activity_at > NOW() - INTERVAL '24 hours'
         )
         OR EXISTS (
           SELECT 1 FROM job_list active_job
           JOIN job_account_assignments active_assignment
             ON active_assignment.j_id = active_job.j_id
           WHERE active_job.u_id = $2
             AND active_assignment.account_user_id = $1
             AND active_job.status = 'processing'
         )`,
        [accountId, managerId]
      );
      if (activeRun.rows.length) return { busy: true as const };
    }
    await tx.query(
      `UPDATE job_list SET status = 'failed' WHERE j_id = $1 AND u_id = $2`,
      [jobId, managerId]
    );
    if (parsed.data.applyRunId) {
      await tx.query(
        `UPDATE account_apply_runs SET last_activity_at = NOW()
         WHERE account_user_id = $1 AND manager_user_id = $2 AND run_id = $3`,
        [accountId, managerId, parsed.data.applyRunId]
      );
    } else {
      await tx.query(
        `DELETE FROM account_apply_runs
         WHERE account_user_id = $1 AND manager_user_id = $2`,
        [accountId, managerId]
      );
    }
    await tx.query(
      `UPDATE gpt_application_tasks
       SET status = 'failed',
           task_context = jsonb_build_object('jobContext', COALESCE(task_context->'jobContext', '{}'::jsonb)),
           resume_text = NULL, resume_text_expires_at = NULL,
           last_activity_at = NOW(), updated_at = NOW()
       WHERE job_id = $1 AND status <> 'failed'`,
      [jobId]
    );
    return { notFound: false as const, status: 'failed' as const };
  });
  if (updated.notFound) {
    res.status(404).json({ success: false, message: 'Account-specific job row not found.' });
    return;
  }
  if ('conflict' in updated) {
    res.status(409).json({
      success: false,
      message: `This job row is ${updated.status}; only failed rows can be reset, and only waiting or active rows can be marked failed or applied.`,
      status: updated.status,
    });
    return;
  }
  if ('busy' in updated) {
    res.status(409).json({
      success: false,
      message: 'This Account has an active Apply run. Wait for it to finish before changing this job status.',
    });
    return;
  }
  res.json({ success: true, status: updated.status });
});

router.post('/', async (req: NewSchemaAuthRequest, res: Response) => {
  const user = req.newSchemaUser!;
  if (user.role !== 'manager') {
    res.status(403).json({ success: false, message: 'Only Managers can create jobs.' });
    return;
  }
  const parsed = JobSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, message: 'Enter a valid job URL, company, title, categories, and selected Accounts.' });
    return;
  }
  const data = parsed.data;
  if (!data.selectedAccountUserIds.length) {
    res.status(400).json({ success: false, message: 'Select at least one Account for this job.' });
    return;
  }
  const assignmentError = await validateJobAssignments(
    user.id,
    data.categoryIds,
    data.selectedAccountUserIds
  );
  if (assignmentError) {
    res.status(400).json({ success: false, message: assignmentError });
    return;
  }
  const url = normalizeUrl(data.url);
  const applicationType = applicationTypeForUrl(url);
  const result = await withTransaction((tx) =>
    synchronizeAccountJobRows(
      tx, user.id, url, applicationType, data.company, data.title, data.categoryIds, data.selectedAccountUserIds
    )
  );
  const jobs = await queryAll(
    `${jobProjection()} WHERE j.j_id = ANY($1::int[]) ORDER BY j.j_id`,
    [result.rows.map((row) => row.j_id)]
  );
  const groupedJob = jobs.length
    ? {
      ...jobs[0],
      selected_account_u_ids: jobs.flatMap((job) =>
        Array.isArray(job.selected_account_u_ids) ? job.selected_account_u_ids : []
      ),
      selected_accounts: jobs.flatMap((job) =>
        Array.isArray(job.selected_accounts) ? job.selected_accounts : []
      ),
      job_ids: jobs.map((job) => Number(job.id)),
    }
    : null;
  const message = result.blockedRemovalCount
    ? `${result.blockedRemovalCount} Account row(s) were kept because their status is not todo.`
    : undefined;
  logger.info('New-schema Account-specific job rows synchronized', {
    managerId: user.id,
    url,
    rowCount: jobs.length,
  });
  res.status(201).json({ success: true, job: groupedJob, jobs, message });
});

router.put('/:id', async (req: NewSchemaAuthRequest, res: Response) => {
  const user = req.newSchemaUser!;
  if (user.role !== 'manager') {
    res.status(403).json({ success: false, message: 'Only Managers can edit jobs.' });
    return;
  }
  const id = Number.parseInt(req.params.id, 10);
  const parsed = JobSchema.safeParse(req.body);
  if (!Number.isSafeInteger(id) || id <= 0 || !parsed.success) {
    res.status(400).json({ success: false, message: 'Enter a valid job ID and job details.' });
    return;
  }
  const data = parsed.data;
  if (!data.selectedAccountUserIds.length) {
    res.status(400).json({ success: false, message: 'Select at least one Account for this job.' });
    return;
  }
  const assignmentError = await validateJobAssignments(
    user.id,
    data.categoryIds,
    data.selectedAccountUserIds
  );
  if (assignmentError) {
    res.status(400).json({ success: false, message: assignmentError });
    return;
  }
  const url = normalizeUrl(data.url);
  const applicationType = applicationTypeForUrl(url);
  const source = await queryOne<{ url: string }>(
    'SELECT url FROM job_list WHERE j_id = $1 AND u_id = $2',
    [id, user.id]
  );
  if (!source) {
    res.status(404).json({ success: false, message: 'Job not found in your list.' });
    return;
  }
  const result = await withTransaction(async (tx) => {
    const locked = await tx.query(
      'SELECT j_id FROM job_list WHERE j_id = $1 AND u_id = $2 FOR UPDATE',
      [id, user.id]
    );
    if (!locked.rows.length) return null;
    const targetConflicts = await tx.query(
      `SELECT assignment.account_user_id
       FROM job_list job
       JOIN job_account_assignments assignment ON assignment.j_id = job.j_id
       WHERE job.u_id = $1 AND job.url = $2
         AND NOT (job.url = $3)`,
      [user.id, url, source.url]
    );
    if ((targetConflicts.rows as Array<{ account_user_id: number }>).some((row) =>
      data.selectedAccountUserIds.includes(Number(row.account_user_id))
    )) {
      return { conflict: true as const };
    }
    const synchronized = await synchronizeAccountJobRows(
      tx, user.id, source.url, applicationType, data.company, data.title, data.categoryIds, data.selectedAccountUserIds
    );
    if (source.url !== url) {
      for (const row of synchronized.rows) {
        await tx.query(
          `UPDATE job_list SET url = $1, application_type = $2, company = $3, title = $4, category_ids = $5::int[]
           WHERE j_id = $6 AND u_id = $7`,
          [url, applicationType, data.company, data.title, data.categoryIds, row.j_id, user.id]
        );
      }
    }
    return { synchronized, rows: synchronized.rows.map((row) => row.j_id) };
  });
  if (!result) {
    res.status(404).json({ success: false, message: 'Job not found in your list.' });
    return;
  }
  if ('conflict' in result) {
    res.status(409).json({
      success: false,
      message: 'One or more selected Accounts already have this job URL.',
    });
    return;
  }
  const jobs = await queryAll(
    `${jobProjection()} WHERE j.j_id = ANY($1::int[]) ORDER BY j.j_id`,
    [result.rows]
  );
  const groupedJob = jobs.length
    ? {
      ...jobs[0],
      selected_account_u_ids: jobs.flatMap((job) =>
        Array.isArray(job.selected_account_u_ids) ? job.selected_account_u_ids : []
      ),
      selected_accounts: jobs.flatMap((job) =>
        Array.isArray(job.selected_accounts) ? job.selected_accounts : []
      ),
      job_ids: jobs.map((job) => Number(job.id)),
    }
    : null;
  const message = result.synchronized.blockedRemovalCount
    ? `${result.synchronized.blockedRemovalCount} Account row(s) were kept because their status is not todo.`
    : undefined;
  res.json({ success: true, job: groupedJob, jobs, message });
});

router.delete('/:id', async (req: NewSchemaAuthRequest, res: Response) => {
  const user = req.newSchemaUser!;
  if (user.role !== 'manager') {
    res.status(403).json({ success: false, message: 'Only Managers can delete jobs.' });
    return;
  }
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isSafeInteger(id) || id <= 0) {
    res.status(400).json({ success: false, message: 'Invalid job ID.' });
    return;
  }
  const deleted = await withTransaction(async (tx) => {
    const existing = await tx.query(
      `SELECT job.j_id, job.status, assignment.account_user_id
       FROM job_list job
       LEFT JOIN job_account_assignments assignment ON assignment.j_id = job.j_id
       WHERE job.j_id = $1 AND job.u_id = $2
       FOR UPDATE OF job`,
      [id, user.id]
    );
    if (!existing.rows.length) return null;
    const row = existing.rows[0] as { status: string; account_user_id: number | null };
    if (row.status === 'processing' && row.account_user_id !== null) {
      await tx.query(
        'DELETE FROM account_apply_runs WHERE account_user_id = $1 AND manager_user_id = $2',
        [row.account_user_id, user.id]
      );
    }
    await tx.query('DELETE FROM job_list WHERE j_id = $1 AND u_id = $2', [id, user.id]);
    return { wasProcessing: row.status === 'processing' };
  });

  if (deleted === null) {
    res.status(404).json({ success: false, message: 'Job not found in your list.' });
    return;
  }
  res.json({
    success: true,
    message: deleted.wasProcessing
      ? 'Account-specific job row deleted and its active Apply run released. Close any already-open application tab.'
      : 'Account-specific job row deleted from your job list.',
  });
});

export default router;
