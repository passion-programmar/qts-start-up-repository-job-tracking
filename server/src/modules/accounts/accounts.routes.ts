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
import { validateCustomGptUrl } from '../../utilities/custom-gpt-url';

const router = Router();
router.use(requireAuth);

async function canAccessAccount(req: AuthRequest, accountId: number): Promise<boolean> {
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

function requireAdminOrManagerRead(req: AuthRequest, res: Response, next: NextFunction): void {
  if (!isAdmin(req) && !isManager(req)) {
    res.status(403).json({ success: false, message: 'Admin or manager access required.' });
    return;
  }
  next();
}

function requireSuperOrManager(req: AuthRequest, res: Response, next: NextFunction): void {
  if (req.role === 'admin') {
    res.status(403).json({ success: false, message: 'Only Super or the assigned Manager can manage Accounts.' });
    return;
  }
  requireAdminOrManager(req, res, next);
}

const AccountTeamSchema = z.object({
  name: z.string().min(1).max(100),
  notes: z.string().optional(),
  isActive: z.boolean().optional().default(true),
  managerId: z.number().int().positive().optional().nullable(),
  password: z.string().min(1).max(200).optional(),
  customGptUrl: z.string().max(500).optional().nullable(),
});

function normalizeCustomGptUrlInput(value: string | null | undefined): string | null {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return null;
  const validated = validateCustomGptUrl(trimmed);
  if (!validated.ok) {
    throw new Error(validated.message);
  }
  return validated.url;
}

const AccountLoginSchema = z.object({
  username: z.string().min(1).max(100),
  password: z.string().min(1).max(200),
  role: z.enum(['account', 'caller']),
  accountId: z.number().int().positive().optional().nullable(),
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
    password: row.role === 'account' ? null : decryptCredential(row.password_encrypted),
  };
}

async function getPrimaryAccountLogin(accountId: number) {
  return queryOne<{ id: number; username: string; password_encrypted: string | null }>(
    `SELECT id, username, password_encrypted
     FROM admins
     WHERE account_id = $1 AND role = 'account'
     ORDER BY id ASC
     LIMIT 1`,
    [accountId]
  );
}

async function getAccountLogin(userId: number, accountId: number) {
  return queryOne<{ id: number; username: string; role: string }>(
    'SELECT id, username, role FROM admins WHERE id = $1 AND account_id = $2',
    [userId, accountId]
  );
}

router.get('/', requireAdminOrManagerRead, async (req: AuthRequest, res: Response) => {
  const managerFilter = isManager(req) && req.userId ? 'WHERE b.manager_id = $1' : '';
  const params = isManager(req) && req.userId ? [req.userId] : [];
  const accounts = await queryAll(`
    SELECT b.*,
      m.username AS manager_name,
      COALESCE(ac.account_count, 0)::int AS account_count,
      COALESCE(cc.candidate_count, 0)::int AS candidate_count
    FROM accounts b
    LEFT JOIN admins m ON m.id = b.manager_id
    LEFT JOIN (
      SELECT account_id, COUNT(*)::int AS account_count
      FROM admins
      WHERE account_id IS NOT NULL
      GROUP BY account_id
    ) ac ON ac.account_id = b.id
    LEFT JOIN (
      SELECT account_id, COUNT(*)::int AS candidate_count
      FROM candidates
      WHERE account_id IS NOT NULL
      GROUP BY account_id
    ) cc ON cc.account_id = b.id
    ${managerFilter}
    ORDER BY b.name ASC
  `, params);
  res.json({ success: true, accounts });
});

router.get('/:id', requireAdminOrManagerRead, async (req: AuthRequest, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (!(await canAccessAccount(req, id))) {
    res.status(404).json({ success: false, message: 'Account not found.' });
    return;
  }
  const account = await queryOne(
    `SELECT b.*, m.username AS manager_name
     FROM accounts b
     LEFT JOIN admins m ON m.id = b.manager_id
     WHERE b.id = $1`,
    [id]
  );
  if (!account) {
    res.status(404).json({ success: false, message: 'Account not found.' });
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
     FROM admins WHERE account_id = $1 ORDER BY username ASC`,
    [id]
  );
  const candidates = await queryAll(
    `SELECT id, name, email, is_active FROM candidates WHERE account_id = $1 ORDER BY name ASC`,
    [id]
  );
  res.json({
    success: true,
    account,
    accounts: accounts.map(mapAccountRow),
    candidates,
  });
});

router.post('/', requireSuperOrManager, async (req: AuthRequest, res: Response) => {
  const data = AccountTeamSchema.parse(req.body);
  const managerId = isManager(req) ? (req.userId ?? null) : (data.managerId ?? null);
  const username = data.name.trim();
  let customGptUrl: string | null = null;
  try {
    customGptUrl = normalizeCustomGptUrlInput(data.customGptUrl);
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error instanceof Error ? error.message : 'Invalid Custom GPT URL.',
    });
    return;
  }

  if (isManager(req) && !data.password) {
    res.status(400).json({ success: false, message: 'Password is required for the account login.' });
    return;
  }

  if (data.password) {
    if (await usernameExists(username)) {
      res.status(409).json({
        success: false,
        message: 'A login with this account name already exists. Choose a different name.',
      });
      return;
    }
  }

  const row = await queryOne<{ id: number }>(
    `INSERT INTO accounts (name, notes, is_active, manager_id, custom_gpt_url) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [data.name, data.notes || null, data.isActive ?? true, managerId, customGptUrl]
  );

  if (data.password) {
    await createAccount({
      username,
      password: data.password,
      role: 'account',
      accountId: row!.id,
    });
  }

  const account = await queryOne('SELECT * FROM accounts WHERE id = $1', [row!.id]);
  logger.info('Account created', { id: row!.id, name: data.name, managerId, accountCreated: Boolean(data.password) });
  res.status(201).json({ success: true, account });
});

router.put('/:id', requireSuperOrManager, async (req: AuthRequest, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (!(await canAccessAccount(req, id))) {
    res.status(404).json({ success: false, message: 'Account not found.' });
    return;
  }
  const data = AccountTeamSchema.parse(req.body);
  if (data.password) {
    res.status(403).json({ success: false, message: 'Account passwords cannot be reset from this screen.' });
    return;
  }
  const managerId = isManager(req) ? (req.userId ?? null) : (data.managerId ?? null);
  let customGptUrl: string | null = null;
  try {
    customGptUrl = normalizeCustomGptUrlInput(data.customGptUrl);
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error instanceof Error ? error.message : 'Invalid Custom GPT URL.',
    });
    return;
  }
  await execute(
    `UPDATE accounts SET name = $1, notes = $2, is_active = $3, manager_id = $4, custom_gpt_url = $5, updated_at = NOW() WHERE id = $6`,
    [data.name, data.notes || null, data.isActive ?? true, managerId, customGptUrl, id]
  );

  const primaryAccount = await getPrimaryAccountLogin(id);
  if (primaryAccount) {
    if (primaryAccount.username !== data.name.trim()) {
      if (await usernameExists(data.name.trim())) {
        res.status(409).json({
          success: false,
          message: 'A login with this account name already exists. Choose a different name.',
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

  const account = await queryOne('SELECT * FROM accounts WHERE id = $1', [id]);
  res.json({ success: true, account });
});

router.delete('/:id', requireSuperOrManager, async (req: AuthRequest, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (!(await canAccessAccount(req, id))) {
    res.status(404).json({ success: false, message: 'Account not found.' });
    return;
  }
  const existing = await queryOne<{ name: string }>(
    'SELECT name FROM accounts WHERE id = $1',
    [id]
  );
  if (!existing) {
    res.status(404).json({ success: false, message: 'Account not found.' });
    return;
  }
  await execute('DELETE FROM admins WHERE account_id = $1', [id]);
  await execute('UPDATE candidates SET account_id = NULL WHERE account_id = $1', [id]);
  await execute('DELETE FROM accounts WHERE id = $1', [id]);
  logger.info('Account deleted', { id, name: existing.name });
  res.json({ success: true, message: 'Account deleted.' });
});

router.post('/:id/logins', requireSuperOrManager, async (req: AuthRequest, res: Response) => {
  const accountId = parseInt(req.params.id, 10);
  if (!(await canAccessAccount(req, accountId))) {
    res.status(404).json({ success: false, message: 'Account not found.' });
    return;
  }

  const data = AccountLoginSchema.parse(req.body);
  if (req.role === 'manager' && data.role !== 'account') {
    res.status(403).json({ success: false, message: 'Managers can create Account logins only.' });
    return;
  }
  const linkedAccountId = data.role === 'account' ? (data.accountId ?? accountId) : data.accountId ?? null;

  if (await usernameExists(data.username)) {
    res.status(409).json({ success: false, message: 'Username already exists.' });
    return;
  }

  const row = await createAccount({
    username: data.username,
    password: data.password,
    role: data.role,
    accountId: linkedAccountId,
  });

  const account = await queryOne(
    'SELECT id, username, role, account_id, created_at FROM admins WHERE id = $1',
    [row!.id]
  );
  logger.info('Account created for account', { accountId, username: data.username });
  res.status(201).json({ success: true, account });
});

router.put('/:id/logins/:loginId', requireSuperOrManager, async (req: AuthRequest, res: Response) => {
  const accountId = parseInt(req.params.id, 10);
  const loginId = parseInt(req.params.loginId, 10);
  if (!(await canAccessAccount(req, accountId))) {
    res.status(404).json({ success: false, message: 'Account not found.' });
    return;
  }

  const existing = await getAccountLogin(loginId, accountId);
  if (!existing) {
    res.status(404).json({ success: false, message: 'Account login not found.' });
    return;
  }
  if (req.role === 'manager' && existing.role !== 'account') {
    res.status(403).json({ success: false, message: 'Managers can manage Account logins only.' });
    return;
  }
  if (existing.role === 'account') {
    res.status(403).json({ success: false, message: 'Account passwords cannot be reset from this screen.' });
    return;
  }

  const data = AccountUpdateSchema.parse(req.body);
  await updateAccountPassword(loginId, data.password);
  logger.info('Account password updated', { accountId, loginId, username: existing.username });
  res.json({ success: true, message: 'Password updated.' });
});

router.delete('/:id/logins/:loginId', requireSuperOrManager, async (req: AuthRequest, res: Response) => {
  const accountId = parseInt(req.params.id, 10);
  const loginId = parseInt(req.params.loginId, 10);
  if (!(await canAccessAccount(req, accountId))) {
    res.status(404).json({ success: false, message: 'Account not found.' });
    return;
  }

  const existing = await getAccountLogin(loginId, accountId);
  if (!existing) {
    res.status(404).json({ success: false, message: 'Account login not found.' });
    return;
  }
  if (req.role === 'manager' && existing.role !== 'account') {
    res.status(403).json({ success: false, message: 'Managers can manage Account logins only.' });
    return;
  }

  await execute('DELETE FROM admins WHERE id = $1', [loginId]);
  logger.info('Account login deleted', { accountId, loginId, username: existing.username });
  res.json({ success: true, message: 'Account login deleted.' });
});

export default router;
