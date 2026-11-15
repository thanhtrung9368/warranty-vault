import type { MetadataRoute } from 'next';
import { siteBaseUrl } from '@/lib/metadata';

// `/robots.txt`. Before this file there was no route at all, so every crawler
// got a 404 and none of the sitemap URLs below were ever discovered.
//
// Policy: allow the public pages (the default — there is no `Disallow: /`), and
// disallow only surfaces that must never be indexed or crawled:
//
//   * `/api/` — the Go backend proxy and, importantly, the public share
//     certificate (`GET /api/v1/public/shares/{token}`). A token belongs in a
//     link someone was given, never in a search result.
//   * `/og` — the generated share card is an image, not a page.
//   * `/share/` — the Next share-target failure screen (noindex in metadata too).
//   * `/cdn-cgi/` — Cloudflare's internal email-protection endpoint
//     (`/cdn-cgi/l/email-protection`). It is not a page of this site; Cloudflare
//     Email Address Obfuscation can put it in links, and the endpoint 404s on
//     this host, which made Search Console report a phantom 404.
//
// `/_next/` is deliberately NOT disallowed. It contains the JS/CSS/font assets
// the renderer needs; blocking it made Search Console report the build chunk /
// font as "Blocked by robots.txt" and can stop Google from rendering the very
// pages we want indexed. Static assets are not indexable pages anyway.
//
// The legal pages are NOT disallowed; they are the indexable copy. Protected
// `(app)` routes are not listed here either: their layout already emits
// `noindex`, and a crawler must be able to read that tag to honour it.
//
// `force-dynamic` because the sitemap URL is absolute and depends on
// `APP_URL`, which is a RUNTIME variable in the container image. Evaluating this
// at build time would bake a build-machine hostname into production.
export const dynamic = 'force-dynamic';

export default function robots(): MetadataRoute.Robots {
  const base = siteBaseUrl().toString().replace(/\/+$/, '');

  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/api/', '/og', '/share/', '/cdn-cgi/'],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
