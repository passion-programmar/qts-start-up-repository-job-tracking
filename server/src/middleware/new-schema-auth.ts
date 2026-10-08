import { NextFunction, Response } from 'express';
import jwt from 'jsonwebtoken';
import { queryOne } from '../database/connection';
import { config } from '../config/env';
import type { UserRole } from '../lib/roles';
import type { AuthRequest } from './auth';

export interface NewSchemaAuthRequest extends AuthRequest {
  newSchemaUser?: {
    id: number;
    username: string;
    name: string;
    role: UserRole;
    parentUserId: number | null;
    mustChangePassword: boolean;
  };
}

export async function requireNewSchemaAuth(
  req: NewSchemaAuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ success: false, message: 'Authentication required.' });
    return;
  }

  try {
    const payload = jwt.verify(header.slice(7), config.jwtSecret) as {
      id: number;
      schema?: string;
    };
    if (payload.schema !== 'new') {
      res.status(401).json({ success: false, message: 'Invalid or expired token. Please log in again.' });
      return;
    }

    const user = await queryOne<{
      u_id: number;
      username: string;
      name: string;
      role: UserRole;
      parent_user_id: number | null;
      must_change_password: boolean;
      blocked: boolean;
    }>(
      `WITH RECURSIVE user_tree AS (
         SELECT u_id, parent_user_id, blocked_date
         FROM users
         WHERE u_id = $1
         UNION
         SELECT parent.u_id, parent.parent_user_id, parent.blocked_date
         FROM users parent
         JOIN user_tree child ON child.parent_user_id = parent.u_id
       )
       SELECT u.u_id, u.username, u.name, u.role, u.parent_user_id,
              u.must_change_password,
              EXISTS (SELECT 1 FROM user_tree WHERE blocked_date IS NOT NULL) AS blocked
       FROM users u
       WHERE u.u_id = $1`,
      [payload.id]
    );

    if (!user || user.blocked) {
      res.status(401).json({ success: false, message: 'This account is unavailable. Contact your administrator.' });
      return;
    }

    req.userId = user.u_id;
    req.username = user.username;
    req.role = user.role;
    req.newSchemaUser = {
      id: user.u_id,
      username: user.username,
      name: user.name,
      role: user.role,
      parentUserId: user.parent_user_id,
      mustChangePassword: user.must_change_password,
    };
    next();
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError || error instanceof jwt.TokenExpiredError) {
      res.status(401).json({ success: false, message: 'Invalid or expired token. Please log in again.' });
      return;
    }
    next(error);
  }
}

export function requireNewSchemaPasswordChanged(
  req: NewSchemaAuthRequest,
  res: Response,
  next: NextFunction
): void {
  if (req.newSchemaUser?.mustChangePassword) {
    res.status(403).json({
      success: false,
      mustChangePassword: true,
      message: 'Change your temporary password before continuing.',
    });
    return;
  }
  next();
}
