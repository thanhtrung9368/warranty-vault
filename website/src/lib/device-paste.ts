// "Dán bảng để nhập nhiều thiết bị" (FEATURE_IDEAS #13) — the pure parser.
//
// The user copies a block of cells out of Excel / Google Sheets / Notes and
// pastes it. This module turns that text into per-row device drafts **plus the
// reasons a row cannot be created**, so the screen can show exactly what will be
// created before anything is. Nothing here fetches, writes or touches the DOM:
// the same function runs in the browser (live preview) and again in the server
// action (the only parse that actually creates devices), so the two can never
// drift. Tested in `src/lib/__tests__/device-paste.test.ts`.
//
// ── Decisions (deliberate, all of them conservative) ────────────────────────
//
// 1. ROWS are one per line: LF, CRLF or a lone CR. A completely blank line is
//    skipped silently (spreadsheets paste trailing newlines), but line numbers
//    keep counting so every error can point at the line the user sees.
//    A field quoted with `"` may span lines (RFC 4180), so a pasted comment
//    with a newline in it does not shred the table.
//
// 2. COLUMNS are delimited by ONE delimiter per paste, detected from the first
//    non-blank line (outside quotes): a tab wins outright (that is what every
//    spreadsheet puts on the clipboard, and a tab inside a cell is impossible),
//    otherwise the more frequent of `;` and `,` wins, with `;` breaking ties
//    because that is what vi-VN Excel writes. Mixing delimiters in one paste is
//    not supported — the detected one is shown in the preview.
//
// 3. THE HEADER IS DETECTED, NOT REQUIRED. The first row is treated as a header
//    when at least two of its cells match a known column label (our own export
//    labels, the wire field names, and common Vietnamese synonyms — matched
//    diacritic- and case-insensitively). With a header, columns are mapped **by
//    name** and unknown columns are ignored (and listed in the preview).
//    Without one, columns are read **positionally** in the order the feature
//    specifies: name, category, brand, model, serialNumber, purchaseDate,
//    purchasePrice, purchasePlace, notes. The user can override the detection
//    (`headerMode`) — an auto-detection the user cannot correct is a trap, not a
//    convenience.
//
// 4. TOO FEW CELLS ⇒ the missing trailing fields are simply empty; the required
//    ones then fail on their own terms (see 7). TOO MANY ⇒ the extra cells are
//    ignored, and the row carries a warning saying so. Extra trailing junk is
//    common when copying a rectangle, and it cannot silently shift a value into
//    the wrong field.
//
// 5. DATES accept exactly the two formats the rest of the repo already speaks,
//    and are normalised to the wire/form format `YYYY-MM-DD`:
//      - `YYYY-MM-DD` (the `<input type="date">` value, what `services.parseDate`
//        takes, and what every other write path sends);
//      - `dd/MM/yyyy` (what `csvDate` writes and `formatDate` renders).
//    `-` and `.` separators are tolerated for the day-first form, as is a
//    trailing time, because those are the same format, not a third one. A
//    two-digit year (`15/3/26`) and anything else is an ERROR, never a guess.
//    `03/04/2026` is read day-first (3 April) — the Vietnamese convention the
//    app writes in — which is documented here rather than inferred per row.
//
// 6. MONEY accepts what people actually paste: `15000000`, `15.000.000`,
//    `15,000,000`, `15.000.000 ₫`, `15tr`, `15 triệu`, `15,5tr`, `15k`. Without a
//    multiplier, `.`/`,` are thousands separators (VND amounts here are whole
//    đồng); with one, a single separator followed by 1–2 digits is a decimal
//    (`1.5tr` = 1.500.000). Blank means 0 — "chưa ghi giá" in this app — and an
//    unreadable value becomes 0 **with a warning**, because price is optional and
//    a warning is visible in the preview whereas an invented number would not be.
//
// 7. A ROW IS ONLY CREATED WHEN IT IS UNAMBIGUOUS. Missing name, missing or
//    unreadable purchase date, and a category that is neither blank nor in the
//    catalog are blocking errors: the row shows why and is skipped, and the
//    others still go through. A blank category is *not* an error — it falls back
//    to "Khác" (or the catalog's first entry) with a warning, so a two-column
//    paste still works. Unrecognised values are never silently coerced: this
//    app's failure mode to avoid is creating a wrong device.
//
// 8. NOTHING ELSE IS IMPORTED. `status`, warranty columns, attachment columns
//    and any unrecognised header are ignored, and the preview names them so the
//    user knows their "Đã bán" column will not be applied.

