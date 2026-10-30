import Foundation

// ============================================================
// WarrantyFormRules — the pure defaults and date maths of the warranty form
//
// ## The defect this file exists to prevent
//
// The form used to open with `startDate = today` and `months = 12`. For a
// phone bought last Tết that produces an end date more than a year late — the
// app tells the user they are covered long after they are not, which is the
// worst direction for this product to be wrong in. When the device has a
// purchase date, that is the only defensible default: the warranty starts when
// the device was bought, not when the user got round to typing it in.
//
// ## What stays a default
//
// `defaultMonths` is still `12` — most standard warranties are a year — but the
// form labels it as a default rather than presenting it as a fact. The end date
// is never sent: the server derives `startDate + months` unless an explicit
// `endDate` wins, exactly as `api/internal/services/warranties.go` documents.
// `endDate(startDate:months:)` exists only so the form can show the user what
// they are about to create while they type.
//
// ## The conflict, surfaced rather than prevented
//
// A warranty may legitimately start before or after the purchase (an extended
// plan bought later, a retailer backdating cover). So this is not validation —
// it is a disclosure: when the form's start date disagrees with the device's
// purchase date, the screen says so and offers the purchase date back. Nothing
// here blocks a save.
// ============================================================

/// A disagreement between the form's start date and the device's purchase date.
public struct WarrantyDateConflict: Equatable, Sendable {
    /// `startDate − purchaseDate` in whole calendar days. Positive = the plan
    /// starts after the purchase; negative = it starts before.
    public let offsetDays: Int

    public init(offsetDays: Int) {
        self.offsetDays = offsetDays
    }

    /// `true` when the plan would start later than the device was bought.
    public var startsAfterPurchase: Bool { offsetDays > 0 }

    /// The one-line disclosure. Plurals go through `L.p`, so English inflects
    /// "1 day" / "N days" and Vietnamese keeps its single form.
    public var label: String {
        if offsetDays > 0 {
            return L.p("Gói bắt đầu muộn hơn ngày mua thiết bị %d ngày.", offsetDays)
        }
        return L.p("Gói bắt đầu sớm hơn ngày mua thiết bị %d ngày.", -offsetDays)
    }
}

public enum WarrantyFormRules {

    /// The pre-filled month count. A default, not an assertion: the form says
    /// so, and the user can change it before saving.
    public static let defaultMonths = 12

    /// The start date the form opens with.
    ///
    /// The device's purchase date wins whenever there is one; `today` is the
    /// fallback for a device with no purchase information, never the first
    /// choice. Both values are reduced to calendar days, so the picker holds
    /// midnight of the day the user is looking at.
    public static func defaultStartDate(
        purchaseDate: Date?,
        today: Date = Date(),
        calendar: Calendar = .current
    ) -> Date {
        guard let purchaseDate else { return calendar.startOfDay(for: today) }
        return calendar.startOfDay(for: purchaseDate)
    }

    /// `startDate + months` on the caller's calendar — the end date the server
    /// will derive when no explicit `endDate` is sent.
    ///
    /// `nil` for a non-positive month count (the form's own "at least 1 month"
    /// rule), so a half-typed field cannot print an end date before the start.
    /// `Calendar` clamps end-of-month the same way Go's `addMonths` does
    /// (31 January + 1 month → 28/29 February).
    public static func endDate(
        startDate: Date,
        months: Int,
        calendar: Calendar = .current
    ) -> Date? {
        guard months >= 1 else { return nil }
        return calendar.date(byAdding: .month, value: months, to: startDate)
    }

    /// The conflict to disclose, or `nil` when there is nothing to compare or
    /// the two days agree.
    ///
    /// Compares **calendar days**, not instants: a purchase date arriving as
    /// `2026-03-15T00:00:00Z` and a picker holding local midnight on the 15th
    /// are the same day to the user even though their `Date` values differ.
    public static func conflict(
        startDate: Date,
        purchaseDate: Date?,
        calendar: Calendar = .current
    ) -> WarrantyDateConflict? {
        guard let purchaseDate else { return nil }
        let offset = CalendarDay.days(from: purchaseDate, to: startDate, calendar: calendar)
        return offset == 0 ? nil : WarrantyDateConflict(offsetDays: offset)
    }
}
