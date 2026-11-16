'use server';

// Thin server actions over the live /v1/staples API.
//
// Go owns validation and ownership; these actions only normalize FormData and
// revalidate the two pages that can show a staple. They never touch Device or
// WishlistItem — a restock is not a purchase.

import { revalidatePath } from 'next/cache';
import { api, toFormState, type FormState } from '@/lib/api';
import { getI18n } from '@/lib/i18n/server';
import type { Staple, StapleInput, StapleState } from '@/lib/api/staples';

function s(formData: FormData, key: string): string | null {
  const value = formData.get(key);
  if (value == null || typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function buildInput(formData: FormData): StapleInput {
  const cadenceRaw = s(formData, 'cadenceDays');
  const cadence = cadenceRaw == null ? null : Number(cadenceRaw);
  return {
    name: s(formData, 'name') ?? '',
    category: s(formData, 'category'),
    unit: s(formData, 'unit'),
    cadenceDays:
      cadence != null && Number.isFinite(cadence) ? Math.trunc(cadence) : null,
    lastBoughtAt: s(formData, 'lastBoughtAt'),
    state: (s(formData, 'state') ?? 'ENOUGH') as StapleState,
    notes: s(formData, 'notes'),
  };
}

function inputFromStaple(item: Staple): StapleInput {
  return {
    name: item.name,
    category: item.category,
    unit: item.unit,
    cadenceDays: item.cadenceDays,
    lastBoughtAt: item.lastBoughtAt,
    state: item.state,
    notes: item.notes,
  };
}

function revalidateStaples() {
  revalidatePath('/wishlist/staples');
  revalidatePath('/wishlist');
}

async function findStaple(id: string): Promise<Staple | null> {
  const res = await api.staples.list();
  if (!res.ok) return null;
  return res.data.items.find((item) => item.id === id) ?? null;
}

async function applyUpdate(
  res: Awaited<ReturnType<typeof api.staples.update>>,
): Promise<FormState> {
  if (!res.ok) return toFormState(res);
  revalidateStaples();
  return { ok: true };
}

export async function createStaple(formData: FormData): Promise<FormState> {
  const res = await api.staples.create(buildInput(formData));
  if (!res.ok) return toFormState(res);
  revalidateStaples();
  return { ok: true };
}

export async function updateStaple(
  id: string,
  formData: FormData,
): Promise<FormState> {
  const res = await api.staples.update(id, buildInput(formData));
  if (!res.ok) return toFormState(res);
  revalidateStaples();
  return { ok: true };
}

export async function setStapleState(
  id: string,
  state: StapleState,
): Promise<FormState> {
  const item = await findStaple(id);
  if (!item) {
    const { t } = await getI18n();
    return { ok: false, message: t('Không tìm thấy đồ dùng') };
  }
  const input = inputFromStaple(item);
  input.state = state;
  return applyUpdate(await api.staples.update(id, input));
}

export async function restockStaple(
  id: string,
  lastBoughtAt: string,
): Promise<FormState> {
  const item = await findStaple(id);
  if (!item) {
    const { t } = await getI18n();
    return { ok: false, message: t('Không tìm thấy đồ dùng') };
  }
  const input = inputFromStaple(item);
  input.state = 'ENOUGH';
  input.lastBoughtAt = lastBoughtAt;
  return applyUpdate(await api.staples.update(id, input));
}

export async function deleteStaple(id: string): Promise<FormState> {
  const res = await api.staples.remove(id);
  if (!res.ok) return toFormState(res);
  revalidateStaples();
  return { ok: true };
}
