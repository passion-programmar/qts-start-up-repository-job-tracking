'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';

type SalaryAnswer = {
  currency: string;
  minimumAmount: string;
  maximumAmount: string;
  payPeriod: 'hour' | 'day' | 'week' | 'month' | 'year';
  answerText: string;
};

type CustomAnswer = { topic: string; question: string; answer: string };
type BooleanChoice = '' | 'true' | 'false';

type ProfileForm = {
  managedCountry: string;
  authorizedToWork: BooleanChoice;
  authorizationStatus: string;
  sponsorshipRequired: BooleanChoice;
  authorizationExpiresOn: string;
  relocationWilling: BooleanChoice;
  relocationDetails: string;
  noticePeriodValue: string;
  noticePeriodUnit: '' | 'days' | 'weeks' | 'months';
  noticePeriodText: string;
  salaryAnswers: SalaryAnswer[];
  customAnswers: CustomAnswer[];
};

const emptyProfile = (): ProfileForm => ({
  managedCountry: '',
  authorizedToWork: '',
  authorizationStatus: '',
  sponsorshipRequired: '',
  authorizationExpiresOn: '',
  relocationWilling: '',
  relocationDetails: '',
  noticePeriodValue: '',
  noticePeriodUnit: '',
  noticePeriodText: '',
  salaryAnswers: [],
  customAnswers: [],
});

function nullableBoolean(value: BooleanChoice): boolean | null {
  if (value === '') return null;
  return value === 'true';
}

function booleanChoice(value: unknown): BooleanChoice {
  if (value === true) return 'true';
  if (value === false) return 'false';
  return '';
}

