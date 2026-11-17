// Typed client for /v1/staples ("đồ dùng thiết yếu").
//
// The Go service is the source of truth for ownership/validation. This module
// only maps the wire shape; there is deliberately no device coupling —
// restocking shampoo may record a price, but it must never create a Device.
// The purchase endpoints are append-only: no update, no delete.

import { apiFetch, type ApiResult } from './client';

export type StapleState = 'ENOUGH' | 'LOW' | 'OUT';

export type Staple = {
  id: string;
  userId?: string;
  name: string;
  category: string | null;
  unit: string | null;
  cadenceDays: number | null;
  /** Calendar day (`YYYY-MM-DD`) of the latest recorded purchase, or null. */
  lastBoughtAt: string | null;
  state: StapleState;
  notes: string | null;
  /**
   * Server-computed summary of this staple's `StaplePurchase` rows (VND).
   * `lastPrice` / `lowestPrice` / `averagePrice` are null when there is no
   * purchase; `purchaseCount` is then 0. The web never derives these from a
   * separate list — the list payload carries them.
   */
  lastPrice: number | null;
  lowestPrice: number | null;
  averagePrice: number | null;
  purchaseCount: number;
  createdAt?: string;
  updatedAt?: string;
};

/** One recorded restock with its price — the staple's price history. */
export type StaplePurchase = {
  id: string;
  stapleId: string;
  /** VND, integer >= 0. */
  price: number;
  /** Calendar day (`YYYY-MM-DD`) the purchase happened. */
  purchasedAt: string;
  store: string | null;
  note: string | null;
  createdAt: string;
};

export type StaplePurchaseInput = {
  price: number;
  purchasedAt: string;
  store?: string | null;
  note?: string | null;
};

export type StapleInput = {
  name: string;
  category?: string | null;
  unit?: string | null;
  cadenceDays?: number | null;
  lastBoughtAt?: string | null;
  state?: StapleState;
  notes?: string | null;
};

/** The API lists all states; the UI groups them. */
export async function list(): Promise<ApiResult<{ items: Staple[] }>> {
  return apiFetch<{ items: Staple[] }>('GET', '/v1/staples');
}

export async function create(
  input: StapleInput,
): Promise<ApiResult<{ item: Staple }>> {
  return apiFetch<{ item: Staple }>('POST', '/v1/staples', input);
}

export async function update(
  id: string,
  input: StapleInput,
): Promise<ApiResult<{ item: Staple }>> {
  return apiFetch<{ item: Staple }>(
    'PATCH',
    `/v1/staples/${encodeURIComponent(id)}`,
    input,
  );
}

export async function remove(id: string): Promise<ApiResult<{ ok: boolean }>> {
  return apiFetch<{ ok: boolean }>(
    'DELETE',
    `/v1/staples/${encodeURIComponent(id)}`,
  );
}

/**
 * Price history for one staple, newest purchase first (the server's order).
 * Empty list — never null — when nothing has been recorded yet.
 */
export async function listPurchases(
  id: string,
): Promise<ApiResult<{ items: StaplePurchase[] }>> {
  return apiFetch<{ items: StaplePurchase[] }>(
    'GET',
    `/v1/staples/${encodeURIComponent(id)}/purchases`,
  );
}

/**
 * Record one purchase. Go writes it in a single transaction (insert the row,
 * advance `lastBoughtAt` only forward, set the staple back to ENOUGH) and
 * answers with the purchase plus the updated staple summary.
 */
export async function createPurchase(
  id: string,
  input: StaplePurchaseInput,
): Promise<ApiResult<{ purchase: StaplePurchase; item: Staple }>> {
  return apiFetch<{ purchase: StaplePurchase; item: Staple }>(
    'POST',
    `/v1/staples/${encodeURIComponent(id)}/purchases`,
    input,
  );
}
