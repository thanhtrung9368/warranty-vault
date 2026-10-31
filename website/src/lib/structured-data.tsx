// The site's JSON-LD, in one place.
//
// What is emitted and why:
//
//   * `WebSite` — this is the node Google reads for the site name in a search
//     result. `inLanguage` lists both languages the site actually serves.
//   * `Organization` — the publisher of the site. The logo is the current
//     "Warranty Tag" mark rasterised from `src/lib/brand.ts` (`renderIconSvg`),
//     not the old vault/shield artwork; the support email is the same
//     `support@warrly.com` mailbox the footer and legal pages publish. The
//     privacy mailbox (`privacy@warrly.com`) is deliberately NOT the support
//     one: data requests and product help are answered separately.
//
// What is deliberately NOT emitted:
//
//   * `FAQPage` — Google retired FAQ rich results (announced 2026-05-07,
//     documentation removed 2026-06-15). The visible FAQ stays; the JSON-LD
//     copy was dead weight on every response.
//   * `SoftwareApplication` with `aggregateRating` or `review` — that type is
//     only eligible for a rich result when one of those two is present, and
//     Warrly has neither. Inventing a rating is a manual-action risk, so a
//     validator flagging the absence is the correct state. A test fails if
//     either key ever appears in this module.
//
// One module, not one script per page: the root landing page and `(public)`
// layout both render `<PublicStructuredData />`, so WebSite/Organization are
// present on every public page and cannot drift between them.

import { SITE_NAME, absoluteUrl, siteBaseUrl } from '@/lib/metadata';

/** The published support mailbox. Data, not translated copy. */
export const SUPPORT_EMAIL = 'support@warrly.com';

/**
 * The brand mark as a crawlable image URL.
 *
 * `public/icon-512.png` is generated from `brand.ts` (`renderIconSvg`: the
 * 32-grid tag plate — torn zigzag bottom, W cut out — on the cream brand
 * background). The wordmark is not the logo — Google wants a square brand
 * image, and this is the current mark, not the retired vault illustration.
 */
export const BRAND_LOGO_PATH = '/icon-512.png';

type JsonLdNode = Record<string, unknown>;

export function websiteNode(): JsonLdNode {
  return {
    '@type': 'WebSite',
    '@id': absoluteUrl('/#website'),
    name: SITE_NAME,
    alternateName: 'Warrly — Quản lý bảo hành & gói đăng ký',
    url: siteBaseUrl().toString(),
    inLanguage: ['vi', 'en'],
  };
}

export function organizationNode(): JsonLdNode {
  return {
    '@type': 'Organization',
    '@id': absoluteUrl('/#organization'),
    name: SITE_NAME,
    url: siteBaseUrl().toString(),
    logo: absoluteUrl(BRAND_LOGO_PATH),
    email: SUPPORT_EMAIL,
  };
}

/** The single `@graph` every public page emits. */
export function publicStructuredData(): JsonLdNode {
  return {
    '@context': 'https://schema.org',
    '@graph': [websiteNode(), organizationNode()],
  };
}

/**
 * Serialise one JSON-LD document for a `<script>` element.
 *
 * `<` is escaped so a future value containing markup cannot close the script
 * element early; the result is still valid JSON and parses unchanged.
 */
export function jsonLdHtml(data: JsonLdNode = publicStructuredData()): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

export function PublicStructuredData() {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: jsonLdHtml() }}
    />
  );
}
