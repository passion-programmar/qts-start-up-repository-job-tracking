'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { api } from '@/lib/api';
import type { NewSchemaAnalytics } from '@/lib/types';

type AnalyticsPeriod = NewSchemaAnalytics['period'];

const PERIOD_LABELS: Record<AnalyticsPeriod, string> = {
  day: 'Daily (last 30 days)',
  week: 'Weekly (last 12 weeks)',
  month: 'Monthly (last 12 months)',
  year: 'Yearly (last 5 years)',
};

function periodLabel(bucket: string, period: AnalyticsPeriod): string {
  const date = new Date(bucket);
  if (Number.isNaN(date.getTime())) return bucket;
  if (period === 'year') return new Intl.DateTimeFormat(undefined, { year: 'numeric' }).format(date);
  if (period === 'month') return new Intl.DateTimeFormat(undefined, { month: 'short', year: '2-digit' }).format(date);
  if (period === 'week') return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date);
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date);
}

function BarList({
  title,
  rows,
  label,
}: {
  title: string;
  rows: Array<{ label: string; count: number }>;
  label: (value: string) => string;
}) {
  const max = Math.max(1, ...rows.map((row) => row.count));
  return (
    <section className="card">
      <div className="card-title">{title}</div>
      {!rows.length ? <p className="text-muted">No results for this period.</p> : (
        <div style={{ display: 'grid', gap: 10 }}>
          {rows.map((row) => (
            <div key={row.label} style={{ display: 'grid', gridTemplateColumns: 'minmax(90px, 130px) 1fr 36px', gap: 10, alignItems: 'center' }}>
              <span title={label(row.label)} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label(row.label)}</span>
              <div role="img" aria-label={`${row.count} for ${label(row.label)}`} style={{ height: 12, borderRadius: 8, background: 'var(--border, #e5e7eb)' }}>
                <div style={{ width: `${(row.count / max) * 100}%`, height: '100%', borderRadius: 8, background: 'var(--primary, #2563eb)' }} />
              </div>
              <strong style={{ textAlign: 'right' }}>{row.count}</strong>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export function NewSchemaAnalyticsView() {
  const { user } = useAuth();
  const [period, setPeriod] = useState<AnalyticsPeriod>('month');
  const [data, setData] = useState<NewSchemaAnalytics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const result = await api<{ success: boolean; analytics?: NewSchemaAnalytics; message?: string }>(
      'GET',
      `/api/v2/analytics?period=${period}`
    );
    if (result.success && result.analytics) {
      setData(result.analytics);
      setError(null);
    } else {
      setError(result.message || 'Could not load analytics.');
    }
    setLoading(false);
  }, [period]);

  useEffect(() => {
    // Refresh the report whenever its selected time grouping changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const isManager = user?.role === 'manager';
  const periodText = (bucket: string) => periodLabel(bucket, period);

  return (
    <>
      <div className="search-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <p className="text-muted" style={{ margin: 0 }}>Bid volume and interview outcomes across the selected period.</p>
        <label>
          <span className="sr-only">Analytics period</span>
          <select aria-label="Analytics period" value={period} onChange={(event) => setPeriod(event.target.value as AnalyticsPeriod)}>
            {(Object.keys(PERIOD_LABELS) as AnalyticsPeriod[]).map((value) => (
              <option key={value} value={value}>{PERIOD_LABELS[value]}</option>
            ))}
          </select>
        </label>
      </div>
      {error && <div className="alert alert-error">{error}</div>}
      {loading ? <div className="card text-muted">Loading analytics…</div> : data && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
            <BarList
              title="Bids over time"
              rows={data.bidsByPeriod.map((row) => ({ label: row.bucket, count: row.count }))}
              label={periodText}
            />
            <BarList
              title="Interviews over time"
              rows={data.interviewsByPeriod.map((row) => ({ label: row.bucket, count: row.count }))}
              label={periodText}
            />
            <BarList
              title="Bids by job status"
              rows={data.bidsByStatus.map((row) => ({ label: row.status, count: row.count }))}
              label={(value) => value}
            />
            <BarList
              title="Interviews by outcome"
              rows={data.interviewsByOutcome.map((row) => ({ label: row.outcome, count: row.count }))}
              label={(value) => value === 'pending' ? 'Pending outcome' : value}
            />
          </div>
          {!isManager && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16, marginTop: 16 }}>
              <div className="card">
                <div className="card-title">Results by Manager</div>
                <div className="table-scroll"><table>
                  <thead><tr><th>Manager</th><th>Bids</th><th>Interviews</th></tr></thead>
                  <tbody>{data.byManager.map((row) => <tr key={row.manager_id}><td>{row.manager_name}</td><td>{row.bids}</td><td>{row.interviews}</td></tr>)}
                    {!data.byManager.length && <tr><td colSpan={3} className="text-muted">No Manager activity for this period.</td></tr>}
                  </tbody>
                </table></div>
              </div>
              <div className="card">
                <div className="card-title">Results by Account Profile</div>
                <div className="table-scroll"><table>
                  <thead><tr><th>Account</th><th>Bids</th><th>Interviews</th></tr></thead>
                  <tbody>{data.byAccount.map((row) => <tr key={row.account_user_id}><td>{row.account_name}</td><td>{row.bids}</td><td>{row.interviews}</td></tr>)}
                    {!data.byAccount.length && <tr><td colSpan={3} className="text-muted">No Account activity for this period.</td></tr>}
                  </tbody>
                </table></div>
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}
