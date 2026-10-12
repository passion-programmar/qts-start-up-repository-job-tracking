'use client';

import { LoadingState } from '@/components/LoadingState';

import { useCallback, useEffect, useState } from 'react';
import { Modal } from '@/components/Modal';
import { api, uploadPdf } from '@/lib/api';
import type { NewSchemaAccountProfile, NewSchemaCategory } from '@/lib/types';

type Profile = NewSchemaAccountProfile & {
  first_name: string | null;
  last_name: string | null;
  address: string;
  sex: string;
  birthday: string;
  phone: string;
  country: string;
  city: string;
  education?: EducationRecord[] | null;
  work_experience?: WorkExperienceRecord[] | null;
  custom_fields?: AccountCustomField[] | null;
  has_resume?: boolean;
  resume_file_name?: string | null;
};

type ResumePdfTemplate = NonNullable<NewSchemaAccountProfile['default_resume_template']>;
type CoverLetterPdfTemplate = NonNullable<NewSchemaAccountProfile['default_cover_letter_template']>;

const resumePdfTemplates: Array<{ id: ResumePdfTemplate; label: string }> = [
  { id: 'qts_resume_1', label: 'QTS Resume 1' },
  { id: 'qts_resume_2', label: 'QTS Resume 2' },
  { id: 'qts_resume_3', label: 'QTS Resume 3' },
  { id: 'classic', label: 'Classic ATS' },
  { id: 'compact', label: 'Compact modern' },
];

const coverLetterPdfTemplates: Array<{ id: CoverLetterPdfTemplate; label: string }> = [
  { id: 'qts_cover_letter_1', label: 'QTS Cover Letter (standard)' },
];

type AccountCustomField = {
  fieldName: string;
  value: string;
};

type EducationRecord = {
  school: string;
  qualification: string;
  fieldOfStudy: string;
  startDate: string;
  endDate: string;
  description: string;
};

type WorkExperienceRecord = {
  employer: string;
  jobTitle: string;
  location: string;
  startDate: string;
  endDate: string;
  currentRole: boolean;
  description: string;
};

const emptyForm = () => ({
  firstName: '',
  lastName: '',
  resumePdfTemplate: 'qts_resume_2' as ResumePdfTemplate,
  coverLetterPdfTemplate: 'qts_cover_letter_1' as CoverLetterPdfTemplate,
  email: '',
  address: '',
  sex: '',
  birthday: '',
  phone: '',
  country: '',
  city: '',
  categoryId: '',
  education: [] as EducationRecord[],
  workExperience: [] as WorkExperienceRecord[],
  customFields: [] as AccountCustomField[],
});

