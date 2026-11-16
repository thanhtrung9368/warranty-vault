// Pure helpers for the warranty-card scan: upload-first AI extraction of the
// nine contract terms (FEATURE_RESEARCH_2026-11 §6.3).
//
// The endpoint is the contract-term sibling of receipt OCR:
//
//   POST /api/v1/ai/extract-warranty-card  body { attachmentId }  (JSON only)
//
// It never creates a Warranty or a Device. The only write it performs is the
// transcript on the attachment (`Attachment.extractedText`), which is why the
// file must be uploaded first — exactly like `lib/receipt-scan.ts`:
//
//   1. POST /v1/attachments with NO deviceId → an inbox item;
//   2. POST /v1/ai/extract-warranty-card { attachmentId } → the draft.
//
// A failed extraction keeps the upload in the inbox (the bytes are the thing the
// user cannot re-create); the component says so instead of deleting it.
//
// The MERGE RULE is the important half, and the web implements the same rule as
// the iOS `WarrantyCardRules.merge`:
//
//   * an empty form field is filled from the card;
//   * a field the user already filled is NEVER overwritten — a difference is
//     reported as "Trên thẻ: …";
//   * nothing is saved automatically.
//
// This module must stay free of React, Next and the API client so the rule and
// the copy can be reasoned about without a backend.

import { translate } from '@/lib/i18n/catalog';
import type { Locale } from '@/lib/i18n/locale';

/** Body of `POST /v1/ai/extract-warranty-card`. */
export type ExtractWarrantyCardBody = { attachmentId: string };

/** The nine contract fields, in the order the form renders them. */
export const WARRANTY_CARD_FIELDS = [
  'component',
  'scope',
  'cap',
  'deductible',
  'exclusions',
  'region',
  'transferable',
  'claimsAllowed',
  'claimsUsed',
] as const;

export type WarrantyCardField = (typeof WARRANTY_CARD_FIELDS)[number];

/**
 * Row labels. Every value is an existing dictionary key (the same label the
 * form renders above the input), so the scan result and the field it fills
 * cannot drift apart. `translate` returns the key verbatim when a label has no
 * English entry — still the correct Vietnamese sentence, never an identifier.
 */
export const WARRANTY_CARD_FIELD_LABELS: Record<WarrantyCardField, string> = {
  component: 'Bộ phận',
  scope: 'Phạm vi bảo hành',
  cap: 'Mức chi trả tối đa',
  deductible: 'Khấu trừ mỗi lần',
  exclusions: 'Loại trừ',
  region: 'Khu vực áp dụng',
  transferable: 'Chuyển nhượng được',
  claimsAllowed: 'Số lượt yêu cầu tối đa',
  claimsUsed: 'Số lượt đã dùng',
};

export type WarrantyCardWarning = {
  code: string;
  field: string;
  message: string;
};

/**
 * `WarrantyCardDraft` from openapi.yaml. Every scalar is nullable: null means
 * "the card does not say" (or the server dropped the value). There is no `type`,
 * `months` or date — the server never infers those from a paper card.
 */
export type WarrantyCardDraft = {
  component: string | null;
  scope: string | null;
  cap: number | null;
  deductible: number | null;
  exclusions: string | null;
  region: string | null;
  transferable: boolean | null;
  claimsAllowed: number | null;
  claimsUsed: number | null;
  confidence: 'high' | 'medium' | 'low';
  unmatched: string[];
  warnings: WarrantyCardWarning[];
  extractedTextStored: boolean;
};

/** The same nine fields as the form currently holds them. */
export type WarrantyCardValues = {
  component?: string;
  scope?: string;
  cap?: number;
  deductible?: number;
  exclusions?: string;
  region?: string;
  transferable?: boolean;
  claimsAllowed?: number;
  claimsUsed?: number;
};

export type WarrantyCardMismatch = {
  field: WarrantyCardField;
  label: string;
  /** The value read from the card, already formatted for display. */
  cardValue: string;
};

export type WarrantyCardMerge = {
  /** Only the values to write: fields that were empty and are non-null. */
  filled: WarrantyCardValues;
  /** Fields kept from the user because they were already filled differently. */
  mismatches: WarrantyCardMismatch[];
};

