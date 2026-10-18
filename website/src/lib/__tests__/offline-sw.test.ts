import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { OFFLINE_PAGE_CACHE_PREFIX } from '@/lib/offline/cache-client';

// The service worker's policy lives in `public/sw-core.js`, loaded with
// importScripts in production. Evaluate those exact bytes in a vm sandbox so
// the tests pin what ships, not a TypeScript copy of it.

type HeaderLike = { get(name: string): string | null };

type FakeRequest = {
  method: string;
  mode: string;
  url: string;
  headers: HeaderLike;
};

type FakeResponse = {
  ok: boolean;
  status: number;
  url: string;
  headers: HeaderLike;
};

type SwCore = {
  CACHE_VERSION: number;
  SHELL_CACHE: string;
  PAGE_CACHE: string;
  ASSET_CACHE: string;
  CURRENT_CACHES: string[];
  PAGE_CACHE_PREFIX: string;
  OFFLINE_URL: string;
  SHELL_URLS: string[];
  PRIME_URLS: string[];
  PRIME_MAX_AGE_MS: number;
  isCacheableDocumentPath(pathname: string | null): boolean;
  isCacheableDocumentUrl(input: string): boolean;
  isStaticAsset(input: string): boolean;
  isRscRequest(request: FakeRequest): boolean;
  shouldCacheDocument(request: FakeRequest, response: FakeResponse): boolean;
  shouldCacheFetchedPage(requestUrl: string, response: FakeResponse): boolean;
  cachedAtFrom(response: FakeResponse): number | null;
  isOlderThan(response: FakeResponse, now: number, maxAgeMs: number): boolean;
  localeFromHtml(html: string): string;
  formatCachedAt(timestamp: number | null, locale: string): string | null;
  staleMessage(locale: string, timestamp: number | null): string;
  staleBannerCss(locale: string, timestamp: number | null): string;
  injectStaleBanner(html: string, css: string): string;
  parseShellAssetUrls(html: string): string[];
  staleCacheNames(names: string[]): string[];
};

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const CORE_SOURCE = readFileSync(join(ROOT, 'public', 'sw-core.js'), 'utf8');

function loadCore(): SwCore {
  const self: { WVOffline?: SwCore } = {};
  const sandbox = {
    self,
    URL,
    Response,
    Headers,
    Intl,
    Set,
    Date,
  };
  vm.createContext(sandbox);
  vm.runInContext(CORE_SOURCE, sandbox, { filename: 'sw-core.js' });
  if (!self.WVOffline) throw new Error('sw-core.js did not expose self.WVOffline');
  return self.WVOffline;
}

const core = loadCore();

function fakeRequest(
  opts: {
    url?: string;
    method?: string;
    mode?: string;
    headers?: Record<string, string>;
  } = {},
): FakeRequest {
  return {
    url: opts.url ?? 'http://localhost/devices',
    method: opts.method ?? 'GET',
    mode: opts.mode ?? 'navigate',
    headers: new Headers(opts.headers ?? {}),
  };
}

function fakeResponse(
  opts: {
    url?: string;
    status?: number;
    contentType?: string | null;
    headers?: Record<string, string>;
  } = {},
): FakeResponse {
  const status = opts.status ?? 200;
  const headers = new Headers(opts.headers ?? {});
  if (opts.contentType !== null) {
    headers.set('content-type', opts.contentType ?? 'text/html; charset=utf-8');
  }
  return {
    ok: status >= 200 && status < 300,
    status,
    url: opts.url ?? 'http://localhost/devices',
    headers,
  };
}

