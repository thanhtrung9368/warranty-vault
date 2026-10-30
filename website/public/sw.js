/* Warrly service worker — push receive + honest offline document cache. */

importScripts('/sw-core.js?v=6');

const {
  SHELL_CACHE,
  PAGE_CACHE,
  ASSET_CACHE,
  OFFLINE_URL,
  OFFLINE_INDICATOR_PATH,
  SHELL_URLS,
  PRIME_URLS,
  PRIME_MAX_AGE_MS,
  PAGE_CACHE_PREFIX,
  isStaticAsset,
  isRscRequest,
  shouldCacheDocument,
  shouldCacheFetchedPage,
  cachedAtFrom,
  isOlderThan,
  localeFromHtml,
  staleBannerCss,
  parseShellAssetUrls,
  staleCacheNames,
} = self.WVOffline;

// ── Cache helpers ─────────────────────────────────────────────────────────
//
// Every cache write is best-effort. Quota exhaustion, an opaque response, or
// a concurrent delete must never turn a successful online navigation into an
// error page.

async function putInCache(cacheName, request, response) {
  try {
    const cache = await caches.open(cacheName);
    await cache.put(request, response);
  } catch {
    // Offline caching is an enhancement; a failed write is not a fetch error.
  }
}

async function clearPageCache() {
  try {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((key) => key.indexOf(PAGE_CACHE_PREFIX) === 0)
        .map((key) => caches.delete(key)),
    );
  } catch {
    // Best effort. The client-side sign-out path runs the same deletion.
  }
}

// When a document is served from the page cache, remember its save time so
// the very next request for `/offline-indicator.css` (the <link> in the root
// layout) can render the stale bar. This is a short-lived, per-URL marker:
// the stylesheet request lands milliseconds after the document, and a fresh
// 200 for the same URL deletes the marker before its stylesheet is requested,
// so a second tab cannot be marked stale. A page served from the network with
// no marker gets an empty stylesheet.
const INDICATOR_TTL_MS = 60 * 1000;
const recentlyStale = new Map();

function rememberStale(url, cachedAt, locale) {
  if (!url) return;
  const now = Date.now();
  if (recentlyStale.size > 40) {
    for (const [key, entry] of recentlyStale) {
      if (now - entry.servedAt > INDICATOR_TTL_MS) recentlyStale.delete(key);
    }
  }
  recentlyStale.set(url, { cachedAt, locale, servedAt: now });
}

function recentStaleFor(url) {
  if (!url) return null;
  const entry = recentlyStale.get(url);
  if (!entry) return null;
  if (Date.now() - entry.servedAt > INDICATOR_TTL_MS) {
    recentlyStale.delete(url);
    return null;
  }
  return entry;
}

function fetchWithReload(input) {
  return fetch(
    new Request(input, {
      cache: 'reload',
      credentials: 'same-origin',
    }),
  );
}

// ── install ───────────────────────────────────────────────────────────────
//
// Precache the offline page and its PWA chrome. Then parse that page's own
// `/_next/static/*` references and cache them too: a phone that installs the
// worker and immediately loses signal should still get a styled offline page,
// not a browser-default one. Per-URL failures are ignored.

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const shell = await caches.open(SHELL_CACHE);
      for (const url of SHELL_URLS) {
        try {
          const response = await fetchWithReload(url);
          if (response.ok) await shell.put(url, response);
        } catch {
          // Keep installing; the remaining shell URLs are still useful.
        }
      }

      try {
        const offline = await shell.match(OFFLINE_URL);
        if (offline) {
          const html = await offline.clone().text();
          const assets = await caches.open(ASSET_CACHE);
          await Promise.all(
            parseShellAssetUrls(html).map(async (url) => {
              try {
                const response = await fetchWithReload(url);
                if (response.ok) await assets.put(url, response);
              } catch {
                // Ignore one missing chunk; the page remains readable.
              }
            }),
          );
        }
      } catch {
        // Ignore malformed/unreadable shell HTML.
      }

      await self.skipWaiting();
    })(),
  );
});

