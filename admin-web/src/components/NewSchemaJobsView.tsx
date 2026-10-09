'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/utils';
import type { NewSchemaBid } from '@/lib/types';

export function NewSchemaJobsView() {
  const [bids, setBids] = useState<NewSchemaBid[]>([]);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api<{ success: boolean; message?: string; bids?: NewSchemaBid[] }>(
        'GET',
        '/api/v2/bids'
      );
      if (!result.success) {
        setBids([]);
        setError(result.message || 'Could not load bid history.');
        return;
      }
      setBids(result.bids || []);
    } catch (loadError) {
      setBids([]);
      setError(loadError instanceof Error ? loadError.message : 'Could not load bid history.');
    } finally {
      setLoading(false);
    }
  }, []);

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

  return (
    <>
      {error && <div className="alert alert-error">{error}</div>}
      <div className="search-row">
        <input
          aria-label="Search bids"
          placeholder="Search bids…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>
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
