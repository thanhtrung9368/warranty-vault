'use server';

import { api } from '@/lib/api';

// /dashboard and /reminders are both `export const dynamic = 'force-dynamic'`,
// so a revalidatePath here would be a no-op — the caller's router.refresh()
// already re-renders the pages with fresh data.

export async function dismissWarrantyReminder(warrantyId: string) {
  const res = await api.reminders.dismiss(warrantyId);
  if (!res.ok) return { ok: false };

  return { ok: true };
}

export async function restoreWarrantyReminder(warrantyId: string) {
  const res = await api.reminders.restore(warrantyId);
  if (!res.ok) return { ok: false };

  return { ok: true };
}
