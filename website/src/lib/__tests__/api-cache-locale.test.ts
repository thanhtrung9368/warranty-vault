// Proof that a language cannot leak between readers of the cached catalog.
//
// ── The hazard ───────────────────────────────────────────────────────────
//
// `lib/api/catalog.ts` is the one request in this app that opts into Next's Data
// Cache (`next: { revalidate: 300 }`). A cached response is stored under a key
// derived from the request, and if two readers who want DIFFERENT languages
// derive the SAME key, the second one is served the first one's language.
//
// ── The fix ──────────────────────────────────────────────────────────────
//
// The language travels in the URL (`?lang=vi`), never in a header. The URL is
// the part of a request that is keyed in every version of Next's Data Cache, so
// two languages cannot collide by construction — and, more importantly, the
// cached body becomes a pure function of the key, which is the property that
// actually makes caching sound.
//
// ── What this file proves ────────────────────────────────────────────────
//
//  1. `catalog.get()` sends a DIFFERENT URL per language and an IDENTICAL header
//     set. (If the two requests differed only in a header, correctness would
//     rest on Next's key derivation rather than on the app.)
//  2. Next 16.3.8's real cache-key function — imported, not re-implemented —
//     derives different keys for those two URLs.
//  3. A canary on the two things the fix does NOT rely on: `next.tags` is not
//     part of the key at all, and headers ARE part of it in this version. Both
//     are recorded so a Next upgrade that changes either one fails here, loudly,
//     instead of silently breaking the language partition in production.
//
// Note (3): the brief for this work states that request headers are not part of
// a Next fetch cache key. Measured against the installed Next (16.3.8,
// `IncrementalCache.generateCacheKey`) that is not true — headers are hashed
// into the key. The language is in the URL anyway, because "the key happens to
// include the header" is a fact about a dependency's internals, not a property
// of this app.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Shared with the module mocks below — `vi.hoisted` is the only way to get a
// value into `vi.mock`'s factory that the test body can also reach.
const env = vi.hoisted(() => ({
  cookieLocale: null as string | null,
  acceptLanguage: null as string | null,
  calls: [] as Array<{ url: string; method?: string; headers: Record<string, string>; next?: unknown; cache?: unknown }>,
}));

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === 'wv_locale' && env.cookieLocale
        ? { name, value: env.cookieLocale }
        : undefined,
    set: () => undefined,
    delete: () => undefined,
  }),
  headers: async () => ({
    get: (name: string) =>
      name.toLowerCase() === 'accept-language' ? env.acceptLanguage : null,
  }),
}));

// `getLocale()` reads the stored preference through `getCurrentUser()`. There is
// no account in this test, which is also the interesting case: it is the
// anonymous visitor on a public page.
vi.mock('@/lib/auth', () => ({
  getCurrentUser: async () => null,
  requireUser: async () => null,
  requireGuest: async () => undefined,
}));

// The bearer token is irrelevant here and iron-session needs a real cookie jar.
vi.mock('@/lib/auth-cookie', () => ({
  bearerHeader: async () => ({}),
  getAuthCookie: async () => ({}),
  setAuthCookie: async () => undefined,
  destroyAuthCookie: async () => undefined,
}));

const CATALOG_BODY = {
  categories: [{ code: 'PHONE', name: 'Điện thoại' }],
  brands: [],
  stores: [],
  warrantyProviders: [],
  brandServiceInfo: [],
};

