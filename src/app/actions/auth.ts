'use server';

import path from 'node:path';
import { rm } from 'node:fs/promises';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { hash, compare } from 'bcrypt-ts';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/session';
import { BCRYPT_ROUNDS } from '@/lib/auth';
import { rateLimitAuth, formatRetry } from '@/lib/rate-limit';

const UPLOAD_ROOT = path.join(process.cwd(), 'public', 'uploads');

export type AuthFormState = {
  ok?: boolean;
  errors?: Record<string, string[]>;
  message?: string;
};

const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email('Email không hợp lệ'),
  name: z.string().trim().max(80).optional().or(z.literal('')),
  password: z.string().min(8, 'Mật khẩu tối thiểu 8 ký tự').max(200),
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Email không hợp lệ'),
  password: z.string().min(1, 'Nhập mật khẩu'),
});

export async function registerUser(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const raw = Object.fromEntries(formData.entries());
  const parsed = registerSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.flatten().fieldErrors };
  }
  const { email, name, password } = parsed.data;

  const rl = await rateLimitAuth('register', email);
  if (!rl.ok) {
    return {
      ok: false,
      message: `Đăng ký quá nhiều lần. Thử lại sau ${formatRetry(rl.retryAfterSec)}.`,
    };
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    // Burn equivalent hash time so response latency does not leak existence.
    await hash(password, BCRYPT_ROUNDS);
    return {
      ok: true,
      message:
        'Nếu email chưa đăng ký, tài khoản đã được tạo. Nếu đã có, vào đăng nhập hoặc quên mật khẩu.',
    };
  }

  const passwordHash = await hash(password, BCRYPT_ROUNDS);
  const user = await prisma.user.create({
    data: { email, name: name || null, passwordHash },
  });

  const session = await getSession();
  session.userId = user.id;
  session.email = user.email;
  session.passwordChangedAt = user.passwordChangedAt.getTime();
  await session.save();

  revalidatePath('/', 'layout');
  redirect('/dashboard');
}

export async function loginUser(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const raw = Object.fromEntries(formData.entries());
  const parsed = loginSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.flatten().fieldErrors };
  }
  const { email, password } = parsed.data;

  const rl = await rateLimitAuth('login', email);
  if (!rl.ok) {
    return {
      ok: false,
      message: `Thử quá nhiều lần. Đợi ${formatRetry(rl.retryAfterSec)} rồi thử lại.`,
    };
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    return { ok: false, message: 'Email hoặc mật khẩu không đúng' };
  }
  const ok = await compare(password, user.passwordHash);
  if (!ok) {
    return { ok: false, message: 'Email hoặc mật khẩu không đúng' };
  }

  const session = await getSession();
  session.userId = user.id;
  session.email = user.email;
  session.passwordChangedAt = user.passwordChangedAt.getTime();
  await session.save();

  revalidatePath('/', 'layout');
  redirect('/dashboard');
}

export async function logoutUser() {
  const session = await getSession();
  session.destroy();
  revalidatePath('/', 'layout');
  redirect('/login');
}

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
  const session = await getSession();
  if (!session.userId) {
    return { ok: false, message: 'Bạn chưa đăng nhập' };
  }

  const rl = await rateLimitAuth('change-password', session.userId);
  if (!rl.ok) {
    return {
      ok: false,
      message: `Thử quá nhiều lần. Đợi ${formatRetry(rl.retryAfterSec)} rồi thử lại.`,
    };
  }

  const raw = Object.fromEntries(formData.entries());
  const parsed = changePasswordSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.flatten().fieldErrors };
  }
  const { currentPassword, newPassword } = parsed.data;

  const user = await prisma.user.findUnique({ where: { id: session.userId } });
  if (!user) return { ok: false, message: 'Phiên đã hết hạn' };

  const ok = await compare(currentPassword, user.passwordHash);
  if (!ok) {
    return { ok: false, errors: { currentPassword: ['Mật khẩu hiện tại không đúng'] } };
  }

  const passwordHash = await hash(newPassword, BCRYPT_ROUNDS);
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash, passwordChangedAt: new Date() },
  });

  // Refresh THIS session so the user isn't logged out of the device they
  // just used to change the password. Other devices' cookies become stale.
  session.passwordChangedAt = updated.passwordChangedAt.getTime();
  await session.save();

  return { ok: true, message: 'Đã đổi mật khẩu thành công' };
}

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
  const session = await getSession();
  if (!session.userId) {
    return { ok: false, message: 'Bạn chưa đăng nhập' };
  }

  const rl = await rateLimitAuth('change-password', session.userId);
  if (!rl.ok) {
    return {
      ok: false,
      message: `Thử quá nhiều lần. Đợi ${formatRetry(rl.retryAfterSec)} rồi thử lại.`,
    };
  }

  const raw = Object.fromEntries(formData.entries());
  const parsed = deleteAccountSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.flatten().fieldErrors };
  }

  const user = await prisma.user.findUnique({ where: { id: session.userId } });
  if (!user) return { ok: false, message: 'Phiên đã hết hạn' };

  const ok = await compare(parsed.data.password, user.passwordHash);
  if (!ok) {
    return { ok: false, errors: { password: ['Mật khẩu không đúng'] } };
  }

  // Snapshot device IDs so we can rm their upload dirs after the cascade.
  const devices = await prisma.device.findMany({
    where: { userId: user.id },
    select: { id: true },
  });

  // Cascade removes Device, Attachment, Reminder, PushSubscription, PasswordReset.
  await prisma.user.delete({ where: { id: user.id } });

  for (const d of devices) {
    if (!/^[a-z0-9_-]+$/i.test(d.id)) continue;
    const dir = path.resolve(UPLOAD_ROOT, d.id);
    if (dir.startsWith(path.resolve(UPLOAD_ROOT) + path.sep)) {
      await rm(dir, { recursive: true, force: true }).catch(() => void 0);
    }
  }

  session.destroy();
  revalidatePath('/', 'layout');
  redirect('/');
}
