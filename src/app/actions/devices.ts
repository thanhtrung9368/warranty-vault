'use server';

import path from 'node:path';
import { rm } from 'node:fs/promises';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { addMonths } from 'date-fns';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth';
import { rateLimitUserWrite, formatRetry } from '@/lib/rate-limit';
import { STATUSES } from '@/lib/types';
import { PRIVATE_UPLOAD_ROOT } from '@/lib/files';

const UPLOAD_ROOT = PRIVATE_UPLOAD_ROOT;

const MAX_DEVICES_PER_USER = 50;

const deviceSchema = z.object({
  name: z.string().trim().min(1, 'Tên thiết bị bắt buộc'),
  category: z.string().trim().min(1, 'Loại thiết bị bắt buộc'),
  brand: z.string().trim().optional().nullable(),
  model: z.string().trim().optional().nullable(),
  serialNumber: z.string().trim().optional().nullable(),
  purchaseDate: z.string().min(1, 'Ngày mua bắt buộc'),
  purchasePrice: z.coerce.number().int().nonnegative().default(0),
  purchasePlace: z.string().trim().optional().nullable(),
  status: z.enum(STATUSES).default('ACTIVE'),
  notes: z.string().trim().optional().nullable(),
  // Inline STANDARD warranty (optional — 0 months = no warranty package).
  warrantyMonths: z.coerce.number().int().nonnegative().default(0),
  warrantyProvider: z.string().trim().optional().nullable(),
  warrantyAddress: z.string().trim().optional().nullable(),
  warrantyPhone: z.string().trim().optional().nullable(),
  warrantyNotes: z.string().trim().optional().nullable(),
});

export type DeviceFormState = {
  ok?: boolean;
  errors?: Record<string, string[]>;
  message?: string;
};

async function assertCategoryExists(code: string): Promise<DeviceFormState | null> {
  const found = await prisma.category.findFirst({
    where: { code, isActive: true },
    select: { code: true },
  });
  if (!found) {
    return { ok: false, errors: { category: ['Loại thiết bị không hợp lệ'] } };
  }
  return null;
}

function nullify<T extends Record<string, unknown>>(obj: T) {
  const out: Record<string, unknown> = { ...obj };
  for (const k of Object.keys(out)) {
    if (out[k] === '' || out[k] === undefined) out[k] = null;
  }
  return out;
}

export async function createDevice(
  _prev: DeviceFormState,
  formData: FormData,
): Promise<DeviceFormState> {
  const user = await requireUser();

  const rl = await rateLimitUserWrite(user.id);
  if (!rl.ok) {
    return { ok: false, message: `Thao tác quá nhanh. Đợi ${formatRetry(rl.retryAfterSec)}.` };
  }

  const raw = Object.fromEntries(formData.entries());
  const parsed = deviceSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.flatten().fieldErrors };
  }
  const data = parsed.data;
  const purchaseDate = new Date(data.purchaseDate);

  const catErr = await assertCategoryExists(data.category);
  if (catErr) return catErr;

  const count = await prisma.device.count({ where: { userId: user.id } });
  if (count >= MAX_DEVICES_PER_USER) {
    return {
      ok: false,
      message: `Đã đạt giới hạn ${MAX_DEVICES_PER_USER} thiết bị. Xoá bớt rồi thử lại.`,
    };
  }

  const {
    warrantyMonths,
    warrantyProvider,
    warrantyAddress,
    warrantyPhone,
    warrantyNotes,
    ...deviceData
  } = data;

  const created = await prisma.device.create({
    data: {
      ...nullify(deviceData),
      userId: user.id,
      purchaseDate,
      ...(warrantyMonths > 0 && {
        warranties: {
          create: {
            type: 'STANDARD',
            startDate: purchaseDate,
            endDate: addMonths(purchaseDate, warrantyMonths),
            months: warrantyMonths,
            provider: warrantyProvider || null,
            address: warrantyAddress || null,
            phone: warrantyPhone || null,
            notes: warrantyNotes || null,
          },
        },
      }),
    } as never,
  });

  // If created from a wishlist seed, mark it purchased + back-reference.
  const fromWishlistId = formData.get('fromWishlistId');
  if (typeof fromWishlistId === 'string' && /^[a-z0-9_-]+$/i.test(fromWishlistId)) {
    const own = await prisma.wishlistItem.findFirst({
      where: { id: fromWishlistId, userId: user.id },
      select: { id: true },
    });
    if (own) {
      await prisma.wishlistItem.update({
        where: { id: fromWishlistId },
        data: { status: 'PURCHASED', purchasedDeviceId: created.id },
      });
      revalidatePath('/wishlist');
      revalidatePath(`/wishlist/${fromWishlistId}`);
    }
  }

  revalidatePath('/dashboard');
  revalidatePath('/devices');
  revalidatePath('/reminders');
  redirect(`/devices/${created.id}`);
}