function stubFetch() {
  const fetchMock = vi.fn(async (url: unknown, init?: Record<string, unknown>) => {
    env.calls.push({
      url: String(url),
      method: init?.method as string | undefined,
      headers: (init?.headers ?? {}) as Record<string, string>,
      next: init?.next,
      cache: init?.cache,
    });
    return new Response(JSON.stringify(CATALOG_BODY), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  env.cookieLocale = null;
  env.acceptLanguage = null;
  env.calls = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the cached catalog read is language-partitioned', () => {
  it('sends a different URL per language and the same headers', async () => {
    stubFetch();
    // Imported lazily so the `vi.mock` factories above are installed first.
    const catalog = await import('@/lib/api/catalog');

    env.cookieLocale = 'vi';
    const viRes = await catalog.get();
    env.cookieLocale = 'en';
    const enRes = await catalog.get();

    expect(viRes.ok).toBe(true);
    expect(enRes.ok).toBe(true);
    expect(env.calls).toHaveLength(2);

    const [viCall, enCall] = env.calls;

    // (1) The URLs differ, and each carries the exact literal the Go API
    // documents. This is the whole fix.
    expect(viCall.url).toContain('lang=vi');
    expect(enCall.url).toContain('lang=en');
    expect(viCall.url).not.toBe(enCall.url);

    // (1b) ...and nothing else does. The two requests are byte-identical apart
    // from the URL, so the cached body is a pure function of the cache key.
    // If this assertion ever fails because a locale-varying header appeared,
    // the partition would be resting on Next's key derivation instead of on the
    // app — which is exactly the bug this file exists to prevent.
    expect(viCall.headers).toEqual(enCall.headers);
    expect(Object.keys(viCall.headers).map((h) => h.toLowerCase())).not.toContain(
      'accept-language',
    );
  });

  it('falls back to the browser header for a first-time anonymous visitor', async () => {
    stubFetch();
    const catalog = await import('@/lib/api/catalog');

    // No cookie, no account — the public-page case.
    env.acceptLanguage = 'vi-VN,vi;q=0.9,en;q=0.8';
    await catalog.get();

    expect(env.calls[0].url).toContain('lang=vi');
  });

  it('asks for the language at the URL, not only in a tag', async () => {
    stubFetch();
    const catalog = await import('@/lib/api/catalog');
    env.cookieLocale = 'vi';
    await catalog.get();

    const [call] = env.calls;
    // The tags are real and per-language (they make a targeted refresh
    // possible), but a tag is not what keeps the two languages apart.
    expect(call.next).toEqual({
      revalidate: 300,
      tags: ['catalog', 'catalog:vi'],
    });
    expect(call.url).toContain('lang=vi');
  });
});

describe('what Next actually keys the fetch cache on (canary)', () => {
  // Imported from the installed build rather than re-implemented, so this is a
  // statement about the code that will run in production.
  async function cacheKey(url: string, init: Record<string, unknown> = {}) {
    const { IncrementalCache } = await import('next/dist/server/lib/incremental-cache');
    const cache = new IncrementalCache({
      dev: false,
      flushToDisk: false,
      minimalMode: false,
      requestHeaders: {},
      maxMemoryCacheSize: 1,
      fetchCacheKeyPrefix: '',
      allowedRevalidateHeaderKeys: [],
      getPrerenderManifest: () => ({ preview: {}, routes: {}, dynamicRoutes: {} }),
    } as never);
    return (cache as unknown as {
      generateCacheKey: (u: string, i: unknown) => Promise<string>;
    }).generateCacheKey(url, { method: 'GET', ...init });
  }

  const URL_BASE = 'http://localhost:4000/api/v1/catalog';

  it('gives the two languages different keys', async () => {
    const vi = await cacheKey(`${URL_BASE}?lang=vi`);
    const en = await cacheKey(`${URL_BASE}?lang=en`);
    expect(vi).not.toBe(en);
  });

  it('does NOT key on `next.tags`', async () => {
    // Recorded because it rules out one of the two candidate fixes: putting the
    // language in the tags would have left both languages writing the same
    // entry. A tag controls WHEN an entry is revalidated, never WHICH entry a
    // read lands on.
    const a = await cacheKey(URL_BASE, { next: { revalidate: 300, tags: ['catalog', 'catalog:vi'] } });
    const b = await cacheKey(URL_BASE, { next: { revalidate: 300, tags: ['catalog', 'catalog:en'] } });
    expect(a).toBe(b);
  });

  it('DOES key on headers in this version — which the URL fix does not rely on', async () => {
    // The brief says headers are not part of the key. In Next 16.3.8 they are.
    // This assertion pins the measured behaviour so the next reader does not
    // have to re-derive it; if a Next upgrade changes it, this fails and the
    // comment above (and in `lib/api/catalog.ts`) gets corrected.
    const a = await cacheKey(URL_BASE, { headers: { 'Accept-Language': 'vi' } });
    const b = await cacheKey(URL_BASE, { headers: { 'Accept-Language': 'en' } });
    expect(a).not.toBe(b);
  });
});
