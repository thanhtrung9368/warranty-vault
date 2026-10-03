import { describe, expect, it } from 'vitest';
import type { CategoryOption } from '@/lib/api/catalog';
import {
  detectPasteDelimiter,
  looksLikeHeader,
  matchCategory,
  parsePasteDate,
  parsePasteImport,
  parsePastePrice,
  pasteDraftToInput,
} from '@/lib/device-paste';

// The 20 seeded categories (migration 0004). A subset is enough to exercise
// label matching; `OTHER` must be present because it is the blank-cell default.
const categories: CategoryOption[] = [
  { code: 'PHONE', name: 'Điện thoại' },
  { code: 'LAPTOP', name: 'Laptop' },
  { code: 'WASHING', name: 'Máy giặt / Sấy' },
  { code: 'CAMERA', name: 'Máy ảnh / Quay phim' },
  { code: 'OTHER', name: 'Khác' },
];

describe('detectPasteDelimiter', () => {
  it('prefers a tab — it is what every spreadsheet puts on the clipboard', () => {
    expect(detectPasteDelimiter('a\tb\tc')).toBe('\t');
    expect(detectPasteDelimiter('a\tb, c; d')).toBe('\t');
  });

  it('picks the more frequent of ; and , and breaks ties with ;', () => {
    expect(detectPasteDelimiter('a;b;c,d')).toBe(';');
    expect(detectPasteDelimiter('a,b,c;d')).toBe(',');
    expect(detectPasteDelimiter('a;b,c')).toBe(';');
  });

  it('ignores separators inside quotes and tolerates a single column', () => {
    expect(detectPasteDelimiter('"Loa; 2 loa"\tGhi chú')).toBe('\t');
    expect(detectPasteDelimiter('iPhone 13')).toBe('\t');
  });

  it('reads the first non-blank line only, and skips a BOM', () => {
    expect(detectPasteDelimiter('\n\n\uFEFFa;b;c\nx,y')).toBe(';');
  });
});

describe('parsePasteDate', () => {
  it('accepts the two formats the repo already speaks and normalises to ISO', () => {
    expect(parsePasteDate('2026-03-15')).toEqual({ ok: true, day: '2026-03-15' });
    expect(parsePasteDate('2026-03-15T00:00:00')).toEqual({ ok: true, day: '2026-03-15' });
    expect(parsePasteDate('15/03/2026')).toEqual({ ok: true, day: '2026-03-15' });
    expect(parsePasteDate('5/3/2026')).toEqual({ ok: true, day: '2026-03-05' });
  });

  it('tolerates the same day-first format with other separators or a time', () => {
    expect(parsePasteDate('15-03-2026')).toEqual({ ok: true, day: '2026-03-15' });
    expect(parsePasteDate('15.03.2026')).toEqual({ ok: true, day: '2026-03-15' });
    expect(parsePasteDate('15/03/2026 00:00:00')).toEqual({ ok: true, day: '2026-03-15' });
  });

  it('reads 03/04/2026 day-first, the convention the app writes', () => {
    expect(parsePasteDate('03/04/2026')).toEqual({ ok: true, day: '2026-04-03' });
  });

  it('refuses to guess: two-digit years, impossible days and junk are errors', () => {
    expect(parsePasteDate('15/3/26').ok).toBe(false);
    expect(parsePasteDate('31/02/2026')).toEqual({
      ok: false,
      error: 'Ngày mua không hợp lệ: "31/02/2026"',
    });
    expect(parsePasteDate('2026-02-30').ok).toBe(false);
    expect(parsePasteDate('hôm qua').ok).toBe(false);
    expect(parsePasteDate('')).toEqual({ ok: false, error: 'Thiếu ngày mua' });
  });
});

describe('parsePastePrice', () => {
  it('treats blank as "chưa ghi giá" (0) with no warning', () => {
    expect(parsePastePrice('')).toEqual({ value: 0 });
    expect(parsePastePrice('   ')).toEqual({ value: 0 });
  });

  it('reads grouping separators and currency symbols', () => {
    expect(parsePastePrice('15000000').value).toBe(15_000_000);
    expect(parsePastePrice('15.000.000').value).toBe(15_000_000);
    expect(parsePastePrice('15,000,000').value).toBe(15_000_000);
    expect(parsePastePrice('15.000.000 ₫').value).toBe(15_000_000);
    expect(parsePastePrice('15.000.000đ').value).toBe(15_000_000);
    expect(parsePastePrice('15 000 000').value).toBe(15_000_000);
  });

  it('reads the "tr / triệu / k" shorthand people actually type', () => {
    expect(parsePastePrice('15tr').value).toBe(15_000_000);
    expect(parsePastePrice('15 triệu').value).toBe(15_000_000);
    expect(parsePastePrice('15,5tr').value).toBe(15_500_000);
    expect(parsePastePrice('1.5tr').value).toBe(1_500_000);
    expect(parsePastePrice('1.500tr').value).toBe(1_500_000_000);
    expect(parsePastePrice('15k').value).toBe(15_000);
  });

  it('warns instead of inventing a number it cannot read', () => {
    expect(parsePastePrice('abc')).toEqual({
      value: 0,
      warning: 'Không đọc được giá "abc" — tạm để 0',
    });
    expect(parsePastePrice('-5tr').value).toBe(0);
    expect(parsePastePrice('-5tr').warning).toContain('tạm để 0');
    expect(parsePastePrice('15 tỷ').warning).toContain('tạm để 0');
  });
});

