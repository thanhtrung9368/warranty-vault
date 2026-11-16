import Foundation

// ============================================================
// Warranty-card extraction — wire type, summary and the merge rule
// (`POST /api/v1/ai/extract-warranty-card`, FEATURE_RESEARCH_2026-11 §6.3)
//
// The endpoint reads the nine contract-term columns (migration 0017) off a
// warranty card and returns a DRAFT. It never creates a Warranty or a Device,
// and it has no `type` / `months` / date fields: a paper card does not say
// STANDARD/EXTENDED/THIRD_PARTY and cannot supply the start date a month count
// would need.
//
// The merge rule is the part that protects the user's own typing:
//
//   * an EMPTY form field is filled from the card;
//   * a field the user already filled is NEVER overwritten — if the card differs
//     it is reported as a mismatch so the form can show "Trên thẻ: …";
//   * nothing is saved automatically.
//
// Keeping that decision here (rather than in the SwiftUI form) is what lets the
// web client implement the identical rule and both remain reviewable.
// ============================================================

/// One non-blocking advisory from the card draft (openapi `WarrantyCardWarning`).
///
/// The server writes `message` in the request language, so the UI renders it
/// verbatim. `code` is stable contract and drives nothing visual beyond grouping;
/// an unknown code (newer server) still renders its message.
public struct WarrantyCardWarning: Decodable, Sendable, Equatable, Hashable, Identifiable {
    public let code: String
    public let field: String
    public let message: String

    public var id: String { code + ":" + field + ":" + message }

    public init(code: String, field: String, message: String) {
        self.code = code
        self.field = field
        self.message = message
    }

    private enum CodingKeys: String, CodingKey { case code, field, message }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        code = (try? c.decodeIfPresent(String.self, forKey: .code)) ?? ""
        field = (try? c.decodeIfPresent(String.self, forKey: .field)) ?? ""
        message = (try? c.decodeIfPresent(String.self, forKey: .message)) ?? ""
    }
}

/// Draft of the nine contract terms (`WarrantyCardDraft` in openapi).
///
/// Every term is optional: `nil` means "the card does not say" OR "the server
/// dropped the value" (the latter is listed in `unmatched`). `transferable`
/// stays a tri-state: `nil` is "not stated", which is NOT `false`.
public struct WarrantyCardDraft: Decodable, Sendable, Equatable {
    public let component: String?
    public let scope: String?
    public let cap: Int?
    public let deductible: Int?
    public let exclusions: String?
    public let region: String?
    public let transferable: Bool?
    public let claimsAllowed: Int?
    public let claimsUsed: Int?

    /// "high" | "medium" | "low"; an absent/unknown class reads as "low".
    public let confidence: String
    /// Fields whose value was dropped — the form asks the user to fill them in.
    public let unmatched: [String]
    /// Why each drop happened / why the whole-unit plan was kept.
    public let warnings: [WarrantyCardWarning]
    /// True only when the server actually stored the transcript on the attachment.
    public let extractedTextStored: Bool

    public init(
        component: String? = nil, scope: String? = nil, cap: Int? = nil,
        deductible: Int? = nil, exclusions: String? = nil, region: String? = nil,
        transferable: Bool? = nil, claimsAllowed: Int? = nil, claimsUsed: Int? = nil,
        confidence: String = "low", unmatched: [String] = [],
        warnings: [WarrantyCardWarning] = [], extractedTextStored: Bool = false
    ) {
        self.component = component
        self.scope = scope
        self.cap = cap
        self.deductible = deductible
        self.exclusions = exclusions
        self.region = region
        self.transferable = transferable
        self.claimsAllowed = claimsAllowed
        self.claimsUsed = claimsUsed
        self.confidence = confidence
        self.unmatched = unmatched
        self.warnings = warnings
        self.extractedTextStored = extractedTextStored
    }

    private enum CodingKeys: String, CodingKey {
        case component, scope, cap, deductible, exclusions, region, transferable,
             claimsAllowed, claimsUsed, confidence, unmatched, warnings,
             extractedTextStored
    }

