// Thin client around the Go REST API. All web mutations + reads route
// through here. The Go service exposes endpoints under `/v1/*` (no
// `/api` prefix) and returns the envelope:
//   - 2xx: typed body
//   - 4xx/5xx: { error: string, message?: string, fieldErrors?: Record<string, string[]> }
//
// Bearer token (issued by the Go login/register flow) is stored in the
// existing iron-session cookie via `auth-cookie.ts` and read here when
// `opts.auth = true`.
//
// ── Language on the wire ─────────────────────────────────────────────────
//
// Every request carries an explicit `?lang=<locale>`, resolved for THIS request
// by `lib/i18n/server.ts` (cookie → stored preference → Accept-Language → `en`).
// Two things depend on it:
//
//  1. Go answers in the language the page is actually rendered in. `?lang=` is
//     level 1 of the server's precedence chain, so it beats both the header and
//     the user's stored row — the two can never disagree with the UI.
//  2. It is the cache key. Next's Data Cache is keyed on the URL, and request
//     HEADERS ARE NOT PART OF IT. A language that travels in a header would let
//     one language's cached response be served to a reader of the other; a
//     language in the URL partitions the cache by construction. This replaces
//     the previous `Accept-Language: 'vi'` constant, which was safe only
//     because it was constant. See `api/catalog.ts` for the request that
//     actually opts into that cache.
//
// (`?lang=` rather than a header also means the value is the EXACT literal the
// app resolved, instead of a header the server has to re-parse with q-weights.)

import { DEFAULT_LOCALE, withLangParam, type Locale } from '@/lib/i18n/locale';
import { getLocale } from '@/lib/i18n/server';
import { translate, translatorFor, type Translator } from '@/lib/i18n/catalog';
import { bearerHeader } from '@/lib/auth-cookie';
import { GO_API_URL } from './base-url';

const BASE_URL = GO_API_URL;

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
  // instead. Only safe for global, non-user-specific data (e.g. the catalog) —
  // and the response must be a pure function of the URL, because the URL is the
  // only part of the request that reaches the cache key. The language is in the
  // URL for exactly that reason.
  next?: { revalidate?: number | false; tags?: string[] };
};

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export async function apiFetch<T>(
  method: Method,
  path: string,
  body?: unknown,
  opts: ApiFetchOpts = {},
): Promise<ApiResult<T>> {
  // One resolution per request (React `cache()`), used for the URL and for any
  // transport-level fallback copy we have to write ourselves.
  const locale = await getLocale();
  const target = path.startsWith('http') ? path : BASE_URL + (path.startsWith('/') ? path : '/' + path);
  const url = withLangParam(target, locale);
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
      message: translate(locale, 'Mất kết nối tới máy chủ, thử lại sau nhé.'),
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
        message: translate(locale, 'Phản hồi từ máy chủ không hợp lệ'),
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

/**
 * Convert an `ApiResult` into the shape expected by `useFormState` callers.
 *
 * A `message` from Go is already rendered in the request's language (the request
 * carried `?lang=`) and is passed through untouched — we never rewrite the
 * server's copy.
 *
 * A `message` supplied by the CALLER is treated as a catalog key: pass the
 * Vietnamese sentence as a literal and it comes out translated, exactly like a
 * call to `t()`. An unregistered sentence is returned as written, i.e. in
 * Vietnamese, which is the same visible fallback the rest of the app uses.
 *
 * Async because it has to resolve the request's language. Server actions can
 * `return toFormState(res)` and let the framework await it.
 */
export async function toFormState<T>(
  res: ApiResult<T>,
  success: { message?: string } = {},
): Promise<FormState> {
  const locale: Locale = await getLocale();
  if (res.ok) {
    return { ok: true, message: success.message ? translate(locale, success.message) : undefined };
  }
  return {
    ok: false,
    errors: res.fieldErrors,
    message: res.message ?? defaultMessageForStatus(res.status, res.error, locale),
  };
}

/**
 * Last-resort copy for a failure the server did not describe — a connection
 * that never landed, or a 5xx with no envelope. The Go service produces its own
 * sentence for everything it actually answers (§ the shared envelope in
 * `internal/httpx`), so these are transport-shaped, not business-shaped.
 */
function defaultMessageForStatus(status: number, code: string, locale: Locale): string {
  const t: Translator = translatorFor(locale ?? DEFAULT_LOCALE);
  if (status === 401) return t('Bạn chưa đăng nhập');
  if (status === 404) return t('Không tìm thấy');
  if (status === 409) return t('Đã đạt giới hạn cho phép');
  if (status === 429) return t('Thao tác quá nhanh, thử lại sau');
  if (status >= 500) return t('Lỗi hệ thống, thử lại sau');
  if (code === 'network_error') return t('Mất kết nối tới máy chủ, thử lại sau nhé.');
  return t('Có lỗi xảy ra, thử lại sau');
}
