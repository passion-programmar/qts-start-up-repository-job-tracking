'use client';

import { useCallback, useEffect, useState } from 'react';
import { Modal } from '@/components/Modal';
import { api } from '@/lib/api';
import type { Bidder } from '@/lib/types';

const DEFAULT_CUSTOM_GPT_URL =
  'https://chatgpt.com/g/g-6a3dc5525fac819198dccf1c216e3fc0-qts-job-tracking';

export function AdminBiddersView() {
  const [bidders, setBidders] = useState<Bidder[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Bidder | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState({ customGptUrl: '' });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await api<{ success: boolean; bidders?: Bidder[] }>('GET', '/api/bidders');
    setBidders(r.bidders || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function openEdit(bidder: Bidder) {
    setSelected(bidder);
    setForm({ customGptUrl: bidder.custom_gpt_url || '' });
    setError(null);
    setModalOpen(true);
  }

  async function saveCustomGptUrl() {
    if (!selected) return;
    setSaving(true);
    setError(null);
    const body = {
      name: selected.name,
      notes: selected.notes || '',
      isActive: selected.is_active,
      managerId: selected.manager_id ?? null,
      customGptUrl: form.customGptUrl.trim() || null,
    };
    const r = await api<{ success: boolean; message?: string }>(
      'PUT',
      `/api/bidders/${selected.id}`,
      body
    );
    setSaving(false);
    if (r.success) {
      setModalOpen(false);
      setSelected(null);
      void load();
    } else {
      setError(r.message || 'Could not save Custom GPT URL.');
    }
  }

  return (
    <>
      <p className="text-muted" style={{ marginBottom: 12 }}>
        Assign a <strong>Custom GPT tab URL</strong> per bidder. Bidders using the Chrome extension
        will open their assigned GPT instead of the system default.
      </p>

      {loading ? (
        <div className="card"><div className="text-muted">Loading…</div></div>
      ) : (
        <div className="card" style={{ overflowX: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Bidder</th>
                <th>Manager</th>
                <th>Custom GPT URL</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {bidders.map((bidder) => (
                <tr key={bidder.id}>
                  <td>{bidder.name}</td>
                  <td>{bidder.manager_name || '—'}</td>
                  <td style={{ maxWidth: 420, wordBreak: 'break-all' }}>
                    {bidder.custom_gpt_url || (
                      <span className="text-muted">Default system GPT</span>
                    )}
                  </td>
                  <td>{bidder.is_active ? 'Active' : 'Inactive'}</td>
                  <td>
                    <button className="btn btn-ghost" type="button" onClick={() => openEdit(bidder)}>
                      Assign GPT URL
                    </button>
                  </td>
                </tr>
              ))}
              {!bidders.length && (
                <tr>
                  <td colSpan={5} className="text-muted">No bidders found.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={modalOpen}
        title={selected ? `Custom GPT — ${selected.name}` : 'Custom GPT URL'}
        onClose={() => setModalOpen(false)}
        footer={
          <>
            <button className="btn btn-ghost" type="button" onClick={() => setModalOpen(false)}>
              Cancel
            </button>
            <button
              className="btn btn-primary"
              type="button"
              disabled={saving}
              onClick={() => { void saveCustomGptUrl(); }}
            >
              Save
            </button>
          </>
        }
      >
        <div className="form-group">
          <label>Custom GPT URL</label>
          <input
            value={form.customGptUrl}
            onChange={(e) => setForm({ customGptUrl: e.target.value })}
            placeholder={DEFAULT_CUSTOM_GPT_URL}
          />
          <p className="text-muted" style={{ marginTop: 8, fontSize: 12 }}>
            Paste the full ChatGPT Custom GPT link, e.g.{' '}
            <code>https://chatgpt.com/g/g-…-qts-job-tracking</code>.
            Leave empty to use the system default.
          </p>
        </div>
        {error && <p className="form-error">{error}</p>}
      </Modal>
    </>
  );
}
