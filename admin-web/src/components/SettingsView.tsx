'use client';

import { useEffect, useState } from 'react';
import { useAdminUiMode } from '@/components/AdminUiModeProvider';
import { api } from '@/lib/api';
import { APP_NAME } from '@/lib/branding';
import {
  ADMIN_UI_MODE_OPTIONS,
  ADMIN_UI_MODE_SETTING_KEY,
  normalizeAdminUiMode,
  type AdminUiMode,
} from '@/lib/admin-ui-mode';
import {
  CANDIDATE_STACKS_SETTING_KEY,
  parseCandidateStacks,
  serializeCandidateStacks,
} from '../../../shared/candidate-stacks';

export function SettingsView() {
  const { setAdminUiMode, refreshAdminUiMode } = useAdminUiMode();
  const [serverName, setServerName] = useState(APP_NAME);
  const [defaultSource, setDefaultSource] = useState('');
  const [tokenExpiry, setTokenExpiry] = useState('24h');
  const [adminUiMode, setAdminUiModeLocal] = useState<AdminUiMode>('mode1');
  const [settingsAlert, setSettingsAlert] = useState<string | null>(null);
  const [settingsError, setSettingsError] = useState(false);
  const [backupAlert, setBackupAlert] = useState<string | null>(null);
  const [backupError, setBackupError] = useState(false);
  const [candidateStacks, setCandidateStacks] = useState<string[]>([]);
  const [newStack, setNewStack] = useState('');
  const [stacksAlert, setStacksAlert] = useState<string | null>(null);
  const [stacksError, setStacksError] = useState(false);

  useEffect(() => {
    (async () => {
      const r = await api<{ success: boolean; settings?: Record<string, string> }>('GET', '/api/settings');
      const s = r.settings || {};
      setServerName(s.server_name || APP_NAME);
      setDefaultSource(s.default_source || '');
      setTokenExpiry(s.token_expiration || '24h');
      setAdminUiModeLocal(normalizeAdminUiMode(s[ADMIN_UI_MODE_SETTING_KEY]));

      const stacksRes = await api<{ success: boolean; stacks?: string[]; message?: string }>(
        'GET',
        '/api/settings/candidate-stacks'
      );
      if (stacksRes.success && stacksRes.stacks?.length) {
        setCandidateStacks(stacksRes.stacks);
      } else {
        setCandidateStacks(parseCandidateStacks(s[CANDIDATE_STACKS_SETTING_KEY]));
      }
    })();
  }, []);

  async function saveSettings() {
    const r = await api<{ success: boolean; message?: string }>('PUT', '/api/settings', {
      settings: {
        server_name: serverName,
        default_source: defaultSource,
        token_expiration: tokenExpiry,
        [ADMIN_UI_MODE_SETTING_KEY]: adminUiMode,
      },
    });
    if (r.success) {
      setAdminUiMode(adminUiMode);
      await refreshAdminUiMode();
      setSettingsAlert('Settings saved. Admin dashboard layout will update immediately.');
      setSettingsError(false);
    } else {
      setSettingsAlert(r.message || 'Could not save settings.');
      setSettingsError(true);
    }
  }

  async function createBackup() {
    const r = await api<{ success: boolean; path?: string; message?: string }>('POST', '/api/settings/backup');
    if (r.success) {
      setBackupAlert(`Backup created: ${r.path}`);
      setBackupError(false);
    } else {
      setBackupAlert(r.message || 'Backup failed.');
      setBackupError(true);
    }
  }

  function updateStackAt(index: number, value: string) {
    setCandidateStacks((prev) => prev.map((stack, i) => (i === index ? value : stack)));
  }

  function removeStackAt(index: number) {
    setCandidateStacks((prev) => prev.filter((_, i) => i !== index));
  }

  function addStackOption() {
    const value = newStack.trim();
    if (!value) return;
    setCandidateStacks((prev) => {
      if (prev.some((stack) => stack.toLowerCase() === value.toLowerCase())) return prev;
      return [...prev, value];
    });
    setNewStack('');
  }

  async function saveCandidateStacks() {
    const stacks = candidateStacks.map((stack) => stack.trim()).filter(Boolean);
    if (!stacks.length) {
      setStacksAlert('Add at least one stack option.');
      setStacksError(true);
      return;
    }
    let r = await api<{ success: boolean; stacks?: string[]; message?: string }>(
      'PUT',
      '/api/settings/candidate-stacks',
      { stacks }
    );
    if (!r.success && (r.message || '').includes('404')) {
      r = await api<{ success: boolean; stacks?: string[]; message?: string }>(
        'PUT',
        '/api/settings',
        { settings: { [CANDIDATE_STACKS_SETTING_KEY]: serializeCandidateStacks(stacks) } }
      );
      if (r.success) {
        r = { success: true, stacks, message: 'Candidate stacks saved.' };
      }
    }
    if (r.success) {
      setCandidateStacks(r.stacks || stacks);
      setStacksAlert(r.message || 'Candidate stacks saved.');
      setStacksError(false);
    } else {
      setStacksAlert(r.message || 'Could not save candidate stacks.');
      setStacksError(true);
    }
  }

  return (
    <div className="settings-page">
      <div className="card settings-card">
        <div className="card-title">Application Settings</div>
        {settingsAlert && (
          <div className={`alert ${settingsError ? 'alert-error' : 'alert-success'}`}>{settingsAlert}</div>
        )}
        <div className="form-group">
          <label>Server Name</label>
          <input value={serverName} onChange={(e) => setServerName(e.target.value)} />
        </div>
        <div className="form-group">
          <label>Default Source Label</label>
          <input value={defaultSource} onChange={(e) => setDefaultSource(e.target.value)} />
        </div>
        <div className="form-group">
          <label>Token Expiration</label>
          <input value={tokenExpiry} onChange={(e) => setTokenExpiry(e.target.value)} />
        </div>
        <div className="form-group">
          <label>Admin Dashboard Mode</label>
          <select
            value={adminUiMode}
            onChange={(e) => setAdminUiModeLocal(e.target.value as AdminUiMode)}
          >
            {ADMIN_UI_MODE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <p className="form-hint">
            {ADMIN_UI_MODE_OPTIONS.find((option) => option.value === adminUiMode)?.description}
          </p>
        </div>
        <button className="btn btn-primary" type="button" onClick={() => { void saveSettings(); }}>
          Save Settings
        </button>
      </div>

      <div className="card settings-card" style={{ marginTop: 16 }}>
        <div className="card-title">Candidate Stacks</div>
        <p className="text-muted" style={{ marginBottom: 12 }}>
          Manage stack options shown when adding or editing candidates.
        </p>
        {stacksAlert && (
          <div className={`alert ${stacksError ? 'alert-error' : 'alert-success'}`}>{stacksAlert}</div>
        )}
        <div className="stack-editor">
          {candidateStacks.map((stack, index) => (
            <div key={`stack-${index}`} className="stack-editor-row">
              <input
                value={stack}
                onChange={(e) => updateStackAt(index, e.target.value)}
                placeholder="Stack name"
              />
              <button
                className="btn btn-ghost btn-sm"
                type="button"
                onClick={() => removeStackAt(index)}
                disabled={candidateStacks.length <= 1}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
        <div className="stack-editor-add">
          <input
            value={newStack}
            onChange={(e) => setNewStack(e.target.value)}
            placeholder="New stack option"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addStackOption();
              }
            }}
          />
          <button className="btn btn-ghost" type="button" onClick={addStackOption}>
            + Add
          </button>
        </div>
        <button className="btn btn-primary mt-stack" type="button" onClick={() => { void saveCandidateStacks(); }}>
          Save Stacks
        </button>
      </div>

      <div className="card settings-card" style={{ marginTop: 16 }}>
        <div className="card-title">Database Backup</div>
        <p className="text-muted" style={{ marginBottom: 12 }}>
          Create a timestamped backup of the PostgreSQL database.
        </p>
        <button className="btn btn-ghost" type="button" onClick={() => { void createBackup(); }}>
          📦 Create Backup
        </button>
        {backupAlert && (
          <div className={`alert ${backupError ? 'alert-error' : 'alert-success'} mt-stack`}>
            {backupAlert}
          </div>
        )}
      </div>
    </div>
  );
}
