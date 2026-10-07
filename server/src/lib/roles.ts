export type UserRole = 'super' | 'admin' | 'manager' | 'account' | 'caller';

export function normalizeRole(role?: string): UserRole {
  if (role === 'super') return 'super';
  if (role === 'admin') return 'admin';
  if (role === 'manager') return 'manager';
  if (role === 'caller') return 'caller';
  return 'account';
}
