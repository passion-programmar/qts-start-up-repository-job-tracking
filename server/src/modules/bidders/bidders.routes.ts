import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { queryAll, queryOne, execute } from '../../database/connection';
import {
  requireAuth,
  requireAdminOrManager,
  AuthRequest,
} from '../../middleware/auth';
import { isAdmin, isManager } from '../../middleware/scope';
import { createAccount, updateAccountPassword, usernameExists } from '../../services/accounts';
import { decryptCredential } from '../../utilities/credential-crypto';
import { logger } from '../../utilities/logger';

const router = Router();
router.use(requireAuth);

async function canAccessBidder(req: AuthRequest, bidderId: number): Promise<boolean> {
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

function requireAdminOrManagerRead(req: AuthRequest, res: Response, next: NextFunction): void {
  if (!isAdmin(req) && !isManager(req)) {
    res.status(403).json({ success: false, message: 'Admin or manager access required.' });
    return;
  }
  next();
}

const BidderSchema = z.object({
  name: z.string().min(1).max(100),
  notes: z.string().optional(),
  isActive: z.boolean().optional().default(true),
  managerId: z.number().int().positive().optional().nullable(),
  password: z.string().min(1).max(200).optional(),
});

const AccountSchema = z.object({
  username: z.string().min(1).max(100),
  password: z.string().min(1).max(200),
  role: z.enum(['bidder', 'caller']),
  bidderId: z.number().int().positive().optional().nullable(),
});

const AccountUpdateSchema = z.object({
  password: z.string().min(1).max(200),
});

function mapAccountRow(row: {
  id: number;
  username: string;
  role: string;
  created_at?: string;
  password_encrypted?: string | null;
}) {
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    created_at: row.created_at,
    password: decryptCredential(row.password_encrypted),
  };
}

async function getPrimaryBidderAccount(bidderId: number) {
  return queryOne<{ id: number; username: string; password_encrypted: string | null }>(
    `SELECT id, username, password_encrypted
     FROM admins
     WHERE bidder_id = $1 AND role = 'bidder'
     ORDER BY id ASC
     LIMIT 1`,
    [bidderId]
  );
}

async function getBidderAccount(bidderId: number, accountId: number) {
  return queryOne<{ id: number; username: string; role: string }>(
    'SELECT id, username, role FROM admins WHERE id = $1 AND bidder_id = $2',
    [accountId, bidderId]
  );
}

router.get('/', requireAdminOrManagerRead, async (req: AuthRequest, res: Response) => {
  const managerFilter = isManager(req) && req.userId ? 'WHERE b.manager_id = $1' : '';
  const params = isManager(req) && req.userId ? [req.userId] : [];
  const bidders = await queryAll(`
    SELECT b.*,
      m.username AS manager_name,
      (SELECT COUNT(*)::int FROM admins a WHERE a.bidder_id = b.id) AS account_count,
      (SELECT COUNT(*)::int FROM candidates c WHERE c.bidder_id = b.id) AS candidate_count
    FROM bidders b
    LEFT JOIN admins m ON m.id = b.manager_id
    ${managerFilter}
    ORDER BY b.name ASC
  `, params);
  res.json({ success: true, bidders });
});

router.get('/:id', requireAdminOrManagerRead, async (req: AuthRequest, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (!(await canAccessBidder(req, id))) {
    res.status(404).json({ success: false, message: 'Bidder not found.' });
    return;
  }
  const bidder = await queryOne(
    `SELECT b.*, m.username AS manager_name
     FROM bidders b
     LEFT JOIN admins m ON m.id = b.manager_id
     WHERE b.id = $1`,
    [id]
  );
  if (!bidder) {
    res.status(404).json({ success: false, message: 'Bidder not found.' });
    return;
  }
  const accounts = await queryAll<{
    id: number;
    username: string;
    role: string;
    created_at: string;
    password_encrypted: string | null;
  }>(
    `SELECT id, username, role, created_at, password_encrypted
     FROM admins WHERE bidder_id = $1 ORDER BY username ASC`,
    [id]
  );
  const candidates = await queryAll(
    `SELECT id, name, email, is_active FROM candidates WHERE bidder_id = $1 ORDER BY name ASC`,
    [id]
  );
  res.json({
    success: true,
    bidder,
    accounts: accounts.map(mapAccountRow),
    candidates,
  });
});

router.post('/', requireAdminOrManager, async (req: AuthRequest, res: Response) => {
  const data = BidderSchema.parse(req.body);
  const managerId = isManager(req) ? (req.userId ?? null) : (data.managerId ?? null);
  const username = data.name.trim();

  if (isManager(req) && !data.password) {
    res.status(400).json({ success: false, message: 'Password is required for the bidder login.' });
    return;
  }

  if (data.password) {
    if (await usernameExists(username)) {
      res.status(409).json({
        success: false,
        message: 'A login with this bidder name already exists. Choose a different name.',
      });
      return;
    }
  }

  const row = await queryOne<{ id: number }>(
    `INSERT INTO bidders (name, notes, is_active, manager_id) VALUES ($1, $2, $3, $4) RETURNING id`,
    [data.name, data.notes || null, data.isActive ?? true, managerId]
  );

  if (data.password) {
    await createAccount({
      username,
      password: data.password,
      role: 'bidder',
      bidderId: row!.id,
    });
  }

  const bidder = await queryOne('SELECT * FROM bidders WHERE id = $1', [row!.id]);
  logger.info('Bidder created', { id: row!.id, name: data.name, managerId, accountCreated: Boolean(data.password) });
  res.status(201).json({ success: true, bidder });
});

