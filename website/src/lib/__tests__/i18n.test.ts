import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  LOCALES,
  isLocale,
  localePath,
  normalizeLocale,
  parseAcceptLanguage,
  resolveLocale,
  splitLocalePath,
  stripLocalePrefix,
  withLangParam,
} from '@/lib/i18n/locale';
import {
  allMessages,
  englishMessages,
  interpolate,
  translate,
  translatorFor,
  vietnameseMessages,
} from '@/lib/i18n/catalog';
import { conflicts, messageOwners } from '@/lib/i18n/messages';

// The web dictionary, pinned.
//
// The failure this file exists to prevent is a SILENT one: a string that is
// wrapped in `t()` but has no entry renders as the Vietnamese original under an
// English UI, and nothing anywhere reports it. Every assertion below is aimed at
// making one shape of that failure loud.
//
// Language is pinned explicitly throughout (docs/I18N_PLAN.md §4.3): no test
// here may depend on the locale of the machine it runs on.

// Characters that only appear in Vietnamese text (Latin Extended Additional +
// the Vietnamese-specific base letters). If one of these shows up in an English
// translation, the "translation" is a copy of the source.
const VIETNAMESE_ONLY = /[ăâđêôơưĂÂĐÊÔƠƯẠ-ỹ]/;

// Deliberate exceptions, with a reason each. Empty, and it should stay that way:
// anything added here is a string an English reader sees in Vietnamese.
const ENGLISH_MAY_KEEP_VIETNAMESE: string[] = [];

describe('locale primitives', () => {
  it('has English as the default and lists exactly the two shipped languages', () => {
    expect(DEFAULT_LOCALE).toBe('en');
    expect([...LOCALES].sort()).toEqual(['en', 'vi']);
  });

  it('accepts only the exact literals the API documents', () => {
    expect(isLocale('vi')).toBe(true);
    expect(isLocale('en')).toBe(true);
    expect(isLocale('fr')).toBe(false);
    expect(isLocale('')).toBe(false);
    expect(isLocale(undefined)).toBe(false);
    // `vi-VN` is a valid Accept-Language tag but NOT a valid `?lang=` value —
    // the Go side takes only the exact literal and falls through otherwise.
    expect(isLocale('vi-VN')).toBe(false);
  });

  it('normalizes case and whitespace, and refuses to guess', () => {
    expect(normalizeLocale(' VI ')).toBe('vi');
    expect(normalizeLocale('En')).toBe('en');
    expect(normalizeLocale('vietnamese')).toBeNull();
    expect(normalizeLocale(null)).toBeNull();
    expect(normalizeLocale(7)).toBeNull();
  });
});

describe('Accept-Language parsing', () => {
  it('reads a plain tag', () => {
    expect(parseAcceptLanguage('vi')).toBe('vi');
    expect(parseAcceptLanguage('en-US')).toBe('en');
  });

  it('honours q-weights over list order', () => {
    expect(parseAcceptLanguage('en;q=0.3,vi;q=0.9')).toBe('vi');
    expect(parseAcceptLanguage('fr-FR,vi;q=0.9,en;q=0.3')).toBe('vi');
  });

  it('breaks ties by position, like the header spec', () => {
    expect(parseAcceptLanguage('vi,en')).toBe('vi');
    expect(parseAcceptLanguage('en,vi')).toBe('en');
  });

  it('drops q=0 as "not acceptable" instead of selecting it', () => {
    expect(parseAcceptLanguage('vi;q=0,en')).toBe('en');
    expect(parseAcceptLanguage('vi;q=0')).toBeNull();
  });

  it('returns null — not the default — when nothing matches', () => {
    // The distinction is load-bearing: `null` lets the stored preference win.
    // Returning DEFAULT_LOCALE here would pin English for every visitor whose
    // browser is set to a language we do not ship.
    expect(parseAcceptLanguage('fr')).toBeNull();
    expect(parseAcceptLanguage('*')).toBeNull();
    expect(parseAcceptLanguage('')).toBeNull();
    expect(parseAcceptLanguage(null)).toBeNull();
    expect(parseAcceptLanguage(undefined)).toBeNull();
  });

  it('survives junk without throwing', () => {
    expect(parseAcceptLanguage(';;;=,q=')).toBeNull();
    expect(parseAcceptLanguage('vi;q=abc')).toBeNull();
    expect(parseAcceptLanguage(' , en ,')).toBe('en');
  });
});

