'use client';

import Link from 'next/link';
import { Dropdown } from 'antd';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth, roleLabel } from '@/components/AuthProvider';
import { api } from '@/lib/api';
import { panelLogoUrl } from '@/lib/branding';
import type { PanelMode, UserRole } from '@/lib/types';

type NavItem = {
  href: string;
  label: string;
  icon: NavIconName;
  page: string;
  modes: PanelMode[];
  roles?: UserRole[];
};

type NavIconName =
  | 'briefcase'
  | 'file'
  | 'chart'
  | 'database'
  | 'template'
  | 'message'
  | 'user'
  | 'team'
  | 'tag'
  | 'calendar'
  | 'settings';

const NAV_ITEMS: NavItem[] = [
  { href: '/jobs', label: 'Jobs', icon: 'briefcase', page: 'jobs', modes: ['admin', 'manager'] },
  { href: '/bid-status', label: 'Bids', icon: 'file', page: 'bid-status', modes: ['manager'] },
  { href: '/analytics', label: 'Analytics', icon: 'chart', page: 'analytics', modes: ['admin', 'manager'] },
  { href: '/database', label: 'Database', icon: 'database', page: 'database', modes: ['admin'], roles: ['super'] },
  { href: '/application-templates', label: 'Template Review', icon: 'template', page: 'application-templates', modes: ['admin'], roles: ['super'] },
  { href: '/prompts', label: 'Prompts', icon: 'message', page: 'prompts', modes: ['admin'], roles: ['super'] },
  { href: '/accounts', label: 'Account Profiles', icon: 'user', page: 'accounts', modes: ['manager'] },
  { href: '/pdfs', label: 'PDFs', icon: 'file', page: 'pdfs', modes: ['manager'] },
  { href: '/application-profile', label: 'Application Answers', icon: 'message', page: 'application-profile', modes: ['manager'] },
  { href: '/people', label: 'People', icon: 'team', page: 'people', modes: ['admin'] },
  { href: '/categories', label: 'Categories', icon: 'tag', page: 'categories', modes: ['admin'] },
  { href: '/interviews', label: 'Interviews', icon: 'calendar', page: 'interviews', modes: ['admin', 'manager', 'caller'] },
  { href: '/settings', label: 'My Profile', icon: 'settings', page: 'settings', modes: ['admin', 'manager', 'caller'] },
];

const NAV_ICON_PATHS: Record<NavIconName, string[]> = {
  briefcase: ['M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2', 'M3 9h18v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9Z', 'M3 13h18', 'M10 13v2h4v-2'],
  file: ['M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z', 'M14 2v6h6', 'M8 13h8', 'M8 17h8'],
  chart: ['M4 19V5', 'M4 19h17', 'm7 15 4-4 3 2 6-7', 'M17 6h3v3'],
  database: ['M12 3c4.4 0 8 1.3 8 3s-3.6 3-8 3-8-1.3-8-3 3.6-3 8-3Z', 'M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6', 'M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3'],
  template: ['M3 3h8v8H3z', 'M13 3h8v5h-8z', 'M13 10h8v11h-8z', 'M3 13h8v8H3z'],
  user: ['M20 21a8 8 0 0 0-16 0', 'M12 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z'],
  message: ['M21 11.5a8.5 8.5 0 0 1-12.7 7.4L3 21l2.1-5.3A8.5 8.5 0 1 1 21 11.5Z', 'M8 11h8', 'M8 15h5'],
  team: ['M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2', 'M10 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z', 'M20 21v-2a4 4 0 0 0-3-3.9', 'M16 3.1a4 4 0 0 1 0 7.8'],
  tag: ['m20.6 13.4-7.2 7.2a2 2 0 0 1-2.8 0l-8.2-8.2A2 2 0 0 1 2 11V4a2 2 0 0 1 2-2h7a2 2 0 0 1 1.4.6l8.2 8.2a2 2 0 0 1 0 2.6Z', 'M7 7h.01'],
  calendar: ['M8 2v4', 'M16 2v4', 'M3 10h18', 'M5 4h14a2 2 0 0 1 2 2v14H3V6a2 2 0 0 1 2-2Z', 'M8 14h.01', 'M12 14h.01', 'M16 14h.01'],
  settings: ['M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z', 'm19.4 15 .1.1a2 2 0 1 1-2.8 2.8l-.1-.1a2 2 0 0 0-3.4 1.4v.3a2 2 0 1 1-4 0v-.2A2 2 0 0 0 5.8 17l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a2 2 0 0 0-1.4-3.4h-.3a2 2 0 1 1 0-4h.2A2 2 0 0 0 3 4.2l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a2 2 0 0 0 3.4-1.4v-.3a2 2 0 1 1 4 0v.2a2 2 0 0 0 3.4 1.4l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a2 2 0 0 0 1.4 3.4h.3a2 2 0 1 1 0 4h-.2a2 2 0 0 0-1.5 3.5Z'],
};

