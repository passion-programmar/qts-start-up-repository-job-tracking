'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal } from '@/components/Modal';
import { api } from '@/lib/api';

type ColumnType = 'text' | 'number' | 'boolean' | 'json' | 'readonly';

interface RecordColumnDef {
  key: string;
  label: string;
  type: ColumnType;
  editable?: boolean;
  list?: boolean;
}

interface RecordCategoryMeta {
  id: string;
  label: string;
  description: string;
  count: number;
  columns: RecordColumnDef[];
}

interface RecordListResponse {
  success: boolean;
  message?: string;
  category?: {
    id: string;
    label: string;
    description: string;
    primaryKey: string;
    columns: RecordColumnDef[];
  };
  records?: Array<Record<string, unknown>>;
  total?: number;
  limit?: number;
  offset?: number;
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'object') {
    const json = JSON.stringify(value);
    return json.length > 80 ? `${json.slice(0, 77)}…` : json;
  }
  const text = String(value);
  return text.length > 120 ? `${text.slice(0, 117)}…` : text;
}

function recordId(record: Record<string, unknown>, primaryKey: string): string {
  const value = record[primaryKey];
  return value == null ? '' : String(value);
}

export function DatabaseRecordsView() {
  const [categories, setCategories] = useState<RecordCategoryMeta[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('');
  const [records, setRecords] = useState<Array<Record<string, unknown>>>([]);
  const [columns, setColumns] = useState<RecordColumnDef[]>([]);
  const [primaryKey, setPrimaryKey] = useState('id');
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [modal, setModal] = useState<'edit' | 'delete' | null>(null);
  const [selectedRecord, setSelectedRecord] = useState<Record<string, unknown> | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const limit = 50;

  const selectedCategory = useMemo(
    () => categories.find((category) => category.id === selectedCategoryId) ?? null,
    [categories, selectedCategoryId]
  );

  const listColumns = useMemo(
    () => columns.filter((column) => column.list),
    [columns]
  );

  const editableColumns = useMemo(
    () => columns.filter((column) => column.editable),
    [columns]
  );

  const loadCategories = useCallback(async () => {
    setLoading(true);
    const r = await api<{ success: boolean; categories?: RecordCategoryMeta[] }>(
      'GET',
      '/api/admin-records/categories'
    );
    const list = r.categories || [];
    setCategories(list);
    setSelectedCategoryId((prev) => prev || list[0]?.id || '');
    setLoading(false);
  }, []);

  const loadRecords = useCallback(async (categoryId: string, q: string, nextOffset: number) => {
    if (!categoryId) return;
    setRecordsLoading(true);
    const params = new URLSearchParams({
      limit: String(limit),
      offset: String(nextOffset),
    });
    if (q.trim()) params.set('q', q.trim());

    const r = await api<RecordListResponse>(
      'GET',
      `/api/admin-records/${encodeURIComponent(categoryId)}?${params.toString()}`
    );

    if (r.success) {
      setRecords(r.records || []);
      setColumns(r.category?.columns || []);
      setPrimaryKey(r.category?.primaryKey || 'id');
      setTotal(r.total ?? 0);
      setOffset(nextOffset);
    } else {
      setRecords([]);
      setTotal(0);
      setError(r.message || 'Could not load records.');
    }
    setRecordsLoading(false);
  }, []);

  useEffect(() => {
    void loadCategories();
  }, [loadCategories]);

  useEffect(() => {
    if (!selectedCategoryId) return;
    void loadRecords(selectedCategoryId, query, 0);
  }, [selectedCategoryId, query, loadRecords]);

  function runSearch() {
    setQuery(search.trim());
    setOffset(0);
  }

  function buildEditForm(record: Record<string, unknown>) {
    const nextForm: Record<string, string> = {};
    const editable = editableColumns.length ? editableColumns : columns.filter((c) => c.editable);
    for (const column of editable) {
      const value = record[column.key];
      if (value === null || value === undefined) {
        nextForm[column.key] = '';
      } else if (typeof value === 'boolean') {
        nextForm[column.key] = value ? 'true' : 'false';
      } else {
        nextForm[column.key] = String(value);
      }
    }
    return nextForm;
  }

  async function openEdit(record: Record<string, unknown>) {
    if (!selectedCategoryId) return;
    const id = recordId(record, primaryKey);
    setError(null);
    setSaving(false);

    const needsDetailFetch = editableColumns.some((column) => column.type === 'json' && column.editable);
    if (!needsDetailFetch) {
      setSelectedRecord(record);
      setForm(buildEditForm(record));
      setModal('edit');
      return;
    }

    const r = await api<{ success: boolean; record?: Record<string, unknown>; message?: string }>(
      'GET',
      `/api/admin-records/${encodeURIComponent(selectedCategoryId)}/${encodeURIComponent(id)}`
    );

    if (!r.success || !r.record) {
      setError(r.message || 'Could not load record.');
      return;
    }

    setSelectedRecord(r.record);
    setForm(buildEditForm(r.record));
    setModal('edit');
  }

  function openDelete(record: Record<string, unknown>) {
    setSelectedRecord(record);
    setError(null);
    setModal('delete');
  }

  async function saveRecord() {
    if (!selectedCategoryId || !selectedRecord) return;
    const id = recordId(selectedRecord, primaryKey);
    setSaving(true);
    setError(null);

    const body: Record<string, unknown> = {};
    for (const column of editableColumns) {
      if (column.type === 'boolean') {
        body[column.key] = form[column.key] === 'true';
      } else if (column.type === 'number') {
        body[column.key] = form[column.key] === '' ? null : Number(form[column.key]);
      } else if (column.type === 'json') {
        body[column.key] = form[column.key];
      } else {
        body[column.key] = form[column.key];
      }
    }

    const r = await api<{ success: boolean; message?: string }>(
      'PUT',
      `/api/admin-records/${encodeURIComponent(selectedCategoryId)}/${encodeURIComponent(id)}`,
      body
    );

    setSaving(false);
    if (r.success) {
      setModal(null);
      setSelectedRecord(null);
      void loadRecords(selectedCategoryId, query, offset);
    } else {
      setError(r.message || 'Could not save record.');
    }
  }

  async function deleteRecord() {
    if (!selectedCategoryId || !selectedRecord) return;
    const id = recordId(selectedRecord, primaryKey);
    const r = await api<{ success: boolean; message?: string }>(
      'DELETE',
      `/api/admin-records/${encodeURIComponent(selectedCategoryId)}/${encodeURIComponent(id)}`
    );

    if (r.success) {
      setModal(null);
      setSelectedRecord(null);
      setCategories((prev) =>
        prev.map((category) =>
          category.id === selectedCategoryId
            ? { ...category, count: Math.max(0, category.count - 1) }
            : category
        )
      );
      void loadRecords(selectedCategoryId, query, offset);
    } else {
      alert(r.message || 'Could not delete record.');
    }
  }

  const pageStart = total === 0 ? 0 : offset + 1;
  const pageEnd = Math.min(offset + records.length, total);

  return (
    <>
      <p className="text-muted" style={{ marginBottom: 12 }}>
        Browse every database table by category. Edit or delete records to control storage usage.
        Sensitive fields such as password hashes are never shown here.
      </p>

      {loading ? (
        <div className="card"><div className="text-muted">Loading categories…</div></div>
      ) : (
        <div className="database-records-layout">
          <aside className="card database-records-sidebar">
            <div className="card-title">Categories</div>
            <div className="database-records-category-list">
              {categories.map((category) => (
                <button
                  key={category.id}
                  type="button"
                  className={`database-records-category${selectedCategoryId === category.id ? ' is-active' : ''}`}
                  onClick={() => {
                    setSelectedCategoryId(category.id);
                    setOffset(0);
                    setSearch('');
                    setQuery('');
                    setError(null);
                  }}
                >
                  <span>{category.label}</span>
                  <span className="text-muted">{category.count}</span>
                </button>
              ))}
            </div>
          </aside>

          <section className="card database-records-panel">
            <div className="database-records-panel-header">
              <div>
                <div className="card-title">{selectedCategory?.label || 'Records'}</div>
                {selectedCategory?.description ? (
                  <p className="text-muted" style={{ marginTop: 4 }}>{selectedCategory.description}</p>
                ) : null}
              </div>
              <div className="search-row">
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') runSearch();
                  }}
                  placeholder="Search records…"
                />
                <button className="btn btn-ghost" type="button" onClick={runSearch}>Search</button>
              </div>
            </div>

            {error && !modal && <div className="alert alert-error">{error}</div>}

            {recordsLoading ? (
              <div className="text-muted">Loading records…</div>
            ) : (
              <>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        {listColumns.map((column) => (
                          <th key={column.key}>{column.label}</th>
                        ))}
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {records.map((record) => {
                        const id = recordId(record, primaryKey);
                        return (
                          <tr key={id}>
                            {listColumns.map((column) => (
                              <td key={column.key}>{formatCell(record[column.key])}</td>
                            ))}
                            <td style={{ whiteSpace: 'nowrap' }}>
                              <button className="btn btn-ghost btn-sm" type="button" onClick={() => { void openEdit(record); }}>
                                Edit
                              </button>
                              <button className="btn btn-danger btn-sm" type="button" onClick={() => openDelete(record)}>
                                Delete
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                      {!records.length && (
                        <tr>
                          <td colSpan={listColumns.length + 1} className="text-muted">
                            No records in this category.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="database-records-pagination">
                  <span className="text-muted">
                    {total ? `${pageStart}–${pageEnd} of ${total}` : '0 records'}
                  </span>
                  <div className="database-records-pagination-actions">
                    <button
                      className="btn btn-ghost btn-sm"
                      type="button"
                      disabled={offset <= 0}
                      onClick={() => { void loadRecords(selectedCategoryId, query, Math.max(0, offset - limit)); }}
                    >
                      Previous
                    </button>
                    <button
                      className="btn btn-ghost btn-sm"
                      type="button"
                      disabled={offset + limit >= total}
                      onClick={() => { void loadRecords(selectedCategoryId, query, offset + limit); }}
                    >
                      Next
                    </button>
                  </div>
                </div>
              </>
            )}
          </section>
        </div>
      )}

      <Modal
        open={modal === 'edit'}
        title={selectedCategory ? `Edit ${selectedCategory.label}` : 'Edit Record'}
        onClose={() => setModal(null)}
        footer={
          <>
            <button className="btn btn-ghost" type="button" onClick={() => setModal(null)}>Cancel</button>
            <button className="btn btn-primary" type="button" disabled={saving} onClick={() => { void saveRecord(); }}>
              Save
            </button>
          </>
        }
      >
        {editableColumns.map((column) => (
          <div className="form-group" key={column.key}>
            <label>{column.label}</label>
            {column.type === 'boolean' ? (
              <select
                value={form[column.key] ?? 'false'}
                onChange={(e) => setForm({ ...form, [column.key]: e.target.value })}
              >
                <option value="true">Yes</option>
                <option value="false">No</option>
              </select>
            ) : column.type === 'json' ? (
              <textarea
                rows={6}
                value={form[column.key] ?? ''}
                onChange={(e) => setForm({ ...form, [column.key]: e.target.value })}
              />
            ) : (
              <input
                value={form[column.key] ?? ''}
                onChange={(e) => setForm({ ...form, [column.key]: e.target.value })}
              />
            )}
          </div>
        ))}
        {error && <div className="alert alert-error">{error}</div>}
      </Modal>

      <Modal
        open={modal === 'delete'}
        title="Delete Record"
        onClose={() => setModal(null)}
        footer={
          <>
            <button className="btn btn-ghost" type="button" onClick={() => setModal(null)}>Cancel</button>
            <button className="btn btn-danger" type="button" onClick={() => { void deleteRecord(); }}>Delete</button>
          </>
        }
      >
        <p className="confirm-text">
          Delete this record from <strong>{selectedCategory?.label}</strong>?
        </p>
        <p className="confirm-text" style={{ marginTop: 8 }}>
          ID: <strong>{selectedRecord ? recordId(selectedRecord, primaryKey) : '—'}</strong>
        </p>
        <p className="text-muted" style={{ marginTop: 8, fontSize: 12 }}>
          Related rows may be removed automatically when foreign keys use ON DELETE CASCADE.
        </p>
      </Modal>
    </>
  );
}
