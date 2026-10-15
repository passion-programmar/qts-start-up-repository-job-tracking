'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';

type ManagerFeatureAssignment = {
  id: number;
  name: string;
  username: string;
  isActive: boolean;
  canManageTextHighlights: boolean;
  canUseScanner: boolean;
};

export function SuperExtensionFeaturesView() {
  const [managers, setManagers] = useState<ManagerFeatureAssignment[]>([]);
  const [search, setSearch] = useState('');
  const [savingManagerId, setSavingManagerId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const result = await api<{
      success: boolean;
      managers?: ManagerFeatureAssignment[];
      message?: string;
    }>('GET', '/api/v2/extension-features/assignments');
    if (!result.success) {
      setError(result.message || 'Could not load extension feature assignments.');
      setLoading(false);
      return;
    }
    setManagers(result.managers || []);
    setError(null);
    setLoading(false);
  }, []);

  useEffect(() => {
    // Load the Super-managed extension feature assignments when the panel opens.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const filteredManagers = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    if (!query) return managers;
    return managers.filter((manager) =>
      `${manager.name} ${manager.username}`.toLocaleLowerCase().includes(query)
    );
  }, [managers, search]);

  function updateManager(
    managerId: number,
    feature: 'canManageTextHighlights' | 'canUseScanner',
    enabled: boolean
  ) {
    setManagers((current) => current.map((manager) =>
      manager.id === managerId ? { ...manager, [feature]: enabled } : manager
    ));
    setMessage(null);
  }

  async function save(manager: ManagerFeatureAssignment) {
    setSavingManagerId(manager.id);
    setError(null);
    setMessage(null);
    const result = await api<{ success: boolean; message?: string }>(
      'PUT',
      `/api/v2/extension-features/assignments/${manager.id}`,
      {
        canManageTextHighlights: manager.canManageTextHighlights,
        canUseScanner: manager.canUseScanner,
      }
    );
    setSavingManagerId(null);
    if (!result.success) {
      setError(result.message || `Could not update permissions for ${manager.name}.`);
      await load();
      return;
    }
    setMessage(`Extension permissions saved for ${manager.name}.`);
    await load();
  }

  return (
    <section className="card" style={{ marginBottom: 20 }}>
      <h2 className="section-title">Manager extension permissions</h2>
      <p className="text-muted" style={{ marginBottom: 12 }}>
        Highlight rules are shared and visible on websites for every signed-in Manager.
        Only Managers granted highlight management can change those rules. Scanner access is assigned separately.
      </p>
      {error && <div className="alert alert-error">{error}</div>}
      {message && <div className="alert alert-success">{message}</div>}
      <div className="form-group" style={{ maxWidth: 420 }}>
        <label htmlFor="extension-manager-filter">Filter Managers</label>
        <input
          id="extension-manager-filter"
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search by name or username"
        />
      </div>
      {loading ? <p className="text-muted">Loading Manager assignments…</p> : filteredManagers.length ? (
        <div className="table-scroll"><table>
          <thead>
            <tr>
              <th>Manager</th>
              <th>Text highlight management</th>
              <th>Job-site Scanner</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {filteredManagers.map((manager) => (
              <tr key={manager.id}>
                <td>
                  {manager.name} <span className="text-muted">({manager.username})</span>
                  {!manager.isActive && <span className="text-muted"> — Blocked</span>}
                </td>
                <td>
                  <label className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={manager.canManageTextHighlights}
                      onChange={(event) => updateManager(manager.id, 'canManageTextHighlights', event.target.checked)}
                      aria-label={`Allow ${manager.name} to manage shared text highlights`}
                    />
                    <span>Can add, edit, and delete shared rules</span>
                  </label>
                </td>
                <td>
                  <label className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={manager.canUseScanner}
                      onChange={(event) => updateManager(manager.id, 'canUseScanner', event.target.checked)}
                      aria-label={`Allow ${manager.name} to use job-site Scanner`}
                    />
                    <span>Can scan application steps</span>
                  </label>
                </td>
                <td className="text-right">
                  <button
                    className="btn btn-primary btn-sm"
                    type="button"
                    disabled={savingManagerId === manager.id}
                    onClick={() => { void save(manager); }}
                  >
                    {savingManagerId === manager.id ? 'Saving…' : 'Save'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      ) : <p className="text-muted">{managers.length ? 'No Managers match this filter.' : 'No Managers are available.'}</p>}
    </section>
  );
}
