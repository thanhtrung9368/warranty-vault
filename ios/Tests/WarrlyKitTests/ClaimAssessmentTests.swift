import Foundation
import XCTest
@testable import WarrlyKit

/// The pure rules behind AI claim assessment: hedged labels, the
/// "advice not verdict" copy selector, the question normalisation that makes an
/// `UNCLEAR` answer useful, and the three-state gate.
///
/// The design constraint these tests exist for: `LIKELY_COVERED` must never
/// read like an approval. A user who is told "approved" at the counter will
/// argue with a service centre that never agreed to anything, so the copy is
/// pinned here rather than left to the view.
final class ClaimAssessmentTests: XCTestCase {

    override func tearDown() {
        L.language = nil
        super.tearDown()
    }

    // MARK: - Fixtures

    /// The frozen contract payload, verbatim in shape. The letter is
    /// Vietnamese on purpose; the reasoning is the user's language.
    private static let payload = #"""
    {
      "claimId": "claim_1",
      "coverage": "LIKELY_COVERED",
      "confidence": "MEDIUM",
      "reasoning": "Gói bảo hành còn hiệu lực đến 12/03/2027 và lỗi màn hình không nằm trong mục loại trừ.",
      "questions": ["Bạn còn hoá đơn không?", "Máy có bị rơi vỡ không?"],
      "draftLetter": "Kính gửi trung tâm bảo hành,\nTôi mang máy đến vì màn hình bị sọc từ ngày 18/10.",
      "generatedAt": "2026-10-19T08:00:00Z",
      "model": "claude-haiku-4-5-20251001"
    }
    """#

    private func decode(_ json: String) throws -> ClaimAssessment {
        try APIClient.decoder.decode(ClaimAssessment.self, from: Data(json.utf8))
    }

    private func gateError(status: Int, code: String, message: String? = nil) -> APIError {
        .server(
            status: status,
            envelope: APIErrorEnvelope(error: code, message: message, fieldErrors: nil)
        )
    }

    // MARK: - Coverage / confidence labels

    func testCoverageLabelsAreHedgedAndDistinctInBothLanguages() {
        L.withLanguage(.vi) {
            let labels = ClaimAssessmentCoverage.allCases.map(\.label)
            XCTAssertEqual(Set(labels).count, ClaimAssessmentCoverage.allCases.count)
            XCTAssertTrue(ClaimAssessmentCoverage.LIKELY_COVERED.label.contains("khả năng"))
            XCTAssertTrue(ClaimAssessmentCoverage.LIKELY_NOT_COVERED.label.contains("khả năng"))
            XCTAssertTrue(ClaimAssessmentCoverage.UNCLEAR.label.contains("Chưa"))
            XCTAssertFalse(labels.contains("Được bảo hành"))
            XCTAssertFalse(labels.contains("Không được bảo hành"))
        }
        L.withLanguage(.en) {
            let labels = ClaimAssessmentCoverage.allCases.map(\.label)
            XCTAssertEqual(Set(labels).count, ClaimAssessmentCoverage.allCases.count)
            XCTAssertTrue(ClaimAssessmentCoverage.LIKELY_COVERED.label.lowercased().contains("likely"))
            XCTAssertTrue(ClaimAssessmentCoverage.LIKELY_NOT_COVERED.label.lowercased().contains("likely"))
            XCTAssertFalse(labels.contains("Approved"))
            XCTAssertFalse(labels.contains("Rejected"))
        }
    }

    func testUnknownCoverageDecodesAsUnclearRatherThanCovered() throws {
        // A new server-side class must never make this build claim cover.
        let assessment = try decode(Self.payload.replacingOccurrences(
            of: "\"LIKELY_COVERED\"", with: "\"PARTLY_COVERED\""
        ))
        XCTAssertEqual(assessment.coverage, .UNCLEAR)
    }

    func testConfidenceLabelsCoverAllThreeLevelsAndUnknownFallsBackToLow() throws {
        L.withLanguage(.vi) {
            XCTAssertEqual(ClaimAssessmentConfidence.LOW.label, "Thấp")
            XCTAssertEqual(ClaimAssessmentConfidence.MEDIUM.label, "Trung bình")
            XCTAssertEqual(ClaimAssessmentConfidence.HIGH.label, "Cao")
        }
        L.withLanguage(.en) {
            XCTAssertEqual(ClaimAssessmentConfidence.LOW.label, "Low")
            XCTAssertEqual(ClaimAssessmentConfidence.MEDIUM.label, "Medium")
            XCTAssertEqual(ClaimAssessmentConfidence.HIGH.label, "High")
        }

        let assessment = try decode(Self.payload.replacingOccurrences(
            of: "\"MEDIUM\"", with: "\"EXTREME\""
        ))
        XCTAssertEqual(assessment.confidence, .LOW,
                       "an unrecognised confidence must not look more certain")
    }

    // MARK: - Advice, not a verdict

    func testEveryAdviceCarriesTheDecisionDisclaimer() {
        L.withLanguage(.vi) {
            for coverage in ClaimAssessmentCoverage.allCases {
                for confidence in ClaimAssessmentConfidence.allCases {
                    let advice = ClaimAssessmentRules.advice(for: coverage, confidence: confidence)
                    XCTAssertEqual(advice.disclaimer, ClaimAssessmentRules.disclaimer)
                    XCTAssertTrue(advice.disclaimer.lowercased().contains("trung tâm bảo hành"))
                    XCTAssertTrue(advice.disclaimer.lowercased().contains("quyết định"))
                }
            }
        }
        L.withLanguage(.en) {
            let advice = ClaimAssessmentRules.advice(for: .LIKELY_COVERED, confidence: .HIGH)
            XCTAssertTrue(advice.disclaimer.contains("service center"))
            XCTAssertTrue(advice.disclaimer.contains("decides"))
        }
    }

    func testNoAdviceUsesVerdictVocabulary() {
        // The screen may say "likely", never "approved"/"rejected". This is the
        // copy half of the design constraint; the view half is the absence of
        // green-tick / red-cross treatment.
        let verdictWords = ["được duyệt", "từ chối", "đã được bảo hành", "không được bảo hành",
                            "approved", "denied", "rejected"]
        for language in AppLanguage.allCases {
            L.withLanguage(language) {
                for coverage in ClaimAssessmentCoverage.allCases {
                    for confidence in ClaimAssessmentConfidence.allCases {
                        let advice = ClaimAssessmentRules.advice(for: coverage, confidence: confidence)
                        let copy = [advice.headline, advice.summary,
                                    advice.confidenceNote, advice.disclaimer]
                            .joined(separator: " ")
                            .lowercased()
                        for word in verdictWords {
                            XCTAssertFalse(copy.contains(word),
                                           "\(language.rawValue) advice contains \(word): \(copy)")
                        }
                    }
                }
            }
        }
    }

    func testEachCoverageGetsItsOwnHeadlineAndSummary() {
        for language in AppLanguage.allCases {
            L.withLanguage(language) {
                let headlines = ClaimAssessmentCoverage.allCases.map {
                    ClaimAssessmentRules.advice(for: $0, confidence: .MEDIUM).headline
                }
                let summaries = ClaimAssessmentCoverage.allCases.map {
                    ClaimAssessmentRules.advice(for: $0, confidence: .MEDIUM).summary
                }
                XCTAssertEqual(Set(headlines).count, 3)
                XCTAssertEqual(Set(summaries).count, 3)
                // The coverage headline IS the coverage label — never a
                // hand-written second mapping that could drift.
                for coverage in ClaimAssessmentCoverage.allCases {
                    XCTAssertEqual(
                        ClaimAssessmentRules.advice(for: coverage, confidence: .HIGH).headline,
                        coverage.label
                    )
                }
            }
        }
    }

    func testAdviceAttachesTheConfidenceLabelAndItsOwnNote() {
        L.withLanguage(.vi) {
            let low = ClaimAssessmentRules.advice(for: .UNCLEAR, confidence: .LOW)
            let medium = ClaimAssessmentRules.advice(for: .UNCLEAR, confidence: .MEDIUM)
            let high = ClaimAssessmentRules.advice(for: .UNCLEAR, confidence: .HIGH)

            // Same coverage → same headline; confidence is a separate, visible
            // dimension, never folded into the verdict-ish line.
            XCTAssertEqual(Set([low.headline, medium.headline, high.headline]).count, 1)
            XCTAssertEqual(low.confidenceLabel, "Thấp")
            XCTAssertEqual(medium.confidenceLabel, "Trung bình")
            XCTAssertEqual(high.confidenceLabel, "Cao")
            XCTAssertEqual(Set([low.confidenceNote, medium.confidenceNote, high.confidenceNote]).count, 3)
            XCTAssertTrue(low.confidenceNote.contains("thấp"))
            XCTAssertTrue(high.confidenceNote.contains("cao"))
        }
    }

    // MARK: - UNCLEAR with questions is a success

    func testUnclearWithQuestionsIsIntroducedAsUseful() {
        L.withLanguage(.vi) {
            let intro = ClaimAssessmentRules.questionsIntro(for: .UNCLEAR,
                                                           questions: ["Bạn còn hoá đơn không?"])
            XCTAssertNotNil(intro)
            XCTAssertTrue(intro?.contains("dùng được ngay") == true)
        }
        L.withLanguage(.en) {
            let intro = ClaimAssessmentRules.questionsIntro(for: .UNCLEAR, questions: ["Do you have the receipt?"])
            XCTAssertTrue(intro?.contains("immediately useful") == true)
        }
    }

    func testUnclearWithoutQuestionsIsNotDressedUpAsUseful() {
        XCTAssertNil(ClaimAssessmentRules.questionsIntro(for: .UNCLEAR, questions: []))
        XCTAssertNil(ClaimAssessmentRules.questionsIntro(for: .UNCLEAR,
                                                         questions: ["", "   "]))
        XCTAssertNil(ClaimAssessmentRules.questionsIntro(for: .LIKELY_COVERED,
                                                         questions: ["Bạn còn hoá đơn không?"]))
        XCTAssertNil(ClaimAssessmentRules.questionsIntro(for: .LIKELY_NOT_COVERED,
                                                         questions: ["Bạn còn hoá đơn không?"]))
    }

    func testQuestionsAreTrimmedDeduplicatedAndKeepTheServerOrder() {
        let raw = ["  Bạn còn hoá đơn không?  ", "", "Máy có bị rơi vỡ không?",
                   "Bạn còn hoá đơn không?", "   "]
        XCTAssertEqual(ClaimAssessmentRules.normalizedQuestions(raw),
                       ["Bạn còn hoá đơn không?", "Máy có bị rơi vỡ không?"])
        XCTAssertEqual(ClaimAssessmentRules.normalizedQuestions([]), [])
    }

    func testTheLetterLanguageNoteSaysVietnameseOnPurpose() {
        L.withLanguage(.vi) {
            let note = ClaimAssessmentRules.letterLanguageNote
            XCTAssertTrue(note.contains("tiếng Việt"))
            XCTAssertTrue(note.contains("không tự dịch"))
        }
        L.withLanguage(.en) {
            let note = ClaimAssessmentRules.letterLanguageNote
            XCTAssertTrue(note.contains("Vietnamese"))
            XCTAssertTrue(note.contains("does not translate"))
        }
    }

    // MARK: - The model

    func testDecodesTheFrozenContractPayload() throws {
        let assessment = try decode(Self.payload)

        XCTAssertEqual(assessment.claimId, "claim_1")
        XCTAssertEqual(assessment.coverage, .LIKELY_COVERED)
        XCTAssertEqual(assessment.confidence, .MEDIUM)
        XCTAssertTrue(assessment.reasoning.contains("màn hình"))
        XCTAssertEqual(assessment.questions, ["Bạn còn hoá đơn không?", "Máy có bị rơi vỡ không?"])
        XCTAssertTrue(assessment.draftLetter.hasPrefix("Kính gửi trung tâm bảo hành"))
        XCTAssertEqual(assessment.generatedAt, "2026-10-19T08:00:00Z")
        XCTAssertEqual(assessment.model, "claude-haiku-4-5-20251001")
        XCTAssertTrue(assessment.hasQuestions)
        XCTAssertTrue(assessment.hasDraftLetter)
    }

    func testMissingQuestionsAndMetadataStillYieldUsableAdvice() throws {
        // `questions` is documented as always present, but a proxy that drops
        // it must not turn a usable result into a decoding failure.
        let json = #"""
        {"claimId": "claim_2", "coverage": "UNCLEAR", "confidence": "HIGH",
         "reasoning": "Thiếu ngày mua.", "draftLetter": "Kính gửi trung tâm,"}
        """#
        let assessment = try decode(json)
        XCTAssertEqual(assessment.coverage, .UNCLEAR)
        XCTAssertEqual(assessment.questionsOrEmpty, [])
        XCTAssertFalse(assessment.hasQuestions)
        XCTAssertNil(assessment.generatedAt)
        XCTAssertNil(assessment.model)
        XCTAssertTrue(assessment.hasDraftLetter)
    }

    func testWhitespaceOnlyLetterIsNotAUsableLetter() throws {
        let json = #"""
        {"claimId": "claim_3", "coverage": "LIKELY_NOT_COVERED", "confidence": "LOW",
         "reasoning": "Ngoài phạm vi.", "questions": [], "draftLetter": "   \n  "}
        """#
        let assessment = try decode(json)
        XCTAssertFalse(assessment.hasDraftLetter)
        XCTAssertEqual(assessment.visibleQuestions, [])
    }

    // MARK: - Gates

    func testOptInFlagIsTheClientSideGate() {
        XCTAssertEqual(ClaimAssessmentGate(aiOptIn: true), .ready)
        XCTAssertEqual(ClaimAssessmentGate(aiOptIn: false), .optInOff)
        // The flag is unknown (read failed / still loading): try the call and
        // let the server answer, rather than blocking a feature that may be on.
        XCTAssertEqual(ClaimAssessmentGate(aiOptIn: nil), .ready)

        XCTAssertTrue(ClaimAssessmentGate.ready.isReady)
        XCTAssertTrue(ClaimAssessmentGate.optInOff.needsOptIn)
        XCTAssertTrue(ClaimAssessmentGate.featureDisabled.isFeatureDisabled)
    }

    func testForbiddenOptInRequiredIsTheOptInGate() {
        let error = gateError(status: 403, code: "ai_optin_required",
                              message: "Bật trợ lý AI trước.")
        XCTAssertEqual(ClaimAssessmentGate.from(error: error), .optInOff)
    }

    func testServiceUnavailableFeatureDisabledIsTheFeatureGate() {
        let error = gateError(status: 503, code: "feature_disabled",
                              message: "Tính năng AI chưa được bật trên máy chủ.")
        XCTAssertEqual(ClaimAssessmentGate.from(error: error), .featureDisabled)
    }

    func testOnlyTheDocumentedStatusAndCodePairsAreGates() {
        // A 403 for another reason is not an opt-in problem, and a 503 for
        // another reason is not "the AI feature is disabled". Treating either
        // as a gate would hide a real error behind calm copy.
        XCTAssertNil(ClaimAssessmentGate.from(error: gateError(status: 403, code: "forbidden")))
        XCTAssertNil(ClaimAssessmentGate.from(error: gateError(status: 403, code: "feature_disabled")))
        XCTAssertNil(ClaimAssessmentGate.from(error: gateError(status: 503, code: "ai_optin_required")))
        XCTAssertNil(ClaimAssessmentGate.from(error: gateError(status: 503, code: "maintenance")))
        XCTAssertNil(ClaimAssessmentGate.from(error: gateError(status: 500, code: "feature_disabled")))
        XCTAssertNil(ClaimAssessmentGate.from(error: gateError(status: 404, code: "claim_not_found")))
    }

    func testGateCodesAreCaseInsensitiveAndTolerantOfWhitespace() {
        XCTAssertEqual(ClaimAssessmentGate.from(
            error: gateError(status: 403, code: " AI_OPTIN_REQUIRED ")
        ), .optInOff)
        XCTAssertEqual(ClaimAssessmentGate.from(
            error: gateError(status: 503, code: "Feature_Disabled")
        ), .featureDisabled)
    }

    func testTransportAndDecodingErrorsAreOrdinaryFailures() {
        XCTAssertNil(ClaimAssessmentGate.from(error: APIError.transport("offline")))
        XCTAssertNil(ClaimAssessmentGate.from(error: APIError.decoding("bad json")))
        XCTAssertNil(ClaimAssessmentGate.from(error: URLError(.notConnectedToInternet)))
    }

    // MARK: - Request body

    func testInputTrimsTheClaimIdAndRefusesABlankOne() {
        XCTAssertEqual(ClaimAssessmentInput(claimId: "  claim_1\n").claimId, "claim_1")
        XCTAssertTrue(ClaimAssessmentInput(claimId: "claim_1").isReadyToSend)

        XCTAssertEqual(ClaimAssessmentInput(claimId: "   \n").claimId, "")
        XCTAssertFalse(ClaimAssessmentInput(claimId: "   ").isReadyToSend)
    }
}
