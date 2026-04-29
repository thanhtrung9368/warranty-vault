'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { addMonths } from 'date-fns';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth';
import { rateLimitUserWrite, formatRetry } from '@/lib/rate-limit';
import { WARRANTY_TYPES } from '@/lib/types';

const MAX_WARRANTIES_PER_DEVICE = 5;

const warrantySchema = z.object({
  type: z.enum(WARRANTY_TYPES),
  provider: z.string().trim().optional().nullable(),
  startDate: z.string().min(1, 'Ngày bắt đầu bắt buộc'),
  months: z.coerce.number().int().min(1, 'Số tháng bảo hành >= 1'),
  cost: z.coerce.number().int().nonnegative().optional().nullable(),
  address: z.string().trim().optional().nullable(),
  phone: z.string().trim().optional().nullable(),
  notes: z.string().trim().optional().nullable(),
});

export type WarrantyFormState = {
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

async function assertDeviceOwned(userId: string, deviceId: string) {
  const owned = await prisma.device.findFirst({
    where: { id: deviceId, userId },
    select: { id: true },
  });
  return Boolean(owned);
}

export async function createWarranty(
  deviceId: string,
  _prev: WarrantyFormState,
  formData: FormData,
): Promise<WarrantyFormState> {
  const user = await requireUser();
  const rl = await rateLimitUserWrite(user.id);
  if (!rl.ok) {
    return { ok: false, message: `Thao tác quá nhanh. Đợi ${formatRetry(rl.retryAfterSec)}.` };
  }

  if (!(await assertDeviceOwned(user.id, deviceId))) {
    return { ok: false, message: 'Không tìm thấy thiết bị' };
  }

  const raw = Object.fromEntries(formData.entries());
  const parsed = warrantySchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.flatten().fieldErrors };
  }
  const data = parsed.data;

  const count = await prisma.warranty.count({ where: { deviceId } });
  if (count >= MAX_WARRANTIES_PER_DEVICE) {
    return {
      ok: false,
      message: `Mỗi thiết bị tối đa ${MAX_WARRANTIES_PER_DEVICE} gói bảo hành.`,
    };
  }

  const startDate = new Date(data.startDate);
  const endDate = addMonths(startDate, data.months);

  await prisma.warranty.create({
    data: {
      ...nullify(data),
      deviceId,
      startDate,
      endDate,
    } as never,
  });

  revalidatePath('/dashboard');
  revalidatePath('/devices');
  revalidatePath(`/devices/${deviceId}`);
  revalidatePath('/reminders');
  redirect(`/devices/${deviceId}`);
}

export async function updateWarranty(
  warrantyId: string,
  _prev: WarrantyFormState,
  formData: FormData,
): Promise<WarrantyFormState> {
  const user = await requireUser();
  const rl = await rateLimitUserWrite(user.id);
  if (!rl.ok) {
    return { ok: false, message: `Thao tác quá nhanh. Đợi ${formatRetry(rl.retryAfterSec)}.` };
  }

  const existing = await prisma.warranty.findFirst({
    where: { id: warrantyId, device: { userId: user.id } },
    select: { id: true, deviceId: true },
  });
  if (!existing) return { ok: false, message: 'Không tìm thấy gói bảo hành' };

  const raw = Object.fromEntries(formData.entries());
  const parsed = warrantySchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.flatten().fieldErrors };
  }
  const data = parsed.data;
  const startDate = new Date(data.startDate);
  const endDate = addMonths(startDate, data.months);

  await prisma.warranty.update({
    where: { id: warrantyId },
    data: {
      ...nullify(data),
      startDate,
      endDate,
    } as never,
  });

  revalidatePath('/dashboard');
  revalidatePath('/devices');
  revalidatePath(`/devices/${existing.deviceId}`);
  revalidatePath('/reminders');
  redirect(`/devices/${existing.deviceId}`);
}

export async function deleteWarranty(warrantyId: string) {
  const user = await requireUser();
  const rl = await rateLimitUserWrite(user.id);
  if (!rl.ok) return { ok: false };

  const existing = await prisma.warranty.findFirst({
    where: { id: warrantyId, device: { userId: user.id } },
    select: { id: true, deviceId: true },
  });
  if (!existing) return { ok: false };

  await prisma.warranty.delete({ where: { id: warrantyId } });

  revalidatePath('/dashboard');
  revalidatePath('/devices');
  revalidatePath(`/devices/${existing.deviceId}`);
  revalidatePath('/reminders');
  return { ok: true };
}
