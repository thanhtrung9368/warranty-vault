'use server';

// Thin proxy actions over the Go REST client. No Prisma, no rate-limit.
// `markWishlistPurchased`: the old version called a service that wrote
// `purchasedDeviceId` directly. Under Go, the user updates the wishlist
// item with `status='PURCHASED'` and the Go service handles the linkage
// in a transaction (creating a Device row when needed). Here we just
// forward the status flip and pass `purchasedDeviceId` if the caller has
// a specific device to link.

import { redirect } from 'next/navigation';
import { api, toFormState, type FormState } from '@/lib/api';
import type { WishlistInput, PriceLogInput } from '@/lib/api/wishlist';

// No revalidatePath: /wishlist, /wishlist/[id] and /dashboard are all
// `export const dynamic = 'force-dynamic'`, so path revalidation is a no-op.
// The caller's redirect / router.refresh() re-renders with fresh data.

export type WishlistFormState = FormState;

function s(formData: FormData, key: string): string | null {
  const v = formData.get(key);
  if (v == null || typeof v !== 'string') return null;
  const trimmed = v.trim();
  return trimmed === '' ? null : trimmed;
}

function n(formData: FormData, key: string): number | null {
  const raw = s(formData, key);
  if (raw == null) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildWishlistInput(formData: FormData): WishlistInput {
  return {
    name: s(formData, 'name') ?? '',
    category: s(formData, 'category'),
    brand: s(formData, 'brand'),
    initialPrice: n(formData, 'initialPrice'),
    currentPrice: n(formData, 'currentPrice'),
    buyUrl: s(formData, 'buyUrl'),
    imageUrl: s(formData, 'imageUrl'),
    targetDate: s(formData, 'targetDate'),
    priority: (s(formData, 'priority') ?? 'WANT') as WishlistInput['priority'],
    status: (s(formData, 'status') ?? 'WATCHING') as WishlistInput['status'],
    notes: s(formData, 'notes'),
    reminderIntervalDays: n(formData, 'reminderIntervalDays'),
  };
}

export async function createWishlistItem(
  _prev: WishlistFormState,
  formData: FormData,
): Promise<WishlistFormState> {
  const input = buildWishlistInput(formData);
  const res = await api.wishlist.create(input);
  if (!res.ok) return toFormState(res);

  redirect(`/wishlist/${res.data.item.id}`);
}

export async function updateWishlistItem(
  id: string,
  _prev: WishlistFormState,
  formData: FormData,
): Promise<WishlistFormState> {
  const input = buildWishlistInput(formData);
  const res = await api.wishlist.update(id, input);
  if (!res.ok) return toFormState(res);

  redirect(`/wishlist/${id}`);
}

export async function logWishlistPrice(
  id: string,
  formData: FormData,
): Promise<WishlistFormState> {
  const body: PriceLogInput = {
    price: n(formData, 'price') ?? 0,
    note: s(formData, 'note'),
  };
  const res = await api.wishlist.updatePrice(id, body);
  if (!res.ok) return toFormState(res);
  return { ok: true };
}

// Quick status flip. Go's PATCH validator requires name; we fetch first,
// merge, then submit.
export async function setWishlistStatus(id: string, status: string) {
  const cur = await api.wishlist.get(id);
  if (!cur.ok) return { ok: false };
  const it = cur.data.item;
  const res = await api.wishlist.update(id, {
    name: it.name,
    category: it.category,
    brand: it.brand,
    initialPrice: it.initialPrice,
    currentPrice: it.currentPrice,
    buyUrl: it.buyUrl,
    imageUrl: it.imageUrl,
    targetDate: it.targetDate,
    priority: it.priority,
    status: status as WishlistInput['status'],
    notes: it.notes,
    reminderIntervalDays: it.reminderIntervalDays,
  });
  if (!res.ok) return { ok: false };
  return { ok: true };
}

export async function deleteWishlistItem(id: string) {
  const res = await api.wishlist.remove(id);
  if (!res.ok) redirect('/wishlist');
  redirect('/wishlist');
}

// Mark as purchased — called after a Device is created from the wishlist
// flow. Fetch the existing item, merge purchasedDeviceId + PURCHASED, then
// PATCH. Go ignores `purchasedDeviceId` if it's not on WishlistInput yet,
// so this is a soft hint until the field lands in openapi.yaml.
export async function markWishlistPurchased(itemId: string, deviceId: string) {
  const cur = await api.wishlist.get(itemId);
  if (!cur.ok) return;
  const it = cur.data.item;
  const res = await api.wishlist.update(itemId, {
    name: it.name,
    category: it.category,
    brand: it.brand,
    initialPrice: it.initialPrice,
    currentPrice: it.currentPrice,
    buyUrl: it.buyUrl,
    imageUrl: it.imageUrl,
    targetDate: it.targetDate,
    priority: it.priority,
    status: 'PURCHASED',
    notes: it.notes,
    reminderIntervalDays: it.reminderIntervalDays,
    // Opaque hint — see openapi gap noted in BACKEND_GO_PLAN Phase F.
    purchasedDeviceId: deviceId,
  } as unknown as WishlistInput);
  if (!res.ok) return;
}
