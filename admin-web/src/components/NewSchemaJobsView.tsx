'use client';

import { LoadingState } from '@/components/LoadingState';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/components/AuthProvider';
import { formatDate } from '@/lib/utils';
import type { NewSchemaBid, NewSchemaJob } from '@/lib/types';

const JOB_STATUS_LABELS: Record<NewSchemaJob['status'], string> = {
  todo: 'To do',
  processing: 'Processing',
  did: 'Applied',
  failed: 'Failed',
};

function applicationTypeLabel(type: string): string {
  return type === 'workable' ? 'Workable' : type;
}

export function NewSchemaJobsView() {
  const { user } = useAuth();
  const isManager = user?.role === 'manager';
  const [bids, setBids] = useState<NewSchemaBid[]>([]);
  const [jobs, setJobs] = useState<NewSchemaJob[]>([]);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [deletingJobId, setDeletingJobId] = useState<number | null>(null);
  const [resettingJobId, setResettingJobId] = useState<number | null>(null);

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
      `Remove "${job.title}" for ${job.selected_accounts?.[0]?.name || 'this Account'} from your active job list?`
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

  async function resetFailedJob(job: NewSchemaJob) {
    if (resettingJobId !== null) return;
    const confirmed = window.confirm(
      `Reset "${job.title}" for ${job.selected_accounts?.[0]?.name || 'this Account'} to To do? It will be eligible for Apply again.`
    );
    if (!confirmed) return;

    setResettingJobId(job.id);
    setError(null);
    try {
      const result = await api<{ success: boolean; message?: string; status?: NewSchemaJob['status'] }>(
        'PATCH',
        `/api/v2/jobs/${encodeURIComponent(String(job.id))}/status`,
        { status: 'todo' }
      );
      if (!result.success) {
        setError(result.message || 'Could not reset the failed job.');
        return;
      }
      setJobs((current) => current.map((item) =>
        item.id === job.id ? { ...item, status: 'todo' } : item
      ));
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : 'Could not reset the failed job.');
    } finally {
      setResettingJobId(null);
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
            Each Account has its own job row. Failed rows can be reset to To do for another Apply attempt; only To do rows can be removed.
          </p>
          {loading ? <LoadingState label="Loading…" /> : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Job</th>
                    <th>Application type</th>
                    <th>Company</th>
                    <th>Status</th>
                    <th>Account</th>
                    <th>Bids</th>
                    <th>Added</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleJobs.map((job) => (
                    <tr key={job.id}>
                      <td><a href={job.url} target="_blank" rel="noreferrer">{job.title}</a></td>
                      <td>{applicationTypeLabel(job.application_type)}</td>
                      <td>{job.company}</td>
                      <td>{JOB_STATUS_LABELS[job.status]}</td>
                      <td>{job.selected_accounts?.[0]?.name || 'No Account assigned'}</td>
                      <td>{job.bid_count}</td>
                      <td>{formatDate(job.get_date)}</td>
                      <td>
                        {job.status === 'failed' && (
                          <button
                            className="btn btn-ghost btn-sm"
                            type="button"
                            disabled={resettingJobId !== null || deletingJobId !== null}
                            onClick={() => { void resetFailedJob(job); }}
                          >
                            {resettingJobId === job.id ? 'Resetting…' : 'Reset to To do'}
                          </button>
                        )}
                        <button
                          className="btn btn-danger btn-sm"
                          type="button"
                          disabled={deletingJobId !== null || resettingJobId !== null || job.status !== 'todo'}
                          onClick={() => { void removeJob(job); }}
                        >
                          {deletingJobId === job.id ? 'Removing…' : 'Delete'}
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!visibleJobs.length && (
                    <tr><td colSpan={8} className="text-muted">No active Account-specific job rows found.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
      <div className="card">
        <h2>Bids</h2>
        {loading ? <LoadingState label="Loading…" /> : (
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
