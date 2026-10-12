'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { PasswordField } from '@/components/PasswordField';
import { api, setToken } from '@/lib/api';

export function NewSchemaProfileSettings() {
  const { user, updateUser } = useAuth();
  const [activeTab, setActiveTab] = useState<'profile' | 'authentication' | 'applications'>('profile');
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
  const [submissionMode, setSubmissionMode] = useState<'manual' | 'auto'>('manual');

  useEffect(() => {
    if (user?.role !== 'super') return;
    void api<{ success: boolean; settings?: Record<string, string> }>('GET', '/api/v2/settings')
      .then((response) => {
        if (response.success && (response.settings?.application_submission_mode === 'manual' ||
          response.settings?.application_submission_mode === 'auto')) {
          setSubmissionMode(response.settings.application_submission_mode);
        }
      });
  }, [user?.role]);

  async function saveApplicationMode(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const response = await api<{ success: boolean; message?: string }>(
      'PUT',
      '/api/v2/settings',
      { settings: { application_submission_mode: submissionMode } }
    );
    setMessage(response.success ? 'Application submission mode saved.' : response.message || 'Could not save application mode.');
    setError(!response.success);
  }

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
        {user?.role === 'super' && (
          <button
            className={`btn ${activeTab === 'applications' ? 'btn-primary' : 'btn-ghost'}`}
            type="button"
            role="tab"
            aria-selected={activeTab === 'applications'}
            onClick={() => setActiveTab('applications')}
          >
            Application Automation
          </button>
        )}
      </div>
      {activeTab === 'applications' && user?.role === 'super' ? (
        <form className="card settings-card" role="tabpanel" onSubmit={(event) => { void saveApplicationMode(event); }}>
          <div className="card-title">Global Application Submission Mode</div>
          <p className="text-muted">
            Manual is the default and requires review before submission. Auto mode may submit only when all required answers are known and valid.
          </p>
          {message && <div className={`alert ${error ? 'alert-error' : 'alert-success'}`}>{message}</div>}
          <div className="form-group">
            <label htmlFor="application-submission-mode">Submission mode</label>
            <select id="application-submission-mode" value={submissionMode}
              onChange={(event) => setSubmissionMode(event.target.value as 'manual' | 'auto')}>
              <option value="manual">Manual review (default)</option>
              <option value="auto">Automatic submission when all answers are known</option>
            </select>
          </div>
          <button className="btn btn-primary" type="submit">Save Submission Mode</button>
        </form>
      ) : activeTab === 'profile' ? (
        <form className="card settings-card" role="tabpanel" onSubmit={(event) => { void save(event); }}>
          <div className="card-title">My Profile</div>
          <p className="text-muted">Update your display name or username.</p>
          {message && <div className={`alert ${error ? 'alert-error' : 'alert-success'}`}>{message}</div>}
          <div className="form-group"><label htmlFor="profile-name">Name</label><input id="profile-name" required maxLength={200} value={name} onChange={(event) => setName(event.target.value)} /></div>
          <div className="form-group"><label htmlFor="profile-username">Username</label><input id="profile-username" required maxLength={100} value={username} onChange={(event) => setUsername(event.target.value)} /></div>
          <div className="form-group"><label htmlFor="profile-current-password">Current password</label><PasswordField id="profile-current-password" required autoComplete="current-password" value={currentPassword} onChange={setCurrentPassword} /></div>
          <button className="btn btn-primary" type="submit">Save Profile</button>
        </form>
      ) : (
        <form className="card settings-card" role="tabpanel" onSubmit={(event) => { void changePassword(event); }}>
          <div className="card-title">Authentication</div>
          <p className="text-muted">Change your password while signed in. Your current password is required.</p>
          {authMessage && <div className={`alert ${authError ? 'alert-error' : 'alert-success'}`}>{authMessage}</div>}
          <div className="form-group"><label htmlFor="auth-current-password">Current password</label><PasswordField id="auth-current-password" required autoComplete="current-password" value={authCurrentPassword} onChange={setAuthCurrentPassword} /></div>
          <div className="form-group"><label htmlFor="auth-new-password">New password (minimum 4 characters)</label><PasswordField id="auth-new-password" required minLength={4} maxLength={200} autoComplete="new-password" value={authNewPassword} onChange={setAuthNewPassword} /></div>
          <div className="form-group"><label htmlFor="auth-confirm-password">Confirm new password</label><PasswordField id="auth-confirm-password" required minLength={4} maxLength={200} autoComplete="new-password" value={authConfirmPassword} onChange={setAuthConfirmPassword} /></div>
          <button className="btn btn-primary" type="submit">Change Password</button>
        </form>
      )}
    </>
  );
}
