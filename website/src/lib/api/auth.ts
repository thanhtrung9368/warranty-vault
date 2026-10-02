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
  aiOptIn?: boolean;
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
    console.error('[api] auth request failed:', err);
    return {
      ok: false,
      status: 0,
      error: 'network_error',
      message: 'Mất kết nối tới máy chủ, thử lại sau nhé.',
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

// `PATCH /v1/auth/me` — profile update. `displayName` is the ONLY accepted
// field (the account email cannot be changed here; sending `email`/`newEmail`
// is a 400 from Go). `null` / `""` / whitespace-only clears the name — the
// server trims and maps blanks to SQL NULL on purpose, so the caller must keep
// sending the key even when the user emptied the input. The 80-byte UTF-8 cap
// is validated in Go (a byte cap, not a character cap) and its Vietnamese
// message is surfaced unchanged; we never pre-validate it here.
export async function updateProfile(
  displayName: string | null,
): Promise<ApiResult<{ user: AuthUser; message?: string }>> {
  return apiFetch<{ user: AuthUser; message?: string }>('PATCH', '/v1/auth/me', {
    displayName,
  });
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

// Confirms a password-reset request. Posts the raw token + new password to
// Go; the service hashes the token, locates the PasswordReset row, swaps
// the user's password hash, marks every outstanding reset row used, and
// revokes all of the user's sessions — all transactionally.
export async function resetPassword(
  token: string,
  newPassword: string,
): Promise<ApiResult<{ ok: boolean; message?: string }>> {
  return apiFetch<{ ok: boolean; message?: string }>(
    'POST',
    '/v1/auth/reset-password',
    { token, newPassword },
    { auth: false },
  );
}

// Permanently deletes the authenticated user. Requires the current password
// in the body for confirmation (defense in depth: even with a stolen bearer
// token an attacker still needs the password). The Go service cascades the
// owned rows (Device / Subscription / Wishlist / Session / PasswordReset)
// and best-effort purges the on-disk encrypted attachments.
export async function deleteMe(
  password: string,
): Promise<ApiResult<{ ok: boolean; message?: string }>> {
  return apiFetch<{ ok: boolean; message?: string }>('DELETE', '/v1/auth/me', { password });
}
