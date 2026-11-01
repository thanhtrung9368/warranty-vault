import Foundation

// SubscriptionBilling — the money and the date a subscription decision turns on.
//
// These two rules already shipped, in three places, before this file existed:
//
//   * `services.MonthlyEquivalent` (api/internal/services/subscription_billing.go)
//     for `GET /api/v1/stats` and the audit payload,
//   * `monthlyEquivalent` in website/src/lib/subscription-types.ts,
//   * two private copies in the iOS list and detail: `subMonthlyEquivalent`.
//
// The iOS copies divided in `Double` and rounded only at the formatting site,
// so a client total could disagree by a đồng with `GET /api/v1/stats`, and the
// form had no copy at all — the defect this file closes. There is now one
// implementation on this client, numerically identical to Go's, so a plan's
// monthly figure cannot disagree between the form, the list, the detail and the
// server's total.
//
// The date rule is the other half: `NextRenewalDate` is what the server applies
// when a create omits `renewalDate` (`services/subscriptions.go:268-271`). The
// create form used to default its picker to *today* — a date the daily cron
// would treat as overdue and turn into a `SubscriptionPayment` that never
// happened. Seeding the picker from this rule means accepting the default can
// no longer produce a charge record out of nothing.
public enum SubscriptionBilling {

    /// One cycle's price as a monthly cost, in VND.
    ///
    /// A line-for-line mirror of Go's `services.MonthlyEquivalent`:
    ///
    ///     MONTHLY    -> price
    ///     QUARTERLY  -> price / 3      (integer division, truncated toward zero)
    ///     YEARLY     -> price / 12     (truncated)
    ///     LIFETIME   -> 0              (there is no monthly cost to divide)
    ///     CUSTOM     -> round(price * 30 / intervalDays), 0 when intervalDays is
    ///                   missing or not positive
    ///
    /// The older iOS copies used `price / 12` in `Double` and the old web helper
    /// divided by average days (30/365); both disagreed with the server. Do not
    /// reintroduce either: `QUARTERLY` and `YEARLY` are integer divisions, and
    /// `CUSTOM` is the only branch that rounds.
    ///
    /// Rounding is `.toNearestOrAwayFromZero`, matching Go's `math.Round` — which
    /// only differs from Swift's default `.toNearestOrEven` on exact `.5`
    /// boundaries (a 15-day custom cycle at 5.000 ₫ is 10.000 ₫, not 9.999 ₫).
    public static func monthlyEquivalent(price: Int,
                                         cycle: BillingCycle,
                                         intervalDays: Int?) -> Int {
        switch cycle {
        case .MONTHLY:
            return price
        case .QUARTERLY:
            return price / 3
        case .YEARLY:
            return price / 12
        case .LIFETIME:
            return 0
        case .CUSTOM:
            guard let days = intervalDays, days > 0 else { return 0 }
            let raw = Double(price) * 30.0 / Double(days)
            return Int(raw.rounded(.toNearestOrAwayFromZero))
        }
    }

    /// The next renewal (first charge) date after `start`, or `nil` when the
    /// cycle has no computable one.
    ///
    /// Mirrors Go's `services.NextRenewalDate` and the web helper:
    ///
    ///     MONTHLY    -> + 1 month
    ///     QUARTERLY  -> + 3 months
    ///     YEARLY     -> + 1 year
    ///     CUSTOM     -> + intervalDays days; `nil` when it is missing or ≤ 0
    ///     LIFETIME   -> `nil` — a lifetime plan never renews. The web helper
    ///                   returns a 100-year sentinel instead; this app has no
    ///                   caller that needs a fake date, so it says "none".
    ///
    /// ## Month-end normalisation
    ///
    /// Go's `time.AddDate` normalises an overflowing day instead of clamping it:
    /// 31 January + 1 month is 3 March (the 31st of February), which is also what
    /// JavaScript's `setMonth` does. Foundation's `date(byAdding: .month, …)`
    /// clamps to 28 February instead, so it would seed a different date than the
    /// server computes for the same plan. To stay byte-identical with the server
    /// on every date, the month and year branches add months to the first of the
    /// target month and then add `day - 1` days — the same normalisation, written
    /// out.
    ///
    /// The result is anchored to the start of its day in `calendar`; callers only
    /// need the calendar day (the wire sends `YYYY-MM-DD` through `WireDay`).
    public static func nextRenewalDate(from start: Date,
                                       cycle: BillingCycle,
                                       intervalDays: Int?,
                                       calendar: Calendar = .current) -> Date? {
        switch cycle {
        case .MONTHLY:
            return addingMonths(1, to: start, calendar: calendar)
        case .QUARTERLY:
            return addingMonths(3, to: start, calendar: calendar)
        case .YEARLY:
            return addingMonths(12, to: start, calendar: calendar)
        case .CUSTOM:
            guard let days = intervalDays, days > 0 else { return nil }
            return calendar.date(byAdding: .day, value: days, to: start)
        case .LIFETIME:
            return nil
        }
    }

    /// `date` plus `months`, with Go's overflow normalisation rather than
    /// Foundation's clamping. See the note on ``nextRenewalDate``.
    private static func addingMonths(_ months: Int,
                                     to date: Date,
                                     calendar: Calendar) -> Date? {
        let parts = calendar.dateComponents([.year, .month, .day], from: date)
        guard let year = parts.year, let month = parts.month, let day = parts.day else {
            return nil
        }
        // Work in absolute months so December → January crosses the year by
        // itself. Years are positive in every payload this client can receive.
        let absolute = year * 12 + (month - 1) + months
        let targetYear = absolute / 12
        let targetMonth = absolute % 12 + 1
        guard let firstOfMonth = calendar.date(from: DateComponents(year: targetYear,
                                                                    month: targetMonth,
                                                                    day: 1)) else {
            return nil
        }
        return calendar.date(byAdding: .day, value: day - 1, to: firstOfMonth)
    }
}
