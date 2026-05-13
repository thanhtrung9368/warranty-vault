import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import {
  BILLING_CYCLES,
  SUBSCRIPTION_STATUSES,
  nextRenewalDate,
  type BillingCycle,
} from '@/lib/subscription-types';
import { DomainError } from '@/lib/services/errors';

export const MAX_SUBS_PER_USER = 100;

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

export const subscriptionInputSchema = z.object({
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
export type SubscriptionInput = z.infer<typeof subscriptionInputSchema>;

export const paymentInputSchema = z.object({
  amount: z.coerce.number().int().nonnegative(),
  paidAt: z.string().min(1, 'Ngày thanh toán bắt buộc'),
  note: z.string().trim().max(500).optional().nullable(),
});
export type PaymentInput = z.infer<typeof paymentInputSchema>;

function nullify<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = { ...obj };
  for (const k of Object.keys(out)) {
    if (out[k] === '' || out[k] === undefined) out[k] = null;
  }
  return out as T;
}

async function assertCategoryIfProvided(code?: string | null) {
  if (!code) return;
  const found = await prisma.category.findFirst({
    where: { code, isActive: true },
    select: { code: true },
  });
  if (!found) {
    throw new DomainError('CATEGORY_INVALID', 'Loại không hợp lệ', {
      category: ['Loại không hợp lệ'],
    });
  }
}

function assertCustomCycleHasInterval(input: SubscriptionInput) {
  if (input.billingCycle === 'CUSTOM' && !input.intervalDays) {
    throw new DomainError('BAD_INPUT', 'Cần nhập số ngày khi chọn chu kỳ Tuỳ chỉnh', {
      intervalDays: ['Cần nhập số ngày khi chọn chu kỳ Tuỳ chỉnh'],
    });
  }
}

export async function listSubscriptions(userId: string) {
  return prisma.subscription.findMany({
    where: { userId },
    orderBy: { renewalDate: 'asc' },
  });
}

export async function createSubscription(
  userId: string,
  input: SubscriptionInput,
  opts: { fromWishlistId?: string | null } = {},
) {
  await assertCategoryIfProvided(input.category);
  assertCustomCycleHasInterval(input);

  const count = await prisma.subscription.count({ where: { userId } });
  if (count >= MAX_SUBS_PER_USER) {
    throw new DomainError(
      'LIMIT_REACHED',
      `Đã đạt giới hạn ${MAX_SUBS_PER_USER} gói. Xoá bớt rồi thử lại.`,
    );
  }

  const startedAt = new Date(input.startedAt);
  const renewalDate = input.renewalDate
    ? new Date(input.renewalDate)
    : nextRenewalDate(startedAt, input.billingCycle, input.intervalDays);

  const cleaned = nullify({
    ...input,
    startedAt: undefined,
    renewalDate: undefined,
  }) as Record<string, unknown>;

  const created = await prisma.subscription.create({
    data: { ...cleaned, userId, startedAt, renewalDate } as never,
  });

  if (opts.fromWishlistId && /^[a-z0-9_-]+$/i.test(opts.fromWishlistId)) {
    const own = await prisma.wishlistItem.findFirst({
      where: { id: opts.fromWishlistId, userId },
      select: { id: true, notes: true },
    });
    if (own) {
      await prisma.wishlistItem.update({
        where: { id: opts.fromWishlistId },
        data: {
          status: 'PURCHASED',
          notes: `Đã đăng ký thành Subscription: ${created.id}\n(${created.name})`,
        },
      });
    }
  }

  return created;
}

export async function updateSubscription(
  userId: string,
  id: string,
  input: SubscriptionInput,
) {
  await assertCategoryIfProvided(input.category);
  assertCustomCycleHasInterval(input);

  const owned = await prisma.subscription.findFirst({
    where: { id, userId },
    select: { id: true, renewalDate: true },
  });
  if (!owned) throw new DomainError('NOT_FOUND', 'Không tìm thấy gói');

  const startedAt = new Date(input.startedAt);
  const renewalDate = input.renewalDate ? new Date(input.renewalDate) : owned.renewalDate;
  const cleaned = nullify({
    ...input,
    startedAt: undefined,
    renewalDate: undefined,
  }) as Record<string, unknown>;

  return prisma.subscription.update({
    where: { id },
    data: { ...cleaned, startedAt, renewalDate } as never,
  });
}

export async function deleteSubscription(userId: string, id: string) {
  const owned = await prisma.subscription.findFirst({
    where: { id, userId },
    select: { id: true },
  });
  if (!owned) throw new DomainError('NOT_FOUND', 'Không tìm thấy gói');
  await prisma.subscription.delete({ where: { id } });
}

export async function setSubscriptionStatus(userId: string, id: string, status: string) {
  const parsed = z.enum(SUBSCRIPTION_STATUSES).safeParse(status);
  if (!parsed.success) throw new DomainError('BAD_INPUT', 'Trạng thái không hợp lệ');

  const owned = await prisma.subscription.findFirst({
    where: { id, userId },
    select: { id: true },
  });
  if (!owned) throw new DomainError('NOT_FOUND', 'Không tìm thấy gói');

  await prisma.subscription.update({ where: { id }, data: { status: parsed.data } });
}

export async function logSubscriptionPayment(
  userId: string,
  id: string,
  input: PaymentInput,
) {
  const owned = await prisma.subscription.findFirst({
    where: { id, userId },
    select: { id: true },
  });
  if (!owned) throw new DomainError('NOT_FOUND', 'Không tìm thấy gói');

  return prisma.subscriptionPayment.create({
    data: {
      subscriptionId: id,
      amount: input.amount,
      paidAt: new Date(input.paidAt),
      note: input.note?.trim() || null,
    },
  });
}

export async function renewSubscriptionNow(userId: string, id: string) {
  const owned = await prisma.subscription.findFirst({ where: { id, userId } });
  if (!owned) throw new DomainError('NOT_FOUND', 'Không tìm thấy gói');
  if (owned.billingCycle === 'LIFETIME') {
    throw new DomainError('BAD_INPUT', 'Gói lifetime không có gia hạn');
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
}
