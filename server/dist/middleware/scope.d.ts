import { AuthRequest } from './auth';
export declare function isAdmin(req: AuthRequest): boolean;
export declare function isAccount(req: AuthRequest): boolean;
export declare function isCaller(req: AuthRequest): boolean;
export declare function isManager(req: AuthRequest): boolean;
export declare function candidateAccountFilter(req: AuthRequest, alias?: string, paramIndex?: number): {
    clause: string;
    params: unknown[];
    nextIndex: number;
};
export declare function jobAccountFilter(req: AuthRequest, alias?: string, paramIndex?: number): {
    clause: string;
    params: unknown[];
    nextIndex: number;
};
export declare function jobAccessible(req: AuthRequest, jobId: number): Promise<boolean>;
export declare function interviewCallerFilter(req: AuthRequest, alias?: string, paramIndex?: number): {
    clause: string;
    params: unknown[];
    nextIndex: number;
};
//# sourceMappingURL=scope.d.ts.map