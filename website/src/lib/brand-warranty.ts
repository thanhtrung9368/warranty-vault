// Brand warranty lookup + mismatch copy (pure).
//
// The problem this file exists for: the warranty start date the user typed is a
// GUESS from the invoice, while the brand's own system holds the date it
// actually activated. The two disagree for perfectly ordinary reasons — a
// grey-market import activated months earlier, a shop that pre-activated the
// handset, a repaired unit re-registered by the service centre. The user thinks
// eight months are left; the brand's counter says it expired last week.
//
// So the API exposes the brand answer (five nullable fields) and a computed
// read-only `warrantyMismatch` on every device read. This module is the
// client-side brain for both, kept pure (no React, no network, no cookies) so
// the copy and the date arithmetic are unit-tested rather than eyeballed:
//
//   * `brandWarrantyStatusLabel` / `brandWarrantyStatusHint` — the five statuses;
//   * `mismatchCopy` — one plain-language sentence per mismatch kind, with the
//     number of days and BOTH dates;
//   * `brandAgreementLine` — "no mismatch" is information too, and is stated
//     only when the server actually computed a null mismatch;
//   * `brandLookupState` — the URL when the brand has one, and a plain "we do
//     not have this brand's lookup page" when it does not. NEVER a guessed URL;
//   * `brandWarrantyIssueList` — the frozen validation rules, checked before a
//     round-trip (Go remains the authority);
//   * date arithmetic: span in days, relative "checked at" copy, and the
//     mismatch day count.
//
// ── Bilingual ─────────────────────────────────────────────────────────────
//
// Pure module, so no `useT()`. Every selector takes a `locale` and renders its
// sentence through `translate()`. Exported constants keep the Vietnamese
// ORIGINAL (they are the dictionary keys); the UI wraps them in `t()` only when
// it renders them directly.

import { differenceInCalendarDays } from 'date-fns';
import { parseDayValue } from './api-day';
import { formatDate, formatRelativeDay } from './format';
import { safeExternalUrl } from './service-directory';
import { translate } from '@/lib/i18n/catalog';
import type { Locale } from '@/lib/i18n/locale';

// ---- Wire shapes -------------------------------------------------------------

export type BrandWarrantyStatus =
  | 'ACTIVE'
  | 'EXPIRED'
  | 'NOT_REGISTERED'
  | 'PRE_ACTIVATED'
  | 'UNKNOWN';

export const BRAND_WARRANTY_STATUSES = [
  'ACTIVE',
  'EXPIRED',
  'NOT_REGISTERED',
  'PRE_ACTIVATED',
  'UNKNOWN',
] as const satisfies readonly BrandWarrantyStatus[];

export type WarrantyMismatchKind =
  | 'STARTS_BEFORE'
  | 'STARTS_AFTER'
  | 'ENDED_EARLIER'
  | 'ENDED_LATER';

export const WARRANTY_MISMATCH_KINDS = [
  'STARTS_BEFORE',
  'STARTS_AFTER',
  'ENDED_EARLIER',
  'ENDED_LATER',
] as const satisfies readonly WarrantyMismatchKind[];

/**
 * Computed by the server on every device read; `null` when the two sides agree
 * (or when there is nothing comparable yet).
 *
 * `days` is the size of the gap, always non-negative. `brandDate` is the date on
 * the brand's side of the comparison (the brand start for `STARTS_*`, the brand
 * end for `ENDED_*`); `purchaseDate` is the date on OUR side. The UI labels both
 * neutrally ("the brand records" / "you record") so the same block is correct
 * for all four kinds without pretending to know more than the payload says.
 */
export type WarrantyMismatch = {
  kind: WarrantyMismatchKind;
  days: number;
  brandDate: string;
  purchaseDate: string;
};

/** The five nullable brand fields, in form-friendly form. */
export type BrandWarrantyValues = {
  status: BrandWarrantyStatus | null;
  start: string | null;
  end: string | null;
  checkedAt: string | null;
  url: string | null;
};

/** Structural subset of `Device` these helpers read. */
export type BrandWarrantyAnswerSource = {
  brandWarrantyStatus?: string | null;
  brandWarrantyStart?: string | null;
  brandWarrantyEnd?: string | null;
  brandCheckedAt?: string | null;
  brandLookupUrl?: string | null;
  warrantyMismatch?: unknown;
  purchaseDate?: string | null;
};

