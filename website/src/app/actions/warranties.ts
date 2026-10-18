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

// `transferable` is a NULLABLE boolean: `null` means "the contract does not
// say", which is not the same answer as an explicit `false`. The form's
// tri-state select submits the literals `'true'` / `'false'` / `'unset'`, so
// anything else — including a missing key from an older form — stays null
// instead of being coerced to false.
function boolOrNull(formData: FormData, key: string): boolean | null {
  const v = formData.get(key);
  if (v === 'true') return true;
  if (v === 'false') return false;
  return null;
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
    // Contract terms. Blank strings/numbers become null (the server's "not
    // recorded" value), and the two non-nullable defaults are explicit:
    // `claimsUsed` is 0 when the input was cleared, matching the wire default.
    // No clamping here — Go is the validator, and a `claimsUsed` it rejects
    // must surface on `fieldErrors.claimsUsed` rather than be silently fixed.
    component: str(formData, 'component') ?? null,
    scope: str(formData, 'scope') ?? null,
    cap: num(formData, 'cap') ?? null,
    deductible: num(formData, 'deductible') ?? null,
    exclusions: str(formData, 'exclusions') ?? null,
    region: str(formData, 'region') ?? null,
    transferable: boolOrNull(formData, 'transferable'),
    claimsAllowed: num(formData, 'claimsAllowed') ?? null,
    claimsUsed: num(formData, 'claimsUsed') ?? 0,
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
