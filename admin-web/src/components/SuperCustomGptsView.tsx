'use client';

import { useCallback, useEffect, useState } from 'react';
import { Modal } from '@/components/Modal';
import { api } from '@/lib/api';

type CustomGpt = {
  id: number;
  name: string;
  url: string;
  gpt_id: string;
};

type Manager = {
  u_id: number;
  name: string;
  username: string;
};

type Assignment = {
  managerId: number;
  managerName: string;
  customGptId: number;
};

export function SuperCustomGptsView() {
  const [customGpts, setCustomGpts] = useState<CustomGpt[]>([]);
  const [managers, setManagers] = useState<Manager[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [selectedManagers, setSelectedManagers] = useState<Record<number, number[]>>({});
  const [newName, setNewName] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [gptResult, managerResult] = await Promise.all([
      api<{
        success: boolean;
        customGpts?: CustomGpt[];
        assignments?: Assignment[];
        message?: string;
      }>('GET', '/api/v2/custom-gpts'),
      api<{ success: boolean; users?: Manager[]; message?: string }>(
        'GET',
        '/api/v2/users?role=manager'
      ),
    ]);
    if (!gptResult.success || !managerResult.success) {
      setError(gptResult.message || managerResult.message || 'Could not load Custom GPT assignments.');
      setLoading(false);
      return;
    }
    const nextGpts = gptResult.customGpts || [];
    const nextAssignments = gptResult.assignments || [];
    setCustomGpts(nextGpts);
    setManagers(managerResult.users || []);
    setAssignments(nextAssignments);
    setSelectedManagers(Object.fromEntries(nextGpts.map((gpt) => [
      gpt.id,
      nextAssignments
        .filter((assignment) => assignment.customGptId === gpt.id)
        .map((assignment) => assignment.managerId),
    ])));
    setError(null);
    setLoading(false);
  }, []);

  useEffect(() => {
    // Load the Super-managed GPT library when the page opens.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function addCustomGpt(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const result = await api<{ success: boolean; message?: string }>('POST', '/api/v2/custom-gpts', {
      name: newName.trim(),
      url: newUrl.trim(),
    });
    if (!result.success) {
      setError(result.message || 'Could not add Custom GPT.');
      return;
    }
    setNewName('');
    setNewUrl('');
    setAddOpen(false);
    setMessage('Custom GPT added. Assign it to one or more Managers below.');
    await load();
  }

  async function saveAssignments(customGptId: number) {
    setSavingId(customGptId);
    setError(null);
    const result = await api<{ success: boolean; message?: string }>(
      'PUT',
      `/api/v2/custom-gpts/${customGptId}/assignments`,
      { managerIds: selectedManagers[customGptId] || [] }
    );
    setSavingId(null);
    if (!result.success) {
      setError(result.message || 'Could not save Manager assignments.');
      return;
    }
    setMessage('Manager assignments saved.');
    await load();
  }

  async function deleteCustomGpt(customGpt: CustomGpt) {
    if (!window.confirm(`Remove "${customGpt.name}" from the Custom GPT library?`)) return;
    const result = await api<{ success: boolean; message?: string }>(
      'DELETE',
      `/api/v2/custom-gpts/${customGpt.id}`
    );
    if (!result.success) {
      setError(result.message || 'Could not remove Custom GPT.');
      return;
    }
    setMessage('Custom GPT removed.');
    await load();
  }

  function toggleManager(customGptId: number, managerId: number, checked: boolean) {
    setSelectedManagers((current) => {
      const selected = new Set(current[customGptId] || []);
      if (checked) selected.add(managerId);
      else selected.delete(managerId);
      return { ...current, [customGptId]: [...selected] };
    });
  }

  return (
    <section className="card" style={{ marginBottom: 20 }}>
      <div className="search-row">
        <h2 className="section-title">Custom GPT library</h2>
        <button className="btn btn-primary" type="button" onClick={() => setAddOpen(true)}>
          + Add Custom GPT
        </button>
      </div>
      <p className="text-muted" style={{ marginBottom: 12 }}>
        Add each GPT once, then assign it to multiple Managers. Each Manager can have one assigned GPT.
        Managers cannot view or change their assignment in the Manager page or extension.
      </p>
      {error && <div className="alert alert-error">{error}</div>}
      {message && <div className="alert alert-success">{message}</div>}
      {loading ? <div className="text-muted">Loading Custom GPTs…</div> : customGpts.length ? (
        <div style={{ display: 'grid', gap: 16 }}>
          {customGpts.map((customGpt) => (
            <div key={customGpt.id} className="card" style={{ padding: 16 }}>
              <div className="search-row">
                <div>
                  <h3 style={{ margin: 0 }}>{customGpt.name}</h3>
                  <div className="text-muted" style={{ marginTop: 4, wordBreak: 'break-all' }}>{customGpt.url}</div>
                </div>
                <button
                  className="btn btn-danger btn-sm"
                  type="button"
                  onClick={() => { void deleteCustomGpt(customGpt); }}
                >
                  Remove
                </button>
              </div>
              {managers.length ? (
                <div className="form-group" style={{ marginTop: 12 }}>
                  <div style={{ fontWeight: 600, marginBottom: 8 }}>Assign to Managers</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8 }}>
                    {managers.map((manager) => {
                      const currentAssignment = assignments.find((item) => item.managerId === manager.u_id);
                      const selected = (selectedManagers[customGpt.id] || []).includes(manager.u_id);
                      return (
                        <label className="checkbox-row" key={manager.u_id}>
                          <input
                            type="checkbox"
                            checked={selected}
                            onChange={(event) => toggleManager(customGpt.id, manager.u_id, event.target.checked)}
                          />
                          <span>
                            {manager.name} <span className="text-muted">({manager.username})</span>
                            {currentAssignment && currentAssignment.customGptId !== customGpt.id && (
                              <span className="text-muted"> — assigned to another GPT</span>
                            )}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                  <button
                    className="btn btn-primary btn-sm"
                    type="button"
                    disabled={savingId === customGpt.id}
                    style={{ marginTop: 12 }}
                    onClick={() => { void saveAssignments(customGpt.id); }}
                  >
                    {savingId === customGpt.id ? 'Saving…' : 'Save assignments'}
                  </button>
                </div>
              ) : (
                <p className="text-muted" style={{ marginTop: 12 }}>Create a Manager before assigning this GPT.</p>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="text-muted">No Custom GPTs added yet.</div>
      )}

      <Modal
        open={addOpen}
        title="Add Custom GPT"
        onClose={() => setAddOpen(false)}
        footer={(
          <>
            <button className="btn btn-ghost" type="button" onClick={() => setAddOpen(false)}>Cancel</button>
            <button className="btn btn-primary" type="submit" form="add-custom-gpt-form">Add Custom GPT</button>
          </>
        )}
      >
        <form id="add-custom-gpt-form" onSubmit={(event) => { void addCustomGpt(event); }}>
          <div className="form-group">
            <label htmlFor="custom-gpt-name">Name</label>
            <input id="custom-gpt-name" required maxLength={200} value={newName} onChange={(event) => setNewName(event.target.value)} />
          </div>
          <div className="form-group">
            <label htmlFor="custom-gpt-url">Full Custom GPT URL</label>
            <input
              id="custom-gpt-url"
              type="url"
              required
              maxLength={500}
              placeholder="https://chatgpt.com/g/g-…"
              value={newUrl}
              onChange={(event) => setNewUrl(event.target.value)}
            />
            <p className="text-muted" style={{ marginTop: 6, fontSize: 12 }}>
              Use the full link from ChatGPT. Only chatgpt.com or chat.openai.com GPT links are accepted.
            </p>
          </div>
        </form>
      </Modal>
    </section>
  );
}
