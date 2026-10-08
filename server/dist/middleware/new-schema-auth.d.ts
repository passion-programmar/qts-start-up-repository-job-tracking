import { NextFunction, Response } from 'express';
import type { UserRole } from '../lib/roles';
import type { AuthRequest } from './auth';
export interface NewSchemaAuthRequest extends AuthRequest {
    newSchemaUser?: {
        id: number;
        username: string;
        name: string;
        role: UserRole;
        parentUserId: number | null;
    };
}
export declare function requireNewSchemaAuth(req: NewSchemaAuthRequest, res: Response, next: NextFunction): Promise<void>;
//# sourceMappingURL=new-schema-auth.d.ts.map