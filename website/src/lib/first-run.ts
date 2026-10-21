// The cold-start predicate — "this account has never saved anything".
//
// The dashboard used to render the full warranty picture for an account with
// zero devices: four 0-valued tiles, an "everything is fine" expiring card and
// a quick-add panel, with the one meaningful CTA (the `EmptyState`) at the very
// bottom. A brand-new account read that as "the app knows you are covered"
// rather than "the app knows nothing about you yet".
//
// This is deliberately a pure predicate over COUNTS, not over the API payloads,
// so it is testable without Next and cannot be quietly reimplemented with
// `stats.total` (which counts ACTIVE devices only — an account whose devices
// were all sold is not a first-run account, and must not be congratulated
// either; see `empty-state.ts`).
//
// The three inputs are the RAW row counts (all statuses), because "I have used
// this app before" is true for a cancelled subscription or a bought wishlist
// item just as much as for an active one.

export type AccountContents = {
  /** Every device row, sold ones included. */
  devices: number;
  /** Every subscription row, any status. */
  subscriptions: number;
  /** Every wishlist row, any status. */
  wishlist: number;
};

/**
 * True only when the account holds nothing at all: no devices, no
 * subscriptions and no wishlist items.
 *
 * A count that is not a non-negative finite number is treated as NON-zero — a
 * broken read must fall back to the normal dashboard (which reports its own
 * errors) rather than telling someone with data that they are new here.
 */
export function isColdStartAccount({
  devices,
  subscriptions,
  wishlist,
}: AccountContents): boolean {
  const empty = (count: number) => Number.isFinite(count) && count === 0;
  return empty(devices) && empty(subscriptions) && empty(wishlist);
}
