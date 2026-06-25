'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal } from '@/components/Modal';
import { CandidateColorPicker } from '@/components/CandidateColorPicker';
import { PasswordField } from '@/components/PasswordField';
import {
  BidderBranch,
  buildBidderTree,
  isTreeEntityActive,
} from '@/components/org-tree';
import { api } from '@/lib/api';
import type { Bidder, Candidate } from '@/lib/types';
import { nextCandidateColor, normalizeCandidateColor } from '../../../shared/candidate-colors';
import { parseCandidateStacks } from '../../../shared/candidate-stacks';

export function ManagerBiddersView() {
  const [bidders, setBidders] = useState<Bidder[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [stackOptions, setStackOptions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [modal, setModal] = useState<'form' | 'delete' | 'candidate' | 'deleteCandidate' | null>(null);
  const [selected, setSelected] = useState<Bidder | null>(null);
  const [selectedCandidate, setSelectedCandidate] = useState<Candidate | null>(null);
  const [form, setForm] = useState({
    name: '',
    notes: '',
    isActive: true,
    password: '',
    username: '',
    accountId: null as number | null,
  });
  const [savedBidderPassword, setSavedBidderPassword] = useState('');
  const [formLoading, setFormLoading] = useState(false);
  const [candidateForm, setCandidateForm] = useState({
    name: '',
    email: '',
    phone: '',
    linkedinUrl: '',
    notes: '',
    stack: '',
    isActive: true,
    color: nextCandidateColor(0),
  });
  const [error, setError] = useState<string | null>(null);

  const bidderTree = useMemo(
    () => buildBidderTree(bidders, candidates),
    [bidders, candidates]
  );

  const load = useCallback(async () => {
    setLoading(true);
    const [biddersRes, candidatesRes] = await Promise.all([
      api<{ success: boolean; bidders?: Bidder[] }>('GET', '/api/bidders'),
      api<{ success: boolean; candidates?: Candidate[] }>('GET', '/api/candidates'),
    ]);
    setBidders(biddersRes.bidders || []);
    setCandidates(candidatesRes.candidates || []);
    setLoading(false);
  }, []);

  const loadStackOptions = useCallback(async () => {
    const stacksRes = await api<{ success: boolean; stacks?: string[] }>('GET', '/api/settings/candidate-stacks');
    if (stacksRes.success && stacksRes.stacks?.length) {
      setStackOptions(stacksRes.stacks);
      return stacksRes.stacks;
    }
    const settingsRes = await api<{ success: boolean; settings?: Record<string, string> }>('GET', '/api/settings');
    const stacks = parseCandidateStacks(settingsRes.settings?.candidate_stacks);
    setStackOptions(stacks);
    return stacks;
  }, []);

  useEffect(() => {
    void load();
    void loadStackOptions();
  }, [load, loadStackOptions]);

  function toggleExpanded(key: string) {
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function expandAll() {
    const next: Record<string, boolean> = {};
    for (const node of bidderTree) {
      if (isTreeEntityActive(node.bidder.is_active)) {
        next[`b-${node.bidder.id}`] = true;
      }
    }
    setExpanded(next);
  }

  function collapseAll() {
    setExpanded({});
  }

  function openAddForm() {
    setSelected(null);
    setForm({ name: '', notes: '', isActive: true, password: '', username: '', accountId: null });
    setSavedBidderPassword('');
    setFormLoading(false);
    setError(null);
    setModal('form');
  }

  async function openEditForm(b: Bidder) {
    setSelected(b);
    setForm({
      name: b.name,
      notes: b.notes || '',
      isActive: b.is_active,
      password: '',
      username: b.name,
      accountId: null,
    });
    setSavedBidderPassword('');
    setError(null);
    setFormLoading(true);
    setModal('form');

    const r = await api<{
      success: boolean;
      message?: string;
      accounts?: Array<{ id: number; username: string; role: string; password?: string | null }>;
    }>('GET', `/api/bidders/${b.id}`);

    setFormLoading(false);
    if (!r.success) {
      setError(r.message || 'Could not load saved credentials.');
      return;
    }

    const primaryAccount =
      r.accounts?.find((a) => a.role === 'bidder') || r.accounts?.[0] || null;
    const password = primaryAccount?.password ?? '';
    setForm({
      name: b.name,
      notes: b.notes || '',
      isActive: b.is_active,
      password,
      username: primaryAccount?.username || b.name,
      accountId: primaryAccount?.id ?? null,
    });
    setSavedBidderPassword(password);
  }

  async function openAddCandidate(b: Bidder) {
    const stacks = stackOptions.length ? stackOptions : await loadStackOptions();
    setSelected(b);
    setSelectedCandidate(null);
    setCandidateForm({
      name: '',
      email: '',
      phone: '',
      linkedinUrl: '',
      notes: '',
      stack: stacks[0] || '',
      isActive: true,
      color: nextCandidateColor(candidates.length),
    });
    setError(null);
    setModal('candidate');
  }

  function openEditCandidate(b: Bidder, candidate: Candidate) {
    setSelected(b);
    setSelectedCandidate(candidate);
    setCandidateForm({
      name: candidate.name,
      email: candidate.email || '',
      phone: candidate.phone || '',
      linkedinUrl: candidate.linkedin_url || '',
      notes: candidate.notes || '',
      stack: candidate.stack || '',
      isActive: candidate.is_active,
      color: normalizeCandidateColor(candidate.color, candidate.id),
    });
    setError(null);
    setModal('candidate');
  }

  function openDeleteCandidate(b: Bidder, candidate: Candidate) {
    setSelected(b);
    setSelectedCandidate(candidate);
    setModal('deleteCandidate');
  }

  async function saveBidder() {
    if (!form.name.trim()) {
      setError('Name is required.');
      return;
    }
    if (!selected && !form.password) {
      setError('Password is required for the bidder login.');
      return;
    }
    const passwordChanged = Boolean(selected && form.password !== savedBidderPassword);
    const body = {
      name: form.name.trim(),
      notes: form.notes.trim(),
      isActive: form.isActive,
      ...(!selected ? { password: form.password } : {}),
      ...(selected && passwordChanged && form.password ? { password: form.password } : {}),
    };
    const r = selected
      ? await api<{ success: boolean; message?: string }>('PUT', `/api/bidders/${selected.id}`, body)
      : await api<{ success: boolean; message?: string }>('POST', '/api/bidders', body);
    if (r.success) {
      setModal(null);
      void load();
    } else {
      setError(r.message || 'Could not save bidder.');
    }
  }

  async function deleteBidder() {
    if (!selected) return;
    const r = await api<{ success: boolean; message?: string }>('DELETE', `/api/bidders/${selected.id}`);
    if (r.success) {
      setModal(null);
      void load();
    } else {
      alert(r.message || 'Could not delete bidder.');
    }
  }

  async function saveCandidate() {
    if (!selected || !candidateForm.name.trim()) {
      setError('Name is required.');
      return;
    }
    const body = {
      name: candidateForm.name.trim(),
      email: candidateForm.email.trim(),
      phone: candidateForm.phone.trim(),
      linkedinUrl: candidateForm.linkedinUrl.trim(),
      notes: candidateForm.notes.trim(),
      stack: candidateForm.stack,
      isActive: candidateForm.isActive,
      bidderId: selected.id,
      color: candidateForm.color,
    };
    const r = selectedCandidate
      ? await api<{ success: boolean; message?: string; errors?: Array<{ field: string; message: string }> }>(
          'PUT',
          `/api/candidates/${selectedCandidate.id}`,
          body
        )
      : await api<{ success: boolean; message?: string; errors?: Array<{ field: string; message: string }> }>(
          'POST',
          '/api/candidates',
          body
        );
    if (r.success) {
      setModal(null);
      setSelectedCandidate(null);
      void load();
    } else {
      const detail = r.errors?.map((e) => e.message).join(' · ') || r.message;
      setError(detail || 'Could not save candidate.');
    }
  }

  async function deleteCandidate() {
    if (!selectedCandidate) return;
    const r = await api<{ success: boolean; message?: string }>(
      'DELETE',
      `/api/candidates/${selectedCandidate.id}`
    );
    if (r.success) {
      setModal(null);
      setSelectedCandidate(null);
      void load();
    } else {
      alert(r.message || 'Could not delete candidate.');
    }
  }

  return (
    <>
      <p className="text-muted" style={{ marginBottom: 12 }}>
        <strong>Bidder</strong> → Candidate. Add bidder organizations with login credentials and manage candidates under each team.
      </p>

      <div className="search-row">
        <button className="btn btn-primary" type="button" onClick={openAddForm}>
          + Add Bidder
        </button>
        <button className="btn btn-ghost" type="button" onClick={expandAll}>Expand all</button>
        <button className="btn btn-ghost" type="button" onClick={collapseAll}>Collapse all</button>
      </div>

      {loading ? (
        <div className="card"><div className="text-muted">Loading…</div></div>
      ) : bidderTree.length ? (
        <div className="org-tree-list">
          {bidderTree.map((node) => (
            <BidderBranch
              key={node.bidder.id}
              node={node}
              expanded={expanded}
              onToggle={toggleExpanded}
              onEdit={() => { void openEditForm(node.bidder); }}
              onDelete={() => {
                setSelected(node.bidder);
                setModal('delete');
              }}
              onAddCandidate={() => { void openAddCandidate(node.bidder); }}
              onEditCandidate={(candidate) => openEditCandidate(node.bidder, candidate)}
              onDeleteCandidate={(candidate) => openDeleteCandidate(node.bidder, candidate)}
            />
          ))}
        </div>
      ) : (
        <div className="card">
          <p className="org-tree-empty">No bidders yet. Click + Add Bidder to start.</p>
        </div>
      )}

      <Modal
        open={modal === 'form'}
        title={selected ? 'Edit Bidder' : 'Add Bidder'}
        onClose={() => setModal(null)}
        footer={
          <>
            <button className="btn btn-ghost" type="button" onClick={() => setModal(null)}>Cancel</button>
            <button className="btn btn-primary" type="button" disabled={formLoading} onClick={() => { void saveBidder(); }}>Save</button>
          </>
        }
      >
        {formLoading ? (
          <div className="text-muted">Loading saved credentials…</div>
        ) : (
          <>
            <div className="form-group">
              <label>Name *</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              {!selected && (
                <p className="text-muted" style={{ marginTop: 6, fontSize: 12 }}>
                  Login username will be the bidder name.
                </p>
              )}
            </div>
            {selected && form.accountId && (
              <div className="form-group">
                <label>Login username</label>
                <input value={form.username} readOnly />
              </div>
            )}
            <div className="form-group">
              <label>{selected ? 'Password' : 'Password *'}</label>
              <PasswordField
                key={selected ? `bidder-${selected.id}` : 'bidder-add'}
                value={form.password}
                onChange={(password) => setForm({ ...form, password })}
                placeholder={selected ? 'Saved password' : undefined}
              />
              {selected && savedBidderPassword && (
                <p className="text-muted" style={{ marginTop: 6, fontSize: 12 }}>
                  Current password loaded. Use the eye icon to view it before changing.
                </p>
              )}
              {selected && !savedBidderPassword && !form.password && (
                <p className="text-muted" style={{ marginTop: 6, fontSize: 12 }}>
                  No saved password on file. Enter a new password to set credentials.
                </p>
              )}
            </div>
            <div className="form-group">
              <label>Notes</label>
              <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
            <label className="checkbox-row">
              <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
              Active
            </label>
          </>
        )}
        {error && <div className="alert alert-error">{error}</div>}
      </Modal>

      <Modal
        open={modal === 'delete'}
        title="Delete Bidder"
        onClose={() => setModal(null)}
        footer={
          <>
            <button className="btn btn-ghost" type="button" onClick={() => setModal(null)}>Cancel</button>
            <button className="btn btn-danger" type="button" onClick={() => { void deleteBidder(); }}>Delete</button>
          </>
        }
      >
        <p className="confirm-text">
          Delete <strong>{selected?.name}</strong> and all linked login accounts?
        </p>
        <p className="confirm-text text-muted" style={{ marginTop: 8, fontSize: 13 }}>
          Candidates under this bidder will be unlinked but not deleted.
        </p>
      </Modal>

      <Modal
        open={modal === 'candidate'}
        title={
          selectedCandidate
            ? `Edit Candidate — ${selectedCandidate.name}`
            : `Add Candidate — ${selected?.name || ''}`
        }
        onClose={() => {
          setModal(null);
          setSelectedCandidate(null);
        }}
        footer={
          <>
            <button
              className="btn btn-ghost"
              type="button"
              onClick={() => {
                setModal(null);
                setSelectedCandidate(null);
              }}
            >
              Cancel
            </button>
            <button className="btn btn-primary" type="button" onClick={() => { void saveCandidate(); }}>
              {selectedCandidate ? 'Save Changes' : 'Save'}
            </button>
          </>
        }
      >
        <div className="form-group">
          <label>Name *</label>
          <input value={candidateForm.name} onChange={(e) => setCandidateForm({ ...candidateForm, name: e.target.value })} />
        </div>
        <div className="form-group">
          <label>Name color</label>
          <CandidateColorPicker
            value={candidateForm.color}
            previewName={candidateForm.name}
            fallbackIndex={selectedCandidate?.id ?? candidates.length}
            onChange={(color) => setCandidateForm({ ...candidateForm, color })}
          />
        </div>
        <div className="form-group">
          <label>Email</label>
          <input value={candidateForm.email} onChange={(e) => setCandidateForm({ ...candidateForm, email: e.target.value })} />
        </div>
        <div className="form-group">
          <label>Phone</label>
          <input value={candidateForm.phone} onChange={(e) => setCandidateForm({ ...candidateForm, phone: e.target.value })} />
        </div>
        <div className="form-group">
          <label>LinkedIn URL</label>
          <input
            value={candidateForm.linkedinUrl}
            onChange={(e) => setCandidateForm({ ...candidateForm, linkedinUrl: e.target.value })}
          />
        </div>
        {stackOptions.length > 0 && (
          <div className="form-group">
            <label>Stack</label>
            <select value={candidateForm.stack} onChange={(e) => setCandidateForm({ ...candidateForm, stack: e.target.value })}>
              {stackOptions.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
        )}
        <div className="form-group">
          <label>Notes</label>
          <textarea value={candidateForm.notes} onChange={(e) => setCandidateForm({ ...candidateForm, notes: e.target.value })} />
        </div>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={candidateForm.isActive}
            onChange={(e) => setCandidateForm({ ...candidateForm, isActive: e.target.checked })}
          />
          Active
        </label>
        {error && <div className="alert alert-error">{error}</div>}
      </Modal>

      <Modal
        open={modal === 'deleteCandidate'}
        title="Delete Candidate"
        onClose={() => {
          setModal(null);
          setSelectedCandidate(null);
        }}
        footer={
          <>
            <button
              className="btn btn-ghost"
              type="button"
              onClick={() => {
                setModal(null);
                setSelectedCandidate(null);
              }}
            >
              Cancel
            </button>
            <button className="btn btn-danger" type="button" onClick={() => { void deleteCandidate(); }}>
              Delete
            </button>
          </>
        }
      >
        <p className="confirm-text">
          Delete candidate <strong>{selectedCandidate?.name}</strong>?
        </p>
        <p className="confirm-text text-muted" style={{ marginTop: 8, fontSize: 13 }}>
          Job history for this candidate will also be removed.
        </p>
      </Modal>
    </>
  );
}
