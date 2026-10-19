package com.warrly.ui.screens.devices

import com.warrly.R
import com.warrly.i18n.ResCatalog
import com.warrly.network.ApiClient
import com.warrly.network.ClaimAssessment
import com.warrly.network.ClaimConfidence
import com.warrly.network.ClaimCoverage
import com.warrly.testing.httpError
import com.warrly.ui.components.PillKind
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * AI claim assessment — the pure half (`ClaimAssessmentRules.kt`).
 *
 * The tests are deliberately about the things that would be **wrong**, not
 * merely styled differently:
 *
 *  * a label or colour that turns an estimate into a verdict,
 *  * the gate collapsing "opt-in off" and "no API key" into one message,
 *  * an `UNCLEAR` answer being treated as a failure instead of its questions
 *    being the useful output,
 *  * the Vietnamese letter being trimmed into something else (or translated).
 *
 * The words are read out of `res/values-vi/` and `res/values/` through the same
 * [ResCatalog] seam every other pure formatter test uses, so a missing or
 * mistranslated key fails here rather than silently rendering the wrong language.
 */
class ClaimAssessmentRulesTest {

    private val vi = ResCatalog.vietnamese()
    private val en = ResCatalog.english()

    private fun assessment(
        coverage: ClaimCoverage = ClaimCoverage.UNCLEAR,
        confidence: ClaimConfidence = ClaimConfidence.MEDIUM,
        questions: List<String> = emptyList(),
        draftLetter: String = "",
        generatedAt: String? = "2026-10-19T07:00:00Z",
        model: String? = "claude-haiku-4-5",
    ) = ClaimAssessment(
        claimId = "claim-1",
        coverage = coverage,
        confidence = confidence,
        reasoning = "Điều khoản bảo hành không nói rõ về lỗi này.",
        questions = questions,
        draftLetter = draftLetter,
        generatedAt = generatedAt,
        model = model,
    )

    // ---- labels ----------------------------------------------------------

    @Test
    fun coverageLabelsAreExactInBothLanguages() {
        assertEquals(
            "Có khả năng được bảo hành",
            coverageLabel(vi, ClaimCoverage.LIKELY_COVERED),
        )
        assertEquals("Likely covered", coverageLabel(en, ClaimCoverage.LIKELY_COVERED))

        assertEquals("Chưa rõ", coverageLabel(vi, ClaimCoverage.UNCLEAR))
        assertEquals("Unclear", coverageLabel(en, ClaimCoverage.UNCLEAR))

        assertEquals(
            "Có khả năng không được bảo hành",
            coverageLabel(vi, ClaimCoverage.LIKELY_NOT_COVERED),
        )
        assertEquals(
            "Likely not covered",
            coverageLabel(en, ClaimCoverage.LIKELY_NOT_COVERED),
        )
    }

    @Test
    fun confidenceLabelsAreExactInBothLanguages() {
        assertEquals("Độ tin cậy thấp", confidenceLabel(vi, ClaimConfidence.LOW))
        assertEquals("Low confidence", confidenceLabel(en, ClaimConfidence.LOW))

        assertEquals("Độ tin cậy trung bình", confidenceLabel(vi, ClaimConfidence.MEDIUM))
        assertEquals("Medium confidence", confidenceLabel(en, ClaimConfidence.MEDIUM))

        assertEquals("Độ tin cậy cao", confidenceLabel(vi, ClaimConfidence.HIGH))
        assertEquals("High confidence", confidenceLabel(en, ClaimConfidence.HIGH))
    }

    /**
     * The design constraint, pinned as a rule: an estimate must never use the
     * words of a decision. A future copy edit that writes "Approved" (or
     * "Đã duyệt") fails here before it can cost a user a wasted trip.
     */
    @Test
    fun coverageWordsNeverReadLikeAnApprovalOrARejection() {
        val forbidden = listOf(
            "approved",
            "guaranteed",
            "rejected",
            "đã duyệt",
            "chắc chắn",
            "bị từ chối",
        )
        for (strings in listOf(vi, en)) {
            for (coverage in ClaimCoverage.entries) {
                val label = coverageLabel(strings, coverage).lowercase()
                for (word in forbidden) {
                    assertFalse(
                        "coverage label \"$label\" must not read as a verdict ($word)",
                        label.contains(word),
                    )
                }
                val advice = coverageAdvice(strings, coverage).lowercase()
                for (word in forbidden) {
                    assertFalse(
                        "coverage advice \"$advice\" must not read as a verdict ($word)",
                        advice.contains(word),
                    )
                }
            }
        }
    }

