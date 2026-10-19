import { describe, expect, it } from 'vitest';
import type { ApiResult } from '@/lib/api/client';
import {
  extractVndRate,
  resolveFxRate,
  type FxRatesPayload,
} from '@/lib/fx';

// The frozen FX contract: `GET /v1/fx/rates?base=USD` returns
// `{ base, rates, fetchedAt, stale }`, and may fail with 503. The device form
// must prefill the rate on success (including `stale: true`) and fall back to
// manual entry with a clear message on 503.

function payload(over: Partial<FxRatesPayload> = {}): FxRatesPayload {
  return {
    base: 'USD',
    rates: { USD: 1, VND: 25_400, EUR: 0.92 },
    fetchedAt: '2026-10-19T00:00:00Z',
    stale: false,
    ...over,
  };
}

function ok(data: FxRatesPayload): ApiResult<FxRatesPayload> {
  return { ok: true, data };
}

describe('extractVndRate', () => {
  it('reads VND per one unit of the requested base currency', () => {
    expect(extractVndRate('USD', payload())).toBe(25_400);
    expect(extractVndRate('EUR', payload({ base: 'EUR', rates: { EUR: 1, VND: 27_600 } }))).toBe(
      27_600,
    );
  });

  it('accepts a numeric string from the provider', () => {
    expect(extractVndRate('USD', payload({ rates: { VND: '25400' } }))).toBe(25_400);
  });

  it('returns null for a missing, zero or malformed rate', () => {
    expect(extractVndRate('USD', payload({ rates: {} }))).toBeNull();
    expect(extractVndRate('USD', payload({ rates: { VND: 0 } }))).toBeNull();
    expect(extractVndRate('USD', payload({ rates: { VND: 'abc' } }))).toBeNull();
    expect(extractVndRate('USD', null)).toBeNull();
  });

  it('does not use an unrelated rate when the base is not the requested currency', () => {
    // `rates.VND` only means "VND per base"; if the server answered a different
    // base, that number is not the rate for this device.
    expect(extractVndRate('USD', payload({ base: 'GBP' }))).toBeNull();
  });
});

describe('resolveFxRate', () => {
  it('prefills the rate on a normal response', () => {
    expect(resolveFxRate('USD', ok(payload()), 'en')).toEqual({
      ok: true,
      rate: 25_400,
      stale: false,
      fetchedAt: '2026-10-19T00:00:00Z',
    });
  });

  it('prefills a stale rate but reports the stale flag for the warning', () => {
    expect(resolveFxRate('USD', ok(payload({ stale: true })), 'en')).toEqual({
      ok: true,
      rate: 25_400,
      stale: true,
      fetchedAt: '2026-10-19T00:00:00Z',
    });
  });

  it('turns a 503 into the "type it in by hand" message, in both languages', () => {
    const en = resolveFxRate(
      'USD',
      { ok: false, status: 503, error: 'unavailable' },
      'en',
    );
    expect(en).toMatchObject({ ok: false, reason: 'unavailable', status: 503 });
    if (!en.ok) {
      expect(en.message).toBe(
        'The exchange-rate service is temporarily unavailable — enter the rate by hand.',
      );
    }

    const vi = resolveFxRate(
      'USD',
      { ok: false, status: 503, error: 'unavailable' },
      'vi',
    );
    if (!vi.ok) {
      expect(vi.message).toBe(
        'Dịch vụ tỷ giá đang tạm thời không khả dụng — bạn nhập tỷ giá bằng tay nhé.',
      );
    }
  });

  it('passes through another failure’s server message rather than rewriting it', () => {
    const res = resolveFxRate(
      'USD',
      {
        ok: false,
        status: 429,
        error: 'rate_limited',
        message: 'Thao tác quá nhanh, thử lại sau',
      },
      'en',
    );
    expect(res).toMatchObject({ ok: false, reason: 'error', status: 429 });
    if (!res.ok) expect(res.message).toBe('Thao tác quá nhanh, thử lại sau');
  });

  it('reports an unreadable 200 body as invalid instead of prefilling 0', () => {
    const res = resolveFxRate('USD', ok(payload({ rates: {} })), 'en');
    expect(res).toMatchObject({ ok: false, reason: 'invalid' });
    if (!res.ok) {
      expect(res.message).toBe(
        'Could not read a rate from the server — type it in below.',
      );
    }
  });
});