import type { CategoryOption } from '@/lib/api/catalog';
// `import type` on purpose: `@/lib/api/devices` reaches the server-only auth
// cookie through `./client`, and a value import would drag it into the client
// bundle (same rule as `csv-export.ts`).
import type { DeviceInput } from '@/lib/api/devices';
import { CATEGORY_LABELS } from '@/lib/types';

export type PasteDelimiter = '\t' | ';' | ',';

/** Columns read positionally when the paste has no header (decision 3). */
export const PASTE_FIELDS = [
  'name',
  'category',
  'brand',
  'model',
  'serialNumber',
  'purchaseDate',
  'purchasePrice',
  'purchasePlace',
  'notes',
] as const;

export type PasteField = (typeof PASTE_FIELDS)[number];

export const PASTE_FIELD_LABELS: Record<PasteField, string> = {
  name: 'Tên thiết bị',
  category: 'Loại',
  brand: 'Hãng',
  model: 'Model',
  serialNumber: 'Serial / IMEI',
  purchaseDate: 'Ngày mua',
  purchasePrice: 'Giá mua',
  purchasePlace: 'Nơi mua',
  notes: 'Ghi chú',
};

/**
 * Rows past the cap are not parsed at all (`truncated: true`). The device quota
 * is far below this, so the cap only exists to keep a pathological paste (a
 * whole sheet) from freezing the preview render.
 */
export const PASTE_MAX_ROWS = 300;

export type PasteHeaderMode = 'auto' | 'yes' | 'no';

/** What the server action would send for one row (a `DeviceInput` subset). */
export type PasteDraft = {
  name: string;
  category: string;
  brand: string | null;
  model: string | null;
  serialNumber: string | null;
  /** `YYYY-MM-DD` — the format the device form and `services.parseDate` use. */
  purchaseDate: string;
  purchasePrice: number;
  purchasePlace: string | null;
  notes: string | null;
};

export type PasteColumn = {
  index: number;
  /** Header text as pasted ('' in positional mode). */
  header: string;
  /** `null` = ignored column. */
  field: PasteField | null;
};

export type PasteRow = {
  /** 1-based line number in the pasted text (the header line counts). */
  line: number;
  cells: string[];
  /** Raw name cell, so a skipped row can still be identified in the UI. */
  name: string;
  /** `null` when the row has blocking errors. */
  draft: PasteDraft | null;
  errors: string[];
  warnings: string[];
};

export type PasteImportPreview = {
  delimiter: PasteDelimiter;
  /** Vietnamese, for the "đã tách bằng …" line. */
  delimiterLabel: string;
  headerDetected: boolean;
  headerCells: string[] | null;
  columns: PasteColumn[];
  /** Header labels that are understood but not importable (decision 8). */
  ignoredColumns: string[];
  /** Duplicate/unknown columns and other table-level notes. */
  notes: string[];
  rows: PasteRow[];
  validCount: number;
  skippedCount: number;
  truncated: boolean;
  empty: boolean;
};

// ── Normalisation + label maps ──────────────────────────────────────────────

/**
 * Case-, diacritic- and separator-insensitive key for header/category matching
 * ("Tên thiết bị" → "ten thiet bi", "serialNumber" → "serialnumber").
 */
