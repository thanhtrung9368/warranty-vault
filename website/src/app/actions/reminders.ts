'use server';

import { revalidatePath } from 'next/cache';
import { api } from '@/lib/api';

export async function dismissWarrantyReminder(warrantyId: string) {
  const res = await api.reminders.dismiss(warrantyId);
  if (!res.ok) return { ok: false };

  revalidatePath('/dashboard');
  revalidatePath('/reminders');
  return { ok: true };
}

export async function restoreWarrantyReminder(warrantyId: string) {
  const res = await api.reminders.restore(warrantyId);
  if (!res.ok) return { ok: false };

  revalidatePath('/dashboard');
  revalidatePath('/reminders');
  return { ok: true };
}