describe('the /vi URL', () => {
  it('splits `/vi`/`/vi/...` into the unprefixed route and the language', () => {
    expect(splitLocalePath('/vi')).toEqual({ pathname: '/', locale: 'vi' });
    expect(splitLocalePath('/vi/')).toEqual({ pathname: '/', locale: 'vi' });
    expect(splitLocalePath('/vi/privacy')).toEqual({
      pathname: '/privacy',
      locale: 'vi',
    });
  });

  it('does not treat a longer segment as the prefix', () => {
    // `/vietnamese` is a (nonexistent) route, not a malformed `/vi` URL. A
    // startsWith('/vi') check would silently rewrite it and manufacture a 404
    // that looked like a language bug.
    expect(splitLocalePath('/vietnamese')).toEqual({
      pathname: '/vietnamese',
      locale: null,
    });
    expect(splitLocalePath('/v1/devices')).toEqual({
      pathname: '/v1/devices',
      locale: null,
    });
    expect(splitLocalePath('/')).toEqual({ pathname: '/', locale: null });
  });

  it('round-trips the two URLs for every public route', () => {
    for (const base of ['/', '/privacy', '/terms', '/cookies']) {
      expect(localePath(base, 'en')).toBe(base);
      expect(stripLocalePrefix(localePath(base, 'vi'))).toBe(base);
    }
    expect(localePath('/', 'vi')).toBe('/vi');
    expect(localePath('/privacy', 'vi')).toBe('/vi/privacy');
  });

  it('is idempotent when handed an already-prefixed path', () => {
    // The switcher passes `usePathname()`, which is `/vi/privacy` on the
    // Vietnamese page. Re-prefixing must not produce `/vi/vi/privacy`.
    expect(localePath('/vi/privacy', 'vi')).toBe('/vi/privacy');
    expect(localePath('/vi/privacy', 'en')).toBe('/privacy');
    expect(stripLocalePrefix('/vi/privacy')).toBe('/privacy');
  });
});

describe('the web language precedence', () => {
  // /vi URL → cookie → stored preference → Accept-Language → en
  it('lets the URL beat the cookie and everything below it', () => {
    // The whole point of `/vi`: a shared link must open in Vietnamese even in a
    // browser whose cookie still says English. Googlebot has no cookie at all,
    // so without this level every crawl was English.
    expect(
      resolveLocale({
        pathLocale: 'vi',
        cookie: 'en',
        user: 'en',
        acceptLanguage: 'en-US,en;q=0.9',
      }),
    ).toBe('vi');
  });

  it('leaves an unprefixed URL to the cookie', () => {
    expect(
      resolveLocale({
        pathLocale: null,
        cookie: 'en',
        user: 'vi',
        acceptLanguage: 'vi-VN,vi;q=0.9',
      }),
    ).toBe('en');
  });

  it('ignores a junk path signal rather than pinning it', () => {
    expect(resolveLocale({ pathLocale: 'klingon', cookie: 'vi' })).toBe('vi');
  });

  it('lets the explicit cookie beat everything below the URL', () => {
    expect(
      resolveLocale({ cookie: 'en', user: 'vi', acceptLanguage: 'vi-VN,vi;q=0.9' }),
    ).toBe('en');
  });

  it('uses the stored preference when this browser has not chosen', () => {
    expect(resolveLocale({ cookie: null, user: 'vi', acceptLanguage: 'en-US' })).toBe('vi');
  });

  it('falls back to the browser header for a brand-new visitor', () => {
    expect(resolveLocale({ cookie: null, user: null, acceptLanguage: 'vi-VN,vi;q=0.9' })).toBe('vi');
  });

  it('ends on English', () => {
    expect(resolveLocale({})).toBe('en');
    expect(resolveLocale({ cookie: '', user: '', acceptLanguage: 'fr' })).toBe('en');
  });

  it('ignores a junk cookie rather than pinning it', () => {
    expect(resolveLocale({ cookie: 'klingon', user: 'vi' })).toBe('vi');
  });
});

