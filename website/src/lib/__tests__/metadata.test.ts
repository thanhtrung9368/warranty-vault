// Pins the parts of the shared-link fix that CAN be tested without a browser:
// the OG palette is the same palette as `globals.css`, and `pageMetadata()`
// emits the fields the requirement names (canonical, openGraph, twitter,
// 1200×630 image). The actual `<meta>` tags in the served HTML are verified
// against the production build, not here — metadata emission is Next's job.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  OG_COLORS,
  OG_IMAGE_SIZE,
  OG_TOKENS,
  openGraphImageUrl,
  pageMetadata,
  siteBaseUrl,
} from '@/lib/metadata';

const WEBSITE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const GLOBALS = readFileSync(join(WEBSITE, 'src', 'app', 'globals.css'), 'utf8');

function rootTokens(): Record<string, string> {
  const root = /:root\s*\{([^}]*)\}/.exec(GLOBALS);
  if (!root) throw new Error('globals.css has no :root block');
  const tokens: Record<string, string> = {};
  for (const match of root[1].matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    tokens[match[1]] = match[2].trim();
  }
  return tokens;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('OG palette is the design-token palette', () => {
  it('copies the :root values rather than a second hex table', () => {
    const tokens = rootTokens();
    expect(OG_TOKENS.background).toBe(tokens.background);
    expect(OG_TOKENS.foreground).toBe(tokens.foreground);
    expect(OG_TOKENS.surface2).toBe(tokens['surface-2']);
    expect(OG_TOKENS.border).toBe(tokens.border);
    expect(OG_TOKENS.primary).toBe(tokens.primary);
    expect(OG_TOKENS.primaryInk).toBe(tokens['primary-ink']);
    expect(OG_TOKENS.muted).toBe(tokens.muted);
  });

  it('derives valid hex colours for ImageResponse', () => {
    for (const value of Object.values(OG_COLORS)) {
      expect(value).toMatch(/^#[0-9a-f]{6}$/);
    }
    expect(OG_COLORS.background.toLowerCase()).toBe('#fff5eb');
  });
});

describe('pageMetadata', () => {
  it('emits canonical, openGraph and a summary_large_image twitter card', () => {
    const metadata = pageMetadata({
      title: 'Chính sách bảo mật — Warrly',
      description: 'Chính sách bảo mật và xử lý dữ liệu của Warrly',
      path: '/privacy',
      locale: 'vi',
    });

    expect(metadata.alternates?.canonical).toBe('/privacy');
    expect(metadata.openGraph).toMatchObject({
      type: 'website',
      siteName: 'Warrly',
      locale: 'vi_VN',
      alternateLocale: ['en_US'],
      url: '/privacy',
      title: 'Chính sách bảo mật — Warrly',
      description: 'Chính sách bảo mật và xử lý dữ liệu của Warrly',
    });
    expect(metadata.twitter).toMatchObject({
      card: 'summary_large_image',
      title: 'Chính sách bảo mật — Warrly',
    });

    const image = (metadata.openGraph as { images?: Array<Record<string, unknown>> })
      .images?.[0];
    expect(image).toMatchObject({
      width: OG_IMAGE_SIZE.width,
      height: OG_IMAGE_SIZE.height,
      alt: 'Chính sách bảo mật — Warrly',
    });
    expect(String(image?.url)).toMatch(/^\/og\?/);
    const imageParams = new URL(
      String(image?.url),
      'https://warrly.test',
    ).searchParams;
    expect(imageParams.get('title')).toBe('Chính sách bảo mật — Warrly');
    expect(imageParams.get('locale')).toBe('vi');
  });

  it('switches locale tags with the request language', () => {
    const en = pageMetadata({
      title: 'Warrly — Warranty and subscription tracker',
      description: 'Track your devices.',
      path: '/',
      locale: 'en',
    });
    expect(en.openGraph).toMatchObject({
      locale: 'en_US',
      alternateLocale: ['vi_VN'],
    });
  });

  it('builds a 1200×630 image URL with the same copy as the tags', () => {
    const url = openGraphImageUrl({
      title: 'Title',
      description: 'Description',
      locale: 'en',
    });
    expect(url.startsWith('/og?')).toBe(true);
    expect(url).toContain('title=Title');
    expect(url).toContain('description=Description');
    expect(url).toContain('locale=en');
  });
});

describe('siteBaseUrl', () => {
  it('falls back to https://warrly.com', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', '');
    vi.stubEnv('APP_URL', '');
    expect(siteBaseUrl().toString()).toBe('https://warrly.com/');
  });

  it('is env-driven and prefers NEXT_PUBLIC_APP_URL', () => {
    vi.stubEnv('APP_URL', 'https://staging.example');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://warrly.example');
    expect(siteBaseUrl().toString()).toBe('https://warrly.example/');
  });

  it('ignores a malformed value instead of emitting a broken metadataBase', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', '');
    vi.stubEnv('APP_URL', 'not a url');
    expect(siteBaseUrl().toString()).toBe('https://warrly.com/');
  });
});
