'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, clearToken, getToken, setToken } from '@/lib/api';
import { roleHome } from '@/lib/utils';
import type { UserRole } from '@/lib/types';
import { APP_NAME, LOGO_URL } from '@/lib/branding';

export default function ChangePasswordPage() {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [role, setRole] = useState<UserRole | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/login');
      return;
    }
    void api<{ success: boolean; role?: UserRole; mustChangePassword?: boolean }>(
      'GET',
      '/api/v2/auth/me'
    ).then((result) => {
      if (!result.success || !result.role) {
        clearToken();
        router.replace('/login');
        return;
      }
      setRole(result.role);
      if (!result.mustChangePassword) router.replace(roleHome(result.role));
    });
  }, [router]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (newPassword.length < 8) {
      setError('New password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('New password and confirmation do not match.');
      return;
    }
    setSubmitting(true);
    const result = await api<{ success: boolean; token?: string; message?: string }>(
      'PUT',
      '/api/v2/auth/change-password',
      { currentPassword, newPassword }
    );
    if (!result.success || !result.token) {
      setError(result.message || 'Could not change password.');
      setSubmitting(false);
      return;
    }
    setToken(result.token);
    router.replace(roleHome(role || 'manager'));
  }

  return (
    <div className="auth-screen">
      <form className="auth-card login-card" onSubmit={(event) => { void submit(event); }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={LOGO_URL} alt="Logo" className="app-logo-md" />
        <h2>{APP_NAME}</h2>
        <p className="text-muted auth-subtitle">Set a new password to continue.</p>
        {error && <div className="alert alert-error">{error}</div>}
        <div className="form-group">
          <label htmlFor="current-password">Temporary/current password</label>
          <input
            id="current-password"
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            required
          />
        </div>
        <div className="form-group">
          <label htmlFor="new-password">New password (minimum 8 characters)</label>
          <input
            id="new-password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            required
          />
        </div>
        <div className="form-group">
          <label htmlFor="confirm-password">Confirm new password</label>
          <input
            id="confirm-password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            required
          />
        </div>
        <button className="btn btn-primary btn-block" type="submit" disabled={submitting}>
          {submitting ? 'Saving…' : 'Change Password'}
        </button>
      </form>
    </div>
  );
}
