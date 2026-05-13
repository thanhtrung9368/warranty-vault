import { prisma } from '@/lib/prisma';
import type { WarrantyType } from '@/lib/types';

export type ReminderBucket = '30' | '60' | '90' | 'EXPIRED';

export type ReminderRow = {
  warrantyId: string;
  deviceId: string;
  deviceName: string;
  category: string;
  brand: string | null;
  warrantyType: WarrantyType;
  warrantyProvider: string | null;
  endDate: Date;
  bucket: ReminderBucket;
  isDismissed: boolean;
};

export async function getReminders(userId: string): Promise<ReminderRow[]> {
  const now = new Date();
  const in90 = new Date();
  in90.setDate(now.getDate() + 90);
  const recentlyExpired = new Date();
  recentlyExpired.setDate(now.getDate() - 30);

  const warranties = await prisma.warranty.findMany({
    where: {
      device: { userId, status: 'ACTIVE' },
      endDate: { gte: recentlyExpired, lte: in90 },
    },
    orderBy: { endDate: 'asc' },
    include: {
      device: { select: { id: true, name: true, category: true, brand: true } },
      reminders: { where: { isDismissed: true } },
    },
  });

  return warranties.map((w) => {
    const days = Math.round(
      (w.endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
    );
    let bucket: ReminderBucket = '90';
    if (days < 0) bucket = 'EXPIRED';
    else if (days <= 30) bucket = '30';
    else if (days <= 60) bucket = '60';
    else bucket = '90';
    return {
      warrantyId: w.id,
      deviceId: w.device.id,
      deviceName: w.device.name,
      category: w.device.category,
      brand: w.device.brand,
      warrantyType: w.type as WarrantyType,
      warrantyProvider: w.provider,
      endDate: w.endDate,
      bucket,
      isDismissed: w.reminders.length > 0,
    };
  });
}
