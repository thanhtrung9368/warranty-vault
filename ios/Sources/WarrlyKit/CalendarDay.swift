import Foundation

// CalendarDay — the one place that answers "how many days from this day to
// that day".
//
// ## Why this file exists
//
// A warranty end date is a **calendar day**, not an instant. The server stores
// it as a day-anchored column, and the app shows it as `28/10/2026`. Counting
// the days left with `calendar.dateComponents([.day], from: Date(), to: end)`
// measures **elapsed 24-hour blocks** instead: at 14:10 on 19 October, a
// warranty ending at midnight on the 28th is 8 days and 9 hours 50 minutes
// away, so the subtraction reports 8. The device list — which anchors both
// sides with `startOfDay` — reported 9 for the same warranty. The dashboard
// read "8d left" beside a list that read "9d left" (the fixture's answer is 9;
// 19 → 28 October is nine calendar days).
//
// Four different helpers were doing this subtraction, and the one the dashboard
// read was the only one that measured elapsed hours. They now all delegate here:
//
//   * `DeviceReturnWindow.daysLeft` / `WarrantyActivation.buyByDaysLeft`
//     (return window, extended-cover buy-by),
//   * `DeadlineWidgetRules.daysRemaining` (widget / Siri intent),
//   * `DismissedReminder.daysRemaining` and `UpcomingReminder.daysRemaining`
//     (reminders, dashboard, badges),
//   * `BrandWarranty` (the brand-check day arithmetic),
//   * `WVFormat.daysUntil` (app-side pill labels), and
//   * `DashboardView`'s subscription countdown.
//
// ## The rule
//
// Both endpoints are reduced to local midnight on the caller's calendar before
// subtracting. That makes the answer independent of the time of day (14:10 or
// 00:01 gives the same count), of DST (a 23- or 25-hour day is still one day),
// and of which side of UTC the device sits on. Zones remain a parameter so the
// rule can be pinned across UTC−11 … UTC+14 in tests rather than only where the
// suite happens to run.
//
// `CalendarDayTests` pins the fixture from the field report (a warranty ending
// 2026-10-28, read at 2026-10-19 14:10 in +07:00) against **every** helper
// above, so they cannot drift apart again.
public enum CalendarDay {

    /// Signed whole calendar days from `start` to `end` — `end - start`.
    ///
    /// `0` is "the same day", negative is "in the past", `1` is "tomorrow".
    /// A time of day never changes the answer.
    public static func days(from start: Date,
                            to end: Date,
                            calendar: Calendar = .current) -> Int {
        calendar.dateComponents(
            [.day],
            from: calendar.startOfDay(for: start),
            to: calendar.startOfDay(for: end)
        ).day ?? 0
    }
}

// MARK: - Reminder models

public extension UpcomingReminder {
    /// Whole calendar days from `now` to this warranty's end. Negative once the
    /// warranty has expired. This is the count the dashboard, the reminder
    /// buckets and the "Còn/Hết" pills all draw, so it must agree with the
    /// device list for the same warranty — it did not, and read one day short.
    func daysRemaining(from now: Date = Date(), calendar: Calendar = .current) -> Int {
        CalendarDay.days(from: now, to: endDate, calendar: calendar)
    }

    /// Today's count. Deliberately a convenience over the function above so a
    /// test can pin the clock instead of depending on the wall time.
    var daysRemaining: Int { daysRemaining() }
}