describe('matchCategory', () => {
  it('matches a code or a label, diacritic-insensitively', () => {
    expect(matchCategory('PHONE', categories)).toEqual({ kind: 'matched', code: 'PHONE' });
    expect(matchCategory('phone', categories)).toEqual({ kind: 'matched', code: 'PHONE' });
    expect(matchCategory('Điện thoại', categories)).toEqual({
      kind: 'matched',
      code: 'PHONE',
    });
    expect(matchCategory('dien thoai', categories)).toEqual({
      kind: 'matched',
      code: 'PHONE',
    });
    expect(matchCategory('Máy giặt / Sấy', categories)).toEqual({
      kind: 'matched',
      code: 'WASHING',
    });
  });

  it('falls back to "Khác" for a blank cell and refuses an unknown value', () => {
    expect(matchCategory('', categories)).toEqual({ kind: 'blank', code: 'OTHER' });
    expect(matchCategory('Không có', categories)).toEqual({ kind: 'unknown' });
  });

  it('still resolves labels from the static mirror when the catalog read failed', () => {
    expect(matchCategory('Laptop', [])).toEqual({ kind: 'matched', code: 'LAPTOP' });
  });
});

describe('looksLikeHeader', () => {
  it('needs two known labels, so a data row is not mistaken for a header', () => {
    expect(looksLikeHeader(['Tên thiết bị', 'Ngày mua', 'Giá mua'])).toBe(true);
    expect(looksLikeHeader(['Tên thiết bị', 'Apple', '15/03/2026'])).toBe(false);
    expect(looksLikeHeader(['iPhone 13', 'Điện thoại', 'Apple'])).toBe(false);
    expect(looksLikeHeader(['Serial', 'IMEI'])).toBe(true);
  });
});