export async function updateDevice(
  id: string,
  _prev: DeviceFormState,
  formData: FormData,
): Promise<DeviceFormState> {
  const user = await requireUser();

  const rl = await rateLimitUserWrite(user.id);
  if (!rl.ok) {
    return { ok: false, message: `Thao tác quá nhanh. Đợi ${formatRetry(rl.retryAfterSec)}.` };
  }

  const raw = Object.fromEntries(formData.entries());
  const parsed = deviceSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.flatten().fieldErrors };
  }
  const data = parsed.data;
  const purchaseDate = new Date(data.purchaseDate);

  const catErr = await assertCategoryExists(data.category);
  if (catErr) return catErr;

  const owned = await prisma.device.findFirst({
    where: { id, userId: user.id },
    select: { id: true },
  });
  if (!owned) return { ok: false, message: 'Không tìm thấy thiết bị' };

  const {
    warrantyMonths,
    warrantyProvider,
    warrantyAddress,
    warrantyPhone,
    warrantyNotes,
    ...deviceData
  } = data;

  // The inline form manages a single STANDARD warranty (the one auto-created
  // on device creation). Other warranties (EXTENDED, additional STANDARD,
  // THIRD_PARTY) are managed via the warranty actions on the detail page.
  const existingStandard = await prisma.warranty.findFirst({
    where: { deviceId: id, type: 'STANDARD' },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });

  await prisma.$transaction(async (tx) => {
    await tx.device.update({
      where: { id },
      data: {
        ...nullify(deviceData),
        purchaseDate,
      } as never,
    });

    if (warrantyMonths > 0) {
      const endDate = addMonths(purchaseDate, warrantyMonths);
      const payload = {
        type: 'STANDARD',
        startDate: purchaseDate,
        endDate,
        months: warrantyMonths,
        provider: warrantyProvider || null,
        address: warrantyAddress || null,
        phone: warrantyPhone || null,
        notes: warrantyNotes || null,
      };
      if (existingStandard) {
        await tx.warranty.update({ where: { id: existingStandard.id }, data: payload });
      } else {
        await tx.warranty.create({ data: { ...payload, deviceId: id } });
      }
    } else if (existingStandard) {
      await tx.warranty.delete({ where: { id: existingStandard.id } });
    }
  });

  revalidatePath('/dashboard');
  revalidatePath('/devices');
  revalidatePath(`/devices/${id}`);
  revalidatePath('/reminders');
  redirect(`/devices/${id}`);
}

export async function deleteDevice(id: string) {
  const user = await requireUser();

  const rl = await rateLimitUserWrite(user.id);
  if (!rl.ok) redirect('/devices');

  const owned = await prisma.device.findFirst({
    where: { id, userId: user.id },
    select: { id: true },
  });
  if (!owned) redirect('/devices');
  await prisma.device.delete({ where: { id } });

  // Cascade only removes Attachment rows; the binary files remain on disk.
  // Resolve the device's upload dir under UPLOAD_ROOT and rm -rf it.
  if (/^[a-z0-9_-]+$/i.test(id)) {
    const dir = path.resolve(UPLOAD_ROOT, id);
    if (dir.startsWith(path.resolve(UPLOAD_ROOT) + path.sep)) {
      await rm(dir, { recursive: true, force: true }).catch(() => void 0);
    }
  }

  revalidatePath('/dashboard');
  revalidatePath('/devices');
  revalidatePath('/reminders');
  redirect('/devices');
}
