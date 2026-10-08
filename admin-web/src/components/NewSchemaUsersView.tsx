'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { api } from '@/lib/api';

interface ManagedUser {
  u_id: number;
  username: string;
  name: string;
  role: 'admin' | 'manager' | 'caller' | 'account';
  parent_user_id: number | null;
  is_active?: boolean;
  blocked_date?: string | null;
  must_change_password?: boolean;
}

export function NewSchemaUsersView() {
  const { user } = useAuth();
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [role, setRole] = useState<'admin' | 'manager' | 'caller'>(
    user?.role === 'super' ? 'admin' : 'manager'
  );
  const [username, setUsername] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const result = await api<{ success: boolean; users?: ManagedUser[] }>('GET', '/api/v2/users');
    if (result.success) setUsers(result.users || []);
    else setError('Could not load managed users.');
    setLoading(false);
  }, []);

  useEffect(() => {
    // Load the users this role is allowed to manage.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = await api<{ success: boolean; message?: string }>('POST', '/api/v2/users', {
      role,
      username: username.trim(),
      name: name.trim(),
      password,
    });
    if (!result.success) {
      setError(result.message || 'Could not create user.');
      return;
    }
    setUsername('');
    setName('');
    setPassword('');
    setMessage('User created. Give them the temporary password and ask them to change it at first sign-in.');
    setError(null);
    await load();
  }

  async function toggleBlock(target: ManagedUser) {
    const blocked = Boolean(target.is_active);
    const result = await api<{ success: boolean; message?: string }>(
      'PATCH',
      `/api/v2/users/${target.u_id}/block`,
      { blocked }
    );
    if (!result.success) {
      setError(result.message || 'Could not update block status.');
      return;
    }
    await load();
  }

  async function resetPassword(target: ManagedUser) {
    const temporaryPassword = window.prompt(`Enter a temporary password for ${target.name} (minimum 8 characters):`);
    if (!temporaryPassword) return;
    const result = await api<{ success: boolean; message?: string }>(
      'PUT',
      `/api/v2/users/${target.u_id}`,
      { temporaryPassword }
    );
    if (!result.success) {
      setError(result.message || 'Could not reset password.');
      return;
    }
    setMessage(`Temporary password set for ${target.name}. They must change it at next sign-in.`);
    setError(null);
    await load();
  }

  async function remove(target: ManagedUser) {
    if (!window.confirm(`Delete ${target.role} "${target.name}"?`)) return;
    const result = await api<{ success: boolean; message?: string }>('DELETE', `/api/v2/users/${target.u_id}`);
    if (!result.success) {
      setError(result.message || 'Could not delete user.');
      return;
    }
    await load();
  }

  const creatableRoles = user?.role === 'super'
    ? [{ value: 'admin' as const, label: 'Admin' }]
    : [{ value: 'manager' as const, label: 'Manager' }, { value: 'caller' as const, label: 'Caller' }];

  return (
    <>
      {error && <div className="alert alert-error">{error}</div>}
      {message && <div className="alert alert-success">{message}</div>}
      <form className="card" onSubmit={(event) => { void create(event); }} style={{ marginBottom: 16 }}>
        <div className="card-title">Create {role}</div>
        <div className="form-group">
          <label htmlFor="staff-role">Role</label>
          <select id="staff-role" value={role} onChange={(event) => setRole(event.target.value as typeof role)}>
            {creatableRoles.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </div>
        <div className="form-group"><label htmlFor="staff-name">Name</label><input id="staff-name" required value={name} onChange={(event) => setName(event.target.value)} /></div>
        <div className="form-group"><label htmlFor="staff-username">Username</label><input id="staff-username" required value={username} onChange={(event) => setUsername(event.target.value)} /></div>
        <div className="form-group"><label htmlFor="staff-password">Temporary password (minimum 8 characters)</label><input id="staff-password" required minLength={8} type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></div>
        <button className="btn btn-primary" type="submit">Create {role}</button>
      </form>
      <div className="card">
        {loading ? <div className="text-muted">Loading…</div> : (
          <div className="table-scroll"><table>
            <thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Status</th><th>Password</th><th /></tr></thead>
            <tbody>{users.map((target) => {
              const canEdit = user?.role === 'super'
                ? target.role === 'admin'
                : target.role === 'manager' || target.role === 'caller';
              const canBlock = (user?.role === 'super' && (target.role === 'admin' || target.role === 'manager')) ||
                (user?.role === 'admin' && target.role === 'manager');
              return (
                <tr key={target.u_id}>
                  <td>{target.name}</td><td>{target.username}</td><td>{target.role}</td>
                  <td>{target.is_active === false ? 'Blocked' : 'Active'}</td>
                  <td>{target.must_change_password ? 'Must change' : 'Set'}</td>
                  <td className="text-right">
                    {canEdit && <button className="btn btn-ghost btn-sm" type="button" onClick={() => { void resetPassword(target); }}>Reset password</button>}
                    {canBlock && <button className="btn btn-ghost btn-sm" type="button" onClick={() => { void toggleBlock(target); }}>{target.is_active === false ? 'Unblock' : 'Block'}</button>}
                    {canEdit && <button className="btn btn-danger btn-sm" type="button" onClick={() => { void remove(target); }}>Delete</button>}
                  </td>
                </tr>
              );
            })}{!users.length && <tr><td colSpan={6} className="text-muted">No users found.</td></tr>}</tbody>
          </table></div>
        )}
      </div>
    </>
  );
}
