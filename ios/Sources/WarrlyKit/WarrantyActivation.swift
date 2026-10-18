import Foundation

// Warranty activation and the extended-cover purchase deadline (Feature A).
//
// In Vietnam a warranty often starts with a retailer action, not the invoice:
// Samsung/Sony/LG/Xiaomi e-warranty activation is what the service centre looks
// up, and an unactivated machine can be refused at the counter even with a valid
// receipt. Separately, extended cover (AppleCare+, Samsung Care+) has a purchase
// window that closes forever. Those are two different dates, and neither can be
// derived from `purchaseDate`:
//
//   * `activationRequired` — the warranty only starts once the retailer activates;
//   * `activatedAt`        — when it was activated (may be **before**
//                            `purchaseDate`; a shop can pre-activate, and that
//                            combination is explicitly allowed, not blocked);
//   * `extendedCoverBuyBy` — the last day the extended plan can be bought.
//
// This file is the pure, testable half: the form round trip, the derived
// activation state and the buy-by countdown. No networking and no SwiftUI, so
// every rule here is covered by `WarrantyActivationTests` on a plain `swift test`.
//
// ## Why the wire dates stay `String`
//
// Both dates are calendar days to the user, exactly like `soldAt` / `receivedAt`
// / the return deadline. `PATCH /api/v1/devices/{id}` replaces the whole row, so
// a day that is read as an instant and written back in another anchor silently
// moves (the bug `WireDay` and `DeviceReturnWindow` exist to prevent). Reading the
// day prefix off the wire string and writing the same `YYYY-MM-DD` back keeps the
// day stable in every time zone. A value that is never parsed cannot drift.
//
// `activatedAt` on the read side is therefore optional and may arrive in any of
// the shapes the server emits (`…Z`, offset-less, or a bare day); only its
// calendar day is ever used.

/// The three activation fields, exactly as they must travel into `DeviceInput`.
///
/// The initializer normalises both wire dates to their `YYYY-MM-DD` day prefix,
/// so `carried(from:)` and a hand-built form value cannot disagree about what a
/// "date" is.
public struct ActivationFields: Equatable, Sendable {
    /// `true` = the warranty starts only after the retailer activates the device.
    /// The server's default is `false`; an older payload that omits the key also
    /// reads as `false`.
    public let activationRequired: Bool

    /// `YYYY-MM-DD`, or `nil` when the device has not been activated (or the date
    /// was never recorded). This is deliberately independent of
    /// `activationRequired`: a pre-activated device may carry a date while the
    /// flag is off, and a device that requires activation may not have been
    /// activated yet.
    public let activatedAt: String?

    /// `YYYY-MM-DD` — the last day extended cover can be bought — or `nil` when
    /// the user is not tracking it.
    public let extendedCoverBuyBy: String?

    public init(activationRequired: Bool, activatedAt: String?, extendedCoverBuyBy: String?) {
        self.activationRequired = activationRequired
        self.activatedAt = DeviceReturnWindow.dayPrefix(activatedAt)
        self.extendedCoverBuyBy = DeviceReturnWindow.dayPrefix(extendedCoverBuyBy)
    }

    /// Nothing recorded: activation not required and neither date set. What a
    /// device that has never seen either feature carries.
    public static let none = ActivationFields(
        activationRequired: false,
        activatedAt: nil,
        extendedCoverBuyBy: nil
    )
}

public enum WarrantyActivation {

    // MARK: - Derived state

    /// The activation state the UI renders.
    ///
    /// The three cases are not two: "not required" is a real answer (the invoice
    /// already starts the warranty), while "required and not activated" is the
    /// state a user must act on. An activation date always wins over the flag —
    /// if the device was activated, it was activated, whether or not this client
    /// thinks activation was required.
    public enum State: Equatable, Sendable {
        case notRequired
        case requiredNotActivated
        /// Activated on the stored calendar day (`YYYY-MM-DD`).
        case activated(on: String)
    }

    public static func state(activationRequired: Bool, activatedAt: String?) -> State {
        if let day = DeviceReturnWindow.dayPrefix(activatedAt) {
            return .activated(on: day)
        }
        return activationRequired ? .requiredNotActivated : .notRequired
    }

    public static func state(_ fields: ActivationFields) -> State {
        state(activationRequired: fields.activationRequired,
              activatedAt: fields.activatedAt)
    }