/**
 * Build the JSON body. A blank id returns `null` rather than `{ attachmentId: '' }`:
 * an empty id can only mean the upload result was malformed, and the server
 * answers 400 for it.
 */
export function buildExtractWarrantyCardBody(
  attachmentId: string | null | undefined,
): ExtractWarrantyCardBody | null {
  const id = (attachmentId ?? '').trim();
  return id === '' ? null : { attachmentId: id };
}

function asString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function asInt(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (!Number.isInteger(value) || value < 0) return null;
  return value;
}

/**
 * Coerce whatever the API sent into a clean draft.
 *
 * Unknown confidence degrades to `low` (a draft whose certainty cannot be
 * classified must not look more certain), missing arrays to `[]`, and a
 * non-integer/negative number to null — the same dispositions the Go sanitizer
 * already enforces, repeated so a malformed or older payload can never crash the
 * form or invent a value.
 */
export function normalizeWarrantyCardDraft(raw: unknown): WarrantyCardDraft {
  const d = (raw ?? {}) as Record<string, unknown>;
  const confidence =
    d.confidence === 'high' || d.confidence === 'medium' || d.confidence === 'low'
      ? d.confidence
      : 'low';
  const warnings: WarrantyCardWarning[] = Array.isArray(d.warnings)
    ? d.warnings.flatMap((item) => {
        if (!item || typeof item !== 'object') return [];
        const w = item as Record<string, unknown>;
        const message = asString(w.message);
        if (!message) return [];
        return [
          {
            code: asString(w.code) ?? 'UNKNOWN',
            field: asString(w.field) ?? '',
            message,
          },
        ];
      })
    : [];
  return {
    component: asString(d.component),
    scope: asString(d.scope),
    cap: asInt(d.cap),
    deductible: asInt(d.deductible),
    exclusions: asString(d.exclusions),
    region: asString(d.region),
    transferable: typeof d.transferable === 'boolean' ? d.transferable : null,
    claimsAllowed: asInt(d.claimsAllowed),
    claimsUsed: asInt(d.claimsUsed),
    confidence,
    unmatched: Array.isArray(d.unmatched)
      ? d.unmatched.flatMap((item) => {
          const value = asString(item);
          return value ? [value] : [];
        })
      : [],
    warnings,
    extractedTextStored: d.extractedTextStored === true,
  };
}

/** The nine values of a draft, trimmed, in the form's shape. */
export function warrantyCardValuesFromDraft(draft: WarrantyCardDraft): WarrantyCardValues {
  const values: WarrantyCardValues = {};
  if (draft.component) values.component = draft.component;
  if (draft.scope) values.scope = draft.scope;
  if (draft.cap != null) values.cap = draft.cap;
  if (draft.deductible != null) values.deductible = draft.deductible;
  if (draft.exclusions) values.exclusions = draft.exclusions;
  if (draft.region) values.region = draft.region;
  if (draft.transferable != null) values.transferable = draft.transferable;
  if (draft.claimsAllowed != null) values.claimsAllowed = draft.claimsAllowed;
  if (draft.claimsUsed != null) values.claimsUsed = draft.claimsUsed;
  return values;
}

/** Money uses the app's grouped đồng shape; count/bool use plain copy. */
export function formatWarrantyCardValue(
  field: WarrantyCardField,
  values: WarrantyCardValues,
  locale: Locale,
): string | undefined {
  switch (field) {
    case 'component':
      return values.component;
    case 'scope':
      return values.scope;
    case 'cap':
      return values.cap != null ? formatMoney(values.cap, locale) : undefined;
    case 'deductible':
      return values.deductible != null ? formatMoney(values.deductible, locale) : undefined;
    case 'exclusions':
      return values.exclusions;
    case 'region':
      return values.region;
    case 'transferable':
      if (values.transferable == null) return undefined;
      return translate(locale, values.transferable ? 'Có' : 'Không');
    case 'claimsAllowed':
      return values.claimsAllowed != null ? String(values.claimsAllowed) : undefined;
    case 'claimsUsed':
      return values.claimsUsed != null ? String(values.claimsUsed) : undefined;
  }
}

function formatMoney(amount: number, locale: Locale): string {
  const grouped = new Intl.NumberFormat(locale === 'vi' ? 'vi-VN' : 'en-US', {
    maximumFractionDigits: 0,
  }).format(amount);
  return locale === 'vi' ? `${grouped} ₫` : `₫${grouped}`;
}

