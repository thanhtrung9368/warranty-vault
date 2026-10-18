// Browser-side helpers for the offline document cache.
//
// The cache itself lives in the service worker (`public/sw.js`); this module
// only does the two things a page needs:
//
//   1. DELETE the cached device/warranty documents on sign-out. That is a
//      privacy requirement, not tidiness: the cache contains one account's
//      devices, and a shared browser must not hand them to the next account.
//      The caller is `components/user-menu.tsx` (sign-out),
//      `components/delete-account-form.tsx` (account deletion) and
//      `components/offline-cache-cleaner.tsx` (any signed-out auth page, which
//      also covers a session that expired while the tab was idle).
//   2. LIST what is cached for the offline page, so "you can still read this"
//      is backed by visible links instead of a claim.
//
// Cache names are versioned in `public/sw-core.js`. Only the pages cache is
// touched here — the offline shell and hashed JS/CSS contain no account data.

'use client';

export const OFFLINE_PAGE_CACHE_PREFIX = 'wv-pages-';

export type OfflinePageEntry = {
  /** Same-origin path + query, ready for an `<a href>`. */
  url: string;
  /** Human label parsed from the cached document's `<h1>` (or `<title>`). */
  title: string;
  /** Epoch ms from the cached response's `Date` header, when present. */
  cachedAt: number | null;
};

function cacheStorage(): CacheStorage | null {
  try {
    if (typeof caches === 'undefined') return null;
    return caches;
  } catch {
    // Cache Storage throws in some private-browsing modes.
    return null;
  }
}

/**
 * Delete every cached *page* (device list, device detail, dashboard,
 * reminders). Best-effort and never throwing: sign-out must proceed even when
 * the browser refuses to open Cache Storage.
 */
export async function clearOfflinePageCache(): Promise<void> {
  const storage = cacheStorage();
  if (!storage) return;
  try {
    const names = await storage.keys();
    await Promise.all(
      names
        .filter((name) => name.indexOf(OFFLINE_PAGE_CACHE_PREFIX) === 0)
        .map((name) => storage.delete(name)),
    );
  } catch {
    // Never block sign-out on a cache error.
  }
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

function decodeEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, code: string) => {
    const lower = code.toLowerCase();
    if (lower.charAt(0) === '#') {
      const hex = lower.charAt(1) === 'x';
      const digits = hex ? lower.slice(2) : lower.slice(1);
      const point = Number.parseInt(digits, hex ? 16 : 10);
      if (Number.isFinite(point) && point > 0 && point <= 0x10ffff) {
        try {
          return String.fromCodePoint(point);
        } catch {
          return match;
        }
      }
      return match;
    }
    return NAMED_ENTITIES[lower] ?? match;
  });
}

/**
 * The page's own heading, used as a link label. Next renders the device name
 * in the detail page's `<h1>`; the dashboard/reminders pages have their normal
 * section heading. Falls back to `<title>`, then null.
 */
export function titleFromCachedHtml(html: string): string | null {
  if (!html) return null;
  const h1 = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  const title = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const raw = h1?.[1] ?? title?.[1];
  if (!raw) return null;
  const text = decodeEntities(raw.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
  return text || null;
}

/**
 * Everything the service worker has stored for offline reading, newest first,
 * de-duplicated by pathname (a filtered `/devices?q=…` and `/devices` are one
 * section). Intended for the `/offline` page; safe to call with no Cache
 * Storage — it then returns an empty list.
 */
export async function listOfflinePages(limit = 20): Promise<OfflinePageEntry[]> {
  const storage = cacheStorage();
  if (!storage) return [];

  const entries: OfflinePageEntry[] = [];
  const seenPaths = new Set<string>();

  try {
    const names = (await storage.keys()).filter(
      (name) => name.indexOf(OFFLINE_PAGE_CACHE_PREFIX) === 0,
    );

    for (const name of names) {
      const cache = await storage.open(name);
      const requests = (await cache.keys()).slice().sort((a, b) => {
        // Prefer the canonical URL over a cached filtered variant.
        const aSearch = new URL(a.url).search.length;
        const bSearch = new URL(b.url).search.length;
        return aSearch - bSearch;
      });

      for (const request of requests) {
        let url: URL;
        try {
          url = new URL(request.url);
        } catch {
          continue;
        }
        if (seenPaths.has(url.pathname)) continue;

        const response = await cache.match(request, { ignoreVary: true });
        if (!response) continue;

        let html = '';
        try {
          html = await response.clone().text();
        } catch {
          // A non-text body cannot be a page we wrote; skip it.
          continue;
        }

        const dateHeader = response.headers.get('date');
        const parsed = dateHeader ? Date.parse(dateHeader) : Number.NaN;
        entries.push({
          url: url.pathname + url.search,
          title: titleFromCachedHtml(html) ?? url.pathname,
          cachedAt: Number.isFinite(parsed) ? parsed : null,
        });
        seenPaths.add(url.pathname);
      }
    }
  } catch {
    return [];
  }

  return entries
    .sort((a, b) => (b.cachedAt ?? 0) - (a.cachedAt ?? 0))
    .slice(0, limit);
}