function NavIcon({ name }: { name: NavIconName }) {
  return (
    <svg
      className="nav-item__icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {NAV_ICON_PATHS[name].map((path) => <path key={path} d={path} />)}
    </svg>
  );
}

const PAGE_TITLES: Record<string, string> = {
  dashboard: 'Dashboard',
  candidates: 'Candidates',
  jobs: 'Jobs',
  analytics: 'Analytics',
  accounts: 'Custom GPT',
  database: 'Database Records',
  'application-templates': 'Template Review',
  prompts: 'Scanner Prompts',
  people: 'People',
  categories: 'Categories',
  interviews: 'Interview Process',
  settings: 'Settings',
  'application-profile': 'Application Answers',
  pdfs: 'PDFs',
  'bid-status': 'Bids',
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);

  const navItems = useMemo(() => {
    return NAV_ITEMS.filter((item) =>
      item.modes.includes(mode) && (!item.roles || (user && item.roles.includes(user.role)))
    );
  }, [mode, user]);

  const page = resolvePage(pathname, basePath);
  const title = page === 'accounts' && mode === 'manager'
    ? 'Accounts'
    : PAGE_TITLES[page] || 'Dashboard';

  const closeNav = useCallback(() => setNavOpen(false), []);
  const toggleSidebar = () => {
    if (window.matchMedia('(max-width: 767px)').matches) {
      setNavOpen((open) => !open);
      return;
    }

    setSidebarCollapsed((collapsed) => !collapsed);
  };

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

  const role = roleLabel(user?.role || mode);
  const accountName = user?.name || user?.username || role;
  const accountMenuItems = [
    ...(mode !== 'account' ? [{ key: 'profile', label: <Link href={basePath + '/settings'}>My Profile</Link> }, { type: 'divider' as const }] : []),
    { key: 'logout', label: 'Log Out', danger: true },
  ];

  return (
    <div id="app" className={sidebarCollapsed ? 'sidebar-collapsed' : undefined}>
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
                aria-current={active ? 'page' : undefined}
                onClick={closeNav}
              >
                <NavIcon name={item.icon} />
                <span className="nav-item__label">{item.label}</span>
              </Link>
            );
          })}
        </nav>
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
        <header className="topbar">
          <div className="topbar-left">
            <button
              type="button"
              className="menu-btn"
              aria-label={navOpen ? 'Close menu' : sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
              aria-expanded={navOpen || !sidebarCollapsed}
              onClick={toggleSidebar}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <h1 className="topbar-title">{title}</h1>
          </div>
          <div className="topbar-right">
            <div className="topbar-status" role="status" aria-label={'API status: ' + (online ? 'Connected' : 'Offline')}>
              <span className={'dot ' + (online ? 'dot-green' : 'dot-red')} aria-hidden="true" />
              {online ? 'Connected' : 'Offline'}
            </div>
            <Dropdown
              trigger={['click']}
              placement="bottomRight"
              open={accountMenuOpen}
              onOpenChange={setAccountMenuOpen}
              menu={{
                id: 'qts-account-menu',
                items: accountMenuItems,
                onClick: ({ key }) => {
                  if (key === 'logout') void logout();
                },
              }}
            >
              <button
                type="button"
                className="topbar-account"
                aria-label={'Account menu for ' + accountName + ', ' + role}
                aria-haspopup="menu"
                aria-expanded={accountMenuOpen}
                aria-controls="qts-account-menu"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <path d="M20 21a8 8 0 0 0-16 0" />
                  <circle cx="12" cy="8" r="4" />
                </svg>
                <span className="topbar-account__name">{accountName}</span>
                <span className="topbar-account__role">{role}</span>
                <svg className="topbar-account__chevron" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="m4 6 4 4 4-4" /></svg>
              </button>
            </Dropdown>
          </div>
        </header>
        <div className="content">{children}</div>
      </main>
    </div>
  );
}
