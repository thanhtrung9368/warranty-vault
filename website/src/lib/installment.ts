// Installment plan ("trả góp") — pure helpers for the web client.
// FEATURE_RESEARCH_2026-11 §6.5, migration 0031.
//
// ## What the plan changes
//
// `Device.purchasePrice` is the STICKER price. A financed device actually costs
// its owner the down payment plus every monthly payment plus the fees, and part
// of that may still be owed. Using the sticker price as the cost basis makes
// cost-per-day, resale profit and the /stats rollup wrong — and can even flip
// resale profit from a gain to a loss.
//
// The server already does the arithmetic and sends two fields on every device
// read:
//
//   * `Device.installment` — the plan itself with its derived totals, in the
//     DEVICE's currency;
//   * `Device.ownershipCostVnd` — the same basis in VND, computed at the locked
//     fxRate (the instalment total, or `purchasePriceVnd` when there is no
//     plan).
//
// Every helper here reads those; nothing multiplies by `fxRate` and nothing
// re-derives a total. `ownershipCostVnd` decides VND totals, `installmentTotal`
// decides same-currency comparisons (resale profit) — the same split
// `purchasePriceVnd` / `purchasePrice` already follows.
//
// ## What it deliberately does NOT model
//
// The plan is the user's own declaration, not a bank ledger: `paidCount` is
// self-reported and wave 1 ships no reminder and no "overdue" flag. `nextDueAt`
// says when the next payment falls due; whether a payment actually happened is
// not something this client (or the server) can know. Copy must never claim
// "quá hạn".

import { formatDay } from '@/lib/api-day';
import { formatMoney } from '@/lib/currency';
import { parseVNDInput } from '@/lib/format';
import type { InstallmentInput, InstallmentPlan } from '@/lib/api/devices';
import { translate } from '@/lib/i18n/catalog';
import type { Locale } from '@/lib/i18n/locale';

/** The subset of a device payload the money basis needs. */
type DeviceMoney = {
  purchasePrice: number;
  purchasePriceVnd: number | null;
  currency: string;
  purchaseDate?: string;
  installment?: InstallmentPlan | null;
  ownershipCostVnd?: number | null;
};

/**
 * The VND value every rollup must sum.
 *
 * The server's `ownershipCostVnd` when present, otherwise `purchasePriceVnd`
 * (a payload from before 1.2 — the field is additive and older reads do not
 * carry it). `null` keeps its meaning: a non-VND row whose locked rate is
 * missing, i.e. "cannot be known", never `0` and never the raw figure at par.
 *
 * This uses `!= null` on purpose: a server that computes an instalment total of
 * `0` (impossible in practice — `monthlyAmount > 0` — but a legal value on the
 * wire) must win over the sticker price rather than fall through.
 */
export function ownershipCostVnd(device: DeviceMoney): number | null {
  if (device.ownershipCostVnd != null) return device.ownershipCostVnd;
  return device.purchasePriceVnd ?? null;
}

/**
 * The ownership cost in the DEVICE's currency — the basis for same-currency
 * comparisons such as resale profit/loss.
 *
 * The server's `installment.totalCost` when a plan exists, otherwise
 * `purchasePrice`. Both operands of a profit subtraction must be in the same
 * currency; `saleProfitLoss` formats with `device.currency`, so this is the
 * counterpart it needs.
 */
export function ownershipCost(device: DeviceMoney): number {
  const total = device.installment?.totalCost;
  return total != null ? total : device.purchasePrice;
}

/** True when this device has a financing plan at all. */
export function hasInstallment(device: {
  installment?: InstallmentPlan | null;
}): boolean {
  return device.installment != null;
}

/** `paidCount / months` as a 0–100 integer for the progress bar. */
export function installmentProgressPercent(plan: InstallmentPlan): number {
  if (!Number.isFinite(plan.months) || plan.months <= 0) return 0;
  const pct = (plan.paidCount / plan.months) * 100;
  return Math.max(0, Math.min(100, Math.round(pct)));
}

/**
 * "Đã trả 3/12 kỳ" — the progress sentence on the card. Counts PAYMENTS, not
 * money: the user declares payments and the app has no transaction feed.
 */
export function installmentProgressLabel(plan: InstallmentPlan, locale: Locale): string {
  return translate(locale, 'Đã trả {paid}/{months} kỳ', {
    paid: String(plan.paidCount),
    months: String(plan.months),
  });
}

/**
 * Money in the device's own currency — never VND unless the device is VND. Call
 * sites pass `Device.currency` (or `DeviceDetail.currency`), never a guess.
 */
function money(amount: number, currency: string, locale: Locale): string {
  return formatMoney(amount, currency, locale);
}

