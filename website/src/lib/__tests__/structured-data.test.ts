// Structured data: the nodes that ship, and the two that must never appear.
//
// The negative assertion is the point. A `SoftwareApplication` node is only
// eligible for a rich result when it carries `aggregateRating` or `review`;
// Warrly has neither, so inventing a rating is a Google manual-action risk, not
// a "completeness" fix. A validator reporting that as critical is correct.
// This test makes sure nobody later adds a number to satisfy it.
//
// It also pins the source-scan side: the only file allowed to emit an
// `application/ld+json` script is the one module, so a new inline FAQPage /
// LocalBusiness / rating node cannot sneak onto a page without touching this
// registry.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  BRAND_LOGO_PATH,
  SUPPORT_EMAIL,
  jsonLdHtml,
  publicStructuredData,
} from '@/lib/structured-data';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(ts|tsx)$/.test(path)) out.push(path);
  }
  return out;
}

describe('the site JSON-LD', () => {
  const html = jsonLdHtml();
  const parsed = JSON.parse(html) as {
    '@context': string;
    '@graph': Array<Record<string, unknown>>;
  };

  it('is valid JSON with a WebSite and an Organization node', () => {
    expect(parsed['@context']).toBe('https://schema.org');
    expect(parsed['@graph'].map((node) => node['@type'])).toEqual([
      'WebSite',
      'Organization',
    ]);
  });

  it('names the site, lists both languages, and points at the live origin', () => {
    const [website, organization] = parsed['@graph'];
    expect(website).toMatchObject({
      name: 'Warrly',
      alternateName: 'Warrly — Quản lý bảo hành & gói đăng ký',
      url: 'https://warrly.com/',
      inLanguage: ['vi', 'en'],
    });

    expect(organization).toMatchObject({
      name: 'Warrly',
      url: 'https://warrly.com/',
      logo: `https://warrly.com${BRAND_LOGO_PATH}`,
      email: SUPPORT_EMAIL,
    });
    // The logo is the 512px rasterisation of the current mark, not the retired
    // vault illustration and not a wordmark.
    expect(String(organization.logo)).toMatch(/\/icon-512\.png$/);
  });

  it('contains no aggregateRating and no review', () => {
    expect(JSON.stringify(publicStructuredData())).not.toMatch(
      /aggregateRating|"review"|reviewRating|ratingValue/,
    );
    // Defence in depth: a page-level script could still emit its own JSON-LD.
    // Only the shared module is allowed to.
    const emitters = walk(SRC)
      .filter(
        (file) =>
          !file.includes('__tests__') &&
          readFileSync(file, 'utf8').includes('application/ld+json'),
      )
      .map((file) => relative(SRC, file));
    expect(emitters).toEqual(['lib/structured-data.tsx']);
  });

  it('has no FAQPage — the visible FAQ is not duplicated as dead JSON-LD', () => {
    expect(html).not.toContain('FAQPage');
    expect(html).not.toContain('Question');
  });

  it('escapes `<` so a value can never close the script element', () => {
    const escaped = jsonLdHtml({
      '@context': 'https://schema.org',
      '@type': 'Thing',
      name: '</script><script>alert(1)</script>',
    });
    expect(escaped).not.toContain('</script>');
    expect(JSON.parse(escaped)).toMatchObject({ name: '</script><script>alert(1)</script>' });
  });
});
