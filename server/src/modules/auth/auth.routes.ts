import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { queryOne } from '../../database/connection';
import { config } from '../../config/env';
import { requireAuth, AuthRequest } from '../../middleware/auth';
import { normalizeRole } from '../../lib/roles';
import { logger } from '../../utilities/logger';

const router = Router();

const LoginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
  extension: z.boolean().optional().default(false),
});

async function validateBidderAccount(user: {
  role: string;
  bidder_id: number | null;
}): Promise<string | null> {
  const role = normalizeRole(user.role);
  if (role !== 'bidder') return null;

  if (!user.bidder_id) {
    return 'This account is not linked to a bidder organization. Ask your admin to create it in QTS_Startup.';
  }

  const bidder = await queryOne<{ is_active: boolean }>(
    'SELECT is_active FROM bidders WHERE id = $1',
    [user.bidder_id]
  );

  if (!bidder) {
    return 'Bidder organization not found. Ask your admin to set up your account in QTS_Startup.';
  }

  if (!bidder.is_active) {
    return 'This bidder organization is inactive. Contact your admin.';
  }

  return null;
}

router.post('/login', async (req: Request, res: Response) => {
  try {
    const { username, password, extension } = LoginSchema.parse(req.body);
    const user = await queryOne<{
      id: number;
      username: string;
      password_hash: string;
      role: string;
      bidder_id: number | null;
    }>(
      'SELECT id, username, password_hash, role, bidder_id FROM admins WHERE username = $1',
      [username]
    );

    if (!user) {
      logger.warn('Login failed: unknown username', { username });
      res.status(401).json({ success: false, message: 'Invalid credentials.' });
      return;
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      logger.warn('Login failed: wrong password', { username });
      res.status(401).json({ success: false, message: 'Invalid credentials.' });
      return;
    }

    const role = normalizeRole(user.role);

    if (extension && role !== 'bidder') {
      logger.warn('Extension login rejected: not a bidder', { username, role });
      res.status(403).json({
        success: false,
        message: 'The extension requires a bidder account. Use QTS_Startup web for admin or caller access.',
      });
      return;
    }

    const bidderError = await validateBidderAccount(user);
    if (bidderError) {
      logger.warn('Login failed: bidder account not ready', { username });
      res.status(403).json({ success: false, message: bidderError });
      return;
    }

    let bidderName: string | null = null;
    if (user.bidder_id) {
      const bidder = await queryOne<{ name: string }>(
        'SELECT name FROM bidders WHERE id = $1',
        [user.bidder_id]
      );
      bidderName = bidder?.name ?? null;
    }

    const token = jwt.sign(
      { id: user.id, username: user.username, role, bidderId: user.bidder_id },
      config.jwtSecret,
      { expiresIn: config.jwtExpiry } as jwt.SignOptions
    );

    logger.info('Login success', { username, role });
    res.json({
      success: true,
      token,
      username: user.username,
      role,
      bidderId: user.bidder_id,
      bidderName,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, message: 'Username and password are required.' });
    } else {
      throw err;
    }
  }
});

router.post('/logout', requireAuth, (req: AuthRequest, res: Response) => {
  logger.info('Logout', { username: req.username });
  res.json({ success: true, message: 'Logged out.' });
});

router.get('/me', requireAuth, async (req: AuthRequest, res: Response) => {
  let bidderName: string | null = null;
  if (req.bidderId) {
    const bidder = await queryOne<{ name: string }>(
      'SELECT name FROM bidders WHERE id = $1',
      [req.bidderId]
    );
    bidderName = bidder?.name ?? null;
  }
  res.json({
    success: true,
    username: req.username,
    id: req.userId,
    role: req.role || 'bidder',
    bidderId: req.bidderId ?? null,
    bidderName,
  });
});

router.get('/extension-status', async (_req: Request, res: Response) => {
  const row = await queryOne<{ count: number }>(`
    SELECT COUNT(*)::int AS count
    FROM admins a
    INNER JOIN bidders b ON b.id = a.bidder_id
    WHERE a.role = 'bidder' AND b.is_active = TRUE
  `);
  res.json({
    success: true,
    hasBidderAccounts: (row?.count ?? 0) > 0,
  });
});

router.get('/setup-status', async (_req: Request, res: Response) => {
  const admin = await queryOne('SELECT id FROM admins LIMIT 1');
  res.json({ success: true, initialized: !!admin });
});

export default router;
