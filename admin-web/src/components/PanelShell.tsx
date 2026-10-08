'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth, roleLabel } from '@/components/AuthProvider';
import { api } from '@/lib/api';
import { panelLogoUrl } from '@/lib/branding';
import type { PanelMode } from '@/lib/types';

type NavItem = {
  href: string;
  label: string;
  page: string;
  modes: PanelMode[];
};

const NAV_ITEMS: NavItem[] = [
  { href: '/jobs', label: '💼 Jobs', page: 'jobs', modes: ['admin', 'manager'] },
  { href: '/accounts', label: '👤 Account Profiles', page: 'accounts', modes: ['manager'] },
  { href: '/people', label: '👥 People', page: 'people', modes: ['admin'] },
  { href: '/categories', label: '🏷️ Categories', page: 'categories', modes: ['admin'] },
  { href: '/interviews', label: '📅 Interviews', page: 'interviews', modes: ['admin', 'manager', 'caller'] },
  { href: '/settings', label: '⚙️ My Profile', page: 'settings', modes: ['admin', 'manager', 'caller'] },
];

const PAGE_TITLES: Record<string, string> = {
  dashboard: 'Dashboard',
  candidates: 'Candidates',
  jobs: 'Jobs',
  accounts: 'Custom GPT',
  database: 'Database Records',
  people: 'People',
  categories: 'Categories',
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
  const [online, setOnline] = useState(true);
  const [navOpen, setNavOpen] = useState(false);

  const navItems = useMemo(() => {
    return NAV_ITEMS.filter((item) => item.modes.includes(mode));
  }, [mode]);

  const page = resolvePage(pathname, basePath);
  const title = page === 'accounts' && mode === 'manager'
    ? 'Accounts'
    : PAGE_TITLES[page] || 'Dashboard';

  const closeNav = useCallback(() => setNavOpen(false), []);

  useEffect(() => {
    // Keep the mobile navigation synchronized with client-side route changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      try {
        const r = await api<{ success: boolean }>('GET', '/api/health');
        if (!cancelled) setOnline(r.success);
      } catch {
        if (!cancelled) setOnline(false);
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void check();
    };
    void check();
    const id = setInterval(() => { void check(); }, 30000);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled = true;
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisibility);
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
      <main className="main">
        {!canWrite && mode === 'manager' && (
          <div className="read-only-banner">
            Manager mode — team management and analytics. Full platform settings require admin.
          </div>
        )}
        {!canWrite && mode === 'account' && (
          <div className="read-only-banner">
            Account mode — you can add jobs. Candidates are managed by your manager.
          </div>
        )}
        {mode === 'caller' && (
          <div className="read-only-banner">
            Caller mode — view assigned interviews and submit outcomes only.
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
            <span className={`dot ${online ? 'dot-green' : 'dot-red'}`} />
            {online ? 'Connected' : 'Offline'}
          </div>
        </div>
        <div className="content">{children}</div>
      </main>
    </div>
  );
}
