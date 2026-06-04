// Thin client around the Go REST API. All web mutations + reads route
// through here. The Go service exposes endpoints under `/v1/*` (no
// `/api` prefix) and returns the envelope:
//   - 2xx: typed body
//   - 4xx/5xx: { error: string, message?: string, fieldErrors?: Record<string, string[]> }
//
// Bearer token (issued by the Go login/register flow) is stored in the
// existing iron-session cookie via `auth-cookie.ts` and read here when
// `opts.auth = true`.

import { bearerHeader } from '@/lib/auth-cookie';

const BASE_URL = (process.env.GO_API_URL ?? 'http://localhost:4000').replace(/\/+$/, '');

export type ApiSuccess<T> = { ok: true; data: T };
export type ApiError = {
  ok: false;
  status: number;
  error: string;
  message?: string;
  fieldErrors?: Record<string, string[]>;
};
export type ApiResult<T> = ApiSuccess<T> | ApiError;

export type FormState = {
  ok?: boolean;
  errors?: Record<string, string[]>;
  message?: string;
};

export type ApiFetchOpts = {
  // Attach `Authorization: Bearer <token>` from the auth cookie. Defaults to true.
  auth?: boolean;
  // Body is FormData (multipart upload). Skip JSON encoding + Content-Type.
  multipart?: boolean;
  // AbortSignal for cancellation.
  signal?: AbortSignal;
  // Extra headers, merged after auth + content-type.
  headers?: Record<string, string>;
  // Opt into Next's Data Cache for this request. When set, the default
  // `cache: 'no-store'` is dropped and `next: { revalidate, tags }` is used
  // instead. Only safe for global, non-user-specific data (e.g. the catalog).
  next?: { revalidate?: number | false; tags?: string[] };
};

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export async function apiFetch<T>(
  method: Method,
  path: string,
  body?: unknown,
  opts: ApiFetchOpts = {},
): Promise<ApiResult<T>> {
  const url = path.startsWith('http') ? path : BASE_URL + (path.startsWith('/') ? path : '/' + path);
  const headers: Record<string, string> = {};

  // Default to authenticated requests; explicit `auth: false` skips.
  const wantAuth = opts.auth !== false;
  if (wantAuth) {
    Object.assign(headers, await bearerHeader());
  }

  let payload: BodyInit | undefined;
  if (body !== undefined && body !== null) {
    if (opts.multipart) {
      // Caller passed a FormData. Don't set Content-Type — fetch fills the
      // boundary automatically.
      payload = body as FormData;
    } else {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
  }

  if (opts.headers) Object.assign(headers, opts.headers);

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: payload,
      signal: opts.signal,
      // Server-side fetch from a Next server action; never cache by default.
      // Callers can opt a request into the Data Cache via `opts.next` — used
      // for global, non-user-specific reads like the admin catalog.
      ...(opts.next ? { next: opts.next } : { cache: 'no-store' as const }),
    });
  } catch (err) {
    // Log the raw transport error server-side for debugging; never surface the
    // technical detail (e.g. "fetch failed", "ECONNREFUSED") to end users.
    console.error(`[api] ${method} ${url} failed:`, err);
    return {
      ok: false,
      status: 0,
      error: 'network_error',
      message: 'Mất kết nối tới máy chủ, thử lại sau nhé.',
    };
  }

  // Empty body? Treat as success when 2xx, error otherwise.
  const ct = res.headers.get('content-type') ?? '';
  const isJson = ct.includes('application/json');

  if (res.ok) {
    if (res.status === 204 || !isJson) {
      return { ok: true, data: undefined as unknown as T };
    }
    try {
      const data = (await res.json()) as T;
      return { ok: true, data };
    } catch {
      return {
        ok: false,
        status: res.status,
        error: 'bad_response',
        message: 'Phản hồi từ máy chủ không hợp lệ',
      };
    }
  }

  // Error path. Attempt to parse the standard envelope.
  let parsed: { error?: string; message?: string; fieldErrors?: Record<string, string[]> } = {};
  if (isJson) {
    try {
      parsed = await res.json();
    } catch {
      // fall through with empty parsed
    }
  }
  return {
    ok: false,
    status: res.status,
    error: parsed.error ?? `http_${res.status}`,
    message: parsed.message,
    fieldErrors: parsed.fieldErrors,
  };
}

// Convert an ApiResult into the shape expected by `useFormState` callers.
// Vietnamese strings come from the Go service unchanged; we don't rewrite them.
export function toFormState<T>(
  res: ApiResult<T>,
  success: { message?: string } = {},
): FormState {
  if (res.ok) {
    return { ok: true, message: success.message };
  }
  return {
    ok: false,
    errors: res.fieldErrors,
    message: res.message ?? defaultMessageForStatus(res.status, res.error),
  };
}

function defaultMessageForStatus(status: number, code: string): string {
  if (status === 401) return 'Bạn chưa đăng nhập';
  if (status === 404) return 'Không tìm thấy';
  if (status === 409) return 'Đã đạt giới hạn cho phép';
  if (status === 429) return 'Thao tác quá nhanh, thử lại sau';
  if (status >= 500) return 'Lỗi hệ thống, thử lại sau';
  if (code === 'network_error') return 'Mất kết nối tới máy chủ, thử lại sau nhé.';
  return 'Có lỗi xảy ra, thử lại sau';
}