export function normalizeKey(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[_/\\.,\-–—:]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Header labels → device field. Values are matched after {@link normalizeKey}. */
const HEADER_ALIASES: Record<string, PasteField> = {
  // name
  ten: 'name',
  'ten thiet bi': 'name',
  'thiet bi': 'name',
  name: 'name',
  'san pham': 'name',
  product: 'name',
  'do vat': 'name',
  // category
  'danh muc': 'category',
  loai: 'category',
  'loai thiet bi': 'category',
  'nhom thiet bi': 'category',
  'phan loai': 'category',
  category: 'category',
  // brand
  hang: 'brand',
  'thuong hieu': 'brand',
  'hang san xuat': 'brand',
  'nha san xuat': 'brand',
  brand: 'brand',
  // model
  model: 'model',
  'model may': 'model',
  'dong may': 'model',
  'ma may': 'model',
  // serialNumber
  serial: 'serialNumber',
  serialnumber: 'serialNumber',
  'serial imei': 'serialNumber',
  'so seri': 'serialNumber',
  'so serial': 'serialNumber',
  'so imei': 'serialNumber',
  'so may': 'serialNumber',
  imei: 'serialNumber',
  sn: 'serialNumber',
  // purchaseDate
  'ngay mua': 'purchaseDate',
  'ngay mua hang': 'purchaseDate',
  ngay: 'purchaseDate',
  date: 'purchaseDate',
  purchasedate: 'purchaseDate',
  // purchasePrice
  'gia mua': 'purchasePrice',
  gia: 'purchasePrice',
  'gia tien': 'purchasePrice',
  'thanh tien': 'purchasePrice',
  'so tien': 'purchasePrice',
  price: 'purchasePrice',
  purchaseprice: 'purchasePrice',
  // purchasePlace
  'noi mua': 'purchasePlace',
  'mua tai': 'purchasePlace',
  'noi ban': 'purchasePlace',
  'cua hang': 'purchasePlace',
  shop: 'purchasePlace',
  store: 'purchasePlace',
  purchaseplace: 'purchasePlace',
  // notes
  'ghi chu': 'notes',
  note: 'notes',
  notes: 'notes',
  'mo ta': 'notes',
};

/**
 * Columns we recognise deliberately and refuse to import (decision 8). Mapping
 * them to a label lets the preview say *"cột Trạng thái sẽ bị bỏ qua"* instead
 * of pretending the column is unknown.
 */
const IGNORED_HEADER_ALIASES: Record<string, string> = {
  'trang thai': 'Trạng thái',
  status: 'Trạng thái',
  'tinh trang': 'Trạng thái',
  'het bao hanh': 'Hết bảo hành',
  'ngay het bao hanh': 'Hết bảo hành',
  'han bao hanh': 'Hết bảo hành',
  warranty: 'Bảo hành',
  'bao hanh': 'Bảo hành',
  'so thang bao hanh': 'Số tháng bảo hành',
  'file dinh kem': 'File đính kèm',
  attachment: 'File đính kèm',
  id: 'ID',
  'ma thiet bi': 'ID',
};

const DELIMITER_LABELS: Record<PasteDelimiter, string> = {
  '\t': 'tab',
  ';': 'dấu chấm phẩy (;)',
  ',': 'dấu phẩy (,)',
};

// ── Text splitting ──────────────────────────────────────────────────────────

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

type RawRecord = { line: number; cells: string[] };

/**
 * Split pasted text into records of cells (decision 1). `"` starts a quoted
 * field only at the beginning of a cell; inside it, `""` is a literal quote and
 * delimiters/newlines are content. Never throws on unbalanced quotes — an
 * unterminated quote simply runs to the end of the text.
 */
function splitRecords(text: string, delimiter: PasteDelimiter): RawRecord[] {
  const records: RawRecord[] = [];
  let cells: string[] = [];
  let cell = '';
  let inQuotes = false;
  let line = 1;
  let recordLine = 1;

  const endCell = () => {
    cells.push(cell);
    cell = '';
  };
  const endRecord = () => {
    endCell();
    records.push({ line: recordLine, cells });
    cells = [];
    line += 1;
    recordLine = line;
  };

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        if (ch === '\n') line += 1;
        cell += ch;
      }
      continue;
    }
    if (ch === '"' && cell === '') {
      inQuotes = true;
    } else if (ch === delimiter) {
      endCell();
    } else if (ch === '\n') {
      endRecord();
    } else if (ch === '\r') {
      // CRLF: swallow the CR and let the LF end the record. A lone CR (old
      // Mac / some clipboard paths) ends the record itself.
      if (text[i + 1] !== '\n') endRecord();
    } else {
      cell += ch;
    }
  }
  if (cell !== '' || cells.length > 0) endRecord();

  return records;
}