export function ManagerApplicationProfilesView() {
  const [profile, setProfile] = useState<ProfileForm>(emptyProfile());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [isError, setIsError] = useState(false);

  const loadProfile = useCallback(async () => {
    const response = await api<{
      success: boolean;
      message?: string;
      profile?: Record<string, unknown> & {
        salaryAnswers?: Array<Record<string, unknown>>;
        customAnswers?: Array<Record<string, unknown>>;
      };
    }>('GET', '/api/v2/manager-application-profile');
    setLoading(false);
    if (!response.success || !response.profile) {
      setMessage(response.message || 'Could not load application profile.');
      setIsError(true);
      return;
    }
    const source = response.profile;
    setProfile({
      managedCountry: String(source.managed_country || ''),
      authorizedToWork: booleanChoice(source.authorized_to_work),
      authorizationStatus: String(source.authorization_status || ''),
      sponsorshipRequired: booleanChoice(source.sponsorship_required),
      authorizationExpiresOn: source.authorization_expires_on
        ? String(source.authorization_expires_on).slice(0, 10)
        : '',
      relocationWilling: booleanChoice(source.relocation_willing),
      relocationDetails: String(source.relocation_details || ''),
      noticePeriodValue: source.notice_period_value == null ? '' : String(source.notice_period_value),
      noticePeriodUnit: (source.notice_period_unit || '') as ProfileForm['noticePeriodUnit'],
      noticePeriodText: String(source.notice_period_text || ''),
      salaryAnswers: (source.salaryAnswers || []).map((answer) => ({
        currency: String(answer.currency || ''),
        minimumAmount: answer.minimum_amount == null ? '' : String(answer.minimum_amount),
        maximumAmount: answer.maximum_amount == null ? '' : String(answer.maximum_amount),
        payPeriod: (answer.pay_period || 'year') as SalaryAnswer['payPeriod'],
        answerText: String(answer.answer_text || ''),
      })),
      customAnswers: (source.customAnswers || []).map((answer) => ({
        topic: String(answer.topic || ''),
        question: String(answer.question || ''),
        answer: String(answer.answer || ''),
      })),
    });
    setMessage('');
    setIsError(false);
  }, []);

  useEffect(() => {
    // The loader updates the view after its authenticated API request completes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadProfile();
  }, [loadProfile]);

  function update<K extends keyof ProfileForm>(key: K, value: ProfileForm[K]) {
    setProfile((current) => ({ ...current, [key]: value }));
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage('');
    const response = await api<{ success: boolean; message?: string }>(
      'PUT',
      '/api/v2/manager-application-profile',
      {
        managedCountry: profile.managedCountry || null,
        authorizedToWork: nullableBoolean(profile.authorizedToWork),
        authorizationStatus: profile.authorizationStatus || null,
        sponsorshipRequired: nullableBoolean(profile.sponsorshipRequired),
        authorizationExpiresOn: profile.authorizationExpiresOn || null,
        relocationWilling: nullableBoolean(profile.relocationWilling),
        relocationDetails: profile.relocationDetails || null,
        noticePeriodValue: profile.noticePeriodValue === '' ? null : Number(profile.noticePeriodValue),
        noticePeriodUnit: profile.noticePeriodUnit || null,
        noticePeriodText: profile.noticePeriodText || null,
        salaryAnswers: profile.salaryAnswers.map((answer) => ({
          currency: answer.currency,
          minimumAmount: answer.minimumAmount === '' ? null : Number(answer.minimumAmount),
          maximumAmount: answer.maximumAmount === '' ? null : Number(answer.maximumAmount),
          payPeriod: answer.payPeriod,
          answerText: answer.answerText || null,
        })),
        customAnswers: profile.customAnswers,
      }
    );
    setSaving(false);
    setMessage(response.success ? 'Application answers saved.' : response.message || 'Could not save application answers.');
    setIsError(!response.success);
  }

  const yesNoSelect = (
    id: string,
    label: string,
    value: BooleanChoice,
    onChange: (value: BooleanChoice) => void
  ) => (
    <div className="form-group">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} onChange={(event) => onChange(event.target.value as BooleanChoice)}>
        <option value="">Not set</option>
        <option value="true">Yes</option>
        <option value="false">No</option>
      </select>
    </div>
  );

  return (
    <form className="card settings-card" onSubmit={(event) => { void save(event); }}>
      <div className="card-title">Reusable Application Answers</div>
      <p className="text-muted">
        These answers belong to your Manager account and are used for applications you manage. Reuse them only when
        accurate for the Account applying; automation must ask rather than guess when an answer does not clearly apply.
      </p>
      {loading ? <p>Loading application answers…</p> : (
        <>
          {message && <div className={`alert ${isError ? 'alert-error' : 'alert-success'}`}>{message}</div>}
          <h3>Country</h3>
          <div className="form-group">
            <label htmlFor="managed-country">Manager’s country</label>
            <input id="managed-country" maxLength={100} value={profile.managedCountry}
              onChange={(event) => update('managedCountry', event.target.value)} />
          </div>

          <h3>Work authorization</h3>
          {yesNoSelect('authorized-to-work', 'Authorized to work', profile.authorizedToWork,
            (value) => update('authorizedToWork', value))}
          <div className="form-group">
            <label htmlFor="authorization-status">Authorization type or status</label>
            <input id="authorization-status" maxLength={500} value={profile.authorizationStatus}
              onChange={(event) => update('authorizationStatus', event.target.value)} />
          </div>
          {yesNoSelect('sponsorship-required', 'Sponsorship required', profile.sponsorshipRequired,
            (value) => update('sponsorshipRequired', value))}
          <div className="form-group">
            <label htmlFor="authorization-expiry">Authorization expiration date (optional)</label>
            <input id="authorization-expiry" type="date" value={profile.authorizationExpiresOn}
              onChange={(event) => update('authorizationExpiresOn', event.target.value)} />
          </div>

          <h3>Relocation</h3>
          {yesNoSelect('relocation-willing', 'Willing to relocate', profile.relocationWilling,
            (value) => update('relocationWilling', value))}
          <div className="form-group">
            <label htmlFor="relocation-details">Reusable relocation details</label>
            <textarea id="relocation-details" maxLength={2000} value={profile.relocationDetails}
              onChange={(event) => update('relocationDetails', event.target.value)} />
          </div>

          <h3>Notice period</h3>
          <div className="form-group">
            <label htmlFor="notice-period-value">Duration</label>
            <input id="notice-period-value" type="number" min="0" step="1" value={profile.noticePeriodValue}
              onChange={(event) => update('noticePeriodValue', event.target.value)} />
          </div>
          <div className="form-group">
            <label htmlFor="notice-period-unit">Duration unit</label>
            <select id="notice-period-unit" value={profile.noticePeriodUnit}
              onChange={(event) => update('noticePeriodUnit', event.target.value as ProfileForm['noticePeriodUnit'])}>
              <option value="">Not set</option><option value="days">Days</option>
              <option value="weeks">Weeks</option><option value="months">Months</option>
            </select>
          </div>
          <div className="form-group">
            <label htmlFor="notice-period-text">Reusable notice period text</label>
            <textarea id="notice-period-text" maxLength={1000} value={profile.noticePeriodText}
              onChange={(event) => update('noticePeriodText', event.target.value)} />
          </div>

          <h3>Salary answers</h3>
          <p className="text-muted">Add separate currencies and pay periods; no conversion is performed.</p>
          {profile.salaryAnswers.map((answer, index) => (
            <fieldset className="card" key={index}>
              <legend>Salary entry {index + 1}</legend>
              <div className="form-group"><label htmlFor={`salary-currency-${index}`}>Currency code</label>
                <input id={`salary-currency-${index}`} required maxLength={3} placeholder="EUR"
                  value={answer.currency} onChange={(event) => {
                    const rows = [...profile.salaryAnswers]; rows[index] = { ...answer, currency: event.target.value.toUpperCase() };
                    update('salaryAnswers', rows);
                  }} /></div>
              <div className="form-group"><label htmlFor={`salary-min-${index}`}>Minimum amount (optional)</label>
                <input id={`salary-min-${index}`} type="number" min="0" step="0.01" value={answer.minimumAmount}
                  onChange={(event) => { const rows = [...profile.salaryAnswers]; rows[index] = { ...answer, minimumAmount: event.target.value }; update('salaryAnswers', rows); }} /></div>
              <div className="form-group"><label htmlFor={`salary-max-${index}`}>Maximum amount (optional)</label>
                <input id={`salary-max-${index}`} type="number" min="0" step="0.01" value={answer.maximumAmount}
                  onChange={(event) => { const rows = [...profile.salaryAnswers]; rows[index] = { ...answer, maximumAmount: event.target.value }; update('salaryAnswers', rows); }} /></div>
              <div className="form-group"><label htmlFor={`salary-period-${index}`}>Pay period</label>
                <select id={`salary-period-${index}`} value={answer.payPeriod}
                  onChange={(event) => { const rows = [...profile.salaryAnswers]; rows[index] = { ...answer, payPeriod: event.target.value as SalaryAnswer['payPeriod'] }; update('salaryAnswers', rows); }}>
                  <option value="hour">Hourly</option><option value="day">Daily</option><option value="week">Weekly</option>
                  <option value="month">Monthly</option><option value="year">Yearly</option>
                </select></div>
              <div className="form-group"><label htmlFor={`salary-text-${index}`}>Reusable salary text (optional)</label>
                <input id={`salary-text-${index}`} maxLength={1000} value={answer.answerText}
                  onChange={(event) => { const rows = [...profile.salaryAnswers]; rows[index] = { ...answer, answerText: event.target.value }; update('salaryAnswers', rows); }} /></div>
              <button className="btn btn-ghost" type="button"
                onClick={() => update('salaryAnswers', profile.salaryAnswers.filter((_, rowIndex) => rowIndex !== index))}>Remove salary entry</button>
            </fieldset>
          ))}
          <button className="btn btn-ghost" type="button" onClick={() => update('salaryAnswers', [
            ...profile.salaryAnswers,
            { currency: 'EUR', minimumAmount: '', maximumAmount: '', payPeriod: 'year', answerText: '' },
          ])}>Add salary entry</button>

          <h3>Custom reusable questions</h3>
          {profile.customAnswers.map((answer, index) => (
            <fieldset className="card" key={index}>
              <legend>Custom answer {index + 1}</legend>
              <div className="form-group"><label htmlFor={`answer-topic-${index}`}>Topic</label>
                <input id={`answer-topic-${index}`} required maxLength={100} value={answer.topic}
                  onChange={(event) => { const rows = [...profile.customAnswers]; rows[index] = { ...answer, topic: event.target.value }; update('customAnswers', rows); }} /></div>
              <div className="form-group"><label htmlFor={`answer-question-${index}`}>Employer question</label>
                <textarea id={`answer-question-${index}`} required maxLength={1000} value={answer.question}
                  onChange={(event) => { const rows = [...profile.customAnswers]; rows[index] = { ...answer, question: event.target.value }; update('customAnswers', rows); }} /></div>
              <div className="form-group"><label htmlFor={`answer-value-${index}`}>Reusable answer</label>
                <textarea id={`answer-value-${index}`} required maxLength={4000} value={answer.answer}
                  onChange={(event) => { const rows = [...profile.customAnswers]; rows[index] = { ...answer, answer: event.target.value }; update('customAnswers', rows); }} /></div>
              <button className="btn btn-ghost" type="button"
                onClick={() => update('customAnswers', profile.customAnswers.filter((_, rowIndex) => rowIndex !== index))}>Remove custom answer</button>
            </fieldset>
          ))}
          <button className="btn btn-ghost" type="button" onClick={() => update('customAnswers', [
            ...profile.customAnswers, { topic: '', question: '', answer: '' },
          ])}>Add custom question and answer</button>
          <div className="form-actions">
            <button className="btn btn-primary" type="submit" disabled={saving}>
              {saving ? 'Saving…' : 'Save Application Answers'}
            </button>
          </div>
        </>
      )}
    </form>
  );
}
