import { readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { hasMessage, translate } from '@/lib/i18n/catalog';
import { PWA_SHORTCUTS, buildWebManifest } from '@/lib/pwa-manifest';

// The installed-PWA shortcuts are the web's honest answer to a home-screen
// widget: a long-press on the app icon must actually land somewhere. Two
// failure modes matter, and neither is visible in a type check:
//
//   1. a shortcut URL that does not resolve to a route file (the OS happily
//      opens a 404);
//   2. a label that is not in the dictionary (it renders Vietnamese to an
//      English reader, or worse, an empty label).
//
// Both are pinned against the real source tree / catalog below.

const WEBSITE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const APP_DIR = join(WEBSITE_ROOT, 'src', 'app');
const VIETNAMESE_ONLY = /[ăâđêôơưĂÂĐÊÔƠƯẠ-ỹ]/;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
}

/**
 * Every URL the app actually serves, derived from `app/**\/page.tsx` and
 * `app/**\/route.ts`. Route groups (`(app)`, `(public)`, `(auth)`) contribute
 * no URL segment, exactly as Next.js treats them.
 */
function appRoutes(): Set<string> {
  const routes = new Set<string>();
  for (const file of walk(APP_DIR)) {
    const parts = relative(APP_DIR, file).split(sep);
    const base = parts[parts.length - 1];
    if (base !== 'page.tsx' && base !== 'route.ts') continue;
    const segments = parts
      .slice(0, -1)
      .filter((segment) => !/^\(.+\)$/.test(segment));
    routes.add(segments.length === 0 ? '/' : `/${segments.join('/')}`);
  }
  return routes;
}

function pathnameOf(url: string): string {
  return new URL(url, 'https://warrly.test').pathname;
}

describe('PWA shortcuts', () => {
  const routes = appRoutes();

  it('discovers the real route tree (so the check below is not vacuous)', () => {
    // If `appRoutes()` stopped finding pages, every shortcut would fail — but
    // the important thing is that the positive cases below are meaningful.
    expect(routes.size).toBeGreaterThan(30);
    expect(routes.has('/devices/new')).toBe(true);
    expect(routes.has('/inbox')).toBe(true);
    expect(routes.has('/reminders')).toBe(true);
  });

  it('points every shortcut at a route file that exists', () => {
    const broken = PWA_SHORTCUTS.filter(
      (shortcut) => !routes.has(pathnameOf(shortcut.url)),
    ).map((shortcut) => `${shortcut.url} → no page.tsx/route.ts`);
    expect(broken).toEqual([]);
  });

  it('keeps the three repeat actions (add, inbox, what is due)', () => {
    expect(PWA_SHORTCUTS.map((shortcut) => shortcut.url)).toEqual([
      '/devices/new',
      '/inbox',
      '/reminders',
    ]);
  });

  it('uses only same-origin absolute paths and has no duplicates', () => {
    const urls = PWA_SHORTCUTS.map((shortcut) => shortcut.url);
    expect(new Set(urls).size).toBe(urls.length);
    for (const url of urls) {
      expect(url.startsWith('/'), url).toBe(true);
      // `//evil.test` is protocol-relative, i.e. a different origin.
      expect(url.startsWith('//'), url).toBe(false);
      expect(new URL(url, 'https://warrly.test').origin).toBe('https://warrly.test');
    }
  });

  it('registers both labels of every shortcut in both languages', () => {
    const missing: string[] = [];
    const untranslated: string[] = [];
    for (const shortcut of PWA_SHORTCUTS) {
      for (const key of [shortcut.name, shortcut.shortName]) {
        if (!hasMessage(key)) missing.push(key);
        const english = translate('en', key);
        if (!english.trim() || VIETNAMESE_ONLY.test(english)) {
          untranslated.push(`${key} → ${JSON.stringify(english)}`);
        }
      }
    }
    expect(missing).toEqual([]);
    expect(untranslated).toEqual([]);
  });
});

describe('generated manifest', () => {
  it('is English by default and Vietnamese when asked', () => {
    const en = buildWebManifest('en');
    const vi = buildWebManifest('vi');

    expect(en.lang).toBe('en');
    expect(vi.lang).toBe('vi');
    expect(en.name).toBe('Warrly — Warranty and subscription tracker');
    expect(vi.name).toBe('Warrly — Quản lý bảo hành & gói đăng ký');
    expect(en.name).not.toBe(vi.name);
    expect(en.description).not.toBe(vi.description);
  });

  it('translates the shortcut labels, not just the app name', () => {
    expect(buildWebManifest('en').shortcuts?.map((s) => s.name)).toEqual([
      'Add a device',
      'Inbox',
      'Reminders',
    ]);
    expect(buildWebManifest('en').shortcuts?.map((s) => s.short_name)).toEqual([
      'Add',
      'Inbox',
      'Due',
    ]);
    expect(buildWebManifest('vi').shortcuts?.map((s) => s.name)).toEqual([
      'Thêm thiết bị',
      'Hộp thư',
      'Nhắc nhở',
    ]);
  });

  it('carries each shortcut URL and an icon into the manifest payload', () => {
    const manifest = buildWebManifest('en');
    expect(manifest.shortcuts).toHaveLength(PWA_SHORTCUTS.length);
    for (let i = 0; i < PWA_SHORTCUTS.length; i += 1) {
      expect(manifest.shortcuts?.[i]?.url).toBe(PWA_SHORTCUTS[i].url);
      expect(manifest.shortcuts?.[i]?.icons).toEqual([
        { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      ]);
    }
  });

  it('keeps the scope/start URL and the standalone display mode', () => {
    const manifest = buildWebManifest('en');
    expect(manifest.start_url).toBe('/dashboard');
    expect(manifest.scope).toBe('/');
    expect(manifest.display).toBe('standalone');
    expect(manifest.short_name).toBe('Warrly');
  });
});
