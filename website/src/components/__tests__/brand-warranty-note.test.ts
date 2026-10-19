// Render-level tests for the brand-warranty note.
//
// The copy/state decisions are covered in `@/lib/__tests__/brand-warranty.test.ts`;
// this file pins the two things a pure test cannot see:
//
//   * the mismatch block really renders BOTH dates and the day count, and uses
//     the information palette (no destructive/rose class) — "unmissable but not
//     alarmist" is a rendering rule;
//   * a computed null mismatch really renders the agreement sentence, and a
//     NOT_REGISTERED answer its own sentence.
//
// Like the service-directory card test: no DOM, no browser, language pinned with
// `I18nProvider locale="vi"` so the Vietnamese source sentences are what the
// assertions quote.

import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BrandWarrantyNote } from '@/components/brand-warranty-note';
import { I18nProvider } from '@/lib/i18n/client';
import type { Locale } from '@/lib/i18n/locale';
import type { BrandWarrantyAnswerSource } from '@/lib/brand-warranty';

const VI: Locale = 'vi';

function renderVi(device: BrandWarrantyAnswerSource): string {
  return renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      { locale: VI } as React.Attributes & { locale: Locale; children: React.ReactNode },
      React.createElement(BrandWarrantyNote, { device }),
    ),
  );
}

describe('BrandWarrantyNote', () => {
  it('renders the mismatch sentence, the day count and both dates', () => {
    const html = renderVi({
      brandWarrantyStatus: 'ACTIVE',
      brandWarrantyStart: '2025-11-24',
      brandWarrantyEnd: '2026-11-24',
      warrantyMismatch: {
        kind: 'STARTS_BEFORE',
        days: 47,
        brandDate: '2025-11-24',
        purchaseDate: '2026-01-10',
      },
    });
    expect(html).toContain(
      'Hãng ghi bảo hành bắt đầu trước ngày mua 47 ngày',
    );
    expect(html).toContain('Hãng ghi bắt đầu 24/11/2025');
    expect(html).toContain('Bạn ghi ngày mua 10/01/2026');
    expect(html).toContain('không phải lỗi');
  });

  it('is information-toned: never red/destructive', () => {
    const html = renderVi({
      warrantyMismatch: {
        kind: 'ENDED_EARLIER',
        days: 30,
        brandDate: '2026-02-01',
        purchaseDate: '2026-03-03',
      },
    });
    expect(html).not.toContain('text-destructive');
    expect(html).not.toContain('bg-rose');
    expect(html).not.toContain('border-rose');
    expect(html).toContain('bg-sky-soft');
  });

  it('says the two sides agree when the computed mismatch is null', () => {
    const html = renderVi({
      brandWarrantyStatus: 'ACTIVE',
      brandWarrantyStart: '2026-01-10',
      brandWarrantyEnd: '2027-01-10',
      warrantyMismatch: null,
    });
    expect(html).toContain('Không có lệch');
    expect(html).toContain('10/01/2026');
    expect(html).toContain('10/01/2027');
  });

  it('explains a NOT_REGISTERED answer without calling it agreement', () => {
    const html = renderVi({
      brandWarrantyStatus: 'NOT_REGISTERED',
      warrantyMismatch: null,
    });
    expect(html).toContain('serial này');
    expect(html).not.toContain('Không có lệch');
  });

  it('says it has not been checked yet when there is no answer', () => {
    const html = renderVi({ brandWarrantyStatus: null, warrantyMismatch: null });
    expect(html).toContain('Chưa đối chiếu với hãng');
  });
});