describe('cache versioning', () => {
  it('uses versioned cache names and drops every older wv-* cache', () => {
    expect(core.CACHE_VERSION).toBe(2);
    expect(core.SHELL_CACHE).toBe('wv-shell-v2');
    expect(core.PAGE_CACHE).toBe('wv-pages-v2');
    expect(core.ASSET_CACHE).toBe('wv-assets-v2');
    expect(core.CURRENT_CACHES).toEqual([
      'wv-shell-v2',
      'wv-pages-v2',
      'wv-assets-v2',
    ]);

    expect(
      core.staleCacheNames([
        'wv-v1',
        'wv-pages-v1',
        'wv-pages-v2',
        'wv-assets-v1',
        'wv-assets-v2',
        'wv-shell-v1',
        'wv-shell-v2',
        'unrelated-cache',
      ]),
    ).toEqual(['wv-v1', 'wv-pages-v1', 'wv-assets-v1', 'wv-shell-v1']);
  });

  it('keeps the page-cache prefix in sync with the client-side cleaner', () => {
    expect(core.PAGE_CACHE_PREFIX).toBe(OFFLINE_PAGE_CACHE_PREFIX);
    expect(core.OFFLINE_URL).toBe('/offline');
    expect(core.SHELL_URLS).toContain('/offline');
  });
});

describe('which documents are cacheable', () => {
  it('accepts the three lookup surfaces and device detail pages', () => {
    for (const pathname of ['/dashboard', '/devices', '/reminders']) {
      expect(core.isCacheableDocumentPath(pathname)).toBe(true);
    }
    expect(core.isCacheableDocumentPath('/devices/abc-123')).toBe(true);
    expect(core.isCacheableDocumentUrl('/devices/abc-123?tab=warranty')).toBe(true);
  });

  it('refuses auth, form, settings, stats, API and offline-shell paths', () => {
    for (const pathname of [
      '/',
      '/login',
      '/register',
      '/forgot',
      '/reset/token',
      '/offline',
      '/settings',
      '/stats',
      '/devices/new',
      '/devices/import',
      '/devices/abc-123/edit',
      '/api/files/1',
      '/_next/static/chunks/a.js',
    ]) {
      expect(core.isCacheableDocumentPath(pathname)).toBe(false);
    }
  });

  it('only treats hashed Next output and PWA icons as static assets', () => {
    expect(core.isStaticAsset('/_next/static/chunks/a.js')).toBe(true);
    expect(core.isStaticAsset('/_next/static/media/font.woff2')).toBe(true);
    expect(core.isStaticAsset('/icon.svg')).toBe(true);
    expect(core.isStaticAsset('/manifest.webmanifest')).toBe(true);
    expect(core.isStaticAsset('/devices')).toBe(false);
    expect(core.isStaticAsset('/api/files/1')).toBe(false);
  });
});

describe('RSC requests are never cached', () => {
  it('detects the query parameter and the router headers', () => {
    expect(core.isRscRequest(fakeRequest({ url: 'http://localhost/devices?_rsc=abc' }))).toBe(
      true,
    );
    expect(core.isRscRequest(fakeRequest({ headers: { rsc: '1' } }))).toBe(true);
    expect(
      core.isRscRequest(fakeRequest({ headers: { 'next-router-state-tree': '["x"]' } })),
    ).toBe(true);
    expect(
      core.isRscRequest(fakeRequest({ headers: { 'next-router-prefetch': '1' } })),
    ).toBe(true);
    expect(core.isRscRequest(fakeRequest())).toBe(false);
  });
});