/**
 * Merge a draft into what the form already holds.
 *
 * `claimsUsed` needs one documented exception on the web: the form's default is
 * `0` (the wire default, "not recorded"), so a literal `0` is treated as empty
 * and CAN be filled from the card. An explicit non-zero user value is kept and a
 * difference becomes a mismatch. On iOS the field is a blank string when empty,
 * so the shared rule needs no exception there; this is the one place the two
 * clients' form defaults differ.
 */
export function mergeWarrantyCardDraft(
  draft: WarrantyCardDraft,
  current: WarrantyCardValues,
  locale: Locale = 'vi',
): WarrantyCardMerge {
  const card = warrantyCardValuesFromDraft(draft);
  const filled: WarrantyCardValues = {};
  const mismatches: WarrantyCardMismatch[] = [];

  const isEmpty = (field: WarrantyCardField): boolean => {
    const value = current[field];
    if (field === 'claimsUsed') return value == null || value === 0;
    return value == null;
  };

  for (const field of WARRANTY_CARD_FIELDS) {
    const cardValue = card[field];
    if (cardValue == null) continue;
    if (isEmpty(field)) {
      // Assignment through a narrow cast is safe: the key is the same field, and
      // `card[field]` has already been narrowed to its non-null form.
      (filled as Record<string, unknown>)[field] = cardValue;
      continue;
    }
    if (current[field] !== cardValue) {
      const display = formatWarrantyCardValue(field, card, locale);
      if (display != null) {
        mismatches.push({
          field,
          label: translate(locale, WARRANTY_CARD_FIELD_LABELS[field]),
          cardValue: display,
        });
      }
    }
  }

  return { filled, mismatches };
}

/** One row per non-empty term, for the "what was read" list. */
export function warrantyCardDraftSummary(
  draft: WarrantyCardDraft,
  locale: Locale,
): { field: WarrantyCardField; label: string; value: string }[] {
  const values = warrantyCardValuesFromDraft(draft);
  const out: { field: WarrantyCardField; label: string; value: string }[] = [];
  for (const field of WARRANTY_CARD_FIELDS) {
    const value = formatWarrantyCardValue(field, values, locale);
    if (value == null) continue;
    out.push({ field, label: translate(locale, WARRANTY_CARD_FIELD_LABELS[field]), value });
  }
  return out;
}

/** The `unmatched[]` fields as labels, for the "you type these" note. */
export function warrantyCardUnmatchedLabels(
  draft: WarrantyCardDraft,
  locale: Locale,
): string[] {
  return draft.unmatched.map((raw) => {
    const field = WARRANTY_CARD_FIELDS.find((f) => f === raw.trim());
    return field ? translate(locale, WARRANTY_CARD_FIELD_LABELS[field]) : raw.trim();
  });
}

/** The file landed in the inbox; extraction succeeded or failed. */
export function warrantyCardInboxNotice(stored: boolean, locale: Locale): string {
  if (stored) {
    return translate(
      locale,
      'Thẻ đã được lưu trong Hộp thư — bạn có thể gán vào một thiết bị sau. Nội dung đọc được cũng đã được lưu để tìm kiếm.',
    );
  }
  return translate(
    locale,
    'Thẻ đã được lưu trong Hộp thư — bạn có thể gán vào một thiết bị sau. Lần này chưa lưu được nội dung đọc để tìm kiếm.',
  );
}

/** Upload landed but extraction failed. The file is still there; say so. */
export function warrantyCardFailureNotice(locale: Locale): string {
  return translate(
    locale,
    'Không đọc được thẻ bảo hành, nhưng file vẫn được lưu trong Hộp thư — mở Hộp thư để gán vào một thiết bị.',
  );
}

/** Shown above the scan result. */
export function warrantyCardDraftHeading(confidence: WarrantyCardDraft['confidence'], locale: Locale): string {
  return confidence === 'high'
    ? translate(locale, 'Đã đọc thẻ — kiểm tra lại trước khi lưu')
    : translate(locale, 'Đã đọc thẻ — độ tin cậy chưa cao, kiểm tra kỹ');
}
