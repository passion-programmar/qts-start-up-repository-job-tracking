'use client';

import { useCallback, useEffect, useState } from 'react';
import { Modal } from '@/components/Modal';
import { useAuth } from '@/components/AuthProvider';
import { api } from '@/lib/api';
import type { InterviewProcess } from '@/lib/types';
import { formatDate } from '@/lib/utils';

const STAGE_OPTIONS = [
  'Phone Screen', 'Technical', 'Behavioral', 'Onsite', 'Final', 'Offer', 'Rejected', 'Other',
];

const emptyForm = {
  candidateName: '',
  candidateId: '',
  scheduledDate: '',
  attendDate: '',
  interviewTime: '',
  timezone: 'UTC',
  position: '',
  company: '',
  jobUrl: '',
  resume: '',
  meetingUrl: '',
  salary: '',
  stage: '',
  callerUserId: '',
  bidderId: '',
};

export function InterviewsView() {
  const { canWrite, canAddInterviews } = useAuth();
  const [interviews, setInterviews] = useState<InterviewProcess[]>([]);
  const [timezones, setTimezones] = useState<string[]>(['UTC']);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<'form' | 'delete' | null>(null);
  const [selected, setSelected] = useState<InterviewProcess | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [listR, tzR] = await Promise.all([
      api<{ success: boolean; interviews?: InterviewProcess[] }>('GET', '/api/interviews'),
      api<{ success: boolean; timezones?: string[] }>('GET', '/api/interviews/meta/timezones'),
    ]);
    setInterviews(listR.interviews || []);
    setTimezones(tzR.timezones || ['UTC']);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function openAdd() {
    setSelected(null);
    setForm(emptyForm);
    setError(null);
    setModal('form');
  }

  function openEdit(row: InterviewProcess) {
    setSelected(row);
    setForm({
      candidateName: row.candidate_name,
      candidateId: row.candidate_id ? String(row.candidate_id) : '',
      scheduledDate: row.scheduled_date?.slice(0, 10) || '',
      attendDate: row.attend_date?.slice(0, 10) || '',
      interviewTime: row.interview_time || '',
      timezone: row.timezone || 'UTC',
      position: row.position || '',
      company: row.company || '',
      jobUrl: row.job_url || '',
      resume: row.resume || '',
      meetingUrl: row.meeting_url || '',
      salary: row.salary || '',
      stage: row.stage || '',
      callerUserId: row.caller_user_id ? String(row.caller_user_id) : '',
      bidderId: row.bidder_id ? String(row.bidder_id) : '',
    });
    setError(null);
    setModal('form');
  }

  function buildBody() {
    return {
      candidateName: form.candidateName.trim(),
      candidateId: form.candidateId ? parseInt(form.candidateId, 10) : null,
      scheduledDate: form.scheduledDate || null,
      attendDate: form.attendDate || null,
      interviewTime: form.interviewTime || null,
      timezone: form.timezone || 'UTC',
      position: form.position || null,
      company: form.company || null,
      jobUrl: form.jobUrl || null,
      resume: form.resume || null,
      meetingUrl: form.meetingUrl || null,
      salary: form.salary || null,
      stage: form.stage || null,
      callerUserId: form.callerUserId ? parseInt(form.callerUserId, 10) : null,
      bidderId: form.bidderId ? parseInt(form.bidderId, 10) : null,
    };
  }

  async function saveInterview() {
    if (!form.candidateName.trim()) {
      setError('Candidate name is required.');
      return;
    }
    const body = buildBody();
    const r = selected && canWrite
      ? await api<{ success: boolean; message?: string }>('PUT', `/api/interviews/${selected.id}`, body)
      : await api<{ success: boolean; message?: string }>('POST', '/api/interviews', body);
    if (r.success) {
      setModal(null);
      void load();
    } else {
      setError(r.message || 'Could not save interview.');
    }
  }

  async function deleteInterview() {
    if (!selected) return;
    await api('DELETE', `/api/interviews/${selected.id}`);
    setModal(null);
    void load();
  }

  return (
    <>
      {canAddInterviews && (
        <div className="search-row">
          <button className="btn btn-primary" type="button" onClick={openAdd}>
            + Add Interview
          </button>
        </div>
      )}

      <div className="card">
        {loading ? (
          <div className="text-muted">Loading…</div>
        ) : (
          <div className="table-scroll table-scroll--wide">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Candidate</th>
                <th>Company / Position</th>
                <th>Scheduled</th>
                <th>Attend</th>
                <th>Time (TZ)</th>
                <th>Caller</th>
                <th>Stage</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {interviews.map((row) => (
                <tr key={row.id}>
                  <td>{row.id}</td>
                  <td><strong>{row.candidate_name}</strong></td>
                  <td>
                    <div>{row.company || '—'}</div>
                    <div className="text-muted">{row.position || ''}</div>
                  </td>
                  <td className="text-muted">{formatDate(row.scheduled_date)}</td>
                  <td className="text-muted">{formatDate(row.attend_date)}</td>
                  <td className="text-muted">
                    {row.interview_time || '—'}
                    <br />
                    <small>{row.timezone}</small>
                  </td>
                  <td className="text-muted">{row.caller_username || '—'}</td>
                  <td><span className="badge badge-applied">{row.stage || '—'}</span></td>
                  <td className="text-right">
                    <button className="btn btn-ghost btn-sm" type="button" onClick={() => openEdit(row)}>
                      {canWrite ? 'Edit' : 'View'}
                    </button>
                    {row.job_url && (
                      <a
                        className="btn btn-ghost btn-sm"
                        href={row.job_url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Job
                      </a>
                    )}
                    {row.meeting_url && (
                      <a
                        className="btn btn-ghost btn-sm"
                        href={row.meeting_url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Meet
                      </a>
                    )}
                    {canWrite && (
                      <button
                        className="btn btn-danger btn-sm"
                        type="button"
                        onClick={() => {
                          setSelected(row);
                          setModal('delete');
                        }}
                      >
                        Delete
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {!interviews.length && (
                <tr><td colSpan={9} className="text-muted">No interview records yet.</td></tr>
              )}
            </tbody>
          </table>
          </div>
        )}
      </div>

      <Modal
        open={modal === 'form'}
        title={selected ? (canWrite ? 'Edit Interview' : 'View Interview') : 'Add Interview'}
        onClose={() => setModal(null)}
        footer={
          (canWrite || !selected) ? (
            <>
              <button className="btn btn-ghost" type="button" onClick={() => setModal(null)}>Cancel</button>
              <button className="btn btn-primary" type="button" onClick={() => { void saveInterview(); }}>
                {selected ? 'Save' : 'Add'}
              </button>
            </>
          ) : (
            <button className="btn btn-ghost" type="button" onClick={() => setModal(null)}>Close</button>
          )
        }
      >
        <div className="two-col">
          <div className="form-group">
            <label>Candidate Name *</label>
            <input
              value={form.candidateName}
              disabled={selected !== null && !canWrite}
              onChange={(e) => setForm({ ...form, candidateName: e.target.value })}
            />
          </div>
          <div className="form-group">
            <label>Stage</label>
            <select
              value={form.stage}
              disabled={selected !== null && !canWrite}
              onChange={(e) => setForm({ ...form, stage: e.target.value })}
            >
              <option value="">— Select —</option>
              {STAGE_OPTIONS.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="two-col">
          <div className="form-group">
            <label>Scheduled Date</label>
            <input
              type="date"
              value={form.scheduledDate}
              disabled={selected !== null && !canWrite}
              onChange={(e) => setForm({ ...form, scheduledDate: e.target.value })}
            />
          </div>
          <div className="form-group">
            <label>Interview Attend Date</label>
            <input
              type="date"
              value={form.attendDate}
              disabled={selected !== null && !canWrite}
              onChange={(e) => setForm({ ...form, attendDate: e.target.value })}
            />
          </div>
        </div>
        <div className="two-col">
          <div className="form-group">
            <label>Interview Time</label>
            <input
              type="time"
              value={form.interviewTime}
              disabled={selected !== null && !canWrite}
              onChange={(e) => setForm({ ...form, interviewTime: e.target.value })}
            />
          </div>
          <div className="form-group">
            <label>Timezone</label>
            <select
              value={form.timezone}
              disabled={selected !== null && !canWrite}
              onChange={(e) => setForm({ ...form, timezone: e.target.value })}
            >
              {timezones.map((tz) => (
                <option key={tz} value={tz}>{tz}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="two-col">
          <div className="form-group">
            <label>Position</label>
            <input
              value={form.position}
              disabled={selected !== null && !canWrite}
              onChange={(e) => setForm({ ...form, position: e.target.value })}
            />
          </div>
          <div className="form-group">
            <label>Company</label>
            <input
              value={form.company}
              disabled={selected !== null && !canWrite}
              onChange={(e) => setForm({ ...form, company: e.target.value })}
            />
          </div>
        </div>
        <div className="form-group">
          <label>Job URL</label>
          <input
            type="url"
            value={form.jobUrl}
            disabled={selected !== null && !canWrite}
            onChange={(e) => setForm({ ...form, jobUrl: e.target.value })}
          />
        </div>
        <div className="form-group">
          <label>Meeting URL</label>
          <input
            type="url"
            value={form.meetingUrl}
            disabled={selected !== null && !canWrite}
            onChange={(e) => setForm({ ...form, meetingUrl: e.target.value })}
          />
        </div>
        <div className="form-group">
          <label>Resume (URL or notes)</label>
          <textarea
            value={form.resume}
            disabled={selected !== null && !canWrite}
            onChange={(e) => setForm({ ...form, resume: e.target.value })}
          />
        </div>
        <div className="form-group">
          <label>Salary</label>
          <input
            value={form.salary}
            disabled={selected !== null && !canWrite}
            onChange={(e) => setForm({ ...form, salary: e.target.value })}
          />
        </div>
        {error && <div className="alert alert-error">{error}</div>}
      </Modal>

      <Modal
        open={modal === 'delete'}
        title="Delete Interview"
        onClose={() => setModal(null)}
        footer={
          <>
            <button className="btn btn-ghost" type="button" onClick={() => setModal(null)}>Cancel</button>
            <button className="btn btn-danger" type="button" onClick={() => { void deleteInterview(); }}>Delete</button>
          </>
        }
      >
        <p className="confirm-text">Delete interview record for <strong>{selected?.candidate_name}</strong>?</p>
      </Modal>
    </>
  );
}