    /// `"Chưa kích hoạt"` / `"Đã kích hoạt ngày 02/03/2026"`, or `nil` when the
    /// device does not require activation and has no activation date. `nil` is
    /// why the detail screen can omit the row instead of claiming "not required"
    /// on every ordinary device.
    public static func statusLabel(_ state: State) -> String? {
        switch state {
        case .notRequired:
            return nil
        case .requiredNotActivated:
            return L.t("Chưa kích hoạt")
        case let .activated(on: day):
            let label = DeviceReturnWindow.deadlineLabel(day) ?? day
            return L.t("Đã kích hoạt ngày %@", label)
        }
    }

    public static func statusLabel(_ fields: ActivationFields) -> String? {
        statusLabel(state(fields))
    }

    /// Whether the detail screen has any activation/cover information to draw.
    /// False for the overwhelmingly common device that never opted into either
    /// feature, so the section is not rendered as an empty shell.
    public static func isVisible(_ fields: ActivationFields) -> Bool {
        state(fields) != .notRequired || fields.extendedCoverBuyBy != nil
    }

    // MARK: - The form round trip

    /// Wire → request. `nil` stays `nil`; an unreadable date degrades to `nil`
    /// rather than being invented. `activationRequired == nil` (an older server)
    /// reads as the documented default `false`.
    public static func carried(activationRequired: Bool?,
                               activatedAt: String?,
                               extendedCoverBuyBy: String?) -> ActivationFields {
        ActivationFields(
            activationRequired: activationRequired ?? false,
            activatedAt: activatedAt,
            extendedCoverBuyBy: extendedCoverBuyBy
        )
    }

    /// The same mapping, straight off a loaded device.
    public static func carried(from device: Device) -> ActivationFields {
        carried(activationRequired: device.activationRequired,
                activatedAt: device.activatedAt,
                extendedCoverBuyBy: device.extendedCoverBuyBy)
    }

    /// The same mapping, off a device detail payload.
    public static func carried(from device: DeviceDetailBody) -> ActivationFields {
        carried(activationRequired: device.activationRequired,
                activatedAt: device.activatedAt,
                extendedCoverBuyBy: device.extendedCoverBuyBy)
    }

    /// Writes the three fields onto the payload a save is about to send.
    ///
    /// Applied on **every** save path, including the status-only PATCH on the
    /// detail screen: `PATCH /api/v1/devices/{id}` replaces the whole device, so
    /// a save that omitted these keys would erase an activation recorded on the
    /// web or on Android. `nil` dates are dropped by the synthesized encoder,
    /// which Go reads exactly like an explicit `null` — the documented "clear it".
    public static func apply(_ fields: ActivationFields, to input: inout DeviceInput) {
        input.activationRequired = fields.activationRequired
        input.activatedAt = DeviceReturnWindow.dayPrefix(fields.activatedAt)
        input.extendedCoverBuyBy = DeviceReturnWindow.dayPrefix(fields.extendedCoverBuyBy)
    }

    // MARK: - The buy-by countdown

    /// Whole calendar days from `now` to the extended-cover deadline. `0` means
    /// "today is the last day", and negative values mean the window has closed.
    ///
    /// Delegates to `DeviceReturnWindow.daysLeft`, which anchors both sides in the
    /// caller's calendar: the wire value is a calendar day, not an instant, so a
    /// UTC-pinned parse would be one day short west of UTC.
    public static func buyByDaysLeft(_ wire: String?,
                                     now: Date = Date(),
                                     calendar: Calendar = .current) -> Int? {
        DeviceReturnWindow.daysLeft(wire, now: now, calendar: calendar)
    }

    /// `"còn 3 ngày"` / `"hôm nay là ngày cuối"` / `"đã qua 2 ngày"` — the same
    /// day-resolution copy (and the same catalog keys) the return-window deadline
    /// uses. `nil` when no buy-by date is recorded.
    public static func buyByNote(_ wire: String?,
                                 now: Date = Date(),
                                 calendar: Calendar = .current) -> String? {
        DeviceReturnWindow.deadlineNote(wire, now: now, calendar: calendar)
    }

    /// `dd/MM/yyyy` for a wire day, or `nil` when there is nothing readable.
    public static func dayLabel(_ wire: String?) -> String? {
        DeviceReturnWindow.deadlineLabel(wire)
    }
}
