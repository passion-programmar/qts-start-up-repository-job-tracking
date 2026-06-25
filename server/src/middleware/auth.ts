import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config/env';
import { normalizeRole, type UserRole } from '../lib/roles';

export type { UserRole };

export interface AuthRequest extends Request {
  userId?: number;
  username?: string;
  role?: UserRole;
  bidderId?: number | null;
  /** @deprecated Use userId */
  adminId?: number;
  /** @deprecated Use username */
  adminUsername?: string;
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
      bidderId?: number | null;
    };
    req.userId = payload.id;
    req.username = payload.username;
    req.adminId = payload.id;
    req.adminUsername = payload.username;
    req.role = normalizeRole(payload.role);
    req.bidderId = payload.bidderId ?? null;
    next();
  } catch {
    res.status(401).json({ success: false, message: 'Invalid or expired token. Please log in again.' });
  }
}

export function requireAdmin(req: AuthRequest, res: Response, next: NextFunction): void {
  if (req.role !== 'admin') {
    res.status(403).json({ success: false, message: 'Admin access required.' });
    return;
  }
  next();
}

export function requireAdminOrBidder(req: AuthRequest, res: Response, next: NextFunction): void {
  if (req.role !== 'admin' && req.role !== 'bidder') {
    res.status(403).json({ success: false, message: 'Bidder access required.' });
    return;
  }
  next();
}

export function requireAdminOrCaller(req: AuthRequest, res: Response, next: NextFunction): void {
  if (req.role !== 'admin' && req.role !== 'caller' && req.role !== 'manager') {
    res.status(403).json({ success: false, message: 'Caller access required.' });
    return;
  }
  next();
}

export function requireAdminOrManager(req: AuthRequest, res: Response, next: NextFunction): void {
  if (req.role !== 'admin' && req.role !== 'manager') {
    res.status(403).json({ success: false, message: 'Manager access required.' });
    return;
  }
  next();
}

export function requireAdminWrite(req: AuthRequest, res: Response, next: NextFunction): void {
  if (req.role !== 'admin') {
    res.status(403).json({ success: false, message: 'Only admins can modify or delete records.' });
    return;
  }
  next();
}

export function requireAdminOrManagerWrite(req: AuthRequest, res: Response, next: NextFunction): void {
  if (req.role !== 'admin' && req.role !== 'manager') {
    res.status(403).json({ success: false, message: 'Admin or manager access required.' });
    return;
  }
  next();
}

export function requireAdminManagerOrBidder(req: AuthRequest, res: Response, next: NextFunction): void {
  if (req.role !== 'admin' && req.role !== 'manager' && req.role !== 'bidder') {
    res.status(403).json({ success: false, message: 'Access denied.' });
    return;
  }
  next();
}