/**
 * Detect the single delimiter for this paste (decision 2). Counts only outside
 * quoted spans so a quoted `"Loa; 2 loa"` cannot outvote the real separator.
 */
export function detectPasteDelimiter(text: string): PasteDelimiter {
  const firstLine = stripBom(text)
    .split(/\r\n|\n|\r/)
    .find((l) => l.trim() !== '');
  if (!firstLine) return '\t';

  let tab = 0;
  let semicolon = 0;
  let comma = 0;
  let inQuotes = false;
  for (let i = 0; i < firstLine.length; i += 1) {
    const ch = firstLine[i];
    if (inQuotes) {
      if (ch === '"') {
        if (firstLine[i + 1] === '"') i += 1;
        else inQuotes = false;
      }
      continue;
    }
    if (ch === '"') inQuotes = true;
    else if (ch === '\t') tab += 1;
    else if (ch === ';') semicolon += 1;
    else if (ch === ',') comma += 1;
  }

  // A tab is what every spreadsheet puts on the clipboard; it wins outright.
  if (tab > 0) return '\t';
  if (semicolon === 0 && comma === 0) return '\t';
  // Ties go to `;` — what vi-VN Excel writes (see `lib/csv.ts`).
  return semicolon >= comma ? ';' : ',';
}

// ── Field parsers ───────────────────────────────────────────────────────────

export type DayParse = { ok: true; day: string } | { ok: false; error: string };

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/;
const DAY_FIRST = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})(?:[T ]\d{1,2}:\d{2}(?::\d{2})?)?$/;

function dayOf(year: number, month: number, day: number): DayParse {
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return { ok: false, error: 'Ngày không hợp lệ' };
  }
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return { ok: false, error: 'Ngày không hợp lệ' };
  }
  const pad = (n: number) => String(n).padStart(2, '0');
  return { ok: true, day: `${year}-${pad(month)}-${pad(day)}` };
}

/**
 * Parse a pasted purchase date to `YYYY-MM-DD` (decision 5). Never guesses: an
 * unrecognised shape — including a two-digit year — is an error the user can
 * see, not a silently different calendar day.
 */
export function parsePasteDate(raw: string): DayParse {
  const value = raw.trim();
  if (value === '') return { ok: false, error: 'Thiếu ngày mua' };

  const iso = ISO_DAY.exec(value);
  if (iso) {
    const parsed = dayOf(Number(iso[1]), Number(iso[2]), Number(iso[3]));
    return parsed.ok ? parsed : { ok: false, error: `Ngày mua không hợp lệ: "${value}"` };
  }

  const dayFirst = DAY_FIRST.exec(value);
  if (dayFirst) {
    const parsed = dayOf(Number(dayFirst[3]), Number(dayFirst[2]), Number(dayFirst[1]));
    return parsed.ok ? parsed : { ok: false, error: `Ngày mua không hợp lệ: "${value}"` };
  }

  return { ok: false, error: `Ngày mua không hợp lệ: "${value}" (dùng dd/MM/yyyy)` };
}

export type PriceParse = { value: number; warning?: string };

