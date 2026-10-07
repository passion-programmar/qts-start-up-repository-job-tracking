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
import { resolveCustomGptConfig } from '../../utilities/custom-gpt-url';

const router = Router();

const LoginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
  extension: z.boolean().optional().default(false),
});

async function validateAccountLogin(user: {
  role: string;
  account_id: number | null;
}): Promise<{ error: string | null; accountName: string | null }> {
  const role = normalizeRole(user.role);
  if (role !== 'account') return { error: null, accountName: null };

  if (!user.account_id) {
    return {
      error: 'This Account login is not linked to an Account team. Ask your admin to create it in QTS_Startup.',
      accountName: null,
    };
  }

  const account = await queryOne<{
    is_active: boolean;
    name: string;
    manager_id: number | null;
    manager_is_active: boolean | null;
    manager_username: string | null;
  }>(
    `SELECT b.is_active, b.name, b.manager_id,
            m.is_active AS manager_is_active,
            m.username AS manager_username
     FROM accounts b
     LEFT JOIN admins m ON m.id = b.manager_id AND m.role = 'manager'
     WHERE b.id = $1`,
    [user.account_id]
  );

  if (!account) {
    return {
      error: 'Account team not found. Ask your admin to set it up in QTS_Startup.',
      accountName: null,
    };
  }

  if (!account.is_active) {
    return {
      error: 'This Account team is inactive. Contact your admin.',
      accountName: null,
    };
  }

  if (account.manager_id != null && account.manager_is_active !== true) {
    const managerLabel = account.manager_username || 'manager';
    return {
      error: `Your manager (${managerLabel}) is inactive. Contact your admin.`,
      accountName: null,
    };
  }

  return { error: null, accountName: account.name ?? null };
}

router.post('/login', async (req: Request, res: Response) => {
  try {
    const { username, password, extension } = LoginSchema.parse(req.body);
    const user = await queryOne<{
      id: number;
      username: string;
      password_hash: string;
      role: string;
      account_id: number | null;
    }>(
      'SELECT id, username, password_hash, role, account_id FROM admins WHERE username = $1',
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

    if (extension && role !== 'manager') {
      logger.warn('Extension login rejected: not a manager', { username, role });
      res.status(403).json({
        success: false,
        message: 'Only Manager accounts can sign in to the extension.',
      });
      return;
    }

    const accountCheck = await validateAccountLogin(user);
    if (accountCheck.error) {
      logger.warn('Login failed: Account login not ready', { username });
      res.status(403).json({ success: false, message: accountCheck.error });
      return;
    }

    const accountName = accountCheck.accountName;

    const token = jwt.sign(
      {
        id: user.id,
        username: user.username,
        role,
        accountId: user.account_id,
        accountName,
      },
      config.jwtSecret,
      { expiresIn: config.jwtExpiry } as jwt.SignOptions
    );

    const decoded = jwt.decode(token) as { exp?: number } | null;
    const expiresAt = decoded?.exp ? decoded.exp * 1000 : Date.now() + 24 * 60 * 60 * 1000;

    logger.info('Login success', { username, role });
    res.json({
      success: true,
      token,
      expiresAt,
      id: user.id,
      username: user.username,
      role,
      accountId: user.account_id,
      accountName,
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
  if (normalizeRole(req.role) === 'account') {
    const accountCheck = await validateAccountLogin({
      role: req.role || 'account',
      account_id: req.accountId ?? null,
    });
    if (accountCheck.error) {
      res.status(403).json({ success: false, message: accountCheck.error });
      return;
    }
  }

  res.json({
    success: true,
    username: req.username,
    id: req.userId,
    role: req.role || 'account',
    accountId: req.accountId ?? null,
    accountName: req.accountName ?? null,
  });
});

router.get('/extension-bootstrap', requireAuth, async (req: AuthRequest, res: Response) => {
  const role = normalizeRole(req.role);
  if (role !== 'manager' || !req.userId) {
    res.status(403).json({
      success: false,
      message: 'Only Manager accounts can use the extension.',
    });
    return;
  }

  const teams = await queryAll<{ id: number; name: string }>(
    'SELECT id, name FROM accounts WHERE manager_id = $1 AND is_active = TRUE ORDER BY name ASC',
    [req.userId]
  );
  const requestedAccountId = Number(req.query.accountId ?? req.accountId ?? 0);
  const selectedTeam = requestedAccountId > 0
    ? teams.find((team) => team.id === requestedAccountId)
    : null;
  if (requestedAccountId > 0 && !selectedTeam) {
    res.status(403).json({ success: false, message: 'That Account team is not assigned to your Manager account.' });
    return;
  }

  const stacks = await getCandidateStacks();
  if (!selectedTeam) {
    res.json({
      success: true,
      user: {
        id: req.userId,
        username: req.username,
        role,
        accountId: null,
        accountName: null,
      },
      teams,
      candidates: [],
      stacks,
    });
    return;
  }

  const [candidates, accountRow] = await Promise.all([
    queryAll(
      `SELECT c.*, b.name AS account_name
       FROM candidates c
       LEFT JOIN accounts b ON b.id = c.account_id
       WHERE c.is_active = TRUE AND c.account_id = $1
       ORDER BY c.name ASC`,
      [selectedTeam.id]
    ),
    queryOne<{ custom_gpt_url: string | null }>(
      'SELECT custom_gpt_url FROM accounts WHERE id = $1',
      [selectedTeam.id]
    ),
  ]);

  const customGpt = resolveCustomGptConfig(accountRow?.custom_gpt_url);
  const token = jwt.sign(
    {
      id: req.userId,
      username: req.username,
      role,
      accountId: selectedTeam.id,
      accountName: selectedTeam.name,
      extensionAccountScope: true,
    },
    config.jwtSecret,
    { expiresIn: config.jwtExpiry } as jwt.SignOptions
  );
  const decoded = jwt.decode(token) as { exp?: number } | null;

  res.json({
    success: true,
    token,
    expiresAt: decoded?.exp ? decoded.exp * 1000 : Date.now() + 24 * 60 * 60 * 1000,
    user: {
      id: req.userId,
      username: req.username,
      role,
      accountId: selectedTeam.id,
      accountName: selectedTeam.name,
    },
    candidates,
    stacks,
    customGpt,
    teams,
  });
});

router.get('/extension-status', async (_req: Request, res: Response) => {
  const row = await queryOne<{ count: number }>(`
    SELECT COUNT(*)::int AS count
    FROM admins m
    INNER JOIN accounts b ON b.manager_id = m.id AND b.is_active = TRUE
    WHERE m.role = 'manager' AND m.is_active = TRUE
  `);
  res.json({
    success: true,
    hasManagerAccounts: (row?.count ?? 0) > 0,
  });
});

router.get('/setup-status', async (_req: Request, res: Response) => {
  const admin = await queryOne('SELECT id FROM admins LIMIT 1');
  res.json({ success: true, initialized: !!admin });
});

export default router;
