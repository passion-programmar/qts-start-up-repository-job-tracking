import {
  LEGACY_TOKEN_STORAGE_KEY,
  TOKEN_STORAGE_KEY,
} from '@/lib/branding';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '';

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  let token = localStorage.getItem(TOKEN_STORAGE_KEY);
  if (!token) {
    token = localStorage.getItem(LEGACY_TOKEN_STORAGE_KEY);
    if (token) {
      localStorage.setItem(TOKEN_STORAGE_KEY, token);
      localStorage.removeItem(LEGACY_TOKEN_STORAGE_KEY);
    }
  }
  return token;
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_STORAGE_KEY, token);
  localStorage.removeItem(LEGACY_TOKEN_STORAGE_KEY);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_STORAGE_KEY);
  localStorage.removeItem(LEGACY_TOKEN_STORAGE_KEY);
}

export async function api<T = unknown>(
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const token = getToken();
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    return { success: false, message: 'Cannot connect to the API server.' } as T;
  }

  let data: T;
  try {
    data = await res.json() as T;
  } catch {
    return { success: false, message: `Request failed (${res.status}).` } as T;
  }

  if (!res.ok) {
    const message =
      typeof data === 'object' && data !== null && 'message' in data && typeof (data as { message: unknown }).message === 'string'
        ? (data as { message: string }).message
        : `Request failed (${res.status}).`;
    return { success: false, message, ...(typeof data === 'object' && data !== null ? data : {}) } as T;
  }

  return data;
}
