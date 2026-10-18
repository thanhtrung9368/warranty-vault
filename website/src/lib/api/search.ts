// Typed client for the cross-entity search endpoint: `GET /api/v1/search`.
//
// One round trip returns up to `limit` (per group, default 20, max 50) devices,
// subscriptions, wishlist items and OCR'd attachments for the signed-in user.
// Groups are always arrays — never null — and a blank `q` is a 200 with four
// empty groups, so clearing the search box must not surface an error. `q` over
// 200 runes is a 400 whose Vietnamese message is surfaced unchanged.

import { apiFetch, type ApiResult } from './client';
import type { AttachmentMeta, Device } from './devices';
import type { Subscription } from './subscriptions';
import type { WishlistItem } from './wishlist';

// The `attachments` hit is the public attachment shape plus the owning device
// id (openapi `AttachmentSearchHit`). `deviceId: null` means the file is still
// in the inbox; it is always present, unlike `extractedText`.
export type AttachmentSearchHit = AttachmentMeta & { deviceId: string | null };

// Mirrors services.SearchResults (openapi `SearchResults`). The entity rows are
// the same projections the per-entity list endpoints return; the attachment
// group is matched on `extractedText` only (fileName/description are not in the
// index).
export type SearchResults = {
  /** The trimmed query the server actually matched on. */
  query: string;
  devices: Device[];
  subscriptions: Subscription[];
  wishlist: WishlistItem[];
  attachments: AttachmentSearchHit[];
};

export async function search(q: string, limit?: number): Promise<ApiResult<SearchResults>> {
  const params = new URLSearchParams({ q });
  if (typeof limit === 'number' && Number.isFinite(limit)) {
    params.set('limit', String(limit));
  }
  return apiFetch<SearchResults>('GET', `/v1/search?${params.toString()}`);
}
