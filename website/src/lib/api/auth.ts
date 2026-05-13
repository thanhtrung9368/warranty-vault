// Typed auth methods that hit the Go service `/v1/auth/*`.
//
// Response shapes mirror `openapi.yaml` and the actual Go handlers in
// `api/internal/handlers/auth.go`. All Vietnamese error messages are
// produced by the Go service — we don't rewrite them.

import { apiFetch, type ApiResult } from './client';

export type AuthUser = {
  id: string;
  email: string;
  name: string | null;
};

export type AuthSuccess = {
  accessToken: string;
  // RFC3339 string from Go.
  expiresAt: string;
  user: AuthUser;
};

// `register` may return either a 201 AuthSuccess (new account) or a 200
// generic `{ ok, message }` body when the email is already taken — the Go
// handler intentionally never reveals which. We fold both into the same
// discriminated shape so callers can tell them apart.
export type RegisterResponse =
  | { kind: 'created'; payload: AuthSuccess }
  | { kind: 'ambiguous'; message: string };

export async function login(
  email: string,
  password: string,
  opts: { deviceLabel?: string; platform?: 'web' } = {},
): Promise<ApiResult<AuthSuccess>> {
  return apiFetch<AuthSuccess>(
    'POST',
    '/v1/auth/login',
    {
      email,
      password,
      deviceLabel: opts.deviceLabel,
      platform: opts.platform ?? 'web',
    },
    { auth: false },
  );
}

export async function register(
  email: string,
  password: string,
  name?: string | null,
  opts: { deviceLabel?: string; platform?: 'web' } = {},
): Promise<ApiResult<RegisterResponse>> {
  // We need the raw status to discriminate 201 (created) from 200 (taken).
  // `apiFetch` swallows the status on success, so use a custom branch here.
  const base = (process.env.GO_API_URL ?? 'http://localhost:4000').replace(/\/+$/, '');
  let res: Response;
  try {
    res = await fetch(`${base}/v1/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        password,
        name: name ?? undefined,
        deviceLabel: opts.deviceLabel,
        platform: opts.platform ?? 'web',
      }),
      cache: 'no-store',
    });
  } catch (err) {
    return {
      ok: false,
      status: 0,
      error: 'network_error',
      message:
        err instanceof Error
          ? `Không kết nối được tới máy chủ: ${err.message}`
          : 'Không kết nối được tới máy chủ',
    };
  }

  if (res.status === 201) {
    const data = (await res.json()) as AuthSuccess;
    return { ok: true, data: { kind: 'created', payload: data } };
  }
  if (res.status === 200) {
    const body = (await res.json()) as { ok?: boolean; message?: string };
    return {
      ok: true,
      data: {
        kind: 'ambiguous',
        message:
          body.message ??
          'Nếu email chưa đăng ký, tài khoản đã được tạo. Nếu đã có, vào đăng nhập hoặc quên mật khẩu.',
      },
    };
  }
  // Error path — read envelope.
  let parsed: { error?: string; message?: string; fieldErrors?: Record<string, string[]> } = {};
  try {
    parsed = await res.json();
  } catch {
    // ignore
  }
  return {
    ok: false,
    status: res.status,
    error: parsed.error ?? `http_${res.status}`,
    message: parsed.message,
    fieldErrors: parsed.fieldErrors,
  };
}

export async function logout(): Promise<ApiResult<{ ok: true }>> {
  return apiFetch<{ ok: true }>('POST', '/v1/auth/logout');
}

export async function me(): Promise<ApiResult<{ user: AuthUser }>> {
  return apiFetch<{ user: AuthUser }>('GET', '/v1/auth/me');
}

export async function forgot(email: string): Promise<ApiResult<{ ok: true }>> {
  return apiFetch<{ ok: true }>('POST', '/v1/auth/forgot', { email }, { auth: false });
}

export async function changePassword(
  currentPassword: string,
  newPassword: string,
  confirmPassword: string,
): Promise<ApiResult<{ ok: boolean; message: string }>> {
  return apiFetch<{ ok: boolean; message: string }>('POST', '/v1/auth/change-password', {
    currentPassword,
    newPassword,
    confirmPassword,
  });
}

// TODO(phase-F): Go service does not yet expose POST /v1/auth/reset.
// The TS server action `resetPassword` in `actions/password-reset.ts` keeps
// hitting Prisma directly until the Go endpoint lands. This stub is here so
// the auth namespace shape mirrors the eventual API surface.
export async function resetPassword(
  _token: string,
  _password: string,
  _confirm: string,
): Promise<ApiResult<{ ok: true }>> {
  return {
    ok: false,
    status: 501,
    error: 'not_implemented',
    message: 'Go API chưa hỗ trợ reset mật khẩu. Dùng TS server action.',
  };
}