describe('parsePasteImport', () => {
  it('returns an empty preview for blank text', () => {
    const preview = parsePasteImport('   \n  ', { categories });
    expect(preview.empty).toBe(true);
    expect(preview.rows).toHaveLength(0);
  });

  it('maps columns by header name when it detects one, and names ignored columns', () => {
    const text = [
      'Tên thiết bị\tDanh mục\tHãng\tNgày mua\tGiá mua\tTrạng thái\tGhi chú',
      'iPhone 13\tĐiện thoại\tApple\t15/03/2024\t15.000.000\tĐang dùng\tMua cho vợ',
    ].join('\n');
    const preview = parsePasteImport(text, { categories });

    expect(preview.headerDetected).toBe(true);
    expect(preview.delimiter).toBe('\t');
    expect(preview.ignoredColumns).toEqual(['Trạng thái']);
    expect(preview.validCount).toBe(1);
    expect(preview.rows[0].line).toBe(2);
    expect(preview.rows[0].draft).toEqual({
      name: 'iPhone 13',
      category: 'PHONE',
      brand: 'Apple',
      model: null,
      serialNumber: null,
      purchaseDate: '2024-03-15',
      purchasePrice: 15_000_000,
      purchasePlace: null,
      notes: 'Mua cho vợ',
    });
  });

  it('reads positionally — the documented column order — when there is no header', () => {
    const text = [
      'MacBook Pro\tLAPTOP\tApple\tMBP14\tSN123\t2023-06-01\t30tr\tFPT Shop\thàng cũ',
      'Nồi chiên\tĐồ nhà bếp\tPhilips\tHD9200\t\t01/12/2023\t1.500.000\tShopee\t',
    ].join('\n');
    const preview = parsePasteImport(text, { categories });

    expect(preview.headerDetected).toBe(false);
    expect(preview.columns.map((c) => c.field)).toEqual([
      'name',
      'category',
      'brand',
      'model',
      'serialNumber',
      'purchaseDate',
      'purchasePrice',
      'purchasePlace',
      'notes',
    ]);
    expect(preview.validCount).toBe(2);
    expect(preview.rows[0].draft).toMatchObject({
      name: 'MacBook Pro',
      category: 'LAPTOP',
      serialNumber: 'SN123',
      purchaseDate: '2023-06-01',
      purchasePrice: 30_000_000,
      purchasePlace: 'FPT Shop',
      notes: 'hàng cũ',
    });
    // Unknown label from the static mirror (the catalog here does not list it).
    expect(preview.rows[1].draft).toMatchObject({
      name: 'Nồi chiên',
      category: 'KITCHEN',
      purchasePrice: 1_500_000,
      notes: null,
    });
  });

  it('skips blank lines but keeps the line numbers the user sees', () => {
    const text = 'Tên,Loại,Ngày mua,Giá mua\n\nMáy giặt,WASHING,15/03/2024,9tr\n';
    const preview = parsePasteImport(text, { categories });
    expect(preview.rows).toHaveLength(1);
    expect(preview.rows[0].line).toBe(3);
    expect(preview.rows[0].draft?.category).toBe('WASHING');
    expect(preview.rows[0].draft?.purchasePrice).toBe(9_000_000);
  });

  it('keeps too-few-column rows visible with their own errors', () => {
    const text = ['Tên\tNgày mua\tGiá mua', 'Máy ảnh', 'Loa bluetooth\t31/02/2024\t2tr'].join('\n');
    const preview = parsePasteImport(text, { categories });

    expect(preview.validCount).toBe(0);
    expect(preview.skippedCount).toBe(2);
    expect(preview.rows[0].errors).toEqual(['Thiếu ngày mua']);
    expect(preview.rows[0].warnings).toEqual(['Chưa ghi loại — dùng "Khác"']);
    expect(preview.rows[0].draft).toBeNull();
    expect(preview.rows[1].errors[0]).toContain('Ngày mua không hợp lệ: "31/02/2024"');
    expect(preview.rows[1].name).toBe('Loa bluetooth');
  });

  it('warns about extra cells but still creates the row', () => {
    const text = 'Loa bluetooth,SPEAKER,JBL,Go 3,,15/03/2024,2tr,Tiki,note,thừa 1,thừa 2';
    const preview = parsePasteImport(text, { categories });
    expect(preview.rows[0].draft).toMatchObject({ name: 'Loa bluetooth', purchasePrice: 2_000_000 });
    expect(preview.rows[0].warnings).toContain('Thừa 2 ô so với bảng — phần thừa bị bỏ qua');
  });

  it('defaults a blank category to "Khác" with a warning, but errors on an unknown one', () => {
    const text = ['Tên,Ngày mua,Loại', 'Máy sấy,15/03/2024,', 'Máy sấy 2,15/03/2024,Máy bay'].join('\n');
    const preview = parsePasteImport(text, { categories });

    expect(preview.rows[0].draft?.category).toBe('OTHER');
    expect(preview.rows[0].warnings).toContain('Chưa ghi loại — dùng "Khác"');
    expect(preview.rows[1].draft).toBeNull();
    expect(preview.rows[1].errors).toContain('Loại không có trong danh mục: "Máy bay"');
  });

  it('honours quoted fields containing the delimiter, quotes and newlines', () => {
    const text = 'Tên,Ngày mua,Ghi chú\n"Loa; 2 loa",15/03/2024,"Anh nói ""ngon""\nlắm"';
    const preview = parsePasteImport(text, { categories });
    expect(preview.delimiter).toBe(',');
    expect(preview.rows[0].cells[0]).toBe('Loa; 2 loa');
    expect(preview.rows[0].draft?.notes).toBe('Anh nói "ngon"\nlắm');
    // The quoted newline must not have been read as a row separator.
    expect(preview.rows).toHaveLength(1);
  });

  it('lets the user override header detection both ways', () => {
    // `auto` sees two known labels → header, so this header-only paste has no
    // data rows (and nothing would be created).
    const headerOnly = parsePasteImport('Tên,Danh mục,15/03/2024', { categories });
    expect(headerOnly.headerDetected).toBe(true);
    expect(headerOnly.rows).toHaveLength(0);

    // Positional mode reads the documented column order, so this row is only
    // importable when the parser is *not* treating line 1 as a header.
    const dataRow = 'iPhone,PHONE,Apple,,SN123,15/03/2024,15tr';
    const auto = parsePasteImport(dataRow, { categories });
    expect(auto.headerDetected).toBe(false);
    expect(auto.rows[0].draft).toMatchObject({
      name: 'iPhone',
      category: 'PHONE',
      brand: 'Apple',
      serialNumber: 'SN123',
      purchaseDate: '2024-03-15',
      purchasePrice: 15_000_000,
    });

    // Forcing "this row is data" keeps it importable...
    expect(parsePasteImport(dataRow, { categories, headerMode: 'no' }).validCount).toBe(1);
    // ...while forcing "this row is a header" consumes it (0 rows would be created).
    const asHeader = parsePasteImport(dataRow, { categories, headerMode: 'yes' });
    expect(asHeader.headerDetected).toBe(true);
    expect(asHeader.rows).toHaveLength(0);
  });

  it('notes a duplicated column and only uses the first one', () => {
    const text = ['Tên,Ngày mua,Giá mua,Giá mua', 'iPad,15/03/2024,10tr,99tr'].join('\n');
    const preview = parsePasteImport(text, { categories });
    expect(preview.notes).toContain('Cột "Giá mua" bị trùng — chỉ dùng cột đầu tiên.');
    expect(preview.rows[0].draft?.purchasePrice).toBe(10_000_000);
  });

  it('handles CRLF, a BOM and semicolon-delimited text', () => {
    const text = '\uFEFFTên;Ngày mua;Giá mua\r\nTivi Samsung;15/03/2024;12.000.000\r\n';
    const preview = parsePasteImport(text, { categories });
    expect(preview.delimiter).toBe(';');
    expect(preview.headerDetected).toBe(true);
    expect(preview.rows[0].draft).toMatchObject({
      name: 'Tivi Samsung',
      purchaseDate: '2024-03-15',
      purchasePrice: 12_000_000,
      category: 'OTHER',
    });
  });

  it('round-trips the devices CSV export this repo writes', () => {
    // Exactly what "Xuất CSV" produces (vi-VN Excel: `;` + BOM, dd/MM/yyyy,
    // bare numbers, Vietnamese category labels) pasted straight back in.
    const text =
      '\uFEFFTên thiết bị;Danh mục;Hãng;Model;Số seri;Ngày mua;Giá mua;Nơi mua;Trạng thái;Hết bảo hành;Ghi chú\r\n' +
      'Máy giặt LG;Máy giặt / Sấy;LG;FC1409;SN-1;01/12/2023;9000000;Điện Máy Xanh;Đang dùng;01/12/2025;\r\n';
    const preview = parsePasteImport(text, { categories: [...categories] });

    expect(preview.delimiter).toBe(';');
    expect(preview.headerDetected).toBe(true);
    expect(preview.ignoredColumns).toEqual(['Trạng thái', 'Hết bảo hành']);
    expect(preview.validCount).toBe(1);
    expect(preview.rows[0].draft).toEqual({
      name: 'Máy giặt LG',
      category: 'WASHING',
      brand: 'LG',
      model: 'FC1409',
      serialNumber: 'SN-1',
      purchaseDate: '2023-12-01',
      purchasePrice: 9_000_000,
      purchasePlace: 'Điện Máy Xanh',
      notes: null,
    });
  });

  it('notes a single-column paste instead of pretending it is a table', () => {    const preview = parsePasteImport('iPhone 13\nMacBook Pro', { categories });
    expect(preview.notes).toEqual([
      'Không thấy dấu phân cách (tab, ; hoặc ,) — mỗi dòng đang chỉ có 1 cột.',
    ]);
    expect(preview.rows.every((r) => r.draft == null)).toBe(true);
  });

  it('caps how many rows it parses and says so', () => {
    const lines = ['Tên\tNgày mua\tGiá mua'];
    for (let i = 0; i < 10; i += 1) lines.push(`Máy ${i}\t15/03/2024\t1tr`);
    const preview = parsePasteImport(lines.join('\n'), { categories, maxRows: 3 });
    expect(preview.rows).toHaveLength(3);
    expect(preview.truncated).toBe(true);
    expect(preview.validCount).toBe(3);
  });

  it('never invents a value for a row it flagged', () => {
    // 7 positional cells: the date is fine, the name is empty → still skipped.
    const preview = parsePasteImport('\tPHONE\tApple\t\t\t15/03/2024\t15tr', { categories });
    expect(preview.rows[0].errors).toEqual(['Thiếu tên thiết bị']);
    expect(preview.rows[0].draft).toBeNull();
  });
});

describe('pasteDraftToInput', () => {
  it('sends exactly the nine pasted fields and nothing that was not pasted', () => {
    const preview = parsePasteImport(
      'Tên,Loại,Ngày mua,Giá mua\nLoa JBL,Loa,15/03/2024,2tr',
      { categories },
    );
    const draft = preview.rows[0].draft;
    expect(draft).not.toBeNull();

    const input = pasteDraftToInput(draft!);
    expect(input).toEqual({
      name: 'Loa JBL',
      category: 'SPEAKER',
      brand: null,
      model: null,
      serialNumber: null,
      purchaseDate: '2024-03-15',
      purchasePrice: 2_000_000,
      purchasePlace: null,
      notes: null,
    });
    // The write path must not guess a status, a resale record, a return window
    // or an inline warranty package for a device the user only pasted a row for.
    expect(Object.keys(input).sort()).toEqual([
      'brand',
      'category',
      'model',
      'name',
      'notes',
      'purchaseDate',
      'purchasePlace',
      'purchasePrice',
      'serialNumber',
    ]);
  });
});
