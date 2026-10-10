'use client';

import { LoadingState } from '@/components/LoadingState';

import { DashboardView } from '@/components/DashboardView';
import { DashboardMode2View } from '@/components/DashboardMode2View';
import { DashboardMode3View } from '@/components/DashboardMode3View';
import { useAdminUiMode } from '@/components/AdminUiModeProvider';

export function AdminDashboardRouter() {
  const { adminUiMode, loading } = useAdminUiMode();

  if (loading) return <LoadingState label="Loading dashboard…" size="page" />;
  if (adminUiMode === 'mode2') return <DashboardMode2View />;
  if (adminUiMode === 'mode3') return <DashboardMode3View />;
  return <DashboardView />;
}
