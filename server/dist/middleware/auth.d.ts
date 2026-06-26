import { Request, Response, NextFunction } from 'express';
import { type UserRole } from '../lib/roles';
export type { UserRole };
export interface AuthRequest extends Request {
    userId?: number;
    username?: string;
    role?: UserRole;
    bidderId?: number | null;
    bidderName?: string | null;
    /** @deprecated Use userId */
    adminId?: number;
    /** @deprecated Use username */
    adminUsername?: string;
    /** Set when request authenticates with GPT_ACTION_API_KEY (Custom GPT Actions). */
    gptServiceAuth?: boolean;
}
export declare function requireAuth(req: AuthRequest, res: Response, next: NextFunction): void;
/** Accepts bidder/admin JWT or the static GPT_ACTION_API_KEY for Custom GPT Actions. */
export declare function requireAuthOrGptActionKey(req: AuthRequest, res: Response, next: NextFunction): void;
export declare function requireAdmin(req: AuthRequest, res: Response, next: NextFunction): void;
export declare function requireAdminOrBidder(req: AuthRequest, res: Response, next: NextFunction): void;
export declare function requireAdminOrCaller(req: AuthRequest, res: Response, next: NextFunction): void;
export declare function requireAdminOrManager(req: AuthRequest, res: Response, next: NextFunction): void;
export declare function requireAdminWrite(req: AuthRequest, res: Response, next: NextFunction): void;
export declare function requireAdminOrManagerWrite(req: AuthRequest, res: Response, next: NextFunction): void;
export declare function requireAdminManagerOrBidder(req: AuthRequest, res: Response, next: NextFunction): void;
//# sourceMappingURL=auth.d.ts.map