import { describe, it, expect } from 'vitest';
import {
  SEARCH_DEBOUNCE_MS,
  SEARCH_DEFAULT_LIMIT,
  SEARCH_GROUP_LABELS,
  SEARCH_GROUP_ORDER,
  SEARCH_MAX_LIMIT,
  SEARCH_MAX_QUERY_RUNES,
  describeSearchFailure,
  isBlankQuery,
  isEmptySearch,
  noResultsMessage,
  normalizeSearchGroups,
  searchResultCount,
  searchResultHref,
  searchRowSubtitle,
  type SearchGroups,
} from '@/lib/search';

// Global cross-entity search (`GET /api/v1/search`, roadmap #7).
//
// Language is pinned explicitly ('vi') on every message-producing helper
// (docs/I18N_PLAN.md §4.3): these assertions are about the Vietnamese source
// sentences and must not drift with the machine or the default locale.
//
// The behaviours pinned here come straight from openapi.yaml + services/search.go:
// groups are always arrays, a blank `q` is a 200 (not an error), a `q` over 200
// runes is a 400 whose message the client shows unchanged, and `limit` is per
// group with default 20 / max 50.

describe('query handling', () => {
  it('treats an empty or whitespace-only query as blank', () => {
    expect(isBlankQuery('')).toBe(true);
    expect(isBlankQuery('   ')).toBe(true);
    expect(isBlankQuery('\t\n')).toBe(true);
    expect(isBlankQuery(null)).toBe(true);
    expect(isBlankQuery(undefined)).toBe(true);
  });

  it('treats any real character as a query (including a single space inside)', () => {
    expect(isBlankQuery('a')).toBe(false);
    expect(isBlankQuery(' samsung')).toBe(false);
  });

  it('mirrors the server limits: per-group 20/50 and 200 runes', () => {
    expect(SEARCH_DEFAULT_LIMIT).toBe(20);
    expect(SEARCH_MAX_LIMIT).toBe(50);
    expect(SEARCH_MAX_QUERY_RUNES).toBe(200);
    expect(SEARCH_DEBOUNCE_MS).toBeGreaterThan(0);
  });
});

describe('normalizeSearchGroups', () => {
  it('always produces three arrays, even from a missing payload', () => {
    const groups = normalizeSearchGroups(null);
    expect(groups.devices).toEqual([]);
    expect(groups.subscriptions).toEqual([]);
    expect(groups.wishlist).toEqual([]);
    expect(Array.isArray(groups.devices)).toBe(true);
  });

  it('coerces a group the server sent as null (contract says it never does)', () => {
    // Defensive: this payload feeds the app-shell topbar on every page, so a
    // malformed response must not crash the whole shell.
    const groups = normalizeSearchGroups({
      devices: null as unknown as SearchGroups['devices'],
      subscriptions: undefined,
      wishlist: [{ id: 'w1', name: 'Galaxy Buds' }],
    });
    expect(groups.devices).toEqual([]);
    expect(groups.subscriptions).toEqual([]);
    expect(groups.wishlist).toHaveLength(1);
  });

  it('keeps the rows it was given, in order', () => {
    const groups = normalizeSearchGroups({
      devices: [
        { id: 'd1', name: 'MacBook Pro' },
        { id: 'd2', name: 'iPhone 15' },
      ],
      subscriptions: [{ id: 's1', name: 'Samsung Cloud' }],
      wishlist: [],
    });
    expect(groups.devices.map((d) => d.id)).toEqual(['d1', 'd2']);
    expect(groups.subscriptions.map((s) => s.name)).toEqual(['Samsung Cloud']);
  });
});

describe('counts and empty state', () => {
  const empty = normalizeSearchGroups(null);

  it('counts every group together (limit is per group)', () => {
    const groups = normalizeSearchGroups({
      devices: [{ id: 'd1', name: 'A' }],
      subscriptions: [{ id: 's1', name: 'B' }],
      wishlist: [{ id: 'w1', name: 'C' }],
    });
    expect(searchResultCount(groups)).toBe(3);
    expect(isEmptySearch(groups)).toBe(false);
  });

  it('reports the blank-query response as empty, not as an error', () => {
    expect(searchResultCount(empty)).toBe(0);
    expect(isEmptySearch(empty)).toBe(true);
  });

  it('quotes the query the server echoed back', () => {
    expect(noResultsMessage('samsung', 'vi')).toBe('Không tìm thấy kết quả cho “samsung”.');
    expect(noResultsMessage('  samsung  ', 'vi')).toBe('Không tìm thấy kết quả cho “samsung”.');
    expect(noResultsMessage('', 'vi')).toBe('Không tìm thấy kết quả nào.');
  });
});

