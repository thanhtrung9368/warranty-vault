// Typed wrapper around `GET /v1/brands/{brandId}/service-info` (brand warranty
// lookup work).
//
// The endpoint carries the same `BrandServiceInfo` row the catalogue does, plus
// `warrantyLookupUrl` — the brand's OWN page where the owner can read the
// warranty start/end the brand recorded. That URL is nullable and is null for
// part of the catalogue on purpose: the API only publishes a link it can
// source, and the web must say "we do not have this brand's lookup page"
// instead of inventing one.
//
// The contract is frozen while this was written and did not pin the response
// envelope (the Go side is implemented in parallel), so the normaliser accepts
// the three plausible shapes — `{ brand }`, `{ serviceInfo }`, and the bare row
// — and yields `null` for anything that is not a usable row. A 404 is NOT an
// error here: "this brand has no service-info row" is the normal, honest answer,
// and the caller renders the same no-URL message it renders for a null URL.

import { apiFetch, type ApiResult } from './client';
import {
  normalizeBrandServiceInfo,
  type BrandServiceInfo,
} from '@/lib/service-directory';

/**
 * One brand's service-info row, or `null` when the brand has no row at all.
 *
 * `null` and a row whose `warrantyLookupUrl` is null are different facts but the
 * same UI answer: we cannot show a lookup link for this brand. Keeping them
 * distinct lets a caller that later wants to show the brand's other links
 * (`supportUrl`, `serviceLocatorUrl`) do so.
 */
export async function getServiceInfo(
  brandId: string,
): Promise<ApiResult<BrandServiceInfo | null>> {
  const res = await apiFetch<unknown>(
    'GET',
    `/v1/brands/${encodeURIComponent(brandId)}/service-info`,
  );
  if (!res.ok) {
    // Not found means "no row", not a failed page load — catalogue entries are
    // sparse by design.
    if (res.status === 404) return { ok: true, data: null };
    return res;
  }

  const body = res.data;
  const candidate =
    body && typeof body === 'object' && !Array.isArray(body)
      ? ((body as Record<string, unknown>).brand ??
        (body as Record<string, unknown>).serviceInfo ??
        (body as Record<string, unknown>).serviceInfoRow ??
        body)
      : body;

  return { ok: true, data: normalizeBrandServiceInfo(candidate) };
}
