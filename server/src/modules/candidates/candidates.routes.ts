import { Router, Response } from 'express';
import { z } from 'zod';
import { queryAll, queryOne, execute } from '../../database/connection';
import {
  isCandidateColor,
  nextCandidateColor,
} from '../../config/candidate-colors';
import { resolveCanonicalStack } from '../../config/candidate-stacks';
import {
  requireAuth,
  requireAdminWrite,
  requireAdminOrManagerWrite,
  AuthRequest,
} from '../../middleware/auth';
import { candidateAccountFilter, isAdmin, isAccount, isManager } from '../../middleware/scope';
import { logger } from '../../utilities/logger';

const router = Router();
router.use(requireAuth);

const optionalEmail = z.union([z.literal(''), z.string().email()]).optional();

const CandidateSchema = z.object({
  name: z.string().min(1).max(200),
  email: optionalEmail,
  phone: z.string().max(50).optional(),
  linkedinUrl: z.union([z.literal(''), z.string().url()]).optional(),
  notes: z.string().optional(),
  color: z.string().optional().or(z.literal('')).refine(
    (value) => !value || isCandidateColor(value),
    { message: 'Color must be one of the allowed palette values' }
  ),
  stack: z.union([z.literal(''), z.string().max(100)]).optional(),
  isActive: z.boolean().optional().default(true),
  accountId: z.number().int().positive().optional().nullable(),
});

async function pickDefaultColor(): Promise<string> {
  const row = await queryOne<{ count: string }>('SELECT COUNT(*)::int AS count FROM candidates');
  return nextCandidateColor(Number(row?.count ?? 0));
}

function parseCandidateBody(body: unknown, res: Response) {
  const parsed = CandidateSchema.safeParse(body);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      message: 'Validation error.',
      errors: parsed.error.errors.map((e) => ({
        field: e.path.join('.'),
        message: e.message,
      })),
    });
    return null;
  }
  return parsed.data;
}

async function resolveCandidateStack(
  stack: string | undefined,
  res: Response
): Promise<string | null | undefined> {
  if (!stack?.trim()) return null;
  const canonical = await resolveCanonicalStack(stack);
  if (!canonical) {
    res.status(400).json({
      success: false,
      message: 'Invalid stack option. Add it under Settings → Candidate Stacks and save first.',
    });
    return undefined;
  }
  return canonical;
}

async function canAccessCandidate(req: AuthRequest, id: number): Promise<boolean> {
  if (isAdmin(req)) return true;
  if (isManager(req) && req.userId) {
    const row = await queryOne<{ id: number }>(
      `SELECT c.id FROM candidates c
       JOIN accounts b ON b.id = c.account_id
       WHERE c.id = $1 AND b.manager_id = $2`,
      [id, req.userId]
    );
    return Boolean(row);
  }
  if (!isAccount(req) || !req.accountId) return false;
  const row = await queryOne<{ id: number }>(
    'SELECT id FROM candidates WHERE id = $1 AND account_id = $2',
    [id, req.accountId]
  );
  return Boolean(row);
}

router.get('/', async (req: AuthRequest, res: Response) => {
  const search = (req.query.search as string) || '';
  const activeOnly = req.query.active === 'true';
  const minimal = req.query.minimal === 'true';
  const accountIdFilter = Number(req.query.accountId || 0);

  const selectColumns = minimal
    ? 'c.id, c.name, c.account_id, c.is_active, c.stack, c.color'
    : 'c.*';

  let query = `SELECT ${selectColumns}, b.name AS account_name FROM candidates c LEFT JOIN accounts b ON b.id = c.account_id`;
  const params: unknown[] = [];
  const conditions: string[] = [];
  let paramIndex = 1;

  const scope = candidateAccountFilter(req, 'c', paramIndex);
  if (scope.clause) {
    conditions.push(scope.clause);
    params.push(...scope.params);
    paramIndex = scope.nextIndex;
  }

  if (search) {
    const placeholder = `$${paramIndex++}`;
    conditions.push(`(c.name ILIKE ${placeholder} OR c.email ILIKE ${placeholder} OR c.notes ILIKE ${placeholder})`);
    params.push(`%${search}%`);
  }
  if (activeOnly) {
    conditions.push('c.is_active = TRUE');
  }
  if (Number.isFinite(accountIdFilter) && accountIdFilter > 0 && isAdmin(req)) {
    conditions.push(`c.account_id = $${paramIndex++}`);
    params.push(accountIdFilter);
  }
  if (conditions.length) query += ' WHERE ' + conditions.join(' AND ');
  query += ' ORDER BY c.name ASC';

  const candidates = await queryAll(query, params);
  res.json({ success: true, candidates });
});

router.get('/:id', async (req: AuthRequest, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (!(await canAccessCandidate(req, id))) {
    res.status(404).json({ success: false, message: 'Candidate not found.' });
    return;
  }
  const candidate = await queryOne(
    `SELECT c.*, b.name AS account_name FROM candidates c
     LEFT JOIN accounts b ON b.id = c.account_id WHERE c.id = $1`,
    [id]
  );
  res.json({ success: true, candidate });
});

async function canManageAccount(req: AuthRequest, accountId: number | null | undefined): Promise<boolean> {
  if (!accountId) return isAdmin(req);
  if (isAdmin(req)) return true;
  if (isManager(req) && req.userId) {
    const row = await queryOne<{ id: number }>(
      'SELECT id FROM accounts WHERE id = $1 AND manager_id = $2',
      [accountId, req.userId]
    );
    return Boolean(row);
  }
  return false;
}

