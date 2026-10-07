import { Pool } from 'pg';
export interface DbQueryable {
    query(sql: string, params?: unknown[]): Promise<{
        rows: unknown[];
        rowCount?: number | null;
    }>;
}
export declare function initDb(): Promise<void>;
export declare function closeDb(): Promise<void>;
/** @deprecated Use queryAll/queryOne or pass DbQueryable to transactions. */
export declare function getPool(): Pool;
export declare function queryAll<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
export declare function queryOne<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | null>;
export declare function execute(sql: string, params?: unknown[]): Promise<{
    rowCount: number;
}>;
export declare function dbQuery(sql: string, params?: unknown[]): Promise<{
    rows: unknown[];
    rowCount?: number | null;
}>;
export declare function withTransaction<T>(fn: (client: DbQueryable) => Promise<T>): Promise<T>;
export declare function backupDb(): Promise<string>;
//# sourceMappingURL=connection.d.ts.map