// ── activate ──────────────────────────────────────────────────────────────
//
// Delete every `wv-*` cache that is not one of this version's three. That
// includes the old single `wv-v1` cache. Scoped by prefix so we never delete a
// cache another app on the same origin owns.

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const keys = await caches.keys();
        await Promise.all(staleCacheNames(keys).map((key) => caches.delete(key)));
      } catch {
        // If Cache Storage is unavailable, there is nothing useful to delete.
      }
      await self.clients.claim();
    })(),
  );
});

// ── messages from the app ─────────────────────────────────────────────────
//
// WV_PRIME: sent by `components/offline-bridge.tsx` from authenticated pages.
// It keeps `/dashboard`, `/devices` and `/reminders` warm without prefetching
// all 50 device detail pages. A redirect to `/login` during priming means the
// session is gone — delete the account's cached documents immediately.
//
// WV_CLEAR_USER_DATA: a belt-and-braces clear for any other caller.

self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || typeof data !== 'object') return;
  if (data.type === 'WV_PRIME') event.waitUntil(primeCorePages());
  if (data.type === 'WV_CLEAR_USER_DATA') event.waitUntil(clearPageCache());
});

async function primeCorePages() {
  let cache;
  try {
    cache = await caches.open(PAGE_CACHE);
  } catch {
    return;
  }

  for (const url of PRIME_URLS) {
    const existing = await cache.match(url, { ignoreVary: true });
    if (existing && !isOlderThan(existing, Date.now(), PRIME_MAX_AGE_MS)) continue;

    try {
      const response = await fetchWithReload(url);
      let finalPath = null;
      try {
        finalPath = new URL(response.url).pathname;
      } catch {
        finalPath = null;
      }
      if (response.redirected && finalPath === '/login') {
        await clearPageCache();
        return;
      }
      if (shouldCacheFetchedPage(url, response)) {
        await cache.put(url, response.clone());
      }
    } catch {
      // Offline right now: keep whatever is already cached.
    }
  }
}

// ── fetch ─────────────────────────────────────────────────────────────────
//
// Four lanes:
//   1. `/offline-indicator.css` → generated locally; stale bar or empty.
//   2. `/_next/static/*` + PWA icons → cache-first (hashed, immutable).
//   3. Full document navigations        → network-first, cached document when
//      the network fails, offline shell when even that is missing.
//   4. Everything else (RSC payloads, `/api/files/*`, backup routes, images)
//      → untouched. We deliberately do not cache RSC or attachment bytes.

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin) return;

  // The root layout links this on every page. It is the stale marker: an empty
  // stylesheet for a network-fresh page, a `body::before` bar for a page this
  // worker just served from the page cache. Generating it here (instead of
  // injecting DOM into the cached HTML) keeps hydration byte-for-byte clean.
  if (url.pathname === OFFLINE_INDICATOR_PATH) {
    event.respondWith(offlineIndicatorResponse(request));
    return;
  }

  // Attachment bytes, backup downloads and any future API read stay online-only.
  if (url.pathname.indexOf('/api/') === 0) return;

  if (isStaticAsset(request.url)) {
    event.respondWith(cacheFirstAsset(request));
    return;
  }

  if (request.mode === 'navigate' && !isRscRequest(request)) {
    event.respondWith(networkFirstDocument(request));
  }
});

function offlineIndicatorResponse(request) {
  const stale = recentStaleFor(request.referrer || '');
  const css = stale ? staleBannerCss(stale.locale, stale.cachedAt) : '';

  return new Response(css, {
    status: 200,
    headers: {
      'content-type': 'text/css; charset=utf-8',
      // Never let the browser cache the empty version and serve it later to a
      // stale document (or vice versa).
      'cache-control': 'no-store',
    },
  });
}

async function cacheFirstAsset(request) {
  let cache;
  try {
    cache = await caches.open(ASSET_CACHE);
    const hit = await cache.match(request, { ignoreVary: true });
    if (hit) return hit;
  } catch {
    // Fall through to the network if Cache Storage is unavailable.
  }

  try {
    const response = await fetch(request);
    if (response.ok && response.status === 200 && !request.headers.has('range')) {
      await putInCache(ASSET_CACHE, request, response.clone());
    }
    return response;
  } catch {
    return new Response('', { status: 504, statusText: 'Gateway Timeout' });
  }
}

