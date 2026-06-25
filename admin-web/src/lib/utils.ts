import type { PanelMode, UserRole } from '@/lib/types';
import { normalizeCandidateColor } from '../../shared/candidate-colors';

export function formatDate(ts?: string | null): string {
  if (!ts) return '—';
  try {
    return new Date(ts).toLocaleDateString();
  } catch {
    return ts;
  }
}

export function pickCandidateColor(candidate: { id?: number; color?: string | null }, index = 0): string {
  return normalizeCandidateColor(candidate.color, Number(candidate.id) || index);
}

export function isRecentCandidate(createdAt?: string): boolean {
  if (!createdAt) return false;
  const created = new Date(createdAt);
  return !Number.isNaN(created.getTime()) && Date.now() - created.getTime() <= 7 * 24 * 60 * 60 * 1000;
}

export function roleHome(role: UserRole | string): string {
  if (role === 'admin') return '/admin';
  if (role === 'manager') return '/manager';
  if (role === 'caller') return '/caller';
  return '/bidder';
}

export function panelModeForRole(role: UserRole | string): PanelMode {
  if (role === 'admin') return 'admin';
  if (role === 'manager') return 'manager';
  if (role === 'caller') return 'caller';
  return 'bidder';
}

export function roleLabel(role: UserRole | string): string {
  if (role === 'admin') return 'Admin';
  if (role === 'manager') return 'Manager';
  if (role === 'caller') return 'Caller';
  return 'Bidder';
}