const PRICE_SUFFIXES: ReadonlyArray<[RegExp, number]> = [
  [/^(tr|triệu|trieu|m|million|mil)$/i, 1_000_000],
  [/^(k|nghìn|nghin|ngàn|ngan|thousand)$/i, 1_000],
];

/**
 * Parse a pasted price into whole đồng (decision 6). `''` ⇒ 0 = "chưa ghi giá".
 * An unreadable or negative value is 0 **with a warning**, never an invention.
 */
export function parsePastePrice(raw: string): PriceParse {
  const original = raw.trim();
  if (original === '') return { value: 0 };

  const cleaned = original
    .replace(/vnđ|vnd|₫|đ/gi, '')
    .replace(/[\s\u00a0]/g, '');
  if (cleaned === '') return { value: 0 };
  if (cleaned.startsWith('-')) {
    return { value: 0, warning: `Giá không hợp lệ: "${original}" — tạm để 0` };
  }

  let numberPart = cleaned;
  let multiplier = 1;
  const trailingLetters = /^(.*?)([a-zà-ỹ]+)$/iu.exec(cleaned);
  if (trailingLetters) {
    numberPart = trailingLetters[1];
    const suffix = trailingLetters[2];
    const match = PRICE_SUFFIXES.find(([re]) => re.test(suffix));
    if (!match) {
      return { value: 0, warning: `Không đọc được giá "${original}" — tạm để 0` };
    }
    multiplier = match[1];
  }

  const digits = numberPart.replace(/[^\d]/g, '');
  if (digits === '') {
    return { value: 0, warning: `Không đọc được giá "${original}" — tạm để 0` };
  }

  let amount: number;
  if (multiplier > 1) {
    const lastSeparator = Math.max(numberPart.lastIndexOf('.'), numberPart.lastIndexOf(','));
    const decimals = lastSeparator < 0 ? 0 : numberPart.length - lastSeparator - 1;
    const separatorCount = (numberPart.match(/[.,]/g) ?? []).length;
    // "15,5tr" / "1.5tr" are decimals; "1.500tr" is grouping.
    amount =
      separatorCount === 1 && decimals > 0 && decimals <= 2
        ? Number(numberPart.replace(',', '.'))
        : Number(digits);
  } else {
    amount = Number(digits);
  }

  if (!Number.isFinite(amount)) {
    return { value: 0, warning: `Không đọc được giá "${original}" — tạm để 0` };
  }

  return { value: Math.round(amount * multiplier) };
}

// ── Category matching ───────────────────────────────────────────────────────

export type CategoryMatch =
  | { kind: 'matched'; code: string }
  | { kind: 'blank'; code: string }
  | { kind: 'unknown' };

/**
 * Resolve a pasted category cell to a catalog code. Matched by code or by label
 * (diacritic-insensitive); the static `CATEGORY_LABELS` mirror is a fallback so
 * the import still works when the catalog read came back empty. A blank cell is
 * `'blank'` (caller applies the default + a warning), an unrecognised value is
 * `'unknown'` — a blocking error, never a silent remap (decision 7).
 */
export function matchCategory(
  raw: string,
  categories: readonly CategoryOption[],
): CategoryMatch {
  const value = raw.trim();
  const defaultCode =
    categories.find((c) => c.code === 'OTHER')?.code ?? categories[0]?.code ?? 'OTHER';
  if (value === '') return { kind: 'blank', code: defaultCode };

  const wanted = normalizeKey(value);
  for (const c of categories) {
    if (normalizeKey(c.code) === wanted || normalizeKey(c.name) === wanted) {
      return { kind: 'matched', code: c.code };
    }
  }
  for (const [code, label] of Object.entries(CATEGORY_LABELS)) {
    if (normalizeKey(code) === wanted || normalizeKey(label) === wanted) {
      return { kind: 'matched', code };
    }
  }
  return { kind: 'unknown' };
}

