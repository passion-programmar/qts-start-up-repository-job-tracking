'use client';

import { LoadingState } from '@/components/LoadingState';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import type { NewSchemaJobAccountStatus } from '@/lib/types';

const STATUS_LABELS: Record<NewSchemaJobAccountStatus['status'], string> = {
  todo: 'To do',
  processing: 'Processing',
  did: 'Applied',
  failed: 'Failed',
};

function applicationTypeLabel(type: string): string {
  return type === 'workable' ? 'Workable' : type;
}

export function ManagerBidStatusView() {
  const [rows, setRows] = useState<NewSchemaJobAccountStatus[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [resettingJobId, setResettingJobId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await api<{
        success: boolean;
        message?: string;
        jobs?: NewSchemaJobAccountStatus[];
      }>('GET', '/api/v2/jobs/statuses');
      if (!response.success) {
        setError(response.message || 'Could not load application statuses.');
        setRows([]);
      } else {
        setRows(response.jobs || []);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load application statuses.');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Load application statuses on mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function resetFailedJob(row: NewSchemaJobAccountStatus) {
    if (resettingJobId !== null) return;
    const confirmed = window.confirm(
      `Reset "${row.job_title}" for ${row.account_name} to To do? It will be eligible for Apply again.`
    );
    if (!confirmed) return;

    setResettingJobId(row.job_id);
    setError('');
    try {
      const response = await api<{ success: boolean; message?: string }>(
        'PATCH',
        `/api/v2/jobs/${encodeURIComponent(String(row.job_id))}/status`,
        { status: 'todo' }
      );
      if (!response.success) {
        setError(response.message || 'Could not reset the failed job.');
        return;
      }
      setRows((current) => current.map((item) =>
        item.job_id === row.job_id ? { ...item, status: 'todo' } : item
      ));
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : 'Could not reset the failed job.');
    } finally {
      setResettingJobId(null);
    }
  }

  const visibleRows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) =>
      `${row.account_name} ${row.job_title} ${row.company} ${row.application_type} ${row.status}`
        .toLowerCase().includes(needle)
    );
  }, [rows, search]);

  return (
    <>
      {error && <div className="alert alert-error">{error}</div>}
      <div className="search-row">
        <input
          aria-label="Search bid statuses"
          placeholder="Search Accounts or jobs…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <button className="btn btn-ghost" type="button" onClick={() => { void load(); }}>
          Refresh
        </button>
      </div>
      <div className="card">
        <h2>Applications by Account and Job</h2>
        <p className="text-muted">Each Account has a separate job row. Reset a failed row to To do to make it eligible for Apply again.</p>
        {loading ? <LoadingState label="Loading…" /> : (
          <div className="table-scroll">
            <table>
              <thead><tr>
                <th>Account</th><th>Job</th><th>Application type</th><th>Company</th><th>Status</th><th>Actions</th>
              </tr></thead>
              <tbody>
                {visibleRows.map((row) => (
                  <tr key={row.job_id}>
                    <td>{row.account_name}</td>
                    <td><a href={row.url} target="_blank" rel="noreferrer">{row.job_title}</a></td>
                    <td>{applicationTypeLabel(row.application_type)}</td>
                    <td>{row.company}</td>
                    <td>{STATUS_LABELS[row.status]}</td>
                    <td>
                      {row.status === 'failed' && (
                        <button
                          className="btn btn-ghost btn-sm"
                          type="button"
                          disabled={resettingJobId !== null}
                          onClick={() => { void resetFailedJob(row); }}
                        >
                          {resettingJobId === row.job_id ? 'Resetting…' : 'Reset to To do'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {!visibleRows.length && <tr><td colSpan={6} className="text-muted">No Account-specific job rows found.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
