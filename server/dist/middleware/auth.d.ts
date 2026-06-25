import { Request, Response, NextFunction } from 'express';
import { type UserRole } from '../lib/roles';
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
export declare function requireAuth(req: AuthRequest, res: Response, next: NextFunction): void;
export declare function requireAdmin(req: AuthRequest, res: Response, next: NextFunction): void;
export declare function requireAdminOrBidder(req: AuthRequest, res: Response, next: NextFunction): void;
export declare function requireAdminOrCaller(req: AuthRequest, res: Response, next: NextFunction): void;
export declare function requireAdminOrManager(req: AuthRequest, res: Response, next: NextFunction): void;
export declare function requireAdminWrite(req: AuthRequest, res: Response, next: NextFunction): void;
export declare function requireAdminOrManagerWrite(req: AuthRequest, res: Response, next: NextFunction): void;
export declare function requireAdminManagerOrBidder(req: AuthRequest, res: Response, next: NextFunction): void;
//# sourceMappingURL=auth.d.ts.map