'use server';

import { redirect } from 'next/navigation';
import { api, toFormState, type FormState } from '@/lib/api';
import type { DeviceInput } from '@/lib/api/devices';

export type DeviceFormState = FormState;

// Pull a string FormData entry, converting empty / non-string to undefined so
// the Go Zod-equivalent validator's blank-to-null preprocess kicks in.
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

function buildDeviceInput(formData: FormData): DeviceInput {
  // Required fields are surfaced as empty strings — server returns 400 with
  // Vietnamese fieldErrors which are passed through as-is.
  const status = str(formData, 'status');
  return {
    name: str(formData, 'name') ?? '',
    category: str(formData, 'category') ?? '',
    brand: str(formData, 'brand') ?? null,
    model: str(formData, 'model') ?? null,
    serialNumber: str(formData, 'serialNumber') ?? null,
    purchaseDate: str(formData, 'purchaseDate') ?? '',
    purchasePrice: num(formData, 'purchasePrice') ?? 0,
    purchasePlace: str(formData, 'purchasePlace') ?? null,
    status: status as DeviceInput['status'],
    notes: str(formData, 'notes') ?? null,
    warrantyMonths: num(formData, 'warrantyMonths') ?? 0,
    warrantyProvider: str(formData, 'warrantyProvider') ?? null,
    warrantyAddress: str(formData, 'warrantyAddress') ?? null,
    warrantyPhone: str(formData, 'warrantyPhone') ?? null,
    warrantyNotes: str(formData, 'warrantyNotes') ?? null,
  };
}

export async function createDevice(
  _prev: DeviceFormState,
  formData: FormData,
): Promise<DeviceFormState> {
  const input = buildDeviceInput(formData);
  const fromWishlistId = str(formData, 'fromWishlistId') ?? null;

  const res = await api.devices.create({ ...input, fromWishlistId });
  if (!res.ok) return toFormState(res);

  // No revalidatePath: every page that reads this data (/dashboard, /devices,
  // /reminders, /wishlist[/id]) is `export const dynamic = 'force-dynamic'`,
  // so a path revalidation would be a no-op anyway.
  redirect(`/devices/${res.data.id}`);
}

export async function updateDevice(
  id: string,
  _prev: DeviceFormState,
  formData: FormData,
): Promise<DeviceFormState> {
  const input = buildDeviceInput(formData);
  const res = await api.devices.update(id, input);
  if (!res.ok) return toFormState(res);

  // No revalidatePath — the affected pages are all `force-dynamic` (see createDevice).
  redirect(`/devices/${id}`);
}

export async function deleteDevice(id: string) {
  // Best-effort delete; either way redirect back to the list. The Go service
  // 404s for not-found / not-owned, which we treat as a successful no-op.
  await api.devices.remove(id);
  // No revalidatePath — the affected pages are all `force-dynamic`.
  redirect('/devices');
}
