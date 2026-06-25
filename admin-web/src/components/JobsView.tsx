'use client';

import { useCallback, useEffect, useState } from 'react';
import { Modal } from '@/components/Modal';
import { useAuth } from '@/components/AuthProvider';
import { api } from '@/lib/api';
import type { Job } from '@/lib/types';
import { formatDate } from '@/lib/utils';

interface StatusDraft {
  candidateId: number;
  name: string;
  status: 'none' | 'applied';
  appliedAt?: string | null;
}

export function JobsView() {
  const { canWrite } = useAuth();
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);

  const [modal, setModal] = useState<'detail' | 'delete' | null>(null);
  const [selected, setSelected] = useState<Job | null>(null);
  const [statusDraft, setStatusDraft] = useState<StatusDraft[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [form, setForm] = useState({
    title: '',
    company: '',
    url: '',
    source: '',
    description: '',
  });

  const load = useCallback(async (q = '') => {
    setLoading(true);
    const r = await api<{ success: boolean; jobs?: Job[] }>(
      'GET',
      `/api/jobs${q ? `?search=${encodeURIComponent(q)}` : ''}`
    );
    setJobs(r.jobs || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load(query);
  }, [load, query]);

  async function openDetail(id: number) {
    const r = await api<{ success: boolean; job?: Job }>('GET', `/api/jobs/${id}`);
    const j = r.job;
    if (!j) return;

    setSelected(j);
    setForm({
      title: j.title,
      company: j.company,
      url: j.url,
      source: j.source || '',
      description: j.description || '',
    });
    setStatusDraft(
      (j.candidateStatuses || []).map((s) => ({
        candidateId: Number(s.candidate_id),
        name: s.name,
        status: s.status === 'applied' ? 'applied' : 'none',
        appliedAt: s.applied_at,
      }))
    );
    setFormError(null);
    setModal('detail');
  }

  function toggleStatus(candidateId: number) {
    setStatusDraft((prev) =>
      prev.map((s) =>
        s.candidateId === candidateId
          ? { ...s, status: s.status === 'applied' ? 'none' : 'applied' }
          : s
      )
    );
  }

  async function saveJob() {
    if (!selected) return;
    const body = {
      title: form.title.trim(),
      company: form.company.trim(),
      url: form.url.trim(),
      source: form.source.trim(),
      description: form.description.trim(),
      candidateStatuses: statusDraft.map((s) => ({
        candidateId: s.candidateId,
        status: s.status,
      })),
    };
    if (!body.title || !body.company || !body.url || !body.description) {
      setFormError('Title, company, URL, and description are required.');
      return;
    }
    const r = await api<{ success: boolean; message?: string }>('PUT', `/api/jobs/${selected.id}`, body);
    if (r.success) {
      setModal(null);
      void load(query);
    } else {
      setFormError(r.message || 'Could not update job.');
    }
  }

  async function deleteJob() {
    if (!selected) return;
    const r = await api<{ success: boolean; message?: string }>('DELETE', `/api/jobs/${selected.id}`);
    if (r.success) {
      setModal(null);
      void load(query);
    } else {
      alert(r.message || 'Could not delete job.');
    }
  }

  return (
    <>
      <div className="search-row">
        <input
          type="text"
          placeholder="Search jobs…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') setQuery(search);
          }}
        />
      </div>

      <div className="card">
        {loading ? (
          <div className="text-muted">Loading…</div>
        ) : (
          <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Title</th>
                <th>Company</th>
                <th>Applied</th>
                <th>Source</th>
                <th>Saved</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id}>
                  <td><strong>{j.title}</strong></td>
                  <td>{j.company}</td>
                  <td>
                    <span className={`badge ${Number(j.applied_count) > 0 ? 'badge-applied' : 'badge-none'}`}>
                      {Number(j.applied_count) || 0}
                    </span>
                  </td>
                  <td className="text-muted">{j.source || '—'}</td>
                  <td className="text-muted">{formatDate(j.created_at)}</td>
                  <td className="text-right">
                    <button className="btn btn-ghost btn-sm" type="button" onClick={() => { void openDetail(j.id); }}>
                      {canWrite ? 'Details' : 'View'}
                    </button>
                    <a
                      className="btn btn-ghost btn-sm"
                      href={j.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      ↗ Open
                    </a>
                    {canWrite && (
                      <button
                        className="btn btn-danger btn-sm"
                        type="button"
                        onClick={() => {
                          setSelected(j);
                          setModal('delete');
                        }}
                      >
                        Delete
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {!jobs.length && (
                <tr>
                  <td colSpan={6} className="text-muted">No jobs saved yet.</td>
                </tr>
              )}
            </tbody>
          </table>
          </div>
        )}
      </div>

      <Modal
        open={modal === 'detail'}
        title={canWrite ? `Job Detail: ${selected?.title || ''}` : `View Job: ${selected?.title || ''}`}
        onClose={() => setModal(null)}
        footer={
          canWrite ? (
            <>
              <button className="btn btn-ghost" type="button" onClick={() => setModal(null)}>Cancel</button>
              <button className="btn btn-primary" type="button" onClick={() => { void saveJob(); }}>
                Save Changes
              </button>
            </>
          ) : (
            <button className="btn btn-ghost" type="button" onClick={() => setModal(null)}>Close</button>
          )
        }
      >
        {canWrite ? (
          <>
            <div className="two-col">
              <div className="form-group">
                <label>Title *</label>
                <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Company *</label>
                <input value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} />
              </div>
            </div>
            <div className="form-group">
              <label>URL *</label>
              <input type="url" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} />
            </div>
            <div className="form-group">
              <label>Source</label>
              <input value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} />
            </div>
            <div className="form-group">
              <label>Description *</label>
              <textarea
                style={{ minHeight: 180 }}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </div>
            {formError && <div className="alert alert-error">{formError}</div>}
          </>
        ) : (
          <>
            <div className="two-col">
              <div>
                <div className="field-label">Title</div>
                <p>{selected?.title}</p>
              </div>
              <div>
                <div className="field-label">Company</div>
                <p>{selected?.company}</p>
              </div>
            </div>
            <div>
              <div className="field-label">URL</div>
              <p>
                <a href={selected?.url} target="_blank" rel="noopener noreferrer">{selected?.url}</a>
              </p>
            </div>
            <div>
              <div className="field-label">Source</div>
              <p>{selected?.source || '—'}</p>
            </div>
            <div>
              <div className="field-label">Description</div>
              <p style={{ whiteSpace: 'pre-wrap' }}>{selected?.description}</p>
            </div>
          </>
        )}

        <div className="section-title">Candidate Statuses</div>
        {canWrite && (
          <p className="text-muted" style={{ marginBottom: 10 }}>
            Click a status to switch between NONE and APPLIED.
          </p>
        )}
        {!statusDraft.length ? (
          <p className="text-muted">No active candidates.</p>
        ) : (
          <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Candidate</th>
                <th>Status</th>
                <th>Applied date</th>
              </tr>
            </thead>
            <tbody>
              {statusDraft.map((s) => (
                <tr key={s.candidateId}>
                  <td>{s.name}</td>
                  <td>
                    {canWrite ? (
                      <button
                        type="button"
                        className={`status-toggle ${s.status}`}
                        onClick={() => toggleStatus(s.candidateId)}
                      >
                        {s.status.toUpperCase()}
                      </button>
                    ) : (
                      <span className={`badge ${s.status === 'applied' ? 'badge-applied' : 'badge-none'}`}>
                        {s.status.toUpperCase()}
                      </span>
                    )}
                  </td>
                  <td className="text-muted">
                    {s.status === 'applied' && s.appliedAt ? formatDate(s.appliedAt) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
        <div className="text-muted" style={{ marginTop: 8, fontSize: 12 }}>
          Created: {formatDate(selected?.created_at)} · Updated: {formatDate(selected?.updated_at)}
        </div>
      </Modal>

      <Modal
        open={modal === 'delete'}
        title="Delete Job"
        onClose={() => setModal(null)}
        footer={
          <>
            <button className="btn btn-ghost" type="button" onClick={() => setModal(null)}>Cancel</button>
            <button className="btn btn-danger" type="button" onClick={() => { void deleteJob(); }}>
              Delete Job
            </button>
          </>
        }
      >
        <p className="confirm-text">
          Delete <strong>{selected?.title}</strong>?
        </p>
      </Modal>
    </>
  );
}
