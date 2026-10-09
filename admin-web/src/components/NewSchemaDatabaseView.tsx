'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { api } from '@/lib/api';
import { Modal } from '@/components/Modal';

interface BrowseTable {
  id: string;
  label: string;
  description: string;
  count: number;
}

interface BrowseResult {
  success: boolean;
  message?: string;
  table?: BrowseTable & {
    columns: string[];
    primaryKey: string;
    fields: Array<{
      name: string;
      type: 'text' | 'password' | 'integer' | 'boolean' | 'date' | 'datetime' | 'time' | 'url' | 'integer-array' | 'enum';
      nullable?: boolean;
      required?: boolean;
      options?: string[];
      maxLength?: number;
    }>;
  };
  records?: Array<Record<string, unknown>>;
  total?: number;
  limit?: number;
  offset?: number;
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export function NewSchemaDatabaseView() {
  const { user } = useAuth();
  const [tables, setTables] = useState<BrowseTable[]>([]);
  const [selectedTable, setSelectedTable] = useState('');
  const [tableInfo, setTableInfo] = useState<BrowseResult['table']>();
  const [records, setRecords] = useState<Array<Record<string, unknown>>>([]);
  const [total, setTotal] = useState(0);
  const [searchInput, setSearchInput] = useState('');
  const [query, setQuery] = useState('');
  const [offset, setOffset] = useState(0);
  const [loadingTables, setLoadingTables] = useState(true);
  const [loadingRecords, setLoadingRecords] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recordEditorOpen, setRecordEditorOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<Record<string, unknown> | null>(null);
  const [recordDraft, setRecordDraft] = useState<Record<string, unknown>>({});
  const [savingRecord, setSavingRecord] = useState(false);
  const [recordError, setRecordError] = useState<string | null>(null);
  const recordsRequestId = useRef(0);
  const limit = 50;

  const loadTables = useCallback(async () => {
    const result = await api<{ success: boolean; tables?: BrowseTable[]; message?: string }>(
      'GET',
      '/api/v2/database/tables'
    );
    if (!result.success) {
      setError(result.message || 'Could not load database tables.');
      setLoadingTables(false);
      return;
    }
    const availableTables = result.tables || [];
    setTables(availableTables);
    setSelectedTable((current) => current || availableTables[0]?.id || '');
    setLoadingTables(false);
  }, []);

  const loadRecords = useCallback(async (table: string, q: string, pageOffset: number) => {
    if (!table) return;
    const requestId = ++recordsRequestId.current;
    setLoadingRecords(true);
    setError(null);
    const params = new URLSearchParams({
      limit: String(limit),
      offset: String(pageOffset),
    });
    if (q) params.set('q', q);
    try {
      const result = await api<BrowseResult>(
        'GET',
        `/api/v2/database/tables/${encodeURIComponent(table)}?${params.toString()}`
      );
      if (requestId !== recordsRequestId.current) return;
      if (!result.success) {
        setError(result.message || 'Could not load table records.');
        setRecords([]);
        setTotal(0);
      } else {
        setTableInfo(result.table);
        setRecords(result.records || []);
        setTotal(result.total || 0);
        setOffset(pageOffset);
      }
    } catch (requestError) {
      if (requestId === recordsRequestId.current) {
        setError(requestError instanceof Error ? requestError.message : 'Could not load table records.');
        setRecords([]);
        setTotal(0);
      }
    } finally {
      if (requestId === recordsRequestId.current) setLoadingRecords(false);
    }
  }, []);

  useEffect(() => () => {
    recordsRequestId.current += 1;
  }, []);

  useEffect(() => {
    // Load the Super-only list of browsable database tables.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (user?.role === 'super') void loadTables();
  }, [loadTables, user?.role]);

  useEffect(() => {
    if (!selectedTable || user?.role !== 'super') return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadRecords(selectedTable, query, offset);
  }, [selectedTable, query, offset, loadRecords, user?.role]);

  function selectTable(table: string) {
    setSelectedTable(table);
    setTableInfo(undefined);
    setSearchInput('');
    setQuery('');
    setOffset(0);
  }

  function runSearch() {
    const nextQuery = searchInput.trim();
    if (nextQuery === query && offset === 0) {
      setOffset(0);
      void loadRecords(selectedTable, nextQuery, 0);
    } else {
      setQuery(nextQuery);
      setOffset(0);
    }
  }

  function formatFieldValue(fieldType: NonNullable<BrowseResult['table']>['fields'][number]['type'], value: unknown): unknown {
    if (value === null || value === undefined) return '';
    if (fieldType === 'integer-array' && Array.isArray(value)) return JSON.stringify(value);
    if (fieldType === 'datetime' && typeof value === 'string') {
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return '';
      return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
    }
    return value;
  }

  function beginCreateRecord() {
    if (!tableInfo) return;
    const draft: Record<string, unknown> = {};
    for (const field of tableInfo.fields) {
      if (field.type === 'boolean') draft[field.name] = false;
      else if (field.type === 'integer-array') draft[field.name] = '[]';
      else if (field.name === 'role' && selectedTable === 'users') draft[field.name] = 'manager';
      else draft[field.name] = '';
    }
    setEditingRecord(null);
    setRecordDraft(draft);
    setRecordError(null);
    setRecordEditorOpen(true);
  }

  function beginEditRecord(record: Record<string, unknown>) {
    if (!tableInfo) return;
    const draft: Record<string, unknown> = {};
    for (const field of tableInfo.fields) {
      draft[field.name] = field.name === 'password'
        ? ''
        : formatFieldValue(field.type, record[field.name]);
    }
    setEditingRecord(record);
    setRecordDraft(draft);
    setRecordError(null);
    setRecordEditorOpen(true);
  }

  async function saveRecord(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!tableInfo || savingRecord) return;
    setSavingRecord(true);
    setRecordError(null);
    const payload: Record<string, unknown> = {};
    try {
      for (const field of tableInfo.fields) {
        const value = recordDraft[field.name];
        if (field.type === 'integer-array') {
          payload[field.name] = typeof value === 'string' ? JSON.parse(value || '[]') : value;
        } else if (field.type === 'integer' && value !== '' && value !== null) {
          payload[field.name] = Number(value);
        } else if (field.type === 'datetime' && value) {
          payload[field.name] = new Date(String(value)).toISOString();
        } else {
          payload[field.name] = value;
        }
      }
    } catch {
      setRecordError('Enter valid JSON arrays and date/time values.');
      setSavingRecord(false);
      return;
    }

    const recordId = editingRecord?.[tableInfo.primaryKey];
    const path = `/api/v2/database/tables/${encodeURIComponent(selectedTable)}`
      + (editingRecord ? `/${encodeURIComponent(String(recordId))}` : '');
    const result = await api<{ success: boolean; message?: string }>(
      editingRecord ? 'PUT' : 'POST',
      path,
      payload
    );
    if (!result.success) {
      setRecordError(result.message || 'Could not save this record.');
      setSavingRecord(false);
      return;
    }
    setRecordEditorOpen(false);
    setSavingRecord(false);
    await Promise.all([
      loadTables(),
      loadRecords(selectedTable, query, offset),
    ]);
  }

