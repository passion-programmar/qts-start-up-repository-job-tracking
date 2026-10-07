import { AuthRequest } from './auth';
export declare function isAdmin(req: AuthRequest): boolean;
export declare function isBidder(req: AuthRequest): boolean;
export declare function isCaller(req: AuthRequest): boolean;
export declare function isManager(req: AuthRequest): boolean;
export declare function candidateBidderFilter(req: AuthRequest, alias?: string, paramIndex?: number): {
    clause: string;
    params: unknown[];
    nextIndex: number;
};
export declare function jobBidderFilter(req: AuthRequest, alias?: string, paramIndex?: number): {
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