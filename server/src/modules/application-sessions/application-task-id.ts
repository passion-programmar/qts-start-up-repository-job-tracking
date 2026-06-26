import { randomUUID } from 'node:crypto';

/** Legacy numeric alias: task_8 → session id 8 */
export function parseLegacySessionId(taskId: string): number | null {
  const raw = String(taskId || '').trim();
  const match = raw.match(/^task_(\d+)$/i);
  if (match) return parseInt(match[1], 10);
  if (/^\d+$/.test(raw)) return parseInt(raw, 10);
  return null;
}

export function isPublicTaskId(taskId: string): boolean {
  return /^task_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(taskId || '').trim()
  );
}

export function createPublicTaskId(): string {
  return `task_${randomUUID()}`;
}

export function readPublicTaskId(metadata: Record<string, unknown> | null | undefined): string | null {
  const raw = metadata?.publicTaskId ?? metadata?.taskId;
  if (typeof raw === 'string' && raw.startsWith('task_')) return raw;
  return null;
}

/** @deprecated Use readPublicTaskId + session id from DB. Kept for backward compatibility. */
export function formatTaskId(sessionId: number, publicTaskId?: string | null): string {
  if (publicTaskId) return publicTaskId;
  return `task_${sessionId}`;
}

/** @deprecated Use resolveSessionIdFromTaskId for API routes. */
export function parseTaskId(taskId: string): number | null {
  return parseLegacySessionId(taskId);
}