describe('shouldCacheDocument', () => {
  it('accepts a full HTML navigation to a whitelisted path', () => {
    expect(
      core.shouldCacheDocument(
        fakeRequest({ url: 'http://localhost/devices' }),
        fakeResponse({ url: 'http://localhost/devices' }),
      ),
    ).toBe(true);
  });

  it('accepts a filtered device list under its exact URL', () => {
    expect(
      core.shouldCacheDocument(
        fakeRequest({ url: 'http://localhost/devices?q=iphone' }),
        fakeResponse({ url: 'http://localhost/devices?q=iphone' }),
      ),
    ).toBe(true);
  });

  it('rejects the signed-out redirect to /login', () => {
    expect(
      core.shouldCacheDocument(
        fakeRequest({ url: 'http://localhost/devices' }),
        fakeResponse({ url: 'http://localhost/login' }),
      ),
    ).toBe(false);
  });

  it('rejects a redirect to a different cacheable path', () => {
    expect(
      core.shouldCacheDocument(
        fakeRequest({ url: 'http://localhost/devices' }),
        fakeResponse({ url: 'http://localhost/devices/abc' }),
      ),
    ).toBe(false);
  });

  it('rejects non-200, non-HTML, non-navigation and RSC responses', () => {
    expect(
      core.shouldCacheDocument(
        fakeRequest({ url: 'http://localhost/devices' }),
        fakeResponse({ url: 'http://localhost/devices', status: 404 }),
      ),
    ).toBe(false);

    expect(
      core.shouldCacheDocument(
        fakeRequest({ url: 'http://localhost/devices' }),
        fakeResponse({ url: 'http://localhost/devices', contentType: 'application/json' }),
      ),
    ).toBe(false);

    expect(
      core.shouldCacheDocument(
        fakeRequest({ url: 'http://localhost/devices', mode: 'cors' }),
        fakeResponse({ url: 'http://localhost/devices' }),
      ),
    ).toBe(false);

    expect(
      core.shouldCacheDocument(
        fakeRequest({ url: 'http://localhost/devices?_rsc=1' }),
        fakeResponse({ url: 'http://localhost/devices' }),
      ),
    ).toBe(false);
  });

  it('rejects a page that is not on the whitelist', () => {
    expect(
      core.shouldCacheDocument(
        fakeRequest({ url: 'http://localhost/devices/new' }),
        fakeResponse({ url: 'http://localhost/devices/new' }),
      ),
    ).toBe(false);
  });
});

describe('shouldCacheFetchedPage (priming)', () => {
  it('accepts a successful same-path HTML fetch', () => {
    expect(
      core.shouldCacheFetchedPage(
        'http://localhost/devices',
        fakeResponse({ url: 'http://localhost/devices' }),
      ),
    ).toBe(true);
  });

  it('rejects an auth redirect or a non-HTML response', () => {
    expect(
      core.shouldCacheFetchedPage(
        'http://localhost/devices',
        fakeResponse({ url: 'http://localhost/login' }),
      ),
    ).toBe(false);
    expect(
      core.shouldCacheFetchedPage(
        'http://localhost/devices',
        fakeResponse({ url: 'http://localhost/devices', contentType: 'text/plain' }),
      ),
    ).toBe(false);
  });
});

describe('cached-at metadata', () => {
  it('reads the HTTP Date header that Next writes', () => {
    const timestamp = Date.parse('Sun, 18 Oct 2026 07:12:21 GMT');
    expect(
      core.cachedAtFrom(
        fakeResponse({ headers: { date: 'Sun, 18 Oct 2026 07:12:21 GMT' } }),
      ),
    ).toBe(timestamp);
  });

  it('accepts a numeric x-warrly-cached-at override', () => {
    expect(
      core.cachedAtFrom(
        fakeResponse({ headers: { 'x-warrly-cached-at': '1700000000000' } }),
      ),
    ).toBe(1_700_000_000_000);
  });

  it('returns null for missing or unusable metadata', () => {
    expect(core.cachedAtFrom(fakeResponse())).toBeNull();
    expect(core.cachedAtFrom(fakeResponse({ headers: { date: 'not-a-date' } }))).toBeNull();
  });

  it('treats documents without a date as older than any threshold', () => {
    const fresh = fakeResponse({ headers: { date: 'Sun, 18 Oct 2026 12:00:00 GMT' } });
    const now = Date.parse('Sun, 18 Oct 2026 12:30:00 GMT');
    expect(core.isOlderThan(fresh, now, 60 * 60 * 1000)).toBe(false);
    expect(core.isOlderThan(fresh, now, 15 * 60 * 1000)).toBe(true);
    expect(core.isOlderThan(fakeResponse(), now, 15 * 60 * 1000)).toBe(true);
  });
});

