import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  OFFLINE_PAGE_CACHE_PREFIX,
  clearOfflinePageCache,
  listOfflinePages,
  titleFromCachedHtml,
} from '@/lib/offline/cache-client';

// The page cache is the one place an account's device names/dates are stored
// in the browser. These tests pin the two things that matter: the offline page
// lists what is really there, and sign-out removes it.

type Entry = { url: string; html: string; date?: string };

function makeCache(entries: Entry[]) {
  return {
    async keys(): Promise<Request[]> {
      return entries.map((entry) => new Request(entry.url));
    },
    async match(request: Request): Promise<Response | undefined> {
      const entry = entries.find((candidate) => candidate.url === request.url);
      if (!entry) return undefined;
      return new Response(entry.html, {
        status: 200,
        headers: {
          'content-type': 'text/html; charset=utf-8',
          ...(entry.date ? { date: entry.date } : {}),
        },
      });
    },
  };
}

function makeStorage(entriesByCache: Record<string, Entry[]>) {
  const deleted: string[] = [];
  const cachesByName = new Map<string, ReturnType<typeof makeCache>>();
  for (const [name, entries] of Object.entries(entriesByCache)) {
    cachesByName.set(name, makeCache(entries));
  }

  return {
    deleted,
    storage: {
      async keys(): Promise<string[]> {
        return [...cachesByName.keys()];
      },
      async open(name: string) {
        const cache = cachesByName.get(name);
        if (!cache) throw new Error(`no such cache: ${name}`);
        return cache;
      },
      async delete(name: string): Promise<boolean> {
        deleted.push(name);
        return cachesByName.delete(name);
      },
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('titleFromCachedHtml', () => {
  it('uses the page h1 and strips nested markup', () => {
    expect(titleFromCachedHtml('<h1 class="x"><span>iPhone</span> 15</h1>')).toBe(
      'iPhone 15',
    );
  });

  it('decodes the entities React escapes', () => {
    expect(titleFromCachedHtml('<h1>Máy giặt &amp; sấy</h1>')).toBe('Máy giặt & sấy');
  });

  it('falls back to the document title', () => {
    expect(titleFromCachedHtml('<title>Thiết bị — Warrly</title>')).toBe(
      'Thiết bị — Warrly',
    );
  });

  it('returns null when there is no usable heading', () => {
    expect(titleFromCachedHtml('')).toBeNull();
    expect(titleFromCachedHtml('<p>no heading</p>')).toBeNull();
  });
});

describe('listOfflinePages', () => {
  it('lists cached pages newest first, deduplicated by pathname', async () => {
    const { storage } = makeStorage({
      'wv-pages-v2': [
        {
          url: 'http://localhost/devices',
          html: '<h1>Thiết bị</h1>',
          date: 'Sun, 18 Oct 2026 07:00:00 GMT',
        },
        {
          url: 'http://localhost/devices/abc',
          html: '<h1>iPhone 15</h1>',
          date: 'Sun, 18 Oct 2026 08:00:00 GMT',
        },
        {
          url: 'http://localhost/devices?q=iphone',
          html: '<h1>Thiết bị</h1>',
          date: 'Sun, 18 Oct 2026 09:00:00 GMT',
        },
      ],
      // Not a page cache: must not leak asset JS into the list.
      'wv-assets-v2': [
        {
          url: 'http://localhost/devices',
          html: 'not html',
          date: 'Sun, 18 Oct 2026 10:00:00 GMT',
        },
      ],
    });
    vi.stubGlobal('caches', storage);

    const pages = await listOfflinePages();

    expect(pages.map((page) => page.url)).toEqual(['/devices/abc', '/devices']);
    expect(pages.map((page) => page.title)).toEqual(['iPhone 15', 'Thiết bị']);
    expect(pages[0]?.cachedAt).toBe(Date.parse('Sun, 18 Oct 2026 08:00:00 GMT'));
  });

  it('returns an empty list when nothing is cached', async () => {
    const { storage } = makeStorage({});
    vi.stubGlobal('caches', storage);
    await expect(listOfflinePages()).resolves.toEqual([]);
  });

  it('returns an empty list when Cache Storage is unavailable', async () => {
    vi.stubGlobal('caches', undefined);
    await expect(listOfflinePages()).resolves.toEqual([]);
  });

  it('respects the limit', async () => {
    const entries: Entry[] = [];
    for (let i = 0; i < 30; i += 1) {
      entries.push({
        url: `http://localhost/devices/${i}`,
        html: `<h1>Device ${i}</h1>`,
        date: `Sun, 18 Oct 2026 07:${String(i).padStart(2, '0')}:00 GMT`,
      });
    }
    const { storage } = makeStorage({ 'wv-pages-v2': entries });
    vi.stubGlobal('caches', storage);
    await expect(listOfflinePages()).resolves.toHaveLength(20);
  });
});

describe('clearOfflinePageCache', () => {
  it('deletes page caches only, never assets, shell or unrelated caches', async () => {
    const { storage, deleted } = makeStorage({
      'wv-pages-v2': [],
      'wv-pages-v1': [],
      'wv-assets-v2': [],
      'wv-shell-v2': [],
      'unrelated-cache': [],
    });
    vi.stubGlobal('caches', storage);

    await clearOfflinePageCache();

    expect(deleted).toEqual(['wv-pages-v2', 'wv-pages-v1']);
    expect(deleted.every((name) => name.startsWith(OFFLINE_PAGE_CACHE_PREFIX))).toBe(true);
  });

  it('never throws when Cache Storage is unavailable', async () => {
    vi.stubGlobal('caches', undefined);
    await expect(clearOfflinePageCache()).resolves.toBeUndefined();
  });
});

describe('cache prefix', () => {
  it('is the versioned prefix the service worker writes', () => {
    expect(OFFLINE_PAGE_CACHE_PREFIX).toBe('wv-pages-');
  });
});
