'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth';
import { rateLimitUserWrite, formatRetry } from '@/lib/rate-limit';
import {
  WISHLIST_PRIORITIES,
  WISHLIST_STATUSES,
} from '@/lib/wishlist-types';

const MAX_WISHLIST_PER_USER = 200;

// Treat empty form values as "not provided" before zod coercion. Without
// this, an empty string for a numeric field gets coerced to 0 and then
// fails `.min(1)` checks, surfacing as bogus validation errors.
const blankToNull = (v: unknown) =>
  v === '' || v == null ? null : v;

const optionalUrl = z.preprocess(
  blankToNull,
  z.string().trim().url('URL không hợp lệ').nullable(),
);

const optionalInt = (opts?: { min?: number; max?: number }) =>
  z.preprocess(
    blankToNull,
    opts?.min !== undefined || opts?.max !== undefined
      ? z.coerce
          .number()
          .int()
          .min(opts?.min ?? 0)
          .max(opts?.max ?? Number.MAX_SAFE_INTEGER)
          .nullable()
      : z.coerce.number().int().nonnegative().nullable(),
  );

const itemSchema = z.object({
  name: z.string().trim().min(1, 'Tên sản phẩm bắt buộc').max(200),
  category: z.string().trim().optional().nullable(),
  brand: z.string().trim().optional().nullable(),
  initialPrice: optionalInt(),
  currentPrice: optionalInt(),
  buyUrl: optionalUrl,
  imageUrl: optionalUrl,
  targetDate: z.preprocess(blankToNull, z.string().nullable()),
  priority: z.enum(WISHLIST_PRIORITIES).default('WANT'),
  status: z.enum(WISHLIST_STATUSES).default('WATCHING'),
  notes: z.string().trim().optional().nullable(),
  reminderIntervalDays: optionalInt({ min: 1, max: 3650 }),
});

export type WishlistFormState = {
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

async function assertCategoryIfProvided(code?: string | null): Promise<WishlistFormState | null> {
  if (!code) return null;
  const found = await prisma.category.findFirst({
    where: { code, isActive: true },
    select: { code: true },
  });
  if (!found) {
    return { ok: false, errors: { category: ['Loại sản phẩm không hợp lệ'] } };
  }
  return null;
}

export async function createWishlistItem(
  _prev: WishlistFormState,
  formData: FormData,
): Promise<WishlistFormState> {
  const user = await requireUser();
  const rl = await rateLimitUserWrite(user.id);
  if (!rl.ok) {
    return { ok: false, message: `Thao tác quá nhanh. Đợi ${formatRetry(rl.retryAfterSec)}.` };
  }

  const raw = Object.fromEntries(formData.entries());
  const parsed = itemSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.flatten().fieldErrors };
  }
  const data = parsed.data;

  const catErr = await assertCategoryIfProvided(data.category);
  if (catErr) return catErr;

  const count = await prisma.wishlistItem.count({ where: { userId: user.id } });
  if (count >= MAX_WISHLIST_PER_USER) {
    return {
      ok: false,
      message: `Đã đạt giới hạn ${MAX_WISHLIST_PER_USER} món. Xoá bớt rồi thử lại.`,
    };
  }

  const targetDate = data.targetDate ? new Date(data.targetDate) : null;
  const cleaned = nullify({ ...data, targetDate: undefined });

  const created = await prisma.wishlistItem.create({
    data: {
      ...(cleaned as Record<string, unknown>),
      userId: user.id,
      targetDate,
      // Seed price history with whichever price the user provided.
      prices: {
        create:
          data.currentPrice != null
            ? [{ price: data.currentPrice }]
            : data.initialPrice != null
              ? [{ price: data.initialPrice }]
              : [],
      },
    } as never,
  });

  revalidatePath('/wishlist');
  revalidatePath('/dashboard');
  redirect(`/wishlist/${created.id}`);
}

