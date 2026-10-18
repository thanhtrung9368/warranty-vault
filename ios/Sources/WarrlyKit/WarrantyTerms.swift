import Foundation

// Warranty contract terms.
//
// A warranty row used to say only *when* cover ends. The plans that matter in
// Vietnam are contracts with economics — which part is covered, the maximum the
// insurer pays, what the user pays per claim, what is excluded — and users kept
// that in `notes`, where it is unreadable. The nine optional fields on
// `Warranty` (component, scope, cap, deductible, exclusions, region,
// transferable, claimsAllowed, claimsUsed) are that contract.
//
// This file is the pure, testable half of the feature: the derived presentation
// the form and the device-detail rows both read. No networking, no SwiftUI, so
// every rule here is covered by `WarrantyTermsTests` on a plain `swift test`.
//
// ## `claimsUsed` defaults to 0, and 0 is NOT "has terms"
//
// The contract makes `claimsUsed` a non-nullable integer with default `0`, so
// the server emits it for every warranty, including the overwhelming majority
// that have never used a claim. Treating a non-nil `claimsUsed` as "this row has
// contract terms" would expand the form section and add a terms line to every
// row in the app — the exact opposite of the "collapsed by default / unchanged
// row" requirement. `hasAnyTerms` therefore ignores `claimsUsed == 0`, and
// `claimsLabel` returns `nil` when there is no claim information at all.
//
// ## Money
//
// `cap` and `deductible` are VND, the same `Int` representation every other
// money field on the wire uses (`cost`, `purchasePrice`, `soldPrice`). They are
// formatted through `VndFormat` — the Kit's own formatter, so the pure rules
// can be asserted without SwiftUI — and never through a locale-dependent
// `NumberFormatter`.

public struct WarrantyTerms: Equatable, Sendable {

    // MARK: - Stored fields, as they travel on the wire

    /// What part this row covers. `nil` = the whole unit (see `coversWholeUnit`).
    /// A blank/whitespace-only value is normalised to `nil` so an empty text
    /// field and a null column render the same thing.
    public let component: String?

    /// What is covered, in the user's own words (e.g. "lỗi kỹ thuật").
    public let scope: String?

    /// Maximum payout in VND. `nil` = no cap recorded. `0` is a real value
    /// (a plan that pays nothing) and is deliberately kept distinct from nil.
    public let cap: Int?

    /// VND the user pays per claim. Same nil-vs-zero rule as `cap`.
    public let deductible: Int?

    /// What the contract excludes.
    public let exclusions: String?

    /// Where the cover applies (e.g. "Toàn quốc", "Chỉ Việt Nam").
    public let region: String?

    /// Whether the cover survives a resale. `nil` = not recorded; `false` is a
    /// real answer ("không chuyển nhượng được") and must not be collapsed into
    /// "unknown".
    public let transferable: Bool?

    /// How many claims the contract allows. `nil` = no limit recorded — the
    /// cover is unbounded for presentation purposes (see `hasUnboundedClaims`).
    public let claimsAllowed: Int?

    /// How many claims were used. `nil` is read as `0` (the server's default).
    public let claimsUsed: Int?

    public init(component: String? = nil,
                scope: String? = nil,
                cap: Int? = nil,
                deductible: Int? = nil,
                exclusions: String? = nil,
                region: String? = nil,
                transferable: Bool? = nil,
                claimsAllowed: Int? = nil,
                claimsUsed: Int? = nil) {
        self.component = Self.text(component)
        self.scope = Self.text(scope)
        self.cap = cap
        self.deductible = deductible
        self.exclusions = Self.text(exclusions)
        self.region = Self.text(region)
        self.transferable = transferable
        self.claimsAllowed = claimsAllowed
        self.claimsUsed = claimsUsed
    }

    /// Reads the nine fields off a loaded warranty row.
    public init(_ warranty: Warranty) {
        self.init(
            component: warranty.component,
            scope: warranty.scope,
            cap: warranty.cap,
            deductible: warranty.deductible,
            exclusions: warranty.exclusions,
            region: warranty.region,
            transferable: warranty.transferable,
            claimsAllowed: warranty.claimsAllowed,
            claimsUsed: warranty.claimsUsed
        )
    }

    /// Alias that matches `WarrantyActivation.carried(from:)` and friends, so
    /// the form has one naming convention for every full-replacement field.
    public static func carried(from warranty: Warranty) -> WarrantyTerms {
        WarrantyTerms(warranty)
    }

