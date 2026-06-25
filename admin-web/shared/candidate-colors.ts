/** Curated palette for candidate name colors — keep in sync across web, server, and extension. */
export const CANDIDATE_NAME_COLORS = [
  { value: '#2563EB', label: 'Blue' },
  { value: '#4F46E5', label: 'Indigo' },
  { value: '#7C3AED', label: 'Violet' },
  { value: '#9333EA', label: 'Purple' },
  { value: '#DB2777', label: 'Pink' },
  { value: '#E11D48', label: 'Rose' },
  { value: '#DC2626', label: 'Red' },
  { value: '#EA580C', label: 'Orange' },
  { value: '#D97706', label: 'Amber' },
  { value: '#CA8A04', label: 'Gold' },
  { value: '#16A34A', label: 'Green' },
  { value: '#059669', label: 'Emerald' },
  { value: '#0F766E', label: 'Teal' },
  { value: '#0891B2', label: 'Cyan' },
] as const;

export const CANDIDATE_COLOR_VALUES = CANDIDATE_NAME_COLORS.map((c) => c.value);

export type CandidateColor = (typeof CANDIDATE_COLOR_VALUES)[number];

export function isCandidateColor(color: string | null | undefined): color is CandidateColor {
  if (!color) return false;
  return CANDIDATE_COLOR_VALUES.some((c) => c.toLowerCase() === color.toLowerCase());
}

export function normalizeCandidateColor(
  color: string | null | undefined,
  fallbackIndex = 0
): CandidateColor {
  if (isCandidateColor(color)) {
    return CANDIDATE_COLOR_VALUES.find((c) => c.toLowerCase() === color!.toLowerCase())!;
  }
  const index = Math.abs(fallbackIndex) % CANDIDATE_COLOR_VALUES.length;
  return CANDIDATE_COLOR_VALUES[index];
}

export function nextCandidateColor(count: number): CandidateColor {
  return normalizeCandidateColor(null, count);
}
