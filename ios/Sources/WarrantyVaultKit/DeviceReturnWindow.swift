import Foundation

// Exchange / return window ("1 đổi 1") — openapi `Device.returnWindowDays`,
// `Device.receivedAt` and the derived `Device.returnDeadline` (migration 0010).
//
// ## Why this file exists at all
//
// `PATCH /api/v1/devices/{id}` **replaces the whole device**. A client that sends
// only the fields it draws does not "leave the window alone" — it **erases** it.
// Three clients were migrated in parallel and only together may any of them
// expose a UI that *sets* a window; until then the job here is narrower and
// absolute: an edit made on iOS must not silently destroy a window recorded on
// the web or on Android.
//
// So the device form loads whatever is stored and sends it straight back, and
// these helpers are the pure, testable form of that round trip:
//
//     Device.returnWindowDays ──carried(from:)──▶ DeviceInput.returnWindowDays
//     Device.receivedAt       ──carried(from:)──▶ DeviceInput.receivedAt
//
// There is deliberately **no** input, stepper or picker for the window in this
// pass. `DeviceReturnWindow.deadlineNote` exists only to *read* the derived
// deadline the server computed.
//
// ## The three states, which are not two
//
//  * `nil`  = **chưa biết** — the API has no default and never infers one;
//  * `0`    = a real answer: "cửa hàng không cho đổi trả";
//  * `> 0`  = that many days from `receivedAt` (or `purchaseDate` when the
//             delivery date is unrecorded).
//
// So `0` must survive the round trip as `0` and never collapse into "absent" —
// the same distinction `soldPrice`'s `0đ` give-away relies on.
//
// ## Wire format
//
// `receivedAt` comes back as the server's RFC3339 UTC timestamp
// (`"2026-03-02T00:00:00Z"`; openapi documents the Z-less form and both appear —
// the app's own decoder ladder already accepts each shape elsewhere). Only the
// date half is ever used, and the request sends that calendar day back
// (`DeviceInput.receivedAt` accepts `YYYY-MM-DD`, which Go parses as midnight
// UTC). Sending the date half is not a lossy edit: the field is a calendar date
// and the stored value is day-anchored.
//
// Reading the day **off the string** — rather than parsing it into a `Date` and
// formatting it again — is what keeps the stored UTC day from sliding: a value
// like `2026-03-02T23:30:00Z` must not become the 3rd in +07:00.

/// The two preserved fields, exactly as they must travel into `DeviceInput`.
public struct ReturnWindowFields: Equatable, Sendable {
    /// `nil` = chưa biết, `0` = không cho đổi trả, `> 0` = số ngày.
    public let returnWindowDays: Int?
    /// `YYYY-MM-DD`, or `nil` when "chưa ghi".
    public let receivedAt: String?

    public init(returnWindowDays: Int?, receivedAt: String?) {
        self.returnWindowDays = returnWindowDays
        self.receivedAt = receivedAt
    }

    /// Both fields unknown — what a device that never recorded a window carries.
    public static let unknown = ReturnWindowFields(returnWindowDays: nil, receivedAt: nil)
}

public enum DeviceReturnWindow {

    // MARK: - The round trip

    /// Wire → request, unchanged.
    ///
    /// `0` stays `0`; `nil` stays `nil`; an unreadable delivery date degrades to
    /// `nil` rather than being invented into a window. Nothing here is a UI
    /// convenience — it is the entire preservation guarantee.
    public static func carried(returnWindowDays: Int?, receivedAt: String?) -> ReturnWindowFields {
        ReturnWindowFields(
            returnWindowDays: returnWindowDays,
            receivedAt: dayPrefix(receivedAt)
        )
    }

    /// The same mapping, straight off a loaded device.
    public static func carried(from device: Device) -> ReturnWindowFields {
        carried(returnWindowDays: device.returnWindowDays, receivedAt: device.receivedAt)
    }

    /// The same mapping, off a device detail payload.
    public static func carried(from device: DeviceDetailBody) -> ReturnWindowFields {
        carried(returnWindowDays: device.returnWindowDays, receivedAt: device.receivedAt)
    }

    /// Writes the preserved pair onto the payload a save is about to send.
    ///
    /// Applied on **every** save, create included: for a device that recorded
    /// nothing both stay `nil`, which the encoder drops from the JSON — exactly
    /// what the server already has, so no value is invented either way.
    public static func apply(_ fields: ReturnWindowFields, to input: inout DeviceInput) {
        input.returnWindowDays = fields.returnWindowDays
        input.receivedAt = fields.receivedAt
    }

    // MARK: - The stored answers

    /// `true` when a window length was ever recorded, including the meaningful
    /// `0`. Used only to decide whether the read-only row is worth showing.
    public static func hasReturnWindow(_ days: Int?) -> Bool { days != nil }

    /// `true` when the shop's recorded policy is "no exchange at all".
    public static func isNoExchange(_ days: Int?) -> Bool { days == 0 }

    // MARK: - The derived deadline (read-only)

    /// `YYYY-MM-DD` of a wire timestamp, or `nil` when there is not one there.
    ///
    /// Never parses an instant: the value is a UTC wall clock, so an
    /// offset-aware parse could move the calendar day by the device's offset.
    public static func dayPrefix(_ wire: String?) -> String? {
        guard let raw = wire?.trimmingCharacters(in: .whitespaces), raw.count >= 10 else { return nil }
        let day = String(raw.prefix(10))
        let parts = day.split(separator: "-", omittingEmptySubsequences: false)
        guard parts.count == 3, parts[0].count == 4, parts[1].count == 2, parts[2].count == 2,
              parts.allSatisfy({ $0.allSatisfy(\.isNumber) }) else { return nil }
        return day
    }

    /// `dd/MM/yyyy` for the server's derived `returnDeadline`, or `nil` when
    /// there is nothing to show. The client never derives the date itself — it
    /// only formats what `DeviceListItem.returnDeadline` /
    /// `DeviceDetail.returnDeadline` already decided.
    public static func deadlineLabel(_ wire: String?) -> String? {
        guard let day = dayPrefix(wire) else { return nil }
        let parts = day.split(separator: "-")
        return "\(parts[2])/\(parts[1])/\(parts[0])"
    }

    /// Whole days from `now` to the deadline, at **calendar-day** resolution and
    /// with the same meaning as the server's `ReturnWindow.daysLeft`: `0` is
    /// "today is the last day".
    public static func daysLeft(_ wire: String?,
                               now: Date = Date(),
                               calendar: Calendar = .current) -> Int? {
        guard let day = dayPrefix(wire), let deadline = utcDay.date(from: day) else { return nil }
        let from = calendar.startOfDay(for: now)
        let to = calendar.startOfDay(for: deadline)
        return calendar.dateComponents([.day], from: from, to: to).day
    }

    /// The Vietnamese read-out next to the deadline, or `nil` when the server
    /// sent no date. Day-resolution, mirroring the web's `returnDeadlineNote`.
    public static func deadlineNote(_ wire: String?,
                                    now: Date = Date(),
                                    calendar: Calendar = .current) -> String? {
        guard let days = daysLeft(wire, now: now, calendar: calendar) else { return nil }
        if days > 0 { return "còn \(days) ngày" }
        if days == 0 { return "hôm nay là ngày cuối" }
        return "đã qua \(abs(days)) ngày"
    }

    /// The `dd/MM/yyyy` of a naive-UTC wire day. Fixed to UTC so the calendar day
    /// the server stored is the one that comes back, in every device zone.
    private static let utcDay: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        f.timeZone = TimeZone(identifier: "UTC")
        return f
    }()
}
