// Locale-aware wrappers around the static enum/option label maps.
//
// The maps themselves (`CATEGORY_LABELS`, `STATUS_LABELS`, `BILLING_CYCLE_LABELS`,
// …) stay exactly where they were and keep their Vietnamese values. Two reasons:
//
//   * They are the ORIGINAL text (docs/I18N_PLAN.md §2.4) and the key the catalog
//     is looked up by, so translating them in place would mean retyping the
//     source sentence — the one thing this migration must not do.
//   * `website/src/lib/types.ts::CATEGORY_LABELS` is parsed by a Go test
//     (`api/internal/services/category_seed_test.go`, which regex-reads the
//     object literal and compares it with the iOS mirror, the Android mirror and
//     migration 0004). Reshaping that literal breaks `api/`, which is outside
//     this change.
//
// So the lookup happens here instead: map value → catalog key → translation, with
// the Vietnamese value returned untouched when no entry exists.

import { translate } from './catalog';
import type { Locale } from './locale';
import {
  CATEGORY_LABELS,
  STATUS_LABELS,
  WARRANTY_TYPE_LABELS,
  type Status,
  type WarrantyType,
} from '@/lib/types';
import {
  BILLING_CYCLE_LABELS,
  SUBSCRIPTION_STATUS_LABELS,
  type BillingCycle,
  type SubscriptionStatus,
} from '@/lib/subscription-types';
import {
  WISHLIST_PRIORITY_LABELS,
  WISHLIST_STATUS_LABELS,
  type WishlistPriority,
  type WishlistStatus,
} from '@/lib/wishlist-types';

/**
 * Translate a code through any `code → Vietnamese label` map.
 *
 * An unmapped code falls through to the code itself, which is what the maps'
 * own call sites already did for unknown values.
 */
export function labelOf(
  map: Record<string, string>,
  code: string,
  locale: Locale,
): string {
  return translate(locale, map[code] ?? code);
}

export function categoryLabel(code: string, locale: Locale): string {
  return labelOf(CATEGORY_LABELS, code, locale);
}

export function statusLabel(status: Status, locale: Locale): string {
  return labelOf(STATUS_LABELS, status, locale);
}

export function warrantyTypeLabel(type: WarrantyType, locale: Locale): string {
  return labelOf(WARRANTY_TYPE_LABELS, type, locale);
}

export function billingCycleLabel(cycle: BillingCycle, locale: Locale): string {
  return labelOf(BILLING_CYCLE_LABELS, cycle, locale);
}

export function subscriptionStatusLabel(status: SubscriptionStatus, locale: Locale): string {
  return labelOf(SUBSCRIPTION_STATUS_LABELS, status, locale);
}

export function wishlistPriorityLabel(priority: WishlistPriority, locale: Locale): string {
  return labelOf(WISHLIST_PRIORITY_LABELS, priority, locale);
}

export function wishlistStatusLabel(status: WishlistStatus, locale: Locale): string {
  return labelOf(WISHLIST_STATUS_LABELS, status, locale);
}