/** Vietnamese label for a code, falling back to the code for unknown catalogs. */
export function categoryLabelFor(
  code: string,
  categories: readonly CategoryOption[],
): string {
  return (
    categories.find((c) => c.code === code)?.name ??
    CATEGORY_LABELS[code] ??
    code
  );
}

/**
 * The `POST /api/v1/devices` body for one parsed row. Pure and unit-tested so
 * the server action stays a thin proxy.
 *
 * Deliberately absent:
 *   - `status`: the server defaults it to ACTIVE (services.ValidateDeviceInput);
 *     the paste format has no status column, and guessing one here is exactly
 *     the silent-wrong-device failure mode this parser avoids.
 *   - `soldAt`/`soldPrice`, `returnWindowDays`/`receivedAt`: not applicable to a
 *     device being created for the first time.
 *   - `warrantyMonths`: absent ⇒ 0 ⇒ no inline warranty package is created. The
 *     paste has no warranty columns and the UI says so.
 */
export function pasteDraftToInput(draft: PasteDraft): DeviceInput {
  return {
    name: draft.name,
    category: draft.category,
    brand: draft.brand,
    model: draft.model,
    serialNumber: draft.serialNumber,
    purchaseDate: draft.purchaseDate,
    purchasePrice: draft.purchasePrice,
    purchasePlace: draft.purchasePlace,
    notes: draft.notes,
  };
}

// ── The parser ──────────────────────────────────────────────────────────────

export type ParsePasteOptions = {
  categories: readonly CategoryOption[];
  headerMode?: PasteHeaderMode;
  maxRows?: number;
};

function headerField(label: string): PasteField | null {
  return HEADER_ALIASES[normalizeKey(label)] ?? null;
}

function ignoredHeaderLabel(label: string): string | null {
  return IGNORED_HEADER_ALIASES[normalizeKey(label)] ?? null;
}

/**
 * True when the first row should be read as a header (decision 3): at least two
 * cells match a known label. One match is a coincidence ("Ngày" as a value), two
 * in the same row is a header.
 */
export function looksLikeHeader(cells: readonly string[]): boolean {
  let matches = 0;
  for (const cell of cells) {
    const key = normalizeKey(cell);
    if (key !== '' && (HEADER_ALIASES[key] || IGNORED_HEADER_ALIASES[key])) {
      matches += 1;
    }
  }
  return matches >= 2;
}

function cellAt(cells: readonly string[], index: number): string {
  return index < cells.length ? cells[index] : '';
}

function blankToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Turn pasted text into a preview: the detected shape, one entry per data row
 * (with its errors/warnings), and the counts the UI needs to say "sẽ tạo X, bỏ
 * qua Y" before anything is written.
 */
