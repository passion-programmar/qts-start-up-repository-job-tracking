'use client';

import { useState } from 'react';
import { JobsView } from '@/components/JobsView';
import { JobSitesView } from '@/components/JobSitesView';

type JobsTab = 'jobs' | 'sites';

export function AdminJobsPageView() {
  const [tab, setTab] = useState<JobsTab>('jobs');

  return (
    <>
      <div className="tab-row" style={{ marginBottom: 16, display: 'flex', gap: 8 }}>
        <button
          type="button"
          className={`btn ${tab === 'jobs' ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => setTab('jobs')}
        >
          Saved jobs
        </button>
        <button
          type="button"
          className={`btn ${tab === 'sites' ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => setTab('sites')}
        >
          Job sites
        </button>
      </div>
      {tab === 'jobs' ? <JobsView /> : <JobSitesView />}
    </>
  );
}
