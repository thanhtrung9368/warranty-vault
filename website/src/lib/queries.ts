import { prisma } from '@/lib/prisma';

export async function countActiveReminders(userId: string): Promise<number> {
  const now = new Date();
  const in30 = new Date();
  in30.setDate(now.getDate() + 30);

  const warranties = await prisma.warranty.findMany({
    where: {
      device: { userId, status: 'ACTIVE' },
      endDate: { gte: now, lte: in30 },
    },
    select: {
      id: true,
      reminders: { where: { isDismissed: true }, select: { id: true } },
    },
  });
  return warranties.filter((w) => w.reminders.length === 0).length;
}
