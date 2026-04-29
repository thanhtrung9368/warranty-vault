'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth';
import { rateLimitUserWrite, formatRetry } from '@/lib/rate-limit';
import {
  BILLING_CYCLES,
  SUBSCRIPTION_STATUSES,
  nextRenewalDate,
  type BillingCycle,
} from '@/lib/subscription-types';

const MAX_SUBS_PER_USER = 100;

const blankToNull = (v: unknown) => (v === '' || v == null ? null : v);

const optionalInt = (opts?: { min?: number; max?: number }) =>
  z.preprocess(
    blankToNull,
    z.coerce
      .number()
      .int()
      .min(opts?.min ?? 0)
      .max(opts?.max ?? Number.MAX_SAFE_INTEGER)
      .nullable(),
  );

const optionalUrl = z.preprocess(
  blankToNull,
  z.string().trim().url('URL không hợp lệ').nullable(),
);

const subscriptionSchema = z.object({
  name: z.string().trim().min(1, 'Tên gói bắt buộc').max(200),
  category: z.string().trim().optional().nullable(),
  brand: z.string().trim().optional().nullable(),
  plan: z.string().trim().optional().nullable(),
  billingCycle: z.enum(BILLING_CYCLES),
  intervalDays: optionalInt({ min: 1, max: 3650 }),
  price: z.coerce.number().int().nonnegative(),
  startedAt: z.string().min(1, 'Ngày bắt đầu bắt buộc'),
  renewalDate: z.string().optional().nullable(),
  autoRenew: z.preprocess((v) => v === 'on' || v === 'true' || v === true, z.boolean()),
  status: z.enum(SUBSCRIPTION_STATUSES).default('ACTIVE'),
  accountEmail: z.string().trim().optional().nullable(),
  paymentMethod: z.string().trim().optional().nullable(),
  manageUrl: optionalUrl,
  cancelUrl: optionalUrl,
  notes: z.string().trim().optional().nullable(),
});

export type SubscriptionFormState = {
  ok?: boolean;
  errors?: Record<string, string[]>;
  message?: string;
};

function nullify<T extends Record<string, unknown>>(obj: T) {
  const out: Record<string, unknown> = { ...obj };
  for (const k of Object.keys(out)) {
    if (out[k] === '' || out[k] === undefined) out[k] = null;
  }
  return out;
}

async function assertCategoryIfProvided(code?: string | null): Promise<SubscriptionFormState | null> {
  if (!code) return null;
  const found = await prisma.category.findFirst({
    where: { code, isActive: true },
    select: { code: true },
  });
  if (!found) {
    return { ok: false, errors: { category: ['Loại không hợp lệ'] } };
  }
  return null;
}

export async function createSubscription(
  _prev: SubscriptionFormState,
  formData: FormData,
): Promise<SubscriptionFormState> {
  const user = await requireUser();
  const rl = await rateLimitUserWrite(user.id);
  if (!rl.ok) {
    return { ok: false, message: `Thao tác quá nhanh. Đợi ${formatRetry(rl.retryAfterSec)}.` };
  }

  const raw = Object.fromEntries(formData.entries());
  const parsed = subscriptionSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.flatten().fieldErrors };
  }
  const data = parsed.data;

  const catErr = await assertCategoryIfProvided(data.category);
  if (catErr) return catErr;

  if (data.billingCycle === 'CUSTOM' && !data.intervalDays) {
    return {
      ok: false,
      errors: { intervalDays: ['Cần nhập số ngày khi chọn chu kỳ Tuỳ chỉnh'] },
    };
  }

  const count = await prisma.subscription.count({ where: { userId: user.id } });
  if (count >= MAX_SUBS_PER_USER) {
    return {
      ok: false,
      message: `Đã đạt giới hạn ${MAX_SUBS_PER_USER} gói. Xoá bớt rồi thử lại.`,
    };
  }

  const startedAt = new Date(data.startedAt);
  const renewalDate = data.renewalDate
    ? new Date(data.renewalDate)
    : nextRenewalDate(startedAt, data.billingCycle, data.intervalDays);

  const fromWishlistId = formData.get('fromWishlistId');

  const cleaned = nullify({
    ...data,
    startedAt: undefined,
    renewalDate: undefined,
  }) as Record<string, unknown>;

  const created = await prisma.subscription.create({
    data: {
      ...cleaned,
      userId: user.id,
      startedAt,
      renewalDate,
    } as never,
  });

  // If created from a wishlist seed, mark it purchased + back-reference.
  if (typeof fromWishlistId === 'string' && /^[a-z0-9_-]+$/i.test(fromWishlistId)) {
    const own = await prisma.wishlistItem.findFirst({
      where: { id: fromWishlistId, userId: user.id },
      select: { id: true },
    });
    if (own) {
      // Wishlist's purchasedDeviceId currently only holds Device ids; for
      // subscription origin we just mark status PURCHASED + leave a note.
      await prisma.wishlistItem.update({
        where: { id: fromWishlistId },
        data: {
          status: 'PURCHASED',
          notes: own
            ? `Đã đăng ký thành Subscription: ${created.id}\n` +
              `(${created.name})`
            : undefined,
        },
      });
      revalidatePath('/wishlist');
      revalidatePath(`/wishlist/${fromWishlistId}`);
    }
  }

  revalidatePath('/dashboard');
  revalidatePath('/subscriptions');
  redirect(`/subscriptions/${created.id}`);
}

