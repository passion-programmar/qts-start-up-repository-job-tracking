export type UserRole = 'admin' | 'manager' | 'bidder' | 'caller';

export function normalizeRole(role?: string): UserRole {
  if (role === 'admin') return 'admin';
  if (role === 'manager') return 'manager';
  if (role === 'caller') return 'caller';
  return 'bidder';
}
