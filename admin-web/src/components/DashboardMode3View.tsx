'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { CalendarPanel } from '@/components/CalendarPanel';
import { api } from '@/lib/api';
import type { Bidder, JobStats } from '@/lib/types';
import { formatDate } from '@/lib/utils';

type InterviewRow = {
  id: number;
  candidate_name: string;
  company?: string | null;
  scheduled_date?: string | null;
  bidder_name?: string | null;
};

export function DashboardMode3View() {
  const [stats, setStats] = useState<JobStats | null>(null);
  const [bidders, setBidders] = useState<Bidder[]>([]);
  const [interviews, setInterviews] = useState<InterviewRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [statsR, biddersR, interviewsR] = await Promise.all([
        api<{ success: boolean; stats?: JobStats }>('GET', '/api/jobs/stats'),
        api<{ success: boolean; bidders?: Bidder[] }>('GET', '/api/bidders'),
        api<{ success: boolean; interviews?: InterviewRow[] }>('GET', '/api/interviews'),
      ]);
      if (cancelled) return;
      setStats(statsR.stats || null);
      setBidders(biddersR.bidders || []);
      setInterviews(interviewsR.interviews || []);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const calendarEvents = useMemo(
    () => interviews
      .filter((row) => row.scheduled_date)
      .map((row) => ({
        date: row.scheduled_date!,
        label: row.candidate_name,
      })),
    [interviews]
  );

  const upcomingInterviews = useMemo(
    () => [...interviews]
      .filter((row) => row.scheduled_date)
      .sort((a, b) => String(a.scheduled_date).localeCompare(String(b.scheduled_date)))
      .slice(0, 8),
    [interviews]
  );

  if (loading) return <div className="text-muted">Loading operations dashboard…</div>;
  if (!stats) return <div className="text-muted">Could not load operations dashboard.</div>;

  const bid = stats.bidSummary || { today: 0, week: 0, month: 0 };

  return (
    <>
      <div className="mode-banner mode-banner-operations">
        Operations mode — calendar-first view for interviews, bidders, and pipeline work.
      </div>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-label">Active Bidders</div>
          <div className="stat-value">{bidders.filter((b) => b.is_active).length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Open Interviews</div>
          <div className="stat-value">{interviews.length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Bids This Week</div>
          <div className="stat-value">{bid.week}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Candidates</div>
          <div className="stat-value">{stats.totalCandidates || 0}</div>
        </div>
      </div>

      <div className="two-col ops-layout" style={{ gap: 20 }}>
        <div className="card">
          <CalendarPanel title="Interview Calendar" events={calendarEvents} />
        </div>
        <div className="card">
          <div className="card-title">Quick Actions</div>
          <div className="quick-actions">
            <Link className="btn btn-primary" href="/admin/interviews">Schedule Interview</Link>
            <Link className="btn btn-ghost" href="/admin/people">People</Link>
            <Link className="btn btn-ghost" href="/admin/jobs">Review Jobs</Link>
          </div>
          <div className="card-title" style={{ marginTop: 20 }}>Upcoming Interviews</div>
          <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Candidate</th>
                <th>Company</th>
                <th>Bidder</th>
              </tr>
            </thead>
            <tbody>
              {upcomingInterviews.map((row) => (
                <tr key={row.id}>
                  <td className="text-muted">{row.scheduled_date ? formatDate(row.scheduled_date) : '—'}</td>
                  <td><strong>{row.candidate_name}</strong></td>
                  <td>{row.company || '—'}</td>
                  <td>{row.bidder_name || '—'}</td>
                </tr>
              ))}
              {!upcomingInterviews.length && (
                <tr><td colSpan={4} className="text-muted">No upcoming interviews.</td></tr>
              )}
            </tbody>
          </table>
          </div>
        </div>
      </div>
    </>
  );
}