describe('withLangParam', () => {
  it('appends the language to a bare path', () => {
    expect(withLangParam('/v1/catalog', 'vi')).toBe('/v1/catalog?lang=vi');
  });

  it('preserves existing query parameters', () => {
    expect(withLangParam('/v1/devices?q=abc&status=ACTIVE', 'en')).toBe(
      '/v1/devices?q=abc&status=ACTIVE&lang=en',
    );
  });

  it('replaces an existing lang instead of appending a second one', () => {
    // Go reads the FIRST `lang`, so `?lang=vi&lang=en` would silently render
    // Vietnamese while the app believed it asked for English.
    const url = withLangParam('/v1/catalog?lang=en', 'vi');
    expect(url).toBe('/v1/catalog?lang=vi');
    expect(new URLSearchParams(url.split('?')[1]).getAll('lang')).toEqual(['vi']);
  });

  it('keeps the fragment last', () => {
    expect(withLangParam('/v1/x?a=1#frag', 'en')).toBe('/v1/x?a=1&lang=en#frag');
  });

  it('works on an absolute URL, which is what the API client builds', () => {
    expect(withLangParam('http://localhost:4000/api/v1/catalog', 'vi')).toBe(
      'http://localhost:4000/api/v1/catalog?lang=vi',
    );
  });
});

describe('web dictionary parity', () => {
  const vi = vietnameseMessages();
  const en = englishMessages();

  it('is not empty — an empty dictionary would make every test below vacuous', () => {
    expect(Object.keys(vi).length).toBeGreaterThan(50);
  });

  it('has the SAME KEY SET in both languages', () => {
    // The requested pin. A key present in one map and absent from the other is
    // exactly the silent fallback this exercise exists to prevent.
    expect(Object.keys(en).sort()).toEqual(Object.keys(vi).sort());
  });

  it('has no empty or whitespace-only value in either language', () => {
    const blank: string[] = [];
    for (const [key, message] of Object.entries(allMessages())) {
      if (!message.vi.trim()) blank.push(`vi:${key}`);
      if (!message.en.trim()) blank.push(`en:${key}`);
      if (message.enOne !== undefined && !message.enOne.trim()) blank.push(`enOne:${key}`);
    }
    expect(blank).toEqual([]);
  });

  it('registers the Vietnamese key as the Vietnamese translation', () => {
    // The invariant that makes the whole design safe: a missing entry falls back
    // to the KEY, so the key has to BE the Vietnamese sentence. An entry whose
    // `vi` column drifted from its key would render the wrong thing on the
    // fallback path while looking correct on the lookup path.
    const drifted = Object.entries(allMessages())
      .filter(([key, message]) => message.vi !== key)
      .map(([key]) => key);
    expect(drifted).toEqual([]);
  });

  it('does not "translate" by copying the Vietnamese through', () => {
    const copied = Object.entries(en)
      .filter(([, value]) => VIETNAMESE_ONLY.test(value))
      .map(([key]) => key)
      .filter((key) => !ENGLISH_MAY_KEEP_VIETNAMESE.includes(key));
    expect(copied).toEqual([]);
  });

  it('has no two domain files disagreeing about the same sentence', () => {
    expect(conflicts.map((c) => `${c.key} (${c.files.join(' vs ')})`)).toEqual([]);
  });

  it('has no orphaned key that only one file ever mentions', () => {
    // Guards the other direction: a key defined in `messages/` that no source
    // file references is dead weight. This is a soft check by design — it only
    // asserts the registry and the catalog agree about what exists.
    expect(messageOwners.size).toBe(Object.keys(vi).length);
  });
});

describe('translate', () => {
  it('renders both languages', () => {
    expect(translate('en', 'Cài đặt')).toBe('Settings');
    expect(translate('vi', 'Cài đặt')).toBe('Cài đặt');
  });

  it('falls back to the Vietnamese original for an unregistered key', () => {
    // Both languages, deliberately: an unconverted string must stay visibly
    // Vietnamese rather than becoming an identifier or an empty string.
    expect(translate('en', 'Chuỗi chưa ai dịch')).toBe('Chuỗi chưa ai dịch');
    expect(translate('vi', 'Chuỗi chưa ai dịch')).toBe('Chuỗi chưa ai dịch');
  });

  it('interpolates named placeholders', () => {
    expect(translate('en', 'Không có dữ liệu')).toBe('No data');
    expect(interpolate('Còn {days} ngày', { days: 3 })).toBe('Còn 3 ngày');
  });

  it('leaves an unknown placeholder alone so a typo is visible', () => {
    expect(interpolate('Còn {days} ngày', { d: 3 })).toBe('Còn {days} ngày');
  });

  it('does not run interpolation when no params were passed', () => {
    // A static sentence containing a literal `{` must survive verbatim.
    expect(translate('en', 'Không có dữ liệu')).toBe('No data');
    expect(interpolate('100% {chắc} luôn', {})).toBe('100% {chắc} luôn');
  });

  it('binds a locale through translatorFor', () => {
    const t = translatorFor('en');
    expect(t('Đóng')).toBe('Close');
  });
});

