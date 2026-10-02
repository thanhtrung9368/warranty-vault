import { describe, it, expect } from 'vitest';
import {
  CSV_BOM,
  CSV_DEFAULT_DELIMITER,
  CSV_DELIMITERS,
  CSV_LINE_ENDING,
  csvBool,
  csvDate,
  csvNumber,
  csvText,
  escapeCsvField,
  isCsvDelimiter,
  serializeCsv,
  tableToCsv,
  toCsvDelimiter,
} from '@/lib/csv';

// `lib/csv.ts` is the RFC 4180 serialiser behind the settings-page CSV export.
// The cases below are the ones that actually break real files: a field holding
// the delimiter, a double quote, a newline; the UTF-8 BOM Excel needs for
// Vietnamese diacritics; and the null-vs-zero distinction in numeric columns.

describe('escapeCsvField', () => {
  it('leaves a plain field bare', () => {
    expect(escapeCsvField('Máy giặt LG', ';')).toBe('Máy giặt LG');
    expect(escapeCsvField(15000000, ';')).toBe('15000000');
  });

  it('quotes a field containing the delimiter', () => {
    expect(escapeCsvField('Loa SoundMax; 2 chiếc', ';')).toBe('"Loa SoundMax; 2 chiếc"');
    expect(escapeCsvField('Tai nghe, hộp cũ', ',')).toBe('"Tai nghe, hộp cũ"');
  });

  it('only quotes for the *active* delimiter', () => {
    // A comma is not special when the file is semicolon-delimited, so it stays
    // bare — quoting it anyway would still parse, but the rule is the point.
    expect(escapeCsvField('Tai nghe, hộp cũ', ';')).toBe('Tai nghe, hộp cũ');
    expect(escapeCsvField('Loa; 2 chiếc', ',')).toBe('Loa; 2 chiếc');
  });

  it('doubles inner quotes and wraps the field', () => {
    expect(escapeCsvField('Màn hình 15"', ';')).toBe('"Màn hình 15"""');
    expect(escapeCsvField('Anh "Tèo" nói', ';')).toBe('"Anh ""Tèo"" nói"');
    // Quote-only field, no delimiter involved.
    expect(escapeCsvField('"', ',')).toBe('""""');
  });

  it('quotes a field containing a newline (LF or CRLF)', () => {
    expect(escapeCsvField('Bảo hành\n2 năm', ';')).toBe('"Bảo hành\n2 năm"');
    expect(escapeCsvField('Bảo hành\r\n2 năm', ';')).toBe('"Bảo hành\r\n2 năm"');
    // A lone CR must also trigger quoting, else it would split the record.
    expect(escapeCsvField('Bảo hành\r2 năm', ';')).toBe('"Bảo hành\r2 năm"');
  });

  it('treats empty, null and undefined as one empty cell', () => {
    expect(escapeCsvField('', ';')).toBe('');
    expect(escapeCsvField(null, ';')).toBe('');
    expect(escapeCsvField(undefined, ';')).toBe('');
    expect(escapeCsvField(0, ';')).toBe('0');
  });

  it('defaults to the semicolon delimiter the export ships with', () => {
    expect(escapeCsvField('a;b')).toBe('"a;b"');
    expect(CSV_DEFAULT_DELIMITER).toBe(';');
  });
});

describe('value formatters', () => {
  it('csvText maps null/undefined to an empty string, keeps real text', () => {
    expect(csvText('LG')).toBe('LG');
    expect(csvText('')).toBe('');
    expect(csvText(null)).toBe('');
    expect(csvText(undefined)).toBe('');
  });

  it('csvNumber writes bare numbers — no ₫, no thousands separator', () => {
    expect(csvNumber(15000000)).toBe('15000000');
    expect(csvNumber(1234567.5)).toBe('1234567.5');
    expect(csvNumber(-5)).toBe('-5');
  });

  it('csvNumber keeps zero as "0" but writes null/undefined as empty', () => {
    // The distinction matters: 0 đồng is a fact, null is "không rõ".
    expect(csvNumber(0)).toBe('0');
    expect(csvNumber(null)).toBe('');
    expect(csvNumber(undefined)).toBe('');
    expect(csvNumber(Number.NaN)).toBe('');
    expect(csvNumber(Number.POSITIVE_INFINITY)).toBe('');
  });

  it('csvDate writes dd/MM/yyyy and takes the date as sent', () => {
    // ISO strings are sliced, not timezone-shifted: 00:00Z stays 15/01.
    expect(csvDate('2026-01-15T00:00:00Z')).toBe('15/01/2026');
    expect(csvDate('2026-01-15T23:30:00+07:00')).toBe('15/01/2026');
    expect(csvDate('2026-01-15')).toBe('15/01/2026');
    expect(csvDate(new Date(2026, 0, 5))).toBe('05/01/2026');
  });

  it('csvDate writes an empty cell for null / undefined / garbage', () => {
    expect(csvDate(null)).toBe('');
    expect(csvDate(undefined)).toBe('');
    expect(csvDate('')).toBe('');
    expect(csvDate('không có')).toBe('');
  });

  it('csvBool is Vietnamese', () => {
    expect(csvBool(true)).toBe('Có');
    expect(csvBool(false)).toBe('Không');
    expect(csvBool(null)).toBe('');
    expect(csvBool(undefined)).toBe('');
  });
});

