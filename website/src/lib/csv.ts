// Pure CSV serialisation primitives (RFC 4180) with the two Vietnamese-Excel
// quirks handled explicitly. No I/O, no DOM, no server-only imports — this
// module is unit-tested in `src/lib/__tests__/csv.test.ts` and is also safe to
// import from a client component.
//
// Decisions (see also `csv-export.ts`, which builds the per-entity tables):
//
// 1. DELIMITER — parameterised, defaulting to `;` (see `CSV_DEFAULT_DELIMITER`).
//    There is no single right answer for a Vietnamese audience, so the settings
//    UI asks and this module takes the answer:
//      - `;` : what Excel wants on a `vi-VN` Windows machine. Excel derives
//              its list separator from the system locale, and vi-VN uses `;`;
//              double-clicking a comma-delimited file there dumps every field
//              into column A. This is the default we ship.
//      - `,` : RFC 4180 and the more portable choice — Google Sheets, Numbers,
//              LibreOffice, pandas, English-locale Excel.
//    We deliberately do NOT emit the Excel-only `sep=;` first line: Excel
//    honours it but every other parser (incl. Google Sheets) then shows
//    `sep=;` as a literal first row, which is worse than asking once.
//    Whatever the delimiter, a field containing it is quoted (see below).
//
// 2. BOM — always prefixed when `bom` is on (the default).
//    Excel reads `.csv` as the machine's legacy ANSI codepage unless the file
//    starts with a UTF-8 BOM (EF BB BF). Without it, "Máy giặt" arrives as
//    "MÃ¡y giáº·t". The BOM is emitted as the U+FEFF character in the returned
//    string; `Blob`/`Buffer` encode it to the three magic bytes.
//
// 3. MONEY — `csvNumber()` writes a bare number (`15000000`), never `15.000.000 ₫`.
//    A spreadsheet must see a number to sum/sort it; the Vietnamese currency
//    formatting stays in the UI (`formatVND`).
//
// 4. QUOTING — RFC 4180: a field is wrapped in `"` and its inner quotes doubled
//    only when it contains the delimiter, a `"`, CR or LF. Plain fields are
//    left bare so the file stays readable in a text editor.
//
// 5. Records are separated by CRLF (RFC 4180), with a trailing CRLF after the
//    last record — both Excel and Sheets accept it and it keeps `cat` output
//    tidy.
//
// Note on formula injection: values are written verbatim. Escaping a leading
// `=`, `+`, `-` or `@` with an apostrophe is the usual CSV-injection defence,
// but it corrupts legitimate values (a note starting with `-`) and this export
// only ever contains the signed-in user's own records, which they then open
// themselves. We keep round-trip fidelity instead.

export const CSV_BOM = '\uFEFF';

export const CSV_LINE_ENDING = '\r\n';

export type CsvDelimiter = ',' | ';';

export const CSV_DELIMITERS: readonly CsvDelimiter[] = [',', ';'];

/** Default delimiter: `;`, what vi-VN Excel expects (see note 1 above). */
export const CSV_DEFAULT_DELIMITER: CsvDelimiter = ';';

export type CsvValue = string | number | null | undefined;
export type CsvRow = readonly CsvValue[];

export function isCsvDelimiter(value: unknown): value is CsvDelimiter {
  return value === ',' || value === ';';
}

/**
 * Narrow an untrusted (client-supplied) value to a known delimiter, falling
 * back to the default. Server actions receive the delimiter over the wire, so
 * it must never be interpolated into the output unchecked.
 */
export function toCsvDelimiter(value: unknown): CsvDelimiter {
  return isCsvDelimiter(value) ? value : CSV_DEFAULT_DELIMITER;
}

/** Nullable text field. `null`/`undefined` become an empty cell, not `"null"`. */
export function csvText(value: string | null | undefined): string {
  return value == null ? '' : value;
}

/**
 * Numeric field: bare digits, no grouping separator, no currency symbol, so a
 * spreadsheet treats the cell as a number. `0` stays `0` (an empty cell would
 * be wrong — it reads as "unknown"), while `null`/`NaN` become empty.
 */
export function csvNumber(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '';
  return String(value);
}

const ISO_DATE_PREFIX = /^(\d{4})-(\d{2})-(\d{2})/;

/**
 * Date field as `dd/MM/yyyy` (the format the UI already shows via
 * `formatDate`), which is what vi-VN Excel parses as a real date.
 *
 * ISO strings are sliced rather than passed through `new Date()`: the Go API
 * serialises `timestamp without time zone` columns as RFC3339, and parsing
 * that into a Date and re-formatting would shift the calendar day for anyone
 * whose machine is west of the server's timezone. Slicing keeps the exact date
 * the user typed. `null` → empty cell.
 */
export function csvDate(value: string | Date | null | undefined): string {
  if (value == null) return '';
  if (value instanceof Date) return formatDay(value);
  const match = ISO_DATE_PREFIX.exec(value);
  if (match) return `${match[3]}/${match[2]}/${match[1]}`;
  return formatDay(new Date(value));
}

function formatDay(date: Date): string {
  if (Number.isNaN(date.getTime())) return '';
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${date.getFullYear()}`;
}

/** Vietnamese yes/no for boolean columns. Unknown → empty cell. */
export function csvBool(value: boolean | null | undefined): string {
  if (value == null) return '';
  return value ? 'Có' : 'Không';
}

/**
 * Escape one field per RFC 4180. Quoting is applied only when required:
 * the field contains the active delimiter, a double quote, CR or LF.
 *
 *   escapeCsvField('Máy giặt')        -> 'Máy giặt'
 *   escapeCsvField('Loa; 2 loa', ';') -> '"Loa; 2 loa"'
 *   escapeCsvField('Màn 15"', ';')    -> '"Màn 15"""'
 *   escapeCsvField('a\nb', ';')       -> '"a\nb"'
 */
export function escapeCsvField(value: CsvValue, delimiter: CsvDelimiter = CSV_DEFAULT_DELIMITER): string {
  const text = value == null ? '' : String(value);
  const needsQuoting =
    text.includes(delimiter) ||
    text.includes('"') ||
    text.includes('\n') ||
    text.includes('\r');
  if (!needsQuoting) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

/**
 * Serialise a table (header first, then one array per record) to a CSV string.
 *
 * Rows are written positionally — a short row simply ends up with fewer cells,
 * so callers keep every row length equal to the header length (asserted in the
 * `csv-export` tests rather than checked here, which keeps this hot path free
 * of a per-row branch).
 */
export function serializeCsv(
  rows: readonly CsvRow[],
  opts: { delimiter?: CsvDelimiter; bom?: boolean } = {},
): string {
  const delimiter = toCsvDelimiter(opts.delimiter);
  const bom = opts.bom !== false;
  const body = rows
    .map((row) => row.map((cell) => escapeCsvField(cell, delimiter)).join(delimiter))
    .join(CSV_LINE_ENDING);
  return (bom ? CSV_BOM : '') + body + CSV_LINE_ENDING;
}

/** A header row plus data rows, ready for {@link serializeCsv}. */
export type CsvTable = {
  header: CsvRow;
  rows: readonly CsvRow[];
};

/** Serialise a {@link CsvTable}, header included, BOM on by default. */
export function tableToCsv(
  table: CsvTable,
  opts: { delimiter?: CsvDelimiter; bom?: boolean } = {},
): string {
  return serializeCsv([table.header, ...table.rows], opts);
}
