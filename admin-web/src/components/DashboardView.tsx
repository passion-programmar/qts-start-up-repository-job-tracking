'use client';

import { useEffect, useState } from 'react';
import { BidBars } from '@/components/BidBars';
import { api } from '@/lib/api';
import type { JobStats } from '@/lib/types';
import { formatDate } from '@/lib/utils';

function AppliedList({
  appliedCandidates,
}: {
  appliedCandidates: Array<{ name: string; applied_at: string }>;
}) {
  if (!appliedCandidates.length) {
    return <span className="text-muted">No applications</span>;
  }
  return (
    <>
      {appliedCandidates.map((a) => (
        <span className="badge badge-applied" key={`${a.name}-${a.applied_at}`}>
          {a.name} · {formatDate(a.applied_at)}
        </span>
      ))}
    </>
  );
}

export function DashboardView() {
  const [stats, setStats] = useState<JobStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await api<{ success: boolean; stats?: JobStats }>('GET', '/api/jobs/stats');
      if (!cancelled) {
        setStats(r.stats || null);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (loading) return <div className="text-muted">Loading…</div>;
  if (!stats) return <div className="text-muted">Could not load dashboard.</div>;

  const bid = stats.bidSummary || { today: 0, week: 0, month: 0 };
  const jobsOverview = stats.jobsOverview || [];
  const applications = stats.recentApplications || [];

  return (
    <>
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-label">Total Jobs</div>
          <div className="stat-value">{stats.totalJobs || 0}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Candidates</div>
          <div className="stat-value">{stats.totalCandidates || 0}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Active Candidates</div>
          <div className="stat-value">{stats.activeCandidates || 0}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Total Applications</div>
          <div className="stat-value">{stats.applications || 0}</div>
        </div>
      </div>

      <div className="card">
        <div className="card-title">Bid Results Summary</div>
        <div className="analytics-grid">
          <div className="analytics-card">
            <div className="stat-label">Today</div>
            <div className="stat-value">{bid.today}</div>
          </div>
          <div className="analytics-card">
            <div className="stat-label">Last 7 Days</div>
            <div className="stat-value">{bid.week}</div>
          </div>
          <div className="analytics-card">
            <div className="stat-label">This Month</div>
            <div className="stat-value">{bid.month}</div>
          </div>
        </div>
        <div className="two-col ops-layout" style={{ gap: 20 }}>
          <div>
            <div className="section-title">Daily (last 30 days)</div>
            <BidBars items={stats.dailyBids || []} emptyLabel="No daily bids yet." />
          </div>
          <div>
            <div className="section-title">Weekly (last 12 weeks)</div>
            <BidBars items={stats.weeklyBids || []} emptyLabel="No weekly bids yet." />
          </div>
        </div>
        <div style={{ marginTop: 20 }}>
          <div className="section-title">Monthly</div>
          <BidBars items={stats.monthlyBids || []} emptyLabel="No monthly bids yet." />
        </div>
      </div>

      <div className="card">
        <div className="card-title">Jobs &amp; Applied Candidates</div>
        <div className="table-scroll table-scroll--wide">
        <table>
          <thead>
            <tr>
              <th>Job</th>
              <th>Company</th>
              <th>Applied</th>
              <th>Applied Candidates</th>
              <th>Job Saved</th>
            </tr>
          </thead>
          <tbody>
            {jobsOverview.map((j) => (
              <tr key={j.id}>
                <td><strong>{j.title}</strong></td>
                <td>{j.company}</td>
                <td>
                  <span className={`badge ${j.appliedCandidates.length ? 'badge-applied' : 'badge-none'}`}>
                    {j.appliedCandidates.length}
                  </span>
                </td>
                <td className="applied-list">
                  <AppliedList appliedCandidates={j.appliedCandidates} />
                </td>
                <td className="text-muted">{formatDate(j.created_at)}</td>
              </tr>
            ))}
            {!jobsOverview.length && (
              <tr>
                <td colSpan={5} className="text-muted">No jobs saved yet.</td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
      </div>

      <div className="card">
        <div className="card-title">Recent Applications</div>
        <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Job</th>
              <th>Company</th>
              <th>Candidate</th>
              <th>Applied</th>
            </tr>
          </thead>
          <tbody>
            {applications.map((a) => (
              <tr key={`${a.job_id}-${a.candidate_name}-${a.applied_at}`}>
                <td><strong>{a.job_title}</strong></td>
                <td>{a.company}</td>
                <td><span className="badge badge-applied">{a.candidate_name}</span></td>
                <td className="text-muted">{a.applied_at ? formatDate(a.applied_at) : '—'}</td>
              </tr>
            ))}
            {!applications.length && (
              <tr>
                <td colSpan={4} className="text-muted">No applications recorded yet.</td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
      </div>
    </>
  );
}
