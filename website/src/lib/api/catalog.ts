// Typed client for /v1/catalog on the Go service.
// The Go service caches this in-process (60s TTL); we get fresh-enough
// data with no extra layer needed on the web side.

import { apiFetch, type ApiResult } from './client';
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

export async function get(): Promise<ApiResult<Catalog>> {
  // The catalog endpoint is auth-gated on Go, so the request still carries the
  // user's bearer token and can't be hoisted into `unstable_cache`. Instead we
  // opt the underlying fetch into Next's Data Cache: admin-curated catalog data
  // is global, so caching the response body for 5 minutes (tag `catalog`) is
  // safe and skips a Go round-trip on every navigation.
  const res = await apiFetch<Catalog>('GET', '/v1/catalog', undefined, {
    next: { revalidate: 300, tags: ['catalog'] },
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