    /**
     * Colour is part of the same rule. Success-green would read as "approved"
     * and danger-red as "rejected", so the mapping is fixed to
     * info/neutral/warning — the buckets that mean "estimate, check".
     */
    @Test
    fun coveragePillKindsAreNeverSuccessOrDanger() {
        assertEquals(PillKind.Info, coveragePillKind(ClaimCoverage.LIKELY_COVERED))
        assertEquals(PillKind.Neutral, coveragePillKind(ClaimCoverage.UNCLEAR))
        assertEquals(PillKind.Warning, coveragePillKind(ClaimCoverage.LIKELY_NOT_COVERED))
        for (coverage in ClaimCoverage.entries) {
            assertNotEquals(PillKind.Success, coveragePillKind(coverage))
            assertNotEquals(PillKind.Danger, coveragePillKind(coverage))
        }
    }

    // ---- the advice selector --------------------------------------------

    @Test
    fun adviceCopyIsExactInBothLanguages() {
        assertEquals(
            "Điều khoản bạn đã ghi cho thấy lần sửa này có khả năng được bảo hành. " +
                "Hãy mang theo các câu hỏi và thư nháp tới quầy.",
            coverageAdvice(vi, ClaimCoverage.LIKELY_COVERED),
        )
        assertEquals(
            "The terms you recorded suggest this repair is likely covered. " +
                "Take the questions and the draft letter to the counter.",
            coverageAdvice(en, ClaimCoverage.LIKELY_COVERED),
        )

        assertEquals(
            "Điều khoản bạn đã ghi chưa đủ rõ để kết luận. Đó vẫn là kết quả hữu ích: " +
                "các câu hỏi dưới đây là những gì cần hỏi tại quầy.",
            coverageAdvice(vi, ClaimCoverage.UNCLEAR),
        )
        assertEquals(
            "The terms you recorded do not clearly settle this. That is still useful: " +
                "the questions below are exactly what to ask at the counter.",
            coverageAdvice(en, ClaimCoverage.UNCLEAR),
        )

        assertEquals(
            "Điều khoản bạn đã ghi cho thấy lần sửa này có khả năng không được bảo hành. " +
                "Hãy hỏi các câu dưới đây trước khi đồng ý trả tiền.",
            coverageAdvice(vi, ClaimCoverage.LIKELY_NOT_COVERED),
        )
        assertEquals(
            "The terms you recorded suggest this repair is likely not covered. " +
                "Ask the questions below before you agree to pay.",
            coverageAdvice(en, ClaimCoverage.LIKELY_NOT_COVERED),
        )
    }

    @Test
    fun theDisclaimerIsExactAndNamesWhoDecides() {
        assertEquals(
            "Lời khuyên, không phải quyết định",
            vi.get(R.string.claim_assess_disclaimer_title),
        )
        assertEquals(
            "Advice, not a decision",
            en.get(R.string.claim_assess_disclaimer_title),
        )
        assertEquals(
            "Đây là ước lượng bằng AI từ phiếu sửa chữa và điều khoản bảo hành bạn đã ghi. " +
                "Trung tâm bảo hành mới là bên quyết định.",
            vi.get(R.string.claim_assess_disclaimer_body),
        )
        assertEquals(
            "This is an AI estimate from the repair ticket and the warranty terms you recorded. " +
                "The service centre decides whether the claim is covered.",
            en.get(R.string.claim_assess_disclaimer_body),
        )
    }

    // ---- UNCLEAR is a success -------------------------------------------

    /**
     * The whole point of the `UNCLEAR` branch: it is not an error, and its
     * questions are the deliverable. The heading says so, and the advice tells
     * the user what to do with them.
     */
    @Test
    fun unclearIsRenderedAsUsefulQuestionsNotAsAFailure() {
        val enAdvice = coverageAdvice(en, ClaimCoverage.UNCLEAR)
        val viAdvice = coverageAdvice(vi, ClaimCoverage.UNCLEAR)
        assertTrue(enAdvice, enAdvice.contains("questions"))
        assertTrue(viAdvice, viAdvice.contains("câu hỏi"))

        assertEquals(
            "Useful questions for an unclear answer",
            assessmentQuestionsTitle(en, ClaimCoverage.UNCLEAR),
        )
        assertEquals(
            "Câu hỏi hữu ích khi kết quả chưa rõ",
            assessmentQuestionsTitle(vi, ClaimCoverage.UNCLEAR),
        )
        assertEquals(
            "Questions the counter may ask",
            assessmentQuestionsTitle(en, ClaimCoverage.LIKELY_COVERED),
        )
        assertEquals(
            "Câu hỏi quầy có thể hỏi",
            assessmentQuestionsTitle(vi, ClaimCoverage.LIKELY_NOT_COVERED),
        )
        assertNotEquals(PillKind.Danger, coveragePillKind(ClaimCoverage.UNCLEAR))
    }

