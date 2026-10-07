'use client';

import { AuthProvider } from '@/components/AuthProvider';
import { AdminUiModeProvider } from '@/components/AdminUiModeProvider';
import { PanelShell } from '@/components/PanelShell';
import type { PanelMode } from '@/lib/types';

const BASE_PATHS: Record<PanelMode, string> = {
  admin: '/admin',
  manager: '/manager',
  bidder: '/bidder',
  caller: '/caller',
};

export function PanelLayout({
  mode,
  children,
}: {
  mode: PanelMode;
  children: React.ReactNode;
}) {
  if (mode === 'admin') {
    return (
      <AuthProvider mode={mode}>
        <AdminUiModeProvider>
          <PanelShell mode={mode} basePath={BASE_PATHS[mode]}>
            {children}
          </PanelShell>
        </AdminUiModeProvider>
      </AuthProvider>
    );
  }

  return (
    <AuthProvider mode={mode}>
      <PanelShell mode={mode} basePath={BASE_PATHS[mode]}>
        {children}
      </PanelShell>
    </AuthProvider>
  );
}
