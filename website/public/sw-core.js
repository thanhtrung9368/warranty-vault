/*
 * Warrly offline policy — shared by the service worker (via importScripts)
 * and by the unit tests (which evaluate this file in a `vm` sandbox).
 *
 * ── What we cache, and why documents rather than API JSON ────────────────
 *
 * The web is a thin, server-rendered client: every device/warranty read runs
 * in a Next.js Server Component through `src/lib/api/*`, which talks to the Go
 * API server-to-server with the bearer token from the HttpOnly session cookie.
 * The browser never calls `/api/v1/devices` itself, so there is no API JSON in
 * the page's request graph to cache. (The only same-origin `/api/*` routes are
 * the attachment byte proxy and backup export; caching those is explicitly out
 * of scope — encrypted blobs are not worth it over a phone connection.)
 *
 * That leaves the rendered document as the only honest cacheable unit. It is
 * also the right one: the HTML already contains the device name, warranty rows
 * and dates the user needs in a repair shop.
 *
 * ── Never cache RSC navigations ───────────────────────────────────────────
 *
 * Next's App Router requests flight/RSC payloads with `?_rsc=` and a set of
 * `Next-Router-State-Tree`-style headers. A Cache API entry is keyed by URL,
 * not by those headers, so a cached RSC payload can be replayed against a
 * different router tree and render the wrong subtree. We only cache full
 * navigations (`request.mode === 'navigate'`) and leave every RSC request on
 * the network. Offline links are turned into document navigations by
 * `components/offline-bridge.tsx` instead.
 *
 * ── What about staleness? ─────────────────────────────────────────────────
 *
 * The root layout links a tiny `/offline-indicator.css` on every page. The
 * service worker answers that request with an empty stylesheet online and with
 * a `body::before` amber bar when it has just served this document from the
 * page cache: "saved at … — this data may be out of date". No DOM is injected
 * into the cached HTML, so React hydration compares exactly the tree the
 * server rendered; the banner is a normal same-origin stylesheet request and
 * is visible before any client JS runs.
 *
 * ── Privacy ───────────────────────────────────────────────────────────────
 *
 * A cached document contains one account's devices. Sign-out deletes the page
 * cache from the client (`lib/offline/cache-client.ts`) and a redirect to
 * `/login` deletes it from here, so one shared-browser account cannot read the
 * previous account's records offline.
 *
 * This file is a classic script on purpose: `importScripts` cannot load ES
 * modules, and keeping it out of the Next bundle lets the tests exercise the
 * exact bytes that ship. It must not use `import`/`export`.
 */
