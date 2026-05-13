import { prisma } from '@/lib/prisma';
import { startOfMonth, subMonths, format } from 'date-fns';
import { vi } from 'date-fns/locale';
import { CATEGORY_LABELS, type Category } from '@/lib/types';

export async function monthlySpend(userId: string, months = 12) {
  const start = startOfMonth(subMonths(new Date(), months - 1));
  const devices = await prisma.device.findMany({
    where: { userId, purchaseDate: { gte: start } },
    select: { purchaseDate: true, purchasePrice: true },
  });

  const buckets = new Map<string, number>();
  for (let i = 0; i < months; i++) {
    const d = startOfMonth(subMonths(new Date(), months - 1 - i));
    buckets.set(format(d, 'yyyy-MM'), 0);
  }

  for (const d of devices) {
    const key = format(startOfMonth(d.purchaseDate), 'yyyy-MM');
    if (buckets.has(key)) buckets.set(key, (buckets.get(key) ?? 0) + d.purchasePrice);
  }

  return Array.from(buckets.entries()).map(([k, total]) => {
    const [y, m] = k.split('-').map(Number);
    const dateObj = new Date(y, m - 1, 1);
    return {
      month: format(dateObj, 'MM/yy', { locale: vi }),
      total,
    };
  });
}

export async function spendByCategory(userId: string) {
  const grouped = await prisma.device.groupBy({
    by: ['category'],
    where: { userId },
    _sum: { purchasePrice: true },
    _count: { _all: true },
  });
  return grouped.map((g) => ({
    category: g.category,
    label: CATEGORY_LABELS[g.category as Category] ?? g.category,
    total: g._sum.purchasePrice ?? 0,
    count: g._count._all,
  }));
}

export async function yearlySpend(userId: string, year: number) {
  const start = new Date(year, 0, 1);
  const end = new Date(year + 1, 0, 1);
  const result = await prisma.device.aggregate({
    where: { userId, purchaseDate: { gte: start, lt: end } },
    _sum: { purchasePrice: true },
    _count: { _all: true },
  });
  return {
    total: result._sum.purchasePrice ?? 0,
    count: result._count._all,
  };
}

export async function topExpensive(userId: string, limit = 5) {
  return prisma.device.findMany({
    where: { userId },
    orderBy: { purchasePrice: 'desc' },
    take: limit,
    select: {
      id: true,
      name: true,
      brand: true,
      category: true,
      purchasePrice: true,
      purchaseDate: true,
    },
  });
}

export async function activeAssetValue(userId: string) {
  // "Còn bảo hành" = device.status === 'ACTIVE' AND has at least one warranty
  // with endDate > now (any package, including extended/third-party).
  const now = new Date();
  const devices = await prisma.device.findMany({
    where: {
      userId,
      status: 'ACTIVE',
      warranties: { some: { endDate: { gt: now } } },
    },
    select: { purchasePrice: true },
  });
  return {
    total: devices.reduce((sum, d) => sum + d.purchasePrice, 0),
    count: devices.length,
  };
}

export async function getYearsWithData(userId: string): Promise<number[]> {
  const devices = await prisma.device.findMany({
    where: { userId },
    select: { purchaseDate: true },
  });
  const set = new Set<number>();
  for (const d of devices) set.add(d.purchaseDate.getFullYear());
  set.add(new Date().getFullYear());
  return Array.from(set).sort((a, b) => b - a);
}
