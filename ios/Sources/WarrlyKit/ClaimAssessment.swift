import Foundation

// ============================================================
// AI claim assessment — the pure half
//
// The API (`POST /api/v1/ai/assess-claim`, frozen contract) answers with a
// coverage class, a confidence class, reasoning, questions and a Vietnamese
// draft letter. This file owns the decisions the result screen is not allowed
// to make for itself:
//
//   1. **Advice, not a verdict.** `LIKELY_COVERED` is not "approved". Every
//      headline is hedged and every result carries `disclaimer`, which says in
//      plain words that the service centre decides. A screen that renders the
//      class as an outcome sends a user to a counter expecting a free repair.
//   2. **Confidence is attached, never implied.** The label and a sentence
//      explaining what it means travel together with the coverage.
//   3. **`UNCLEAR` with questions is a success.** `questionsIntro` is the
//      selector that says so; the questions are the deliverable, not the
//      absence of a verdict.
//   4. **The letter is Vietnamese on purpose.** `letterLanguageNote` is the
//      copy that stops the UI from "helpfully" translating it.
//   5. **The gates are states, not errors.** `ClaimAssessmentGate` maps the
//      opt-in (client-side flag) and the two documented server refusals (403
//      `ai_optin_required`, 503 `feature_disabled`) into the three surfaces.
//
// Everything here is language-dependent copy through `L.t` and computed on
// every access, so pinning `L.language` in a test changes it immediately.
// ============================================================

/// The state of the AI assessment surface before a result exists.
///
/// `ready` is also the state when the opt-in read failed: an unreadable flag
/// must not block a feature the user may well have enabled. The server is the
/// authority and answers 403 if it is actually off — that answer is mapped back
/// to `.optInOff` by `from(error:)`.
public enum ClaimAssessmentGate: Equatable, Sendable {
    /// Opt-in is on (or unknown) and the feature has not refused yet.
    case ready
    /// The user has not enabled the shared AI opt-in (403 `ai_optin_required`).
    case optInOff
    /// The server has no model key (503 `feature_disabled`). Not an error:
    /// nothing the user can fix, and the rest of the app works normally.
    case featureDisabled

    /// Client-side gate from the AI opt-in flag.
    ///
    /// `nil` (the read has not completed or failed) is `.ready` on purpose; see
    /// the type doc. Only an explicit `false` blocks the call.
    public init(aiOptIn: Bool?) {
        self = aiOptIn == false ? .optInOff : .ready
    }

    /// The gate a thrown `APIError` represents, or `nil` when it is an ordinary
    /// failure that the screen should render as such.
    ///
    /// Only the exact documented pair is a gate: a 403 with another code is a
    /// different authorization problem, and a 503 with another code is not
    /// "the AI feature is disabled". Matching is case-insensitive and tolerates
    /// surrounding whitespace, mirroring `ClaimRules.saveFailure`'s treatment of
    /// the wire's lowercase `limit_reached`.
    public static func from(error: Error) -> ClaimAssessmentGate? {
        guard let apiError = error as? APIError,
              case let .server(status, envelope) = apiError
        else { return nil }

        let code = envelope.error
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
        switch (status, code) {
        case (403, "ai_optin_required"): return .optInOff
        case (503, "feature_disabled"):  return .featureDisabled
        default:                         return nil
        }
    }

    public var isReady: Bool { self == .ready }
    public var needsOptIn: Bool { self == .optInOff }
    public var isFeatureDisabled: Bool { self == .featureDisabled }
}

/// The copy one result screen renders, selected from coverage + confidence.
///
/// Built only by `ClaimAssessmentRules.advice(for:confidence:)`, so a caller
/// cannot accidentally show a coverage without the confidence or the
/// disclaimer that belongs with it.
public struct ClaimAssessmentAdvice: Equatable, Sendable {
    /// The coverage label, hedged by construction.
    public let headline: String
    /// One sentence explaining what that class means in practice.
    public let summary: String
    /// "Thấp" / "Trung bình" / "Cao" in the selected language.
    public let confidenceLabel: String
    /// What the confidence level does (and does not) license.
    public let confidenceNote: String
    /// Always shown. The service centre decides.
    public let disclaimer: String
}

public enum ClaimAssessmentRules {

