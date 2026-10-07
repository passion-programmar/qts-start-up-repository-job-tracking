'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { Modal } from '@/components/Modal';
import { PasswordField } from '@/components/PasswordField';
import { api } from '@/lib/api';
import type { UserAccount } from '@/lib/types';

export function SuperAdminAccountsView() {
  const { user } = useAuth();
  const [admins, setAdmins] = useState<UserAccount[]>([]);
  const [selected, setSelected] = useState<UserAccount | null>(null);
  const [modal, setModal] = useState<'form' | 'delete' | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const response = await api<{ success: boolean; users?: UserAccount[] }>('GET', '/api/users?role=admin');
    setAdmins(response.users || []);
  }, []);

  useEffect(() => {
    if (user?.role !== 'super') return undefined;
    let active = true;
    void api<{ success: boolean; users?: UserAccount[] }>('GET', '/api/users?role=admin').then((response) => {
      if (active) setAdmins(response.users || []);
    });
    return () => {
      active = false;
    };
  }, [user?.role]);

  if (user?.role !== 'super') return null;

  function openCreate() {
    setSelected(null);
    setUsername('');
    setPassword('');
    setIsActive(true);
    setError('');
    setModal('form');
  }

  function openEdit(admin: UserAccount) {
    setSelected(admin);
    setUsername(admin.username);
    setPassword('');
    setIsActive(admin.is_active !== false);
    setError('');
    setModal('form');
  }

  async function save() {
    if (!selected && !password) {
      setError('Password is required for a new Admin.');
      return;
    }
    const body = {
      username: username.trim(),
      role: 'admin',
      accountId: null,
      isActive,
      ...(password ? { password } : {}),
    };
    const response = selected
      ? await api<{ success: boolean; message?: string }>('PUT', `/api/users/${selected.id}`, body)
      : await api<{ success: boolean; message?: string }>('POST', '/api/users', body);
    if (!response.success) {
      setError(response.message || 'Could not save Admin account.');
      return;
    }
    setModal(null);
    await load();
  }

  async function remove() {
    if (!selected) return;
    const response = await api<{ success: boolean; message?: string }>('DELETE', `/api/users/${selected.id}`);
    if (!response.success) {
      setError(response.message || 'Could not delete Admin account.');
      return;
    }
    setModal(null);
    await load();
  }

  return (
    <section className="card" style={{ marginBottom: 16 }}>
      <div className="search-row">
        <h2 className="section-title">Admin accounts</h2>
        <button className="btn btn-primary" type="button" onClick={openCreate}>+ Add Admin</button>
      </div>
      <div className="table-scroll">
        <table>
          <thead><tr><th>Username</th><th>Status</th><th /></tr></thead>
          <tbody>
            {admins.map((admin) => (
              <tr key={admin.id}>
                <td>{admin.username}</td>
                <td>{admin.is_active === false ? 'Inactive' : 'Active'}</td>
                <td className="text-right">
                  <button className="btn btn-ghost btn-sm" type="button" onClick={() => openEdit(admin)}>Edit</button>
                  <button className="btn btn-danger btn-sm" type="button" onClick={() => { setSelected(admin); setError(''); setModal('delete'); }}>Delete</button>
                </td>
              </tr>
            ))}
            {!admins.length && <tr><td colSpan={3} className="text-muted">No Admin accounts yet.</td></tr>}
          </tbody>
        </table>
      </div>
      <Modal
        open={modal === 'form'}
        title={selected ? `Edit Admin: ${selected.username}` : 'Add Admin'}
        onClose={() => setModal(null)}
        footer={
          <>
            <button className="btn btn-ghost" type="button" onClick={() => setModal(null)}>Cancel</button>
            <button className="btn btn-primary" type="button" onClick={() => { void save(); }}>Save</button>
          </>
        }
      >
        <div className="form-group">
          <label>Username *</label>
          <input value={username} disabled={Boolean(selected)} onChange={(event) => setUsername(event.target.value)} />
        </div>
        <div className="form-group">
          <label>{selected ? 'New password (optional)' : 'Password *'}</label>
          <PasswordField value={password} onChange={setPassword} />
        </div>
        <label className="checkbox-row">
          <input type="checkbox" checked={isActive} onChange={(event) => setIsActive(event.target.checked)} />
          Active
        </label>
        {error && <div className="alert alert-error">{error}</div>}
      </Modal>
      <Modal
        open={modal === 'delete'}
        title="Delete Admin"
        onClose={() => setModal(null)}
        footer={
          <>
            <button className="btn btn-ghost" type="button" onClick={() => setModal(null)}>Cancel</button>
            <button className="btn btn-danger" type="button" onClick={() => { void remove(); }}>Delete</button>
          </>
        }
      >
        <p className="confirm-text">Delete Admin <strong>{selected?.username}</strong>?</p>
        {error && <div className="alert alert-error">{error}</div>}
      </Modal>
    </section>
  );
}
