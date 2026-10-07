'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { api } from '@/lib/api';
import {
  ADMIN_UI_MODE_SETTING_KEY,
  DEFAULT_ADMIN_UI_MODE,
  normalizeAdminUiMode,
  type AdminUiMode,
} from '@/lib/admin-ui-mode';

interface AdminUiModeContextValue {
  adminUiMode: AdminUiMode;
  loading: boolean;
  setAdminUiMode: (mode: AdminUiMode) => void;
  refreshAdminUiMode: () => Promise<void>;
}

const AdminUiModeContext = createContext<AdminUiModeContextValue | null>(null);

export function AdminUiModeProvider({ children }: { children: React.ReactNode }) {
  const [adminUiMode, setAdminUiModeState] = useState<AdminUiMode>(DEFAULT_ADMIN_UI_MODE);
  const [loading, setLoading] = useState(true);

  const refreshAdminUiMode = useCallback(async () => {
    const r = await api<{ success: boolean; settings?: Record<string, string> }>('GET', '/api/settings');
    const next = normalizeAdminUiMode(r.settings?.[ADMIN_UI_MODE_SETTING_KEY]);
    setAdminUiModeState(next);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refreshAdminUiMode();
  }, [refreshAdminUiMode]);

  const setAdminUiMode = useCallback((mode: AdminUiMode) => {
    setAdminUiModeState(mode);
  }, []);

  const value = useMemo(
    () => ({ adminUiMode, loading, setAdminUiMode, refreshAdminUiMode }),
    [adminUiMode, loading, setAdminUiMode, refreshAdminUiMode]
  );

  return (
    <AdminUiModeContext.Provider value={value}>
      {children}
    </AdminUiModeContext.Provider>
  );
}

export function useAdminUiMode(): AdminUiModeContextValue {
  const ctx = useContext(AdminUiModeContext);
  if (!ctx) {
    return {
      adminUiMode: DEFAULT_ADMIN_UI_MODE,
      loading: false,
      setAdminUiMode: () => {},
      refreshAdminUiMode: async () => {},
    };
  }
  return ctx;
}