router.put('/:id', requireAdminOrManager, async (req: AuthRequest, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (!(await canAccessBidder(req, id))) {
    res.status(404).json({ success: false, message: 'Bidder not found.' });
    return;
  }
  const data = BidderSchema.parse(req.body);
  const managerId = isManager(req) ? (req.userId ?? null) : (data.managerId ?? null);
  await execute(
    `UPDATE bidders SET name = $1, notes = $2, is_active = $3, manager_id = $4, updated_at = NOW() WHERE id = $5`,
    [data.name, data.notes || null, data.isActive ?? true, managerId, id]
  );

  const primaryAccount = await getPrimaryBidderAccount(id);
  if (primaryAccount) {
    if (primaryAccount.username !== data.name.trim()) {
      if (await usernameExists(data.name.trim())) {
        res.status(409).json({
          success: false,
          message: 'A login with this bidder name already exists. Choose a different name.',
        });
        return;
      }
      await execute(
        'UPDATE admins SET username = $1, updated_at = NOW() WHERE id = $2',
        [data.name.trim(), primaryAccount.id]
      );
    }
    if (data.password) {
      await updateAccountPassword(primaryAccount.id, data.password);
    }
  }

  const bidder = await queryOne('SELECT * FROM bidders WHERE id = $1', [id]);
  res.json({ success: true, bidder });
});

router.delete('/:id', requireAdminOrManager, async (req: AuthRequest, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (!(await canAccessBidder(req, id))) {
    res.status(404).json({ success: false, message: 'Bidder not found.' });
    return;
  }
  const existing = await queryOne<{ name: string }>(
    'SELECT name FROM bidders WHERE id = $1',
    [id]
  );
  if (!existing) {
    res.status(404).json({ success: false, message: 'Bidder not found.' });
    return;
  }
  await execute('DELETE FROM admins WHERE bidder_id = $1', [id]);
  await execute('UPDATE candidates SET bidder_id = NULL WHERE bidder_id = $1', [id]);
  await execute('DELETE FROM bidders WHERE id = $1', [id]);
  logger.info('Bidder deleted', { id, name: existing.name });
  res.json({ success: true, message: 'Bidder deleted.' });
});

router.post('/:id/accounts', requireAdminOrManager, async (req: AuthRequest, res: Response) => {
  const bidderId = parseInt(req.params.id, 10);
  if (!(await canAccessBidder(req, bidderId))) {
    res.status(404).json({ success: false, message: 'Bidder not found.' });
    return;
  }

  const data = AccountSchema.parse(req.body);
  const linkedBidderId = data.role === 'bidder' ? (data.bidderId ?? bidderId) : data.bidderId ?? null;

  if (await usernameExists(data.username)) {
    res.status(409).json({ success: false, message: 'Username already exists.' });
    return;
  }

  const row = await createAccount({
    username: data.username,
    password: data.password,
    role: data.role,
    bidderId: linkedBidderId,
  });

  const account = await queryOne(
    'SELECT id, username, role, bidder_id, created_at FROM admins WHERE id = $1',
    [row!.id]
  );
  logger.info('Account created for bidder', { bidderId, username: data.username });
  res.status(201).json({ success: true, account });
});

router.put('/:id/accounts/:accountId', requireAdminOrManager, async (req: AuthRequest, res: Response) => {
  const bidderId = parseInt(req.params.id, 10);
  const accountId = parseInt(req.params.accountId, 10);
  if (!(await canAccessBidder(req, bidderId))) {
    res.status(404).json({ success: false, message: 'Bidder not found.' });
    return;
  }

  const existing = await getBidderAccount(bidderId, accountId);
  if (!existing) {
    res.status(404).json({ success: false, message: 'Account not found.' });
    return;
  }

  const data = AccountUpdateSchema.parse(req.body);
  await updateAccountPassword(accountId, data.password);
  logger.info('Account password updated', { bidderId, accountId, username: existing.username });
  res.json({ success: true, message: 'Password updated.' });
});

router.delete('/:id/accounts/:accountId', requireAdminOrManager, async (req: AuthRequest, res: Response) => {
  const bidderId = parseInt(req.params.id, 10);
  const accountId = parseInt(req.params.accountId, 10);
  if (!(await canAccessBidder(req, bidderId))) {
    res.status(404).json({ success: false, message: 'Bidder not found.' });
    return;
  }

  const existing = await getBidderAccount(bidderId, accountId);
  if (!existing) {
    res.status(404).json({ success: false, message: 'Account not found.' });
    return;
  }

  await execute('DELETE FROM admins WHERE id = $1', [accountId]);
  logger.info('Account deleted for bidder', { bidderId, accountId, username: existing.username });
  res.json({ success: true, message: 'Account deleted.' });
});

export default router;
