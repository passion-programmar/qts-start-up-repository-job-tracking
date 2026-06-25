import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { queryAll, queryOne } from '../../database/connection';
import { config } from '../../config/env';
import { getCandidateStacks } from '../../config/candidate-stacks';
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
}): Promise<{ error: string | null; bidderName: string | null }> {
  const role = normalizeRole(user.role);
  if (role !== 'bidder') return { error: null, bidderName: null };

  if (!user.bidder_id) {
    return {
      error: 'This account is not linked to a bidder organization. Ask your admin to create it in QTS_Startup.',
      bidderName: null,
    };
  }

  const bidder = await queryOne<{ is_active: boolean; name: string }>(
    'SELECT is_active, name FROM bidders WHERE id = $1',
    [user.bidder_id]
  );

  if (!bidder) {
    return {
      error: 'Bidder organization not found. Ask your admin to set up your account in QTS_Startup.',
      bidderName: null,
    };
  }

  if (!bidder.is_active) {
    return {
      error: 'This bidder organization is inactive. Contact your admin.',
      bidderName: null,
    };
  }

  return { error: null, bidderName: bidder.name ?? null };
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

    const bidderCheck = await validateBidderAccount(user);
    if (bidderCheck.error) {
      logger.warn('Login failed: bidder account not ready', { username });
      res.status(403).json({ success: false, message: bidderCheck.error });
      return;
    }

    const bidderName = bidderCheck.bidderName;

    const token = jwt.sign(
      {
        id: user.id,
        username: user.username,
        role,
        bidderId: user.bidder_id,
        bidderName,
      },
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

router.get('/me', requireAuth, (req: AuthRequest, res: Response) => {
  res.json({
    success: true,
    username: req.username,
    id: req.userId,
    role: req.role || 'bidder',
    bidderId: req.bidderId ?? null,
    bidderName: req.bidderName ?? null,
  });
});

router.get('/extension-bootstrap', requireAuth, async (req: AuthRequest, res: Response) => {
  const role = normalizeRole(req.role);
  const bidderId = req.bidderId != null ? Number(req.bidderId) : null;
  if (role !== 'bidder' || !bidderId) {
    res.status(403).json({
      success: false,
      message: 'The extension requires a bidder account linked to a bidder organization.',
    });
    return;
  }

  const [candidates, stacks] = await Promise.all([
    queryAll(
      `SELECT c.*, b.name AS bidder_name
       FROM candidates c
       LEFT JOIN bidders b ON b.id = c.bidder_id
       WHERE c.is_active = TRUE AND c.bidder_id = $1
       ORDER BY c.name ASC`,
      [bidderId]
    ),
    getCandidateStacks(),
  ]);

  res.json({
    success: true,
    user: {
      id: req.userId,
      username: req.username,
      role: req.role,
      bidderId,
      bidderName: req.bidderName ?? null,
    },
    candidates,
    stacks,
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