  async function deleteRecord(record: Record<string, unknown>) {
    if (!tableInfo) return;
    const primaryValue = record[tableInfo.primaryKey];
    if (!window.confirm(`Delete ${tableInfo.label} record ${String(primaryValue)}? Related records may also be removed.`)) return;
    const result = await api<{ success: boolean; message?: string }>(
      'DELETE',
      `/api/v2/database/tables/${encodeURIComponent(selectedTable)}/${encodeURIComponent(String(primaryValue))}`
    );
    if (!result.success) {
      setError(result.message || 'Could not delete this record.');
      return;
    }
    await Promise.all([
      loadTables(),
      loadRecords(selectedTable, query, offset),
    ]);
  }

  const pageStart = total ? offset + 1 : 0;
  const pageEnd = Math.min(offset + records.length, total);

  if (user?.role !== 'super') {
    return <div className="alert alert-error">Only Super users can browse database tables.</div>;
  }

  return (
    <>
      <p className="text-muted" style={{ marginBottom: 12 }}>
        Manage records in the application tables. Password hashes are never shown; changing a user password requires entering a new password.
      </p>
      {error && <div className="alert alert-error">{error}</div>}
      {loadingTables ? (
        <div className="card"><div className="text-muted">Loading database tables…</div></div>
      ) : (
        <div className="database-records-layout">
          <aside className="card database-records-sidebar">
            <div className="card-title">Tables</div>
            <div className="database-records-category-list">
              {tables.map((table) => (
                <button
                  key={table.id}
                  type="button"
                  className={`database-records-category${selectedTable === table.id ? ' is-active' : ''}`}
                  aria-pressed={selectedTable === table.id}
                  onClick={() => selectTable(table.id)}
                >
                  <span>{table.label}</span>
                  <span className="text-muted">{table.count}</span>
                </button>
              ))}
            </div>
          </aside>
          <section className="card database-records-panel">
            <div className="database-records-panel-header">
              <div>
                <div className="card-title">{tableInfo?.label || tables.find((item) => item.id === selectedTable)?.label || 'Records'}</div>
                <p className="text-muted" style={{ marginTop: 4 }}>
                  {tableInfo?.description || tables.find((item) => item.id === selectedTable)?.description}
                </p>
              </div>
              <div className="search-row">
                <button className="btn btn-primary" type="button" onClick={beginCreateRecord}>+ Create record</button>
                <input
                  aria-label="Search table records"
                  value={searchInput}
                  maxLength={200}
                  onChange={(event) => setSearchInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') runSearch();
                  }}
                  placeholder="Search this table…"
                />
                <button className="btn btn-ghost" type="button" onClick={runSearch}>Search</button>
              </div>
            </div>
            {loadingRecords ? <div className="text-muted">Loading records…</div> : (
              <>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        {tableInfo?.columns.map((column) => <th key={column}>{column.replaceAll('_', ' ')}</th>)}
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {records.map((record, index) => (
                        <tr key={String(record[tableInfo?.columns[0] || 'id'] ?? index)}>
                          {tableInfo?.columns.map((column) => {
                            const value = displayValue(record[column]);
                            return <td key={column} title={value}>{value.length > 120 ? `${value.slice(0, 117)}…` : value}</td>;
                          })}
                          <td className="text-right">
                            <button className="btn btn-ghost btn-sm" type="button" onClick={() => beginEditRecord(record)}>Edit</button>
                            <button className="btn btn-danger btn-sm" type="button" onClick={() => { void deleteRecord(record); }}>Delete</button>
                          </td>
                        </tr>
                      ))}
                      {!records.length && <tr><td colSpan={(tableInfo?.columns.length || 0) + 1} className="text-muted">No records found.</td></tr>}
                    </tbody>
                  </table>
                </div>
                <div className="search-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 }}>
                  <span className="text-muted">Showing {pageStart}–{pageEnd} of {total}</span>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn btn-ghost btn-sm" type="button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))}>Previous</button>
                    <button className="btn btn-ghost btn-sm" type="button" disabled={offset + records.length >= total} onClick={() => setOffset(offset + limit)}>Next</button>
                  </div>
                </div>
              </>
            )}
          </section>
        </div>
      )}
      <Modal
        open={recordEditorOpen && Boolean(tableInfo)}
        title={`${editingRecord ? 'Edit' : 'Create'} ${tableInfo?.label || 'record'}`}
        onClose={() => {
          if (!savingRecord) setRecordEditorOpen(false);
        }}
        footer={(
          <>
            <button className="btn btn-ghost" type="button" disabled={savingRecord} onClick={() => setRecordEditorOpen(false)}>Cancel</button>
            <button className="btn btn-primary" type="submit" form="database-record-form" disabled={savingRecord}>
              {savingRecord ? 'Saving…' : 'Save record'}
            </button>
          </>
        )}
      >
        {recordError && <div className="alert alert-error">{recordError}</div>}
        <form id="database-record-form" className="job-form" onSubmit={(event) => { void saveRecord(event); }}>
          {tableInfo?.fields.map((field) => {
            if (field.type === 'password' && editingRecord && recordDraft.role === 'account') return null;
            const role = recordDraft.role;
            const accountOnlyFields = ['email', 'address', 'sex', 'birthday', 'phone', 'country', 'city', 'category_id'];
            if (selectedTable === 'users' && accountOnlyFields.includes(field.name) && role !== 'account') return null;
            if (selectedTable === 'users' && field.name === 'password' && role === 'account') return null;
            if (selectedTable === 'users' && field.name === 'parent_user_id' && role === 'super') return null;
            const isRequired = (Boolean(field.required)
              && !(selectedTable === 'users' && role === 'account' && field.name === 'username'))
              || (selectedTable === 'users' && role === 'account' && accountOnlyFields.includes(field.name))
              || (selectedTable === 'users' && role !== 'account' && role !== 'super' && field.name === 'parent_user_id')
              || (selectedTable === 'users' && !editingRecord && role !== 'account' && field.name === 'password');
            const updateValue = (value: unknown) => setRecordDraft((current) => ({ ...current, [field.name]: value }));
            return (
              <div className="form-group" key={field.name}>
                <label htmlFor={`database-field-${field.name}`}>{field.name.replaceAll('_', ' ')}</label>
                {field.type === 'enum' ? (
                  <select
                    id={`database-field-${field.name}`}
                    required={isRequired}
                    value={String(recordDraft[field.name] ?? '')}
                    onChange={(event) => updateValue(event.target.value)}
                  >
                    {!isRequired && <option value="">—</option>}
                    {field.options?.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                ) : field.type === 'boolean' ? (
                  <input
                    id={`database-field-${field.name}`}
                    type="checkbox"
                    checked={Boolean(recordDraft[field.name])}
                    onChange={(event) => updateValue(event.target.checked)}
                  />
                ) : field.type === 'integer-array' ? (
                  <textarea
                    id={`database-field-${field.name}`}
                    required={isRequired}
                    value={String(recordDraft[field.name] ?? '[]')}
                    onChange={(event) => updateValue(event.target.value)}
                    placeholder="[1, 2]"
                  />
                ) : (
                  <input
                    id={`database-field-${field.name}`}
                    type={field.type === 'password' ? 'password'
                      : field.type === 'date' ? 'date'
                        : field.type === 'integer' ? 'number'
                          : field.type === 'url' ? 'url'
                            : field.type === 'time' ? 'time'
                              : field.type === 'datetime' ? 'datetime-local'
                                : 'text'}
                    required={isRequired}
                    min={field.type === 'integer' ? 1 : undefined}
                    maxLength={field.maxLength}
                    value={String(recordDraft[field.name] ?? '')}
                    onChange={(event) => updateValue(event.target.value)}
                    placeholder={selectedTable === 'users' && role === 'account' && field.name === 'username'
                      ? 'Generated automatically if blank'
                      : undefined}
                  />
                )}
              </div>
            );
          })}
        </form>
      </Modal>
    </>
  );
}