(function (root) {
  'use strict';

  // Bump this when the cache shape changes. Activate drops every other
  // `wv-*` cache, including the legacy single-cache `wv-v1`.
  const CACHE_VERSION = 3;
  const CACHE_PREFIX = 'wv-';
  const SHELL_CACHE = 'wv-shell-v' + CACHE_VERSION;
  const PAGE_CACHE = 'wv-pages-v' + CACHE_VERSION;
  const ASSET_CACHE = 'wv-assets-v' + CACHE_VERSION;
  const CURRENT_CACHES = [SHELL_CACHE, PAGE_CACHE, ASSET_CACHE];

  // The page prefix is also referenced by `src/lib/offline/cache-client.ts`.
  // A test pins the two constants together.
  const PAGE_CACHE_PREFIX = 'wv-pages-';

  const OFFLINE_URL = '/offline';
  // Linked from the root layout; the SW generates its content per navigation.
  const OFFLINE_INDICATOR_PATH = '/offline-indicator.css';

  // `addAll` would reject the whole shell if one icon 404s, so these are
  // fetched individually and failures are ignored.
  const SHELL_URLS = [
    OFFLINE_URL,
    '/manifest.webmanifest',
    '/icon.svg',
    '/icon-192.png',
    '/icon-512.png',
    '/apple-touch-icon.png',
  ];

  // Pages worth having offline even if the user never clicked them. The
  // device list is the important one: it is the cheapest way to look up any
  // device's warranty, and it is one server render. Detail pages are cached
  // on visit (there can be 50 of them; pre-fetching all would be megabytes).
  const PRIME_URLS = ['/dashboard', '/devices', '/reminders'];

  // Re-prime at most every six hours. A primed page that is older than this
  // is re-fetched when an authenticated app page mounts. Edits between two
  // primes are still covered by the stale bar; this is a freshness floor, not
  // a live-sync mechanism.
  const PRIME_MAX_AGE_MS = 6 * 60 * 60 * 1000;

  const CACHEABLE_PATHS = new Set(['/dashboard', '/devices', '/reminders']);
  const DEVICE_DETAIL = /^\/devices\/([^/]+)$/;

  const STATIC_ASSET_PATHS = new Set([
    '/icon.svg',
    '/manifest.webmanifest',
    '/apple-touch-icon.png',
    '/icon-192.png',
    '/icon-512.png',
  ]);

  function urlPath(input) {
    try {
      const url = new URL(input, 'http://warrly.invalid');
      return url.pathname;
    } catch {
      return null;
    }
  }

  /**
   * The routes whose rendered documents are safe and useful offline.
   *
   * Deliberately excluded: `/login`, `/register`, `/offline` (served from the
   * shell cache), every form page (`/devices/new`, `/devices/import`,
   * `/devices/<id>/edit`), `/settings` (account mutation chrome, no warranty
   * value), and `/stats` (charts are heavy and not a lookup surface).
   */
  function isCacheableDocumentPath(pathname) {
    if (!pathname) return false;
    if (CACHEABLE_PATHS.has(pathname)) return true;
    const detail = DEVICE_DETAIL.exec(pathname);
    if (!detail) return false;
    const id = detail[1];
    return id !== 'new' && id !== 'import';
  }

  function isCacheableDocumentUrl(input) {
    return isCacheableDocumentPath(urlPath(input));
  }

  /** Hashed Next build output + the handful of PWA icons. Cache-first is safe. */
  function isStaticAsset(input) {
    const pathname = urlPath(input);
    if (!pathname) return false;
    if (pathname.indexOf('/_next/static/') === 0) return true;
    return STATIC_ASSET_PATHS.has(pathname);
  }

  function isRscRequest(request) {
    if (!request) return false;
    try {
      const url = new URL(request.url);
      if (url.searchParams.has('_rsc')) return true;
    } catch {
      // fall through to headers
    }
    const headers = request.headers;
    if (!headers || typeof headers.get !== 'function') return false;
    return Boolean(
      headers.get('rsc') === '1' ||
        headers.get('next-router-state-tree') ||
        headers.get('next-router-prefetch') ||
        headers.get('next-router-segment-prefetch'),
    );
  }

  /**
   * Whether a network navigation response should be written to the page cache.
   *
   * The final URL must still be a cacheable app path. That single check rejects
   * the signed-out redirect to `/login` — the most dangerous thing we could
   * accidentally cache under `/dashboard`.
   */
  function shouldCacheDocument(request, response) {
    if (!request || !response) return false;
    if (request.method !== 'GET') return false;
    if (request.mode !== 'navigate') return false;
    if (isRscRequest(request)) return false;
    return isCacheableResponse(request.url, response);
  }

  /**
   * The same check for a programmatic `fetch()` of a page (cache priming),
   * where the synthetic request has no `navigate` mode.
   */
  function shouldCacheFetchedPage(requestUrl, response) {
    return isCacheableResponse(requestUrl, response);
  }

  function isCacheableResponse(requestUrl, response) {
    if (!response) return false;
    if (!response.ok || response.status !== 200) return false;
    const finalPath = urlPath(response.url);
    if (!isCacheableDocumentPath(finalPath)) return false;
    const requestedPath = urlPath(requestUrl);
    if (!isCacheableDocumentPath(requestedPath)) return false;
    // A redirect to a different path is not the page we asked for. Allow the
    // same path (a harmless trailing-slash/canonical redirect), reject the rest.
    if (finalPath !== requestedPath) return false;
    const contentType = response.headers ? response.headers.get('content-type') : null;
    return Boolean(contentType && /^text\/html\b/i.test(contentType));
  }

  /**
   * When a document was fetched. The HTTP `Date` header is written by the Next
   * server on the original response and survives Cache Storage, so no sidecar
   * metadata cache is needed. `x-warrly-cached-at` is accepted too, so a future
   * writer can override it without changing the reader.
   */
  function cachedAtFrom(response) {
    if (!response || !response.headers || typeof response.headers.get !== 'function') {
      return null;
    }
    const override = response.headers.get('x-warrly-cached-at');
    const raw = override || response.headers.get('date');
    if (!raw) return null;
    // `x-warrly-cached-at` is written as unix milliseconds; an HTTP `Date` is
    // an RFC 7231 string. Accept both rather than making the reader care.
    const numeric = Number(raw);
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
    const timestamp = Date.parse(raw);
    return Number.isFinite(timestamp) ? timestamp : null;
  }

  function isOlderThan(response, now, maxAgeMs) {
    const timestamp = cachedAtFrom(response);
    if (timestamp === null) return true;
    return now - timestamp >= maxAgeMs;
  }

  function localeFromHtml(html) {
    const match = /<html\b[^>]*\blang\s*=\s*["']([^"']+)["']/i.exec(html || '');
    if (!match) return 'en';
    return match[1].toLowerCase().indexOf('vi') === 0 ? 'vi' : 'en';
  }

  function formatCachedAt(timestamp, locale) {
    if (timestamp === null || timestamp === undefined) return null;
    const language = locale === 'vi' ? 'vi-VN' : 'en-US';
    try {
      return new Date(timestamp).toLocaleString(language, {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return new Date(timestamp).toISOString().slice(0, 16).replace('T', ' ');
    }
  }

  /**
   * The stale notice. Vietnamese is the app's source language and the default
   * for a cached page with no `lang`; the English wording is here rather than
   * in the Next i18n catalog because this string is produced by the service
   * worker, which cannot import the app bundle.
   */
  function staleMessage(locale, timestamp) {
    const when = formatCachedAt(timestamp, locale);
    if (locale === 'vi') {
      return when
        ? '⚠ Dữ liệu đã lưu lúc ' +
            when +
            ' — có thể đã cũ. Kết nối lại để cập nhật.'
        : '⚠ Dữ liệu đã lưu trước đó — có thể đã cũ. Kết nối lại để cập nhật.';
    }
    return when
      ? '⚠ Saved ' + when + ' — this data may be out of date. Reconnect to refresh.'
      : '⚠ Saved earlier — this data may be out of date. Reconnect to refresh.';
  }

  function escapeCssString(value) {
    return String(value)
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\A ')
      .replace(/\r/g, ' ');
  }

  /**
   * A `body::before` banner. Sticky so it stays visible while the user scrolls
   * a long warranty list, and with a high z-index so an app-level overlay
   * cannot hide it. This string is served as `/offline-indicator.css`; it does
   * not depend on any app stylesheet, so the first offline view is marked even
   * if the page's CSS chunk was never cached.
   */
  function staleBannerCss(locale, timestamp) {
    const message = escapeCssString(staleMessage(locale, timestamp));
    return (
      'body::before{content:"' +
      message +
      '";display:block;position:sticky;top:0;z-index:2147483647;' +
      'box-sizing:border-box;width:100%;padding:10px 16px;' +
      'background:#FEF3C7;color:#78350F;border-bottom:1px solid #F59E0B;' +
      "font:600 13px/1.45 system-ui,-apple-system,'Segoe UI',sans-serif;" +
      'text-align:center;white-space:normal;' +
      'box-shadow:0 2px 8px rgba(120,53,15,.12);}'
    );
  }

  /** Assets referenced by the precached offline page, so the first offline view is styled. */
  function parseShellAssetUrls(html) {
    const urls = new Set();
    const re = /(?:src|href)\s*=\s*["']([^"']+)["']/gi;
    let match;
    while ((match = re.exec(html || '')) !== null) {
      const raw = match[1].replace(/&amp;/g, '&');
      if (raw.indexOf('/_next/static/') === 0) urls.add(raw);
    }
    return Array.from(urls);
  }

  function isWarrlyCache(name) {
    return typeof name === 'string' && name.indexOf(CACHE_PREFIX) === 0;
  }

  function isCurrentCache(name) {
    return CURRENT_CACHES.indexOf(name) !== -1;
  }

  /** Old-version caches to delete on activate. Scoped to this app's prefix. */
  function staleCacheNames(names) {
    return (names || []).filter(function (name) {
      return isWarrlyCache(name) && !isCurrentCache(name);
    });
  }

  root.WVOffline = {
    CACHE_VERSION: CACHE_VERSION,
    SHELL_CACHE: SHELL_CACHE,
    PAGE_CACHE: PAGE_CACHE,
    ASSET_CACHE: ASSET_CACHE,
    CURRENT_CACHES: CURRENT_CACHES,
    PAGE_CACHE_PREFIX: PAGE_CACHE_PREFIX,
    OFFLINE_URL: OFFLINE_URL,
    OFFLINE_INDICATOR_PATH: OFFLINE_INDICATOR_PATH,
    SHELL_URLS: SHELL_URLS,
    PRIME_URLS: PRIME_URLS,
    PRIME_MAX_AGE_MS: PRIME_MAX_AGE_MS,
    urlPath: urlPath,
    isCacheableDocumentPath: isCacheableDocumentPath,
    isCacheableDocumentUrl: isCacheableDocumentUrl,
    isStaticAsset: isStaticAsset,
    isRscRequest: isRscRequest,
    shouldCacheDocument: shouldCacheDocument,
    shouldCacheFetchedPage: shouldCacheFetchedPage,
    cachedAtFrom: cachedAtFrom,
    isOlderThan: isOlderThan,
    localeFromHtml: localeFromHtml,
    formatCachedAt: formatCachedAt,
    staleMessage: staleMessage,
    staleBannerCss: staleBannerCss,
    parseShellAssetUrls: parseShellAssetUrls,
    staleCacheNames: staleCacheNames,
  };
})(typeof self !== 'undefined' ? self : this);
