'use server';

import { redirect } from 'next/navigation';
import { api, toFormState, type FormState } from '@/lib/api';
import type { WarrantyInput } from '@/lib/api/warranties';

export type WarrantyFormState = FormState;

function str(formData: FormData, key: string): string | undefined {
  const v = formData.get(key);
  if (typeof v !== 'string' || v === '') return undefined;
  return v;
}

function num(formData: FormData, key: string): number | undefined {
  const v = formData.get(key);
  if (typeof v !== 'string' || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function buildWarrantyInput(formData: FormData): WarrantyInput {
  const cost = num(formData, 'cost');
  return {
    type: (str(formData, 'type') ?? 'STANDARD') as WarrantyInput['type'],
    provider: str(formData, 'provider') ?? null,
    startDate: str(formData, 'startDate') ?? '',
    months: num(formData, 'months') ?? 0,
    cost: cost ?? null,
    address: str(formData, 'address') ?? null,
    phone: str(formData, 'phone') ?? null,
    notes: str(formData, 'notes') ?? null,
  };
}

export async function createWarranty(
  deviceId: string,
  _prev: WarrantyFormState,
  formData: FormData,
): Promise<WarrantyFormState> {
  const input = buildWarrantyInput(formData);
  const res = await api.warranties.create(deviceId, input);
  if (!res.ok) return toFormState(res);

  // No revalidatePath: /dashboard, /devices, /devices/[id] and /reminders are
  // all `force-dynamic`, so path revalidation would be a no-op.
  redirect(`/devices/${deviceId}`);
}

export async function updateWarranty(
  warrantyId: string,
  _prev: WarrantyFormState,
  formData: FormData,
): Promise<WarrantyFormState> {
  const input = buildWarrantyInput(formData);
  const res = await api.warranties.update(warrantyId, input);
  if (!res.ok) return toFormState(res);

  const deviceId = res.data.deviceId;
  // No revalidatePath — affected pages are all `force-dynamic`.
  redirect(`/devices/${deviceId}`);
}

export async function deleteWarranty(warrantyId: string) {
  const res = await api.warranties.remove(warrantyId);
  if (!res.ok) return { ok: false };
  // No revalidatePath — the affected pages are all `force-dynamic`; the
  // caller's redirect/refresh re-renders them with fresh data.
  return { ok: true };
}
