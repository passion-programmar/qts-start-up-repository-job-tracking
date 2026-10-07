'use client';

import { useEffect, useMemo, useState } from 'react';
import { LineChart } from '@/components/LineChart';
import { api } from '@/lib/api';
import type { Bidder, JobStats, UserAccount } from '@/lib/types';

function groupInterviewsByDay(
  interviews: Array<{ scheduled_date?: string | null; candidate_name: string }>
): Array<{ label: string; count: number }> {
  const map = new Map<string, number>();
  for (const row of interviews) {
    if (!row.scheduled_date) continue;
    const key = row.scheduled_date.slice(0, 10);
    map.set(key, (map.get(key) || 0) + 1);
  }
  return [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-14)
    .map(([label, count]) => ({ label: label.slice(5), count }));
}

export function DashboardMode2View() {
  const [stats, setStats] = useState<JobStats | null>(null);
  const [users, setUsers] = useState<UserAccount[]>([]);
  const [bidders, setBidders] = useState<Bidder[]>([]);
  const [interviews, setInterviews] = useState<Array<{ scheduled_date?: string | null; candidate_name: string }>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [statsR, usersR, biddersR, interviewsR] = await Promise.all([
        api<{ success: boolean; stats?: JobStats }>('GET', '/api/jobs/stats'),
        api<{ success: boolean; users?: UserAccount[] }>('GET', '/api/users'),
        api<{ success: boolean; bidders?: Bidder[] }>('GET', '/api/bidders'),
        api<{ success: boolean; interviews?: Array<{ scheduled_date?: string | null; candidate_name: string }> }>('GET', '/api/interviews'),
      ]);
      if (cancelled) return;
      setStats(statsR.stats || null);
      setUsers(usersR.users || []);
      setBidders(biddersR.bidders || []);
      setInterviews(interviewsR.interviews || []);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const managerLeaders = useMemo(() => {
    return users
      .filter((u) => u.role === 'manager')
      .map((manager) => ({
        name: manager.username,
        count: bidders.filter((b) => b.manager_id === manager.id).length,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
  }, [users, bidders]);

  const bidderLeaders = useMemo(() => {
    return [...bidders]
      .sort((a, b) => (b.candidate_count || 0) - (a.candidate_count || 0))
      .slice(0, 8)
      .map((b) => ({ name: b.name, count: b.candidate_count || 0 }));
  }, [bidders]);

  const interviewTrend = useMemo(() => groupInterviewsByDay(interviews), [interviews]);

  if (loading) return <div className="text-muted">Loading analytics…</div>;
  if (!stats) return <div className="text-muted">Could not load analytics dashboard.</div>;

  const bid = stats.bidSummary || { today: 0, week: 0, month: 0 };

  return (
    <>
      <div className="mode-banner mode-banner-analytics">
        Analytics mode — curve charts and leaderboards for bids and interviews.
      </div>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-label">Bids Today</div>
          <div className="stat-value">{bid.today}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Bids This Week</div>
          <div className="stat-value">{bid.week}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Bids This Month</div>
          <div className="stat-value">{bid.month}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Interviews</div>
          <div className="stat-value">{interviews.length}</div>
        </div>
      </div>

      <div className="two-col ops-layout" style={{ gap: 20 }}>
        <div className="card">
          <div className="card-title">Daily Bids (curve)</div>
          <LineChart items={stats.dailyBids || []} emptyLabel="No daily bid data yet." />
        </div>
        <div className="card">
          <div className="card-title">Weekly Bids (curve)</div>
          <LineChart items={stats.weeklyBids || []} emptyLabel="No weekly bid data yet." stroke="#7c3aed" />
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-title">Interview Trend (daily)</div>
        <LineChart items={interviewTrend} emptyLabel="No scheduled interviews yet." stroke="#0891b2" />
      </div>

      <div className="two-col ops-layout" style={{ gap: 20, marginTop: 16 }}>
        <div className="card">
          <div className="card-title">Top Managers (by bidders)</div>
          <div className="table-scroll">
          <table>
            <thead>
              <tr><th>Manager</th><th>Bidders</th></tr>
            </thead>
            <tbody>
              {managerLeaders.map((row) => (
                <tr key={row.name}>
                  <td><strong>{row.name}</strong></td>
                  <td>{row.count}</td>
                </tr>
              ))}
              {!managerLeaders.length && (
                <tr><td colSpan={2} className="text-muted">No managers yet.</td></tr>
              )}
            </tbody>
          </table>
          </div>
        </div>
        <div className="card">
          <div className="card-title">Top Bidders (by candidates)</div>
          <div className="table-scroll">
          <table>
            <thead>
              <tr><th>Bidder Org</th><th>Candidates</th></tr>
            </thead>
            <tbody>
              {bidderLeaders.map((row) => (
                <tr key={row.name}>
                  <td><strong>{row.name}</strong></td>
                  <td>{row.count}</td>
                </tr>
              ))}
              {!bidderLeaders.length && (
                <tr><td colSpan={2} className="text-muted">No bidders yet.</td></tr>
              )}
            </tbody>
          </table>
          </div>
        </div>
      </div>
    </>
  );
}