describe('serializeCsv', () => {
  it('starts with the UTF-8 BOM character by default', () => {
    const out = serializeCsv([['a']]);
    expect(out.startsWith(CSV_BOM)).toBe(true);
    expect(out.charCodeAt(0)).toBe(0xfeff);
    // The three bytes Excel looks for: EF BB BF.
    expect([...Buffer.from(out, 'utf8').subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  });

  it('omits the BOM when asked to', () => {
    const out = serializeCsv([['a']], { bom: false });
    expect(out.startsWith('\ufeff')).toBe(false);
    expect(out).toBe('a\r\n');
  });

  it('joins records with CRLF and ends with a trailing CRLF', () => {
    const out = serializeCsv(
      [
        ['Tên', 'Giá'],
        ['Máy giặt', 15000000],
      ],
      { delimiter: ',', bom: false },
    );
    expect(out).toBe('Tên,Giá\r\nMáy giặt,15000000\r\n');
    expect(out.endsWith(CSV_LINE_ENDING)).toBe(true);
  });

  it('honours the semicolon delimiter and keeps cell order', () => {
    const out = serializeCsv(
      [
        ['Tên thiết bị', 'Giá mua'],
        ['Loa; 2 chiếc', 0],
      ],
      { delimiter: ';', bom: false },
    );
    expect(out).toBe('Tên thiết bị;Giá mua\r\n"Loa; 2 chiếc";0\r\n');
  });

  it('keeps empty columns in place (no collapsing)', () => {
    const out = serializeCsv([['a', '', null, 0]], { delimiter: ',', bom: false });
    expect(out).toBe('a,,,0\r\n');
    expect(out.split('\r\n')[0].split(',')).toHaveLength(4);
  });

  it('survives a record whose field contains the delimiter, a quote and a newline', () => {
    const tricky = 'Máy "xịn"; 2 chiếc\n(mua 2024)';
    const out = serializeCsv([['name', 'note'], [tricky, null]], {
      delimiter: ';',
      bom: false,
    });
    expect(out).toBe('name;note\r\n"Máy ""xịn""; 2 chiếc\n(mua 2024)";\r\n');
    // Exactly two records: the embedded newline did not split the row.
    expect(out.trimEnd().split('\r\n')).toHaveLength(2);
  });

  it('falls back to the default delimiter for an untrusted value', () => {
    const out = serializeCsv([['a', 'b']], {
      delimiter: '|' as unknown as ',',
      bom: false,
    });
    expect(out).toBe('a;b\r\n');
  });
});

describe('tableToCsv', () => {
  it('prepends the header row', () => {
    const out = tableToCsv(
      { header: ['Tên', 'Giá'], rows: [['Loa', 100], ['Chuột', 0]] },
      { delimiter: ';', bom: false },
    );
    expect(out).toBe('Tên;Giá\r\nLoa;100\r\nChuột;0\r\n');
  });

  it('handles a header with no data rows (and defaults to ;)', () => {
    const out = tableToCsv({ header: ['Tên', 'Giá'], rows: [] }, { bom: false });
    expect(out).toBe('Tên;Giá\r\n');
  });
});

describe('delimiter guards', () => {
  it('accepts only , and ;', () => {
    expect(CSV_DELIMITERS).toEqual([',', ';']);
    expect(isCsvDelimiter(',')).toBe(true);
    expect(isCsvDelimiter(';')).toBe(true);
    expect(isCsvDelimiter('|')).toBe(false);
    expect(isCsvDelimiter('\t')).toBe(false);
    expect(isCsvDelimiter(null)).toBe(false);
    expect(toCsvDelimiter(';')).toBe(';');
    expect(toCsvDelimiter('|')).toBe(CSV_DEFAULT_DELIMITER);
    expect(toCsvDelimiter(undefined)).toBe(CSV_DEFAULT_DELIMITER);
  });
});
