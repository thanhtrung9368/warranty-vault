'use server';

import { redirect } from 'next/navigation';
import { api, toFormState, type FormState } from '@/lib/api';
import type { DeviceInput } from '@/lib/api/devices';
import {
  clearDeviceWarningsFlash,
  setDeviceWarningsFlash,
} from '@/lib/device-warnings-flash';

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
  // Resale pair: both keys are ALWAYS sent, so "no sale" is an explicit
  // `{soldAt: null, soldPrice: null}` (the server's clear signal) rather than
  // one key silently going missing and tripping the pair rule. `num()` keeps a
  // legitimate `0` (cho tặng) — only a blank/!finite value becomes null.
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
    soldAt: str(formData, 'soldAt') ?? null,
    soldPrice: num(formData, 'soldPrice') ?? null,
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

  // The device WAS created — `warnings` are advisory findings about the serial
  // (wrong IMEI checksum, odd length, a serial already used on another device).
  // They cannot ride on the redirect, so they are flashed to the device page,
  // which renders them above the saved values. Empty list → no cookie at all.
  await setDeviceWarningsFlash(res.data.device.id, res.data.warnings);

  // No revalidatePath: every page that reads this data (/dashboard, /devices,
  // /reminders, /wishlist[/id]) is `export const dynamic = 'force-dynamic'`,
  // so a path revalidation would be a no-op anyway.
  redirect(`/devices/${res.data.device.id}`);
}

export async function updateDevice(
  id: string,
  _prev: DeviceFormState,
  formData: FormData,
): Promise<DeviceFormState> {
  const input = buildDeviceInput(formData);
  const res = await api.devices.update(id, input);
  if (!res.ok) return toFormState(res);

  // Same advisory channel as create, keyed to the device being edited so the
  // banner cannot surface on another device's page. Go excludes the device being
  // edited from the duplicate check, so re-saving the same serial warns about
  // nothing.
  await setDeviceWarningsFlash(res.data.device.id || id, res.data.warnings);

  // No revalidatePath — the affected pages are all `force-dynamic` (see createDevice).
  redirect(`/devices/${id}`);
}

// Called by `DeviceWarningsBanner` once the flash has been displayed, so a saved
// serial that looks wrong is reported exactly once (not on every later render).
export async function dismissDeviceWarnings(): Promise<void> {
  await clearDeviceWarningsFlash();
}

export async function deleteDevice(id: string) {
  // Best-effort delete; either way redirect back to the list. The Go service
  // 404s for not-found / not-owned, which we treat as a successful no-op.
  await api.devices.remove(id);
  // No revalidatePath — the affected pages are all `force-dynamic`.
  redirect('/devices');
}
