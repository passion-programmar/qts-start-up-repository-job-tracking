/** Candidate stack options — keep in sync with shared/candidate-stacks.ts */
import { queryOne, execute } from '../database/connection';
import { logger } from '../utilities/logger';

export const CANDIDATE_STACKS_SETTING_KEY = 'candidate_stacks';

export const DEFAULT_CANDIDATE_STACKS = [
  'Full Stack',
  'Frontend',
  'Backend',
  'DevOps',
  'Mobile',
  'Data / ML',
] as const;

export function normalizeStackName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

export function parseCandidateStacks(value?: string | null): string[] {
  if (!value) return [...DEFAULT_CANDIDATE_STACKS];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [...DEFAULT_CANDIDATE_STACKS];
    const stacks = parsed
      .filter((item): item is string => typeof item === 'string')
      .map(normalizeStackName)
      .filter(Boolean);
    return stacks.length ? stacks : [...DEFAULT_CANDIDATE_STACKS];
  } catch {
    return [...DEFAULT_CANDIDATE_STACKS];
  }
}

export function serializeCandidateStacks(stacks: string[]): string {
  const unique: string[] = [];
  for (const stack of stacks) {
    const normalized = normalizeStackName(stack);
    if (!normalized) continue;
    if (!unique.some((existing) => existing.toLowerCase() === normalized.toLowerCase())) {
      unique.push(normalized);
    }
  }
  return JSON.stringify(unique);
}

export function sanitizeCandidateStacksInput(stacks: unknown): string[] {
  if (!Array.isArray(stacks)) return [];
  const unique: string[] = [];
  for (const item of stacks) {
    if (typeof item !== 'string') continue;
    const normalized = normalizeStackName(item);
    if (!normalized) continue;
    if (!unique.some((existing) => existing.toLowerCase() === normalized.toLowerCase())) {
      unique.push(normalized);
    }
  }
  return unique;
}

export async function getCandidateStacks(): Promise<string[]> {
  const row = await queryOne<{ value: string }>(
    'SELECT value FROM settings WHERE key = $1',
    [CANDIDATE_STACKS_SETTING_KEY]
  );
  return parseCandidateStacks(row?.value);
}

export async function saveCandidateStacks(stacks: string[]): Promise<string[]> {
  const sanitized = sanitizeCandidateStacksInput(stacks);
  if (!sanitized.length) {
    throw new Error('At least one stack option is required.');
  }

  const previous = await getCandidateStacks();
  const serialized = serializeCandidateStacks(sanitized);

  await execute(
    `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, NOW())
     ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [CANDIDATE_STACKS_SETTING_KEY, serialized]
  );

  const removed = previous.filter((name) => !sanitized.includes(name));
  for (const name of removed) {
    try {
      await execute(
        'UPDATE candidates SET stack = NULL, updated_at = NOW() WHERE stack = $1',
        [name]
      );
    } catch (err) {
      logger.warn('Could not clear removed stack from candidates', { name, err });
    }
  }

  return sanitized;
}

export async function resolveCanonicalStack(
  stack: string | null | undefined
): Promise<string | null> {
  if (!stack?.trim()) return null;
  const normalized = normalizeStackName(stack);
  const stacks = await getCandidateStacks();
  return stacks.find((s) => normalizeStackName(s).toLowerCase() === normalized.toLowerCase()) ?? null;
}

export async function isValidCandidateStack(stack: string | null | undefined): Promise<boolean> {
  if (!stack?.trim()) return true;
  return (await resolveCanonicalStack(stack)) !== null;
}
