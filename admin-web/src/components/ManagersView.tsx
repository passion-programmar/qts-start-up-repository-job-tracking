'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal } from '@/components/Modal';
import { PasswordField } from '@/components/PasswordField';
import {
  buildManagerTree,
  CallerBranch,
  GROUP_CALLERS,
  GROUP_MANAGERS,
  isCallerAccount,
  isManagerAccount,
  isTreeEntityActive,
  ManagerBranch,
  RoleGroupCard,
} from '@/components/org-tree';
import { api } from '@/lib/api';
import type { Bidder, Candidate, UserAccount } from '@/lib/types';

export function ManagersView() {
  const [managers, setManagers] = useState<UserAccount[]>([]);
  const [callers, setCallers] = useState<UserAccount[]>([]);
  const [bidders, setBidders] = useState<Bidder[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [modal, setModal] = useState<'form' | 'delete' | null>(null);
  const [selected, setSelected] = useState<UserAccount | null>(null);
  const [form, setForm] = useState({ username: '', password: '', isActive: true });
  const [savedPassword, setSavedPassword] = useState('');
  const [formLoading, setFormLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const managerTree = useMemo(
    () => buildManagerTree(managers, bidders, candidates),
    [managers, bidders, candidates]
  );

  const callerList = useMemo(
    () => [...callers].filter(isCallerAccount).sort((a, b) => a.username.localeCompare(b.username)),
    [callers]
  );

  const load = useCallback(async () => {
    setLoading(true);
    const [usersRes, biddersRes, candidatesRes] = await Promise.all([
      api<{ success: boolean; users?: UserAccount[] }>('GET', '/api/users'),
      api<{ success: boolean; bidders?: Bidder[] }>('GET', '/api/bidders'),
      api<{ success: boolean; candidates?: Candidate[] }>('GET', '/api/candidates'),
    ]);

    const allUsers = usersRes.users || [];
    setManagers(allUsers.filter(isManagerAccount));
    setCallers(allUsers.filter(isCallerAccount));
    setBidders(biddersRes.bidders || []);
    setCandidates(candidatesRes.candidates || []);
    setExpanded((prev) => {
      if (Object.keys(prev).length > 0) return prev;
      return { [GROUP_MANAGERS]: true, [GROUP_CALLERS]: false };
    });
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function toggleExpanded(key: string) {
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function expandAll() {
    const next: Record<string, boolean> = {
      [GROUP_MANAGERS]: true,
      [GROUP_CALLERS]: true,
    };
    for (const node of managerTree) {
      if (!isTreeEntityActive(node.manager.is_active)) continue;
      next[`m-${node.manager.id}`] = true;
      for (const bidderNode of node.bidders) {
        if (isTreeEntityActive(bidderNode.bidder.is_active)) {
          next[`b-${bidderNode.bidder.id}`] = true;
        }
      }
    }
    for (const caller of callerList) {
      next[`c-${caller.id}`] = true;
    }
    setExpanded(next);
  }

  function collapseAll() {
    setExpanded({});
  }

  async function openEditManager(manager: UserAccount) {
    setSelected(manager);
    setForm({ username: manager.username, password: '', isActive: isTreeEntityActive(manager.is_active) });
    setSavedPassword('');
    setError(null);
    setFormLoading(true);
    setModal('form');

    const r = await api<{
      success: boolean;
      message?: string;
      user?: { username: string; password?: string | null; is_active?: boolean };
    }>('GET', `/api/users/${manager.id}`);

    setFormLoading(false);
    if (!r.success) {
      setError(r.message || 'Could not load saved password.');
      return;
    }

    const password = r.user?.password ?? '';
    setForm({
      username: r.user?.username || manager.username,
      password,
      isActive: isTreeEntityActive(r.user?.is_active ?? manager.is_active),
    });
    setSavedPassword(password);
  }

  function openAddManager() {
    setSelected(null);
    setForm({ username: '', password: '', isActive: true });
    setSavedPassword('');
    setError(null);
    setFormLoading(false);
    setModal('form');
  }

  async function saveManager() {
    if (!form.username.trim()) {
      setError('Username is required.');
      return;
    }
    if (!selected && !form.password) {
      setError('Password is required for new managers.');
      return;
    }
    const passwordChanged = Boolean(selected && form.password !== savedPassword);
    const body = {
      username: form.username.trim(),
      role: 'manager' as const,
      bidderId: null,
      isActive: form.isActive,
      ...(!selected
        ? { password: form.password }
        : passwordChanged && form.password
          ? { password: form.password }
          : {}),
    };
    const r = selected
      ? await api<{ success: boolean; message?: string }>('PUT', `/api/users/${selected.id}`, body)
      : await api<{ success: boolean; message?: string }>('POST', '/api/users', { ...body, password: form.password });
    if (r.success) {
      setModal(null);
      void load();
    } else {
      setError(r.message || 'Could not save manager.');
    }
  }

  async function deleteManager() {
    if (!selected) return;
    const r = await api<{ success: boolean; message?: string }>('DELETE', `/api/users/${selected.id}`);
    if (r.success) {
      setModal(null);
      void load();
    } else {
      alert(r.message || 'Could not delete manager.');
    }
  }

  const managerSummary = `${managerTree.length} manager${managerTree.length === 1 ? '' : 's'}`;
  const callerSummary = `${callerList.length} caller${callerList.length === 1 ? '' : 's'}`;

  return (
    <>
      <p className="text-muted" style={{ marginBottom: 12 }}>
        Two groups: <strong>Manager</strong> → Bidder → Candidate, and <strong>Caller</strong> accounts. Add people one by one as your team grows.
      </p>

      <div className="search-row">
        <button
          className="btn btn-primary"
          type="button"
          onClick={openAddManager}
        >
          + Add Manager
        </button>
        <button className="btn btn-ghost" type="button" onClick={expandAll}>Expand all</button>
        <button className="btn btn-ghost" type="button" onClick={collapseAll}>Collapse all</button>
      </div>

      {loading ? (
        <div className="card"><div className="text-muted">Loading…</div></div>
      ) : (
        <div className="org-tree-list">
          <RoleGroupCard
            groupKey={GROUP_MANAGERS}
            title="Manager group"
            summary={managerSummary}
            expanded={expanded}
            onToggle={toggleExpanded}
          >
            {managerTree.length ? (
              managerTree.map((node) => (
                <ManagerBranch
                  key={node.manager.id}
                  node={node}
                  expanded={expanded}
                  onToggle={toggleExpanded}
                  onEdit={() => { void openEditManager(node.manager); }}
                  onDelete={() => {
                    setSelected(node.manager);
                    setModal('delete');
                  }}
                />
              ))
            ) : (
              <p className="org-tree-empty">No managers yet. Click + Add Manager to start.</p>
            )}
          </RoleGroupCard>

          <RoleGroupCard
            groupKey={GROUP_CALLERS}
            title="Caller group"
            summary={callerSummary}
            expanded={expanded}
            onToggle={toggleExpanded}
          >
            {callerList.length ? (
              callerList.map((caller) => (
                <CallerBranch
                  key={caller.id}
                  caller={caller}
                  expanded={expanded}
                  onToggle={toggleExpanded}
                />
              ))
            ) : (
              <p className="org-tree-empty">No callers yet. Add caller logins from a bidder team.</p>
            )}
          </RoleGroupCard>
        </div>
      )}

      <Modal
        open={modal === 'form'}
        title={selected ? 'Edit Manager' : 'Add Manager'}
        onClose={() => setModal(null)}
        footer={
          <>
            <button className="btn btn-ghost" type="button" onClick={() => setModal(null)}>Cancel</button>
            <button className="btn btn-primary" type="button" disabled={formLoading} onClick={() => { void saveManager(); }}>Save</button>
          </>
        }
      >
        {formLoading ? (
          <div className="text-muted">Loading saved credentials…</div>
        ) : (
          <>
            <div className="form-group">
              <label>Username *</label>
              <input
                value={form.username}
                disabled={Boolean(selected)}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label>{selected ? 'Password' : 'Password *'}</label>
              <PasswordField
                key={selected ? `manager-${selected.id}` : 'manager-add'}
                value={form.password}
                onChange={(password) => setForm({ ...form, password })}
                placeholder={selected ? 'Saved password' : undefined}
              />
              {selected && savedPassword && (
                <p className="text-muted" style={{ marginTop: 6, fontSize: 12 }}>
                  Current password loaded. Use the eye icon to view it before changing.
                </p>
              )}
              {selected && !savedPassword && !form.password && (
                <p className="text-muted" style={{ marginTop: 6, fontSize: 12 }}>
                  No saved password on file. Enter a new password to set credentials.
                </p>
              )}
            </div>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
              />
              Active
            </label>
          </>
        )}
        {error && <div className="alert alert-error">{error}</div>}
      </Modal>

      <Modal
        open={modal === 'delete'}
        title="Delete Manager"
        onClose={() => setModal(null)}
        footer={
          <>
            <button className="btn btn-ghost" type="button" onClick={() => setModal(null)}>Cancel</button>
            <button className="btn btn-danger" type="button" onClick={() => { void deleteManager(); }}>Delete</button>
          </>
        }
      >
        <p className="confirm-text">Delete manager <strong>{selected?.username}</strong>?</p>
        <p className="confirm-text" style={{ marginTop: 8 }}>
          Bidders under this manager will no longer be linked to them.
        </p>
      </Modal>
    </>
  );
}
