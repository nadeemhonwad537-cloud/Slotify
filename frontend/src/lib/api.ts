/**
 * Typed API client for Slotify backend.
 *
 * - All requests go through /api (proxied to localhost:4000 in dev).
 * - CSRF token is fetched once and cached; refreshed after 401/403 CSRF errors.
 * - Cookies are sent with every request (credentials: 'include').
 * - Response envelope: { success: true, data } | { success: false, error: { code, message, details? } }
 */

export interface ApiError {
  code: string;
  message: string;
  details?: unknown;
}

export class ApiRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly error: ApiError,
  ) {
    super(error.message);
    this.name = 'ApiRequestError';
  }
}

// ---------------------------------------------------------------------------
// CSRF management
// ---------------------------------------------------------------------------
let _csrfToken: string | null = null;

export async function fetchCsrfToken(): Promise<string> {
  const res = await fetch('/api/auth/csrf', { credentials: 'include' });
  const json = await res.json();
  _csrfToken = json.data.csrfToken as string;
  return _csrfToken;
}

async function getCsrf(): Promise<string> {
  if (!_csrfToken) return fetchCsrfToken();
  return _csrfToken;
}

export function clearCsrfToken() {
  _csrfToken = null;
}

// ---------------------------------------------------------------------------
// Core request function
// ---------------------------------------------------------------------------
async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  retrying = false,
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  const isMutating = !['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase());
  if (isMutating) {
    headers['x-csrf-token'] = await getCsrf();
  }

  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'include',
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  // If CSRF invalid and we haven't retried, refresh the token and retry once
  if ((res.status === 403) && !retrying) {
    const json = await res.json().catch(() => ({}));
    if (json?.error?.code === 'CSRF') {
      _csrfToken = null;
      return request<T>(method, path, body, true);
    }
  }

  const json = await res.json().catch(() => ({
    success: false,
    error: { code: 'PARSE_ERROR', message: 'Invalid server response' },
  }));

  if (!json.success) {
    throw new ApiRequestError(res.status, json.error as ApiError);
  }

  return json.data as T;
}

// ---------------------------------------------------------------------------
// Convenience methods
// ---------------------------------------------------------------------------
export const api = {
  get:    <T>(path: string)                  => request<T>('GET',    path),
  post:   <T>(path: string, body?: unknown)  => request<T>('POST',   path, body),
  put:    <T>(path: string, body?: unknown)  => request<T>('PUT',    path, body),
  patch:  <T>(path: string, body?: unknown)  => request<T>('PATCH',  path, body),
  delete: <T>(path: string)                  => request<T>('DELETE', path),
};

// ---------------------------------------------------------------------------
// List response helper (unwraps meta)
// ---------------------------------------------------------------------------
export interface ListResponse<T> {
  data: T[];
  meta: { total: number; limit: number; offset: number };
}

export async function listRequest<T>(path: string): Promise<ListResponse<T>> {
  const res = await fetch(`/api${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
  });
  const json = await res.json();
  if (!json.success) throw new ApiRequestError(res.status, json.error);
  return { data: json.data, meta: json.meta ?? { total: json.data?.length ?? 0, limit: 100, offset: 0 } };
}
