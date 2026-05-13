import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { WISHLIST_PRIORITIES, WISHLIST_STATUSES } from '@/lib/wishlist-types';
import { DomainError } from '@/lib/services/errors';

export const MAX_WISHLIST_PER_USER = 200;

const blankToNull = (v: unknown) => (v === '' || v == null ? null : v);

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

export const wishlistInputSchema = z.object({
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
export type WishlistInput = z.infer<typeof wishlistInputSchema>;

export const priceLogInputSchema = z.object({
  price: z.coerce.number().int().nonnegative(),
  note: z.string().trim().max(500).optional().nullable(),
});
export type PriceLogInput = z.infer<typeof priceLogInputSchema>;

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
    throw new DomainError('CATEGORY_INVALID', 'Loại sản phẩm không hợp lệ', {
      category: ['Loại sản phẩm không hợp lệ'],
    });
  }
}

export async function getWishlistItem(userId: string, id: string) {
  const item = await prisma.wishlistItem.findFirst({
    where: { id, userId },
    include: { prices: { orderBy: { recordedAt: 'desc' } } },
  });
  if (!item) throw new DomainError('NOT_FOUND', 'Không tìm thấy món');
  const { prices, ...rest } = item;
  return { item: rest, prices };
}

export async function createWishlistItem(userId: string, input: WishlistInput) {
  await assertCategoryIfProvided(input.category);

  const count = await prisma.wishlistItem.count({ where: { userId } });
  if (count >= MAX_WISHLIST_PER_USER) {
    throw new DomainError(
      'LIMIT_REACHED',
      `Đã đạt giới hạn ${MAX_WISHLIST_PER_USER} món. Xoá bớt rồi thử lại.`,
    );
  }

  const targetDate = input.targetDate ? new Date(input.targetDate) : null;
  const cleaned = nullify({ ...input, targetDate: undefined });

  return prisma.wishlistItem.create({
    data: {
      ...(cleaned as Record<string, unknown>),
      userId,
      targetDate,
      prices: {
        create:
          input.currentPrice != null
            ? [{ price: input.currentPrice }]
            : input.initialPrice != null
              ? [{ price: input.initialPrice }]
              : [],
      },
    } as never,
  });
}

export async function updateWishlistItem(
  userId: string,
  id: string,
  input: WishlistInput,
) {
  await assertCategoryIfProvided(input.category);

  const owned = await prisma.wishlistItem.findFirst({
    where: { id, userId },
    select: { id: true, currentPrice: true },
  });
  if (!owned) throw new DomainError('NOT_FOUND', 'Không tìm thấy món');

  const targetDate = input.targetDate ? new Date(input.targetDate) : null;
  const cleaned = nullify({ ...input, targetDate: undefined }) as Record<string, unknown>;

  await prisma.$transaction(async (tx) => {
    await tx.wishlistItem.update({
      where: { id },
      data: { ...cleaned, targetDate } as never,
    });
    if (input.currentPrice != null && input.currentPrice !== owned.currentPrice) {
      await tx.wishlistPrice.create({
        data: { itemId: id, price: input.currentPrice },
      });
    }
  });
}

export async function deleteWishlistItem(userId: string, id: string) {
  const owned = await prisma.wishlistItem.findFirst({
    where: { id, userId },
    select: { id: true },
  });
  if (!owned) throw new DomainError('NOT_FOUND', 'Không tìm thấy món');
  await prisma.wishlistItem.delete({ where: { id } });
}

export async function setWishlistStatus(userId: string, id: string, status: string) {
  const parsed = z.enum(WISHLIST_STATUSES).safeParse(status);
  if (!parsed.success) throw new DomainError('BAD_INPUT', 'Trạng thái không hợp lệ');

  const owned = await prisma.wishlistItem.findFirst({
    where: { id, userId },
    select: { id: true },
  });
  if (!owned) throw new DomainError('NOT_FOUND', 'Không tìm thấy món');

  await prisma.wishlistItem.update({ where: { id }, data: { status: parsed.data } });
}

export async function logWishlistPrice(
  userId: string,
  id: string,
  input: PriceLogInput,
) {
  const owned = await prisma.wishlistItem.findFirst({
    where: { id, userId },
    select: { id: true },
  });
  if (!owned) throw new DomainError('NOT_FOUND', 'Không tìm thấy món');

  await prisma.$transaction([
    prisma.wishlistPrice.create({
      data: { itemId: id, price: input.price, note: input.note?.trim() || null },
    }),
    prisma.wishlistItem.update({ where: { id }, data: { currentPrice: input.price } }),
  ]);
}

export async function markWishlistPurchased(userId: string, itemId: string, deviceId: string) {
  const owned = await prisma.wishlistItem.findFirst({
    where: { id: itemId, userId },
    select: { id: true },
  });
  if (!owned) return;
  const device = await prisma.device.findFirst({
    where: { id: deviceId, userId },
    select: { id: true },
  });
  if (!device) return;
  await prisma.wishlistItem.update({
    where: { id: itemId },
    data: { status: 'PURCHASED', purchasedDeviceId: deviceId },
  });
}
