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
import { candidateBidderFilter, isAdmin, isBidder, isManager } from '../../middleware/scope';
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
  bidderId: z.number().int().positive().optional().nullable(),
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
       JOIN bidders b ON b.id = c.bidder_id
       WHERE c.id = $1 AND b.manager_id = $2`,
      [id, req.userId]
    );
    return Boolean(row);
  }
  if (!isBidder(req) || !req.bidderId) return false;
  const row = await queryOne<{ id: number }>(
    'SELECT id FROM candidates WHERE id = $1 AND bidder_id = $2',
    [id, req.bidderId]
  );
  return Boolean(row);
}

router.get('/', async (req: AuthRequest, res: Response) => {
  const search = (req.query.search as string) || '';
  const activeOnly = req.query.active === 'true';

  let query = 'SELECT c.*, b.name AS bidder_name FROM candidates c LEFT JOIN bidders b ON b.id = c.bidder_id';
  const params: unknown[] = [];
  const conditions: string[] = [];
  let paramIndex = 1;

  const scope = candidateBidderFilter(req, 'c', paramIndex);
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
    `SELECT c.*, b.name AS bidder_name FROM candidates c
     LEFT JOIN bidders b ON b.id = c.bidder_id WHERE c.id = $1`,
    [id]
  );
  res.json({ success: true, candidate });
});

async function canManageBidder(req: AuthRequest, bidderId: number | null | undefined): Promise<boolean> {
  if (!bidderId) return isAdmin(req);
  if (isAdmin(req)) return true;
  if (isManager(req) && req.userId) {
    const row = await queryOne<{ id: number }>(
      'SELECT id FROM bidders WHERE id = $1 AND manager_id = $2',
      [bidderId, req.userId]
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

  let bidderId: number | null;
  if (isAdmin(req)) {
    bidderId = data.bidderId ?? null;
    if (!bidderId) {
      res.status(400).json({ success: false, message: 'Select a bidder organization for this candidate.' });
      return;
    }
  } else if (isManager(req)) {
    bidderId = data.bidderId ?? null;
    if (!bidderId || !(await canManageBidder(req, bidderId))) {
      res.status(400).json({ success: false, message: 'Select a bidder from your team.' });
      return;
    }
  } else {
    bidderId = req.bidderId ?? null;
    if (!bidderId) {
      res.status(400).json({ success: false, message: 'Bidder account is not linked to an organization.' });
      return;
    }
  }

  const inserted = await queryOne<{ id: number }>(
    `INSERT INTO candidates (name, email, phone, linkedin_url, notes, color, stack, is_active, bidder_id)
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
      bidderId,
    ]
  );
  const candidate = await queryOne('SELECT * FROM candidates WHERE id = $1', [inserted!.id]);
  logger.info('Candidate created', { name: data.name, bidderId });
  res.status(201).json({ success: true, candidate });
});

router.put('/:id', requireAdminOrManagerWrite, async (req: AuthRequest, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (!(await canAccessCandidate(req, id))) {
    res.status(404).json({ success: false, message: 'Candidate not found.' });
    return;
  }
  const existing = await queryOne<{ color?: string | null; bidder_id?: number | null }>(
    'SELECT * FROM candidates WHERE id = $1',
    [req.params.id]
  );
  if (!existing) { res.status(404).json({ success: false, message: 'Candidate not found.' }); return; }
  const data = parseCandidateBody(req.body, res);
  if (!data) return;
  const stack = await resolveCandidateStack(data.stack, res);
  if (stack === undefined) return;
  const color = data.color || existing.color || await pickDefaultColor();

  let bidderId = existing.bidder_id ?? null;
  if (isAdmin(req)) {
    bidderId = data.bidderId ?? bidderId;
    if (!bidderId) {
      res.status(400).json({ success: false, message: 'Select a bidder organization for this candidate.' });
      return;
    }
  } else if (isManager(req)) {
    bidderId = data.bidderId ?? bidderId;
    if (!bidderId || !(await canManageBidder(req, bidderId))) {
      res.status(400).json({ success: false, message: 'Select a bidder from your team.' });
      return;
    }
  }
  await execute(
    `UPDATE candidates
     SET name = $1, email = $2, phone = $3, linkedin_url = $4, notes = $5, color = $6, stack = $7,
         is_active = $8, bidder_id = $9, updated_at = NOW()
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
      bidderId,
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
