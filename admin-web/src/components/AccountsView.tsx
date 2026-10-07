'use client';

import { useCallback, useEffect, useState } from 'react';
import { Modal } from '@/components/Modal';
import { useAuth } from '@/components/AuthProvider';
import { api } from '@/lib/api';
import type { Account, UserAccount } from '@/lib/types';

export function AccountsView() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'super';

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [managers, setManagers] = useState<UserAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<'form' | 'detail' | 'delete' | 'account' | 'editAccount' | 'deleteAccount' | null>(null);
  const [selected, setSelected] = useState<Account | null>(null);
  const [selectedAccount, setSelectedAccount] = useState<{ id: number; username: string; role: string } | null>(null);
  const [detail, setDetail] = useState<{
    accounts: Array<{ id: number; username: string; role: string }>;
    candidates: Array<{ id: number; name: string }>;
  } | null>(null);
  const [form, setForm] = useState({ name: '', notes: '', isActive: true, managerId: '' });
  const [accountForm, setAccountForm] = useState({ username: '', password: '', role: 'account' as 'account' | 'caller' });
  const [accountPassword, setAccountPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await api<{ success: boolean; accounts?: Account[] }>('GET', '/api/accounts');
    setAccounts(r.accounts || []);
    setLoading(false);
  }, []);

  const loadManagers = useCallback(async () => {
    if (!isAdmin) return;
    const r = await api<{ success: boolean; users?: UserAccount[] }>('GET', '/api/users?role=manager');
    setManagers(r.users || []);
  }, [isAdmin]);

  useEffect(() => {
    void load();
    void loadManagers();
  }, [load, loadManagers]);

  async function openDetail(b: Account) {
    const r = await api<{
      success: boolean;
      accounts?: Array<{ id: number; username: string; role: string }>;
      candidates?: Array<{ id: number; name: string }>;
    }>('GET', `/api/accounts/${b.id}`);
    setSelected(b);
    setDetail({ accounts: r.accounts || [], candidates: r.candidates || [] });
    setModal('detail');
  }

  async function saveAccount() {
    if (!form.name.trim()) {
      setError('Name is required.');
      return;
    }
    if (isAdmin && !form.managerId) {
      setError('Manager is required.');
      return;
    }
    const body = {
      name: form.name.trim(),
      notes: form.notes.trim(),
      isActive: form.isActive,
      ...(isAdmin ? { managerId: parseInt(form.managerId, 10) } : {}),
    };
    const r = selected
      ? await api<{ success: boolean; message?: string }>('PUT', `/api/accounts/${selected.id}`, body)
      : await api<{ success: boolean; message?: string }>('POST', '/api/accounts', body);
    if (r.success) {
      setModal(null);
      void load();
    } else {
      setError(r.message || 'Could not save account.');
    }
  }

  async function deleteAccountTeam() {
    if (!selected) return;
    await api('DELETE', `/api/accounts/${selected.id}`);
    setModal(null);
    void load();
  }

  async function updateAccountPassword() {
    if (!selected || !selectedAccount || !accountPassword) {
      setError('New password is required.');
      return;
    }
    const r = await api<{ success: boolean; message?: string }>(
      'PUT',
      `/api/accounts/${selected.id}/logins/${selectedAccount.id}`,
      { password: accountPassword }
    );
    if (r.success) {
      setModal('detail');
      setAccountPassword('');
      setError(null);
    } else {
      setError(r.message || 'Could not update password.');
    }
  }

  async function deleteAccountLogin() {
    if (!selected || !selectedAccount) return;
    const r = await api<{ success: boolean; message?: string }>(
      'DELETE',
      `/api/accounts/${selected.id}/logins/${selectedAccount.id}`
    );
    if (r.success) {
      setModal('detail');
      void openDetail(selected);
    } else {
      alert(r.message || 'Could not delete account.');
    }
  }

  async function addAccount() {
    if (!selected || !accountForm.username || !accountForm.password) {
      setError('Username and password required.');
      return;
    }
    const r = await api<{ success: boolean; message?: string }>(
      'POST',
      `/api/accounts/${selected.id}/logins`,
      accountForm
    );
    if (r.success) {
      setModal('detail');
      void openDetail(selected);
      setAccountForm({ username: '', password: '', role: 'account' });
      setError(null);
    } else {
      setError(r.message || 'Could not create account.');
    }
  }

  function openAddForm() {
    setSelected(null);
    setForm({
      name: '',
      notes: '',
      isActive: true,
      managerId: managers[0] ? String(managers[0].id) : '',
    });
    setError(null);
    setModal('form');
  }

  function openEditForm(b: Account) {
    setSelected(b);
    setForm({
      name: b.name,
      notes: b.notes || '',
      isActive: b.is_active,
      managerId: b.manager_id ? String(b.manager_id) : '',
    });
    setModal('form');
  }

  const colSpan = isAdmin ? 6 : 5;

  return (
    <>
      {!isAdmin && (
        <p className="text-muted" style={{ marginBottom: 12 }}>
          Add Account teams and their login accounts. Candidates belong to the Account team they are created under.
        </p>
      )}
      <div className="search-row">
        <button className="btn btn-primary" type="button" onClick={openAddForm}>
          + Add Account
        </button>
      </div>

      <div className="card">
        {loading ? (
          <div className="text-muted">Loading…</div>
        ) : (
          <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                {isAdmin && <th>Manager</th>}
                <th>Accounts</th>
                <th>Candidates</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {accounts.map((b) => (
                <tr key={b.id}>
                  <td><strong>{b.name}</strong></td>
                  {isAdmin && <td className="text-muted">{b.manager_name || '—'}</td>}
                  <td>{b.account_count ?? 0}</td>
                  <td>{b.candidate_count ?? 0}</td>
                  <td>
                    <span className={`badge ${b.is_active ? 'badge-active' : 'badge-inactive'}`}>
                      {b.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="text-right">
                    <button className="btn btn-ghost btn-sm" type="button" onClick={() => { void openDetail(b); }}>
                      Manage
                    </button>
                    <button className="btn btn-ghost btn-sm" type="button" onClick={() => openEditForm(b)}>
                      Edit
                    </button>
                    {isAdmin && (
                      <button
                        className="btn btn-danger btn-sm"
                        type="button"
                        onClick={() => {
                          setSelected(b);
                          setModal('delete');
                        }}
                      >
                        Delete
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {!accounts.length && (
                <tr><td colSpan={colSpan} className="text-muted">No accounts yet.</td></tr>
              )}
            </tbody>
          </table>
          </div>
        )}
      </div>

      <Modal
        open={modal === 'form'}
        title={selected ? 'Edit Account' : 'Add Account'}
        onClose={() => setModal(null)}
        footer={
          <>
            <button className="btn btn-ghost" type="button" onClick={() => setModal(null)}>Cancel</button>
            <button className="btn btn-primary" type="button" onClick={() => { void saveAccount(); }}>Save</button>
          </>
        }
      >
        {isAdmin && (
          <div className="form-group">
            <label>Manager *</label>
            <select
              value={form.managerId}
              onChange={(e) => setForm({ ...form, managerId: e.target.value })}
            >
              <option value="">— Select manager —</option>
              {managers.map((m) => (
                <option key={m.id} value={m.id}>{m.username}</option>
              ))}
            </select>
            {!managers.length && (
              <p className="text-muted" style={{ marginTop: 6, fontSize: 12 }}>
                No managers yet. Add a manager first from the People page.
              </p>
            )}
          </div>
        )}
        <div className="form-group">
          <label>Name *</label>
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </div>
        <div className="form-group">
          <label>Notes</label>
          <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </div>
        <label className="checkbox-row">
          <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
          Active
        </label>
        {error && <div className="alert alert-error">{error}</div>}
      </Modal>

      <Modal
        open={modal === 'detail'}
        title={`Account: ${selected?.name || ''}`}
        onClose={() => setModal(null)}
        footer={
          <>
            <button className="btn btn-ghost" type="button" onClick={() => setModal('account')}>+ Add Account</button>
            <button className="btn btn-ghost" type="button" onClick={() => setModal(null)}>Close</button>
          </>
        }
      >
        <div className="section-title">Linked Accounts</div>
        <p className="text-muted" style={{ marginBottom: 8, fontSize: 12 }}>
          Account and caller logins for this team. Managers manage their assigned Accounts.
        </p>
        <div className="table-scroll">
        <table>
          <thead><tr><th>Username</th><th>Role</th><th /></tr></thead>
          <tbody>
            {detail?.accounts.map((a) => (
              <tr key={a.id}>
                <td>{a.username}</td>
                <td>{a.role}</td>
                <td className="text-right">
                  {a.role !== 'account' && <button
                    className="btn btn-ghost btn-sm"
                    type="button"
                    onClick={() => {
                      setSelectedAccount(a);
                      setAccountPassword('');
                      setError(null);
                      setModal('editAccount');
                    }}
                  >
                    Reset password
                  </button>}
                  <button
                    className="btn btn-danger btn-sm"
                    type="button"
                    onClick={() => {
                      setSelectedAccount(a);
                      setModal('deleteAccount');
                    }}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {!detail?.accounts.length && (
              <tr><td colSpan={3} className="text-muted">No accounts linked.</td></tr>
            )}
          </tbody>
        </table>
        </div>
        <div className="section-title" style={{ marginTop: 16 }}>Candidates</div>
        <div className="table-scroll">
        <table>
          <thead><tr><th>Name</th></tr></thead>
          <tbody>
            {detail?.candidates.map((c) => (
              <tr key={c.id}><td>{c.name}</td></tr>
            ))}
            {!detail?.candidates.length && (
              <tr><td className="text-muted">No candidates assigned.</td></tr>
            )}
          </tbody>
        </table>
        </div>
      </Modal>

      <Modal
        open={modal === 'account'}
        title="Add Account"
        onClose={() => setModal('detail')}
        footer={
          <>
            <button className="btn btn-ghost" type="button" onClick={() => setModal('detail')}>Cancel</button>
            <button className="btn btn-primary" type="button" onClick={() => { void addAccount(); }}>Create</button>
          </>
        }
      >
        <div className="form-group">
          <label>Username *</label>
          <input value={accountForm.username} onChange={(e) => setAccountForm({ ...accountForm, username: e.target.value })} />
        </div>
        <div className="form-group">
          <label>Password *</label>
          <input type="password" value={accountForm.password} onChange={(e) => setAccountForm({ ...accountForm, password: e.target.value })} />
        </div>
        <div className="form-group">
          <label>Role</label>
          <select value={accountForm.role} onChange={(e) => setAccountForm({ ...accountForm, role: e.target.value as 'account' | 'caller' })}>
            <option value="account">Account</option>
            <option value="caller">Caller</option>
          </select>
        </div>
        {error && <div className="alert alert-error">{error}</div>}
      </Modal>

      <Modal
        open={modal === 'editAccount'}
        title={`Reset password: ${selectedAccount?.username || ''}`}
        onClose={() => setModal('detail')}
        footer={
          <>
            <button className="btn btn-ghost" type="button" onClick={() => setModal('detail')}>Cancel</button>
            <button className="btn btn-primary" type="button" onClick={() => { void updateAccountPassword(); }}>Save</button>
          </>
        }
      >
        <div className="form-group">
          <label>New password *</label>
          <input
            type="password"
            value={accountPassword}
            onChange={(e) => setAccountPassword(e.target.value)}
          />
        </div>
        {error && <div className="alert alert-error">{error}</div>}
      </Modal>

      <Modal
        open={modal === 'deleteAccount'}
        title="Delete Account"
        onClose={() => setModal('detail')}
        footer={
          <>
            <button className="btn btn-ghost" type="button" onClick={() => setModal('detail')}>Cancel</button>
            <button className="btn btn-danger" type="button" onClick={() => { void deleteAccountLogin(); }}>Delete</button>
          </>
        }
      >
        <p className="confirm-text">
          Delete account <strong>{selectedAccount?.username}</strong> from {selected?.name}?
        </p>
      </Modal>

      <Modal
        open={modal === 'delete'}
        title="Delete Account"
        onClose={() => setModal(null)}
        footer={
          <>
            <button className="btn btn-ghost" type="button" onClick={() => setModal(null)}>Cancel</button>
            <button className="btn btn-danger" type="button" onClick={() => { void deleteAccountTeam(); }}>Delete</button>
          </>
        }
      >
        <p className="confirm-text">Delete <strong>{selected?.name}</strong>? Accounts will be unlinked.</p>
      </Modal>
    </>
  );
}
