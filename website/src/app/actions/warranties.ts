'use server';

import { revalidatePath } from 'next/cache';
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

  revalidatePath('/dashboard');
  revalidatePath('/devices');
  revalidatePath(`/devices/${deviceId}`);
  revalidatePath('/reminders');
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
  revalidatePath('/dashboard');
  revalidatePath('/devices');
  revalidatePath(`/devices/${deviceId}`);
  revalidatePath('/reminders');
  redirect(`/devices/${deviceId}`);
}

export async function deleteWarranty(warrantyId: string) {
  const res = await api.warranties.remove(warrantyId);
  if (!res.ok) return { ok: false };
  // We don't know the deviceId after delete — revalidate the broad routes
  // and let the caller's redirect/refresh handle the device-detail bust.
  revalidatePath('/dashboard');
  revalidatePath('/devices');
  revalidatePath('/reminders');
  return { ok: true };
}
