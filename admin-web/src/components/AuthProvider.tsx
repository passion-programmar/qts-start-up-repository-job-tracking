'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useRouter } from 'next/navigation';
import { api, clearToken, getToken } from '@/lib/api';
import type { AuthUser, PanelMode, UserRole } from '@/lib/types';
import { panelModeForRole, roleHome, roleLabel } from '@/lib/utils';
import { REDIRECT_GUARD_KEY } from '@/lib/branding';

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  canWrite: boolean;
  canManageTeam: boolean;
  canAddJobs: boolean;
  canAddCandidates: boolean;
  canAddInterviews: boolean;
  updateUser: (updates: Partial<Pick<AuthUser, 'username' | 'name'>>) => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

function normalizeRole(role?: string): UserRole {
  if (role === 'super') return 'super';
  if (role === 'admin') return 'admin';
  if (role === 'manager') return 'manager';
  if (role === 'caller') return 'caller';
  return 'account';
}

export function AuthProvider({
  mode,
  children,
}: {
  mode: PanelMode;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const loadSession = useCallback(async () => {
    const token = typeof window !== 'undefined' ? getToken() : null;
    if (!token) {
      setLoading(false);
      router.replace('/login');
      return;
    }

    const r = await api<{
      success: boolean;
      username?: string;
      name?: string;
      id?: number;
      role?: string;
      accountId?: number | null;
      message?: string;
    }>('GET', '/api/v2/auth/me');

    if (!r.success || !r.username) {
      clearToken();
      setLoading(false);
      router.replace('/login');
      return;
    }

    const role = normalizeRole(r.role);
    if (role === 'account') {
      clearToken();
      setLoading(false);
      router.replace('/login');
      return;
    }
    const expectedMode = panelModeForRole(role);

    if (expectedMode !== mode) {
      const target = roleHome(role);
      const guardKey = REDIRECT_GUARD_KEY;
      const guard = sessionStorage.getItem(guardKey);
      if (guard === target) {
        sessionStorage.removeItem(guardKey);
        clearToken();
        router.replace('/login');
        return;
      }
      sessionStorage.setItem(guardKey, target);
      router.replace(target);
      return;
    }

    sessionStorage.removeItem(REDIRECT_GUARD_KEY);
    setUser({
      id: r.id!,
      username: r.username,
      name: r.name,
      role,
      accountId: r.accountId ?? null,
    });
    setLoading(false);
  }, [mode, router]);

  useEffect(() => {
    // Session lookup updates auth state after the provider mounts.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadSession();
  }, [loadSession]);

  const logout = useCallback(async () => {
    try {
      await api('POST', '/api/v2/auth/logout');
    } finally {
      clearToken();
      setUser(null);
      router.replace('/login');
    }
  }, [router]);

  const updateUser = useCallback((updates: Partial<Pick<AuthUser, 'username' | 'name'>>) => {
    setUser((current) => current ? { ...current, ...updates } : current);
  }, []);

  const canWrite = mode === 'admin' || mode === 'manager';
  const canManageTeam = mode === 'admin' || mode === 'manager';
  const canAddJobs = mode === 'admin' || mode === 'account';
  const canAddCandidates = mode === 'admin' || mode === 'manager';
  const canAddInterviews = mode === 'admin' || mode === 'manager' || mode === 'caller';

  const value = useMemo(
    () => ({ user, loading, canWrite, canManageTeam, canAddJobs, canAddCandidates, canAddInterviews, updateUser, logout }),
    [user, loading, canWrite, canManageTeam, canAddJobs, canAddCandidates, canAddInterviews, updateUser, logout]
  );

  if (loading) {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <p className="text-muted" style={{ textAlign: 'center', margin: 0 }}>Loading…</p>
        </div>
      </div>
    );
  }

  if (!user) return null;

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export { roleLabel };
