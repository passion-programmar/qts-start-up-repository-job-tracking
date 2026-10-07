'use client';

import { useCallback, useEffect, useState } from 'react';
import { CandidateName } from '@/components/CandidateName';
import { CandidateColorPicker } from '@/components/CandidateColorPicker';
import { Modal } from '@/components/Modal';
import { useAuth } from '@/components/AuthProvider';
import { api } from '@/lib/api';
import type { Bidder, Candidate } from '@/lib/types';
import { formatDate } from '@/lib/utils';
import { nextCandidateColor, normalizeCandidateColor } from '../../shared/candidate-colors';
import { parseCandidateStacks } from '../../shared/candidate-stacks';

export function CandidatesView() {
  const { canWrite, canAddCandidates, user } = useAuth();
  const showBidderPicker = user?.role === 'admin' || user?.role === 'manager';
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [bidders, setBidders] = useState<Bidder[]>([]);
  const [stackOptions, setStackOptions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const [modal, setModal] = useState<'form' | 'history' | 'delete' | null>(null);
  const [selected, setSelected] = useState<Candidate | null>(null);
  const [historyJobs, setHistoryJobs] = useState<Array<{
    title: string;
    company: string;
    url: string;
    status: string;
    applied_at?: string | null;
  }>>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    linkedinUrl: '',
    notes: '',
    color: nextCandidateColor(0),
    stack: '',
    bidderId: '',
    isActive: true,
  });

  const load = useCallback(async (q = '') => {
    setLoading(true);
    const r = await api<{ success: boolean; candidates?: Candidate[] }>(
      'GET',
      `/api/candidates${q ? `?search=${encodeURIComponent(q)}` : ''}`
    );
    setCandidates(r.candidates || []);
    setLoading(false);
  }, []);

  const loadStackOptions = useCallback(async () => {
    const stacksRes = await api<{ success: boolean; stacks?: string[] }>('GET', '/api/settings/candidate-stacks');
    if (stacksRes.success && stacksRes.stacks?.length) {
      setStackOptions(stacksRes.stacks);
      return stacksRes.stacks;
    }
    const settingsRes = await api<{ success: boolean; settings?: Record<string, string> }>('GET', '/api/settings');
    const stacks = parseCandidateStacks(settingsRes.settings?.candidate_stacks);
    setStackOptions(stacks);
    return stacks;
  }, []);

  const loadBidders = useCallback(async () => {
    if (!showBidderPicker) return [];
    const r = await api<{ success: boolean; bidders?: Bidder[] }>('GET', '/api/bidders');
    const list = r.bidders || [];
    setBidders(list);
    return list;
  }, [showBidderPicker]);

  useEffect(() => {
    void load(query);
  }, [load, query]);

  useEffect(() => {
    void loadStackOptions();
    void loadBidders();
  }, [loadStackOptions, loadBidders]);

  function openAdd() {
    setSelected(null);
    void Promise.all([loadStackOptions(), loadBidders()]).then(([stacks, bidderList]) => {
      const list = bidderList || bidders;
      setForm({
        name: '',
        email: '',
        phone: '',
        linkedinUrl: '',
        notes: '',
        color: nextCandidateColor(candidates.length),
        stack: stacks[0] || '',
        bidderId: list[0] ? String(list[0].id) : '',
        isActive: true,
      });
    });
    setFormError(null);
    setModal('form');
  }

  function openEdit(c: Candidate) {
    setSelected(c);
    setForm({
      name: c.name,
      email: c.email || '',
      phone: c.phone || '',
      linkedinUrl: c.linkedin_url || '',
      notes: c.notes || '',
      color: normalizeCandidateColor(c.color, c.id),
      stack: c.stack || '',
      bidderId: c.bidder_id ? String(c.bidder_id) : '',
      isActive: c.is_active,
    });
    setFormError(null);
    setModal('form');
  }

  async function openHistory(c: Candidate) {
    const r = await api<{
      success: boolean;
      jobs?: Array<{
        title: string;
        company: string;
        url: string;
        status: string;
        applied_at?: string | null;
      }>;
    }>('GET', `/api/candidates/${c.id}/jobs`);
    setSelected(c);
    setHistoryJobs(r.jobs || []);
    setModal('history');
  }

  async function saveCandidate() {
    if (!form.name.trim()) {
      setFormError('Name is required.');
      return;
    }
    if (showBidderPicker && !form.bidderId) {
      setFormError('Bidder is required.');
      return;
    }
    const body = {
      name: form.name.trim(),
      email: form.email.trim(),
      phone: form.phone.trim(),
      linkedinUrl: form.linkedinUrl.trim(),
      notes: form.notes.trim(),
      color: form.color,
      stack: form.stack,
      isActive: form.isActive,
      ...(showBidderPicker ? { bidderId: parseInt(form.bidderId, 10) } : {}),
    };
    const r = selected
      ? await api<{ success: boolean; message?: string; errors?: Array<{ field: string; message: string }> }>('PUT', `/api/candidates/${selected.id}`, body)
      : await api<{ success: boolean; message?: string; errors?: Array<{ field: string; message: string }> }>('POST', '/api/candidates', body);
    if (r.success) {
      setModal(null);
      void load(query);
    } else {
      const detail = r.errors?.map((e) => e.message).join(' · ') || r.message;
      setFormError(detail || 'Could not save candidate.');
    }
  }

  async function toggleActive(c: Candidate) {
    await api('PATCH', `/api/candidates/${c.id}/status`, { isActive: !c.is_active });
    void load(query);
  }

  async function deleteCandidate() {
    if (!selected) return;
    const r = await api<{ success: boolean; message?: string }>('DELETE', `/api/candidates/${selected.id}`);
    if (r.success) {
      setModal(null);
      void load(query);
    } else {
      alert(r.message || 'Could not delete candidate.');
    }
  }

  return (
    <>
      <div className="search-row">
        <input
          type="text"
          placeholder="Search candidates…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') setQuery(search);
          }}
        />
        {canAddCandidates && (
          <button className="btn btn-primary" type="button" onClick={openAdd}>
            + Add Candidate
          </button>
        )}
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
                {showBidderPicker && <th>Bidder</th>}
                <th>Stack</th>
                <th>Email</th>
                <th>Phone</th>
                <th>Status</th>
                <th>Notes</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {candidates.map((c, i) => (
                <tr key={c.id}>
                  <td><CandidateName candidate={c} index={i} /></td>
                  {showBidderPicker && <td className="text-muted">{c.bidder_name || '—'}</td>}
                  <td className="text-muted">{c.stack || '—'}</td>
                  <td className="text-muted">{c.email || '—'}</td>
                  <td className="text-muted">{c.phone || '—'}</td>
                  <td>
                    <span className={`badge ${c.is_active ? 'badge-active' : 'badge-inactive'}`}>
                      {c.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="text-muted" style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.notes || '—'}
                  </td>
                  <td className="text-right">
                    <button className="btn btn-ghost btn-sm" type="button" onClick={() => { void openHistory(c); }}>
                      History
                    </button>
                    {canWrite && (
                      <>
                        <button className="btn btn-ghost btn-sm" type="button" onClick={() => openEdit(c)}>
                          Edit
                        </button>
                        <button className="btn btn-ghost btn-sm" type="button" onClick={() => { void toggleActive(c); }}>
                          {c.is_active ? 'Deactivate' : 'Activate'}
                        </button>
                        <button
                          className="btn btn-danger btn-sm"
                          type="button"
                          onClick={() => {
                            setSelected(c);
                            setModal('delete');
                          }}
                        >
                          Delete
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {!candidates.length && (
                <tr>
                  <td colSpan={showBidderPicker ? 8 : 7} className="text-muted">No candidates found.</td>
                </tr>
              )}
            </tbody>
          </table>
          </div>
        )}
      </div>

      <Modal
        open={modal === 'form'}
        title={selected ? 'Edit Candidate' : 'Add Candidate'}
        onClose={() => setModal(null)}
        footer={
          <>
            <button className="btn btn-ghost" type="button" onClick={() => setModal(null)}>Cancel</button>
            <button className="btn btn-primary" type="button" onClick={() => { void saveCandidate(); }}>
              {selected ? 'Save Changes' : 'Add Candidate'}
            </button>
          </>
        }
      >
        {showBidderPicker && (
          <div className="form-group">
            <label>Bidder *</label>
            <select
              value={form.bidderId}
              onChange={(e) => setForm({ ...form, bidderId: e.target.value })}
            >
              <option value="">— Select bidder —</option>
              {bidders.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
            {!bidders.length && (
              <p className="text-muted" style={{ marginTop: 6, fontSize: 12 }}>
                No bidders available. Add a bidder organization first.
              </p>
            )}
          </div>
        )}
        <div className="form-group">
          <label>Name *</label>
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </div>
        <div className="form-group">
          <label>Name color</label>
          <CandidateColorPicker
            value={form.color}
            previewName={form.name}
            fallbackIndex={selected?.id ?? candidates.length}
            onChange={(color) => setForm({ ...form, color })}
          />
        </div>
        <div className="form-group">
          <label>Stack</label>
          <select
            value={form.stack}
            onChange={(e) => setForm({ ...form, stack: e.target.value })}
          >
            <option value="">— Select stack —</option>
            {stackOptions.map((stack) => (
              <option key={stack} value={stack}>{stack}</option>
            ))}
            {form.stack && !stackOptions.includes(form.stack) && (
              <option value={form.stack}>{form.stack}</option>
            )}
          </select>
        </div>
        <div className="two-col">
          <div className="form-group">
            <label>Email</label>
            <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </div>
          <div className="form-group">
            <label>Phone</label>
            <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </div>
        </div>
        <div className="form-group">
          <label>LinkedIn URL</label>
          <input value={form.linkedinUrl} onChange={(e) => setForm({ ...form, linkedinUrl: e.target.value })} />
        </div>
        <div className="form-group">
          <label>Notes</label>
          <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </div>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={form.isActive}
            onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
          />
          Active candidate
        </label>
        {formError && <div className="alert alert-error">{formError}</div>}
      </Modal>

      <Modal
        open={modal === 'history'}
        title={`${selected?.name || ''} — Job History`}
        onClose={() => setModal(null)}
        footer={<button className="btn btn-ghost" type="button" onClick={() => setModal(null)}>Close</button>}
      >
        <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Job</th>
              <th>Company</th>
              <th>Status</th>
              <th>Applied</th>
            </tr>
          </thead>
          <tbody>
            {historyJobs.map((job) => (
              <tr key={`${job.url}-${job.title}`}>
                <td>
                  <a href={job.url} target="_blank" rel="noopener noreferrer">{job.title}</a>
                </td>
                <td>{job.company}</td>
                <td>
                  <span className={`badge ${job.status === 'applied' ? 'badge-applied' : 'badge-none'}`}>
                    {String(job.status || 'none').toUpperCase()}
                  </span>
                </td>
                <td className="text-muted">{job.applied_at ? formatDate(job.applied_at) : '—'}</td>
              </tr>
            ))}
            {!historyJobs.length && (
              <tr>
                <td colSpan={4} className="text-muted">No saved job history.</td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
      </Modal>

      <Modal
        open={modal === 'delete'}
        title="Delete Candidate"
        onClose={() => setModal(null)}
        footer={
          <>
            <button className="btn btn-ghost" type="button" onClick={() => setModal(null)}>Cancel</button>
            <button className="btn btn-danger" type="button" onClick={() => { void deleteCandidate(); }}>
              Delete
            </button>
          </>
        }
      >
        <p className="confirm-text">
          Delete <strong>{selected?.name}</strong>?
        </p>
        <p className="confirm-text" style={{ marginTop: 8 }}>
          This removes the candidate&apos;s job-status history.
        </p>
      </Modal>
    </>
  );
}
