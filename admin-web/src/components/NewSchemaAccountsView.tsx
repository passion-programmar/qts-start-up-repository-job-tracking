'use client';

import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Card, Empty, Input, Popconfirm, Space, Table, Tag, Typography, type TableColumnsType } from 'antd';
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
  custom_answers?: AccountCustomAnswer[] | null;
  has_resume?: boolean;
  resume_file_name?: string | null;
};

type AccountCustomField = {
  fieldName: string;
  value: string;
};

type AccountCustomAnswer = {
  topic: string;
  question: string;
  answer: string;
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
  customAnswers: [] as AccountCustomAnswer[],
});

export function NewSchemaAccountsView() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [categories, setCategories] = useState<NewSchemaCategory[]>([]);
  const [form, setForm] = useState(emptyForm());
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
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
      lastName: profile.last_name ?? profile.name.split(/\s+/).slice(1).join(' '),
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
      customAnswers: (profile.custom_answers || []).map((item) => ({
        topic: item.topic || '',
        question: item.question || '',
        answer: item.answer || '',
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
      customAnswers: form.customAnswers.map((item) => ({
        topic: item.topic.trim(),
        question: item.question.trim(),
        answer: item.answer.trim(),
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
    setDeletingId(profile.u_id);
    setError(null);
    try {
      const result = await api<{ success: boolean; message?: string }>('DELETE', `/api/v2/users/${profile.u_id}`);
      if (!result.success) {
        setError(result.message || 'Could not delete Account profile.');
        return;
      }
      await load();
    } finally {
      setDeletingId(null);
    }
  }

  const normalizedSearch = search.trim().toLocaleLowerCase();
  const filteredProfiles = profiles.filter((profile) => {
    const category = categories.find((item) => item.category_id === profile.category_id)?.category_title || '';
    return [
      profile.name,
      profile.email,
      profile.phone,
      profile.city,
      category,
    ].some((value) => value.toLocaleLowerCase().includes(normalizedSearch));
  });
  const columns: TableColumnsType<Profile> = [
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
      render: (name: string) => <Typography.Text strong>{name}</Typography.Text>,
    },
    { title: 'Email', dataIndex: 'email', key: 'email' },
    {
      title: 'Phone',
      dataIndex: 'phone',
      key: 'phone',
      render: (phone: string) => phone || <Typography.Text type="secondary">Not provided</Typography.Text>,
    },
    {
      title: 'City',
      dataIndex: 'city',
      key: 'city',
      render: (city: string) => city || <Typography.Text type="secondary">Not provided</Typography.Text>,
    },
    {
      title: 'Category',
      dataIndex: 'category_id',
      key: 'category',
      render: (categoryId: number) => {
        const category = categories.find((item) => item.category_id === categoryId)?.category_title;
        return category ? <Tag color="blue">{category}</Tag> : <Typography.Text type="secondary">Unassigned</Typography.Text>;
      },
    },
    {
      title: 'Actions',
      key: 'actions',
      align: 'right',
      render: (_value, profile) => (
        <Space size="small">
          <Button onClick={() => startEdit(profile)}>Edit</Button>
          <Popconfirm
            title="Delete this profile?"
            description={`"${profile.name}" will be permanently removed.`}
            okText="Delete profile"
            okButtonProps={{ danger: true, loading: deletingId === profile.u_id }}
            cancelText="Keep profile"
            onConfirm={() => remove(profile)}
          >
            <Button danger loading={deletingId === profile.u_id}>Delete</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 24 }}>
        <div>
          <Typography.Title level={2} style={{ margin: 0 }}>Account profiles</Typography.Title>
          <Typography.Text type="secondary">
            Keep candidate details, resumes, and application information organized.
          </Typography.Text>
        </div>
        <Button type="primary" size="large" onClick={startCreate}>+ Add account profile</Button>
      </div>
      {error && <Alert type="error" showIcon closable title={error} onClose={() => setError(null)} style={{ marginBottom: 16 }} />}
      <Card
        title={(
          <Space size="small">
            <span>All profiles</span>
            <Tag>{normalizedSearch ? `${filteredProfiles.length} of ${profiles.length}` : profiles.length}</Tag>
          </Space>
        )}
        extra={(
          <Input
            aria-label="Search account profiles"
            allowClear
            placeholder="Search profiles"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            style={{ width: 'min(100%, 320px)' }}
          />
        )}
        styles={{ body: { padding: 0 } }}
      >
        <Table<Profile>
          rowKey="u_id"
          columns={columns}
          dataSource={filteredProfiles}
          loading={loading}
          size="middle"
          scroll={{ x: 760 }}
          pagination={{
            pageSize: 10,
            showSizeChanger: true,
            pageSizeOptions: [10, 20, 50],
            showTotal: (total, range) => `${range[0]}-${range[1]} of ${total} profiles`,
          }}
          locale={{
            emptyText: (
              <Empty
                description={normalizedSearch ? 'No profiles match your search.' : 'No account profiles yet.'}
              >
                {!normalizedSearch && (
                  <Button type="primary" onClick={startCreate}>Add your first profile</Button>
                )}
              </Empty>
            ),
          }}
        />
      </Card>
      <Modal
        open={showForm}
        title={editingId ? 'Edit Account Profile' : 'Add Account Profile'}
        className="modal--account-profile"
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
        <form className="account-profile-form" id="account-profile-form" onSubmit={(event) => { void save(event); }}>
          <div className="account-profile-form__grid">
            {([
              ['firstName', 'First name'], ['lastName', 'Last name'], ['email', 'Email'],
              ['address', 'Address'], ['sex', 'Sex'],
              ['birthday', 'Birthday'], ['phone', 'Phone'], ['country', 'Country'], ['city', 'City'],
            ] as const).map(([key, label]) => (
              <div className={`form-group${key === 'email' || key === 'address' ? ' account-profile-form__field--wide' : ''}`} key={key}>
                <label htmlFor={`account-${key}`}>
                  {label}{key === 'lastName' ? ' (if applicable)' : ''}
                </label>
                <input
                  id={`account-${key}`}
                  type={key === 'email' ? 'email' : key === 'birthday' ? 'date' : 'text'}
                  required={key !== 'lastName'}
                  maxLength={key === 'firstName' || key === 'lastName' ? 100 : key === 'address' ? 500 : key === 'country' || key === 'city' ? 100 : key === 'sex' ? 50 : undefined}
                  value={form[key]}
                  onChange={(event) => setForm({ ...form, [key]: event.target.value })}
                />
              </div>
            ))}
            <div className="form-group account-profile-form__field--wide">
              <label htmlFor="account-category">Category</label>
              <select id="account-category" required value={form.categoryId} onChange={(event) => setForm({ ...form, categoryId: event.target.value })}>
                <option value="">Select category</option>
                {categories.map((category) => <option key={category.category_id} value={category.category_id}>{category.category_title}</option>)}
              </select>
            </div>
          </div>
          <h3 className="account-profile-form__section-title">Resume</h3>
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
          <h3 className="account-profile-form__section-title">Education</h3>
          {form.education.map((item, index) => (
            <fieldset className="card account-profile-form__card" key={index}>
              <legend>Education {index + 1}</legend>
              <div className="account-profile-form__grid">
                {([
                  ['school', 'School'], ['qualification', 'Degree or qualification'],
                  ['fieldOfStudy', 'Field of study'], ['startDate', 'Start date'],
                  ['endDate', 'End date'], ['description', 'Description'],
                ] as const).map(([key, label]) => (
                  <div className={`form-group${key === 'description' ? ' account-profile-form__field--wide' : ''}`} key={key}>
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
              </div>
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

          <h3 className="account-profile-form__section-title">Work experience</h3>
          {form.workExperience.map((item, index) => (
            <fieldset className="card account-profile-form__card" key={index}>
              <legend>Experience {index + 1}</legend>
              <div className="account-profile-form__grid">
                {([
                  ['employer', 'Employer'], ['jobTitle', 'Job title'], ['location', 'Location'],
                  ['startDate', 'Start date'], ['endDate', 'End date'], ['description', 'Description'],
                ] as const).map(([key, label]) => (
                  <div className={`form-group${key === 'description' ? ' account-profile-form__field--wide' : ''}`} key={key}>
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
              </div>
              <div className="form-group account-profile-form__checkbox">
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
          <h3 className="account-profile-form__section-title">Additional application facts</h3>
          <p className="text-muted">
            These name-and-value facts belong to this Account only. For example, “Work authorization expiry” → “2028-04-30”.
          </p>
          {form.customFields.map((item, index) => (
            <fieldset className="card account-profile-form__card" key={index}>
              <legend>Additional fact {index + 1}</legend>
              <div className="account-profile-form__grid">
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
          <h3 className="account-profile-form__section-title">Reusable application questions and answers</h3>
          <p className="text-muted">
            These answers belong to this Account and are reused only when an application question matches.
          </p>
          {form.customAnswers.map((item, index) => (
            <fieldset className="card account-profile-form__card" key={index}>
              <legend>Saved answer {index + 1}</legend>
              <div className="account-profile-form__grid">
                <div className="form-group">
                  <label htmlFor={`account-answer-topic-${index}`}>Topic</label>
                  <input id={`account-answer-topic-${index}`} required maxLength={100} value={item.topic}
                    onChange={(event) => {
                      const customAnswers = [...form.customAnswers];
                      customAnswers[index] = { ...item, topic: event.target.value };
                      setForm({ ...form, customAnswers });
                    }} />
                </div>
                <div className="form-group">
                  <label htmlFor={`account-answer-question-${index}`}>Application question</label>
                  <textarea id={`account-answer-question-${index}`} required maxLength={1000} value={item.question}
                    onChange={(event) => {
                      const customAnswers = [...form.customAnswers];
                      customAnswers[index] = { ...item, question: event.target.value };
                      setForm({ ...form, customAnswers });
                    }} />
                </div>
                <div className="form-group account-profile-form__field--wide">
                  <label htmlFor={`account-answer-value-${index}`}>Reusable answer</label>
                  <textarea id={`account-answer-value-${index}`} required maxLength={4000} value={item.answer}
                    onChange={(event) => {
                      const customAnswers = [...form.customAnswers];
                      customAnswers[index] = { ...item, answer: event.target.value };
                      setForm({ ...form, customAnswers });
                    }} />
                </div>
              </div>
              <button className="btn btn-ghost" type="button"
                onClick={() => setForm({
                  ...form,
                  customAnswers: form.customAnswers.filter((_, row) => row !== index),
                })}>
                Remove saved answer
              </button>
            </fieldset>
          ))}
          <button className="btn btn-ghost" type="button" onClick={() => setForm({
            ...form,
            customAnswers: [...form.customAnswers, { topic: '', question: '', answer: '' }],
          })}>Add reusable question and answer</button>
        </form>
        {formError && <div className="alert alert-error">{formError}</div>}
      </Modal>
    </>
  );
}