// ---- Status ------------------------------------------------------------------

/**
 * Vietnamese originals. These are catalog keys, so the English column lives in
 * `lib/i18n/messages/brand-warranty.ts` — never retyped here.
 */
export const BRAND_WARRANTY_STATUS_LABELS: Record<BrandWarrantyStatus, string> = {
  ACTIVE: 'Hãng ghi đang còn bảo hành',
  EXPIRED: 'Hãng ghi đã hết bảo hành',
  NOT_REGISTERED: 'Hãng chưa ghi nhận bảo hành',
  PRE_ACTIVATED: 'Hãng ghi đã kích hoạt trước',
  UNKNOWN: 'Hãng ghi chưa rõ',
};

/** One sentence explaining what each status means in practice. */
export const BRAND_WARRANTY_STATUS_HINTS: Record<BrandWarrantyStatus, string> = {
  ACTIVE: 'Hệ thống của hãng đang ghi nhận bảo hành còn hiệu lực.',
  EXPIRED: 'Hệ thống của hãng ghi bảo hành đã hết hạn.',
  NOT_REGISTERED:
    'Hãng không tìm thấy serial này trong hệ thống bảo hành — máy có thể chưa được kích hoạt hoặc mua ngoài kênh chính thức.',
  PRE_ACTIVATED:
    'Hãng ghi bảo hành đã bắt đầu trước ngày bạn mua — thường là máy được kích hoạt sẵn.',
  UNKNOWN: 'Hãng có trả lời nhưng không nói rõ trạng thái.',
};

export function normalizeBrandWarrantyStatus(
  value: unknown,
): BrandWarrantyStatus | null {
  return typeof value === 'string' &&
    (BRAND_WARRANTY_STATUSES as readonly string[]).includes(value)
    ? (value as BrandWarrantyStatus)
    : null;
}

export function brandWarrantyStatusLabel(
  status: string | null | undefined,
  locale: Locale,
): string | null {
  const normalized = normalizeBrandWarrantyStatus(status);
  if (!normalized) return null;
  return translate(locale, BRAND_WARRANTY_STATUS_LABELS[normalized]);
}

export function brandWarrantyStatusHint(
  status: string | null | undefined,
  locale: Locale,
): string | null {
  const normalized = normalizeBrandWarrantyStatus(status);
  if (!normalized) return null;
  return translate(locale, BRAND_WARRANTY_STATUS_HINTS[normalized]);
}

// ---- Small pure primitives ---------------------------------------------------

