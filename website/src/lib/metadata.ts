// Shared metadata for the public surface — canonical URLs, the Open Graph /
// Twitter card, and the brand tokens the generated OG image is painted with.
//
// Why a helper instead of repeating openGraph objects in four files: Next
// REPLACES a page's `openGraph` object rather than deep-merging it with the root
// layout's. A legal page that exported only `{ title, description }` used to
// inherit the homepage card; once it exports its own `openGraph` it must carry
// every field, including the image. This function is the one place that shape
// is written, so `/privacy`, `/terms`, `/cookies` and `/` cannot drift.
//
// The image itself lives in `app/og/route.tsx` (a real 1200×630 `next/og`
// ImageResponse). It receives the same translated title/description that the
// `<meta>` tags carry, so the card is never a second, hardcoded design. Its
// palette is `OG_TOKENS` below — the same raw HSL triples as `globals.css`
// (`:root`), and `__tests__/metadata.test.ts` fails if they stop matching.

import type { Metadata } from 'next';
import { hslToRgb, parseHslTriple } from '@/lib/contrast';
import { localePath, type Locale } from '@/lib/i18n/locale';

export const SITE_NAME = 'Warrly';

/**
 * Development/test fallback only.
 *
 * Production never reaches it: `siteBaseUrl()` throws when neither env var is
 * set, because a silent `http://localhost:3000` here is exactly how a share
 * card ends up pointing at a laptop. See `siteBaseUrl`.
 */
export const SITE_FALLBACK_URL = 'https://warrly.com';

/** The public, indexable routes. The sitemap and `hreflang` set derive from it. */
export const PUBLIC_PATHS = ['/', '/privacy', '/terms', '/cookies'] as const;

export type PublicPath = (typeof PUBLIC_PATHS)[number];

export const OG_IMAGE_SIZE = { width: 1200, height: 630 } as const;

/**
 * Base URL for absolute metadata URLs. `NEXT_PUBLIC_APP_URL` first so a
 * deployment can expose it to the client later without a second variable;
 * `APP_URL` is the server-side name the Go service already uses for mailed
 * links.
 *
 * In production, a missing (or non-http) value is an ERROR, not a fallback.
 * Falling back to `http://localhost:3000` shipped `metadataBase`, `canonical`,
 * `og:url` and `og:image` pointing at a machine nobody else can reach — the
 * concrete cause of a Zalo/Facebook share with no preview image. Tests and
 * local development keep the documented fallback; a production request (or
 * any page statically rendered during a production build) throws here instead
 * of shipping the wrong hostname.
 */
export function siteBaseUrl(): URL {
  // `NEXT_PUBLIC_APP_URL` first, then the server-side name. Empty strings are
  // "not set", and a malformed public value must not hide a valid `APP_URL`
  // (compose passes only `APP_URL`), so each candidate is tried in turn.
  const candidates = [process.env.NEXT_PUBLIC_APP_URL, process.env.APP_URL];
  for (const configured of candidates) {
    if (!configured) continue;
    try {
      const url = new URL(configured);
      if (url.protocol === 'http:' || url.protocol === 'https:') return url;
    } catch {
      // try the next candidate
    }
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'APP_URL is not set (or is not an http(s) URL). Set APP_URL — or ' +
        'NEXT_PUBLIC_APP_URL — to the public origin of this site ' +
        '(for example https://warrly.com) before building for production. ' +
        'Refusing to emit localhost metadata.',
    );
  }

  return new URL(SITE_FALLBACK_URL);
}

/** An absolute URL for a site-relative path, using the configured origin. */
export function absoluteUrl(path: string): string {
  return new URL(path, siteBaseUrl()).toString();
}

/**
 * `hreflang` map for one route: both languages plus the `x-default` target.
 *
 * Absolute on purpose. Next resolves relative alternates against
 * `metadataBase` too, but emitting the full URL here means the tags are
 * verifiable from the HTML alone and cannot silently inherit a different base.
 * `x-default` points at the unprefixed English URL — the default version a
 * visitor with no language match should get.
 */