router.post('/', requireAdminOrManagerWrite, async (req: AuthRequest, res: Response) => {
  const data = parseCandidateBody(req.body, res);
  if (!data) return;
  const stack = await resolveCandidateStack(data.stack, res);
  if (stack === undefined) return;
  const color = data.color || await pickDefaultColor();

  let accountId: number | null;
  if (isAdmin(req)) {
    accountId = data.accountId ?? null;
    if (!accountId) {
      res.status(400).json({ success: false, message: 'Select an Account team for this candidate.' });
      return;
    }
  } else if (isManager(req)) {
    accountId = data.accountId ?? null;
    if (!accountId || !(await canManageAccount(req, accountId))) {
      res.status(400).json({ success: false, message: 'Select an Account team.' });
      return;
    }
  } else {
    accountId = req.accountId ?? null;
    if (!accountId) {
      res.status(400).json({ success: false, message: 'This Account login is not linked to an Account team.' });
      return;
    }
  }

  const inserted = await queryOne<{ id: number }>(
    `INSERT INTO candidates (name, email, phone, linkedin_url, notes, color, stack, is_active, account_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id`,
    [
      data.name,
      data.email || null,
      data.phone || null,
      data.linkedinUrl || null,
      data.notes || null,
      color,
      stack,
      data.isActive ?? true,
      accountId,
    ]
  );
  const candidate = await queryOne('SELECT * FROM candidates WHERE id = $1', [inserted!.id]);
  logger.info('Candidate created', { name: data.name, accountId });
  res.status(201).json({ success: true, candidate });
});

router.put('/:id', requireAdminOrManagerWrite, async (req: AuthRequest, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (!(await canAccessCandidate(req, id))) {
    res.status(404).json({ success: false, message: 'Candidate not found.' });
    return;
  }
  const existing = await queryOne<{ color?: string | null; account_id?: number | null }>(
    'SELECT * FROM candidates WHERE id = $1',
    [req.params.id]
  );
  if (!existing) { res.status(404).json({ success: false, message: 'Candidate not found.' }); return; }
  const data = parseCandidateBody(req.body, res);
  if (!data) return;
  const stack = await resolveCandidateStack(data.stack, res);
  if (stack === undefined) return;
  const color = data.color || existing.color || await pickDefaultColor();

  let accountId = existing.account_id ?? null;
  if (isAdmin(req)) {
    accountId = data.accountId ?? accountId;
    if (!accountId) {
      res.status(400).json({ success: false, message: 'Select an Account team for this candidate.' });
      return;
    }
  } else if (isManager(req)) {
    accountId = data.accountId ?? accountId;
    if (!accountId || !(await canManageAccount(req, accountId))) {
      res.status(400).json({ success: false, message: 'Select an Account team.' });
      return;
    }
  }
  await execute(
    `UPDATE candidates
     SET name = $1, email = $2, phone = $3, linkedin_url = $4, notes = $5, color = $6, stack = $7,
         is_active = $8, account_id = $9, updated_at = NOW()
     WHERE id = $10`,
    [
      data.name,
      data.email || null,
      data.phone || null,
      data.linkedinUrl || null,
      data.notes || null,
      color,
      stack,
      data.isActive ?? true,
      accountId,
      req.params.id,
    ]
  );
  const candidate = await queryOne('SELECT * FROM candidates WHERE id = $1', [req.params.id]);
  logger.info('Candidate updated', { id: req.params.id });
  res.json({ success: true, candidate });
});

router.patch('/:id/status', requireAdminOrManagerWrite, async (req: AuthRequest, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (!(await canAccessCandidate(req, id))) {
    res.status(404).json({ success: false, message: 'Candidate not found.' });
    return;
  }
  const existing = await queryOne('SELECT * FROM candidates WHERE id = $1', [req.params.id]);
  if (!existing) { res.status(404).json({ success: false, message: 'Candidate not found.' }); return; }
  const { isActive } = z.object({ isActive: z.boolean() }).parse(req.body);
  await execute(
    'UPDATE candidates SET is_active = $1, updated_at = NOW() WHERE id = $2',
    [isActive, req.params.id]
  );
  res.json({ success: true, message: `Candidate ${isActive ? 'activated' : 'deactivated'}.` });
});

router.delete('/:id', requireAdminOrManagerWrite, async (req: AuthRequest, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (!(await canAccessCandidate(req, id))) {
    res.status(404).json({ success: false, message: 'Candidate not found.' });
    return;
  }
  const existing = await queryOne<{ name: string }>(
    'SELECT name FROM candidates WHERE id = $1',
    [req.params.id]
  );
  if (!existing) { res.status(404).json({ success: false, message: 'Candidate not found.' }); return; }
  await execute('DELETE FROM candidates WHERE id = $1', [req.params.id]);
  logger.info('Candidate deleted', { id: req.params.id, name: existing.name });
  res.json({ success: true, message: 'Candidate deleted.' });
});

router.get('/:id/jobs', async (req: AuthRequest, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (!(await canAccessCandidate(req, id))) {
    res.status(404).json({ success: false, message: 'Candidate not found.' });
    return;
  }
  const rows = await queryAll(
    `SELECT j.*, cj.status, cj.applied_at
     FROM candidate_jobs cj
     JOIN jobs j ON j.id = cj.job_id
     WHERE cj.candidate_id = $1
     ORDER BY cj.updated_at DESC`,
    [id]
  );
  res.json({ success: true, jobs: rows });
});

export default router;