function clean(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/** `null` for an absent/unparseable date, so no card ever prints "Invalid Date". */
function dateObj(value: unknown): Date | null {
  const raw = clean(value);
  if (!raw) return null;
  // A bare `YYYY-MM-DD` is a CALENDAR DAY (the contract's mismatch dates are
  // `format: date`), anchored at LOCAL midnight by `parseDayValue`.
  // `new Date('2026-01-10')` is UTC midnight and renders as the previous day in
  // a negative-offset timezone. The helper also accepts the server-derived
  // UTC-midnight instant, so a field that changes shape cannot shift the card.
  return parseDayValue(raw);
}

function dateText(value: unknown, locale: Locale): string | null {
  const date = dateObj(value);
  if (!date) return null;
  return formatDate(date, locale);
}

/**
 * Days between two dates at calendar-day resolution. `null` when either date is
 * unusable; negative when `end` precedes `start` (the caller decides — the
 * contract rejects that pair, but legacy data may still contain it).
 */
export function brandWarrantySpanDays(
  start: string | null | undefined,
  end: string | null | undefined,
): number | null {
  const from = dateObj(start);
  const to = dateObj(end);
  if (!from || !to) return null;
  return differenceInCalendarDays(to, from);
}

/**
 * "The brand records {days} days of cover." — the date arithmetic the detail
 * page shows next to the brand's two dates. `null` when either date is missing
 * or the pair is inverted, so the card can simply omit the line.
 */
export function brandWarrantySpanLabel(
  start: string | null | undefined,
  end: string | null | undefined,
  locale: Locale,
): string | null {
  const days = brandWarrantySpanDays(start, end);
  if (days === null || days < 0) return null;
  return translate(locale, 'Hãng ghi bảo hành kéo dài {days} ngày.', {
    days,
    count: days,
  });
}

/**
 * When the owner last checked the brand's system, relative to `now` (injectable
 * so the test never depends on the machine clock). Missing → the honest "never
 * checked" line; unparseable → `null` (say nothing rather than lie).
 */
/**
 * `pgtype.Timestamp` values (including `brandCheckedAt`) are serialised Z-less
 * because the column is `timestamp without time zone`, and the Go service stores
 * them at UTC. Parsing such a string with `new Date()` would treat it as LOCAL
 * and shift the instant by the viewer's offset — enough to make a check at 00:30
 * read "yesterday". Absolute values keep their own offset.
 */
function utcDateObj(value: unknown): Date | null {
  const raw = clean(value);
  if (!raw) return null;
  const date = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(raw)
    ? new Date(`${raw}Z`)
    : dateObj(raw);
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

export function brandCheckedAtLabel(
  checkedAt: string | null | undefined,
  locale: Locale,
  now: Date = new Date(),
): string | null {
  const raw = clean(checkedAt);
  if (!raw) return translate(locale, 'Chưa đối chiếu với hãng lần nào.');
  const date = utcDateObj(raw);
  if (!date) return null;
  return translate(locale, 'Đã đối chiếu {when}.', {
    when: formatRelativeDay(date, locale, now),
  });
}

/**
 * `YYYY-MM-DD` for a wire date, or `null`.
 *
 * The Go service serialises timestamps WITHOUT an offset and, depending on the
 * stored precision, with fractional seconds (`2026-04-07T09:00:00.123456`). Its
 * `parseDate` accepts that shape only for the no-fraction layout, so a
 * verbatim round-trip of a stored value can be rejected with a 400. Brand dates
 * are day-level anyway: normalising to the leading calendar day keeps the write
 * valid and does not change the meaning.
 */
export function brandWarrantyDateOnly(
  value: string | null | undefined,
): string | null {
  const raw = clean(value);
  if (!raw) return null;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(raw);
  if (match) return match[1] ?? null;
  const date = dateObj(raw);
  if (!date) return null;
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * A timestamp string the Go service accepts for `brandCheckedAt`, or `null`.
 *
 * The value read back from the device is a Z-less `timestamp` — possibly with
 * fractional seconds — and Go's `parseDate` accepts the Z-less shape only at
 * second precision. Calling `toISOString()` would "fix" the format but also
 * reinterpret a wall-clock value as local time and shift the stored instant by
 * the browser's UTC offset. So the normalisation is textual: keep an already
 * absolute RFC3339 value, drop the fractional part of a Z-less one, and let an
 * unparseable value become `null` rather than a made-up timestamp.
 */
export function brandWarrantyTimestamp(
  value: string | null | undefined,
): string | null {
  const raw = clean(value);
  if (!raw) return null;
  // Already absolute and parseable by RFC3339/RFC3339Nano (the record action
  // sends exactly this shape).
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/.test(raw)) {
    return raw;
  }
  // Z-less with optional fractional seconds → drop the fraction, keeping the
  // wall-clock time exactly as the server serialised it.
  const zLess = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(\.\d+)?$/.exec(raw);
  if (zLess) return zLess[1] ?? null;
  // A bare day is a valid timestamp for Go (midnight) and for our forms.
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  return null;
}

// ---- Mismatch ----------------------------------------------------------------

/**
 * One sentence per kind. `{days}` is the gap; the English column supplies the
 * singular form for `count: 1` (Vietnamese never inflects).
 *
 * The wording is deliberately plain and non-alarmist: this is information, not
 * an error, and the user's own data is never presented as wrong.
 */
export const WARRANTY_MISMATCH_SENTENCES: Record<WarrantyMismatchKind, string> = {
  STARTS_BEFORE:
    'Hãng ghi bảo hành bắt đầu trước ngày mua {days} ngày — hoá đơn của bạn có thể không phải ngày kích hoạt.',
  STARTS_AFTER:
    'Hãng ghi bảo hành bắt đầu sau ngày mua {days} ngày — hoá đơn của bạn có thể đã được ghi sau khi máy kích hoạt.',
  ENDED_EARLIER:
    'Hãng ghi bảo hành kết thúc sớm hơn {days} ngày so với mốc bạn đang tính — đừng chờ tới ngày đó mới mang máy đi bảo hành.',
  ENDED_LATER:
    'Hãng ghi bảo hành kết thúc muộn hơn {days} ngày so với mốc bạn đang tính — máy có thể còn bảo hành lâu hơn bạn tưởng.',
};

export type MismatchCopy = {
  kind: WarrantyMismatchKind;
  /** Always non-negative; the server computes the magnitude. */
  days: number;
  /** Plain-language explanation with the day count. */
  sentence: string;
  brandDateLabel: string;
  purchaseDateLabel: string;
  /** Both dates in one line, formatted for the active language. */
  dateLine: string;
  /** "This is information, not an error." */
  note: string;
};

function nonNegativeDays(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.trunc(Math.abs(n)));
}

/**
 * Defensive read of the computed `warrantyMismatch`. A payload with no usable
 * kind is `null` (nothing to show); the dates are kept verbatim and formatted
 * only at render time. Used by pages so a slightly older server cannot crash the
 * detail card with a missing field.
 */
export function normalizeWarrantyMismatch(
  value: unknown,
): WarrantyMismatch | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const kind =
    typeof raw.kind === 'string' &&
    (WARRANTY_MISMATCH_KINDS as readonly string[]).includes(raw.kind)
      ? (raw.kind as WarrantyMismatchKind)
      : null;
  if (!kind) return null;
  return {
    kind,
    days: nonNegativeDays(raw.days),
    brandDate: clean(raw.brandDate) ?? '',
    purchaseDate: clean(raw.purchaseDate) ?? '',
  };
}