export function parsePasteImport(
  text: string,
  opts: ParsePasteOptions,
): PasteImportPreview {
  const empty: PasteImportPreview = {
    delimiter: '\t',
    delimiterLabel: DELIMITER_LABELS['\t'],
    headerDetected: false,
    headerCells: null,
    columns: [],
    ignoredColumns: [],
    notes: [],
    rows: [],
    validCount: 0,
    skippedCount: 0,
    truncated: false,
    empty: true,
  };

  const raw = stripBom(text);
  if (raw.trim() === '') return empty;

  const delimiter = detectPasteDelimiter(raw);
  const records = splitRecords(raw, delimiter).filter((r) =>
    r.cells.some((c) => c.trim() !== ''),
  );
  if (records.length === 0) return empty;

  const headerMode = opts.headerMode ?? 'auto';
  const headerRow =
    headerMode === 'yes'
      ? records[0]
      : headerMode === 'no'
        ? null
        : looksLikeHeader(records[0].cells)
          ? records[0]
          : null;
  const dataRecords = headerRow ? records.slice(1) : records;

  const notes: string[] = [];
  const ignoredColumns: string[] = [];
  let columns: PasteColumn[];

  if (headerRow) {
    const used = new Map<PasteField, number>();
    columns = headerRow.cells.map((rawLabel, index) => {
      const header = rawLabel.trim();
      const field = headerField(rawLabel);
      if (field == null) {
        const ignored = ignoredHeaderLabel(rawLabel);
        if (header !== '') ignoredColumns.push(ignored ?? header);
        return { index, header, field: null };
      }
      if (used.has(field)) {
        notes.push(
          `Cột "${header || PASTE_FIELD_LABELS[field]}" bị trùng — chỉ dùng cột đầu tiên.`,
        );
        ignoredColumns.push(header || PASTE_FIELD_LABELS[field]);
        return { index, header, field: null };
      }
      used.set(field, index);
      return { index, header, field };
    });
  } else {
    const width = dataRecords.reduce((max, r) => Math.max(max, r.cells.length), 0);
    columns = Array.from({ length: Math.min(width, PASTE_FIELDS.length) }, (_, index) => ({
      index,
      header: '',
      field: PASTE_FIELDS[index],
    }));
    if (width <= 1) {
      notes.push(
        'Không thấy dấu phân cách (tab, ; hoặc ,) — mỗi dòng đang chỉ có 1 cột.',
      );
    }
  }

  const maxRows = opts.maxRows ?? PASTE_MAX_ROWS;
  const truncated = dataRecords.length > maxRows;
  const rows: PasteRow[] = [];

  for (const record of dataRecords.slice(0, maxRows)) {
    const errors: string[] = [];
    const warnings: string[] = [];

    const valueOf = (field: PasteField): string => {
      const column = columns.find((c) => c.field === field);
      return column ? cellAt(record.cells, column.index) : '';
    };

    const name = valueOf('name').trim();
    if (name === '') errors.push('Thiếu tên thiết bị');

    const dateRaw = valueOf('purchaseDate');
    const date = parsePasteDate(dateRaw);
    if (!date.ok) errors.push(date.error);

    const categoryRaw = valueOf('category');
    const category = matchCategory(categoryRaw, opts.categories);
    if (category.kind === 'unknown') {
      errors.push(`Loại không có trong danh mục: "${categoryRaw.trim()}"`);
    } else if (category.kind === 'blank') {
      warnings.push(
        `Chưa ghi loại — dùng "${categoryLabelFor(category.code, opts.categories)}"`,
      );
    }

    const price = parsePastePrice(valueOf('purchasePrice'));
    if (price.warning) warnings.push(price.warning);

    // Extra cells beyond the mapped columns are ignored, visibly (decision 4).
    // (`columns` always covers every header column, and in positional mode the
    // first `PASTE_FIELDS.length` ones, so "beyond" is just the tail.)
    const extra = record.cells.filter((_, i) => i >= columns.length);
    if (extra.length > 0) {
      warnings.push(`Thừa ${extra.length} ô so với bảng — phần thừa bị bỏ qua`);
    }

    const draft: PasteDraft | null =
      errors.length === 0 && date.ok
        ? {
            name,
            category: category.kind === 'unknown' ? '' : category.code,
            brand: blankToNull(valueOf('brand')),
            model: blankToNull(valueOf('model')),
            serialNumber: blankToNull(valueOf('serialNumber')),
            purchaseDate: date.day,
            purchasePrice: price.value,
            purchasePlace: blankToNull(valueOf('purchasePlace')),
            notes: blankToNull(valueOf('notes')),
          }
        : null;

    rows.push({ line: record.line, cells: record.cells, name, draft, errors, warnings });
  }

  return {
    delimiter,
    delimiterLabel: DELIMITER_LABELS[delimiter],
    headerDetected: headerRow != null,
    headerCells: headerRow ? headerRow.cells.map((c) => c.trim()) : null,
    columns,
    ignoredColumns,
    notes,
    rows,
    validCount: rows.filter((r) => r.draft != null).length,
    skippedCount: rows.filter((r) => r.draft == null).length,
    truncated,
    empty: false,
  };
}
