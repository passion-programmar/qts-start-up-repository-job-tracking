'use client';

import { useCallback, useEffect, useState } from 'react';
import { LoadingState } from '@/components/LoadingState';
import { Modal } from '@/components/Modal';
import { api } from '@/lib/api';

type ScannerPrompt = {
  id: number;
  name: string;
  content: string;
  createdDate: string;
  updatedDate: string;
};

type Manager = {
  id: number;
  name: string;
  username: string;
};

type Assignment = {
  managerId: number;
  promptId: number;
  assignedDate: string;
};

type PromptData = {
  success: boolean;
  prompts?: ScannerPrompt[];
  managers?: Manager[];
  assignments?: Assignment[];
  defaultPrompt?: string;
  message?: string;
};

export function SuperScannerPromptsView() {
  const [prompts, setPrompts] = useState<ScannerPrompt[]>([]);
  const [managers, setManagers] = useState<Manager[]>([]);
  const [assignments, setAssignments] = useState<Record<number, number>>({});
  const [draftAssignments, setDraftAssignments] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(true);
  const [savingPrompt, setSavingPrompt] = useState(false);
  const [savingDefaultPrompt, setSavingDefaultPrompt] = useState(false);
  const [savingManagerId, setSavingManagerId] = useState<number | null>(null);
  const [defaultPrompt, setDefaultPrompt] = useState('');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingPrompt, setEditingPrompt] = useState<ScannerPrompt | null>(null);
  const [promptName, setPromptName] = useState('');
  const [promptContent, setPromptContent] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const result = await api<PromptData>('GET', '/api/v2/scanner-prompts');
    if (!result.success) {
      setError(result.message || 'Could not load Scanner prompts and assignments.');
      setLoading(false);
      return;
    }
    const nextAssignments = Object.fromEntries(
      (result.assignments || []).map((assignment) => [assignment.managerId, assignment.promptId])
    );
    setPrompts(result.prompts || []);
    setManagers(result.managers || []);
    setAssignments(nextAssignments);
    setDefaultPrompt(result.defaultPrompt || '');
    setDraftAssignments(Object.fromEntries(
      (result.managers || []).map((manager) => [
        manager.id,
        nextAssignments[manager.id] ? String(nextAssignments[manager.id]) : '',
      ])
    ));
    setError(null);
    setLoading(false);
  }, []);

  useEffect(() => {
    // Load the Super-managed prompt library and Manager assignments.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  function openNewPrompt() {
    setEditingPrompt(null);
    setPromptName('');
    setPromptContent('');
    setError(null);
    setEditorOpen(true);
  }

  function openEditPrompt(prompt: ScannerPrompt) {
    setEditingPrompt(prompt);
    setPromptName(prompt.name);
    setPromptContent(prompt.content);
    setError(null);
    setEditorOpen(true);
  }

  async function savePrompt(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingPrompt(true);
    setError(null);
    const result = await api<{ success: boolean; message?: string }>(
      editingPrompt ? 'PUT' : 'POST',
      editingPrompt ? `/api/v2/scanner-prompts/${editingPrompt.id}` : '/api/v2/scanner-prompts',
      { name: promptName.trim(), content: promptContent.trim() }
    );
    setSavingPrompt(false);
    if (!result.success) {
      setError(result.message || 'Could not save the prompt.');
      return;
    }
    setEditorOpen(false);
    setMessage(editingPrompt ? 'Prompt updated.' : 'Prompt created.');
    await load();
  }

  async function saveDefaultPrompt(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingDefaultPrompt(true);
    setError(null);
    setMessage(null);
    const result = await api<{ success: boolean; defaultPrompt?: string; message?: string }>(
      'PUT',
      '/api/v2/scanner-prompts/default',
      { content: defaultPrompt.trim() }
    );
    setSavingDefaultPrompt(false);
    if (!result.success) {
      setError(result.message || 'Could not save the default Scanner instructions.');
      return;
    }
    setDefaultPrompt(result.defaultPrompt || defaultPrompt.trim());
    setMessage('Default Scanner instructions updated. Managers without an assigned prompt will use them.');
  }

  async function saveAssignment(manager: Manager) {
    const selected = draftAssignments[manager.id] || '';
    setSavingManagerId(manager.id);
    setError(null);
    setMessage(null);
    const result = await api<{ success: boolean; message?: string }>(
      'PUT',
      `/api/v2/scanner-prompts/assignments/${manager.id}`,
      { promptId: selected ? Number(selected) : null }
    );
    setSavingManagerId(null);
    if (!result.success) {
      setError(result.message || `Could not update the Scanner prompt for ${manager.name}.`);
      await load();
      return;
    }
    setMessage(selected ? `Prompt assigned to ${manager.name}.` : `Prompt unassigned from ${manager.name}.`);
    await load();
  }

  async function deletePrompt(prompt: ScannerPrompt) {
    if (!window.confirm(`Delete "${prompt.name}"? Any Manager assignment must be removed first.`)) return;
    setError(null);
    const result = await api<{ success: boolean; message?: string }>(
      'DELETE',
      `/api/v2/scanner-prompts/${prompt.id}`
    );
    if (!result.success) {
      setError(result.message || 'Could not delete the prompt.');
      return;
    }
    setMessage('Prompt deleted.');
    await load();
  }

  return (
    <>
      <section className="card" style={{ marginBottom: 20 }}>
        <h2 className="section-title">Default Scanner instructions</h2>
        <p className="text-muted" style={{ marginBottom: 12 }}>
          Used when a Manager has no assigned prompt. These instructions are followed by the Scanner&apos;s fixed response and safety requirements.
        </p>
        <form onSubmit={(event) => { void saveDefaultPrompt(event); }}>
          <div className="form-group">
            <label htmlFor="scanner-default-prompt">Default instructions</label>
            <textarea
              id="scanner-default-prompt"
              required
              maxLength={50000}
              rows={10}
              value={defaultPrompt}
              onChange={(event) => setDefaultPrompt(event.target.value)}
              placeholder="Enter the default Scanner instructions…"
            />
            <div className="text-muted">{defaultPrompt.length.toLocaleString()} / 50,000 characters</div>
          </div>
          <button className="btn btn-primary" type="submit" disabled={savingDefaultPrompt || !defaultPrompt.trim()}>
            {savingDefaultPrompt ? 'Saving…' : 'Save default instructions'}
          </button>
        </form>
        {error && <div className="alert alert-error" style={{ marginTop: 12 }}>{error}</div>}
        {message && <div className="alert alert-success" style={{ marginTop: 12 }}>{message}</div>}
      </section>

      <section className="card" style={{ marginBottom: 20 }}>
        <div className="search-row">
          <h2 className="section-title">Scanner prompt library</h2>
          <button className="btn btn-primary" type="button" onClick={openNewPrompt}>
            + New prompt
          </button>
        </div>
        <p className="text-muted" style={{ marginBottom: 12 }}>
          Prompts are reusable instruction sets for ChatGPT. Assign at most one to each Manager; the same prompt can be shared.
          Managers without an assignment use the default instructions configured above.
        </p>
        {error && <div className="alert alert-error">{error}</div>}
        {message && <div className="alert alert-success">{message}</div>}
        {loading ? <LoadingState label="Loading Scanner prompts…" /> : prompts.length ? (
          <div style={{ display: 'grid', gap: 12 }}>
            {prompts.map((prompt) => (
              <article key={prompt.id} className="card" style={{ padding: 16 }}>
                <div className="search-row">
                  <div>
                    <h3 style={{ margin: 0 }}>{prompt.name}</h3>
                    <p className="text-muted" style={{ margin: '6px 0 0' }}>
                      {prompt.content.length.toLocaleString()} characters
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button className="btn btn-ghost btn-sm" type="button" onClick={() => openEditPrompt(prompt)}>
                      Edit
                    </button>
                    <button className="btn btn-danger btn-sm" type="button" onClick={() => { void deletePrompt(prompt); }}>
                      Delete
                    </button>
                  </div>
                </div>
                <details style={{ marginTop: 12 }}>
                  <summary style={{ cursor: 'pointer' }}>Preview prompt content</summary>
                  <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 320, overflow: 'auto' }}>
                    {prompt.content}
                  </pre>
                </details>
              </article>
            ))}
          </div>
        ) : (
          <p className="text-muted">
            No shared prompts yet. The Scanner will use its built-in default until a prompt is assigned.
          </p>
        )}
      </section>

      <section className="card">
        <h2 className="section-title">Manager assignments</h2>
        <p className="text-muted" style={{ marginBottom: 12 }}>
          Each Manager has one prompt selection. Choosing “Built-in default” removes their assignment.
        </p>
        {loading ? <LoadingState label="Loading Manager assignments…" /> : managers.length ? (
          <div className="table-scroll"><table>
            <thead><tr><th>Manager</th><th>Assigned prompt</th><th /></tr></thead>
            <tbody>
              {managers.map((manager) => {
                const current = assignments[manager.id];
                return (
                  <tr key={manager.id}>
                    <td>{manager.name} <span className="text-muted">({manager.username})</span></td>
                    <td>
                      <select
                        aria-label={`Scanner prompt for ${manager.name}`}
                        value={draftAssignments[manager.id] || ''}
                        onChange={(event) => setDraftAssignments((draft) => ({
                          ...draft,
                          [manager.id]: event.target.value,
                        }))}
                      >
                        <option value="">Built-in default</option>
                        {prompts.map((prompt) => (
                          <option key={prompt.id} value={prompt.id}>{prompt.name}</option>
                        ))}
                      </select>
                      <div className="text-muted" style={{ marginTop: 4 }}>
                        Current: {current ? prompts.find((prompt) => prompt.id === current)?.name || 'Prompt unavailable' : 'Built-in default'}
                      </div>
                    </td>
                    <td className="text-right">
                      <button
                        className="btn btn-primary btn-sm"
                        type="button"
                        disabled={savingManagerId === manager.id || (draftAssignments[manager.id] || '') === (current ? String(current) : '')}
                        onClick={() => { void saveAssignment(manager); }}
                      >
                        {savingManagerId === manager.id ? 'Saving…' : 'Save'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        ) : (
          <p className="text-muted">Create a Manager before assigning a Scanner prompt.</p>
        )}
      </section>

      <Modal
        open={editorOpen}
        title={editingPrompt ? 'Edit Scanner prompt' : 'Create Scanner prompt'}
        onClose={() => {
          if (!savingPrompt) setEditorOpen(false);
        }}
        footer={(
          <>
            <button
              className="btn btn-ghost"
              type="button"
              disabled={savingPrompt}
              onClick={() => setEditorOpen(false)}
            >
              Cancel
            </button>
            <button
              className="btn btn-primary"
              type="submit"
              form="scanner-prompt-form"
              disabled={savingPrompt}
            >
              {savingPrompt ? 'Saving…' : 'Save prompt'}
            </button>
          </>
        )}
      >
        <form id="scanner-prompt-form" onSubmit={(event) => { void savePrompt(event); }}>
          <div className="form-group">
            <label htmlFor="scanner-prompt-name">Prompt name</label>
            <input
              id="scanner-prompt-name"
              required
              maxLength={200}
              value={promptName}
              onChange={(event) => setPromptName(event.target.value)}
              placeholder="For example, Engineering resume and cover letter"
            />
          </div>
          <div className="form-group">
            <label htmlFor="scanner-prompt-content">Instructions</label>
            <textarea
              id="scanner-prompt-content"
              required
              maxLength={50000}
              rows={16}
              value={promptContent}
              onChange={(event) => setPromptContent(event.target.value)}
              placeholder="Enter the Manager-specific writing instructions…"
            />
            <div className="text-muted">{promptContent.length.toLocaleString()} / 50,000 characters</div>
          </div>
          {error && <div className="alert alert-error">{error}</div>}
        </form>
      </Modal>
    </>
  );
}