export function mismatchCopy(
  mismatch: WarrantyMismatch,
  locale: Locale,
): MismatchCopy {
  const days = nonNegativeDays(mismatch.days);
  const brandDate = dateText(mismatch.brandDate, locale) ?? '—';
  const purchaseDate = dateText(mismatch.purchaseDate, locale) ?? '—';
  // `purchaseDate` is the CONTRACT field name, not always the purchase date:
  // for `STARTS_*` it is `Device.purchaseDate`; for `ENDED_*` it is the app's
  // whole-unit warranty end (openapi `WarrantyMismatch`). The labels therefore
  // name what each side of THAT comparison is, kind by kind — a chip reading
  // "Bạn ghi 10/01/2026" next to a brand end date would be misleading.
  const starts = mismatch.kind === 'STARTS_BEFORE' || mismatch.kind === 'STARTS_AFTER';
  const brandDateLabel = starts
    ? translate(locale, 'Hãng ghi bắt đầu {date}', { date: brandDate })
    : translate(locale, 'Hãng ghi hết hạn {date}', { date: brandDate });
  const purchaseDateLabel = starts
    ? translate(locale, 'Bạn ghi ngày mua {date}', { date: purchaseDate })
    : translate(locale, 'Bạn đang tính hết hạn {date}', { date: purchaseDate });
  return {
    kind: mismatch.kind,
    days,
    sentence: translate(locale, WARRANTY_MISMATCH_SENTENCES[mismatch.kind], {
      days,
      count: days,
    }),
    brandDateLabel,
    purchaseDateLabel,
    dateLine: `${brandDateLabel} · ${purchaseDateLabel}`,
    note: translate(
      locale,
      'Đây là thông tin để đối chiếu, không phải lỗi — dữ liệu bạn đã nhập vẫn được giữ nguyên.',
    ),
  };
}

// ---- "No mismatch" and "not registered" --------------------------------------

/**
 * The agreement sentence, or `null` when the two sides do not (or cannot) agree.
 *
 * It is only rendered when `warrantyMismatch` is present-and-null: that is the
 * server saying it actually compared the dates. An absent key (an older server)
 * means "not computed", so the card stays quiet rather than claiming agreement
 * it cannot prove. A missing brand start date is likewise not agreement.
 */
