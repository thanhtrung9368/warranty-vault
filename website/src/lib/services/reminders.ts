import { prisma } from '@/lib/prisma';
import { DomainError } from '@/lib/services/errors';

/**
 * Upcoming warranty reminders for the mobile / dashboard view.
 *
 * Returns warranties whose `endDate` falls within `[today, today + withinDays]`,
 * for devices with `status = ACTIVE`, that have no `Reminder.isDismissed = true`
 * row. Sorted by `endDate asc` so the most-urgent warranty is first. Each row
 * includes a small `device` projection so mobile clients can render the card
 * without a second round-trip.
 */
export async function listUpcomingReminders(userId: string, withinDays = 30) {
  // Snap "today" to midnight so a warranty ending today is included regardless
  // of the time of day the request fires.
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const horizon = new Date(startOfToday);
  horizon.setDate(horizon.getDate() + withinDays);
  // Include the entire `endDate + withinDays` calendar day.
  horizon.setHours(23, 59, 59, 999);

  return prisma.warranty.findMany({
    where: {
      device: { userId, status: 'ACTIVE' },
      endDate: { gte: startOfToday, lte: horizon },
      // No Reminder row OR no dismissed Reminder row → both pass.
      reminders: { none: { isDismissed: true } },
    },
    orderBy: { endDate: 'asc' },
    include: {
      device: { select: { id: true, name: true, category: true } },
    },
  });
}

async function assertWarrantyOwned(userId: string, warrantyId: string) {
  const owned = await prisma.warranty.findFirst({
    where: { id: warrantyId, device: { userId } },
    select: { id: true },
  });
  if (!owned) throw new DomainError('NOT_FOUND', 'Không tìm thấy gói bảo hành');
}

export async function dismissWarrantyReminder(userId: string, warrantyId: string) {
  await assertWarrantyOwned(userId, warrantyId);

  const existing = await prisma.reminder.findFirst({
    where: { warrantyId, isDismissed: false },
  });
  if (existing) {
    await prisma.reminder.update({
      where: { id: existing.id },
      data: { isDismissed: true },
    });
  } else {
    await prisma.reminder.create({ data: { warrantyId, isDismissed: true } });
  }
}

export async function restoreWarrantyReminder(userId: string, warrantyId: string) {
  await assertWarrantyOwned(userId, warrantyId);
  await prisma.reminder.updateMany({
    where: { warrantyId, isDismissed: true },
    data: { isDismissed: false },
  });
}
