// Pure helpers + copy for the global cross-entity search
// (`GET /api/v1/search`, roadmap #7).
//
// Contract notes taken from openapi.yaml + `api/internal/services/search.go`,
// which this module exists to keep the UI honest about:
//
//   - The three groups are ALWAYS arrays, never null, so the dropdown can
//     iterate unconditionally. `normalizeSearchGroups` still coerces a
//     malformed/absent group to `[]` so a bad response cannot crash the app
//     shell (the topbar is on every page).
//   - `limit` is PER GROUP, default 20, max 50.
//   - A blank `q` is a 200 with three empty groups, not a 400: deleting the last
//     character of a search box must not raise an error. The UI therefore shows
//     an idle prompt for a blank query rather than an error, and never sends the
//     request at all.
//   - `q` longer than 200 RUNES is a 400 whose message the client surfaces
//     unchanged. We deliberately do not pre-validate the length: the server's
//     Vietnamese message is the single source of truth for that rule.
//
// ── Bilingual ─────────────────────────────────────────────────────────────
//
// This module is pure — free of React / server-only imports — so it cannot call
// `useT()` or `getI18n()`. Every sentence-producing helper therefore takes a
// `locale: Locale` and renders through `translate()` (see I18N.md). The
// Vietnamese literal stays the dictionary KEY; English is an added column.
//
// The label maps below (`SEARCH_GROUP_LABELS`) stay Vietnamese on purpose: they
// are the ORIGINAL text and the keys the catalog is looked up by. Callers render
// them with `labelOf(...)`, which returns the Vietnamese value untouched when no
// entry exists.
//
// The placeholder and the two hint sentences are constants for the same reason;
// a call site wraps the constant itself (`t(SEARCH_IDLE_HINT)`).

import { translate } from '@/lib/i18n/catalog';
import type { Locale } from '@/lib/i18n/locale';

export const SEARCH_DEBOUNCE_MS = 300;

/** Per-group cap (openapi `limit`): default 20, maximum 50. */
export const SEARCH_DEFAULT_LIMIT = 20;
export const SEARCH_MAX_LIMIT = 50;

/** Runes, not bytes — mirrors `services.MaxSearchQueryRunes`. */
export const SEARCH_MAX_QUERY_RUNES = 200;

export const SEARCH_PLACEHOLDER = 'Tìm thiết bị, đăng ký, wishlist…';

/**
 * Group headings — the same three sections the sidebar links to, which is why
 * the Vietnamese values are the sidebar's wording (`Thiết bị`, `Gói đăng ký`,
 * `Đang thèm`) rather than a second set of synonyms for them. A dropdown row and
 * the nav item it leads to must read as the same place.
 *
 * Callers render it with `labelOf(SEARCH_GROUP_LABELS, group, locale)`.
 */
export const SEARCH_GROUP_LABELS = {
  devices: 'Thiết bị',
  subscriptions: 'Gói đăng ký',
  wishlist: 'Đang thèm',
} as const;

export const SEARCH_IDLE_HINT = 'Nhập từ khoá để tìm trong thiết bị, đăng ký và wishlist.';
export const SEARCH_LOADING_HINT = 'Đang tìm…';

/**
 * The message shown when the API answers 401. Already registered by
 * `messages/settings.ts`, which owns the account session copy — kept as a
 * constant here so the call site names the sentence instead of hiding it in a
 * branch.
 */
export const SEARCH_SESSION_EXPIRED =
  'Phiên đăng nhập đã hết hạn — tải lại trang để đăng nhập lại.';

// ---- Row shapes --------------------------------------------------------------
//
// Structural (not imported from `@/lib/api/*`) on purpose: that client pulls in
// `@/lib/auth-cookie` → `next/headers`, which must never reach a client bundle.
// The API's full rows are assignable to these.

export type SearchDeviceRow = {
  id: string;
  name: string;
  category?: string | null;
  brand?: string | null;
  model?: string | null;
};

export type SearchSubscriptionRow = {
  id: string;
  name: string;
  brand?: string | null;
  plan?: string | null;
};

export type SearchWishlistRow = {
  id: string;
  name: string;
  brand?: string | null;
};

export type SearchGroups = {
  devices: SearchDeviceRow[];
  subscriptions: SearchSubscriptionRow[];
  wishlist: SearchWishlistRow[];
};

/** Any row, for code that renders the three groups with one component. */
export type SearchResultRow = SearchDeviceRow | SearchSubscriptionRow | SearchWishlistRow;

