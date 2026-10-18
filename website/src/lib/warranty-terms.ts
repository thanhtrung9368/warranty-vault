// Warranty contract terms — the nine optional fields added to `Warranty`:
// `component`, `scope`, `cap`, `deductible`, `exclusions`, `region`,
// `transferable`, `claimsAllowed`, `claimsUsed`.
//
// Why this file exists: the warranty row used to answer "when does cover end?"
// and nothing else. A Vietnamese plan is a contract with economics — a capped
// payout, a deductible, exclusions — and users were keeping that in `notes`,
// where it is unreadable and unsearchable. The nine fields are the structured
// replacement.
//
// Everything here is pure and locale-aware (the same pattern as
// `lib/lead-days.ts` / `lib/device-return-window.ts`) so the form, the detail
// row and the unit tests all share one definition of "has terms" and one
// rendering of the numbers. No React, no server-only imports.
//
// The server owns validation (non-negative cap/deductible/claims, and
// `claimsUsed > claimsAllowed` → 400 `fieldErrors.claimsUsed`). This module
// only decides what is SET and how a set value READS.

import { formatVND } from '@/lib/format';
import { translate } from '@/lib/i18n/catalog';
import type { Locale } from '@/lib/i18n/locale';

/** Structural subset of the warranty wire shape this module needs. */
export type WarrantyTerms = {
  component?: string | null;
  scope?: string | null;
  cap?: number | null;
  deductible?: number | null;
  exclusions?: string | null;
  region?: string | null;
  transferable?: boolean | null;
  claimsAllowed?: number | null;
  claimsUsed?: number | null;
};

/** The nine FormData/wire keys, in the order the form renders them. */
export const WARRANTY_TERM_KEYS = [
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

function isText(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim() !== '';
}

function isAmount(value: number | null | undefined): boolean {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Does this warranty carry contract terms at all?
 *
 * The one subtlety is `claimsUsed`: the server defaults it to `0` and serialises
 * it on every row, so counting `0` as "set" would make EVERY warranty look like
 * it has terms — the form would always start expanded and every row would grow
 * a terms block. `claimsUsed > 0` is the only value that says something the
 * default does not. Every other field counts as soon as it is present,
 * including `0` for `cap`/`deductible` (a zero deductible is a real term) and
 * `false` for `transferable` (an explicit "no" is different from "not
 * recorded").
 */
export function hasWarrantyTerms(terms: WarrantyTerms | null | undefined): boolean {
  if (!terms) return false;
  return (
    isText(terms.component) ||
    isText(terms.scope) ||
    isAmount(terms.cap) ||
    isAmount(terms.deductible) ||
    isText(terms.exclusions) ||
    isText(terms.region) ||
    typeof terms.transferable === 'boolean' ||
    isAmount(terms.claimsAllowed) ||
    (isAmount(terms.claimsUsed) && (terms.claimsUsed as number) > 0)
  );
}

/**
 * The form's collapsed/expanded default: open when any term is set, closed when
 * all nine are empty.
 *
 * This is the whole design decision in one predicate. Nine extra inputs on top
 * of the six the form already has would bury it for the majority of users, who
 * never record a cap or a deductible. A collapsed section costs them one line
 * of chrome; for someone who DOES have contract terms, opening pre-expanded
 * means editing does not hide the data they came to change. The rule is keyed
 * on the row's own values, not on a "was it ever saved" flag, so it also holds
 * for a freshly-created plan whose terms were filled in.
 */
export function termsExpandedByDefault(
  terms: WarrantyTerms | null | undefined,
): boolean {
  return hasWarrantyTerms(terms);
}

/**
 * True when the submitted form produced errors on any terms field.
 *
 * Used to force the section open after a failed submit: a 400 on
 * `fieldErrors.claimsUsed` must not be hidden inside a collapsed `<details>`
 * just because the row had no terms before the user typed them.
 */
export function hasWarrantyTermErrors(
  errors: Record<string, string[] | undefined> | null | undefined,
): boolean {
  if (!errors) return false;
  return WARRANTY_TERM_KEYS.some((key) => (errors[key]?.length ?? 0) > 0);
}

/**
 * A cap or deductible as money, or `null` when it is not recorded.
 *
 * `null` (not "0 ₫") is the unset case — the difference matters on screen: an
 * unrecorded deductible must read as "not part of this contract", not as "free
 * claims". `0` itself is a real value and formats as currency.
 */
export function warrantyAmountLabel(
  amount: number | null | undefined,
  locale: Locale,
): string | null {
  if (!isAmount(amount)) return null;
  return formatVND(amount as number, locale);
}

/**
 * Which part a warranty row covers.
 *
 * A discriminated result rather than a bare string, because the two cases are
 * translated differently: "whole unit" is a catalog sentence (`Toàn bộ thiết
 * bị`), while a component name is the user's own text and must be shown
 * verbatim — passing it through the catalog would translate a component that
 * happened to collide with an unrelated key.
 */
export type WarrantyComponentLabel =
  | { kind: 'whole' }
  | { kind: 'component'; label: string };

export function warrantyComponentLabel(
  component: string | null | undefined,
): WarrantyComponentLabel {
  const trimmed = typeof component === 'string' ? component.trim() : '';
  return trimmed ? { kind: 'component', label: trimmed } : { kind: 'whole' };
}

/**
 * "1/3 lượt đã dùng" / "1/3 claims used" — the claims budget as one line.
 *
 * A null result means the row has no claims information to show:
 *   * both values ⇒ used out of allowed (the normal case — `claimsUsed`
 *     defaults to 0, so "0/3" is meaningful once `claimsAllowed` is set);
 *   * allowed only ⇒ the remaining budget;
 *   * used > 0 only ⇒ how many have been claimed, with no known ceiling.
 *
 * The English noun follows `claimsAllowed` (the count of claims the contract
 * allows), hence `count: allowed`; this is what keeps "1/1 claim used" from
 * reading as "1/1 claims used".
 */
export function claimsUsedLabel(
  terms: Pick<WarrantyTerms, 'claimsUsed' | 'claimsAllowed'>,
  locale: Locale,
): string | null {
  const allowed = isAmount(terms.claimsAllowed)
    ? (terms.claimsAllowed as number)
    : null;
  const used = isAmount(terms.claimsUsed) ? (terms.claimsUsed as number) : null;

  if (allowed !== null && used !== null) {
    return translate(locale, 'Đã dùng {used}/{allowed} lượt', {
      used,
      allowed,
      count: allowed,
    });
  }
  if (allowed !== null) {
    return translate(locale, 'Tối đa {allowed} lượt', {
      allowed,
      count: allowed,
    });
  }
  if (used !== null && used > 0) {
    return translate(locale, 'Đã dùng {used} lượt', { used, count: used });
  }
  return null;
}

/**
 * "Có" / "Không", or `null` when the contract does not say.
 *
 * `null` is not `false`: hiding the row when unrecorded is the honest render,
 * because "not transferable" and "nobody wrote it down" are different answers.
 */
export function warrantyTransferableLabel(
  transferable: boolean | null | undefined,
  locale: Locale,
): string | null {
  if (typeof transferable !== 'boolean') return null;
  return translate(locale, transferable ? 'Có' : 'Không');
}