export async function updateWishlistItem(
  id: string,
  _prev: WishlistFormState,
  formData: FormData,
): Promise<WishlistFormState> {
  const user = await requireUser();
  const rl = await rateLimitUserWrite(user.id);
  if (!rl.ok) {
    return { ok: false, message: `Thao tác quá nhanh. Đợi ${formatRetry(rl.retryAfterSec)}.` };
  }

  const raw = Object.fromEntries(formData.entries());
  const parsed = itemSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.flatten().fieldErrors };
  }
  const data = parsed.data;

  const catErr = await assertCategoryIfProvided(data.category);
  if (catErr) return catErr;

  const owned = await prisma.wishlistItem.findFirst({
    where: { id, userId: user.id },
    select: { id: true, currentPrice: true },
  });
  if (!owned) return { ok: false, message: 'Không tìm thấy món' };

  const targetDate = data.targetDate ? new Date(data.targetDate) : null;
  const cleaned = nullify({ ...data, targetDate: undefined }) as Record<string, unknown>;

  await prisma.$transaction(async (tx) => {
    await tx.wishlistItem.update({
      where: { id },
      data: { ...cleaned, targetDate } as never,
    });
    // If currentPrice changed via the form, log it.
    if (
      data.currentPrice != null &&
      data.currentPrice !== owned.currentPrice
    ) {
      await tx.wishlistPrice.create({
        data: { itemId: id, price: data.currentPrice },
      });
    }
  });

  revalidatePath('/wishlist');
  revalidatePath(`/wishlist/${id}`);
  revalidatePath('/dashboard');
  redirect(`/wishlist/${id}`);
}

const updatePriceSchema = z.object({
  price: z.coerce.number().int().nonnegative(),
  note: z.string().trim().max(500).optional().nullable(),
});

export async function logWishlistPrice(
  id: string,
  formData: FormData,
): Promise<WishlistFormState> {
  const user = await requireUser();
  const rl = await rateLimitUserWrite(user.id);
  if (!rl.ok) {
    return { ok: false, message: `Thao tác quá nhanh. Đợi ${formatRetry(rl.retryAfterSec)}.` };
  }

  const owned = await prisma.wishlistItem.findFirst({
    where: { id, userId: user.id },
    select: { id: true },
  });
  if (!owned) return { ok: false, message: 'Không tìm thấy món' };

  const parsed = updatePriceSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.flatten().fieldErrors };
  }
  const { price, note } = parsed.data;

  await prisma.$transaction([
    prisma.wishlistPrice.create({
      data: { itemId: id, price, note: note?.trim() || null },
    }),
    prisma.wishlistItem.update({
      where: { id },
      data: { currentPrice: price },
    }),
  ]);

  revalidatePath('/wishlist');
  revalidatePath(`/wishlist/${id}`);
  return { ok: true };
}

export async function setWishlistStatus(id: string, status: string) {
  const user = await requireUser();
  const rl = await rateLimitUserWrite(user.id);
  if (!rl.ok) return { ok: false };

  const parsed = z.enum(WISHLIST_STATUSES).safeParse(status);
  if (!parsed.success) return { ok: false };

  const owned = await prisma.wishlistItem.findFirst({
    where: { id, userId: user.id },
    select: { id: true },
  });
  if (!owned) return { ok: false };

  await prisma.wishlistItem.update({
    where: { id },
    data: { status: parsed.data },
  });
  revalidatePath('/wishlist');
  revalidatePath(`/wishlist/${id}`);
  revalidatePath('/dashboard');
  return { ok: true };
}

export async function deleteWishlistItem(id: string) {
  const user = await requireUser();
  const rl = await rateLimitUserWrite(user.id);
  if (!rl.ok) redirect('/wishlist');

  const owned = await prisma.wishlistItem.findFirst({
    where: { id, userId: user.id },
    select: { id: true },
  });
  if (!owned) redirect('/wishlist');

  await prisma.wishlistItem.delete({ where: { id } });
  revalidatePath('/wishlist');
  revalidatePath('/dashboard');
  redirect('/wishlist');
}

// Called by /devices/new after the device is created from a wishlist seed.
// Wraps up the wishlist item: status PURCHASED + back-reference to the new
// device. Rate-limit shared with createDevice.
export async function markWishlistPurchased(itemId: string, deviceId: string) {
  const user = await requireUser();
  // No separate rate-limit — this runs piggy-backed on createDevice which
  // already paid the token cost.
  const owned = await prisma.wishlistItem.findFirst({
    where: { id: itemId, userId: user.id },
    select: { id: true },
  });
  if (!owned) return;
  const device = await prisma.device.findFirst({
    where: { id: deviceId, userId: user.id },
    select: { id: true },
  });
  if (!device) return;
  await prisma.wishlistItem.update({
    where: { id: itemId },
    data: { status: 'PURCHASED', purchasedDeviceId: deviceId },
  });
  revalidatePath('/wishlist');
  revalidatePath(`/wishlist/${itemId}`);
  revalidatePath('/dashboard');
}
