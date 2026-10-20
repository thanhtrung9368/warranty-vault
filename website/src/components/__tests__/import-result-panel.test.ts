// Render-level tests for the import result panel.
//
// What a helper test cannot see: whether `warnings` coming back from
// `POST /api/v1/backup/import` actually reaches the DOM, whether the panel is
// visually the warning state rather than the success state, and whether a
// warning-free import really renders NO warning block (the failure mode where
// every import gains an alarming panel).
//
// The component touches no browser API (its only hook is the i18n context), so
// `renderToStaticMarkup` is enough — no DOM, no click-through, no backend. The
// language is pinned with `I18nProvider` both ways; the warning sentences
// themselves are API copy passed in as data, exactly as the proxy delivers
// them.
//
// Kept as `.ts` (React.createElement, no JSX) because vitest only collects
// `*.test.ts` here. What this file cannot prove is presentational judgement —
// "does the amber block read as consequential but not as a failure?" — that is
// checked by the screenshots in the hand-off, not by an assertion.

import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ImportResultPanel } from '@/components/import-result-panel';
import { describeImportResult, type ImportSummary } from '@/lib/backup-media';
import { I18nProvider } from '@/lib/i18n/client';
import type { Locale } from '@/lib/i18n/locale';

const VI_WARNING =
  'Bản sao lưu này không ghi múi giờ cho các mốc thời gian. Nếu file được xuất trước khi Warrly sửa lỗi múi giờ, một số mốc (thời điểm tạo/cập nhật, thời điểm thanh toán, mốc nhắc) có thể lệch 7 giờ so với thực tế. Warrly giữ nguyên các mốc đã nhập vì không thể xác định chắc chắn từng dòng có bị lệch hay không; ngày tháng như ngày mua và ngày hết hạn bảo hành không bị ảnh hưởng.';
const EN_WARNING =
  'This backup does not record the time zone of its timestamps. If it was exported before Warrly fixed its time-zone handling, some instants (created/updated times, payment times, reminder markers) may be 7 hours off. Warrly leaves the imported instants exactly as the file states because it cannot prove which rows are affected; calendar dates such as purchase dates and warranty end dates are unaffected.';

function summaryWith(warnings: string[] | undefined, locale: Locale): ImportSummary {
  return describeImportResult(
    {
      imported: 3,
      skipped: 1,
      wishlistImported: 0,
      wishlistSkipped: 0,
      subImported: 0,
      subSkipped: 0,
      attachmentsImported: 0,
      attachmentsSkipped: 0,
      attachmentsUnreadable: 0,
      warnings,
    },
    locale,
  );
}

function render(summary: ImportSummary | null, locale: Locale): string {
  return renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      { locale } as React.Attributes & { locale: Locale; children: React.ReactNode },
      React.createElement(ImportResultPanel, { summary }),
    ),
  );
}

describe('ImportResultPanel', () => {
  it('renders the API warning verbatim, as a warning rather than a success', () => {
    const html = render(summaryWith([VI_WARNING], 'vi'), 'vi');

    // The sentence the API wrote is present, character for character.
    expect(html).toContain(VI_WARNING);
    expect(html).toContain('Đã nhập xong — nhưng dữ liệu có cảnh báo');
    // It is the non-fatal-problem state: amber, warning icon, no emerald.
    expect(html).toContain('data-import-tone="warning"');
    expect(html).toContain('bg-amber-soft');
    expect(html).not.toContain('bg-emerald-soft');
    // The import still succeeded, so the counters are still reported.
    expect(html).toContain('Đã import 3 thiết bị');
    // No dismiss control: the only way to lose the caveat is to leave or
    // replace it with another import.
    expect(html).not.toContain('<button');
    expect(html).not.toContain('Đóng');
  });

  it('renders no warning block for a warning-free import', () => {
    const html = render(summaryWith(undefined, 'vi'), 'vi');

    expect(html).not.toContain('Đã nhập xong — nhưng dữ liệu có cảnh báo');
    expect(html).not.toContain('cảnh báo');
    expect(html).toContain('data-import-tone="success"');
    expect(html).toContain('bg-emerald-soft');
    expect(html).not.toContain('bg-amber-soft');
    // A normal import still shows its ordinary result.
    expect(html).toContain('Đã import 3 thiết bị');
  });

  it('frames the warning in English while keeping the API body English', () => {
    const html = render(summaryWith([EN_WARNING], 'en'), 'en');

    expect(html).toContain('Import finished — but there is a warning about your data');
    expect(html).toContain(
      'Your data was imported in full. This warning does not block anything, but please read it carefully below.',
    );
    expect(html).toContain(EN_WARNING);
    // Not the Vietnamese frame, and not a half-translated screen.
    expect(html).not.toContain('Đã nhập xong');
    expect(html).not.toContain('Dữ liệu đã được nhập đầy đủ');
  });

  it('renders nothing when there is no result yet', () => {
    expect(render(null, 'vi')).toBe('');
    expect(render(null, 'en')).toBe('');
  });
});