    // MARK: - Advice copy (the "advice, not verdict" selector)

    /// The sentence every result screen must render, in the selected language.
    public static var disclaimer: String {
        L.t("Đây là ý kiến tham khảo từ AI, không phải quyết định bảo hành. Trung tâm bảo hành là bên quyết định.")
    }

    /// The line that labels the draft letter as Vietnamese on purpose.
    public static var letterLanguageNote: String {
        L.t("Thư này được viết bằng tiếng Việt có chủ đích vì trung tâm bảo hành sẽ đọc nó. App không tự dịch.")
    }

    /// Selects all copy for a result. Confidence is never optional: the caller
    /// has to pass it, so the screen cannot render coverage without the caveat.
    public static func advice(
        for coverage: ClaimAssessmentCoverage,
        confidence: ClaimAssessmentConfidence
    ) -> ClaimAssessmentAdvice {
        ClaimAssessmentAdvice(
            headline: coverage.label,
            summary: summary(for: coverage),
            confidenceLabel: confidence.label,
            confidenceNote: confidenceNote(for: confidence),
            disclaimer: disclaimer
        )
    }

    /// One sentence per coverage class.
    ///
    /// `LIKELY_NOT_COVERED` deliberately does not say "rejected": the service
    /// centre has not seen the device yet, and the user still has a
    /// conversation to have. It also points at the documents that help.
    public static func summary(for coverage: ClaimAssessmentCoverage) -> String {
        switch coverage {
        case .LIKELY_COVERED:
            return L.t("Dựa trên điều khoản đang lưu, lỗi này có khả năng nằm trong phạm vi bảo hành. Đây vẫn chỉ là gợi ý — hãy mang giấy tờ và để trung tâm bảo hành xác nhận.")
        case .UNCLEAR:
            return L.t("Thông tin đang lưu chưa đủ để nói chắc. Những câu hỏi bên dưới là thứ trung tâm thường hỏi — trả lời được càng nhiều càng tốt.")
        case .LIKELY_NOT_COVERED:
            return L.t("Dựa trên điều khoản đang lưu, lỗi này có khả năng nằm ngoài phạm vi bảo hành. Bạn vẫn nên trao đổi với trung tâm, và mang theo hoá đơn hoặc giấy tờ liên quan.")
        }
    }

    /// What a confidence level means for the decision the user is about to make.
    public static func confidenceNote(for confidence: ClaimAssessmentConfidence) -> String {
        switch confidence {
        case .LOW:
            return L.t("Thông tin còn thiếu nên độ tin cậy thấp. Đừng dựa vào đây để quyết định.")
        case .MEDIUM:
            return L.t("Độ tin cậy trung bình — nên kiểm tra lại với trung tâm.")
        case .HIGH:
            return L.t("Độ tin cậy cao, nhưng đây vẫn không phải quyết định bảo hành.")
        }
    }

    // MARK: - Questions are the output

    /// Questions worth showing: trimmed, blank entries removed, duplicates
    /// removed with the first occurrence kept. Order is the server's.
    ///
    /// A question list is not decoration — for an `UNCLEAR` result it is the
    /// actionable half of the answer, which is why the UI renders this array
    /// rather than the raw one.
    public static func normalizedQuestions(_ raw: [String]) -> [String] {
        var seen = Set<String>()
        var result: [String] = []
        for question in raw {
            let trimmed = question.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty else { continue }
            guard seen.insert(trimmed).inserted else { continue }
            result.append(trimmed)
        }
        return result
    }

    /// The line that turns "we could not decide" into the useful result it is.
    ///
    /// Returns copy **only** for `.UNCLEAR` with at least one usable question.
    /// For any other combination it returns `nil`, so the UI cannot congratulate
    /// itself on questions next to a confident answer — and cannot show
    /// `UNCLEAR` with no questions as if it had something to offer.
    public static func questionsIntro(
        for coverage: ClaimAssessmentCoverage,
        questions: [String]
    ) -> String? {
        guard coverage == .UNCLEAR, !normalizedQuestions(questions).isEmpty else { return nil }
        return L.t("Chưa đủ thông tin để kết luận, nhưng những câu hỏi dưới đây là phần dùng được ngay.")
    }
}
