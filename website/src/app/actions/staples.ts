'use server';

// Thin server actions over the live /v1/staples API.
//
// Go owns validation and ownership; these actions only normalize FormData and
// revalidate the two pages that can show a staple. A purchase records a price
// against the staple and nothing else — it never touches Device or WishlistItem,
// and there is deliberately no no-price "restock" path left.

import { revalidatePath } from 'next/cache';
import { api, toFormState, type ApiResult, type FormState } from '@/lib/api';
import { getI18n } from '@/lib/i18n/server';
import { dayToInputValue } from '@/lib/api-day';
import type {
  Staple,
  StapleInput,
  StaplePurchase,
  StapleState,
} from '@/lib/api/staples';

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

  // Optional first purchase price from the add form. If it fails, the item
  // still exists; the user can record the price from the card's menu.
  const priceRaw = s(formData, 'price');
  const price = priceRaw == null ? 0 : Number(priceRaw);
  if (Number.isFinite(price) && price > 0) {
    const purchaseRes = await api.staples.createPurchase(res.data.item.id, {
      price: Math.trunc(price),
      purchasedAt: s(formData, 'lastBoughtAt') ?? dayToInputValue(new Date()),
      store: s(formData, 'store'),
      note: s(formData, 'notes'),
    });
    revalidateStaples();
    if (!purchaseRes.ok) {
      const purchaseState = await toFormState(purchaseRes);
      return { ok: true, message: purchaseState.message };
    }
    return { ok: true };
  }

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

/**
 * The staple's price history, newest purchase first (the server's order).
 * Read-only: the history dialog calls this every time it opens.
 */
export async function getStaplePurchases(
  id: string,
): Promise<ApiResult<{ items: StaplePurchase[] }>> {
  return api.staples.listPurchases(id);
}

/**
 * Record one purchase. The insert, the `lastBoughtAt` advance and the reset to
 * ENOUGH happen in Go's one transaction — this action only normalizes the form
 * and revalidates. There is no way to restock without a price any more.
 */
export async function addStaplePurchase(
  id: string,
  formData: FormData,
): Promise<FormState> {
  const priceRaw = s(formData, 'price');
  const price = priceRaw == null ? Number.NaN : Number(priceRaw);
  if (!Number.isInteger(price) || price < 0) {
    const { t } = await getI18n();
    return { ok: false, errors: { price: [t('Nhập giá hợp lệ')] } };
  }
  const res = await api.staples.createPurchase(id, {
    price,
    purchasedAt: s(formData, 'purchasedAt') ?? '',
    store: s(formData, 'store'),
    note: s(formData, 'note'),
  });
  if (!res.ok) return toFormState(res);
  revalidateStaples();
  return { ok: true };
}

export async function deleteStaple(id: string): Promise<FormState> {
  const res = await api.staples.remove(id);
  if (!res.ok) return toFormState(res);
  revalidateStaples();
  return { ok: true };
}
