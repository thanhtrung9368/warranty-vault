import { prisma } from '@/lib/prisma';
import { effectiveWarrantyEnd } from '@/lib/warranty';

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

export async function getDevice(userId: string, id: string) {
  return prisma.device.findFirst({
    where: { id, userId },
    include: {
      attachments: { orderBy: { uploadedAt: 'desc' } },
      warranties: {
        orderBy: [{ type: 'asc' }, { endDate: 'desc' }],
        include: { reminders: { orderBy: { createdAt: 'asc' } } },
      },
    },
  });
}

export async function dashboardStats(userId: string) {
  const now = new Date();
  const in30 = new Date();
  in30.setDate(now.getDate() + 30);

  const [total, devices] = await Promise.all([
    prisma.device.count({ where: { userId } }),
    prisma.device.findMany({
      where: { userId },
      include: {
        warranties: { select: { endDate: true } },
      },
    }),
  ]);

  let active = 0;
  let soon = 0;
  let expired = 0;
  const soonItems: Array<{
    id: string;
    name: string;
    category: string;
    brand: string | null;
    purchaseDate: Date;
    purchasePrice: number;
    effectiveWarrantyEnd: Date;
  }> = [];

  for (const d of devices) {
    const end = effectiveWarrantyEnd(d.warranties);
    if (!end) continue;
    if (d.status === 'ACTIVE' && end > now) active++;
    if (end < now) expired++;
    if (d.status === 'ACTIVE' && end > now && end <= in30) {
      soon++;
      soonItems.push({
        id: d.id,
        name: d.name,
        category: d.category,
        brand: d.brand,
        purchaseDate: d.purchaseDate,
        purchasePrice: d.purchasePrice,
        effectiveWarrantyEnd: end,
      });
    }
  }

  soonItems.sort((a, b) => a.effectiveWarrantyEnd.getTime() - b.effectiveWarrantyEnd.getTime());

  return {
    total,
    active,
    soon,
    expired,
    soonList: soonItems.slice(0, 8),
  };
}
