'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/components/AuthProvider';
import { formatDate } from '@/lib/utils';
import type { NewSchemaBid, NewSchemaJob } from '@/lib/types';

const ATTEMPT_STATUS_LABELS: Record<NewSchemaJob['selected_accounts'][number]['status'], string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  needs_review: 'Needs review',
  submitted: 'Submitted',
  failed: 'Failed',
};

export function NewSchemaJobsView() {
  const { user } = useAuth();
  const isManager = user?.role === 'manager';
  const [bids, setBids] = useState<NewSchemaBid[]>([]);
  const [jobs, setJobs] = useState<NewSchemaJob[]>([]);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [deletingJobId, setDeletingJobId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [result, jobsResult] = await Promise.all([
        api<{ success: boolean; message?: string; bids?: NewSchemaBid[] }>(
        'GET',
        '/api/v2/bids'
        ),
        isManager
          ? api<{ success: boolean; message?: string; jobs?: NewSchemaJob[] }>('GET', '/api/v2/jobs')
          : Promise.resolve(null),
      ]);
      if (!result.success) {
        setBids([]);
        setError(result.message || 'Could not load bid history.');
        return;
      }
      setBids(result.bids || []);
      if (jobsResult) {
        if (!jobsResult.success) {
          setJobs([]);
          setError(jobsResult.message || 'Could not load your job list.');
        } else {
          setJobs(jobsResult.jobs || []);
        }
      }
    } catch (loadError) {
      setBids([]);
      setJobs([]);
      setError(loadError instanceof Error ? loadError.message : 'Could not load bid history.');
    } finally {
      setLoading(false);
    }
  }, [isManager]);

  useEffect(() => {
    // Load bid history on mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const visibleBids = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return bids;
    return bids.filter((bid) =>
      `${bid.account_name} ${bid.job_title} ${bid.company}`.toLowerCase().includes(needle)
    );
  }, [bids, search]);

  const visibleJobs = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return jobs;
    return jobs.filter((job) =>
      `${job.title} ${job.company} ${job.url} ${job.status} ${(job.selected_accounts || [])
        .map((account) => `${account.name} ${account.status}`).join(' ')}`
        .toLowerCase().includes(needle)
    );
  }, [jobs, search]);

  async function removeJob(job: NewSchemaJob) {
    if (deletingJobId !== null) return;
    const confirmed = window.confirm(
      `Remove "${job.title}" from your active job list? Its application attempts will be cleared so its Accounts can be retried if the job is added again. Submitted Bids and their interview history will be kept.`
    );
    if (!confirmed) return;

    setDeletingJobId(job.id);
    setError(null);
    try {
      const result = await api<{ success: boolean; message?: string }>(
        'DELETE',
        `/api/v2/jobs/${encodeURIComponent(String(job.id))}`
      );
      if (!result.success) {
        setError(result.message || 'Could not remove the job from your list.');
        return;
      }
      setJobs((current) => current.filter((item) => item.id !== job.id));
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : 'Could not remove the job from your list.');
    } finally {
      setDeletingJobId(null);
    }
  }

  return (
    <>
      {error && <div className="alert alert-error">{error}</div>}
      <div className="search-row">
        <input
          aria-label="Search jobs and bids"
          placeholder="Search jobs and bids…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>
      {isManager && (
        <div className="card">
          <h2>My job list</h2>
          <p className="text-muted">
            Remove completed or old listings from the active list. Bids and interview history are retained.
          </p>
          {loading ? <div className="text-muted">Loading…</div> : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Job</th>
                    <th>Company</th>
                    <th>Status</th>
                    <th>Accounts</th>
                    <th>Bids</th>
                    <th>Added</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleJobs.map((job) => (
                    <tr key={job.id}>
                      <td><a href={job.url} target="_blank" rel="noreferrer">{job.title}</a></td>
                      <td>{job.company}</td>
                      <td>{job.status}</td>
                      <td>
                        {job.selected_accounts?.length ? (
                          <ul style={{ margin: 0, paddingLeft: 18 }}>
                            {job.selected_accounts.map((account) => (
                              <li key={account.account_user_id}>
                                {account.name} — {ATTEMPT_STATUS_LABELS[account.status] || account.status}
                              </li>
                            ))}
                          </ul>
                        ) : 'No Accounts assigned'}
                      </td>
                      <td>{job.bid_count}</td>
                      <td>{formatDate(job.get_date)}</td>
                      <td>
                        <button
                          className="btn btn-danger btn-sm"
                          type="button"
                          disabled={deletingJobId !== null}
                          onClick={() => { void removeJob(job); }}
                        >
                          {deletingJobId === job.id ? 'Removing…' : 'Delete'}
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!visibleJobs.length && (
                    <tr><td colSpan={7} className="text-muted">No active jobs found.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
      <div className="card">
        <h2>Bids</h2>
        {loading ? <div className="text-muted">Loading…</div> : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Job</th>
                  <th>Company</th>
                  <th>Status</th>
                  <th>Applied</th>
                  <th>Resume path</th>
                </tr>
              </thead>
              <tbody>
                {visibleBids.map((bid) => (
                  <tr key={bid.b_id}>
                    <td>{bid.account_name}</td>
                    <td><a href={bid.url} target="_blank" rel="noreferrer">{bid.job_title}</a></td>
                    <td>{bid.company}</td>
                    <td>{bid.status}</td>
                    <td>{formatDate(bid.applied_date)}</td>
                    <td>
                      <code style={{ whiteSpace: 'normal', overflowWrap: 'anywhere' }}>
                        {bid.resume_path || 'Not provided'}
                      </code>
                    </td>
                  </tr>
                ))}
                {!visibleBids.length && (
                  <tr><td colSpan={6} className="text-muted">No bids recorded yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
