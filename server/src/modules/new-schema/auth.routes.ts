import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { execute, queryOne } from '../../database/connection';
import { config } from '../../config/env';
import { requireNewSchemaAuth, NewSchemaAuthRequest } from '../../middleware/new-schema-auth';
import { logger } from '../../utilities/logger';

const router = Router();

const LoginSchema = z.object({
  username: z.string().trim().min(1).max(100),
  password: z.string().min(1).max(200),
});

const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(8).max(200),
});

const UpdateProfileSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  username: z.string().trim().min(1).max(100),
  name: z.string().trim().min(1).max(200),
  newPassword: z.string().min(8).max(200).optional(),
});

function createToken(user: {
  u_id: number;
  username: string;
  role: string;
  must_change_password: boolean;
}): string {
  return jwt.sign(
    {
      schema: 'new',
      id: user.u_id,
      username: user.username,
      role: user.role,
      mustChangePassword: user.must_change_password,
    },
    config.jwtSecret,
    { expiresIn: config.jwtExpiry } as jwt.SignOptions
  );
}

router.post('/login', async (req: Request, res: Response) => {
  const parsed = LoginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, message: 'Username and password are required.' });
    return;
  }

  const user = await queryOne<{
    u_id: number;
    username: string;
    role: string;
    password_hash: string | null;
    must_change_password: boolean;
    blocked: boolean;
  }>(
    `WITH RECURSIVE user_tree AS (
       SELECT u_id, parent_user_id, blocked_date
       FROM users
       WHERE username = $1
       UNION
       SELECT parent.u_id, parent.parent_user_id, parent.blocked_date
       FROM users parent
       JOIN user_tree child ON child.parent_user_id = parent.u_id
     )
     SELECT u.u_id, u.username, u.role, u.password_hash, u.must_change_password,
            EXISTS (SELECT 1 FROM user_tree WHERE blocked_date IS NOT NULL) AS blocked
     FROM users u
     WHERE u.username = $1`,
    [parsed.data.username]
  );

  if (!user || user.role === 'account' || !user.password_hash || user.blocked ||
      !(await bcrypt.compare(parsed.data.password, user.password_hash))) {
    logger.warn('New-schema login failed', { username: parsed.data.username });
    res.status(401).json({ success: false, message: 'Invalid credentials or unavailable account.' });
    return;
  }

  const token = createToken(user);
  const decoded = jwt.decode(token) as { exp?: number } | null;
  logger.info('New-schema login success', { username: user.username, role: user.role });
  res.json({
    success: true,
    token,
    expiresAt: decoded?.exp ? decoded.exp * 1000 : Date.now() + 24 * 60 * 60 * 1000,
    id: user.u_id,
    username: user.username,
    role: user.role,
    mustChangePassword: user.must_change_password,
  });
});

router.get('/me', requireNewSchemaAuth, (req: NewSchemaAuthRequest, res: Response) => {
  const user = req.newSchemaUser!;
  res.json({
    success: true,
    id: user.id,
    username: user.username,
    name: user.name,
    role: user.role,
    parentUserId: user.parentUserId,
    mustChangePassword: user.mustChangePassword,
  });
});

router.post('/logout', requireNewSchemaAuth, (_req: NewSchemaAuthRequest, res: Response) => {
  res.json({ success: true, message: 'Logged out.' });
});

router.put('/change-password', requireNewSchemaAuth, async (req: NewSchemaAuthRequest, res: Response) => {
  const parsed = ChangePasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, message: 'Enter your current password and a new password of at least 8 characters.' });
    return;
  }

  const user = await queryOne<{
    u_id: number;
    username: string;
    role: string;
    password_hash: string;
  }>(
    'SELECT u_id, username, role, password_hash FROM users WHERE u_id = $1',
    [req.userId]
  );
  if (!user || !(await bcrypt.compare(parsed.data.currentPassword, user.password_hash))) {
    res.status(401).json({ success: false, message: 'Current password is incorrect.' });
    return;
  }

  const passwordHash = await bcrypt.hash(parsed.data.newPassword, 12);
  await execute(
    'UPDATE users SET password_hash = $1, must_change_password = FALSE WHERE u_id = $2',
    [passwordHash, user.u_id]
  );
  const updated = { ...user, must_change_password: false };
  const token = createToken(updated);
  const decoded = jwt.decode(token) as { exp?: number } | null;
  res.json({
    success: true,
    token,
    expiresAt: decoded?.exp ? decoded.exp * 1000 : Date.now() + 24 * 60 * 60 * 1000,
    message: 'Password changed.',
  });
});

router.put('/me', requireNewSchemaAuth, async (req: NewSchemaAuthRequest, res: Response) => {
  const parsed = UpdateProfileSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, message: 'Enter your current password, username, and display name. New passwords must have at least 8 characters.' });
    return;
  }
  if (req.newSchemaUser?.mustChangePassword && !parsed.data.newPassword) {
    res.status(403).json({
      success: false,
      mustChangePassword: true,
      message: 'Set a new password before updating your profile.',
    });
    return;
  }
  const user = await queryOne<{
    u_id: number;
    username: string;
    name: string;
    role: string;
    password_hash: string;
  }>(
    'SELECT u_id, username, name, role, password_hash FROM users WHERE u_id = $1',
    [req.userId]
  );
  if (!user || !(await bcrypt.compare(parsed.data.currentPassword, user.password_hash))) {
    res.status(401).json({ success: false, message: 'Current password is incorrect.' });
    return;
  }

  const duplicate = await queryOne<{ u_id: number }>(
    'SELECT u_id FROM users WHERE username = $1 AND u_id <> $2',
    [parsed.data.username, user.u_id]
  );
  if (duplicate) {
    res.status(409).json({ success: false, message: 'That username is already in use.' });
    return;
  }

  const passwordHash = parsed.data.newPassword
    ? await bcrypt.hash(parsed.data.newPassword, 12)
    : null;
  await execute(
    `UPDATE users
     SET username = $1, name = $2,
         password_hash = COALESCE($3, password_hash),
         must_change_password = FALSE
     WHERE u_id = $4`,
    [parsed.data.username, parsed.data.name, passwordHash, user.u_id]
  );

  const updated = {
    u_id: user.u_id,
    username: parsed.data.username,
    role: user.role,
    must_change_password: false,
  };
  const token = createToken(updated);
  const decoded = jwt.decode(token) as { exp?: number } | null;
  res.json({
    success: true,
    token,
    expiresAt: decoded?.exp ? decoded.exp * 1000 : Date.now() + 24 * 60 * 60 * 1000,
    username: parsed.data.username,
    name: parsed.data.name,
  });
});

export default router;
