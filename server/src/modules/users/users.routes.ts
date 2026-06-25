import { Router, Response } from 'express';
import { z } from 'zod';
import { queryAll, queryOne, execute } from '../../database/connection';
import { requireAuth, requireAdmin, AuthRequest } from '../../middleware/auth';
import { createAccount, updateAccountPassword, usernameExists } from '../../services/accounts';
import { decryptCredential } from '../../utilities/credential-crypto';
import { logger } from '../../utilities/logger';

const router = Router();
router.use(requireAuth, requireAdmin);

const UserSchema = z.object({
  username: z.string().min(1).max(100),
  password: z.string().min(1).max(200).optional(),
  role: z.enum(['admin', 'manager', 'bidder', 'caller']),
  bidderId: z.number().int().positive().optional().nullable(),
  isActive: z.boolean().optional(),
});

router.get('/', async (req: AuthRequest, res: Response) => {
  const roleFilter = req.query.role as string | undefined;
  let query = `
    SELECT a.id, a.username, a.role, a.bidder_id, a.is_active, a.created_at, b.name AS bidder_name
    FROM admins a
    LEFT JOIN bidders b ON b.id = a.bidder_id`;
  const params: unknown[] = [];
  if (roleFilter) {
    query += ' WHERE a.role = $1';
    params.push(roleFilter);
  }
  query += ' ORDER BY a.username ASC';
  const users = await queryAll(query, params);
  res.json({ success: true, users });
});

router.get('/:id', async (req: AuthRequest, res: Response) => {
  const user = await queryOne<{
    id: number;
    username: string;
    role: string;
    bidder_id: number | null;
    created_at: string;
    bidder_name: string | null;
    is_active: boolean;
    password_encrypted: string | null;
  }>(
    `SELECT a.id, a.username, a.role, a.bidder_id, a.is_active, a.created_at, b.name AS bidder_name, a.password_encrypted
     FROM admins a
     LEFT JOIN bidders b ON b.id = a.bidder_id
     WHERE a.id = $1`,
    [req.params.id]
  );
  if (!user) {
    res.status(404).json({ success: false, message: 'User not found.' });
    return;
  }
  res.json({
    success: true,
    user: {
      id: user.id,
      username: user.username,
      role: user.role,
      bidder_id: user.bidder_id,
      bidder_name: user.bidder_name,
      created_at: user.created_at,
      is_active: user.is_active,
      password: decryptCredential(user.password_encrypted),
    },
  });
});

router.post('/', async (req: AuthRequest, res: Response) => {
  const data = UserSchema.parse(req.body);
  if (!data.password) {
    res.status(400).json({ success: false, message: 'Password is required for new accounts.' });
    return;
  }
  if (data.role === 'bidder' && !data.bidderId) {
    res.status(400).json({
      success: false,
      message: 'Bidder accounts must be linked to a bidder organization.',
    });
    return;
  }
  if (await usernameExists(data.username)) {
    res.status(409).json({ success: false, message: 'Username already exists.' });
    return;
  }

  const row = await createAccount({
    username: data.username,
    password: data.password,
    role: data.role,
    bidderId: data.bidderId ?? null,
    isActive: data.isActive ?? true,
  });

  const user = await queryOne(
    `SELECT a.id, a.username, a.role, a.bidder_id, a.is_active, a.created_at, b.name AS bidder_name
     FROM admins a LEFT JOIN bidders b ON b.id = a.bidder_id WHERE a.id = $1`,
    [row!.id]
  );
  logger.info('User account created', { username: data.username, role: data.role });
  res.status(201).json({ success: true, user });
});

router.put('/:id', async (req: AuthRequest, res: Response) => {
  const existing = await queryOne<{ id: number }>('SELECT id FROM admins WHERE id = $1', [req.params.id]);
  if (!existing) {
    res.status(404).json({ success: false, message: 'User not found.' });
    return;
  }
  const data = UserSchema.parse(req.body);
  if (data.role === 'bidder' && !data.bidderId) {
    res.status(400).json({
      success: false,
      message: 'Bidder accounts must be linked to a bidder organization.',
    });
    return;
  }
  const fields: string[] = ['role = $1', 'bidder_id = $2', 'updated_at = NOW()'];
  const params: unknown[] = [data.role, data.bidderId ?? null];
  if (data.isActive !== undefined) {
    fields.push(`is_active = $${params.length + 1}`);
    params.push(data.isActive);
  }
  if (data.password) {
    await updateAccountPassword(parseInt(req.params.id, 10), data.password);
  }
  params.push(req.params.id);
  await execute(`UPDATE admins SET ${fields.join(', ')} WHERE id = $${params.length}`, params);
  const user = await queryOne(
    `SELECT a.id, a.username, a.role, a.bidder_id, a.is_active, a.created_at, b.name AS bidder_name
     FROM admins a LEFT JOIN bidders b ON b.id = a.bidder_id WHERE a.id = $1`,
    [req.params.id]
  );
  res.json({ success: true, user });
});

router.delete('/:id', async (req: AuthRequest, res: Response) => {
  if (req.userId === parseInt(req.params.id, 10)) {
    res.status(400).json({ success: false, message: 'You cannot delete your own account.' });
    return;
  }
  const existing = await queryOne<{ username: string }>(
    'SELECT username FROM admins WHERE id = $1',
    [req.params.id]
  );
  if (!existing) {
    res.status(404).json({ success: false, message: 'User not found.' });
    return;
  }
  await execute('DELETE FROM admins WHERE id = $1', [req.params.id]);
  logger.info('User deleted', { id: req.params.id, username: existing.username });
  res.json({ success: true, message: 'User deleted.' });
});

export default router;
