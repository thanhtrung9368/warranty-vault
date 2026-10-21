// `/sitemap.xml` and `/robots.txt`, pinned as data.
//
// The served output is verified against the built server too, but these
// assertions are the cheap regression guard: a new public page must be added to
// `PUBLIC_PATHS` (which drives both the sitemap and the hreflang set), and a
// private surface must never leak into the list.

import { describe, expect, it } from 'vitest';
import robots from '@/app/robots';
import sitemap from '@/app/sitemap';

const ORIGIN = 'https://warrly.com';

const EXPECTED = [
  '/',
  '/vi',
  '/privacy',
  '/vi/privacy',
  '/terms',
  '/vi/terms',
  '/cookies',
  '/vi/cookies',
].map((path) => `${ORIGIN}${path}`);

describe('sitemap.xml', () => {
  const entries = sitemap();

  it('lists exactly the eight public, canonical, indexable URLs', () => {
    expect(entries.map((entry) => entry.url)).toEqual(EXPECTED);
  });

  it('gives every entry its en/vi/x-default alternate set', () => {
    const pairs: Record<string, { en: string; vi: string }> = {
      '/': { en: `${ORIGIN}/`, vi: `${ORIGIN}/vi` },
      '/privacy': { en: `${ORIGIN}/privacy`, vi: `${ORIGIN}/vi/privacy` },
      '/terms': { en: `${ORIGIN}/terms`, vi: `${ORIGIN}/vi/terms` },
      '/cookies': { en: `${ORIGIN}/cookies`, vi: `${ORIGIN}/vi/cookies` },
    };
    for (const entry of entries) {
      const base = entry.url.replace(/^https:\/\/warrly\.com/, '').replace(/^\/vi(?=\/|$)/, '') || '/';
      const expected = pairs[base];
      expect(expected, `unexpected sitemap URL ${entry.url}`).toBeDefined();
      expect(entry.alternates?.languages).toEqual({
        en: expected.en,
        vi: expected.vi,
        'x-default': expected.en,
      });
    }
  });

  it('never lists an app, auth, OG, API or share URL', () => {
    const xml = JSON.stringify(entries);
    for (const forbidden of [
      '/api',
      '/og',
      '/share',
      '/dashboard',
      '/devices',
      '/login',
      '/register',
      '/settings',
      'token',
    ]) {
      expect(xml).not.toContain(forbidden);
    }
  });

  it('keeps every entry absolute and dated', () => {
    for (const entry of entries) {
      expect(entry.url.startsWith(`${ORIGIN}/`)).toBe(true);
      expect(entry.lastModified).toBeInstanceOf(Date);
    }
  });
});

describe('robots.txt', () => {
  const result = robots();
  const rules = Array.isArray(result.rules) ? result.rules : [result.rules];
  const disallow = rules.flatMap((rule) => {
    const value = (rule as { disallow?: string | string[] }).disallow;
    return Array.isArray(value) ? value : value ? [value] : [];
  });

  it('allows the public site and points at the sitemap', () => {
    expect(rules.some((rule) => (rule as { allow?: string }).allow === '/')).toBe(true);
    expect(result.sitemap).toBe(`${ORIGIN}/sitemap.xml`);
    expect(result.host).toBe(ORIGIN);
  });

  it('does not disallow a page that should be indexed', () => {
    for (const path of ['/', '/privacy', '/terms', '/cookies', '/vi']) {
      expect(disallow).not.toContain(path);
      expect(disallow).not.toContain(`${path}/`);
    }
    expect(disallow).not.toContain('/');
  });

  it('blocks the share certificate surface and non-page endpoints', () => {
    // The certificate is `/api/v1/public/shares/{token}` in Go. `/api/` also
    // covers it; the token must never be crawlable or listed.
    expect(disallow).toContain('/api/');
    expect(disallow).toContain('/og');
    expect(disallow).toContain('/share/');
    expect(disallow).toContain('/_next/');
  });
});
