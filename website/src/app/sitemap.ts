import type { MetadataRoute } from 'next';
import {
  PUBLIC_PATHS,
  absoluteUrl,
  languageAlternates,
  type PublicPath,
} from '@/lib/metadata';
import { localePath, LOCALES } from '@/lib/i18n/locale';

// `/sitemap.xml`. There was no sitemap before, so the four public pages (and
// their Vietnamese counterparts) had no discovery path except links.
//
// Every URL here is public, canonical and indexable:
//   `/`, `/vi`, `/privacy`, `/vi/privacy`, `/terms`, `/vi/terms`,
//   `/cookies`, `/vi/cookies`.
//
// Deliberately absent:
//   * `(app)` and `(auth)` routes — require a session / are `noindex`;
//   * `/og`, `/api/*` — an image and the backend proxy, not documents;
//   * the share certificate (`/api/v1/public/shares/{token}` in Go) — the token
//     is private, and that route is disallowed in `robots.ts`;
//   * `/share/result` — an error screen, not a destination.
//
// The map is generated from `PUBLIC_PATHS` (one list, shared with `hreflang`)
// so a new legal page cannot be added to the footer and forgotten here.
export const dynamic = 'force-dynamic';

// The date the visible copy on these pages last changed. A single constant, not
// `new Date()`: claiming every page changed on every request is how a crawler
// learns to ignore `lastmod` altogether. The cost of one constant is that it has
// to be bumped when the copy changes — and it was not, for three releases, which
// is exactly why Google discounts a `lastmod` it finds unreliable.
//
// BUMP THIS whenever the landing or legal copy changes. It is not decoration.
const LAST_MODIFIED = new Date('2026-10-27T00:00:00.000Z');

const PRIORITY: Record<PublicPath, number> = {
  '/': 1,
  '/privacy': 0.4,
  '/terms': 0.4,
  '/cookies': 0.3,
};

const CHANGE_FREQUENCY: Record<PublicPath, 'weekly' | 'yearly'> = {
  '/': 'weekly',
  '/privacy': 'yearly',
  '/terms': 'yearly',
  '/cookies': 'yearly',
};

export default function sitemap(): MetadataRoute.Sitemap {
  return PUBLIC_PATHS.flatMap((path) =>
    LOCALES.map((locale) => ({
      url: absoluteUrl(localePath(path, locale)),
      lastModified: LAST_MODIFIED,
      changeFrequency: CHANGE_FREQUENCY[path],
      priority: PRIORITY[path],
      alternates: {
        languages: languageAlternates(path),
      },
    })),
  );
}
