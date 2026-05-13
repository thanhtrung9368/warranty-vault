'use server';

import path from 'node:path';
import { rm } from 'node:fs/promises';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { compare } from 'bcrypt-ts';
import { prisma } from '@/lib/prisma';
import { api, toFormState } from '@/lib/api';
import {
  setAuthCookie,
  destroyAuthCookie,
  getAuthCookie,
} from '@/lib/auth-cookie';

// TODO(phase-F): account deletion is not yet exposed by the Go service.
// Until `DELETE /v1/users/me` (or similar) lands, `deleteAccount` keeps
// hitting Prisma directly. The disk cleanup of `public/uploads/<deviceId>`
// also moves to Go in Phase F (the file path is a leftover from the
// pre-encrypted-attachments era).
const UPLOAD_ROOT = path.join(process.cwd(), 'public', 'uploads');

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

  const res = await api.auth.register(email, password, name || null);
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

  const res = await api.auth.login(email, password);
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

// ---- delete account --------------------------------------------------------
// TODO(phase-F): port to Go (DELETE /v1/users/me or similar). For now this
// keeps the Prisma path so users can still close their account.

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
  // Need an authenticated user. Resolve via the new cookie+me() flow, then
  // load the prisma row to verify the password locally (Go does not yet
  // expose an account-delete endpoint).
  const meRes = await api.auth.me();
  if (!meRes.ok) {
    return { ok: false, message: 'Bạn chưa đăng nhập' };
  }
  const userId = meRes.data.user.id;

  const raw = Object.fromEntries(formData.entries());
  const parsed = deleteAccountSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, errors: fieldErrorsFromZod(parsed.error) };
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return { ok: false, message: 'Phiên đã hết hạn' };

  const ok = await compare(parsed.data.password, user.passwordHash);
  if (!ok) {
    return { ok: false, errors: { password: ['Mật khẩu không đúng'] } };
  }

  // Snapshot device IDs so we can rm their (legacy) upload dirs after the
  // cascade. Encrypted blobs under PRIVATE_UPLOAD_ROOT are handled by
  // attachment cascade in Phase F's Go endpoint.
  const devices = await prisma.device.findMany({
    where: { userId: user.id },
    select: { id: true },
  });

  await prisma.user.delete({ where: { id: user.id } });

  for (const d of devices) {
    if (!/^[a-z0-9_-]+$/i.test(d.id)) continue;
    const dir = path.resolve(UPLOAD_ROOT, d.id);
    if (dir.startsWith(path.resolve(UPLOAD_ROOT) + path.sep)) {
      await rm(dir, { recursive: true, force: true }).catch(() => void 0);
    }
  }

  await destroyAuthCookie();
  revalidatePath('/', 'layout');
  redirect('/');
}