export type SearchGroupKey = keyof SearchGroups;

/** Group keys in the order the dropdown renders them. */
export const SEARCH_GROUP_ORDER: SearchGroupKey[] = ['devices', 'subscriptions', 'wishlist'];

// ---- Localised copy ----------------------------------------------------------
//
// Only `noResultsMessage` and `describeSearchFailure` need a locale: they build
// a sentence at call time. The placeholders and hints above are constants whose
// value IS the Vietnamese sentence, so a caller wraps the constant itself —
// `t(SEARCH_IDLE_HINT)` — exactly like every other source string.

// ---- State -------------------------------------------------------------------

export type SearchState =
  /** Blank input: nothing was asked, nothing is wrong. */
  | { kind: 'idle' }
  | { kind: 'loading'; query: string }
  | { kind: 'ready'; query: string; groups: SearchGroups }
  | { kind: 'error'; query: string; message: string };

export function isBlankQuery(query: string | null | undefined): boolean {
  return (query ?? '').trim() === '';
}

/** Coerce whatever arrived into three arrays. See the file header. */
export function normalizeSearchGroups(raw: Partial<SearchGroups> | null | undefined): SearchGroups {
  return {
    devices: Array.isArray(raw?.devices) ? raw!.devices : [],
    subscriptions: Array.isArray(raw?.subscriptions) ? raw!.subscriptions : [],
    wishlist: Array.isArray(raw?.wishlist) ? raw!.wishlist : [],
  };
}

export function searchResultCount(groups: SearchGroups): number {
  return groups.devices.length + groups.subscriptions.length + groups.wishlist.length;
}

export function isEmptySearch(groups: SearchGroups): boolean {
  return searchResultCount(groups) === 0;
}

/** "Không tìm thấy kết quả cho “samsung”." — quotes the query the server echoed. */
export function noResultsMessage(query: string, locale: Locale): string {
  const q = query.trim();
  return q.length > 0
    ? translate(locale, 'Không tìm thấy kết quả cho “{query}”.', { query: q })
    : translate(locale, 'Không tìm thấy kết quả nào.');
}

export type SearchFailure = {
  status: number;
  error: string;
  message?: string;
};

/**
 * Message for a failed search call. The server's own message wins whenever it
 * sent one — the only 400 this endpoint produces is "Từ khoá tìm kiếm quá dài
 * (tối đa 200 ký tự)", and `apiFetch` already asked for it in the request's
 * language (it carries `?lang=`), so it must be shown as-is instead of being
 * replaced by a client guess.
 */
export function describeSearchFailure(failure: SearchFailure, locale: Locale): string {
  const serverMessage = typeof failure.message === 'string' ? failure.message.trim() : '';
  if (serverMessage.length > 0) return serverMessage;
  if (failure.status === 0 || failure.error === 'network_error') {
    return translate(locale, 'Mất kết nối tới máy chủ, thử lại sau nhé.');
  }
  if (failure.status === 401) {
    return translate(locale, SEARCH_SESSION_EXPIRED);
  }
  if (failure.status === 429) {
    return translate(locale, 'Thao tác quá nhanh, thử lại sau.');
  }
  if (failure.status === 400) {
    return translate(locale, 'Từ khoá không hợp lệ (tối đa {count} ký tự).', {
      count: SEARCH_MAX_QUERY_RUNES,
    });
  }
  return translate(locale, 'Không tìm kiếm được, thử lại sau.');
}

/** Secondary line of a result row: the fields the endpoint matched on. */
export function searchRowSubtitle(row: {
  brand?: string | null;
  model?: string | null;
  plan?: string | null;
  category?: string | null;
}): string {
  const parts: string[] = [];
  const push = (value: string | null | undefined) => {
    const trimmed = (value ?? '').trim();
    if (trimmed.length > 0 && !parts.includes(trimmed)) parts.push(trimmed);
  };
  push(row.brand);
  push(row.model);
  push(row.plan);
  if (parts.length === 0) push(row.category);
  return parts.join(' · ');
}

/** `…/devices/<id>` — id is URL-encoded; ids come from Go, not from the user. */
export function searchResultHref(group: SearchGroupKey, id: string): string {
  const prefix = group === 'devices' ? 'devices' : group === 'subscriptions' ? 'subscriptions' : 'wishlist';
  return `/${prefix}/${encodeURIComponent(id)}`;
}
