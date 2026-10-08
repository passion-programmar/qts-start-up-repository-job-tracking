'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/utils';
import { useAuth } from '@/components/AuthProvider';
import type { NewSchemaAccountProfile, NewSchemaCategory, NewSchemaJob } from '@/lib/types';

const emptyForm = {
  title: '',
  company: '',
  url: '',
  status: 'todo' as NewSchemaJob['status'],
  categoryIds: [] as number[],
  accountIds: [] as number[],
};

export function NewSchemaJobsView() {
  const { user } = useAuth();
  const isManager = user?.role === 'manager';
  const [jobs, setJobs] = useState<NewSchemaJob[]>([]);
  const [accounts, setAccounts] = useState<NewSchemaAccountProfile[]>([]);
  const [categories, setCategories] = useState<NewSchemaCategory[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [jobResult, accountResult, categoryResult] = await Promise.all([
      api<{ success: boolean; jobs?: NewSchemaJob[] }>('GET', '/api/v2/jobs'),
      isManager
        ? api<{ success: boolean; accounts?: NewSchemaAccountProfile[] }>('GET', '/api/v2/users/accounts')
        : Promise.resolve({ success: true, accounts: [] }),
      isManager
        ? api<{ success: boolean; categories?: NewSchemaCategory[] }>('GET', '/api/v2/categories')
        : Promise.resolve({ success: true, categories: [] }),
    ]);
    if (jobResult.success) setJobs(jobResult.jobs || []);
    else setError('Could not load jobs.');
    if (accountResult.success) setAccounts(accountResult.accounts || []);
    if (categoryResult.success) setCategories(categoryResult.categories || []);
    setLoading(false);
  }, [isManager]);

  useEffect(() => {
    // Load jobs and Manager assignment options on mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const visibleJobs = jobs.filter((job) => {
    const needle = search.trim().toLowerCase();
    return !needle || `${job.title} ${job.company}`.toLowerCase().includes(needle);
  });

  function beginCreate() {
    setEditingId(null);
    setForm(emptyForm);
    setError(null);
    setShowForm(true);
  }

  function beginEdit(job: NewSchemaJob) {
    setEditingId(job.id);
    setForm({
      title: job.title,
      company: job.company,
      url: job.url,
      status: job.status,
      categoryIds: job.category_ids || [],
      accountIds: job.selected_account_u_ids || [],
    });
    setError(null);
    setShowForm(true);
  }

  function toggleId(key: 'categoryIds' | 'accountIds', value: number) {
    setForm((current) => ({
      ...current,
      [key]: current[key].includes(value)
        ? current[key].filter((id) => id !== value)
        : [...current[key], value],
    }));
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const payload = {
      title: form.title.trim(),
      company: form.company.trim(),
      url: form.url.trim(),
      status: form.status,
      categoryIds: form.categoryIds,
      selectedAccountUserIds: form.accountIds,
    };
    const result = editingId
      ? await api<{ success: boolean; message?: string }>('PUT', `/api/v2/jobs/${editingId}`, payload)
      : await api<{ success: boolean; message?: string }>('POST', '/api/v2/jobs', payload);
    if (!result.success) {
      setError(result.message || 'Could not save job.');
      return;
    }
    setShowForm(false);
    await load();
  }

  async function remove(job: NewSchemaJob) {
    if (!window.confirm(`Delete "${job.title}"?`)) return;
    const result = await api<{ success: boolean; message?: string }>('DELETE', `/api/v2/jobs/${job.id}`);
    if (!result.success) {
      setError(result.message || 'Could not delete job.');
      return;
    }
    await load();
  }

  return (
    <>
      {error && <div className="alert alert-error">{error}</div>}
      <div className="search-row" style={{ display: 'flex', gap: 8 }}>
        <input
          aria-label="Search jobs"
          placeholder="Search jobs…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        {isManager && (
          <button className="btn btn-primary" type="button" onClick={beginCreate}>
            + Add Job
          </button>
        )}
      </div>

      {showForm && isManager && (
        <form className="card" onSubmit={(event) => { void save(event); }} style={{ marginBottom: 16 }}>
          <div className="card-title">{editingId ? 'Edit Job' : 'Add Job'}</div>
          {error && <div className="alert alert-error">{error}</div>}
          <div className="form-group">
            <label htmlFor="new-job-title">Title</label>
            <input id="new-job-title" required maxLength={300} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />
          </div>
          <div className="form-group">
            <label htmlFor="new-job-company">Company</label>
            <input id="new-job-company" required maxLength={300} value={form.company} onChange={(event) => setForm({ ...form, company: event.target.value })} />
          </div>
          <div className="form-group">
            <label htmlFor="new-job-url">Job URL</label>
            <input id="new-job-url" required type="url" value={form.url} onChange={(event) => setForm({ ...form, url: event.target.value })} />
          </div>
          <div className="form-group">
            <label htmlFor="new-job-status">Status</label>
            <select id="new-job-status" value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as NewSchemaJob['status'] })}>
              {(['todo', 'processing', 'did', 'failed'] as const).map((status) => <option key={status} value={status}>{status}</option>)}
            </select>
          </div>
          <fieldset className="form-group">
            <legend>Categories</legend>
            {categories.map((category) => (
              <label key={category.category_id} style={{ display: 'block' }}>
                <input type="checkbox" checked={form.categoryIds.includes(category.category_id)} onChange={() => toggleId('categoryIds', category.category_id)} />
                {' '}{category.category_title}
              </label>
            ))}
          </fieldset>
          <fieldset className="form-group">
            <legend>Selected Accounts</legend>
            {accounts.map((account) => (
              <label key={account.u_id} style={{ display: 'block' }}>
                <input type="checkbox" checked={form.accountIds.includes(account.u_id)} onChange={() => toggleId('accountIds', account.u_id)} />
                {' '}{account.name} ({account.email})
              </label>
            ))}
            {!accounts.length && <p className="text-muted">Create Account profiles before assigning them to jobs.</p>}
          </fieldset>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-primary" type="submit">Save Job</button>
            <button className="btn btn-ghost" type="button" onClick={() => setShowForm(false)}>Cancel</button>
          </div>
        </form>
      )}

      <div className="card">
        {loading ? <div className="text-muted">Loading…</div> : (
          <div className="table-scroll">
            <table>
              <thead><tr><th>Title</th><th>Company</th><th>Status</th><th>Accounts</th><th>Bids</th><th>Added</th><th /></tr></thead>
              <tbody>
                {visibleJobs.map((job) => (
                  <tr key={job.id}>
                    <td><a href={job.url} target="_blank" rel="noreferrer">{job.title}</a></td>
                    <td>{job.company}</td>
                    <td>{job.status}</td>
                    <td>{job.selected_account_u_ids?.length || 0}</td>
                    <td>{job.bid_count}</td>
                    <td>{formatDate(job.get_date)}</td>
                    <td className="text-right">
                      {isManager && <button className="btn btn-ghost btn-sm" type="button" onClick={() => beginEdit(job)}>Edit</button>}
                      {isManager && <button className="btn btn-danger btn-sm" type="button" onClick={() => { void remove(job); }}>Delete</button>}
                    </td>
                  </tr>
                ))}
                {!visibleJobs.length && <tr><td colSpan={7} className="text-muted">No jobs found.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