    /// Tolerant decode: the arrays and the stored flag are always sent by the
    /// current server, but a draft must not fail to decode because one optional
    /// envelope key is missing. Unknown confidence degrades to "low" — a draft
    /// whose certainty cannot be classified must not look more certain.
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        component = try? c.decodeIfPresent(String.self, forKey: .component)
        scope = try? c.decodeIfPresent(String.self, forKey: .scope)
        cap = try? c.decodeIfPresent(Int.self, forKey: .cap)
        deductible = try? c.decodeIfPresent(Int.self, forKey: .deductible)
        exclusions = try? c.decodeIfPresent(String.self, forKey: .exclusions)
        region = try? c.decodeIfPresent(String.self, forKey: .region)
        transferable = try? c.decodeIfPresent(Bool.self, forKey: .transferable)
        claimsAllowed = try? c.decodeIfPresent(Int.self, forKey: .claimsAllowed)
        claimsUsed = try? c.decodeIfPresent(Int.self, forKey: .claimsUsed)
        let rawConfidence = ((try? c.decodeIfPresent(String.self, forKey: .confidence)) ?? nil) ?? ""
        switch rawConfidence.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
        case "high":   confidence = "high"
        case "medium": confidence = "medium"
        default:       confidence = "low"
        }
        unmatched = ((try? c.decodeIfPresent([String].self, forKey: .unmatched)) ?? nil) ?? []
        warnings = ((try? c.decodeIfPresent([WarrantyCardWarning].self, forKey: .warnings)) ?? nil) ?? []
        extractedTextStored =
            ((try? c.decodeIfPresent(Bool.self, forKey: .extractedTextStored)) ?? nil) ?? false
    }
}

/// The nine contract-term values as the warranty form holds them. A string is
/// "empty" when it is nil/blank; a number when it is nil; `transferable` when it
/// is nil (the tri-state's "not stated").
public struct WarrantyCardValues: Equatable, Sendable {
    public var component: String?
    public var scope: String?
    public var cap: Int?
    public var deductible: Int?
    public var exclusions: String?
    public var region: String?
    public var transferable: Bool?
    public var claimsAllowed: Int?
    public var claimsUsed: Int?

    public init(
        component: String? = nil, scope: String? = nil, cap: Int? = nil,
        deductible: Int? = nil, exclusions: String? = nil, region: String? = nil,
        transferable: Bool? = nil, claimsAllowed: Int? = nil, claimsUsed: Int? = nil
    ) {
        self.component = Self.clean(component)
        self.scope = Self.clean(scope)
        self.cap = cap
        self.deductible = deductible
        self.exclusions = Self.clean(exclusions)
        self.region = Self.clean(region)
        self.transferable = transferable
        self.claimsAllowed = claimsAllowed
        self.claimsUsed = claimsUsed
    }

    /// Blank strings become nil: the form's text fields are `String` and use ""
    /// for empty, and "empty" must be one value in the merge rule.
    static func clean(_ raw: String?) -> String? {
        guard let raw else { return nil }
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    public var isEmpty: Bool { self == WarrantyCardValues() }

    /// The display form for one field, used by the sheet's summary and by the
    /// "Trên thẻ: …" mismatch rows. Money is rendered as đồng, counts as plain
    /// numbers, transferable as Có/Không.
    public func displayValue(for field: WarrantyCardField) -> String? {
        switch field {
        case .component:    return component
        case .scope:        return scope
        case .cap:          return cap.map { VndFormat.string(Int64($0)) }
        case .deductible:   return deductible.map { VndFormat.string(Int64($0)) }
        case .exclusions:   return exclusions
        case .region:       return region
        case .transferable:
            switch transferable {
            case .some(true):  return L.t("Có")
            case .some(false): return L.t("Không")
            case .none:        return nil
            }
        case .claimsAllowed: return claimsAllowed.map(String.init)
        case .claimsUsed:    return claimsUsed.map(String.init)
        }
    }
}

/// The nine contract fields, in the order the form renders them.
public enum WarrantyCardField: String, CaseIterable, Sendable, Hashable, Identifiable {
    case component, scope, cap, deductible, exclusions, region, transferable,
         claimsAllowed, claimsUsed

    public var id: String { rawValue }

    /// Localised row label. It matches `WarrantyFormView`'s own labels, and the
    /// Vietnamese strings are already catalog keys (the nine fields shipped with
    /// the contract-terms section), so this adds no new copy.
    public var label: String {
        switch self {
        case .component:     return L.t("Bộ phận")
        case .scope:         return L.t("Phạm vi")
        case .cap:           return L.t("Mức tối đa")
        case .deductible:    return L.t("Khấu trừ")
        case .exclusions:    return L.t("Loại trừ")
        case .region:        return L.t("Khu vực")
        case .transferable:  return L.t("Chuyển nhượng")
        case .claimsAllowed: return L.t("Số lần BH")
        case .claimsUsed:    return L.t("Đã dùng")
        }
    }
}

/// A field the user already filled with a value that differs from the card.
/// The form keeps the user's value and shows `cardValue` as "Trên thẻ: …".
public struct WarrantyCardMismatch: Equatable, Sendable, Identifiable {
    public let field: WarrantyCardField
    public let cardValue: String
    public var id: String { field.rawValue }
    public var label: String { field.label }

    public init(field: WarrantyCardField, cardValue: String) {
        self.field = field
        self.cardValue = cardValue
    }
}

/// One non-empty term of the card, for the scan sheet's review list.
public struct WarrantyCardReadValue: Equatable, Sendable, Identifiable {
    public let field: WarrantyCardField
    public let label: String
    public let value: String
    public var id: String { field.rawValue }