    // ---- the gate state machine -----------------------------------------

    @Test
    fun theGateIsReadyOnlyWhenTheSharedOptInIsOn() {
        assertEquals(ClaimAssessGate.READY, claimAssessGate(aiOptIn = true))
        assertEquals(
            ClaimAssessGate.OPT_IN_REQUIRED,
            claimAssessGate(aiOptIn = false),
        )
    }

    /**
     * A failed opt-in read is not "off": the server owns both gates, so an
     * unknown value asks it rather than blocking the user behind a settings call
     * that happened to fail.
     */
    @Test
    fun anUnknownOptInLetsTheServerDecide() {
        assertEquals(ClaimAssessGate.READY, claimAssessGate(aiOptIn = null))
    }

    /**
     * A server with no AI key cannot answer whatever the toggle says. Telling the
     * user to turn AI on would be false advice, so feature-disabled wins.
     */
    @Test
    fun featureDisabledWinsOverTheOptIn() {
        assertEquals(
            ClaimAssessGate.FEATURE_DISABLED,
            claimAssessGate(aiOptIn = true, featureDisabled = true),
        )
        assertEquals(
            ClaimAssessGate.FEATURE_DISABLED,
            claimAssessGate(aiOptIn = false, featureDisabled = true),
        )
        assertEquals(
            ClaimAssessGate.FEATURE_DISABLED,
            claimAssessGate(aiOptIn = null, featureDisabled = true),
        )
    }

    /**
     * The two gate states are worded as information, not as an error: the opt-in
     * card offers the existing Settings switch, and the no-key card says the
     * claim is untouched and the service centre still decides.
     */
    @Test
    fun theGatesAreWordedAsInformationAndKeepTheWayOut() {
        assertEquals(
            "Open Settings",
            en.get(R.string.claim_assess_gate_optin_action),
        )
        assertEquals(
            "Mở Cài đặt",
            vi.get(R.string.claim_assess_gate_optin_action),
        )

        assertEquals(
            "AI assessment is not available right now",
            en.get(R.string.claim_assess_gate_disabled_title),
        )
        assertEquals(
            "Đánh giá bằng AI hiện chưa khả dụng",
            vi.get(R.string.claim_assess_gate_disabled_title),
        )
        assertTrue(
            en.get(R.string.claim_assess_gate_disabled_body)
                .contains("not a problem with your claim"),
        )
        assertTrue(
            vi.get(R.string.claim_assess_gate_disabled_body)
                .contains("không phải lỗi ở phiếu của bạn"),
        )
    }

    // ---- failures --------------------------------------------------------

    /**
     * The wire carries the codes lowercased (the Go envelope writer lowercases
     * domain codes), while the contract spells them with underscores. Both
     * spellings, and both cases, must land in the same actionable state. The
     * pair (status, code) is required: either alone is not the documented gate.
     */
    @Test
    fun gatedFailuresRequireBothTheStatusAndTheCode() {
        assertEquals(
            ClaimAssessFailure.OPT_IN_REQUIRED,
            claimAssessFailure(403, "ai_optin_required"),
        )
        assertEquals(
            ClaimAssessFailure.OPT_IN_REQUIRED,
            claimAssessFailure(403, "AI_OPTIN_REQUIRED"),
        )
        assertEquals(
            ClaimAssessFailure.OPT_IN_REQUIRED,
            claimAssessFailure(403, "Ai_Optin_Required"),
        )

        assertEquals(
            ClaimAssessFailure.FEATURE_DISABLED,
            claimAssessFailure(503, "feature_disabled"),
        )
        assertEquals(
            ClaimAssessFailure.FEATURE_DISABLED,
            claimAssessFailure(503, "FEATURE_DISABLED"),
        )

        assertEquals(
            "a 403 with the feature-disabled code is not the documented gate",
            ClaimAssessFailure.OTHER,
            claimAssessFailure(403, "feature_disabled"),
        )
        assertEquals(
            "a 503 with the opt-in code is not the documented gate",
            ClaimAssessFailure.OTHER,
            claimAssessFailure(503, "ai_optin_required"),
        )
        assertEquals(ClaimAssessFailure.OTHER, claimAssessFailure(500, "feature_disabled"))
        assertEquals(ClaimAssessFailure.OTHER, claimAssessFailure(403, null))
        assertEquals(ClaimAssessFailure.OTHER, claimAssessFailure(null, "feature_disabled"))
    }

