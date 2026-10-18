// Pure helpers + copy for the global cross-entity search
// (`GET /api/v1/search`, roadmap #7 and #13).
//
// Contract notes taken from openapi.yaml + `api/internal/services/search.go`,
// which this module exists to keep the UI honest about:
//
//   - The four groups (devices / subscriptions / wishlist / attachments) are
//     ALWAYS arrays, never null, so the dropdown can iterate unconditionally.
//     `normalizeSearchGroups` still coerces a malformed/absent group to `[]` so
//     a bad response cannot crash the app shell (the topbar is on every page).
//   - `limit` is PER GROUP, default 20, max 50.
//   - A blank `q` is a 200 with four empty groups, not a 400: deleting the last
//     character of a search box must not raise an error. The UI therefore shows
//     an idle prompt for a blank query rather than an error, and never sends the
//     request at all.
//   - `q` longer than 200 RUNES is a 400 whose message the client surfaces
//     unchanged. We deliberately do not pre-validate the length: the server's
//     Vietnamese message is the single source of truth for that rule.
//   - The `attachments` group matches OCR transcript text only. A file that was
//     never scanned has no `extractedText` and can never hit, so the group is
//     `[]` for an account that has not used the scan feature.
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
import { formatDate } from '@/lib/format';

export const SEARCH_DEBOUNCE_MS = 300;

/** Per-group cap (openapi `limit`): default 20, maximum 50. */
export const SEARCH_DEFAULT_LIMIT = 20;
export const SEARCH_MAX_LIMIT = 50;

/** Runes, not bytes — mirrors `services.MaxSearchQueryRunes`. */
export const SEARCH_MAX_QUERY_RUNES = 200;

export const SEARCH_PLACEHOLDER = 'Tìm thiết bị, đăng ký, wishlist, hoá đơn…';

/**
 * Group headings — the same sections the sidebar links to, which is why the
 * Vietnamese values use the nav's wording (`Thiết bị`, `Gói đăng ký`,
 * `Đang thèm`) rather than a second set of synonyms for them. A dropdown row and
 * the nav item it leads to must read as the same place.
 *
 * `attachments` is the OCR-text group (roadmap #13). It is a result TYPE, not a
 * nav destination: a hit links to its device (or to the inbox when it is
 * unfiled), which is why the label describes the files rather than a section.
 *
 * Callers render it with `labelOf(SEARCH_GROUP_LABELS, group, locale)`.
 */
export const SEARCH_GROUP_LABELS = {
  devices: 'Thiết bị',
  subscriptions: 'Gói đăng ký',
  wishlist: 'Đang thèm',
  attachments: 'Hoá đơn đã quét',
} as const;

export const SEARCH_IDLE_HINT =
  'Nhập từ khoá để tìm trong thiết bị, đăng ký, wishlist và nội dung hoá đơn đã quét.';
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

/**
 * One `attachments` hit (openapi `AttachmentSearchHit`): the public attachment
 * shape plus the owning device id. `deviceId: null` means the file is still in
 * the inbox; `extractedText` is absent for a file that was never OCR'd.
 */
export type SearchAttachmentRow = {
  id: string;
  fileName: string;
  uploadedAt?: string | null;
  fileType?: string | null;
  extractedText?: string | null;
  deviceId: string | null;
};

export type SearchGroups = {
  devices: SearchDeviceRow[];
  subscriptions: SearchSubscriptionRow[];
  wishlist: SearchWishlistRow[];
  attachments: SearchAttachmentRow[];
};

/** Any entity row, for code that renders the three entity groups with one component. */
export type SearchResultRow = SearchDeviceRow | SearchSubscriptionRow | SearchWishlistRow;

export type EntitySearchGroupKey = 'devices' | 'subscriptions' | 'wishlist';
export type SearchGroupKey = keyof SearchGroups;

/** Group keys in the order the dropdown renders them. */
export const SEARCH_GROUP_ORDER: SearchGroupKey[] = [
  'devices',
  'subscriptions',
  'wishlist',
  'attachments',
];

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

/** Coerce whatever arrived into four arrays. See the file header. */
export function normalizeSearchGroups(raw: Partial<SearchGroups> | null | undefined): SearchGroups {
  return {
    devices: Array.isArray(raw?.devices) ? raw!.devices : [],
    subscriptions: Array.isArray(raw?.subscriptions) ? raw!.subscriptions : [],
    wishlist: Array.isArray(raw?.wishlist) ? raw!.wishlist : [],
    attachments: Array.isArray(raw?.attachments) ? raw!.attachments : [],
  };
}

