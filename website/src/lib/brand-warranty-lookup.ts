// Server-side resolver for a brand's warranty lookup URL.
//
// The detail page and the device form both need one answer: "is there a page on
// the brand's own site where the owner can read the warranty dates?" The device
// stores `brand` as free text, while `GET /v1/brands/{brandId}/service-info` is
// keyed by id, so this module does the three steps the contract implies:
//
//   1. resolve the typed brand name to ONE catalogue brand (`matchBrand`, pure);
//   2. ask the dedicated endpoint for that brand's row;
//   3. fall back to the catalogue's copy of `warrantyLookupUrl`.
//
// `lookupUrl: null` is a first-class answer, not a failure: the API only
// publishes URLs it can source, and the UI has a plain-language branch for it.
// Never synthesise a URL here.
//
// SERVER-ONLY: imports the API client (which reads the session cookie) and the
// catalogue action. Do not import this from a client component; the form calls
// it through `app/actions/brands.ts`.

import { api } from '@/lib/api';
import { getDeviceFormCatalog } from '@/app/actions/catalog';
import { matchBrand } from '@/lib/brand-warranty';

export type BrandLookupResolution = {
  /** The catalogue id we resolved, or null when the name matched no brand. */
  brandId: string | null;
  /** The catalogue's display name for the matched brand. */
  brandName: string | null;
  /** The brand's warranty-check page, or null when we have none. */
  lookupUrl: string | null;
};

const NO_MATCH: BrandLookupResolution = {
  brandId: null,
  brandName: null,
  lookupUrl: null,
};

/**
 * Resolve a free-text device brand to its lookup URL.
 *
 * A failed/404 endpoint read does NOT take the page down: the catalogue's own
 * row is used when it has a URL, and otherwise the caller renders the honest
 * "we do not have this brand's lookup page" state.
 */
export async function resolveBrandWarrantyLookup(
  brandName: string | null | undefined,
): Promise<BrandLookupResolution> {
  const catalog = await getDeviceFormCatalog();
  const match = matchBrand(brandName, catalog.brands, catalog.brandServiceInfo);
  if (!match) return NO_MATCH;

  const res = await api.brands.getServiceInfo(match.brandId);
  const fromEndpoint = res.ok ? (res.data?.warrantyLookupUrl ?? null) : null;

  return {
    brandId: match.brandId,
    brandName: match.name,
    lookupUrl: fromEndpoint ?? match.lookupUrl,
  };
}
