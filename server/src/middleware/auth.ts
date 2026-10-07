import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config/env';
import { normalizeRole, type UserRole } from '../lib/roles';

export type { UserRole };

export interface AuthRequest extends Request {
  userId?: number;
  username?: string;
  role?: UserRole;
  accountId?: number | null;
  accountName?: string | null;
  extensionAccountScope?: boolean;
  /** @deprecated Use userId */
  adminId?: number;
  /** @deprecated Use username */
  adminUsername?: string;
  /** Set when request authenticates with GPT_ACTION_API_KEY (Custom GPT Actions). */
  gptServiceAuth?: boolean;
}

export function requireAuth(req: AuthRequest, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ success: false, message: 'Authentication required.' });
    return;
  }

  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, config.jwtSecret) as {
      id: number;
      username: string;
      role?: string;
      accountId?: number | null;
      accountName?: string | null;
      extensionAccountScope?: boolean;
    };
    req.userId = payload.id;
    req.username = payload.username;
    req.adminId = payload.id;
    req.adminUsername = payload.username;
    req.role = normalizeRole(payload.role);
    req.accountId = payload.accountId != null ? Number(payload.accountId) : null;
    req.accountName = payload.accountName ?? null;
    req.extensionAccountScope = payload.extensionAccountScope === true;
    next();
  } catch {
    res.status(401).json({ success: false, message: 'Invalid or expired token. Please log in again.' });
  }
}

/** Accepts account/admin JWT or the static GPT_ACTION_API_KEY for Custom GPT Actions. */
export function requireAuthOrGptActionKey(req: AuthRequest, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ success: false, message: 'Authentication required.' });
    return;
  }

  const token = header.slice(7);
  if (config.gptActionApiKey && token === config.gptActionApiKey) {
    req.gptServiceAuth = true;
    req.role = 'admin';
    next();
    return;
  }

  try {
    const payload = jwt.verify(token, config.jwtSecret) as {
      id: number;
      username: string;
      role?: string;
      accountId?: number | null;
      accountName?: string | null;
      extensionAccountScope?: boolean;
    };
    req.userId = payload.id;
    req.username = payload.username;
    req.adminId = payload.id;
    req.adminUsername = payload.username;
    req.role = normalizeRole(payload.role);
    req.accountId = payload.accountId != null ? Number(payload.accountId) : null;
    req.accountName = payload.accountName ?? null;
    req.extensionAccountScope = payload.extensionAccountScope === true;
    next();
  } catch {
    res.status(401).json({ success: false, message: 'Invalid or expired token. Please log in again.' });
  }
}

export function requireAdmin(req: AuthRequest, res: Response, next: NextFunction): void {
  if (req.role !== 'admin' && req.role !== 'super') {
    res.status(403).json({ success: false, message: 'Admin access required.' });
    return;
  }
  next();
}

export function requireSuper(req: AuthRequest, res: Response, next: NextFunction): void {
  if (req.role !== 'super') {
    res.status(403).json({ success: false, message: 'Super access required.' });
    return;
  }
  next();
}

export function requireAdminOrAccount(req: AuthRequest, res: Response, next: NextFunction): void {
  if (req.role !== 'admin' && req.role !== 'super' && req.role !== 'account' &&
      !(req.role === 'manager' && req.extensionAccountScope && req.accountId)) {
    res.status(403).json({ success: false, message: 'Account access required.' });
    return;
  }
  next();
}

export function requireAdminOrCaller(req: AuthRequest, res: Response, next: NextFunction): void {
  if (req.role !== 'admin' && req.role !== 'super' && req.role !== 'caller' && req.role !== 'manager') {
    res.status(403).json({ success: false, message: 'Caller access required.' });
    return;
  }
  next();
}

export function requireAdminOrManager(req: AuthRequest, res: Response, next: NextFunction): void {
  if (req.role !== 'admin' && req.role !== 'super' && req.role !== 'manager') {
    res.status(403).json({ success: false, message: 'Manager access required.' });
    return;
  }
  next();
}

export function requireAdminWrite(req: AuthRequest, res: Response, next: NextFunction): void {
  if (req.role !== 'admin' && req.role !== 'super') {
    res.status(403).json({ success: false, message: 'Only admins can modify or delete records.' });
    return;
  }
  next();
}

export function requireAdminOrManagerWrite(req: AuthRequest, res: Response, next: NextFunction): void {
  if (req.role !== 'admin' && req.role !== 'super' && req.role !== 'manager') {
    res.status(403).json({ success: false, message: 'Admin or manager access required.' });
    return;
  }
  next();
}

export function requireAdminManagerOrAccount(req: AuthRequest, res: Response, next: NextFunction): void {
  if (req.role !== 'admin' && req.role !== 'super' && req.role !== 'manager' && req.role !== 'account') {
    res.status(403).json({ success: false, message: 'Access denied.' });
    return;
  }
  next();
}
