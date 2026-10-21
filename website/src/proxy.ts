// The `/vi` URL.
//
// Next 16 renamed the `middleware` file convention to `proxy`; this is the
// proxy, not a leftover middleware. It exists for one job: give Vietnamese a
// crawlable address. Before it, `getLocale()` resolved cookie → `User.locale`
// → `Accept-Language` → `en`, and Googlebot carries none of the first three
// (Google documents that it does not send `Accept-Language`), so every crawl
// rendered English and no URL anywhere returned Vietnamese.
//
// What this does, and deliberately does NOT do:
//
//   * `/vi` and `/vi/...` are rewritten onto the unprefixed route, with the
//     request header `x-wv-locale: vi` added. `getLocale()` reads that header
//     ABOVE the cookie, so a shared `/vi` link renders Vietnamese even in a
//     browser whose `wv_locale` cookie says English.
//   * The unprefixed path is left alone. There is no geo-IP redirect and no
//     `Accept-Language` redirect: redirecting `/` per visitor would give one
//     page two URLs and make the same URL render differently to Googlebot and
//     to a person — the shape Google calls cloaking. English stays the default
//     URL and the `x-default` target; `/vi` is the opt-in alternative.
//   * `x-wv-locale` is deleted from every unprefixed request, so a client
//     cannot force a language by sending the header itself.
//
// The cookie is untouched here: the auth session (`wv_session`) must keep
// flowing through rewrites exactly as it did before. Only a request header is
// added.
//
// See `src/lib/i18n/locale.ts` for the path helpers and `src/lib/metadata.ts`
// for the `hreflang`/canonical pair that make the two URLs discoverable.

import { NextResponse, type NextRequest } from 'next/server';
import { LOCALE_PATH_HEADER, splitLocalePath } from '@/lib/i18n/locale';

export function proxy(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  const resolved = splitLocalePath(pathname);

  const headers = new Headers(request.headers);
  // Never trust a value that came from the client. On a `/vi` URL the proxy
  // owns the answer; everywhere else the header must be absent so `getLocale`
  // falls through to the cookie / stored preference / browser header.
  if (resolved.locale) headers.set(LOCALE_PATH_HEADER, resolved.locale);
  else headers.delete(LOCALE_PATH_HEADER);

  if (!resolved.locale || resolved.pathname === pathname) {
    return NextResponse.next({ request: { headers } });
  }

  const url = request.nextUrl.clone();
  url.pathname = resolved.pathname;
  return NextResponse.rewrite(url, { request: { headers } });
}

export const config = {
  // Everything except Next's own assets, the Go/Next API surface, the
  // generated OG image, and any path whose final segment has a file extension
  // (`/robots.txt`, `/sitemap.xml`, `/manifest.webmanifest`, icons). Those are
  // not pages and must keep their exact bytes.
  matcher: ['/((?!_next/|api(?:/|$)|og(?:/|$)|.*\\.[^/]+$).*)'],
};
