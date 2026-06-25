import type { PanelMode } from '@/lib/types';

export type AdminUiMode = 'mode1' | 'mode2' | 'mode3';

export const ADMIN_UI_MODE_SETTING_KEY = 'admin_ui_mode';
export const DEFAULT_ADMIN_UI_MODE: AdminUiMode = 'mode1';

export const ADMIN_UI_MODE_OPTIONS: Array<{
  value: AdminUiMode;
  label: string;
  description: string;
}> = [
  {
    value: 'mode1',
    label: 'Mode 1 — Classic',
    description: 'Current layout: stats, bid bars, jobs table, and recent applications.',
  },
  {
    value: 'mode2',
    label: 'Mode 2 — Analytics',
    description: 'Curve charts, manager/bidder leaderboards, and interview trends.',
  },
  {
    value: 'mode3',
    label: 'Mode 3 — Operations',
    description: 'Calendar-first overview with interviews, bidders, and pipeline focus.',
  },
];

export type AdminNavItem = {
  href: string;
  label: string;
  page: string;
  modes: PanelMode[];
};

const ADMIN_NAV_MODE1: AdminNavItem[] = [
  { href: '', label: '📊 Dashboard', page: 'dashboard', modes: ['admin'] },
  { href: '/jobs', label: '💼 Jobs', page: 'jobs', modes: ['admin'] },
  { href: '/people', label: '👥 People', page: 'people', modes: ['admin'] },
  { href: '/interviews', label: '📅 Interviews', page: 'interviews', modes: ['admin'] },
  { href: '/settings', label: '⚙️ Settings', page: 'settings', modes: ['admin'] },
];

const ADMIN_NAV_MODE2: AdminNavItem[] = [
  { href: '', label: '📊 Analytics', page: 'dashboard', modes: ['admin'] },
  { href: '/people', label: '👥 People', page: 'people', modes: ['admin'] },
  { href: '/interviews', label: '📅 Interviews', page: 'interviews', modes: ['admin'] },
  { href: '/settings', label: '⚙️ Settings', page: 'settings', modes: ['admin'] },
];

const ADMIN_NAV_MODE3: AdminNavItem[] = [
  { href: '', label: '📊 Overview', page: 'dashboard', modes: ['admin'] },
  { href: '/interviews', label: '📅 Interviews', page: 'interviews', modes: ['admin'] },
  { href: '/people', label: '👥 People', page: 'people', modes: ['admin'] },
  { href: '/jobs', label: '💼 Jobs', page: 'jobs', modes: ['admin'] },
  { href: '/settings', label: '⚙️ Settings', page: 'settings', modes: ['admin'] },
];

export function normalizeAdminUiMode(value?: string | null): AdminUiMode {
  if (value === 'mode2' || value === 'mode3') return value;
  return 'mode1';
}

export function getAdminNavItems(uiMode: AdminUiMode): AdminNavItem[] {
  if (uiMode === 'mode2') return ADMIN_NAV_MODE2;
  if (uiMode === 'mode3') return ADMIN_NAV_MODE3;
  return ADMIN_NAV_MODE1;
}

export function adminUiModeLabel(uiMode: AdminUiMode): string {
  return ADMIN_UI_MODE_OPTIONS.find((o) => o.value === uiMode)?.label ?? 'Mode 1';
}