/** "Còn nợ 18.000.000 ₫" (or "Đã trả xong kế hoạch" when complete). */
export function installmentRemainingLabel(
  plan: InstallmentPlan,
  currency: string,
  locale: Locale,
): string {
  if (plan.completed || plan.remainingAmount <= 0) {
    return translate(locale, 'Đã trả xong kế hoạch');
  }
  return translate(locale, 'Còn nợ {amount}', {
    amount: money(plan.remainingAmount, currency, locale),
  });
}

/** "Tổng {amount}" — the derived ownership cost of the plan. */
export function installmentTotalLabel(
  plan: InstallmentPlan,
  currency: string,
  locale: Locale,
): string {
  return translate(locale, 'Tổng {amount}', {
    amount: money(plan.totalCost, currency, locale),
  });
}

/**
 * "Kỳ tới 20/12/2026" for an open plan, "Đã trả xong" when complete.
 *
 * The day is formatted by slicing the wire value (`api-day.ts`), never by a
 * `new Date()` round trip — the same rule every other calendar day on the wire
 * follows. This says WHEN the next payment falls due. It deliberately does not
 * say the user is late: `paidCount` is self-reported, and a false "quá hạn" is
 * the one mistake this feature cannot afford.
 */
export function installmentNextDueLabel(plan: InstallmentPlan, locale: Locale): string {
  if (plan.completed) return translate(locale, 'Đã trả xong');
  if (!plan.nextDueAt) return '';
  return translate(locale, 'Kỳ tới {date}', {
    date: formatDay(plan.nextDueAt, locale),
  });
}

/**
 * The lower-bound caveat: fees the user has not declared are not in any figure.
 * Empty when both fees are known (or when there is no plan).
 */
export function installmentFeeCaveat(plan: InstallmentPlan, locale: Locale): string {
  if (!plan.hasUnknownFees) return '';
  return translate(
    locale,
    'Chưa ghi phí hồ sơ / phí hàng tháng, nên tổng chi phí là mức tối thiểu.',
  );
}

/** The first-due to last-due span in calendar months, for the card subtitle. */
export function installmentSpanLabel(plan: InstallmentPlan, locale: Locale): string {
  return translate(locale, '{months} tháng, kỳ đầu {date}', {
    months: String(plan.months),
    date: formatDay(plan.firstDueAt, locale),
  });
}

/**
 * Form value for the edit sheet's date input. `firstDueAt` is a calendar day on
 * the wire; the input must show that same day, so the string is sliced rather
 * than parsed into a `Date` (which would be UTC midnight and could fill the
 * previous day west of UTC).
 */
export function firstDueInputValue(plan: InstallmentPlan | null | undefined): string {
  if (!plan || !plan.firstDueAt) return '';
  const raw = plan.firstDueAt.trim();
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(raw);
  return match ? match[1] : '';
}

/**
 * Today's calendar day in the user's own timezone, for the form's default.
 * `new Date().toISOString().slice(0, 10)` is the UTC day and can be yesterday or
 * tomorrow locally — the same trap `api-day.ts` documents for every other day.
 */
export function todayInputValue(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * Parse one money input from the form. Blank ⇒ `null`, which for a fee means
 * "the user did not say" — deliberately different from `0` ("this fee is zero").
 * The two are different answers in the contract: an absent fee makes the total a
 * lower bound.
 */
function moneyFromInput(display: string | null | undefined): number | null {
  if (display == null || display.trim() === '') return null;
  return parseVNDInput(display);
}

/** Parse a required money input; blank becomes `0` and the server decides. */
function requiredMoneyFromInput(display: string | null | undefined): number {
  return moneyFromInput(display) ?? 0;
}

/** Parse a whole-number input (months / paidCount); blank becomes `0`. */
function intFromInput(display: string | null | undefined): number {
  if (display == null) return 0;
  const digits = display.replace(/[^\d-]/g, '');
  if (digits === '' || digits === '-') return 0;
  const parsed = Number.parseInt(digits, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Build the PUT body from the form's display strings. */
export function installmentInputFromForm(fields: {
  downPayment: string | null | undefined;
  months: string | null | undefined;
  monthlyAmount: string | null | undefined;
  firstDueAt: string | null | undefined;
  fileFee: string | null | undefined;
  monthlyFee: string | null | undefined;
  paidCount: string | null | undefined;
  lender: string | null | undefined;
}): InstallmentInput {
  const lender = (fields.lender ?? '').trim();
  return {
    downPayment: requiredMoneyFromInput(fields.downPayment),
    months: intFromInput(fields.months),
    monthlyAmount: requiredMoneyFromInput(fields.monthlyAmount),
    firstDueAt: (fields.firstDueAt ?? '').trim(),
    fileFee: moneyFromInput(fields.fileFee),
    monthlyFee: moneyFromInput(fields.monthlyFee),
    paidCount: intFromInput(fields.paidCount),
    lender: lender === '' ? null : lender,
  };
}
