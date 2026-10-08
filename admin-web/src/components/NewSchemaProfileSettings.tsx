'use client';

import { useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { api, setToken } from '@/lib/api';

export function NewSchemaProfileSettings() {
  const { user, updateUser } = useAuth();
  const [username, setUsername] = useState(user?.username || '');
  const [name, setName] = useState(user?.name || '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState(false);

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
      ...(newPassword ? { newPassword } : {}),
    });
    if (!response.success || !response.token || !response.username || !response.name) {
      setMessage(response.message || 'Could not save profile.');
      setError(true);
      return;
    }
    setToken(response.token);
    updateUser({ username: response.username, name: response.name });
    setCurrentPassword('');
    setNewPassword('');
    setMessage('Profile saved.');
    setError(false);
  }

  return (
    <form className="card settings-card" onSubmit={(event) => { void save(event); }}>
      <div className="card-title">My Profile</div>
      <p className="text-muted">Update your display name, username, or password.</p>
      {message && <div className={`alert ${error ? 'alert-error' : 'alert-success'}`}>{message}</div>}
      <div className="form-group"><label htmlFor="profile-name">Name</label><input id="profile-name" required maxLength={200} value={name} onChange={(event) => setName(event.target.value)} /></div>
      <div className="form-group"><label htmlFor="profile-username">Username</label><input id="profile-username" required maxLength={100} value={username} onChange={(event) => setUsername(event.target.value)} /></div>
      <div className="form-group"><label htmlFor="profile-current-password">Current password</label><input id="profile-current-password" type="password" required autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></div>
      <div className="form-group"><label htmlFor="profile-new-password">New password (optional, minimum 8 characters)</label><input id="profile-new-password" type="password" minLength={8} autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></div>
      <button className="btn btn-primary" type="submit">Save Profile</button>
    </form>
  );
}
