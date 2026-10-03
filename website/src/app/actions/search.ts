'use server';

// Server action behind the topbar's global search box. Read-only, one round trip
// to `GET /v1/search` (devices + subscriptions + wishlist grouped).
//
// No `requireUser()`: like the other read actions, this leans on Go's 401 (the
// bearer comes from the cookie through `apiFetch`). A debounced search box that
// redirects the whole app to /login mid-typing would be worse than showing
// "phiên đăng nhập đã hết hạn" inside the dropdown.

import { api } from '@/lib/api';
import {
  describeSearchFailure,
  isBlankQuery,
  normalizeSearchGroups,
  type SearchGroups,
} from '@/lib/search';

export type SearchActionResult =
  | { ok: true; query: string; groups: SearchGroups }
  | { ok: false; message: string };

export async function searchAll(rawQuery: string): Promise<SearchActionResult> {
  const query = typeof rawQuery === 'string' ? rawQuery.trim() : '';

  // Blank query: the contract says 200 + empty groups, and the UI shows an idle
  // hint instead. Skip the round trip entirely — the result is known.
  if (isBlankQuery(query)) {
    return { ok: true, query: '', groups: normalizeSearchGroups(null) };
  }

  const res = await api.search.search(query);
  if (!res.ok) {
    return { ok: false, message: describeSearchFailure(res) };
  }

  // `query` is echoed by the server (trimmed) so the UI can label the results
  // with what was actually matched. Groups are never null, but normalize anyway
  // — this feeds the app shell on every page.
  return {
    ok: true,
    query: typeof res.data.query === 'string' && res.data.query.length > 0 ? res.data.query : query,
    groups: normalizeSearchGroups(res.data),
  };
}
