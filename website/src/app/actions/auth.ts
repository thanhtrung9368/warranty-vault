'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { z } from 'zod';
import { api, toFormState } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { deviceLabelFromUserAgent } from '@/lib/sessions';
import {
  setAuthCookie,
  destroyAuthCookie,
  getAuthCookie,
} from '@/lib/auth-cookie';

export type AuthFormState = {
  ok?: boolean;
  errors?: Record<string, string[]>;
  message?: string;
};

// ---- helpers ---------------------------------------------------------------

function fieldErrorsFromZod(err: z.ZodError): Record<string, string[]> {
  return err.flatten().fieldErrors as Record<string, string[]>;
}

function rfc3339ToMillis(s: string): number {
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : Date.now() + 24 * 3600 * 1000;
}

// The label Go stores on the new Session row. Sending it is what makes the
// settings "Phiên đăng nhập" list readable: without it every web session
// rendered the documented null fallback ("Không rõ thiết bị"), because the web
// was the one client that never passed `deviceLabel` at login.
//
// Derived from the request's User-Agent (pure, unit-tested in `lib/sessions`),
// never from user input, and kept under the 80-byte cap Go enforces.
async function currentDeviceLabel(): Promise<string> {
  const h = await headers();
  return deviceLabelFromUserAgent(h.get('user-agent'));
}

// ---- register --------------------------------------------------------------

const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email('Email không hợp lệ'),
  name: z.string().trim().max(80).optional().or(z.literal('')),
  password: z.string().min(8, 'Mật khẩu tối thiểu 8 ký tự').max(200),
});

export async function registerUser(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const raw = Object.fromEntries(formData.entries());
  const parsed = registerSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, errors: fieldErrorsFromZod(parsed.error) };
  }
  const { email, name, password } = parsed.data;

  // Register also mints a session, so it gets a label for the same reason login
  // does (see `currentDeviceLabel`).
  const res = await api.auth.register(email, password, name || null, {
    deviceLabel: await currentDeviceLabel(),
  });
  if (!res.ok) {
    return toFormState(res);
  }

  if (res.data.kind === 'ambiguous') {
    // Email already taken — Go returned a generic 200 to prevent enumeration.
    return { ok: true, message: res.data.message };
  }

  const { accessToken, expiresAt } = res.data.payload;
  await setAuthCookie({
    accessToken,
    expiresAt: rfc3339ToMillis(expiresAt),
  });

  revalidatePath('/', 'layout');
  redirect('/dashboard');
}

// ---- login -----------------------------------------------------------------

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Email không hợp lệ'),
  password: z.string().min(1, 'Nhập mật khẩu'),
});

export async function loginUser(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const raw = Object.fromEntries(formData.entries());
  const parsed = loginSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, errors: fieldErrorsFromZod(parsed.error) };
  }
  const { email, password } = parsed.data;

  const res = await api.auth.login(email, password, {
    deviceLabel: await currentDeviceLabel(),
  });
  if (!res.ok) {
    // Map the Go `invalid_credentials` error code to the same Vietnamese
    // string the previous TS action returned. Go returns it already, but
    // keep this fallback in case the message ever drops.
    if (res.status === 401) {
      return { ok: false, message: res.message ?? 'Email hoặc mật khẩu không đúng' };
    }
    return toFormState(res);
  }

  await setAuthCookie({
    accessToken: res.data.accessToken,
    expiresAt: rfc3339ToMillis(res.data.expiresAt),
  });

  revalidatePath('/', 'layout');
  redirect('/dashboard');
}

// ---- logout ----------------------------------------------------------------

export async function logoutUser() {
  // Best-effort: tell Go to revoke the token. Even if that fails (network
  // error, already revoked, etc.) we still drop the cookie locally so the
  // user is logged out in the browser.
  const c = await getAuthCookie();
  if (c.accessToken) {
    await api.auth.logout().catch(() => undefined);
  }
  await destroyAuthCookie();
  revalidatePath('/', 'layout');
  redirect('/login');
}

// ---- change password -------------------------------------------------------

const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Nhập mật khẩu hiện tại'),
    newPassword: z.string().min(8, 'Mật khẩu mới tối thiểu 8 ký tự').max(200),
    confirmPassword: z.string().min(1),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: 'Xác nhận mật khẩu không khớp',
    path: ['confirmPassword'],
  });

export async function changePassword(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const raw = Object.fromEntries(formData.entries());
  const parsed = changePasswordSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, errors: fieldErrorsFromZod(parsed.error) };
  }
  const { currentPassword, newPassword, confirmPassword } = parsed.data;

  const res = await api.auth.changePassword(currentPassword, newPassword, confirmPassword);
  if (!res.ok) {
    return toFormState(res);
  }
  return { ok: true, message: res.data.message ?? 'Đã đổi mật khẩu thành công' };
}

// ---- update profile --------------------------------------------------------
//
// Thin proxy over PATCH /v1/auth/me. `displayName` is the only mutable field:
// the account email is deliberately not changeable (it needs a two-step
// verification flow), so there is no email input in the UI and we never send
// one. An empty input is a *valid* request that clears the name, which is why
// the key is always sent — only a structurally missing field is rejected here.
//
// The 80-byte UTF-8 cap is enforced in Go (a byte cap: ~26 Vietnamese
// characters). We deliberately do not pre-validate a character count — the
// server's Vietnamese fieldErrors are surfaced verbatim.

export async function updateProfile(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  await requireUser();

  const raw = formData.get('displayName');
  if (typeof raw !== 'string') {
    // The contract requires the key; an absent field is a programming error,
    // not a request to clear the name.
    return { ok: false, message: 'Thiếu tên hiển thị' };
  }

  const res = await api.auth.updateProfile(raw);
  if (!res.ok) {
    return toFormState(res);
  }

  // The name is rendered in the app shell (topbar / user menu) and on the
  // dashboard, so revalidate the root layout — the same broad call the
  // login/register/logout flows use.
  revalidatePath('/', 'layout');

  return { ok: true, message: res.data.message ?? 'Đã cập nhật hồ sơ' };
}

// ---- delete account --------------------------------------------------------
//
// Thin proxy over DELETE /v1/auth/me. The Go service verifies the password
// inside the same handler, cascades the user's owned rows, and best-effort
// removes the on-disk encrypted attachments.

const DELETE_CONFIRM_PHRASE = 'XOA TAI KHOAN';

const deleteAccountSchema = z.object({
  password: z.string().min(1, 'Nhập mật khẩu để xác nhận'),
  confirm: z.literal(DELETE_CONFIRM_PHRASE, {
    errorMap: () => ({ message: `Gõ chính xác "${DELETE_CONFIRM_PHRASE}" để xác nhận` }),
  }),
});

export async function deleteAccount(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const raw = Object.fromEntries(formData.entries());
  const parsed = deleteAccountSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, errors: fieldErrorsFromZod(parsed.error) };
  }

  const res = await api.auth.deleteMe(parsed.data.password);
  if (!res.ok) {
    if (res.status === 401) {
      return { ok: false, message: 'Bạn chưa đăng nhập' };
    }
    if (res.fieldErrors) {
      return { ok: false, errors: res.fieldErrors, message: res.message };
    }
    return toFormState(res);
  }

  await destroyAuthCookie();
  revalidatePath('/', 'layout');
  redirect('/');
}
