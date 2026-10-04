// Typed client for /v1/catalog on the Go service.
// The Go service caches this in-process (60s TTL); we get fresh-enough
// data with no extra layer needed on the web side.

import { apiFetch, type ApiResult } from './client';
import { getLocale } from '@/lib/i18n/server';
import type { Locale } from '@/lib/i18n/locale';
import {
  normalizeBrandServiceInfoList,
  type BrandServiceInfo,
} from '@/lib/service-directory';

export type CategoryOption = {
  code: string;
  name: string;
};

export type BrandOption = {
  id: string;
  name: string;
  categoryCodes: string[];
};

export type StoreOption = {
  id: string;
  name: string;
  type: string;
};

export type WarrantyProviderOption = {
  id: string;
  name: string;
  phone: string | null;
  address: string | null;
  websiteUrl: string | null;
  notes: string | null;
};

export type Catalog = {
  categories: CategoryOption[];
  brands: BrandOption[];
  stores: StoreOption[];
  warrantyProviders: WarrantyProviderOption[];
  // Brand → official service-locator link (FEATURE_IDEAS #15, migration 0012).
  // ADDITIVE on the wire: an older Go build omits it and `get()` normalises that
  // to `[]`. Read-only, never a picker — the device card goes through
  // `GET /v1/devices/{id}/service-directory` so the matching rule stays in Go.
  brandServiceInfo: BrandServiceInfo[];
};

export type { BrandServiceInfo };

/** Coarse tag: everything derived from the catalog. */
export const CATALOG_TAG = 'catalog';

/**
 * Per-language tag.
 *
 * NOT the cache fix — see `get()` — but it is what makes a targeted refresh
 * possible once the entries are split per language: `revalidateTag('catalog:vi')`
 * drops the Vietnamese entry and leaves the English one warm.
 */
export function catalogTag(locale: Locale): string {
  return `catalog:${locale}`;
}

export async function get(): Promise<ApiResult<Catalog>> {
  // ── The language must be in the URL, not in a header ───────────────────
  //
  // This request opts into Next's Data Cache below, so its response has to be a
  // pure function of its CACHE KEY, or one language's body gets served to a
  // reader of the other. The key Next derives for a `fetch` is the URL plus the
  // request options (`IncrementalCache.generateCacheKey`,
  // `next/dist/server/lib/incremental-cache/index.js` — it hashes
  // `[prefix, url, method, bodyType, headers, mode, redirect, credentials,
  // referrer, referrerPolicy, integrity, cache, body]`).
  //
  // Two consequences, and both are load-bearing:
  //
  //   * `next.tags` is NOT in that list. Putting the language in the tags — one
  //     of the two shapes docs/I18N_PLAN.md §4 weighs — does not partition the
  //     cache at all: both languages would still write the same entry, and a
  //     tag only ever controls WHEN an entry is revalidated, never WHICH entry
  //     a read lands on. Tags alone are not a fix.
  //   * The URL is the one component of the key that the app fully controls and
  //     that cannot silently change underneath us. `?lang=` is also level 1 of
  //     the Go server's own precedence chain, so the body we cache is exactly
  //     the body a caller without a cache would get.
  //
  // `apiFetch` appends the same parameter to every request; it is written out
  // here as well because this is the one call where the difference is not
  // cosmetic, and a reader of this file should not have to go looking for it.
  // The two are reconciled by `withLangParam` (it `set`s, never `append`s).
  const locale = await getLocale();

  const res = await apiFetch<Catalog>('GET', `/v1/catalog?lang=${locale}`, undefined, {
    next: { revalidate: 300, tags: [CATALOG_TAG, catalogTag(locale)] },
  });
  if (!res.ok) return res;
  // Shape the additive field here (not in the cache): every consumer then sees
  // an array, whatever the server version. The cached response body itself is
  // untouched.
  return {
    ok: true,
    data: {
      ...res.data,
      brandServiceInfo: normalizeBrandServiceInfoList(res.data?.brandServiceInfo),
    },
  };
}