export function brandAgreementLine(
  source: BrandWarrantyAnswerSource,
  locale: Locale,
): string | null {
  if (!Object.prototype.hasOwnProperty.call(source, 'warrantyMismatch')) return null;
  if (source.warrantyMismatch !== null) return null;
  const status = normalizeBrandWarrantyStatus(source.brandWarrantyStatus);
  if (!status || status === 'NOT_REGISTERED') return null;
  const start = dateText(source.brandWarrantyStart, locale);
  if (!start) return null;
  const end = dateText(source.brandWarrantyEnd, locale);
  return end
    ? translate(
        locale,
        'Không có lệch: hãng ghi bảo hành từ {start} đến {end}. Ngày bắt đầu trùng với mốc bạn đang tính.',
        { start, end },
      )
    : translate(
        locale,
        'Không có lệch: hãng ghi bảo hành bắt đầu {start}, trùng với mốc bạn đang tính.',
        { start },
      );
}

/**
 * The `NOT_REGISTERED` state has its own sentence: it is not a disagreement,
 * and it is not agreement either — the brand simply has no record.
 */
export function brandNotRegisteredLine(
  source: BrandWarrantyAnswerSource,
  locale: Locale,
): string | null {
  if (normalizeBrandWarrantyStatus(source.brandWarrantyStatus) !== 'NOT_REGISTERED') {
    return null;
  }
  return translate(
    locale,
    'Hãng chưa ghi nhận bảo hành cho serial này — hoá đơn của bạn vẫn là mốc duy nhất app có.',
  );
}

/**
 * The brand's two dates in one sentence, or `null` when nothing is recorded.
 * Used as the recorded-answer line under the status.
 */
export function brandWarrantyDatesLine(
  source: BrandWarrantyAnswerSource,
  locale: Locale,
): string | null {
  if (!normalizeBrandWarrantyStatus(source.brandWarrantyStatus)) return null;
  const start = dateText(source.brandWarrantyStart, locale);
  const end = dateText(source.brandWarrantyEnd, locale);
  if (start && end) {
    return translate(locale, 'Hãng ghi bảo hành từ {start} đến {end}.', { start, end });
  }
  if (start) return translate(locale, 'Hãng ghi bảo hành bắt đầu {start}.', { start });
  if (end) return translate(locale, 'Hãng ghi bảo hành kết thúc {end}.', { end });
  return translate(locale, 'Hãng không ghi ngày bảo hành cụ thể.');
}

// ---- Lookup link -------------------------------------------------------------

export type BrandLookupState =
  | { kind: 'no-brand'; title: string; detail: string; brandName: null; url: null }
  | { kind: 'no-url'; title: string; detail: string; brandName: string; url: null }
  | {
      kind: 'url';
      title: string;
      detail: string;
      brandName: string;
      url: string;
      linkLabel: string;
    };

/**
 * What the "Đối chiếu với hãng" block shows.
 *
 * The `no-url` branch is load-bearing: `warrantyLookupUrl` is null for part of
 * the catalogue, and the requirement is to say so PLAINLY. We never synthesise a
 * search URL or a vendor homepage — a wrong link is worse than no link, and the
 * detail would be a guess presented as fact.
 */
export function brandLookupState(
  source: { brandName?: string | null; lookupUrl?: string | null },
  locale: Locale,
): BrandLookupState {
  const brandName = clean(source.brandName);
  const url = safeExternalUrl(source.lookupUrl);
  if (!brandName) {
    return {
      kind: 'no-brand',
      title: translate(locale, 'Thiết bị chưa ghi hãng'),
      detail: translate(
        locale,
        'Thêm hãng cho thiết bị để app tìm trang tra cứu bảo hành của hãng đó.',
      ),
      brandName: null,
      url: null,
    };
  }
  if (!url) {
    return {
      kind: 'no-url',
      title: translate(locale, 'App không có trang tra cứu bảo hành của hãng này'),
      detail: translate(
        locale,
        'App chỉ dẫn link khi biết chắc đó là trang tra cứu chính thức của hãng. Với hãng này app không có link nào, nên bạn tự mở trang hỗ trợ của hãng — app không đoán URL.',
      ),
      brandName,
      url: null,
    };
  }
  return {
    kind: 'url',
    title: translate(locale, 'Trang tra cứu bảo hành của hãng'),
    detail: translate(
      locale,
      'Mở trang dưới đây, nhập serial/IMEI để xem ngày bảo hành hãng ghi. Xong thì quay lại ghi kết quả bên dưới.',
    ),
    brandName,
    url,
    linkLabel: translate(locale, 'Mở trang tra cứu của hãng'),
  };
}

