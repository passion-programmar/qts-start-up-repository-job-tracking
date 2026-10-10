'use client';

import { LoadingState } from '@/components/LoadingState';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/utils';
import type { NewSchemaBid } from '@/lib/types';

export function ManagerBidStatusView() {
  const [bids, setBids] = useState<NewSchemaBid[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [deletingBidId, setDeletingBidId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await api<{
        success: boolean;
        message?: string;
        bids?: NewSchemaBid[];
      }>('GET', '/api/v2/bids');
      if (!response.success) {
        setError(response.message || 'Could not load your bids.');
        setBids([]);
      } else {
        setBids(response.bids || []);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load your bids.');
      setBids([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Load Manager bids on mount.
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

  async function deleteBid(bid: NewSchemaBid) {
    if (deletingBidId !== null) return;
    const confirmed = window.confirm(
      `Delete the submitted application for "${bid.job_title}" (${bid.company}) and its scheduled interviews? This cannot be undone.`
    );
    if (!confirmed) return;

    setDeletingBidId(bid.b_id);
    setError('');
    setNotice('');
    try {
      const response = await api<{
        success: boolean;
        message?: string;
      }>('DELETE', `/api/v2/bids/${encodeURIComponent(String(bid.b_id))}`);
      if (!response.success) {
        setError(response.message || 'Could not delete the submitted application.');
        return;
      }
      setBids((current) => current.filter((item) => item.b_id !== bid.b_id));
      setNotice(response.message || 'Submitted application deleted.');
    } catch (deleteError) {
      setError(deleteError instanceof Error
        ? deleteError.message
        : 'Could not delete the submitted application.');
    } finally {
      setDeletingBidId(null);
    }
  }

  return (
    <>
      {error && <div className="alert alert-error">{error}</div>}
      {notice && <div className="alert alert-success">{notice}</div>}
      <div className="search-row">
        <input
          aria-label="Search bids"
          placeholder="Search Accounts or jobs…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <button className="btn btn-ghost" type="button" onClick={() => { void load(); }}>
          Refresh
        </button>
      </div>
      <div className="card">
        <h2>Submitted applications</h2>
        <p className="text-muted">Successfully applied jobs are moved here from your active Job List.</p>
        {loading ? <LoadingState label="Loading…" /> : (
          <div className="table-scroll">
            <table>
              <thead><tr>
                <th>Account</th><th>Job</th><th>Company</th><th>Applied</th><th>Resume path</th><th>Actions</th>
              </tr></thead>
              <tbody>
                {visibleBids.map((bid) => (
                  <tr key={bid.b_id}>
                    <td>{bid.account_name}</td>
                    <td><a href={bid.url} target="_blank" rel="noreferrer">{bid.job_title}</a></td>
                    <td>{bid.company}</td>
                    <td>{formatDate(bid.applied_date)}</td>
                    <td><code style={{ whiteSpace: 'normal', overflowWrap: 'anywhere' }}>{bid.resume_path || 'Not provided'}</code></td>
                    <td>
                      <button
                        className="btn btn-danger btn-sm"
                        type="button"
                        disabled={deletingBidId !== null}
                        onClick={() => { void deleteBid(bid); }}
                      >
                        {deletingBidId === bid.b_id ? 'Deleting…' : 'Delete'}
                      </button>
                    </td>
                  </tr>
                ))}
                {!visibleBids.length && <tr><td colSpan={6} className="text-muted">No submitted applications found.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