describe('plurals', () => {
  // Vietnamese does not inflect for number; English does (docs/I18N_PLAN.md
  // §4.6). The catalog carries the singular English form separately, and the
  // caller triggers it by passing `count`.
  const key = 'Mất kết nối tới máy chủ, thử lại sau nhé.';

  it('has no plural forms in the Vietnamese column', () => {
    for (const message of Object.values(allMessages())) {
      expect(message).not.toHaveProperty('viOne');
    }
  });

  it('keeps the generic form when no count is supplied', () => {
    expect(translate('en', key)).toBe('Could not reach the server, please try again.');
  });

  it('uses the singular English form only for exactly one', () => {
    expect(translate('en', 'Còn {days} ngày', { days: 1, count: 1 })).toBe('1 day left');
    expect(translate('en', 'Còn {days} ngày', { days: 2, count: 2 })).toBe('2 days left');
    expect(translate('en', 'Còn {days} ngày', { days: 0, count: 0 })).toBe('0 days left');
  });
});

// The reported English defects: "1 warranty plans…" and "1 plans not matched…".
//
// The mechanism above is whole-sentence (`enOne`), so it can only inflect ONE
// counted noun. These two sentences have two, which is why they fell through.
// A sentence with two counted nouns is now either split into two fragments
// (each with its own `count`) or phrased so the second number has no noun to
// inflect. Vietnamese must read exactly as before: it does not inflect, and the
// source sentence is the key.
describe('multi-count plural fixes', () => {
  it('renders the device warranty summary with a singular plan', () => {
    const key = 'Có {count} gói bảo hành. Gói xa nhất hết {date}.';
    expect(translate('en', key, { count: 1, date: '28/10/2026' })).toBe(
      '1 warranty plan, the furthest ending on 28/10/2026.',
    );
    expect(translate('en', key, { count: 2, date: '28/10/2026' })).toBe(
      '2 warranty plans, the furthest ending on 28/10/2026.',
    );
    expect(translate('vi', key, { count: 1, date: '28/10/2026' })).toBe(
      'Có 1 gói bảo hành. Gói xa nhất hết 28/10/2026.',
    );
  });

  it('inflects each fragment of the stats KPI sub-line independently', () => {
    // The composition the stats page performs: one `count` per noun.
    const devices = (n: number) => translate('en', '{count} thiết bị', { count: n });
    const plans = (n: number) => translate('en', '{count} gói bảo hành', { count: n });
    expect(`${devices(1)} • ${plans(1)}`).toBe('1 device • 1 warranty plan');
    expect(`${devices(3)} • ${plans(1)}`).toBe('3 devices • 1 warranty plan');
    expect(`${devices(1)} • ${plans(4)}`).toBe('1 device • 4 warranty plans');
    // Vietnamese does not inflect: the same fragments read as the original.
    expect(translate('vi', '{count} thiết bị', { count: 1 })).toBe('1 thiết bị');
    expect(translate('vi', '{count} gói bảo hành', { count: 1 })).toBe('1 gói bảo hành');
  });

  it('inflects the year-breakdown line', () => {
    expect(
      translate('en', '{count} gói trong {year}', { count: 1, year: 2026 }),
    ).toBe('1 warranty plan in 2026');
    expect(
      translate('en', '{count} gói trong {year}', { count: 2, year: 2026 }),
    ).toBe('2 warranty plans in 2026');
    expect(translate('vi', '{count} gói trong {year}', { count: 1, year: 2026 })).toBe(
      '1 gói trong 2026',
    );
  });

  it('inflects the subscriptions "active" sub-label', () => {
    // Spotted on the subscriptions page next to the count: "1 active plans".
    expect(translate('en', 'gói đang chạy', { count: 1 })).toBe('active plan');
    expect(translate('en', 'gói đang chạy', { count: 2 })).toBe('active plans');
    expect(translate('vi', 'gói đang chạy', { count: 1 })).toBe('gói đang chạy');
  });

  it('never prints "1 plans" in the provider-summary sentence', () => {
    const key =
      '{withPhone}/{total} gói có số điện thoại do bạn tự ghi · {unmatched} gói chưa khớp danh bạ nhà bảo hành. App không có hotline nào trong hai con số đó.';
    // One plan, with a phone, unmatched: both numbers are 1.
    const singular = translate('en', key, {
      withPhone: 1,
      total: 1,
      count: 1,
      unmatched: 1,
    });
    expect(singular).toContain('You recorded a phone number on 1/1 plan');
    expect(singular).toContain('1 not matched');
    expect(singular).not.toContain('1/1 plans');
    expect(singular).not.toContain('1 not matcheds');
    // Several plans, one unmatched: the first clause is plural, the second is
    // still "1 not matched" (no noun, so no bad inflection).
    const plural = translate('en', key, {
      withPhone: 1,
      total: 3,
      count: 3,
      unmatched: 1,
    });
    expect(plural).toContain('You recorded a phone number on 1/3 plans');
    expect(plural).toContain('1 not matched');
    // Vietnamese is untouched by any of this.
    expect(
      translate('vi', key, { withPhone: 1, total: 1, count: 1, unmatched: 1 }),
    ).toBe(
      '1/1 gói có số điện thoại do bạn tự ghi · 1 gói chưa khớp danh bạ nhà bảo hành. App không có hotline nào trong hai con số đó.',
    );
  });
});