// ---- Brand-name matching -----------------------------------------------------

type BrandRef = { id: string; name: string };
type ServiceInfoRef = {
  brandId: string;
  name: string;
  warrantyLookupUrl?: string | null;
};

/** Diacritic- and case-insensitive, whitespace-collapsed brand key. */
export function normalizeBrandName(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

export type BrandMatch = {
  brandId: string;
  name: string;
  lookupUrl: string | null;
};

/**
 * Resolve the device's free-text `brand` to ONE catalogue brand.
 *
 * The device stores a name, not a `Brand.id`, but the service-info endpoint is
 * keyed by id. Matching is exact after normalisation (case/diacritics/space) and
 * returns `null` when zero OR several brands match — the same "ambiguous ⇒ do
 * not guess" rule the Go service-directory endpoint documents. A miss simply
 * means the card falls into its honest "no lookup page for this brand" state.
 */
export function matchBrand(
  brandName: string | null | undefined,
  brands: BrandRef[] = [],
  serviceInfo: ServiceInfoRef[] = [],
): BrandMatch | null {
  const needle = normalizeBrandName(brandName);
  if (!needle) return null;

  const found = new Map<string, BrandMatch>();
  for (const brand of brands) {
    if (normalizeBrandName(brand.name) !== needle) continue;
    const info = serviceInfo.find((row) => row.brandId === brand.id);
    found.set(brand.id, {
      brandId: brand.id,
      name: brand.name,
      lookupUrl: safeExternalUrl(info?.warrantyLookupUrl ?? null),
    });
  }
  // The service-info rows carry their own brandId, and are the only source when
  // the brand catalogue is empty/older.
  for (const row of serviceInfo) {
    if (normalizeBrandName(row.name) !== needle) continue;
    if (found.has(row.brandId)) continue;
    found.set(row.brandId, {
      brandId: row.brandId,
      name: row.name,
      lookupUrl: safeExternalUrl(row.warrantyLookupUrl ?? null),
    });
  }
  if (found.size !== 1) return null;
  return [...found.values()][0] ?? null;
}

// ---- Validation (Go remains the authority) -----------------------------------

export type BrandWarrantyField =
  | 'brandWarrantyStatus'
  | 'brandWarrantyStart'
  | 'brandWarrantyEnd'
  | 'brandLookupUrl';

/**
 * Vietnamese originals; the action translates them through `t()`. Wording is
 * copied from the Go validator (`api/internal/services/brand_warranty.go`) so a
 * client-side pre-flight rejection and the server's own `fieldErrors` read as
 * the same sentence in both languages.
 */
export const BRAND_WARRANTY_ISSUE_KEYS = {
  invalidStatus: 'Trạng thái bảo hành hãng không hợp lệ',
  statusRequired:
    'Trạng thái bảo hành hãng bắt buộc khi đã ghi ngày hoặc link tra cứu',
  invalidStart: 'Ngày bắt đầu bảo hành hãng không hợp lệ',
  invalidEnd: 'Ngày hết hạn bảo hành hãng không hợp lệ',
  endBeforeStart: 'Ngày hết hạn bảo hành hãng không được trước ngày bắt đầu',
  invalidUrl: 'Link tra cứu bảo hành hãng phải là URL http/https tuyệt đối',
} as const;

export type BrandWarrantyDraft = {
  status: string | null;
  start: string | null;
  end: string | null;
  url: string | null;
};

export type BrandWarrantyIssue = { field: BrandWarrantyField; key: string };

/**
 * The three frozen rules, checked locally so a typo does not cost a round-trip:
 *
 *   1. status is required whenever another of the five is set;
 *   2. `brandWarrantyEnd` may not precede `brandWarrantyStart`;
 *   3. `brandLookupUrl` must be an absolute http(s) URL.
 *
 * A draft with EVERYTHING blank is a valid "erase the recorded answer" signal and
 * returns no issues. A blank status plus any other value is an error — silently
 * dropping the dates would be worse than asking for the status.
 */
export function brandWarrantyIssueList(
  draft: BrandWarrantyDraft,
): BrandWarrantyIssue[] {
  const rawStatus = clean(draft.status);
  const status = normalizeBrandWarrantyStatus(rawStatus);
  const start = clean(draft.start);
  const end = clean(draft.end);
  const url = clean(draft.url);

  // An unrecognised code is not a clear signal — it is junk the caller must not
  // silently turn into "no answer". The form's sentinel is normalized away before
  // this function is reached (see the action).
  if (rawStatus && !status) {
    return [{ field: 'brandWarrantyStatus', key: BRAND_WARRANTY_ISSUE_KEYS.invalidStatus }];
  }

  if (!status) {
    if (start || end || url) {
      return [{ field: 'brandWarrantyStatus', key: BRAND_WARRANTY_ISSUE_KEYS.statusRequired }];
    }
    return [];
  }

  const issues: BrandWarrantyIssue[] = [];
  const startDate = dateObj(start);
  const endDate = dateObj(end);
  if (start && !startDate) {
    issues.push({ field: 'brandWarrantyStart', key: BRAND_WARRANTY_ISSUE_KEYS.invalidStart });
  }
  if (end && !endDate) {
    issues.push({ field: 'brandWarrantyEnd', key: BRAND_WARRANTY_ISSUE_KEYS.invalidEnd });
  }
  if (startDate && endDate && endDate.getTime() < startDate.getTime()) {
    issues.push({ field: 'brandWarrantyEnd', key: BRAND_WARRANTY_ISSUE_KEYS.endBeforeStart });
  }
  if (url && !safeExternalUrl(url)) {
    issues.push({ field: 'brandLookupUrl', key: BRAND_WARRANTY_ISSUE_KEYS.invalidUrl });
  }
  return issues;
}

/** True when saving this draft means "remove the recorded brand answer". */
export function isBrandWarrantyDraftEmpty(draft: BrandWarrantyDraft): boolean {
  return (
    !normalizeBrandWarrantyStatus(draft.status) &&
    !clean(draft.start) &&
    !clean(draft.end) &&
    !clean(draft.url)
  );
}

// ---- Values <-> wire ---------------------------------------------------------

/** Read the five wire fields into the form-friendly shape (defensive). */
export function brandWarrantyValues(
  source: BrandWarrantyAnswerSource,
): BrandWarrantyValues {
  return {
    status: normalizeBrandWarrantyStatus(source.brandWarrantyStatus),
    start: clean(source.brandWarrantyStart),
    end: clean(source.brandWarrantyEnd),
    checkedAt: clean(source.brandCheckedAt),
    // The raw value is preserved for the input (a bad URL must stay visible so
    // the owner can fix it); `brandLookupState` applies the http(s) gate before
    // anything becomes an href.
    url: clean(source.brandLookupUrl),
  };
}

export type BrandWarrantyWriteFields = {
  brandWarrantyStatus: BrandWarrantyStatus | null;
  brandWarrantyStart: string | null;
  brandWarrantyEnd: string | null;
  brandCheckedAt: string | null;
  brandLookupUrl: string | null;
};

/**
 * The exact five keys to send on the wire.
 *
 * `checkedAt` is supplied by the caller: a new answer stamps "now"; a device-form
 * save that did not touch the brand fields passes the stored value through, so
 * editing the device name does not pretend the brand was re-checked.
 *
 * A blank status erases all five (status null ⇒ checkedAt/url also null), which
 * keeps the "status is required whenever another is set" rule satisfied even
 * when the request is the explicit clear signal.
 */
export function brandWarrantyWriteFields(
  values: BrandWarrantyValues,
  checkedAt: string | null,
): BrandWarrantyWriteFields {
  const status = normalizeBrandWarrantyStatus(values.status);
  if (!status) {
    return {
      brandWarrantyStatus: null,
      brandWarrantyStart: null,
      brandWarrantyEnd: null,
      brandCheckedAt: null,
      brandLookupUrl: null,
    };
  }
  return {
    brandWarrantyStatus: status,
    // Normalised (see the helpers above): the form's date inputs already send
    // `YYYY-MM-DD`, but the record action also round-trips stored values, and
    // the API parser rejects a Z-less timestamp that carries fractional seconds.
    brandWarrantyStart: brandWarrantyDateOnly(values.start),
    brandWarrantyEnd: brandWarrantyDateOnly(values.end),
    brandCheckedAt: brandWarrantyTimestamp(checkedAt),
    brandLookupUrl: safeExternalUrl(values.url),
  };
}
