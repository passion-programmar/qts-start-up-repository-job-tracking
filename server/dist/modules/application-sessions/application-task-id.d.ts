/** Legacy numeric alias: task_8 → session id 8 */
export declare function parseLegacySessionId(taskId: string): number | null;
export declare function isPublicTaskId(taskId: string): boolean;
export declare function createPublicTaskId(): string;
export declare function readPublicTaskId(metadata: Record<string, unknown> | null | undefined): string | null;
/** @deprecated Use readPublicTaskId + session id from DB. Kept for backward compatibility. */
export declare function formatTaskId(sessionId: number, publicTaskId?: string | null): string;
/** @deprecated Use resolveSessionIdFromTaskId for API routes. */
export declare function parseTaskId(taskId: string): number | null;
//# sourceMappingURL=application-task-id.d.ts.map