// The follow-up audit: every count-bearing sentence that could still print a
// plural noun next to `1`. Same rules as above — `enOne` (keyed on `count`) for
// a sentence with ONE counted noun, fragments for a sentence with two, and the
// Vietnamese column is never touched.
describe('plural audit — bulk import, export, push and forecast', () => {
  it('inflects the bulk-import result fragments', () => {
    const cases: Array<{
      key: string;
      params: Record<string, number>;
      one: string;
      many: string;
      vi: string;
    }> = [
      {
        key: 'Đã tạo {created} thiết bị.',
        params: { created: 1 },
        one: 'Created 1 device.',
        many: 'Created 2 devices.',
        vi: 'Đã tạo 1 thiết bị.',
      },
      {
        key: 'Bỏ qua {skipped} dòng lỗi.',
        params: { skipped: 1 },
        one: 'Skipped 1 bad row.',
        many: 'Skipped 2 bad rows.',
        vi: 'Bỏ qua 1 dòng lỗi.',
      },
      {
        key: '{failed} dòng máy chủ từ chối.',
        params: { failed: 1 },
        one: 'The server rejected 1 row.',
        many: 'The server rejected 2 rows.',
        vi: '1 dòng máy chủ từ chối.',
      },
      {
        key: '{missing} dòng chưa tạo.',
        params: { missing: 1 },
        one: '1 row was not created.',
        many: '2 rows were not created.',
        vi: '1 dòng chưa tạo.',
      },
      {
        key: 'Không có dòng nào hợp lệ để tạo ({count} dòng lỗi).',
        params: { count: 1 },
        one: 'No row was valid enough to create (1 bad row).',
        many: 'No row was valid enough to create (2 bad rows).',
        vi: 'Không có dòng nào hợp lệ để tạo (1 dòng lỗi).',
      },
    ];
    for (const c of cases) {
      expect(translate('en', c.key, { ...c.params, count: c.params.count ?? 1 })).toBe(c.one);
      const pluralParams = Object.fromEntries(
        Object.entries(c.params).map(([k, v]) => [k, v + 1]),
      );
      expect(
        translate('en', c.key, { ...pluralParams, count: pluralParams.count ?? 2 }),
      ).toBe(c.many);
      expect(translate('vi', c.key, { ...c.params, count: c.params.count ?? 1 })).toBe(c.vi);
    }
  });

  it('inflects the CSV export row count', () => {
    expect(translate('en', 'Đã xuất {count} dòng {dataset}', { count: 1, dataset: 'devices' })).toBe(
      'Exported 1 row of devices',
    );
    expect(translate('en', 'Đã xuất {count} dòng {dataset}', { count: 3, dataset: 'devices' })).toBe(
      'Exported 3 rows of devices',
    );
    expect(translate('vi', 'Đã xuất {count} dòng {dataset}', { count: 1, dataset: 'thiết bị' })).toBe(
      'Đã xuất 1 dòng thiết bị',
    );
  });

  it('inflects the push-test result without inflecting the failure count', () => {
    const key = 'Đã gửi {sent} thông báo (lỗi: {failed})';
    expect(translate('en', key, { sent: 1, failed: 0, count: 1 })).toBe(
      'Sent 1 notification (0 failed)',
    );
    expect(translate('en', key, { sent: 2, failed: 1, count: 2 })).toBe(
      'Sent 2 notifications (1 failed)',
    );
    // `{failed} failed` has no noun, so 1 there is already grammatical.
    expect(translate('vi', key, { sent: 1, failed: 1, count: 1 })).toBe(
      'Đã gửi 1 thông báo (lỗi: 1)',
    );
  });

  it('inflects the forecast-window months (reachable with ?fm=1)', () => {
    expect(translate('en', '{months} tháng tới', { months: 1, count: 1 })).toBe('Next 1 month');
    expect(translate('en', '{months} tháng tới', { months: 3, count: 3 })).toBe('Next 3 months');
    expect(translate('vi', '{months} tháng tới', { months: 1, count: 1 })).toBe('1 tháng tới');

    const key =
      'Có thể phát sinh trong {months} tháng tới — tham khảo, không phải khoản chắc chắn trả và không cộng vào tổng ở trên';
    expect(translate('en', key, { months: 1, count: 1 })).toContain(
      'May come up in the next 1 month —',
    );
    expect(translate('en', key, { months: 12, count: 12 })).toContain(
      'May come up in the next 12 months —',
    );
    expect(translate('vi', key, { months: 1, count: 1 })).toContain(
      'Có thể phát sinh trong 1 tháng tới',
    );
  });

  it('inflects the extra-cell warning, including its verb', () => {
    const key = 'Thừa {count} ô so với bảng — phần thừa bị bỏ qua';
    expect(translate('en', key, { count: 1 })).toBe(
      'There is 1 more cell than the table has columns — the extra is ignored',
    );
    expect(translate('en', key, { count: 2 })).toBe(
      'There are 2 more cells than the table has columns — the extras are ignored',
    );
    expect(translate('vi', key, { count: 1 })).toBe(
      'Thừa 1 ô so với bảng — phần thừa bị bỏ qua',
    );
  });

  it('never puts a plural noun after a fraction whose total is one', () => {
    // The noun belongs to the DENOMINATOR, which `enOne` (keyed on `count`)
    // cannot reach — so the English drops the noun instead.
    expect(translate('en', '{count}/{total} thiết bị', { count: 0, total: 1 })).toBe(
      '0/1 covered',
    );
    expect(translate('en', '{count}/{total} thiết bị', { count: 1, total: 1 })).toBe(
      '1/1 covered',
    );
    expect(translate('en', '{count}/{total} thiết bị', { count: 1, total: 5 })).toBe(
      '1/5 covered',
    );
    expect(translate('vi', '{count}/{total} thiết bị', { count: 0, total: 1 })).toBe(
      '0/1 thiết bị',
    );
  });

  it('composes the paste-import preview from two independently pluralised fragments', () => {
    // The old single sentence had two counted nouns but only one `enOne`:
    // "Will create 1 device · skipping 1 bad rows". Each fragment now carries its
    // own `count`, and the " · " join reproduces the old Vietnamese sentence.
    const preview = (locale: 'en' | 'vi', created: number, skipped: number) =>
      `${translate(locale, 'Sẽ tạo {count} thiết bị', { count: created })} · ${translate(
        locale,
        'bỏ qua {skipped} dòng lỗi',
        { skipped, count: skipped },
      )}`;

    expect(preview('en', 1, 1)).toBe('Will create 1 device · skipping 1 bad row');
    expect(preview('en', 2, 1)).toBe('Will create 2 devices · skipping 1 bad row');
    expect(preview('en', 1, 3)).toBe('Will create 1 device · skipping 3 bad rows');
    expect(preview('en', 2, 3)).toBe('Will create 2 devices · skipping 3 bad rows');

    // Byte-for-byte the sentence the single key used to render in Vietnamese.
    // The old key still interpolates as its own fallback, so this compares the
    // composed string against the exact text the previous implementation output.
    const oldSentence = 'Sẽ tạo {count} thiết bị · bỏ qua {skipped} dòng lỗi';
    expect(preview('vi', 1, 1)).toBe(translate('vi', oldSentence, { count: 1, skipped: 1 }));
    expect(preview('vi', 12, 3)).toBe(translate('vi', oldSentence, { count: 12, skipped: 3 }));
    expect(preview('vi', 1, 1)).toBe('Sẽ tạo 1 thiết bị · bỏ qua 1 dòng lỗi');
    expect(preview('vi', 12, 3)).toBe('Sẽ tạo 12 thiết bị · bỏ qua 3 dòng lỗi');
  });
});
