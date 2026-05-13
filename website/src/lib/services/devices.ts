import path from 'node:path';
import { rm } from 'node:fs/promises';
import { addMonths } from 'date-fns';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { STATUSES } from '@/lib/types';
import { PRIVATE_UPLOAD_ROOT } from '@/lib/files';
import { effectiveWarrantyEnd } from '@/lib/warranty';
import { DomainError } from '@/lib/services/errors';

export const MAX_DEVICES_PER_USER = 50;

export type DeviceListFilter = {
  q?: string;
  category?: string;
  status?: string;
  sort?: 'purchaseDate' | 'warrantyEndDate' | 'price' | 'name';
  dir?: 'asc' | 'desc';
};

export async function listDevices(userId: string, filter: DeviceListFilter = {}) {
  const { q, category, status, sort = 'purchaseDate', dir = 'desc' } = filter;

  const where: Parameters<typeof prisma.device.findMany>[0] extends infer T
    ? T extends { where?: infer W }
      ? W
      : never
    : never = { userId };

  if (q && q.trim()) {
    const term = q.trim();
    (where as Record<string, unknown>).OR = [
      { name: { contains: term } },
      { brand: { contains: term } },
      { model: { contains: term } },
      { serialNumber: { contains: term } },
    ];
  }
  if (category && category !== 'ALL') (where as Record<string, unknown>).category = category;
  if (status && status !== 'ALL') (where as Record<string, unknown>).status = status;

  // Sort by warrantyEndDate is computed (max over warranties) — sort in JS.
  const orderBy: Record<string, 'asc' | 'desc'> | undefined =
    sort === 'price'
      ? { purchasePrice: dir }
      : sort === 'name'
      ? { name: dir }
      : sort === 'warrantyEndDate'
      ? undefined
      : { purchaseDate: dir };

  const rows = await prisma.device.findMany({
    where,
    orderBy,
    include: {
      _count: { select: { attachments: true } },
      warranties: { select: { endDate: true } },
    },
  });

  if (sort === 'warrantyEndDate') {
    const sign = dir === 'asc' ? 1 : -1;
    rows.sort((a, b) => {
      const ea = effectiveWarrantyEnd(a.warranties)?.getTime();
      const eb = effectiveWarrantyEnd(b.warranties)?.getTime();
      // Treat missing warranty as "infinitely far away" so sorting by "BH sắp hết trước" puts devices with warranties first.
      const va = ea ?? (dir === 'asc' ? Infinity : -Infinity);
      const vb = eb ?? (dir === 'asc' ? Infinity : -Infinity);
      return sign * (va - vb);
    });
  }

  return rows.map((d) => ({
    ...d,
    effectiveWarrantyEnd: effectiveWarrantyEnd(d.warranties),
  }));
}

// Same schema as the FormData-flavored one in src/app/actions/devices.ts.
// Lives here so /api/v1/devices and the server action both validate against
// a single source of truth.
export const deviceInputSchema = z.object({
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
  warrantyMonths: z.coerce.number().int().nonnegative().default(0),
  warrantyProvider: z.string().trim().optional().nullable(),
  warrantyAddress: z.string().trim().optional().nullable(),
  warrantyPhone: z.string().trim().optional().nullable(),
  warrantyNotes: z.string().trim().optional().nullable(),
});

export type DeviceInput = z.infer<typeof deviceInputSchema>;

function nullify<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = { ...obj };
  for (const k of Object.keys(out)) {
    if (out[k] === '' || out[k] === undefined) out[k] = null;
  }
  return out as T;
}

async function assertCategoryExists(code: string): Promise<void> {
  const found = await prisma.category.findFirst({
    where: { code, isActive: true },
    select: { code: true },
  });
  if (!found) {
    throw new DomainError('CATEGORY_INVALID', 'Loại thiết bị không hợp lệ', {
      category: ['Loại thiết bị không hợp lệ'],
    });
  }
}

export async function createDevice(
  userId: string,
  input: DeviceInput,
  opts: { fromWishlistId?: string | null } = {},
) {
  await assertCategoryExists(input.category);

  const count = await prisma.device.count({ where: { userId } });
  if (count >= MAX_DEVICES_PER_USER) {
    throw new DomainError(
      'LIMIT_REACHED',
      `Đã đạt giới hạn ${MAX_DEVICES_PER_USER} thiết bị. Xoá bớt rồi thử lại.`,
    );
  }

  const purchaseDate = new Date(input.purchaseDate);
  const {
    warrantyMonths,
    warrantyProvider,
    warrantyAddress,
    warrantyPhone,
    warrantyNotes,
    ...deviceData
  } = input;

  const created = await prisma.device.create({
    data: {
      ...nullify(deviceData),
      userId,
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

  // If the device was seeded from a wishlist item, mark it purchased and
  // back-reference. Caller passes the id; we still verify ownership here so
  // a malicious mobile client can't link to someone else's wishlist entry.
  if (opts.fromWishlistId && /^[a-z0-9_-]+$/i.test(opts.fromWishlistId)) {
    const own = await prisma.wishlistItem.findFirst({
      where: { id: opts.fromWishlistId, userId },
      select: { id: true },
    });
    if (own) {
      await prisma.wishlistItem.update({
        where: { id: opts.fromWishlistId },
        data: { status: 'PURCHASED', purchasedDeviceId: created.id },
      });
    }
  }

  return created;
}

export async function updateDevice(userId: string, id: string, input: DeviceInput) {
  await assertCategoryExists(input.category);

  const owned = await prisma.device.findFirst({
    where: { id, userId },
    select: { id: true },
  });
  if (!owned) throw new DomainError('NOT_FOUND', 'Không tìm thấy thiết bị');

  const purchaseDate = new Date(input.purchaseDate);
  const {
    warrantyMonths,
    warrantyProvider,
    warrantyAddress,
    warrantyPhone,
    warrantyNotes,
    ...deviceData
  } = input;

  // The inline form manages a single STANDARD warranty (the one auto-created
  // on device creation). Other warranties are managed via the warranty
  // actions on the detail page / dedicated REST endpoints.
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

  return prisma.device.findUnique({ where: { id } });
}

export async function deleteDevice(userId: string, id: string): Promise<void> {
  const owned = await prisma.device.findFirst({
    where: { id, userId },
    select: { id: true },
  });
  if (!owned) throw new DomainError('NOT_FOUND', 'Không tìm thấy thiết bị');

  await prisma.device.delete({ where: { id } });

  // Cascade only removes Attachment rows; the encrypted blobs remain on disk.
  // Resolve the device's upload dir under PRIVATE_UPLOAD_ROOT and rm -rf it.
  if (/^[a-z0-9_-]+$/i.test(id)) {
    const dir = path.resolve(PRIVATE_UPLOAD_ROOT, id);
    if (dir.startsWith(path.resolve(PRIVATE_UPLOAD_ROOT) + path.sep)) {
      await rm(dir, { recursive: true, force: true }).catch(() => void 0);
    }
  }
}
