import Foundation

// Subscription trial (Feature B): `trialEndsAt` and the price the plan converts
// to when the free period ends.
//
// A trial that converts while the user is still deciding is the expensive
// mistake, and a renewal date cannot express "free until 12 Nov, then 260k".
//
// The frozen write contract has one pair rule:
//
//   * `convertsToPrice` **without** `trialEndsAt` is a 400 with
//     `fieldErrors.convertsToPrice`. The form must never be able to build that
//     combination, and every carry-back save (the status segmented control)
//     must not resurrect it either.
//
// `SubscriptionTrialFields` therefore enforces the pair in its initializer: a
// price with no readable trial day is dropped to `nil` rather than put on the
// wire on its own. That is the same all-or-nothing shape `ResaleFields` uses for
// `soldAt` / `soldPrice`.
//
// ## Why the trial date stays `String`
//
// Like `activatedAt`, `receivedAt` and `soldAt`, it is a calendar day on screen.
// The server may emit `…Z`, offset-less time or a bare day; only the day prefix
// is ever read, and `YYYY-MM-DD` is written back. Parsing it as an instant would
// let the day slide by one in a negative-offset zone.
//
// `SubscriptionInput.leadDays` is deliberately different: an absent key there
// means "keep the stored schedule". `trialEndsAt` follows the rest of the
// subscription write fields — `PATCH` replaces the row, so an absent date is the
// documented "clear it".

/// The trial pair, exactly as it must travel into `SubscriptionInput`.
public struct SubscriptionTrialFields: Equatable, Sendable {
    /// `YYYY-MM-DD`, or `nil` when there is no timed free period.
    public let trialEndsAt: String?

    /// VND to be charged after the trial, or `nil` when the user has not recorded
    /// it. The initializer clears this whenever there is no trial day: the wire
    /// rejects a price on its own with `fieldErrors.convertsToPrice`.
    public let convertsToPrice: Int?

    public init(trialEndsAt: String?, convertsToPrice: Int?) {
        let day = DeviceReturnWindow.dayPrefix(trialEndsAt)
        self.trialEndsAt = day
        self.convertsToPrice = day == nil ? nil : convertsToPrice
    }

    /// No trial: no end date and no conversion price.
    public static let none = SubscriptionTrialFields(trialEndsAt: nil, convertsToPrice: nil)
}

public enum SubscriptionTrial {

    // MARK: - Derived label

    /// Which price label the detail screen should draw.
    ///
    /// `renewal` is not an error: a subscription without a trial keeps its
    /// ordinary renewal date. It exists so the two labels are one testable
    /// decision rather than an `if` scattered through the view.
    public enum Phase: Equatable, Sendable {
        case trial(endsOn: String)
        case renewal
    }

    public static func phase(trialEndsAt: String?) -> Phase {
        guard let day = DeviceReturnWindow.dayPrefix(trialEndsAt) else { return .renewal }
        return .trial(endsOn: day)
    }

    public static func phase(_ fields: SubscriptionTrialFields) -> Phase {
        phase(trialEndsAt: fields.trialEndsAt)
    }

    /// `"DÙNG THỬ ĐẾN"` while a trial is recorded, otherwise the existing
    /// `"GIA HẠN TỚI"` heading. The date itself is formatted by the caller (the
    /// detail screen already has a locale-aware day formatter).
    public static func termHeading(trialEndsAt: String?) -> String {
        switch phase(trialEndsAt: trialEndsAt) {
        case .trial:
            return L.t("DÙNG THỬ ĐẾN")
        case .renewal:
            return L.t("GIA HẠN TỚI")
        }
    }

    public static func termHeading(_ fields: SubscriptionTrialFields) -> String {
        termHeading(trialEndsAt: fields.trialEndsAt)
    }

    /// The post-trial price as money, or `nil` when there is no trial or no price
    /// recorded. The detail screen hides the row on `nil` rather than showing a
    /// price the server never gave it.
    public static func priceLabel(trialEndsAt: String?,
                                  convertsToPrice: Int?) -> String? {
        guard case .trial = phase(trialEndsAt: trialEndsAt),
              let convertsToPrice else { return nil }
        return VndFormat.string(Int64(convertsToPrice))
    }

    public static func priceLabel(_ fields: SubscriptionTrialFields) -> String? {
        priceLabel(trialEndsAt: fields.trialEndsAt,
                   convertsToPrice: fields.convertsToPrice)
    }

    /// `dd/MM/yyyy` for the trial end day, or `nil` when there is no trial.
    public static func dayLabel(_ wire: String?) -> String? {
        DeviceReturnWindow.deadlineLabel(wire)
    }

    // MARK: - The form round trip

    /// Wire → request, enforcing the pair. A `convertsToPrice` that arrives
    /// without a trial day is dropped: sending it back alone is the server's
    /// `fieldErrors.convertsToPrice` 400.
    public static func carried(trialEndsAt: String?,
                               convertsToPrice: Int?) -> SubscriptionTrialFields {
        SubscriptionTrialFields(trialEndsAt: trialEndsAt,
                                convertsToPrice: convertsToPrice)
    }

    public static func carried(from subscription: Subscription) -> SubscriptionTrialFields {
        carried(trialEndsAt: subscription.trialEndsAt,
                convertsToPrice: subscription.convertsToPrice)
    }

    /// Writes the pair onto the payload a save is about to send.
    ///
    /// Used by the form **and** by `SubscriptionsStore.setStatus`, so a tap on
    /// "Tạm dừng" cannot silently clear a trial recorded elsewhere (the PATCH
    /// replaces the row) and cannot send the rejected price-without-date pair.
    public static func apply(_ fields: SubscriptionTrialFields,
                             to input: inout SubscriptionInput) {
        let day = DeviceReturnWindow.dayPrefix(fields.trialEndsAt)
        input.trialEndsAt = day
        input.convertsToPrice = day == nil ? nil : fields.convertsToPrice
    }
}
