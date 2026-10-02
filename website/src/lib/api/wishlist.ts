// Typed client for /v1/wishlist on the Go service.
//
// Note on `update`: when the input includes `status: 'PURCHASED'`, the Go
// service handles the transactional Device-creation flow (see openapi.yaml
// + BACKEND_GO_PLAN.md C.5). The web action is a thin proxy — no extra
// client-side coordination needed.

import { apiFetch, type ApiResult } from './client';

export type WishlistItem = {
  id: string;
  userId?: string;
  name: string;
  category: string | null;
  brand: string | null;
  initialPrice: number | null;
  currentPrice: number | null;
  buyUrl: string | null;
  imageUrl: string | null;
  targetDate: string | null;
  priority: 'MUST' | 'WANT' | 'MAYBE';
  status: 'WATCHING' | 'DECIDED' | 'SKIPPED' | 'PURCHASED';
  notes: string | null;
  reminderIntervalDays: number | null;
  lastNotifiedAt?: string | null;
  purchasedDeviceId: string | null;
  createdAt?: string;
  updatedAt?: string;
};

export type WishlistPrice = {
  id: string;
  itemId: string;
  price: number;
  note: string | null;
  recordedAt: string;
};

export type WishlistDetail = {
  item: WishlistItem;
  prices: WishlistPrice[];
};

export type WishlistInput = {
  name: string;
  category?: string | null;
  brand?: string | null;
  initialPrice?: number | null;
  currentPrice?: number | null;
  buyUrl?: string | null;
  imageUrl?: string | null;
  targetDate?: string | null;
  priority?: WishlistItem['priority'];
  status?: WishlistItem['status'];
  notes?: string | null;
  reminderIntervalDays?: number | null;
};

export type PriceLogInput = {
  price: number;
  note?: string | null;
};

export type WishlistFilter = {
  q?: string;
  category?: string;
  status?: string;
  priority?: string;
  sort?: string;
  dir?: 'asc' | 'desc';
};

function buildQuery(filter: WishlistFilter | undefined): string {
  if (!filter) return '';
  const sp = new URLSearchParams();
  if (filter.q) sp.set('q', filter.q);
  if (filter.category) sp.set('category', filter.category);
  // `ALL` is a UI sentinel (wishlist-filter-bar). Go's list handler only
  // accepts the four real statuses and answers 400 `bad_input` for anything
  // else, so strip it — same convention as `lib/api/devices.ts`.
  if (filter.status && filter.status !== 'ALL') sp.set('status', filter.status);
  if (filter.priority) sp.set('priority', filter.priority);
  if (filter.sort) sp.set('sort', filter.sort);
  if (filter.dir) sp.set('dir', filter.dir);
  const q = sp.toString();
  return q ? `?${q}` : '';
}

export async function list(
  filter?: WishlistFilter,
): Promise<ApiResult<{ items: WishlistItem[] }>> {
  return apiFetch<{ items: WishlistItem[] }>('GET', `/v1/wishlist${buildQuery(filter)}`);
}

export async function get(id: string): Promise<ApiResult<WishlistDetail>> {
  return apiFetch<WishlistDetail>('GET', `/v1/wishlist/${encodeURIComponent(id)}`);
}

export async function create(
  input: WishlistInput,
): Promise<ApiResult<{ item: WishlistItem }>> {
  return apiFetch<{ item: WishlistItem }>('POST', '/v1/wishlist', input);
}

// `update` doubles as the status-transition endpoint (including PURCHASED,
// which triggers Device creation server-side).
export async function update(
  id: string,
  input: WishlistInput,
): Promise<ApiResult<{ ok: boolean }>> {
  return apiFetch<{ ok: boolean }>(
    'PATCH',
    `/v1/wishlist/${encodeURIComponent(id)}`,
    input,
  );
}

export async function remove(id: string): Promise<ApiResult<{ ok: boolean }>> {
  return apiFetch<{ ok: boolean }>('DELETE', `/v1/wishlist/${encodeURIComponent(id)}`);
}

export async function updatePrice(
  id: string,
  body: PriceLogInput,
): Promise<ApiResult<{ ok: boolean }>> {
  return apiFetch<{ ok: boolean }>(
    'POST',
    `/v1/wishlist/${encodeURIComponent(id)}/prices`,
    body,
  );
}