export async function updateSubscription(
  id: string,
  _prev: SubscriptionFormState,
  formData: FormData,
): Promise<SubscriptionFormState> {
  const user = await requireUser();
  const rl = await rateLimitUserWrite(user.id);
  if (!rl.ok) {
    return { ok: false, message: `Thao tác quá nhanh. Đợi ${formatRetry(rl.retryAfterSec)}.` };
  }

  const raw = Object.fromEntries(formData.entries());
  const parsed = subscriptionSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.flatten().fieldErrors };
  }
  const data = parsed.data;

  const catErr = await assertCategoryIfProvided(data.category);
  if (catErr) return catErr;

  if (data.billingCycle === 'CUSTOM' && !data.intervalDays) {
    return {
      ok: false,
      errors: { intervalDays: ['Cần nhập số ngày khi chọn chu kỳ Tuỳ chỉnh'] },
    };
  }

  const owned = await prisma.subscription.findFirst({
    where: { id, userId: user.id },
    select: { id: true, renewalDate: true },
  });
  if (!owned) return { ok: false, message: 'Không tìm thấy gói' };

  const startedAt = new Date(data.startedAt);
  const renewalDate = data.renewalDate
    ? new Date(data.renewalDate)
    : owned.renewalDate;

  const cleaned = nullify({
    ...data,
    startedAt: undefined,
    renewalDate: undefined,
  }) as Record<string, unknown>;

  await prisma.subscription.update({
    where: { id },
    data: { ...cleaned, startedAt, renewalDate } as never,
  });

  revalidatePath('/subscriptions');
  revalidatePath(`/subscriptions/${id}`);
  revalidatePath('/dashboard');
  redirect(`/subscriptions/${id}`);
}

const paymentSchema = z.object({
  amount: z.coerce.number().int().nonnegative(),
  paidAt: z.string().min(1, 'Ngày thanh toán bắt buộc'),
  note: z.string().trim().max(500).optional().nullable(),
});

export async function logSubscriptionPayment(
  id: string,
  formData: FormData,
): Promise<SubscriptionFormState> {
  const user = await requireUser();
  const rl = await rateLimitUserWrite(user.id);
  if (!rl.ok) {
    return { ok: false, message: `Thao tác quá nhanh. Đợi ${formatRetry(rl.retryAfterSec)}.` };
  }

  const owned = await prisma.subscription.findFirst({
    where: { id, userId: user.id },
    select: { id: true },
  });
  if (!owned) return { ok: false, message: 'Không tìm thấy gói' };

  const parsed = paymentSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.flatten().fieldErrors };
  }
  const { amount, paidAt, note } = parsed.data;

  await prisma.subscriptionPayment.create({
    data: {
      subscriptionId: id,
      amount,
      paidAt: new Date(paidAt),
      note: note?.trim() || null,
    },
  });

  revalidatePath(`/subscriptions/${id}`);
  return { ok: true };
}

export async function setSubscriptionStatus(id: string, status: string) {
  const user = await requireUser();
  const rl = await rateLimitUserWrite(user.id);
  if (!rl.ok) return { ok: false };

  const parsed = z.enum(SUBSCRIPTION_STATUSES).safeParse(status);
  if (!parsed.success) return { ok: false };

  const owned = await prisma.subscription.findFirst({
    where: { id, userId: user.id },
    select: { id: true },
  });
  if (!owned) return { ok: false };

  await prisma.subscription.update({
    where: { id },
    data: { status: parsed.data },
  });
  revalidatePath('/subscriptions');
  revalidatePath(`/subscriptions/${id}`);
  revalidatePath('/dashboard');
  return { ok: true };
}

export async function deleteSubscription(id: string) {
  const user = await requireUser();
  const rl = await rateLimitUserWrite(user.id);
  if (!rl.ok) redirect('/subscriptions');

  const owned = await prisma.subscription.findFirst({
    where: { id, userId: user.id },
    select: { id: true },
  });
  if (!owned) redirect('/subscriptions');

  await prisma.subscription.delete({ where: { id } });
  revalidatePath('/subscriptions');
  revalidatePath('/dashboard');
  redirect('/subscriptions');
}

// Manually trigger a renewal: append a payment + bump renewalDate by one
// cycle. Used by the detail page "Đã gia hạn" button when user wants to log
// a charge that happened outside the cron.
export async function renewSubscriptionNow(
  id: string,
): Promise<SubscriptionFormState> {
  const user = await requireUser();
  const rl = await rateLimitUserWrite(user.id);
  if (!rl.ok) {
    return { ok: false, message: `Thao tác quá nhanh. Đợi ${formatRetry(rl.retryAfterSec)}.` };
  }

  const owned = await prisma.subscription.findFirst({
    where: { id, userId: user.id },
  });
  if (!owned) return { ok: false, message: 'Không tìm thấy gói' };
  if (owned.billingCycle === 'LIFETIME') {
    return { ok: false, message: 'Gói lifetime không có gia hạn' };
  }

  const next = nextRenewalDate(
    owned.renewalDate,
    owned.billingCycle as BillingCycle,
    owned.intervalDays,
  );

  await prisma.$transaction([
    prisma.subscriptionPayment.create({
      data: {
        subscriptionId: id,
        amount: owned.price,
        paidAt: owned.renewalDate,
        note: 'Gia hạn (manual)',
      },
    }),
    prisma.subscription.update({
      where: { id },
      data: { renewalDate: next, status: 'ACTIVE' },
    }),
  ]);

  revalidatePath('/subscriptions');
  revalidatePath(`/subscriptions/${id}`);
  revalidatePath('/dashboard');
  return { ok: true };
}
