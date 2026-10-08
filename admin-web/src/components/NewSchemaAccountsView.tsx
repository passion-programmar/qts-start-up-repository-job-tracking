'use client';

import { useCallback, useEffect, useState } from 'react';
import { Modal } from '@/components/Modal';
import { api } from '@/lib/api';
import type { NewSchemaAccountProfile, NewSchemaCategory } from '@/lib/types';

type Profile = NewSchemaAccountProfile & {
  address: string;
  sex: string;
  birthday: string;
  phone: string;
  country: string;
  city: string;
};

const emptyForm = {
  name: '',
  email: '',
  address: '',
  sex: '',
  birthday: '',
  phone: '',
  country: '',
  city: '',
  categoryId: '',
};

export function NewSchemaAccountsView() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [categories, setCategories] = useState<NewSchemaCategory[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [profileResult, categoryResult] = await Promise.all([
      api<{ success: boolean; accounts?: Profile[] }>('GET', '/api/v2/users/accounts'),
      api<{ success: boolean; categories?: NewSchemaCategory[] }>('GET', '/api/v2/categories'),
    ]);
    if (profileResult.success) setProfiles(profileResult.accounts || []);
    else setError('Could not load Account profiles.');
    if (categoryResult.success) setCategories(categoryResult.categories || []);
    else setError('Could not load categories.');
    setLoading(false);
  }, []);

  useEffect(() => {
    // Load Account profiles and categories once the page mounts.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  function startCreate() {
    setEditingId(null);
    setForm(emptyForm);
    setFormError(null);
    setShowForm(true);
  }

  function startEdit(profile: Profile) {
    setEditingId(profile.u_id);
    setForm({
      name: profile.name,
      email: profile.email,
      address: profile.address,
      sex: profile.sex,
      birthday: profile.birthday?.slice(0, 10) || '',
      phone: profile.phone,
      country: profile.country,
      city: profile.city,
      categoryId: String(profile.category_id),
    });
    setFormError(null);
    setShowForm(true);
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setFormError(null);
    const payload = {
      name: form.name.trim(),
      email: form.email.trim(),
      address: form.address.trim(),
      sex: form.sex,
      birthday: form.birthday,
      phone: form.phone.trim(),
      country: form.country.trim(),
      city: form.city.trim(),
      categoryId: Number(form.categoryId),
    };
    const result = editingId
      ? await api<{ success: boolean; message?: string }>('PUT', `/api/v2/users/${editingId}`, payload)
      : await api<{ success: boolean; message?: string }>('POST', '/api/v2/users', { ...payload, role: 'account' });
    if (!result.success) {
      setFormError(result.message || 'Could not save Account profile.');
      setSaving(false);
      return;
    }
    setShowForm(false);
    try {
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function remove(profile: Profile) {
    if (!window.confirm(`Delete Account profile "${profile.name}"?`)) return;
    const result = await api<{ success: boolean; message?: string }>('DELETE', `/api/v2/users/${profile.u_id}`);
    if (!result.success) {
      setError(result.message || 'Could not delete Account profile.');
      return;
    }
    await load();
  }

  return (
    <>
      {error && <div className="alert alert-error">{error}</div>}
      <div className="search-row"><button className="btn btn-primary" type="button" onClick={startCreate}>+ Add Account Profile</button></div>
      <div className="card">
        {loading ? <div className="text-muted">Loading…</div> : (
          <div className="table-scroll"><table>
            <thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>City</th><th>Category</th><th /></tr></thead>
            <tbody>{profiles.map((profile) => (
              <tr key={profile.u_id}>
                <td>{profile.name}</td><td>{profile.email}</td><td>{profile.phone}</td><td>{profile.city}</td>
                <td>{categories.find((item) => item.category_id === profile.category_id)?.category_title || profile.category_id}</td>
                <td className="text-right"><button className="btn btn-ghost btn-sm" type="button" onClick={() => startEdit(profile)}>Edit</button><button className="btn btn-danger btn-sm" type="button" onClick={() => { void remove(profile); }}>Delete</button></td>
              </tr>
            ))}{!profiles.length && <tr><td colSpan={6} className="text-muted">No Account profiles yet.</td></tr>}</tbody>
          </table></div>
        )}
      </div>
      <Modal
        open={showForm}
        title={editingId ? 'Edit Account Profile' : 'Add Account Profile'}
        onClose={() => {
          if (!saving) setShowForm(false);
        }}
        footer={(
          <>
            <button className="btn btn-ghost" type="button" disabled={saving} onClick={() => setShowForm(false)}>Cancel</button>
            <button className="btn btn-primary" type="submit" form="account-profile-form" disabled={saving}>
              {saving ? 'Saving…' : 'Save Profile'}
            </button>
          </>
        )}
      >
        <form id="account-profile-form" onSubmit={(event) => { void save(event); }}>
          {([
            ['name', 'Name'], ['email', 'Email'], ['address', 'Address'], ['sex', 'Sex'],
            ['birthday', 'Birthday'], ['phone', 'Phone'], ['country', 'Country'], ['city', 'City'],
          ] as const).map(([key, label]) => (
            <div className="form-group" key={key}>
              <label htmlFor={`account-${key}`}>{label}</label>
              <input
                id={`account-${key}`}
                type={key === 'email' ? 'email' : key === 'birthday' ? 'date' : 'text'}
                required
                maxLength={key === 'address' ? 500 : key === 'country' || key === 'city' ? 100 : key === 'sex' ? 50 : undefined}
                value={form[key]}
                onChange={(event) => setForm({ ...form, [key]: event.target.value })}
              />
            </div>
          ))}
          <div className="form-group">
            <label htmlFor="account-category">Category</label>
            <select id="account-category" required value={form.categoryId} onChange={(event) => setForm({ ...form, categoryId: event.target.value })}>
              <option value="">Select category</option>
              {categories.map((category) => <option key={category.category_id} value={category.category_id}>{category.category_title}</option>)}
            </select>
          </div>
        </form>
        {formError && <div className="alert alert-error">{formError}</div>}
      </Modal>
    </>
  );
}