describe('describeSearchFailure', () => {
  it('shows the server message verbatim when there is one', () => {
    // The only 400 this endpoint returns is the over-long query.
    expect(
      describeSearchFailure(
        {
          status: 400,
          error: 'validation',
          message: 'Từ khoá tìm kiếm quá dài (tối đa 200 ký tự)',
        },
        'vi',
      ),
    ).toBe('Từ khoá tìm kiếm quá dài (tối đa 200 ký tự)');
  });

  it('falls back to the rune limit when the 400 carried no message', () => {
    const message = describeSearchFailure({ status: 400, error: 'validation' }, 'vi');
    expect(message).toContain(String(SEARCH_MAX_QUERY_RUNES));
    // It must not claim a blank query is the problem — blank never gets here.
    expect(message.toLowerCase()).not.toContain('rỗng');
  });

  it('explains an expired session instead of a raw 401', () => {
    expect(describeSearchFailure({ status: 401, error: 'unauthorized' }, 'vi')).toContain(
      'Phiên đăng nhập đã hết hạn',
    );
  });

  it('maps rate limiting and transport failures', () => {
    expect(describeSearchFailure({ status: 429, error: 'rate_limited' }, 'vi')).toContain(
      'Thao tác quá nhanh',
    );
    expect(describeSearchFailure({ status: 0, error: 'network_error' }, 'vi')).toContain(
      'Mất kết nối',
    );
  });

  it('keeps a generic Vietnamese message for anything else', () => {
    expect(describeSearchFailure({ status: 500, error: 'internal_error' }, 'vi')).toBe(
      'Không tìm kiếm được, thử lại sau.',
    );
  });
});

describe('result rows', () => {
  it('renders the matched fields as one subtitle line', () => {
    expect(searchRowSubtitle({ brand: 'Apple', model: 'MacBook Pro M3' })).toBe(
      'Apple · MacBook Pro M3',
    );
    expect(searchRowSubtitle({ brand: 'Samsung', plan: 'Cloud 200GB' })).toBe(
      'Samsung · Cloud 200GB',
    );
  });

  it('falls back to the category when there is no brand/model', () => {
    expect(searchRowSubtitle({ category: 'PHONE' })).toBe('PHONE');
  });

  it('drops blanks and duplicates', () => {
    expect(searchRowSubtitle({ brand: 'Apple', model: '  ' })).toBe('Apple');
    expect(searchRowSubtitle({ brand: 'Apple', model: 'Apple' })).toBe('Apple');
    expect(searchRowSubtitle({})).toBe('');
  });

  it('links each group to the entity detail pages the app already has', () => {
    expect(searchResultHref('devices', 'dev_1')).toBe('/devices/dev_1');
    expect(searchResultHref('subscriptions', 'sub_1')).toBe('/subscriptions/sub_1');
    expect(searchResultHref('wishlist', 'wish_1')).toBe('/wishlist/wish_1');
    // Ids come from Go, but encode anyway so a stray character cannot break the URL.
    expect(searchResultHref('devices', 'a/b')).toBe('/devices/a%2Fb');
  });

  it('keeps the group labels in sync with the sidebar wording', () => {
    expect(SEARCH_GROUP_ORDER).toEqual(['devices', 'subscriptions', 'wishlist']);
    expect(SEARCH_GROUP_LABELS.devices).toBe('Thiết bị');
    // "Gói đăng ký", not "Đăng ký": the heading has to be the word the sidebar
    // uses for that section (`common.ts`), or the dropdown points at a place the
    // nav calls something else. ("Đăng ký" is also taken — it is "Sign up".)
    expect(SEARCH_GROUP_LABELS.subscriptions).toBe('Gói đăng ký');
    expect(SEARCH_GROUP_LABELS.wishlist).toBe('Đang thèm');
  });
});
