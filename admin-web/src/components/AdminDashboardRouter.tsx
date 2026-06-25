'use client';

import { DashboardView } from '@/components/DashboardView';
import { DashboardMode2View } from '@/components/DashboardMode2View';
import { DashboardMode3View } from '@/components/DashboardMode3View';
import { useAdminUiMode } from '@/components/AdminUiModeProvider';

export function AdminDashboardRouter() {
  const { adminUiMode, loading } = useAdminUiMode();

  if (loading) return <div className="text-muted">Loading dashboard…</div>;
  if (adminUiMode === 'mode2') return <DashboardMode2View />;
  if (adminUiMode === 'mode3') return <DashboardMode3View />;
  return <DashboardView />;
}
