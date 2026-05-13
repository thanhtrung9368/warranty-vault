import { addMonths } from 'date-fns';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { WARRANTY_TYPES } from '@/lib/types';
import { DomainError } from '@/lib/services/errors';

export const MAX_WARRANTIES_PER_DEVICE = 5;

export const warrantyInputSchema = z.object({
  type: z.enum(WARRANTY_TYPES),
  provider: z.string().trim().optional().nullable(),
  startDate: z.string().min(1, 'Ngày bắt đầu bắt buộc'),
  months: z.coerce.number().int().min(1, 'Số tháng bảo hành >= 1'),
  cost: z.coerce.number().int().nonnegative().optional().nullable(),
  address: z.string().trim().optional().nullable(),
  phone: z.string().trim().optional().nullable(),
  notes: z.string().trim().optional().nullable(),
});

export type WarrantyInput = z.infer<typeof warrantyInputSchema>;

function nullify<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = { ...obj };
  for (const k of Object.keys(out)) {
    if (out[k] === '' || out[k] === undefined) out[k] = null;
  }
  return out as T;
}

async function assertDeviceOwned(userId: string, deviceId: string) {
  const owned = await prisma.device.findFirst({
    where: { id: deviceId, userId },
    select: { id: true },
  });
  if (!owned) throw new DomainError('NOT_FOUND', 'Không tìm thấy thiết bị');
}

export async function createWarranty(
  userId: string,
  deviceId: string,
  input: WarrantyInput,
) {
  await assertDeviceOwned(userId, deviceId);

  const count = await prisma.warranty.count({ where: { deviceId } });
  if (count >= MAX_WARRANTIES_PER_DEVICE) {
    throw new DomainError(
      'LIMIT_REACHED',
      `Mỗi thiết bị tối đa ${MAX_WARRANTIES_PER_DEVICE} gói bảo hành.`,
    );
  }

  const startDate = new Date(input.startDate);
  const endDate = addMonths(startDate, input.months);
  return prisma.warranty.create({
    data: {
      ...nullify(input),
      deviceId,
      startDate,
      endDate,
    } as never,
  });
}

export async function updateWarranty(
  userId: string,
  warrantyId: string,
  input: WarrantyInput,
) {
  const existing = await prisma.warranty.findFirst({
    where: { id: warrantyId, device: { userId } },
    select: { id: true, deviceId: true },
  });
  if (!existing) throw new DomainError('NOT_FOUND', 'Không tìm thấy gói bảo hành');

  const startDate = new Date(input.startDate);
  const endDate = addMonths(startDate, input.months);
  const updated = await prisma.warranty.update({
    where: { id: warrantyId },
    data: {
      ...nullify(input),
      startDate,
      endDate,
    } as never,
  });
  return { warranty: updated, deviceId: existing.deviceId };
}

export async function deleteWarranty(userId: string, warrantyId: string) {
  const existing = await prisma.warranty.findFirst({
    where: { id: warrantyId, device: { userId } },
    select: { id: true, deviceId: true },
  });
  if (!existing) throw new DomainError('NOT_FOUND', 'Không tìm thấy gói bảo hành');
  await prisma.warranty.delete({ where: { id: warrantyId } });
  return { deviceId: existing.deviceId };
}
