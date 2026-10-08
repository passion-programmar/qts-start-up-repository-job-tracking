import { Router, Response } from 'express';
import { z } from 'zod';
import { execute, queryAll, queryOne } from '../../database/connection';
import {
  NewSchemaAuthRequest,
  requireNewSchemaAuth,
  requireNewSchemaPasswordChanged,
} from '../../middleware/new-schema-auth';
import { normalizeUrl } from '../../utilities/normalize-url';
import { logger } from '../../utilities/logger';

const router = Router();
router.use(requireNewSchemaAuth, requireNewSchemaPasswordChanged);

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
                 j.category_ids, j.selected_account_u_ids, j.status, j.get_date,
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
  const row = await queryOne<{ j_id: number }>(
    `INSERT INTO job_list (u_id, url, company, title, category_ids, selected_account_u_ids, status)
     VALUES ($1, $2, $3, $4, $5::int[], $6::int[], $7)
     RETURNING j_id`,
    [
      user.id, url, data.company, data.title, data.categoryIds,
      data.selectedAccountUserIds, data.status ?? 'todo',
    ]
  );
  const job = await queryOne(`${jobProjection()} WHERE j.j_id = $1`, [row!.j_id]);
  logger.info('New-schema job created', { id: row!.j_id, managerId: user.id });
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
  const existing = await queryOne<{ j_id: number }>(
    'SELECT j_id FROM job_list WHERE j_id = $1 AND u_id = $2',
    [id, user.id]
  );
  if (!existing) {
    res.status(404).json({ success: false, message: 'Job not found in your list.' });
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
  const duplicate = await queryOne<{ j_id: number }>(
    'SELECT j_id FROM job_list WHERE url = $1 AND j_id <> $2',
    [url, id]
  );
  if (duplicate) {
    res.status(409).json({ success: false, message: 'That job URL has already been added.' });
    return;
  }
  await execute(
    `UPDATE job_list SET url = $1, company = $2, title = $3, category_ids = $4::int[],
       selected_account_u_ids = $5::int[], status = COALESCE($6, status)
     WHERE j_id = $7 AND u_id = $8`,
    [
      url, data.company, data.title, data.categoryIds,
      data.selectedAccountUserIds, data.status ?? null, id, user.id,
    ]
  );
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
  const existing = await queryOne<{ j_id: number }>(
    'SELECT j_id FROM job_list WHERE j_id = $1 AND u_id = $2',
    [id, user.id]
  );
  if (!existing) {
    res.status(404).json({ success: false, message: 'Job not found in your list.' });
    return;
  }
  const bids = await queryOne<{ count: number }>(
    'SELECT COUNT(*)::int AS count FROM bids WHERE j_id = $1',
    [id]
  );
  if (Number(bids?.count ?? 0) > 0) {
    res.status(409).json({ success: false, message: 'This job has bid history and cannot be deleted.' });
    return;
  }
  await execute('DELETE FROM job_list WHERE j_id = $1 AND u_id = $2', [id, user.id]);
  res.json({ success: true, message: 'Job deleted.' });
});

export default router;
