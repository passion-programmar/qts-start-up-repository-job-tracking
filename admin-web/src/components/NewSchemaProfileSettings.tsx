'use client';

import { useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { api, setToken } from '@/lib/api';

export function NewSchemaProfileSettings() {
  const { user, updateUser } = useAuth();
  const [activeTab, setActiveTab] = useState<'profile' | 'authentication'>('profile');
  const [username, setUsername] = useState(user?.username || '');
  const [name, setName] = useState(user?.name || '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [authCurrentPassword, setAuthCurrentPassword] = useState('');
  const [authNewPassword, setAuthNewPassword] = useState('');
  const [authConfirmPassword, setAuthConfirmPassword] = useState('');
  const [authMessage, setAuthMessage] = useState<string | null>(null);
  const [authError, setAuthError] = useState(false);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const response = await api<{
      success: boolean;
      token?: string;
      username?: string;
      name?: string;
      message?: string;
    }>('PUT', '/api/v2/auth/me', {
      currentPassword,
      username: username.trim(),
      name: name.trim(),
    });
    if (!response.success || !response.token || !response.username || !response.name) {
      setMessage(response.message || 'Could not save profile.');
      setError(true);
      return;
    }
    setToken(response.token);
    updateUser({ username: response.username, name: response.name });
    setCurrentPassword('');
    setMessage('Profile saved.');
    setError(false);
  }

  async function changePassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthMessage(null);
    if (authNewPassword.length < 4) {
      setAuthMessage('New password must be at least 4 characters.');
      setAuthError(true);
      return;
    }
    if (authNewPassword !== authConfirmPassword) {
      setAuthMessage('New password and confirmation do not match.');
      setAuthError(true);
      return;
    }
    const response = await api<{ success: boolean; token?: string; message?: string }>(
      'PUT',
      '/api/v2/auth/change-password',
      { currentPassword: authCurrentPassword, newPassword: authNewPassword }
    );
    if (!response.success || !response.token) {
      setAuthMessage(response.message || 'Could not change password.');
      setAuthError(true);
      return;
    }
    setToken(response.token);
    setAuthCurrentPassword('');
    setAuthNewPassword('');
    setAuthConfirmPassword('');
    setAuthMessage(response.message || 'Password changed.');
    setAuthError(false);
  }

  return (
    <>
      <div className="search-row" role="tablist" aria-label="Profile sections">
        <button
          className={`btn ${activeTab === 'profile' ? 'btn-primary' : 'btn-ghost'}`}
          type="button"
          role="tab"
          aria-selected={activeTab === 'profile'}
          onClick={() => setActiveTab('profile')}
        >
          Profile
        </button>
        <button
          className={`btn ${activeTab === 'authentication' ? 'btn-primary' : 'btn-ghost'}`}
          type="button"
          role="tab"
          aria-selected={activeTab === 'authentication'}
          onClick={() => setActiveTab('authentication')}
        >
          Authentication
        </button>
      </div>
      {activeTab === 'profile' ? (
        <form className="card settings-card" role="tabpanel" onSubmit={(event) => { void save(event); }}>
          <div className="card-title">My Profile</div>
          <p className="text-muted">Update your display name or username.</p>
          {message && <div className={`alert ${error ? 'alert-error' : 'alert-success'}`}>{message}</div>}
          <div className="form-group"><label htmlFor="profile-name">Name</label><input id="profile-name" required maxLength={200} value={name} onChange={(event) => setName(event.target.value)} /></div>
          <div className="form-group"><label htmlFor="profile-username">Username</label><input id="profile-username" required maxLength={100} value={username} onChange={(event) => setUsername(event.target.value)} /></div>
          <div className="form-group"><label htmlFor="profile-current-password">Current password</label><input id="profile-current-password" type="password" required autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></div>
          <button className="btn btn-primary" type="submit">Save Profile</button>
        </form>
      ) : (
        <form className="card settings-card" role="tabpanel" onSubmit={(event) => { void changePassword(event); }}>
          <div className="card-title">Authentication</div>
          <p className="text-muted">Change your password while signed in. Your current password is required.</p>
          {authMessage && <div className={`alert ${authError ? 'alert-error' : 'alert-success'}`}>{authMessage}</div>}
          <div className="form-group"><label htmlFor="auth-current-password">Current password</label><input id="auth-current-password" type="password" required autoComplete="current-password" value={authCurrentPassword} onChange={(event) => setAuthCurrentPassword(event.target.value)} /></div>
          <div className="form-group"><label htmlFor="auth-new-password">New password (minimum 4 characters)</label><input id="auth-new-password" type="password" required minLength={4} maxLength={200} autoComplete="new-password" value={authNewPassword} onChange={(event) => setAuthNewPassword(event.target.value)} /></div>
          <div className="form-group"><label htmlFor="auth-confirm-password">Confirm new password</label><input id="auth-confirm-password" type="password" required minLength={4} maxLength={200} autoComplete="new-password" value={authConfirmPassword} onChange={(event) => setAuthConfirmPassword(event.target.value)} /></div>
          <button className="btn btn-primary" type="submit">Change Password</button>
        </form>
      )}
    </>
  );
}