async function networkFirstDocument(request) {
  try {
    const response = await fetch(request);

    // A fresh 200 for this URL is the authority: any stale marker from an
    // earlier cached view must not leak onto it (or onto a second tab).
    if (response.ok && response.status === 200) recentlyStale.delete(request.url);

    if (shouldCacheDocument(request, response)) {
      await putInCache(PAGE_CACHE, request, response.clone());
    } else {
      // A server-side redirect to /login means this browser no longer owns the
      // account whose pages are cached. Drop them now, not after a sign-out
      // button the user may never reach.
      let finalPath = null;
      try {
        finalPath = new URL(response.url).pathname;
      } catch {
        finalPath = null;
      }
      if (response.redirected && finalPath === '/login') {
        await clearPageCache();
      }
    }

    return response;
  } catch {
    // The network is unreachable (the only case where we serve stale data).
    const cached = await matchCachedDocument(request);
    if (cached) {
      const cachedAt = cachedAtFrom(cached);
      let locale = 'en';
      try {
        locale = localeFromHtml(await cached.clone().text());
      } catch {
        // Keep the default; the banner is still shown.
      }
      // The <link rel=stylesheet> request arrives immediately after this
      // response is parsed; its Referer is this URL.
      rememberStale(request.url, cachedAt, locale);
      return cached;
    }

    try {
      const shell = await caches.match(OFFLINE_URL);
      if (shell) return shell;
    } catch {
      // Fall through to the minimal response.
    }

    return minimalOfflineResponse();
  }
}

async function matchCachedDocument(request) {
  try {
    const cache = await caches.open(PAGE_CACHE);
    const exact = await cache.match(request, { ignoreVary: true });
    if (exact) return exact;

    // `/devices?q=…` should fall back to the unfiltered `/devices` document if
    // one was primed. We do not match an arbitrary filtered variant: showing a
    // subset without its filter would be a quiet lie.
    const url = new URL(request.url);
    if (url.search) {
      const canonical = await cache.match(url.origin + url.pathname, { ignoreVary: true });
      if (canonical) return canonical;
    }
    return null;
  } catch {
    return null;
  }
}

function minimalOfflineResponse() {
  const html =
    '<!doctype html><html lang="vi"><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Ngoại tuyến — Warrly</title>' +
    '<body style="font-family:system-ui,sans-serif;padding:2rem;line-height:1.5">' +
    '<h1>Mất kết nối / You are offline</h1>' +
    '<p>Kết nối lại rồi thử lại. / Reconnect and try again.</p>' +
    '</body></html>';
  return new Response(html, {
    status: 503,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

// ── push ──────────────────────────────────────────────────────────────────

self.addEventListener('push', (event) => {
  let payload = { title: 'Warrly', body: 'Có cập nhật bảo hành' };
  try {
    if (event.data) payload = { ...payload, ...event.data.json() };
  } catch {
    // ignore parse error — use default payload
  }
  const { title, body, url = '/reminders', tag = 'warranty' } = payload;
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag,
      // `icon` is the colour notification image; `badge` is the Android status
      // bar glyph and MUST be monochrome on transparent. The old code sent
      // `/icon.svg` for both, so the status-bar badge was a full-colour,
      // transparent-cornered scene that Android rendered as a grey blob.
      icon: '/notification-icon-192.png',
      badge: '/notification-badge-96.png',
      lang: 'vi',
      data: { url },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/reminders';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clientList) => {
      // If an existing tab is already on the target URL, just focus it.
      for (const client of clientList) {
        if (client.url.endsWith(url) && 'focus' in client) return client.focus();
      }
      // Else, navigate any open Warrly tab to the target URL — avoids
      // opening a fresh tab when the user already has the app open.
      for (const client of clientList) {
        if ('navigate' in client && 'focus' in client) {
          try {
            await client.navigate(url);
            return client.focus();
          } catch {
            // navigate() can fail across origins or for detached clients — fall through.
          }
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    }),
  );
});