    public init(field: WarrantyCardField, label: String, value: String) {
        self.field = field
        self.label = label
        self.value = value
    }
}

/// Result of merging a draft into what the form already holds.
public struct WarrantyCardMerge: Equatable, Sendable {
    /// Values to write into the form: only fields that were EMPTY and non-nil
    /// on the card.
    public let filled: WarrantyCardValues
    /// Fields kept from the user because they were already filled differently.
    public let mismatches: [WarrantyCardMismatch]

    public init(filled: WarrantyCardValues, mismatches: [WarrantyCardMismatch]) {
        self.filled = filled
        self.mismatches = mismatches
    }

    public var hasFilledValues: Bool { !filled.isEmpty }
    public var hasMismatches: Bool { !mismatches.isEmpty }
}

public enum WarrantyCardRules {

    /// Merge a draft into the current form values.
    ///
    /// The three-way outcome per field:
    ///   - form empty + card has a value → fill it;
    ///   - form filled with the SAME value → nothing;
    ///   - form filled with a DIFFERENT value → keep the user's value, report
    ///     "Trên thẻ: <card value>" (never overwrite — the user typed it, and the
    ///     card may have been read wrong).
    public static func merge(draft: WarrantyCardDraft,
                             into current: WarrantyCardValues) -> WarrantyCardMerge {
        let card = values(from: draft)
        var filled = WarrantyCardValues()
        var mismatches: [WarrantyCardMismatch] = []

        func merge<T: Equatable>(_ field: WarrantyCardField, cardValue: T?,
                                 currentValue: T?, display: (T) -> String,
                                 assign: (T?) -> Void) {
            guard let cardValue else { return }
            guard let currentValue else {
                assign(cardValue)
                return
            }
            if currentValue != cardValue {
                mismatches.append(WarrantyCardMismatch(field: field, cardValue: display(cardValue)))
            }
        }

        merge(.component, cardValue: card.component, currentValue: current.component,
              display: { $0 }) { filled.component = $0 }
        merge(.scope, cardValue: card.scope, currentValue: current.scope,
              display: { $0 }) { filled.scope = $0 }
        merge(.cap, cardValue: card.cap, currentValue: current.cap,
              display: { VndFormat.string(Int64($0)) }) { filled.cap = $0 }
        merge(.deductible, cardValue: card.deductible, currentValue: current.deductible,
              display: { VndFormat.string(Int64($0)) }) { filled.deductible = $0 }
        merge(.exclusions, cardValue: card.exclusions, currentValue: current.exclusions,
              display: { $0 }) { filled.exclusions = $0 }
        merge(.region, cardValue: card.region, currentValue: current.region,
              display: { $0 }) { filled.region = $0 }
        merge(.transferable, cardValue: card.transferable, currentValue: current.transferable,
              display: { $0 ? L.t("Có") : L.t("Không") }) { filled.transferable = $0 }
        merge(.claimsAllowed, cardValue: card.claimsAllowed, currentValue: current.claimsAllowed,
              display: { String($0) }) { filled.claimsAllowed = $0 }
        merge(.claimsUsed, cardValue: card.claimsUsed, currentValue: current.claimsUsed,
              display: { String($0) }) { filled.claimsUsed = $0 }

        return WarrantyCardMerge(filled: filled, mismatches: mismatches)
    }

    /// The card's values as a `WarrantyCardValues`, trimmed. Used by the merge
    /// and by the sheet's "what was read" summary.
    public static func values(from draft: WarrantyCardDraft) -> WarrantyCardValues {
        WarrantyCardValues(
            component: draft.component, scope: draft.scope, cap: draft.cap,
            deductible: draft.deductible, exclusions: draft.exclusions,
            region: draft.region, transferable: draft.transferable,
            claimsAllowed: draft.claimsAllowed, claimsUsed: draft.claimsUsed
        )
    }

    /// One row per non-empty term, for the scan sheet's review list. Order is
    /// the form's order so the user can match it to the fields underneath.
    public static func summary(from draft: WarrantyCardDraft) -> [WarrantyCardReadValue] {
        let values = values(from: draft)
        return WarrantyCardField.allCases.compactMap { field in
            guard let value = values.displayValue(for: field) else { return nil }
            return WarrantyCardReadValue(field: field, label: field.label, value: value)
        }
    }

    /// The fields named in `unmatched[]`, for the "you type these yourself" note.
    /// Unknown names are kept as-is rather than dropped: a newer server naming a
    /// field this build does not know still has to tell the user something.
    public static func unmatchedLabels(from draft: WarrantyCardDraft) -> [String] {
        draft.unmatched.map { raw in
            let name = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            guard let field = WarrantyCardField(rawValue: name) else { return name }
            return field.label
        }
        .filter { !$0.isEmpty }
    }
}