export function NewSchemaAccountsView() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [categories, setCategories] = useState<NewSchemaCategory[]>([]);
  const [form, setForm] = useState(emptyForm());
  const [resumeFile, setResumeFile] = useState<File | null>(null);
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
    setForm(emptyForm());
    setResumeFile(null);
    setFormError(null);
    setShowForm(true);
  }

  function startEdit(profile: Profile) {
    setEditingId(profile.u_id);
    setForm({
      firstName: profile.first_name || profile.name.split(/\s+/)[0] || '',
      lastName: profile.last_name || profile.name.split(/\s+/).slice(1).join(' ') || profile.name,
      resumePdfTemplate: profile.default_resume_template || 'qts_resume_2',
      coverLetterPdfTemplate: profile.default_cover_letter_template || 'qts_cover_letter_1',
      email: profile.email,
      address: profile.address,
      sex: profile.sex,
      birthday: profile.birthday?.slice(0, 10) || '',
      phone: profile.phone,
      country: profile.country,
      city: profile.city,
      categoryId: String(profile.category_id),
      education: (profile.education || []).map((item) => ({
        school: item.school || '',
        qualification: item.qualification || '',
        fieldOfStudy: item.fieldOfStudy || '',
        startDate: item.startDate || '',
        endDate: item.endDate || '',
        description: item.description || '',
      })),
      workExperience: (profile.work_experience || []).map((item) => ({
        employer: item.employer || '',
        jobTitle: item.jobTitle || '',
        location: item.location || '',
        startDate: item.startDate || '',
        endDate: item.endDate || '',
        currentRole: Boolean(item.currentRole),
        description: item.description || '',
      })),
      customFields: (profile.custom_fields || []).map((item) => ({
        fieldName: item.fieldName || '',
        value: item.value || '',
      })),
    });
    setResumeFile(null);
    setFormError(null);
    setShowForm(true);
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setFormError(null);
    const payload = {
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      resumePdfTemplate: form.resumePdfTemplate,
      coverLetterPdfTemplate: form.coverLetterPdfTemplate,
      email: form.email.trim(),
      address: form.address.trim(),
      sex: form.sex,
      birthday: form.birthday,
      phone: form.phone.trim(),
      country: form.country.trim(),
      city: form.city.trim(),
      categoryId: Number(form.categoryId),
      education: form.education.map((item) => ({
        ...item,
        fieldOfStudy: item.fieldOfStudy.trim() || null,
        startDate: item.startDate || null,
        endDate: item.endDate || null,
        description: item.description.trim() || null,
      })),
      workExperience: form.workExperience.map((item) => ({
        ...item,
        location: item.location.trim() || null,
        startDate: item.startDate || null,
        endDate: item.currentRole ? null : item.endDate || null,
        description: item.description.trim() || null,
      })),
      customFields: form.customFields.map((item) => ({
        fieldName: item.fieldName.trim(),
        value: item.value.trim(),
      })),
    };
    const result = editingId
      ? await api<{ success: boolean; message?: string; account?: { u_id: number } }>('PUT', `/api/v2/users/${editingId}`, payload)
      : await api<{ success: boolean; message?: string; account?: { u_id: number } }>('POST', '/api/v2/users', { ...payload, role: 'account' });
    if (!result.success) {
      setFormError(result.message || 'Could not save Account profile.');
      setSaving(false);
      return;
    }
    const accountId = editingId ?? result.account?.u_id;
    if (resumeFile && accountId) {
      const upload = await uploadPdf(`/api/v2/users/${accountId}/resume`, resumeFile);
      if (!upload.success) {
        setFormError(upload.message || 'Profile saved, but the resume upload failed.');
        setSaving(false);
        await load();
        return;
      }
    }
    setShowForm(false);
    setResumeFile(null);
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
        {loading ? <LoadingState label="Loading…" /> : (
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
            ['firstName', 'First name'], ['lastName', 'Last name'], ['email', 'Email'],
            ['address', 'Address'], ['sex', 'Sex'],
            ['birthday', 'Birthday'], ['phone', 'Phone'], ['country', 'Country'], ['city', 'City'],
          ] as const).map(([key, label]) => (
            <div className="form-group" key={key}>
              <label htmlFor={`account-${key}`}>{label}</label>
              <input
                id={`account-${key}`}
                type={key === 'email' ? 'email' : key === 'birthday' ? 'date' : 'text'}
                required
                maxLength={key === 'firstName' || key === 'lastName' ? 100 : key === 'address' ? 500 : key === 'country' || key === 'city' ? 100 : key === 'sex' ? 50 : undefined}
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
          <h3>PDF templates</h3>
          <div className="form-group">
            <label htmlFor="account-resume-template">Assigned resume template</label>
            <select id="account-resume-template" value={form.resumePdfTemplate}
              onChange={(event) => setForm({
                ...form,
                resumePdfTemplate: event.target.value as ResumePdfTemplate,
              })}>
              {resumePdfTemplates.map((template) => (
                <option key={template.id} value={template.id}>{template.label}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label htmlFor="account-cover-letter-template">Assigned cover letter template</label>
            <select id="account-cover-letter-template" value={form.coverLetterPdfTemplate}
              onChange={(event) => setForm({
                ...form,
                coverLetterPdfTemplate: event.target.value as CoverLetterPdfTemplate,
              })}>
              {coverLetterPdfTemplates.map((template) => (
                <option key={template.id} value={template.id}>{template.label}</option>
              ))}
            </select>
          </div>
          <h3>Resume</h3>
          {editingId && profiles.find((profile) => profile.u_id === editingId)?.has_resume && (
            <p className="text-muted">
              Current PDF: {profiles.find((profile) => profile.u_id === editingId)?.resume_file_name || 'resume.pdf'}
            </p>
          )}
          <div className="form-group">
            <label htmlFor="account-resume">Current resume (PDF, maximum 4 MB)</label>
            <input id="account-resume" type="file" accept="application/pdf,.pdf"
              onChange={(event) => setResumeFile(event.target.files?.[0] || null)} />
          </div>
          <h3>Education</h3>
          {form.education.map((item, index) => (
            <fieldset className="card" key={index}>
              <legend>Education {index + 1}</legend>
              {([
                ['school', 'School'], ['qualification', 'Degree or qualification'],
                ['fieldOfStudy', 'Field of study'], ['startDate', 'Start date'],
                ['endDate', 'End date'], ['description', 'Description'],
              ] as const).map(([key, label]) => (
                <div className="form-group" key={key}>
                  <label htmlFor={`education-${index}-${key}`}>{label}</label>
                  {key === 'description' ? (
                    <textarea id={`education-${index}-${key}`} maxLength={2000} value={item[key]}
                      onChange={(event) => {
                        const education = [...form.education];
                        education[index] = { ...item, [key]: event.target.value };
                        setForm({ ...form, education });
                      }} />
                  ) : (
                    <input id={`education-${index}-${key}`}
                      type={key === 'startDate' || key === 'endDate' ? 'date' : 'text'}
                      required={key === 'school' || key === 'qualification'}
                      maxLength={key === 'school' ? 300 : 200} value={item[key]}
                      onChange={(event) => {
                        const education = [...form.education];
                        education[index] = { ...item, [key]: event.target.value };
                        setForm({ ...form, education });
                      }} />
                  )}
                </div>
              ))}
              <button className="btn btn-ghost" type="button"
                onClick={() => setForm({ ...form, education: form.education.filter((_, row) => row !== index) })}>
                Remove education
              </button>
            </fieldset>
          ))}
          <button className="btn btn-ghost" type="button" onClick={() => setForm({
            ...form,
            education: [...form.education, {
              school: '', qualification: '', fieldOfStudy: '', startDate: '', endDate: '', description: '',
            }],
          })}>Add education</button>

          <h3>Work experience</h3>
          {form.workExperience.map((item, index) => (
            <fieldset className="card" key={index}>
              <legend>Experience {index + 1}</legend>
              {([
                ['employer', 'Employer'], ['jobTitle', 'Job title'], ['location', 'Location'],
                ['startDate', 'Start date'], ['endDate', 'End date'], ['description', 'Description'],
              ] as const).map(([key, label]) => (
                <div className="form-group" key={key}>
                  <label htmlFor={`experience-${index}-${key}`}>{label}</label>
                  {key === 'description' ? (
                    <textarea id={`experience-${index}-${key}`} maxLength={3000} value={item[key]}
                      onChange={(event) => {
                        const workExperience = [...form.workExperience];
                        workExperience[index] = { ...item, [key]: event.target.value };
                        setForm({ ...form, workExperience });
                      }} />
                  ) : key === 'endDate' && item.currentRole ? (
                    <input id={`experience-${index}-${key}`} value="Current role" disabled />
                  ) : (
                    <input id={`experience-${index}-${key}`}
                      type={key === 'startDate' || key === 'endDate' ? 'date' : 'text'}
                      required={key === 'employer' || key === 'jobTitle'}
                      maxLength={300} value={item[key]}
                      onChange={(event) => {
                        const workExperience = [...form.workExperience];
                        workExperience[index] = { ...item, [key]: event.target.value };
                        setForm({ ...form, workExperience });
                      }} />
                  )}
                </div>
              ))}
              <div className="form-group">
                <label htmlFor={`experience-${index}-current`}>This is my current role</label>
                <input id={`experience-${index}-current`} type="checkbox" checked={item.currentRole}
                  onChange={(event) => {
                    const workExperience = [...form.workExperience];
                    workExperience[index] = { ...item, currentRole: event.target.checked, endDate: '' };
                    setForm({ ...form, workExperience });
                  }} />
              </div>
              <button className="btn btn-ghost" type="button"
                onClick={() => setForm({ ...form, workExperience: form.workExperience.filter((_, row) => row !== index) })}>
                Remove experience
              </button>
            </fieldset>
          ))}
          <button className="btn btn-ghost" type="button" onClick={() => setForm({
            ...form,
            workExperience: [...form.workExperience, {
              employer: '', jobTitle: '', location: '', startDate: '', endDate: '',
              currentRole: false, description: '',
            }],
          })}>Add work experience</button>
          <h3>Additional application facts</h3>
          <p className="text-muted">
            These name-and-value facts belong to this Account only. For example, “Work authorization expiry” → “2028-04-30”.
          </p>
          {form.customFields.map((item, index) => (
            <fieldset className="card" key={index}>
              <legend>Additional fact {index + 1}</legend>
              <div className="form-group">
                <label htmlFor={`account-custom-field-name-${index}`}>Field name</label>
                <input id={`account-custom-field-name-${index}`} required maxLength={100}
                  value={item.fieldName}
                  onChange={(event) => {
                    const customFields = [...form.customFields];
                    customFields[index] = { ...item, fieldName: event.target.value };
                    setForm({ ...form, customFields });
                  }} />
              </div>
              <div className="form-group">
                <label htmlFor={`account-custom-field-value-${index}`}>Value</label>
                <textarea id={`account-custom-field-value-${index}`} required maxLength={4000}
                  value={item.value}
                  onChange={(event) => {
                    const customFields = [...form.customFields];
                    customFields[index] = { ...item, value: event.target.value };
                    setForm({ ...form, customFields });
                  }} />
              </div>
              <button className="btn btn-ghost" type="button"
                onClick={() => setForm({ ...form, customFields: form.customFields.filter((_, row) => row !== index) })}>
                Remove additional fact
              </button>
            </fieldset>
          ))}
          <button className="btn btn-ghost" type="button" onClick={() => setForm({
            ...form,
            customFields: [...form.customFields, { fieldName: '', value: '' }],
          })}>Add additional fact</button>
        </form>
        {formError && <div className="alert alert-error">{formError}</div>}
      </Modal>
    </>
  );
}