    @Test
    fun aDeadSocketIsNotReportedAsAGate() {
        val socket = claimAssessError(java.io.IOException("timeout"), ApiClient.json)
        assertEquals(ClaimAssessFailure.OTHER, socket.failure)
        assertNull(
            "a non-HTTP failure has no server sentence; the screen uses its own " +
                "translated fallback instead of the platform's untranslated text",
            socket.serverMessage,
        )
    }

    /**
     * The error body is one-shot. The parser must return the gate and the
     * server's translated sentence from the same read; a second read would see an
     * empty body and turn a real 403/503 into a generic failure.
     */
    @Test
    fun theErrorParsesTheGateAndTheServerMessageFromOneBody() {
        val optIn = claimAssessError(
            httpError(
                403,
                """{"error":"ai_optin_required","message":"Cần bật tính năng AI trong Cài đặt"}""",
            ),
            ApiClient.json,
        )
        assertEquals(ClaimAssessFailure.OPT_IN_REQUIRED, optIn.failure)
        assertEquals("Cần bật tính năng AI trong Cài đặt", optIn.serverMessage)

        val disabled = claimAssessError(
            httpError(
                503,
                """{"error":"feature_disabled","message":"Tính năng AI đang tắt"}""",
            ),
            ApiClient.json,
        )
        assertEquals(ClaimAssessFailure.FEATURE_DISABLED, disabled.failure)
        assertEquals("Tính năng AI đang tắt", disabled.serverMessage)
    }

    // ---- questions / letter / provenance --------------------------------

    @Test
    fun questionsAreTrimmedAndBlankEntriesAreDroppedInOrder() {
        val parsed = assessmentQuestions(
            assessment(
                questions = listOf(
                    "  Máy có bị rơi không?  ",
                    " ",
                    "\n",
                    "Có hoá đơn không?",
                ),
            ),
        )
        assertEquals(
            listOf("Máy có bị rơi không?", "Có hoá đơn không?"),
            parsed,
        )
    }

    /**
     * The letter is Vietnamese **on purpose**. The helper may trim the blank
     * edges, but it must not translate, reflow or invent a title: the bytes the
     * service centre reads are the bytes the model produced.
     */
    @Test
    fun theLetterIsKeptVerbatimInVietnamese() {
        val letter = "Kính gửi trung tâm bảo hành,\n\n" +
            "Máy iPhone 15 Pro của tôi bị lỗi màn hình từ ngày 12/10/2026. " +
            "Máy còn hạn bảo hành đến 20/12/2026.\n\nTrân trọng."

        assertEquals(letter, draftLetterText(assessment(draftLetter = "\n$letter\n")))
        assertTrue(
            "the letter must stay Vietnamese even when the UI is English",
            draftLetterText(assessment(draftLetter = letter)).contains("Kính gửi"),
        )
    }

    @Test
    fun provenanceUsesTheAppsDateConventionAndOmitsAMissingDate() {
        assertEquals(
            "Generated 19/10/2026 · claude-haiku-4-5",
            assessmentProvenance(
                en,
                assessment(generatedAt = "2026-10-19T07:00:00Z", model = "claude-haiku-4-5"),
            ),
        )
        assertEquals(
            "Tạo ngày 19/10/2026 · claude-haiku-4-5",
            assessmentProvenance(
                vi,
                assessment(generatedAt = "2026-10-19T07:00:00Z", model = "claude-haiku-4-5"),
            ),
        )
        assertEquals(
            "Generated 19/10/2026",
            assessmentProvenance(
                en,
                assessment(generatedAt = "2026-10-19", model = null),
            ),
        )
        assertNull(
            "a missing date is omitted rather than replaced with today",
            assessmentProvenance(
                en,
                assessment(generatedAt = null, model = "claude-haiku-4-5"),
            ),
        )
        assertNull(
            assessmentProvenance(
                en,
                assessment(generatedAt = "not-a-date", model = "claude-haiku-4-5"),
            ),
        )
    }
}