export function searchResultCount(groups: SearchGroups): number {
  return (
    groups.devices.length +
    groups.subscriptions.length +
    groups.wishlist.length +
    groups.attachments.length
  );
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

// ── `attachments` group ──────────────────────────────────────────────────

/**
 * Where a search hit sits. `deviceId: null` is the contract's "still in the
 * inbox" marker (openapi `AttachmentSearchHit.deviceId`); anything else names
 * the device that owns the file.
 *
 * The values are catalog keys — callers render `t(label)`.
 */
export const ATTACHMENT_SEARCH_STATUS_LABELS = {
  filed: 'Đã gắn thiết bị',
  inbox: 'Trong hộp thư',
} as const;

export type AttachmentSearchStatus = keyof typeof ATTACHMENT_SEARCH_STATUS_LABELS;

export function attachmentSearchStatus(
  deviceId: string | null | undefined,
): AttachmentSearchStatus {
  return (deviceId ?? '').trim() === '' ? 'inbox' : 'filed';
}

/**
 * A filed hit opens the device's attachment section (the anchor exists on
 * `/devices/[id]`); an inbox hit opens the inbox, where it can be filed.
 */
export function attachmentSearchHref(deviceId: string | null | undefined): string {
  if (attachmentSearchStatus(deviceId) === 'inbox') return '/inbox';
  return `/devices/${encodeURIComponent((deviceId ?? '').trim())}#attachments`;
}

/** Upload time, in the reader's date format; empty string for a bad/absent one. */
export function attachmentUploadedLabel(
  uploadedAt: string | null | undefined,
  locale: Locale,
): string {
  const raw = (uploadedAt ?? '').trim();
  if (raw === '') return '';
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return '';
  return translate(locale, 'Tải lên {date}', { date: formatDate(date, locale) });
}

/** How much original text is kept on each side of the match. */
export const SEARCH_EXCERPT_RADIUS = 48;

/**
 * The matched text with surrounding context, preserving the ORIGINAL spelling
 * (the API matches diacritic-insensitively, so the fold that finds the hit must
 * not be what gets displayed). Parts are separate so the row can highlight the
 * match without `dangerouslySetInnerHTML`.
 */
export type SearchTextExcerpt = {
  before: string;
  match: string;
  after: string;
  truncatedStart: boolean;
  truncatedEnd: boolean;
};

/**
 * Fold Vietnamese text for matching: NFD strips tone marks and `đ` becomes `d`,
 * mirroring the service's `lower(public.wv_unaccent(x))`. Returns an index map
 * so a hit in the folded string can be located in the original one — removing
 * combining marks changes lengths, so plain `indexOf` on the original would be
 * wrong for any diacritic before the match.
 */
function foldWithMap(text: string): { folded: string; index: number[] } {
  const chars = Array.from(text);
  let folded = '';
  const index: number[] = [];
  chars.forEach((char, charIndex) => {
    const piece = char
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'D')
      .toLowerCase();
    // One map entry per UTF-16 code unit (not per code point): `indexOf` below
    // returns a code-unit offset into `folded`, so an emoji's surrogate pair
    // must occupy two entries pointing at the same original character. Without
    // this, any astral character before the match shifts every later index.
    for (let unit = 0; unit < piece.length; unit += 1) {
      folded += piece[unit];
      index.push(charIndex);
    }
  });
  return { folded, index };
}

/**
 * `extractedText` in context. Returns `null` when there is no text to show (an
 * unscanned attachment has no `extractedText` key). If the query cannot be
 * located — it should always be, because the server only returned this row
 * because it matched — the opening of the transcript is shown rather than
 * claiming a match we could not point at.
 */
export function searchTextExcerpt(
  text: string | null | undefined,
  query: string,
  radius: number = SEARCH_EXCERPT_RADIUS,
): SearchTextExcerpt | null {
  const source = (text ?? '').trim();
  if (source === '') return null;

  const chars = Array.from(source);
  const foldedSource = foldWithMap(source);
  const foldedQuery = foldWithMap((query ?? '').trim()).folded;
  const hit = foldedQuery === '' ? -1 : foldedSource.folded.indexOf(foldedQuery);

  if (hit < 0) {
    const end = Math.min(chars.length, radius * 2);
    return {
      before: chars.slice(0, end).join(''),
      match: '',
      after: '',
      truncatedStart: false,
      truncatedEnd: end < chars.length,
    };
  }

  const matchStart = foldedSource.index[hit];
  const matchEnd = foldedSource.index[hit + foldedQuery.length - 1] + 1;
  const start = Math.max(0, matchStart - radius);
  const end = Math.min(chars.length, matchEnd + radius);
  return {
    before: chars.slice(start, matchStart).join(''),
    match: chars.slice(matchStart, matchEnd).join(''),
    after: chars.slice(matchEnd, end).join(''),
    truncatedStart: start > 0,
    truncatedEnd: end < chars.length,
  };
}

/** `…/devices/<id>` — id is URL-encoded; ids come from Go, not from the user. */
export function searchResultHref(group: EntitySearchGroupKey, id: string): string {
  const prefix = group === 'devices' ? 'devices' : group === 'subscriptions' ? 'subscriptions' : 'wishlist';
  return `/${prefix}/${encodeURIComponent(id)}`;
}
