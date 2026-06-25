import type { UserRole } from '../lib/roles';
export interface CreateAccountInput {
    username: string;
    password: string;
    role: UserRole;
    bidderId?: number | null;
    isActive?: boolean;
}
export declare function createAccount(input: CreateAccountInput): Promise<{
    id: number;
} | null>;
export declare function updateAccountPassword(accountId: number, password: string): Promise<void>;
export declare function usernameExists(username: string): Promise<boolean>;
//# sourceMappingURL=accounts.d.ts.map