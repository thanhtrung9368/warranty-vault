// Catalog re-exports backed by the Go `/v1/catalog` endpoint.
//
// Pre-Phase E this file proxied the Prisma-backed `lib/services/catalog.ts`.
// Now it splits the single Go bundle into the four functions existing
// callers expect (`getCategories`, `getBrands`, `getStores`,
// `getWarrantyProviders`, `getDeviceFormCatalog`).
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
  CategoryOption,
  BrandOption,
  StoreOption,
  WarrantyProviderOption,
} from '@/lib/api/catalog';

export type { CategoryOption, BrandOption, StoreOption, WarrantyProviderOption };

const fetchCatalog = cache(async () => {
  const res = await api.catalog.get();
  if (!res.ok) {
    // Catalog is non-essential; return empty arrays so pages still render
    // (validation will reject category-required submissions on the API side
    // and the UI shows them as empty selects).
    return {
      categories: [] as CategoryOption[],
      brands: [] as BrandOption[],
      stores: [] as StoreOption[],
      warrantyProviders: [] as WarrantyProviderOption[],
    };
  }
  return res.data;
});

export async function getCategories(): Promise<CategoryOption[]> {
  return (await fetchCatalog()).categories;
}

export async function getBrands(): Promise<BrandOption[]> {
  return (await fetchCatalog()).brands;
}

export async function getStores(): Promise<StoreOption[]> {
  return (await fetchCatalog()).stores;
}

export async function getWarrantyProviders(): Promise<WarrantyProviderOption[]> {
  return (await fetchCatalog()).warrantyProviders;
}

export async function getDeviceFormCatalog() {
  return fetchCatalog();
}
