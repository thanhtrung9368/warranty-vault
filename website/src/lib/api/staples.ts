// Typed client for /v1/staples ("đồ dùng thiết yếu").
//
// The Go service is the source of truth for ownership/validation. This module
// only maps the wire shape; there is deliberately no price/device coupling —
// restocking shampoo must never create a Device.

import { apiFetch, type ApiResult } from './client';

export type StapleState = 'ENOUGH' | 'LOW' | 'OUT';

export type Staple = {
  id: string;
  userId?: string;
  name: string;
  category: string | null;
  unit: string | null;
  cadenceDays: number | null;
  /** Calendar day (`YYYY-MM-DD`) of the last restock, or null. */
  lastBoughtAt: string | null;
  state: StapleState;
  notes: string | null;
  createdAt?: string;
  updatedAt?: string;
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
