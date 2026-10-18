// Pure helpers for warranty activation and the extended-cover deadline
// (Feature A): `Device.activationRequired`, `Device.activatedAt` and
// `Device.extendedCoverBuyBy`.
//
// Why these three exist as fields rather than as notes:
//   - In Vietnam the warranty often starts with a retailer action, not the
//     invoice. An unactivated device CAN be refused at the counter, so "chưa
//     kích hoạt" is a warning about the device's state, not a missing form
//     field.
//   - Extended cover (AppleCare+, Samsung Care+) must be bought inside a window
//     that closes forever. The countdown is the whole point of the field.
//
// `activatedAt` may legitimately come BEFORE `purchaseDate` — a shop can
// pre-activate a device before handing it over, and the server accepts that.
// Nothing here compares the two dates; do not add such a check.
//
// Kept free of React / server-only imports so it can be unit-tested under
// `src/lib/__tests__/` and reused by both the device form (client) and the
// device detail page (RSC). `locale` is required everywhere: an optional locale
// would let an unconverted call site print Vietnamese inside an English page.

import { differenceInCalendarDays } from 'date-fns';
import { formatDate } from './format';
import { translate } from '@/lib/i18n/catalog';
import type { Locale } from '@/lib/i18n/locale';

/** Structural subset of `Device` the helpers need — also fits a form draft. */
export type ActivationSource = {
  activationRequired?: boolean | null;
  activatedAt?: string | null;
};

/**
 * The one-line activation state shown on the device detail page, or `null` when
 * there is nothing to say.
 *
 * Three states, and the difference between the last two matters:
 *   - a date        → "Đã kích hoạt ngày …" (the warranty clock has started)
 *   - required only → "Chưa kích hoạt"      (the counter can refuse it)
 *   - neither       → `null`                (activation is not part of this
 *                                            device's story; say nothing rather
 *                                            than imply it was activated)
 *
 * `activatedAt` wins over `activationRequired`: a device that required
 * activation and has a date is activated, and showing the warning would be
 * wrong.
 */
export function activationStateLabel(
  device: ActivationSource,
  locale: Locale,
): string | null {
  const activatedAt = device.activatedAt?.trim();
  if (activatedAt) {
    return translate(locale, 'Đã kích hoạt ngày {date}', {
      date: formatDate(activatedAt, locale),
    });
  }
  if (device.activationRequired) return translate(locale, 'Chưa kích hoạt');
  return null;
}

/**
 * Countdown for `extendedCoverBuyBy` (rendered next to the deadline itself), or
 * `null` when there is no usable date — an unparseable value must not become
 * "NaN ngày trước".
 *
 * Day-resolution like `returnDeadlineNote`: `0` means today is the last day, so
 * the copy says so explicitly instead of "còn 0 ngày". A negative value means
 * the window is gone; the copy stays past-tense because the option cannot be
 * bought any more.
 */
export function extendedCoverBuyByNote(
  buyBy: string | null | undefined,
  locale: Locale,
  now: Date = new Date(),
): string | null {
  if (buyBy == null) return null;
  const trimmed = buyBy.trim();
  if (trimmed === '') return null;
  const end = new Date(trimmed);
  if (Number.isNaN(end.getTime())) return null;

  const days = differenceInCalendarDays(end, now);
  if (days > 0) {
    return translate(locale, 'Còn {days} ngày để mua gói mở rộng', {
      days,
      count: days,
    });
  }
  if (days === 0) {
    return translate(locale, 'Hôm nay là ngày cuối mua gói mở rộng');
  }
  const past = Math.abs(days);
  return translate(locale, 'Đã hết hạn mua gói mở rộng ({days} ngày trước)', {
    days: past,
    count: past,
  });
}
