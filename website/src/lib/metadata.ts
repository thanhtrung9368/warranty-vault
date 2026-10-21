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
import type { Locale } from '@/lib/i18n/locale';

export const SITE_NAME = 'Warrly';

/** Used only when neither env var is set. */
export const SITE_FALLBACK_URL = 'https://warrly.com';

export const OG_IMAGE_SIZE = { width: 1200, height: 630 } as const;

/**
 * Base URL for absolute metadata URLs. `NEXT_PUBLIC_APP_URL` first so a
 * deployment can expose it to the client later without a second variable;
 * `APP_URL` is the server-side name the Go service already uses for mailed
 * links. An invalid/non-http value falls back rather than producing a
 * `metadataBase` that throws at request time.
 */
export function siteBaseUrl(): URL {
  const configured = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL;
  if (configured) {
    try {
      const url = new URL(configured);
      if (url.protocol === 'http:' || url.protocol === 'https:') return url;
    } catch {
      // fall through to the documented fallback
    }
  }
  return new URL(SITE_FALLBACK_URL);
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
  /** Site-relative canonical path, e.g. `/privacy`. */
  path: string;
  locale: Locale;
};

/**
 * Title/description/canonical/OG/Twitter for one public page. `metadataBase`
 * is set once in the root layout; relative URLs here are resolved against it.
 */
export function pageMetadata({
  title,
  description,
  path,
  locale,
}: PageMetadataInput): Metadata {
  const image = openGraphImageUrl({ title, description, locale });
  const language = OPEN_GRAPH_LOCALES[locale];

  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      type: 'website',
      siteName: SITE_NAME,
      locale: language.locale,
      alternateLocale: language.alternate,
      title,
      description,
      url: path,
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
