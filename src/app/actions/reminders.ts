'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth';
import { rateLimitUserWrite } from '@/lib/rate-limit';

async function assertWarrantyOwned(userId: string, warrantyId: string) {
  return prisma.warranty.findFirst({
    where: { id: warrantyId, device: { userId } },
    select: { id: true },
  });
}

export async function dismissWarrantyReminder(warrantyId: string) {
  const user = await requireUser();
  const rl = await rateLimitUserWrite(user.id);
  if (!rl.ok) return { ok: false };

  const owned = await assertWarrantyOwned(user.id, warrantyId);
  if (!owned) return { ok: false };

  const existing = await prisma.reminder.findFirst({
    where: { warrantyId, isDismissed: false },
  });

  if (existing) {
    await prisma.reminder.update({
      where: { id: existing.id },
      data: { isDismissed: true },
    });
  } else {
    await prisma.reminder.create({
      data: { warrantyId, isDismissed: true },
    });
  }

  revalidatePath('/dashboard');
  revalidatePath('/reminders');
  return { ok: true };
}

export async function restoreWarrantyReminder(warrantyId: string) {
  const user = await requireUser();
  const rl = await rateLimitUserWrite(user.id);
  if (!rl.ok) return { ok: false };

  const owned = await assertWarrantyOwned(user.id, warrantyId);
  if (!owned) return { ok: false };

  await prisma.reminder.updateMany({
    where: { warrantyId, isDismissed: true },
    data: { isDismissed: false },
  });
  revalidatePath('/dashboard');
  revalidatePath('/reminders');
  return { ok: true };
}
