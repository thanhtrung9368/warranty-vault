// Typed client for the cross-entity search endpoint: `GET /api/v1/search`.
//
// One round trip returns up to `limit` (per group, default 20, max 50) devices,
// subscriptions and wishlist items for the signed-in user. Groups are always
// arrays — never null — and a blank `q` is a 200 with three empty groups, so
// clearing the search box must not surface an error. `q` over 200 runes is a
// 400 whose Vietnamese message is surfaced unchanged.

import { apiFetch, type ApiResult } from './client';
import type { Device } from './devices';
import type { Subscription } from './subscriptions';
import type { WishlistItem } from './wishlist';

// Mirrors services.SearchResults (openapi `SearchResults`). The rows are the
// same projections the per-entity list endpoints return.
export type SearchResults = {
  /** The trimmed query the server actually matched on. */
  query: string;
  devices: Device[];
  subscriptions: Subscription[];
  wishlist: WishlistItem[];
};

export async function search(q: string, limit?: number): Promise<ApiResult<SearchResults>> {
  const params = new URLSearchParams({ q });
  if (typeof limit === 'number' && Number.isFinite(limit)) {
    params.set('limit', String(limit));
  }
  return apiFetch<SearchResults>('GET', `/v1/search?${params.toString()}`);
}
