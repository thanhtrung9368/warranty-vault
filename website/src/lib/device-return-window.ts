// Pure helpers for the return window ("hạn đổi/trả", migration 0010):
// `Device.returnWindowDays` + `Device.receivedAt`, and the derived
// `DeviceDetail.returnDeadline`.
//
// ⚠️ Why this file exists at all: `PATCH /api/v1/devices/{id}` is a FULL
// REPLACEMENT. A client that does not send `returnWindowDays`/`receivedAt`
// CLEARS a recorded window — exactly the trap `soldAt`/`soldPrice` have (openapi
// `DeviceInput.returnWindowDays`: "không gửi `returnWindowDays`/`receivedAt`
// nghĩa là **xoá** cửa sổ đổi/trả đã ghi"). Three clients were updated in
// parallel and only together may any of them expose a UI that SETS a window; in
// this pass the web has no such input. What it must do is carry an existing
// value through an unrelated edit unchanged.
//
// The form therefore loads the two fields off the device, ships them in
// always-mounted hidden inputs, and `actions/devices.ts` sends both keys on every
// save (null when there is nothing to preserve) — the same shape as the resale
// pair in `./device-resale.ts`.
//
// Wire format (openapi `Device.receivedAt`): Z-less
// `YYYY-MM-DDTHH:MM:SS[.fff]` — the same serialisation as `purchaseDate`. Two
// details matter:
//   * `null` (chưa biết) and `0` (cửa hàng không cho đổi trả) are DIFFERENT
//     answers, so `0` must survive the round-trip as `0`, not become null.
//   * a sub-second Z-less value IS re-anchored to its calendar day rather than
//     sent back verbatim — but NOT because Go would reject it. `services.parseDate`
//     parses any of `YYYY-MM-DD`, `YYYY-MM-DDTHH:MM:SS`, RFC3339, and (verified
//     against Go 1.24 with a throwaway program) a Z-less value with fractional
//     seconds too, since `time.Parse` accepts a fractional second even when the
//     layout does not declare one. The re-anchoring is a deliberate choice for a
//     day-resolution field: the deadline is `day + returnWindowDays`, so the time
//     component carries no meaning here and dropping it keeps the stored value
//     canonical instead of letting sub-second noise propagate on every edit.

import { differenceInCalendarDays } from 'date-fns';
import { translate } from '@/lib/i18n/catalog';
import type { Locale } from '@/lib/i18n/locale';

export type ReturnWindowFields = {
  /** `null` = chưa biết, `0` = không cho đổi trả, `> 0` = số ngày. */
  returnWindowDays: number | null;
  /** Z-less timestamp string, or `null` when "chưa ghi". */
  receivedAt: string | null;
};

/** Structural subset of `Device` — just what the round-trip needs. */
export type ReturnWindowSource = {
  returnWindowDays?: number | null;
  receivedAt?: string | null;
};

// Whole-second Z-less wire value, i.e. the shape `services.parseDate` accepts
// verbatim.
const WIRE_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;
const DAY_PREFIX = /^(\d{4}-\d{2}-\d{2})/;

/**
 * Value for the hidden input that carries `returnWindowDays` back to the action.
 *
 * `''` for null/undefined (the action maps blank → `null` again) and the plain
 * number otherwise — `0` included, because "cửa hàng không cho đổi trả" must not
 * come back as "chưa biết".
 */
export function returnWindowDaysInputValue(days: number | null | undefined): string {
  if (days == null || !Number.isFinite(days)) return '';
  return String(days);
}

/**
 * Value for the hidden input that carries `receivedAt` back to the action.
 *
 * The wire value is sent back **unchanged** when it is already the canonical
 * day-anchored shape (Z-less, whole seconds). A sub-second value is re-anchored
 * to its own calendar day instead of being sent verbatim — not because the Go
 * parser would reject it (it would not; `time.Parse` accepts a fractional second
 * even when the layout omits one), but because this field is day-resolution
 * everywhere it is used: the deadline is `day + returnWindowDays`, so the time
 * component means nothing and normalising it keeps the stored value canonical.
 * The string is Z-less UTC, so its first ten characters are exactly the day the
 * server stored.
 *
 * Anything without a leading `YYYY-MM-DD` yields `''` → `null`: an unreadable
 * value is never invented into a window.
 */
export function receivedAtInputValue(receivedAt: string | null | undefined): string {
  if (receivedAt == null) return '';
  const raw = receivedAt.trim();
  if (raw === '') return '';
  const day = DAY_PREFIX.exec(raw)?.[1];
  if (!day) return '';
  return WIRE_TIMESTAMP.test(raw) ? raw : day;
}

/**
 * What `PATCH /v1/devices/{id}` should carry, parsed from the submitted form.
 *
 * Both keys are always returned, so a save without a window sends an explicit
 * `{returnWindowDays: null, receivedAt: null}` (the server's "clear" signal)
 * instead of one key silently going missing. Blank → `null`; `0` is kept.
 */
export function returnWindowFieldsFromFormData(formData: FormData): ReturnWindowFields {
  const daysRaw = formData.get('returnWindowDays');
  const receivedRaw = formData.get('receivedAt');

  let returnWindowDays: number | null = null;
  if (typeof daysRaw === 'string' && daysRaw.trim() !== '') {
    const parsed = Number(daysRaw);
    returnWindowDays = Number.isFinite(parsed) ? parsed : null;
  }

  let receivedAt: string | null = null;
  if (typeof receivedRaw === 'string' && receivedRaw.trim() !== '') {
    receivedAt = receivedRaw.trim();
  }

  return { returnWindowDays, receivedAt };
}

/**
 * Note for a derived `returnDeadline`, shown next to the warranty end date on
 * the device page.
 *
 * Day-resolution, matching the server's `ReturnWindow.daysLeft` semantics: `0`
 * means today is the last day. Rendered from the value the server computed — the
 * web never derives the deadline itself.
 *
 * `locale` is required (and comes before the optional `now`, matching
 * `formatRelativeDay` in `lib/format.ts`) so a caller that forgets it is a
 * compile error rather than a Vietnamese fragment inside an English page.
 */
export function returnDeadlineNote(
  deadline: string,
  locale: Locale,
  now: Date = new Date(),
): string {
  const days = differenceInCalendarDays(new Date(deadline), now);
  if (days > 0) return translate(locale, 'còn {days} ngày', { days, count: days });
  if (days === 0) return translate(locale, 'hôm nay là ngày cuối');
  const past = Math.abs(days);
  return translate(locale, 'đã qua {days} ngày', { days: past, count: past });
}
