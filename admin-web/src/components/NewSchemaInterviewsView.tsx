'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/components/AuthProvider';
import { Modal } from '@/components/Modal';
import { formatDate } from '@/lib/utils';
import type { NewSchemaBid, NewSchemaInterview } from '@/lib/types';

interface CallerOption {
  u_id: number;
  name: string;
}

const emptyForm = {
  bidId: '',
  interviewTime: '',
  interviewDate: '',
  callerUserId: '',
  interviewer: '',
  step: 'intro' as NewSchemaInterview['step'],
  status: 'todo' as NewSchemaInterview['status'],
};

export function NewSchemaInterviewsView() {
  const { user } = useAuth();
  const isManager = user?.role === 'manager';
  const isCaller = user?.role === 'caller';
  const [interviews, setInterviews] = useState<NewSchemaInterview[]>([]);
  const [bids, setBids] = useState<NewSchemaBid[]>([]);
  const [callers, setCallers] = useState<CallerOption[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const results = await Promise.all([
      api<{ success: boolean; interviews?: NewSchemaInterview[] }>('GET', '/api/v2/interviews'),
      isManager
        ? api<{ success: boolean; bids?: NewSchemaBid[] }>('GET', '/api/v2/bids')
        : Promise.resolve({ success: true, bids: [] }),
      isManager
        ? api<{ success: boolean; callers?: CallerOption[] }>('GET', '/api/v2/users/callers')
        : Promise.resolve({ success: true, callers: [] }),
    ]);
    if (results[0].success) setInterviews(results[0].interviews || []);
    else setError('Could not load interviews.');
    if (results[1].success) setBids(results[1].bids || []);
    if (results[2].success) setCallers(results[2].callers || []);
    setLoading(false);
  }, [isManager]);

  useEffect(() => {
    // Load interviews and Manager scheduling options on mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  function startCreate() {
    setEditingId(null);
    setForm(emptyForm);
    setFormError(null);
    setShowForm(true);
  }

  function startEdit(interview: NewSchemaInterview) {
    setEditingId(interview.i_id);
    setForm({
      bidId: String(interview.b_id),
      interviewTime: interview.interview_time.slice(0, 5),
      interviewDate: interview.interview_date.slice(0, 10),
      callerUserId: String(interview.caller_user_id),
      interviewer: interview.interviewer,
      step: interview.step,
      status: interview.status,
    });
    setFormError(null);
    setShowForm(true);
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setFormError(null);
    const body = {
      bidId: Number(form.bidId),
      interviewTime: form.interviewTime,
      interviewDate: form.interviewDate,
      callerUserId: Number(form.callerUserId),
      interviewer: form.interviewer.trim(),
      step: form.step,
      status: form.status,
    };
    const result = editingId
      ? await api<{ success: boolean; message?: string }>('PUT', `/api/v2/interviews/${editingId}`, body)
      : await api<{ success: boolean; message?: string }>('POST', '/api/v2/interviews', body);
    if (!result.success) {
      setFormError(result.message || 'Could not save interview.');
      setSaving(false);
      return;
    }
    setShowForm(false);
    try {
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function updateOutcome(interview: NewSchemaInterview, outcome: NewSchemaInterview['outcome']) {
    const result = await api<{ success: boolean; message?: string }>(
      'PATCH',
      `/api/v2/interviews/${interview.i_id}/outcome`,
      { outcome }
    );
    if (!result.success) setError(result.message || 'Could not update outcome.');
    else await load();
  }

  async function saveComment(interview: NewSchemaInterview, comment: string) {
    const result = await api<{ success: boolean; message?: string }>(
      'PATCH',
      `/api/v2/interviews/${interview.i_id}/outcome`,
      { outcome: interview.outcome, comment }
    );
    if (!result.success) setError(result.message || 'Could not save comment.');
    else await load();
  }

  async function remove(interview: NewSchemaInterview) {
    if (!window.confirm('Delete this interview?')) return;
    const result = await api<{ success: boolean; message?: string }>('DELETE', `/api/v2/interviews/${interview.i_id}`);
    if (!result.success) setError(result.message || 'Could not delete interview.');
    else await load();
  }

  return (
    <>
      {error && <div className="alert alert-error">{error}</div>}
      {isManager && <div className="search-row"><button className="btn btn-primary" type="button" onClick={startCreate}>+ Schedule Interview</button></div>}
      <Modal
        open={showForm && isManager}
        title={editingId ? 'Edit Interview' : 'Schedule Interview'}
        onClose={() => {
          if (!saving) setShowForm(false);
        }}
        footer={(
          <>
            <button className="btn btn-ghost" type="button" disabled={saving} onClick={() => setShowForm(false)}>Cancel</button>
            <button className="btn btn-primary" type="submit" form="new-interview-form" disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </>
        )}
      >
        <form id="new-interview-form" onSubmit={(event) => { void save(event); }}>
          <div className="form-group">
            <label htmlFor="interview-bid">Account / Job</label>
            <select id="interview-bid" required value={form.bidId} onChange={(event) => setForm({ ...form, bidId: event.target.value })}>
              <option value="">Select a bid</option>
              {bids.map((bid) => <option key={bid.b_id} value={bid.b_id}>{bid.account_name} — {bid.job_title} ({bid.company})</option>)}
            </select>
          </div>
          <div className="form-group">
            <label htmlFor="interview-caller">Caller</label>
            <select id="interview-caller" required value={form.callerUserId} onChange={(event) => setForm({ ...form, callerUserId: event.target.value })}>
              <option value="">Select a Caller</option>
              {callers.map((caller) => <option key={caller.u_id} value={caller.u_id}>{caller.name}</option>)}
            </select>
          </div>
          <div className="form-group"><label htmlFor="interview-date">Date</label><input id="interview-date" type="date" required value={form.interviewDate} onChange={(event) => setForm({ ...form, interviewDate: event.target.value })} /></div>
          <div className="form-group"><label htmlFor="interview-time">Time</label><input id="interview-time" type="time" required value={form.interviewTime} onChange={(event) => setForm({ ...form, interviewTime: event.target.value })} /></div>
          <div className="form-group"><label htmlFor="interview-interviewer">Interviewer</label><input id="interview-interviewer" required value={form.interviewer} onChange={(event) => setForm({ ...form, interviewer: event.target.value })} /></div>
          <div className="form-group">
            <label htmlFor="interview-step">Step</label>
            <select id="interview-step" value={form.step} onChange={(event) => setForm({ ...form, step: event.target.value as NewSchemaInterview['step'] })}>
              {(['intro', 'tech-1', 'tech-2', 'final'] as const).map((step) => <option key={step} value={step}>{step}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label htmlFor="interview-status">Status</label>
            <select id="interview-status" value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as NewSchemaInterview['status'] })}>
              {(['todo', 'did', 'failed', 'respond_waiting'] as const).map((status) => <option key={status} value={status}>{status}</option>)}
            </select>
          </div>
        </form>
        {formError && <div className="alert alert-error">{formError}</div>}
      </Modal>
      <div className="card">
        {loading ? <div className="text-muted">Loading…</div> : (
          <div className="table-scroll table-scroll--wide">
            <table>
              <thead><tr><th>Account</th><th>Job</th><th>Date</th><th>Time</th><th>Step</th><th>Caller</th><th>Status</th><th>Outcome</th><th>Manager comment</th><th /></tr></thead>
              <tbody>
                {interviews.map((interview) => (
                  <tr key={interview.i_id}>
                    <td>{interview.account_name}</td><td>{interview.job_title} · {interview.company}</td>
                    <td>{formatDate(interview.interview_date)}</td><td>{interview.interview_time.slice(0, 5)}</td>
                    <td>{interview.step}</td><td>{interview.caller_name}</td><td>{interview.status}</td>
                    <td>
                      {(isCaller || isManager) ? (
                        <select aria-label={`Outcome for interview ${interview.i_id}`} value={interview.outcome || ''} onChange={(event) => { void updateOutcome(interview, (event.target.value || null) as NewSchemaInterview['outcome']); }}>
                          <option value="">No outcome</option><option value="good">Good</option><option value="normal">Normal</option><option value="bad">Bad</option>
                        </select>
                      ) : interview.outcome || '—'}
                    </td>
                    <td>{isManager ? (
                      <form onSubmit={(event) => { event.preventDefault(); const input = event.currentTarget.elements.namedItem('comment') as HTMLInputElement | null; if (input) void saveComment(interview, input.value); }}>
                        <input name="comment" aria-label={`Manager comment for interview ${interview.i_id}`} defaultValue={interview.comment || ''} />
                        <button className="btn btn-ghost btn-sm" type="submit">Save</button>
                      </form>
                    ) : interview.comment || '—'}</td>
                    <td>{isManager && <><button className="btn btn-ghost btn-sm" type="button" onClick={() => startEdit(interview)}>Edit</button><button className="btn btn-danger btn-sm" type="button" onClick={() => { void remove(interview); }}>Delete</button></>}</td>
                  </tr>
                ))}
                {!interviews.length && <tr><td colSpan={10} className="text-muted">No interviews found.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
