import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  LOCALES,
  isLocale,
  normalizeLocale,
  parseAcceptLanguage,
  resolveLocale,
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

describe('the web language precedence', () => {
  // cookie → stored preference → Accept-Language → en
  it('lets the explicit cookie beat everything', () => {
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
});
