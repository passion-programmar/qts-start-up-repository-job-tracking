'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { api } from '@/lib/api';

interface BrowseTable {
  id: string;
  label: string;
  description: string;
  count: number;
}

interface BrowseResult {
  success: boolean;
  message?: string;
  table?: BrowseTable & { columns: string[] };
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

  const pageStart = total ? offset + 1 : 0;
  const pageEnd = Math.min(offset + records.length, total);

  if (user?.role !== 'super') {
    return <div className="alert alert-error">Only Super users can browse database tables.</div>;
  }

  return (
    <>
      <p className="text-muted" style={{ marginBottom: 12 }}>
        Browse searchable, read-only application tables. Password hashes, settings, and application-session data are excluded.
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
                      <tr>{tableInfo?.columns.map((column) => <th key={column}>{column.replaceAll('_', ' ')}</th>)}</tr>
                    </thead>
                    <tbody>
                      {records.map((record, index) => (
                        <tr key={String(record[tableInfo?.columns[0] || 'id'] ?? index)}>
                          {tableInfo?.columns.map((column) => {
                            const value = displayValue(record[column]);
                            return <td key={column} title={value}>{value.length > 120 ? `${value.slice(0, 117)}…` : value}</td>;
                          })}
                        </tr>
                      ))}
                      {!records.length && <tr><td colSpan={tableInfo?.columns.length || 1} className="text-muted">No records found.</td></tr>}
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
    </>
  );
}
