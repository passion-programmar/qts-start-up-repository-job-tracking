'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, clearToken, setToken, getToken } from '@/lib/api';
import { roleHome } from '@/lib/utils';
import type { UserRole } from '@/lib/types';
import { APP_NAME, LOGO_URL, REDIRECT_GUARD_KEY } from '@/lib/branding';

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const token = getToken();
    if (!token) {
      setChecking(false);
      return;
    }
    (async () => {
      const r = await api<{ success: boolean; role?: UserRole }>('GET', '/api/auth/me');
      if (r.success && r.role) {
        router.replace(roleHome(r.role));
        return;
      }
      clearToken();
      setChecking(false);
    })().catch(() => {
      clearToken();
      setChecking(false);
    });
  }, [router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const r = await api<{
      success: boolean;
      token?: string;
      role?: UserRole;
      message?: string;
    }>('POST', '/api/auth/login', { username: username.trim(), password });

    if (!r.success || !r.token) {
      setError(r.message || 'Login failed.');
      setSubmitting(false);
      return;
    }

    setToken(r.token);
    sessionStorage.removeItem(REDIRECT_GUARD_KEY);
    router.replace(roleHome(r.role || 'bidder'));
  }

  if (checking) {
    return (
      <div className="auth-screen">
        <div className="auth-card login-card">
          <p className="text-muted" style={{ textAlign: 'center', margin: 0 }}>Loading…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-screen">
      <form className="auth-card login-card" onSubmit={handleSubmit}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={LOGO_URL} alt="Logo" className="app-logo-md" />
        <h2>{APP_NAME}</h2>
        <p className="text-muted auth-subtitle">
          Sign in with your role account
        </p>
        {error && <div className="alert alert-error">{error}</div>}
        <div className="form-group">
          <label htmlFor="login-username">Username</label>
          <input
            id="login-username"
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoFocus
          />
        </div>
        <div className="form-group">
          <label htmlFor="login-password">Password</label>
          <input
            id="login-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </div>
        <button className="btn btn-primary btn-block" type="submit" disabled={submitting}>
          {submitting ? 'Logging in…' : 'Log In'}
        </button>
      </form>
    </div>
  );
}
