'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';

type BidAttempt = {
  attempt_id: number | null;
  job_id: number;
  job_title: string;
  company: string;
  url: string;
  account_user_id: number;
  account_name: string;
  status: 'not_started' | 'in_progress' | 'needs_review' | 'submitted' | 'failed';
  failure_reason: string | null;
  manager_note: string | null;
  started_at: string | null;
  submitted_at: string | null;
};

const STATUS_LABELS: Record<BidAttempt['status'], string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  needs_review: 'Needs review',
  submitted: 'Submitted',
  failed: 'Failed',
};

export function ManagerBidStatusView() {
  const [attempts, setAttempts] = useState<BidAttempt[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const response = await api<{ success: boolean; message?: string; attempts?: BidAttempt[] }>(
      'GET',
      '/api/v2/application-attempts'
    );
    if (!response.success) {
      setError(response.message || 'Could not load Bid Status.');
      setAttempts([]);
    } else {
      setAttempts(response.attempts || []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    // Load Job–Account bid statuses after the page mounts.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const visibleAttempts = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return attempts;
    return attempts.filter((attempt) =>
      `${attempt.account_name} ${attempt.job_title} ${attempt.company} ${attempt.status} ${attempt.failure_reason || ''}`
        .toLowerCase().includes(needle)
    );
  }, [attempts, search]);

  async function editNote(attempt: BidAttempt) {
    if (!attempt.attempt_id) return;
    const managerNote = window.prompt('Add or edit a note for this application:', attempt.manager_note || '');
    if (managerNote === null) return;
    const result = await api<{ success: boolean; message?: string }>(
      'PUT',
      `/api/v2/application-attempts/${attempt.job_id}/${attempt.account_user_id}/note`,
      { managerNote: managerNote.trim() || null }
    );
    if (!result.success) {
      setError(result.message || 'Could not save the Manager note.');
      return;
    }
    setMessage('Manager note saved.');
    await load();
  }

  return (
    <>
      {error && <div className="alert alert-error">{error}</div>}
      {message && <div className="alert alert-success">{message}</div>}
      <div className="search-row">
        <input aria-label="Search bid statuses" placeholder="Search Accounts or jobs…"
          value={search} onChange={(event) => setSearch(event.target.value)} />
        <button className="btn btn-ghost" type="button" onClick={() => { void load(); }}>Refresh</button>
      </div>
      <div className="card">
        <h2>Applications by Account and Job</h2>
        <p className="text-muted">Each assigned Account has its own application status. Failed attempts are closed and cannot be retried.</p>
        {loading ? <div className="text-muted">Loading…</div> : (
          <div className="table-scroll">
            <table>
              <thead><tr>
                <th>Account</th><th>Job</th><th>Company</th><th>Status</th>
                <th>Failure reason</th><th>Manager note</th><th />
              </tr></thead>
              <tbody>
                {visibleAttempts.map((attempt) => (
                  <tr key={`${attempt.job_id}-${attempt.account_user_id}`}>
                    <td>{attempt.account_name}</td>
                    <td><a href={attempt.url} target="_blank" rel="noreferrer">{attempt.job_title}</a></td>
                    <td>{attempt.company}</td>
                    <td>{STATUS_LABELS[attempt.status]}</td>
                    <td>{attempt.failure_reason || '—'}</td>
                    <td>{attempt.manager_note || '—'}</td>
                    <td className="text-right">
                      {attempt.attempt_id && (
                        <button className="btn btn-ghost btn-sm" type="button" onClick={() => { void editNote(attempt); }}>
                          {attempt.manager_note ? 'Edit note' : 'Add note'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {!visibleAttempts.length && <tr><td colSpan={7} className="text-muted">No assigned Accounts or bids found.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