    /// Trims a text field and treats an empty result as "not recorded". A user
    /// who deletes the component must not end up with `component == ""` and a
    /// row that claims to cover a part with no name.
    private static func text(_ value: String?) -> String? {
        guard let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines),
              !trimmed.isEmpty
        else { return nil }
        return trimmed
    }

    // MARK: - Derived state

    /// Whether this warranty carries any contract terms at all.
    ///
    /// This is the single switch behind both presentation rules:
    ///
    ///  * the form's "Điều khoản hợp đồng" section starts expanded when it is
    ///    `true` and collapsed when it is `false`;
    ///  * a device-detail row adds its terms lines only when it is `true`, so a
    ///    row without terms looks exactly as it did before this feature.
    ///
    /// `claimsUsed == 0` does **not** count: that is the server's default for
    /// every row, not a term the user entered. Negative/odd server values are
    /// not second-guessed here beyond the `> 0` test that matters for display.
    public var hasAnyTerms: Bool {
        component != nil
            || scope != nil
            || cap != nil
            || deductible != nil
            || exclusions != nil
            || region != nil
            || transferable != nil
            || claimsAllowed != nil
            || (claimsUsed ?? 0) > 0
    }

    /// `true` when the row says the plan covers the whole unit rather than a
    /// named part. It is the `nil` half of the component-vs-whole-unit title,
    /// not a statement that the contract omits the coverage.
    public var coversWholeUnit: Bool { component == nil }

    /// The title of the terms block: the component when one is recorded, the
    /// translated "whole unit" label otherwise.
    ///
    /// The label for the no-component case is deliberately explicit — showing
    /// nothing would make "cap 5.000.000 ₫" look like it applies to the device
    /// when the contract may well cover the whole thing; showing a part name
    /// would be inventing one.
    public var componentTitle: String {
        component ?? L.t("Toàn bộ máy")
    }

    /// `"2/3"` when the contract caps claims, `"2"` when it does not (unbounded:
    /// there is no denominator to show), and `nil` when there is no claim
    /// information at all.
    ///
    /// A cap with no used count reads as `"0/3"` — the server's default is 0,
    /// and a contract that allows three claims has used none of them until
    /// recorded otherwise. No cap and no used claims is `nil`, not `"0/∞"`:
    /// nothing has been recorded and the row should say nothing.
    public var claimsLabel: String? {
        let used = claimsUsed ?? 0
        guard let allowed = claimsAllowed else {
            return used > 0 ? "\(used)" : nil
        }
        return "\(used)/\(allowed)"
    }

    /// `true` when a claim count is recorded but no allowance is — the contract
    /// does not limit how many claims can be made. The row appends a translated
    /// "unbounded" note to `claimsLabel` so `"2"` does not read as a typo for
    /// `"2/3"`.
    public var hasUnboundedClaims: Bool {
        claimsAllowed == nil && (claimsUsed ?? 0) > 0
    }

    /// The server's only cross-field rule for these terms:
    /// `claimsUsed > claimsAllowed` is a 400 (`fieldErrors.claimsUsed`).
    ///
    /// Checked locally as well so the form can disable its save button and say
    /// why before a round trip. The server remains the authority; this is only
    /// the same rule stated once, in the pure layer, so it is testable.
    public var hasClaimsConflict: Bool {
        guard let allowed = claimsAllowed, let used = claimsUsed else { return false }
        return used > allowed
    }

    /// `"5.000.000 ₫"`, or `nil` when no cap is recorded.
    public var capLabel: String? { cap.map { VndFormat.string(Int64($0)) } }

    /// `"500.000 ₫"`, or `nil` when no deductible is recorded.
    public var deductibleLabel: String? {
        deductible.map { VndFormat.string(Int64($0)) }
    }

    /// The three-state transferable value rendered as text: `"Có"` / `"Không"`,
    /// or `nil` when the contract does not say.
    public var transferableLabel: String? {
        guard let transferable else { return nil }
        return transferable ? L.t("Có") : L.t("Không")
    }

    // MARK: - Form round trip

    /// Writes all nine fields onto the payload a warranty create/update is about
    /// to send.
    ///
    /// Applied on **every** save path from the form. The form always builds the
    /// input from its current fields, so a user who clears the section clears
    /// the stored contract too — the same full-replacement convention the rest
    /// of this form follows.
    ///
    /// `claimsUsed` is written as `0` when the field is empty. That is
    /// deliberate and specific to this key: the contract says an **absent**
    /// `claimsUsed` on update means "keep the stored counter" (so an older
    /// client cannot wipe it), while a concrete number — including `0` — sets
    /// it. The form carries the loaded value on an ordinary save and writes an
    /// explicit `0` when the user clears the field, which is what makes clearing
    /// actually clear. Leaving it `nil` here would silently preserve a counter
    /// the user just erased.
    public func apply(to input: inout WarrantyInput) {
        input.component = component
        input.scope = scope
        input.cap = cap
        input.deductible = deductible
        input.exclusions = exclusions
        input.region = region
        input.transferable = transferable
        input.claimsAllowed = claimsAllowed
        input.claimsUsed = claimsUsed ?? 0
    }
}