describe('stale banner', () => {
  it('detects the document language', () => {
    expect(core.localeFromHtml('<html lang="vi" class="x">')).toBe('vi');
    expect(core.localeFromHtml('<html class="x" lang="en-US">')).toBe('en');
    expect(core.localeFromHtml('<html>')).toBe('en');
    expect(core.localeFromHtml('')).toBe('en');
  });

  it('says when the data was saved, in the document language', () => {
    const timestamp = Date.parse('Sun, 18 Oct 2026 12:00:00 GMT');
    expect(core.staleMessage('vi', timestamp)).toContain('Dữ liệu đã lưu lúc');
    expect(core.staleMessage('vi', timestamp)).toContain('có thể đã cũ');
    expect(core.staleMessage('en', timestamp)).toContain('Saved');
    expect(core.staleMessage('en', timestamp)).toContain('may be out of date');
  });

  it('still warns when the save time is unknown', () => {
    expect(core.staleMessage('vi', null)).toContain('Dữ liệu đã lưu trước đó');
    expect(core.staleMessage('en', null)).toContain('Saved earlier');
  });

  it('renders a sticky, high-contrast pseudo-element style', () => {
    const css = core.staleBannerCss('vi', Date.parse('Sun, 18 Oct 2026 12:00:00 GMT'));
    expect(css).toContain('body::before');
    expect(css).toContain('position:sticky');
    expect(css).toContain('z-index:2147483647');
    expect(css).toContain('#FEF3C7');
    expect(css).toContain('content:"');
  });

  it('injects the style into head without touching the React-managed body', () => {
    const html =
      '<!doctype html><html lang="vi"><head><meta charset="utf-8"></head>' +
      '<body><main>Thiết bị</main></body></html>';
    const result = core.injectStaleBanner(html, core.staleBannerCss('vi', null));

    expect(result.indexOf('data-warrly-offline-banner')).toBeGreaterThan(-1);
    expect(result.indexOf('data-warrly-offline-banner')).toBeLessThan(
      result.indexOf('</head>'),
    );
    expect(result).toContain('<body><main>Thiết bị</main></body>');
  });

  it('is idempotent', () => {
    const html = '<html><head></head><body>x</body></html>';
    const once = core.injectStaleBanner(html, core.staleBannerCss('en', null));
    const twice = core.injectStaleBanner(once, core.staleBannerCss('en', null));
    expect(twice).toBe(once);
    expect(twice.match(/data-warrly-offline-banner/g)?.length).toBe(1);
  });

  it('falls back to prepending when a document has no head', () => {
    const result = core.injectStaleBanner('<p>x</p>', 'body::before{content:"x"}');
    expect(result.startsWith('<style data-warrly-offline-banner="1">')).toBe(true);
  });
});

describe('offline shell asset discovery', () => {
  it('collects same-origin Next static assets, decodes entities and dedupes', () => {
    const html = [
      '<link rel="stylesheet" href="/_next/static/css/a.css">',
      '<script src="/_next/static/chunks/b.js?dpl=1"></script>',
      '<script src="/_next/static/chunks/b.js?dpl=1"></script>',
      '<script src="https://cdn.example/x.js"></script>',
      '<img src="/_next/image?url=x">',
      '<script src="/_next/static/chunks/c.js?x=1&amp;y=2"></script>',
    ].join('');

    expect(core.parseShellAssetUrls(html)).toEqual([
      '/_next/static/css/a.css',
      '/_next/static/chunks/b.js?dpl=1',
      '/_next/static/chunks/c.js?x=1&y=2',
    ]);
  });
});

describe('priming', () => {
  it('warms the lookup pages, not all 50 device detail pages', () => {
    expect(core.PRIME_URLS).toEqual(['/dashboard', '/devices', '/reminders']);
    expect(core.PRIME_URLS).not.toContain('/devices/abc');
    expect(core.PRIME_MAX_AGE_MS).toBe(6 * 60 * 60 * 1000);
  });
});
