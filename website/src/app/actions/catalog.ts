// Catalog re-exports backed by the Go `/v1/catalog` endpoint.
//
// Pre-Phase E this file proxied the Prisma-backed `lib/services/catalog.ts`.
// Now it splits the single Go bundle into the two entry points existing
// callers use: `getCategories` (filter bars) and `getDeviceFormCatalog`
// (the full bundle for the device / wishlist / subscription forms). The
// `*Option` types are re-exported for the form/filter components that type
// their props from here.
//
// We deliberately fetch the whole catalog each time and slice it — RSC
// `cache()` dedupes across the same render, so a page that needs categories +
// brands + stores still makes only one call.
//
// Across requests, the catalog is admin-curated and effectively static. The
// Go `/v1/catalog` endpoint is auth-gated (the request carries the user's
// bearer token), so it can't be wrapped in `unstable_cache` — that helper
// must not depend on cookies/headers. Instead the underlying fetch in
// `lib/api/catalog.ts` opts into Next's Data Cache (`revalidate: 300`, tag
// `catalog`), so navigations reuse a cached body instead of hitting Go.

import { cache } from 'react';
import { api } from '@/lib/api';
import type {
  Catalog,
  CategoryOption,
  BrandOption,
  StoreOption,
  RetailerOption,
  WarrantyProviderOption,
} from '@/lib/api/catalog';
import type { BrandServiceInfo } from '@/lib/service-directory';

export type { CategoryOption, BrandOption, StoreOption, RetailerOption, WarrantyProviderOption, BrandServiceInfo };

/**
 * The result of the one catalog read this module performs.
 *
 * `ok: false` means `GET /v1/catalog` failed; `catalog` is then the empty
 * fallback shape so a caller that only reads a list still renders. A form whose
 * category picker is required must check `ok` and show a retryable error —
 * empty arrays alone are indistinguishable from an empty database and would
 * leave a form that can never be submitted.
 */
export type DeviceCatalogResult = {
  ok: boolean;
  /** HTTP status of the failed read; absent when `ok` is true. */
  status?: number;
  catalog: Catalog;
};

const EMPTY_CATALOG: Catalog = {
  categories: [],
  brands: [],
  stores: [],
  retailers: [],
  warrantyProviders: [],
  brandServiceInfo: [],
};

const fetchCatalog = cache(async (): Promise<DeviceCatalogResult> => {
  const res = await api.catalog.get();
  if (!res.ok) {
    return { ok: false, status: res.status, catalog: EMPTY_CATALOG };
  }
  return { ok: true, catalog: res.data };
});

export async function getCategories(): Promise<CategoryOption[]> {
  return (await fetchCatalog()).catalog.categories;
}

/**
 * Brand → official service-locator rows (FEATURE_IDEAS #15). Additive on
 * `GET /v1/catalog`; `api.catalog.get()` normalises a missing array to `[]`, so
 * this is safe against an older Go build. The device card itself uses the
 * service-directory endpoint (matching rule in Go) — this accessor is for
 * surfaces that already hold a brand code and only need the link.
 */
export async function getBrandServiceInfo(): Promise<BrandServiceInfo[]> {
  return (await fetchCatalog()).catalog.brandServiceInfo;
}

/**
 * The full bundle for the device / wishlist / subscription forms. Callers that
 * render a required picker should surface `ok === false` (the forms use
 * `ListLoadError`), not silently render an empty select.
 */
export async function getDeviceFormCatalog(): Promise<DeviceCatalogResult> {
  return fetchCatalog();
}
