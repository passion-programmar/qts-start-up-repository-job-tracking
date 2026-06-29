'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth, roleLabel } from '@/components/AuthProvider';
import { useAdminUiMode } from '@/components/AdminUiModeProvider';
import { api } from '@/lib/api';
import { adminUiModeLabel, getAdminNavItems } from '@/lib/admin-ui-mode';
import { panelLogoUrl } from '@/lib/branding';
import type { PanelMode } from '@/lib/types';

type NavItem = {
  href: string;
  label: string;
  page: string;
  modes: PanelMode[];
};

const NAV_ITEMS: NavItem[] = [
  { href: '', label: '📊 Dashboard', page: 'dashboard', modes: ['admin', 'manager', 'bidder'] },
  { href: '/candidates', label: '👥 Candidates', page: 'candidates', modes: ['bidder'] },
  { href: '/jobs', label: '💼 Jobs', page: 'jobs', modes: ['admin', 'manager', 'bidder'] },
  { href: '/bidders', label: '🏢 Bidders', page: 'bidders', modes: ['manager'] },
  { href: '/people', label: '👥 People', page: 'people', modes: ['admin'] },
  { href: '/interviews', label: '📅 Interviews', page: 'interviews', modes: ['admin', 'manager', 'caller'] },
  { href: '/settings', label: '⚙️ Settings', page: 'settings', modes: ['admin'] },
];

const PAGE_TITLES: Record<string, string> = {
  dashboard: 'Dashboard',
  candidates: 'Candidates',
  jobs: 'Jobs',
  bidders: 'Custom GPT',
  people: 'People',
  interviews: 'Interview Process',
  settings: 'Settings',
};

function resolvePage(pathname: string, base: string): string {
  const rest = pathname.replace(base, '').replace(/^\//, '');
  if (!rest) return 'dashboard';
  return rest.split('/')[0];
}

export function PanelShell({
  mode,
  basePath,
  children,
}: {
  mode: PanelMode;
  basePath: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { user, canWrite, logout } = useAuth();
  const { adminUiMode } = useAdminUiMode();
  const [online, setOnline] = useState(true);
  const [navOpen, setNavOpen] = useState(false);

  const navItems = useMemo(() => {
    if (mode === 'admin') return getAdminNavItems(adminUiMode);
    return NAV_ITEMS.filter((item) => item.modes.includes(mode));
  }, [mode, adminUiMode]);

  const page = resolvePage(pathname, basePath);
  const title = PAGE_TITLES[page] || 'Dashboard';

  const closeNav = useCallback(() => setNavOpen(false), []);

  useEffect(() => {
    closeNav();
  }, [pathname, closeNav]);

  useEffect(() => {
    if (!navOpen) return undefined;
    const mq = window.matchMedia('(max-width: 767px)');
    if (!mq.matches) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [navOpen]);

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)');
    const onChange = () => {
      if (mq.matches) closeNav();
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [closeNav]);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const r = await api<{ success: boolean }>('GET', '/api/health');
        if (!cancelled) setOnline(r.success);
      } catch {
        if (!cancelled) setOnline(false);
      }
    };
    void check();
    const id = setInterval(() => { void check(); }, 30000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const roleCls =
    mode === 'admin' ? 'role-admin' : mode === 'manager' ? 'role-admin' : mode === 'caller' ? 'role-user' : 'role-user';

  return (
    <div id="app">
      <button
        type="button"
        className={`sidebar-backdrop${navOpen ? ' is-visible' : ''}`}
        aria-label="Close menu"
        aria-hidden={!navOpen}
        tabIndex={navOpen ? 0 : -1}
        onClick={closeNav}
      />
      <aside className={`sidebar${navOpen ? ' is-open' : ''}`}>
        <div className="sidebar-brand">
          <button
            type="button"
            className="sidebar-close"
            aria-label="Close menu"
            onClick={closeNav}
          >
            ×
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={panelLogoUrl(mode)} alt="Logo" />
        </div>
        <nav className="sidebar-nav" aria-label="Main navigation">
          {navItems.map((item) => {
            const href = `${basePath}${item.href}`;
            const active = page === item.page;
            return (
              <Link
                key={item.page}
                href={href}
                className={`nav-item${active ? ' active' : ''}`}
                onClick={closeNav}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="sidebar-footer">
          <div className="text-muted" id="sidebar-user">
            👤 {user?.username}{' '}
            <span className={`role-badge ${roleCls}`}>{roleLabel(user?.role || mode)}</span>
          </div>
          <button className="logout-btn" type="button" onClick={() => { void logout(); }}>
            Log Out
          </button>
        </div>
      </aside>
      <main className="main" data-admin-ui-mode={mode === 'admin' ? adminUiMode : undefined}>
        {!canWrite && mode === 'manager' && (
          <div className="read-only-banner">
            Manager mode — team management and analytics. Full platform settings require admin.
          </div>
        )}
        {!canWrite && mode === 'bidder' && (
          <div className="read-only-banner">
            Bidder mode — you can add jobs. Candidates are managed by your manager.
          </div>
        )}
        {!canWrite && mode === 'caller' && (
          <div className="read-only-banner">
            Caller mode — you can add interview records. Edit and delete require admin.
          </div>
        )}
        <div className="topbar">
          <div className="topbar-left">
            <button
              type="button"
              className="menu-btn"
              aria-label="Open menu"
              aria-expanded={navOpen}
              onClick={() => setNavOpen(true)}
            >
              ☰
            </button>
            <h1>{title}</h1>
          </div>
          <div className="topbar-status">
            {mode === 'admin' && (
              <span className="mode-pill">{adminUiModeLabel(adminUiMode)}</span>
            )}
            <span className={`dot ${online ? 'dot-green' : 'dot-red'}`} />
            {online ? 'Connected' : 'Offline'}
          </div>
        </div>
        <div className="content">{children}</div>
      </main>
    </div>
  );
}
