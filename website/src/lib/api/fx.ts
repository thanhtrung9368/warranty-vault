// Typed wrapper around the Go service's FX endpoint.
//
// `GET /v1/fx/rates?base=<ISO-4217>` answers `{ base, rates, fetchedAt, stale }`
// or fails with 503. Interpretation of the payload (including the 503 branch)
// lives in `lib/fx.ts` so it is unit-testable; this file only performs the
// request.

import { apiFetch, type ApiResult } from './client';
import type { FxRatesPayload } from '@/lib/fx';

/** Rates against `base`; the device form uses `rates.VND`. */
export async function rates(base: string): Promise<ApiResult<FxRatesPayload>> {
  return apiFetch<FxRatesPayload>(
    'GET',
    `/v1/fx/rates?base=${encodeURIComponent(base)}`,
  );
}
