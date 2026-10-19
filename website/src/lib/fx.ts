// FX-rate lookup: request/response interpretation for `GET /v1/fx/rates`.
//
// The frozen contract:
//
//   GET /api/v1/fx/rates?base=USD
//     → { base, rates, fetchedAt, stale }
//
// `base` is the device's currency. The rate the device needs is **VND per one
// unit of `base`**, i.e. `rates.VND` when the server answers with the requested
// base. The endpoint may fail with 503; that is a normal, expected outcome and
// the UI then asks the person to type the rate in by hand.
//
// The interpretation lives here, away from the server action, so the 503 and
// `stale` branches are unit-testable without an HTTP server (the Go service does
// not exist while this client is being built).

import { normalizeCurrency } from './currency';
import { translate } from './i18n/catalog';
import type { Locale } from './i18n/locale';
import type { ApiResult } from './api/client';

export type FxRatesPayload = {
  base: string;
  /** Currency code → units of that currency per one `base`. */
  rates: Record<string, number | string>;
  fetchedAt: string;
  stale: boolean;
};

export type FxLookupResult =
  | {
      ok: true;
      /** Positive integer: VND per one unit of the requested currency. */
      rate: number;
      stale: boolean;
      fetchedAt: string;
    }
  | {
      ok: false;
      reason: 'unavailable' | 'invalid' | 'error';
      status: number;
      /** Already rendered in the request's language. */
      message: string;
    };

function toPositiveRate(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  // The contract types fxRate as an integer; rounding protects the form's
  // hidden input from a fractional provider value without inventing a decimal
  // rate the API would reject.
  const rate = Math.round(parsed);
  return rate > 0 ? rate : null;
}

/**
 * Pull the VND-per-unit rate out of a response.
 *
 * The expected shape is `base === currency` with `rates.VND`. A couple of
 * harmless alternatives are accepted so a server that answers against a VND base
 * still works: `rates[currency]` (inverted) when `base` is VND. Returns `null`
 * when no usable rate is present — the caller then falls back to manual entry
 * rather than guessing one.
 */
export function extractVndRate(
  currency: string,
  payload: FxRatesPayload | null | undefined,
): number | null {
  if (!payload) return null;
  const code = normalizeCurrency(currency);
  const base = normalizeCurrency(payload.base);
  const rates = payload.rates ?? {};

  if (base === code) {
    const direct = toPositiveRate(rates.VND ?? rates.vnd ?? rates.Vnd);
    if (direct != null) return direct;
  }

  if (base === 'VND') {
    const inverse = toPositiveRate(rates[code] ?? rates[code.toLowerCase()]);
    if (inverse != null) return Math.round(1 / inverse) || null;
  }

  // Last resort: some servers ignore `base` and always answer VND-base. This
  // only makes sense when the payload actually says its base is VND; the branch
  // above already handles that. For any other base, do not silently use an
  // unrelated number.
  return null;
}

/**
 * Turn the API result into the one decision the form needs: a rate, or a
 * human-readable reason to type it in by hand.
 *
 * 503 is called out separately because it is the documented, expected failure —
 * the copy must say the service is temporarily unavailable, not blame the
 * user's connection. `stale: true` is NOT a failure: the rate still prefills,
 * and the form shows its own warning.
 */
export function resolveFxRate(
  currency: string,
  res: ApiResult<FxRatesPayload>,
  locale: Locale,
): FxLookupResult {
  if (!res.ok) {
    const unavailable = res.status === 503;
    return {
      ok: false,
      reason: unavailable ? 'unavailable' : 'error',
      status: res.status,
      message: unavailable
        ? translate(
            locale,
            'Dịch vụ tỷ giá đang tạm thời không khả dụng — bạn nhập tỷ giá bằng tay nhé.',
          )
        : (res.message ??
          translate(
            locale,
            'Không lấy được tỷ giá — bạn nhập tay bên dưới nhé.',
          )),
    };
  }

  const rate = extractVndRate(currency, res.data);
  if (rate == null) {
    return {
      ok: false,
      reason: 'invalid',
      status: 200,
      message: translate(
        locale,
        'Không đọc được tỷ giá từ máy chủ — bạn nhập tay bên dưới nhé.',
      ),
    };
  }

  return {
    ok: true,
    rate,
    stale: res.data.stale === true,
    fetchedAt: typeof res.data.fetchedAt === 'string' ? res.data.fetchedAt : '',
  };
}