export function languageAlternates(path: string): Record<string, string> {
  const en = absoluteUrl(localePath(path, 'en'));
  const vi = absoluteUrl(localePath(path, 'vi'));
  return { en, vi, 'x-default': en };
}

/**
 * Raw HSL triples copied from `globals.css :root`. Deliberately the CSS form
 * (not hex) so the test can compare them literally against the stylesheet; the
 * ImageResponse needs hex, so they go through the same HSL→RGB maths the
 * contrast test uses.
 */
export const OG_TOKENS = {
  background: '32 100% 96%', // --background
  foreground: '30 21% 10%', // --foreground
  surface2: '32 100% 94%', // --surface-2
  border: '35 60% 86%', // --border
  primary: '13 100% 64%', // --primary (coral)
  primaryInk: '12 86% 16%', // --primary-ink
  muted: '33 22% 44%', // --muted
} as const;

function hexFromToken(value: string): string {
  const triple = parseHslTriple(value);
  if (!triple) throw new Error(`OG token is not an HSL triple: ${value}`);
  return `#${hslToRgb(triple)
    .map((channel) => channel.toString(16).padStart(2, '0'))
    .join('')}`;
}

/** Hex palette for the ImageResponse, derived from `OG_TOKENS`. */
export const OG_COLORS = Object.fromEntries(
  Object.entries(OG_TOKENS).map(([name, value]) => [name, hexFromToken(value)]),
) as Record<keyof typeof OG_TOKENS, string>;

/** Locale tags that Open Graph expects (`en_US`, not `en`). */
export const OPEN_GRAPH_LOCALES: Record<
  Locale,
  { locale: string; alternate: string[] }
> = {
  en: { locale: 'en_US', alternate: ['vi_VN'] },
  vi: { locale: 'vi_VN', alternate: ['en_US'] },
};

/**
 * The generated card's URL. The query string is part of the image URL on
 * purpose: the title/description are already translated per request, so the
 * card and its `<meta>` tags cannot disagree about the language or the copy.
 */
export function openGraphImageUrl({
  title,
  description,
  locale,
}: {
  title: string;
  description: string;
  locale: Locale;
}): string {
  const params = new URLSearchParams({ title, description, locale });
  return `/og?${params.toString()}`;
}

export type PageMetadataInput = {
  title: string;
  description: string;
  /**
   * The UNPREFIXED site path, e.g. `/privacy`. `pageMetadata` derives the
   * canonical (`/privacy` for English, `/vi/privacy` for Vietnamese) and the
   * `hreflang` pair from it; callers must not pass an already-prefixed path.
   */
  path: string;
  locale: Locale;
};

/**
 * Title/description/canonical/OG/Twitter for one public page. `metadataBase`
 * is set once in the root layout; relative URLs here are resolved against it.
 *
 * The canonical is SELF-REFERENTIAL PER LOCALE: an English page canonicalises
 * to `/privacy`, a Vietnamese page to `/vi/privacy`. It never canonicalises
 * `/vi` back to `/` — that would tell Google the Vietnamese page is a duplicate
 * and erase the only Vietnamese URL a crawler can reach. `alternates.languages`
 * then ties the pair together with absolute `hreflang` URLs.
 */
export function pageMetadata({
  title,
  description,
  path,
  locale,
}: PageMetadataInput): Metadata {
  const image = openGraphImageUrl({ title, description, locale });
  const language = OPEN_GRAPH_LOCALES[locale];
  const canonical = localePath(path, locale);

  return {
    title,
    description,
    alternates: {
      canonical,
      languages: languageAlternates(path),
    },
    openGraph: {
      type: 'website',
      siteName: SITE_NAME,
      locale: language.locale,
      alternateLocale: language.alternate,
      title,
      description,
      url: canonical,
      images: [
        {
          url: image,
          width: OG_IMAGE_SIZE.width,
          height: OG_IMAGE_SIZE.height,
          alt: title,
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [image],
    },
  };
}
