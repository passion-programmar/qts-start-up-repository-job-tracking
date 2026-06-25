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
