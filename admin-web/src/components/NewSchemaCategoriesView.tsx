'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/components/AuthProvider';
import type { NewSchemaCategory } from '@/lib/types';

export function NewSchemaCategoriesView() {
  const { user } = useAuth();
  const [categories, setCategories] = useState<NewSchemaCategory[]>([]);
  const [title, setTitle] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const result = await api<{ success: boolean; categories?: NewSchemaCategory[] }>(
      'GET',
      '/api/v2/categories'
    );
    if (result.success) setCategories(result.categories || []);
    else setError('Could not load categories.');
    setLoading(false);
  }, []);

  useEffect(() => {
    // Load categories once the page mounts.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = editingId
      ? await api<{ success: boolean; message?: string }>('PUT', `/api/v2/categories/${editingId}`, { categoryTitle: title.trim() })
      : await api<{ success: boolean; message?: string }>('POST', '/api/v2/categories', { categoryTitle: title.trim() });
    if (!result.success) {
      setError(result.message || 'Could not save category.');
      return;
    }
    setTitle('');
    setEditingId(null);
    setError(null);
    await load();
  }

  async function remove(category: NewSchemaCategory) {
    if (!window.confirm(`Delete category "${category.category_title}"?`)) return;
    const result = await api<{ success: boolean; message?: string }>('DELETE', `/api/v2/categories/${category.category_id}`);
    if (!result.success) setError(result.message || 'Could not delete category.');
    else await load();
  }

  return (
    <>
      {error && <div className="alert alert-error">{error}</div>}
      {user?.role === 'super' && (
        <form className="search-row" onSubmit={(event) => { void save(event); }}>
          <input aria-label="Category name" required value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Category name" />
          <button className="btn btn-primary" type="submit">{editingId ? 'Save Category' : 'Add Category'}</button>
          {editingId && <button className="btn btn-ghost" type="button" onClick={() => { setEditingId(null); setTitle(''); }}>Cancel</button>}
        </form>
      )}
      <div className="card">
        {loading ? <div className="text-muted">Loading…</div> : (
          <div className="table-scroll"><table>
            <thead><tr><th>Category</th>{user?.role === 'super' && <th />}</tr></thead>
            <tbody>{categories.map((category) => (
              <tr key={category.category_id}>
                <td>{category.category_title}</td>
                {user?.role === 'super' && <td className="text-right">
                  <button className="btn btn-ghost btn-sm" type="button" onClick={() => { setEditingId(category.category_id); setTitle(category.category_title); }}>Edit</button>
                  <button className="btn btn-danger btn-sm" type="button" onClick={() => { void remove(category); }}>Delete</button>
                </td>}
              </tr>
            ))}{!categories.length && <tr><td colSpan={2} className="text-muted">No categories added.</td></tr>}</tbody>
          </table></div>
        )}
      </div>
    </>
  );
}
