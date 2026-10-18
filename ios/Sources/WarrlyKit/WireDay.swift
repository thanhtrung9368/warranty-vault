import Foundation

// WireDay — the one place a wire calendar day becomes a `Date`, and back.
//
// ## The problem this names
//
// Every date the API stores is a `timestamp without time zone` column with UTC
// semantics, and `pgtype.Timestamp` marshals it **Z-less**
// (`"2026-03-02T00:00:00"` — no `Z`, no offset; `openapi.yaml` documents the
// same shape for `soldAt` and `receivedAt`). The app's decoder
// (`APIClient.DateFormatters`) reads those Z-less strings in the **device's**
// zone, and that is what makes a date picker show the day the server holds.
//
// That stays true only if the value is written back in the *same* zone. A pinned
// formatter breaks the round trip in every direction:
//
//   * a **zone-pinned format** of a device-zone midnight lands on the previous
//     day for every device east of the pin — a Tokyo (UTC+9) user picking the
//     2nd stored the 1st, and a *UTC* pin does the same to Vietnam itself
//     (UTC+7 midnight is 17:00 the day before, in UTC);
//   * a **zone-pinned parse** feeding a picker moves the day the other way, for
//     every device west of the pin — a Los Angeles user scanning a receipt
//     dated the 2nd saw the 1st.
//
// ## The rule
//
// A Z-less wire value is a **calendar day**, not an instant. Read it, and write
// it, in the zone the user is looking at — the device's own. Then
//
//     string(from: date(from: wire, in: z), in: z) == day-prefix(wire)
//
// for *every* zone `z`, and an untouched date picker gives back exactly what was
// loaded. The zone is a parameter (defaulting to `.current`) so that rule can be
// pinned across UTC−11 … UTC+14 in tests rather than only where the suite runs.
//
// `DeviceResale.dayDate` / `dayString` were the first form of this, for the
// resale pair; they now delegate here, so a sale, a purchase date, a warranty's
// start date, a subscription's renewal and a wishlist target cannot disagree
// about what a day is.
//
// Reading the day **off the string** is still preferred wherever a `Date` is not
// genuinely needed (`DeviceReturnWindow.dayPrefix`, and the `soldAt` /
// `receivedAt` carry-back paths) — a value that is never parsed cannot drift.
// These two functions exist for the cases where a `Date` *is* needed: a date
// picker's binding, and a `Date` that came out of the shared decoder.
public enum WireDay {

    /// `YYYY-MM-DD` (the leading day of a Z-less wire timestamp) → the `Date` a
    /// date picker holds for that day: midnight **in `timeZone`**.
    ///
    /// `nil` when the wire value carries no readable day — an unreadable date is
    /// never invented.
    public static func date(from wire: String?, in timeZone: TimeZone = .current) -> Date? {
        guard let day = DeviceReturnWindow.dayPrefix(wire) else { return nil }
        return formatter(timeZone).date(from: day)
    }

    /// The `YYYY-MM-DD` a `Date` stands for in `timeZone` — the calendar day the
    /// user is looking at. The exact inverse of `date(from:in:)` in the same zone.
    public static func string(from date: Date, in timeZone: TimeZone = .current) -> String {
        formatter(timeZone).string(from: date)
    }

    /// A `yyyy-MM-dd` formatter pinned to `timeZone` and to a fixed locale, so the
    /// day can never drift with the device's locale or the machine's default zone.
    /// Built per call: these run once per form load and once per save.
    private static func formatter(_ timeZone: TimeZone) -> DateFormatter {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        f.timeZone = timeZone
        return f
    }
}
