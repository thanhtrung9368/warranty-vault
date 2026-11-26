'use server';

// Server action backing the reference block in the device form.
//
// The browser never calls the FX endpoint directly: the Go service is the only
// thing that talks to the provider, and the web's bearer cookie lives in an
// httpOnly iron-session cookie that `apiFetch` turns into an Authorization
// header server-side. This also keeps the strict CSP untouched — no third-party
// origin is added to `connect-src`.
//
// The returned market rate is REFERENCE ONLY. It is never written into the
// device's `fxRate`: that number is the user's actual locked rate, entered by
// hand or derived from "Số tiền thực tế bị charge (VND)". `Device.fxRate` only
// changes when the user saves, and only with the rate they chose.

import { api } from '@/lib/api';
import { normalizeCurrency } from '@/lib/currency';
import { resolveFxReference, type FxReferenceResult } from '@/lib/fx';
import { getI18n } from '@/lib/i18n/server';

export async function getFxReference(currency: string): Promise<FxReferenceResult> {
  const { locale, t } = await getI18n();
  const base = normalizeCurrency(currency);

  // The form only renders the reference block for a non-VND currency, but a
  // stale client could still ask. There is no rate for đồng.
  if (base === 'VND') {
    return {
      ok: false,
      reason: 'invalid',
      status: 0,
      message: t('Chọn một loại tiền khác VND để lấy tỷ giá.'),
    };
  }

  const res = await api.fx.rates(base);
  return resolveFxReference(base, res, locale);
}
