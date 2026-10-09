import { Router, Response } from 'express';
import { z } from 'zod';
import { execute, queryAll, queryOne, withTransaction } from '../../database/connection';
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
  return `SELECT j.j_id AS id, j.u_id AS manager_id, j.url, j.company, j.title,
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
                     'status', COALESCE(attempt.status, 'not_started')
                   ) ORDER BY assignment.position)
                   FROM job_account_assignments assignment
                   JOIN users account ON account.u_id = assignment.account_user_id
                   LEFT JOIN application_attempts attempt
                     ON attempt.j_id = assignment.j_id
                    AND attempt.account_user_id = assignment.account_user_id
                   WHERE assignment.j_id = j.j_id
                 ), '[]'::json) AS selected_accounts,
                 j.status, j.get_date,
                 (SELECT COUNT(*)::int FROM bids b WHERE b.j_id = j.j_id) AS bid_count
          FROM job_list j`;
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
  const [job, bid] = await Promise.all([
    queryOne(`${jobProjection()} WHERE j.u_id = $1 AND j.url = $2`, [user.id, url]),
    queryOne<{ b_id: number }>(
      'SELECT b_id FROM bids WHERE manager_user_id = $1 AND job_url = $2 LIMIT 1',
      [user.id, url]
    ),
  ]);
  res.json({ success: true, alreadyApplied: Boolean(bid), job: job || null });
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
  const duplicate = await queryOne<{ j_id: number }>(
    'SELECT j_id FROM job_list WHERE url = $1',
    [url]
  );
  if (duplicate) {
    res.status(409).json({ success: false, message: 'That job URL has already been added.' });
    return;
  }
  const jobId = await withTransaction(async (tx) => {
    const inserted = await tx.query(
      `INSERT INTO job_list (u_id, url, company, title, category_ids, status)
       VALUES ($1, $2, $3, $4, $5::int[], $6)
       RETURNING j_id`,
      [user.id, url, data.company, data.title, data.categoryIds, data.status ?? 'todo']
    );
    const created = inserted.rows[0] as { j_id: number } | undefined;
    if (!created) throw new Error('Job could not be created.');
    for (const [position, accountId] of data.selectedAccountUserIds.entries()) {
      await tx.query(
        `INSERT INTO job_account_assignments (j_id, account_user_id, position)
         VALUES ($1, $2, $3)`,
        [created.j_id, accountId, position + 1]
      );
    }
    return created.j_id;
  });
  const job = await queryOne(`${jobProjection()} WHERE j.j_id = $1`, [jobId]);
  logger.info('New-schema job created', { id: jobId, managerId: user.id });
  res.status(201).json({ success: true, job });
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
  const duplicate = await queryOne<{ j_id: number }>(
    'SELECT j_id FROM job_list WHERE url = $1 AND j_id <> $2',
    [url, id]
  );
  if (duplicate) {
    res.status(409).json({ success: false, message: 'That job URL has already been added.' });
    return;
  }
  const updated = await withTransaction(async (client) => {
    const locked = await client.query(
      'SELECT j_id FROM job_list WHERE j_id = $1 AND u_id = $2 FOR UPDATE',
      [id, user.id]
    );
    if (!locked.rows.length) return false;
    await client.query(
      `UPDATE job_list SET url = $1, company = $2, title = $3, category_ids = $4::int[],
         status = COALESCE($5, status)
       WHERE j_id = $6 AND u_id = $7`,
      [url, data.company, data.title, data.categoryIds, data.status ?? null, id, user.id]
    );
    await client.query('DELETE FROM job_account_assignments WHERE j_id = $1', [id]);
    for (const [position, accountId] of data.selectedAccountUserIds.entries()) {
      await client.query(
        `INSERT INTO job_account_assignments (j_id, account_user_id, position)
         VALUES ($1, $2, $3)`,
        [id, accountId, position + 1]
      );
    }
    await client.query(
      `UPDATE bids SET job_status = COALESCE($1, job_status)
       WHERE j_id = $2 AND manager_user_id = $3`,
      [data.status ?? null, id, user.id]
    );
    return true;
  });
  if (!updated) {
    res.status(404).json({ success: false, message: 'Job not found in your list.' });
    return;
  }
  const job = await queryOne(`${jobProjection()} WHERE j.j_id = $1`, [id]);
  res.json({ success: true, job });
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
      'SELECT j_id FROM job_list WHERE j_id = $1 AND u_id = $2 FOR UPDATE',
      [id, user.id]
    );
    if (!existing.rows.length) return null;

    const attempts = await tx.query(
      'DELETE FROM application_attempts WHERE j_id = $1 RETURNING attempt_id',
      [id]
    );
    await tx.query('DELETE FROM job_list WHERE j_id = $1 AND u_id = $2', [id, user.id]);
    return attempts.rowCount ?? attempts.rows.length;
  });

  if (deleted === null) {
    res.status(404).json({ success: false, message: 'Job not found in your list.' });
    return;
  }
  res.json({
    success: true,
    message: `Job removed from your active job list. ${deleted} application attempt(s) cleared; Bids and interview history retained.`,
  });
});

export default router;
