'use client';

import { useCallback, useEffect, useState } from 'react';
import { Modal } from '@/components/Modal';
import { api } from '@/lib/api';
import type { Bidder, Candidate, JobSite, JobSiteAdmission } from '@/lib/types';
import { formatDate } from '@/lib/utils';

const EMPTY_FORM = {
  name: '',
  platformKey: '',
  urlHost: '',
  notes: '',
};

export function JobSitesView() {
  const [sites, setSites] = useState<JobSite[]>([]);
  const [bidders, setBidders] = useState<Bidder[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<'add' | 'admit' | 'admissions' | null>(null);
  const [selected, setSelected] = useState<JobSite | null>(null);
  const [admissions, setAdmissions] = useState<JobSiteAdmission[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [admitForm, setAdmitForm] = useState({ bidderId: '', defaultCandidateId: '' });
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [sitesRes, biddersRes] = await Promise.all([
      api<{ success: boolean; jobSites?: JobSite[] }>('GET', '/api/job-sites'),
      api<{ success: boolean; bidders?: Bidder[] }>('GET', '/api/bidders'),
    ]);
    setSites(sitesRes.jobSites || []);
    setBidders(biddersRes.bidders || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function loadAdmissions(site: JobSite) {
    const r = await api<{ success: boolean; admissions?: JobSiteAdmission[] }>(
      'GET',
      `/api/job-sites/${site.id}/admissions`
    );
    setAdmissions(r.admissions || []);
    setSelected(site);
    setModal('admissions');
  }

  async function openAdmit(site: JobSite) {
    setSelected(site);
    setAdmitForm({ bidderId: '', defaultCandidateId: '' });
    setCandidates([]);
    setError(null);
    setModal('admit');
  }

  async function onBidderChange(bidderId: string) {
    setAdmitForm({ bidderId, defaultCandidateId: '' });
    if (!bidderId) {
      setCandidates([]);
      return;
    }
    const r = await api<{ success: boolean; candidates?: Candidate[] }>(
      'GET',
      `/api/candidates?bidderId=${encodeURIComponent(bidderId)}`
    );
    setCandidates((r.candidates || []).filter((c) => c.is_active));
  }

  async function saveSite() {
    const body = {
      name: form.name.trim(),
      platformKey: form.platformKey.trim().toLowerCase(),
      urlHost: form.urlHost.trim() || null,
      notes: form.notes.trim() || null,
    };
    if (!body.name || !body.platformKey) {
      setError('Name and platform key are required.');
      return;
    }
    const r = await api<{ success: boolean; message?: string }>('POST', '/api/job-sites', body);
    if (r.success) {
      setModal(null);
      setForm(EMPTY_FORM);
      setError(null);
      void load();
    } else {
      setError(r.message || 'Could not create job site.');
    }
  }

  async function admitBidder() {
    if (!selected) return;
    const bidderId = Number(admitForm.bidderId);
    const defaultCandidateId = Number(admitForm.defaultCandidateId);
    if (!bidderId || !defaultCandidateId) {
      setError('Select bidder and default candidate.');
      return;
    }
    const r = await api<{ success: boolean; message?: string }>(
      'POST',
      `/api/job-sites/${selected.id}/admit`,
      { bidderId, defaultCandidateId }
    );
    if (r.success) {
      setModal(null);
      setError(null);
      void load();
    } else {
      setError(r.message || 'Could not admit bidder.');
    }
  }

  async function revokeAdmission(bidderId: number) {
    if (!selected) return;
    const r = await api<{ success: boolean; message?: string }>(
      'DELETE',
      `/api/job-sites/${selected.id}/admit/${bidderId}`
    );
    if (r.success) {
      void loadAdmissions(selected);
      void load();
    } else {
      alert(r.message || 'Could not revoke admission.');
    }
  }

  return (
    <>
      <p className="text-muted" style={{ marginBottom: 12 }}>
        Manually register job board sources. Match jobs by <strong>platform key</strong> (extension{' '}
        <code>source</code> field, e.g. <code>justjoin</code>) and optional URL host. Admit bidders
        with a default candidate — admitted sites appear in the bidder Jobs panel.
      </p>

      <div style={{ marginBottom: 12 }}>
        <button
          className="btn btn-primary"
          type="button"
          onClick={() => {
            setForm(EMPTY_FORM);
            setError(null);
            setModal('add');
          }}
        >
          + Add job site
        </button>
      </div>

      <div className="card">
        {loading ? (
          <div className="text-muted">Loading…</div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Platform key</th>
                  <th>URL host</th>
                  <th>Jobs</th>
                  <th>Bidders</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {sites.map((s) => (
                  <tr key={s.id}>
                    <td><strong>{s.name}</strong></td>
                    <td><code>{s.platform_key}</code></td>
                    <td className="text-muted">{s.url_host || '—'}</td>
                    <td>{s.job_count ?? '—'}</td>
                    <td>{s.admission_count ?? 0}</td>
                    <td>
                      <span className={`badge ${s.is_active ? 'badge-applied' : 'badge-none'}`}>
                        {s.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="text-right">
                      <button className="btn btn-ghost btn-sm" type="button" onClick={() => { void loadAdmissions(s); }}>
                        Admissions
                      </button>
                      <button className="btn btn-primary btn-sm" type="button" onClick={() => { void openAdmit(s); }}>
                        Admit bidder
                      </button>
                    </td>
                  </tr>
                ))}
                {!sites.length && (
                  <tr>
                    <td colSpan={7} className="text-muted">No job sites yet. Add one above.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal
        open={modal === 'add'}
        title="Add job site"
        onClose={() => setModal(null)}
        footer={
          <>
            <button className="btn btn-ghost" type="button" onClick={() => setModal(null)}>Cancel</button>
            <button className="btn btn-primary" type="button" onClick={() => { void saveSite(); }}>Save</button>
          </>
        }
      >
        <div className="form-group">
          <label>Display name *</label>
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="JustJoin.it" />
        </div>
        <div className="form-group">
          <label>Platform key *</label>
          <input
            value={form.platformKey}
            onChange={(e) => setForm({ ...form, platformKey: e.target.value })}
            placeholder="justjoin"
          />
          <small className="text-muted">Must match extension job <code>source</code> when saving.</small>
        </div>
        <div className="form-group">
          <label>URL host (optional)</label>
          <input
            value={form.urlHost}
            onChange={(e) => setForm({ ...form, urlHost: e.target.value })}
            placeholder="justjoin.it"
          />
        </div>
        <div className="form-group">
          <label>Notes</label>
          <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </div>
        {error && <div className="alert alert-error">{error}</div>}
      </Modal>

      <Modal
        open={modal === 'admit'}
        title={`Admit bidder — ${selected?.name || ''}`}
        onClose={() => setModal(null)}
        footer={
          <>
            <button className="btn btn-ghost" type="button" onClick={() => setModal(null)}>Cancel</button>
            <button className="btn btn-primary" type="button" onClick={() => { void admitBidder(); }}>Admit</button>
          </>
        }
      >
        <div className="form-group">
          <label>Bidder *</label>
          <select
            value={admitForm.bidderId}
            onChange={(e) => { void onBidderChange(e.target.value); }}
          >
            <option value="">Select bidder…</option>
            {bidders.filter((b) => b.is_active).map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        </div>
        <div className="form-group">
          <label>Default candidate *</label>
          <select
            value={admitForm.defaultCandidateId}
            onChange={(e) => setAdmitForm({ ...admitForm, defaultCandidateId: e.target.value })}
            disabled={!admitForm.bidderId}
          >
            <option value="">Select candidate…</option>
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        {error && <div className="alert alert-error">{error}</div>}
      </Modal>

      <Modal
        open={modal === 'admissions'}
        title={`Admissions — ${selected?.name || ''}`}
        onClose={() => setModal(null)}
        footer={<button className="btn btn-ghost" type="button" onClick={() => setModal(null)}>Close</button>}
      >
        <table>
          <thead>
            <tr>
              <th>Bidder</th>
              <th>Default candidate</th>
              <th>Admitted</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {admissions.map((a) => (
              <tr key={a.id}>
                <td>{a.bidder_name}</td>
                <td>{a.default_candidate_name || '—'}</td>
                <td className="text-muted">{formatDate(a.admitted_at)}</td>
                <td className="text-right">
                  {a.is_active && (
                    <button className="btn btn-danger btn-sm" type="button" onClick={() => { void revokeAdmission(a.bidder_id); }}>
                      Revoke
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {!admissions.length && (
              <tr><td colSpan={4} className="text-muted">No bidders admitted yet.</td></tr>
            )}
          </tbody>
        </table>
      </Modal>
    </>
  );
}
