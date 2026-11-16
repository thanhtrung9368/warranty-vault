import Foundation

// Renewal windows — FEATURE_RESEARCH_2026-11 §6.6 (copy + store rules only).
//
// `GET /api/v1/subscriptions/{id}` carries a `renewalWindow` object while a free
// trial converted to a paid plan within the last 14 days. It is DERIVED
// server-side from rows that already exist (`Subscription.trialEndsAt` = the
// conversion day, `convertsToPrice` = the expected amount, `SubscriptionPayment`
// = the amount actually recorded). There is no new endpoint, no new column and no
// new notification kind, so this file decodes a view, never writes one.
//
// ## The three things this file exists to keep straight
//
//  1. **A recorded charge is not an expected price.** `amountRecognisedVnd` is a
//     payment the user (or the renewal cron) logged. `expectedAmountVnd` is
//     `convertsToPrice` — what the trial was supposed to become. Only the first
//     may be labelled "đã ghi nhận".
//  2. **"~2 ngày" is a calendar-day count**, computed through
//     `DeviceReturnWindow.daysLeft` → `CalendarDay.days`, never by subtracting
//     instants. `convertedOn` / `windowEndsAt` / `recognisedPaidOn` are `format:
//     date` days and stay `String` here for the same reason: parsing a day as an
//     instant moves it by one west of UTC.
//  3. **The store rules are the server's sentences.** `consentCopy` /
//     `refundCopy` are rendered by Go from the same numbers in the payload and
//     are displayed VERBATIM. Apple's `refundWindowHours` is `nil` on purpose —
//     Apple publishes no fixed refund window — so no view may turn the absence
//     into a deadline. Nothing here promises a refund.

// MARK: - Wire shapes

/// One verified store-rule row (`openapi.yaml` → `StoreRule`).
///
/// `sourceUrl` / `refundSourceUrl` / `checkedOn` travel with the row so the app
/// can show where a claim came from and when it was last checked, instead of
/// asserting a store policy from memory.
public struct StoreRule: Decodable, Sendable, Hashable, Identifiable {
    /// `APPLE` | `GOOGLE` — a machine code, stable between reads.
    public let store: String
    /// `App Store` | `Google Play`.
    public let name: String
    /// Advance notice before a price rise, per billing interval. Apple: 60 days
    /// (2-, 3-, 6-month and annual) / 27 days (monthly). Google Play: 30 / 30.
    public let annualConsentNoticeDays: Int
    public let monthlyConsentNoticeDays: Int
    /// Google's rule: a subscriber who does not accept the new price is
    /// auto-cancelled before the first charge at that price.
    public let autoCancelWithoutConsent: Bool
    /// The store's PUBLISHED fixed refund window, or `nil` when it publishes
    /// none. `nil` for Apple is the finding — do not fill it in.
    public let refundWindowHours: Int?
    /// Server-rendered, already in the app's language. Rendered verbatim.
    public let consentCopy: String
    public let refundCopy: String
    public let sourceUrl: String
    public let refundSourceUrl: String
    /// Calendar day (`YYYY-MM-DD`) the row was last verified.
    public let checkedOn: String

    public var id: String { store }
}

/// The post-conversion card's payload (`openapi.yaml` → `RenewalWindow`).
public struct RenewalWindow: Decodable, Sendable, Hashable {
    /// The day the trial ended and billing started (a calendar day).
    public let convertedOn: String
    /// Last day the card is shown (`convertedOn` + 14 days).
    public let windowEndsAt: String
    /// Earliest recorded payment on/after `convertedOn`, or `nil` when nothing
    /// was recorded. `Int64` because the wire value is int64.
    public let amountRecognisedVnd: Int64?
    /// The day of that payment, or `nil`.
    public let recognisedPaidOn: String?
    /// `convertsToPrice` — expected, never a charge.
    public let expectedAmountVnd: Int64?
    /// Both stores, because the schema does not record where the plan was bought.
    public let storeRules: [StoreRule]

    public init(convertedOn: String,
                windowEndsAt: String,
                amountRecognisedVnd: Int64? = nil,
                recognisedPaidOn: String? = nil,
                expectedAmountVnd: Int64? = nil,
                storeRules: [StoreRule] = []) {
        self.convertedOn = convertedOn
        self.windowEndsAt = windowEndsAt
        self.amountRecognisedVnd = amountRecognisedVnd
        self.recognisedPaidOn = recognisedPaidOn
        self.expectedAmountVnd = expectedAmountVnd
        self.storeRules = storeRules
    }
}

// MARK: - Pure read-outs

/// The display decisions for one `RenewalWindow`, kept out of the view so they
/// are one answer instead of an `if` in three places.
public enum RenewalWindowRules {

    /// Whole calendar days until the window closes. `0` means "today is the last
    /// day the card is shown", negative means it should not be on screen at all.
    /// `nil` when the server sent no readable day.
    public static func daysLeft(_ window: RenewalWindow,
                                now: Date = Date(),
                                calendar: Calendar = .current) -> Int? {
        DeviceReturnWindow.daysLeft(window.windowEndsAt, now: now, calendar: calendar)
    }

    /// `"~3 ngày nữa"` / `"Ngày cuối của cửa sổ"`, or `nil` when there is no
    /// readable day. The count is in CALENDAR DAYS — the number the user would
    /// get by counting squares on a wall calendar, which is why it goes through
    /// `CalendarDay` and not through a `TimeInterval`.
    public static func daysLeftLabel(_ window: RenewalWindow,
                                     now: Date = Date(),
                                     calendar: Calendar = .current) -> String? {
        guard let days = daysLeft(window, now: now, calendar: calendar) else { return nil }
        if days <= 0 { return L.t("Ngày cuối của cửa sổ") }
        if days == 1 { return L.t("~1 ngày nữa") }
        return L.t("~%d ngày nữa", days)
    }

    /// `dd/MM/yyyy` of the conversion day, or `nil` when the wire day is not
    /// readable.
    public static func convertedLabel(_ window: RenewalWindow) -> String? {
        DeviceReturnWindow.deadlineLabel(window.convertedOn)
    }

    /// `"260.000 ₫"` for the recorded charge, or `nil` when nothing was recorded.
    /// A recorded charge of 0 is still a recorded charge, so the check is on
    /// `nil`, never on the number.
    public static func recognisedAmountLabel(_ window: RenewalWindow) -> String? {
        guard let amount = window.amountRecognisedVnd else { return nil }
        return VndFormat.string(amount)
    }

    /// `dd/MM/yyyy` of the recorded payment, or `nil`.
    public static func recognisedDayLabel(_ window: RenewalWindow) -> String? {
        DeviceReturnWindow.deadlineLabel(window.recognisedPaidOn)
    }

    /// `"260.000 ₫"` for `convertsToPrice`, or `nil`. NOT a charge — the view
    /// must label it "Giá sau dùng thử", never "đã trừ".
    public static func expectedAmountLabel(_ window: RenewalWindow) -> String? {
        guard let amount = window.expectedAmountVnd else { return nil }
        return VndFormat.string(amount)
    }

    /// `dd/MM/yyyy` for a rule's verification day.
    public static func checkedOnLabel(_ rule: StoreRule) -> String? {
        DeviceReturnWindow.deadlineLabel(rule.checkedOn)
    }
}
