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
type EditableJobStatus = 'todo' | 'failed' | 'did';

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
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [deletingJobId, setDeletingJobId] = useState<number | null>(null);
  const [editingJobId, setEditingJobId] = useState<number | null>(null);
  const [editedStatus, setEditedStatus] = useState<EditableJobStatus>('todo');
  const [savingStatusJobId, setSavingStatusJobId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [result, jobsResult] = await Promise.all([
        isManager
          ? Promise.resolve(null)
          : api<{ success: boolean; message?: string; bids?: NewSchemaBid[] }>(
            'GET',
            '/api/v2/bids'
          ),
        isManager
          ? api<{ success: boolean; message?: string; jobs?: NewSchemaJob[] }>('GET', '/api/v2/jobs')
          : Promise.resolve(null),
      ]);
      if (result) {
        if (!result.success) {
          setBids([]);
          setError(result.message || 'Could not load bid history.');
          return;
        }
        setBids(result.bids || []);
      }
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

  async function updateJobStatus(job: NewSchemaJob) {
    if (savingStatusJobId !== null) return;
    if (editedStatus === 'did' && !window.confirm(
      `Confirm "${job.title}" for ${job.selected_accounts?.[0]?.name || 'this Account'} was successfully applied? It will move from the Job List to Bids.`
    )) return;

    setSavingStatusJobId(job.id);
    setError(null);
    setNotice(null);
    try {
      const result = await api<{ success: boolean; message?: string; status?: NewSchemaJob['status'] }>(
        'PATCH',
        `/api/v2/jobs/${encodeURIComponent(String(job.id))}/status`,
        { status: editedStatus }
      );
      if (!result.success) {
        setError(result.message || 'Could not update the job status.');
        return;
      }
      const updatedStatus = result.status;
      if (updatedStatus === 'did') {
        setJobs((current) => current.filter((item) => item.id !== job.id));
        setNotice('Application confirmed. The job was moved to Bids.');
      } else if (updatedStatus) {
        setJobs((current) => current.map((item) =>
          item.id === job.id ? { ...item, status: updatedStatus } : item
        ));
        setNotice(`Job status changed to ${JOB_STATUS_LABELS[updatedStatus]}.`);
      }
      setEditingJobId(null);
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'Could not update the job status.');
    } finally {
      setSavingStatusJobId(null);
    }
  }

  return (
    <>
      {error && <div className="alert alert-error">{error}</div>}
      {notice && <div className="alert alert-success">{notice}</div>}
      <div className="search-row">
        <input
          aria-label={isManager ? 'Search jobs' : 'Search bids'}
          placeholder={isManager ? 'Search jobs…' : 'Search bids…'}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>
      {isManager && (
        <div className="card">
          <h2>My job list</h2>
          <p className="text-muted">
            Jobs you add are saved here for the selected Accounts. Confirming Applied moves that Account’s job into Bids; Processing is managed by Apply.
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
                      <td>
                        {editingJobId === job.id ? (
                          <select
                            aria-label={`New status for ${job.title}`}
                            value={editedStatus}
                            disabled={savingStatusJobId !== null}
                            onChange={(event) => setEditedStatus(event.target.value as EditableJobStatus)}
                          >
                            <option value="todo">To do</option>
                            <option value="failed">Failed</option>
                            <option value="did">Applied (move to Bids)</option>
                          </select>
                        ) : JOB_STATUS_LABELS[job.status]}
                      </td>
                      <td>{job.selected_accounts?.[0]?.name || 'No Account assigned'}</td>
                      <td>{formatDate(job.get_date)}</td>
                      <td>
                        {editingJobId === job.id ? (
                          <>
                            <button
                              className="btn btn-primary btn-sm"
                              type="button"
                              disabled={savingStatusJobId !== null || editedStatus === job.status}
                              onClick={() => { void updateJobStatus(job); }}
                            >
                              {savingStatusJobId === job.id ? 'Saving…' : 'Save'}
                            </button>
                            <button
                              className="btn btn-ghost btn-sm"
                              type="button"
                              disabled={savingStatusJobId !== null}
                              onClick={() => setEditingJobId(null)}
                            >
                              Cancel
                            </button>
                          </>
                        ) : job.status !== 'processing' && (
                          <button
                            className="btn btn-ghost btn-sm"
                            type="button"
                            disabled={savingStatusJobId !== null || deletingJobId !== null}
                            onClick={() => {
                              setEditingJobId(job.id);
                              setEditedStatus(job.status === 'failed' ? 'failed' : 'todo');
                            }}
                          >
                            Edit status
                          </button>
                        )}
                        <button
                          className="btn btn-danger btn-sm"
                          type="button"
                          disabled={deletingJobId !== null || savingStatusJobId !== null || editingJobId !== null || job.status !== 'todo'}
                          onClick={() => { void removeJob(job); }}
                        >
                          {deletingJobId === job.id ? 'Removing…' : 'Delete'}
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!visibleJobs.length && (
                    <tr><td colSpan={7} className="text-muted">No active Account-specific job rows found.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
      {!isManager && <div className="card">
        <h2>Bids</h2>
        {loading ? <LoadingState label="Loading…" /> : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Job</th>
                  <th>Company</th>
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
                    <td>{formatDate(bid.applied_date)}</td>
                    <td>
                      <code style={{ whiteSpace: 'normal', overflowWrap: 'anywhere' }}>
                        {bid.resume_path || 'Not provided'}
                      </code>
                    </td>
                  </tr>
                ))}
                {!visibleBids.length && (
                  <tr><td colSpan={5} className="text-muted">No bids recorded yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>}
    </>
  );
}
