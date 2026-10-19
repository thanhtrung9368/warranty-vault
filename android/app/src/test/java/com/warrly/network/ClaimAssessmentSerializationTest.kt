package com.warrly.network

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The AI claim-assessment wire shapes (`network/Models.kt`).
 *
 * The endpoint is read-only (`{"claimId"}` in, advice out), so the two things
 * worth pinning are the exact request body and the contract's language split:
 * `reasoning`/`questions` are in the user's language, `draftLetter` is always
 * Vietnamese and must arrive unchanged. A partial payload still has to decode
 * into the useful part instead of throwing the whole result away.
 */
class ClaimAssessmentSerializationTest {

    private val json = ApiClient.json

    @Test
    fun theRequestCarriesOnlyTheClaimId() {
        val encoded = json.encodeToString(
            AssessClaimInput.serializer(),
            AssessClaimInput("claim-1"),
        )
        assertEquals("""{"claimId":"claim-1"}""", encoded)
    }

    @Test
    fun theFullResponseDecodesEveryContractField() {
        val raw = """
            {
              "claimId": "claim-1",
              "coverage": "LIKELY_COVERED",
              "confidence": "MEDIUM",
              "reasoning": "Điều khoản bảo hành còn hiệu lực và lỗi này không nằm trong mục loại trừ.",
              "questions": [
                "Máy có bị rơi hay vào nước không?",
                "Anh/chị có hoá đơn mua hàng không?"
              ],
              "draftLetter": "Kính gửi trung tâm bảo hành,\n\nMáy của tôi bị lỗi màn hình. Máy còn hạn bảo hành.\n\nTrân trọng.",
              "generatedAt": "2026-10-19T07:00:00Z",
              "model": "claude-haiku-4-5"
            }
        """.trimIndent()

        val assessment = json.decodeFromString(ClaimAssessment.serializer(), raw)

        assertEquals("claim-1", assessment.claimId)
        assertEquals(ClaimCoverage.LIKELY_COVERED, assessment.coverage)
        assertEquals(ClaimConfidence.MEDIUM, assessment.confidence)
        assertEquals(
            "Điều khoản bảo hành còn hiệu lực và lỗi này không nằm trong mục loại trừ.",
            assessment.reasoning,
        )
        assertEquals(2, assessment.questions.size)
        assertEquals("Máy có bị rơi hay vào nước không?", assessment.questions.first())
        assertEquals(
            "Kính gửi trung tâm bảo hành,\n\n" +
                "Máy của tôi bị lỗi màn hình. Máy còn hạn bảo hành.\n\n" +
                "Trân trọng.",
            assessment.draftLetter,
        )
        assertEquals("2026-10-19T07:00:00Z", assessment.generatedAt)
        assertEquals("claude-haiku-4-5", assessment.model)
    }

    /**
     * The three contract enum values decode exactly. `LIKELY_COVERED` and
     * `LIKELY_NOT_COVERED` are estimates, but the wire values are what they are;
     * the UI's "not a verdict" rule lives in `ClaimAssessmentRules.kt`, not in a
     * renamed wire value.
     */
    @Test
    fun everyCoverageAndConfidenceValueDecodes() {
        for (coverage in listOf("LIKELY_COVERED", "UNCLEAR", "LIKELY_NOT_COVERED")) {
            val decoded = json.decodeFromString(
                ClaimAssessment.serializer(),
                """{"claimId":"c1","coverage":"$coverage","confidence":"HIGH","reasoning":"ok"}""",
            )
            assertEquals(coverage, decoded.coverage.name)
        }
        for (confidence in listOf("LOW", "MEDIUM", "HIGH")) {
            val decoded = json.decodeFromString(
                ClaimAssessment.serializer(),
                """{"claimId":"c1","coverage":"UNCLEAR","confidence":"$confidence","reasoning":"ok"}""",
            )
            assertEquals(confidence, decoded.confidence.name)
        }
    }

    /**
     * A server that omits the optional half still yields the useful half. The
     * letter defaults to empty — the UI then shows the coverage, confidence,
     * reasoning and questions rather than losing all of them to a decode error.
     */
    @Test
    fun aPartialPayloadKeepsTheUsefulPart() {
        val decoded = json.decodeFromString(
            ClaimAssessment.serializer(),
            """{"claimId":"c1","coverage":"UNCLEAR","confidence":"LOW","reasoning":"Cần hỏi thêm."}""",
        )
        assertEquals(ClaimCoverage.UNCLEAR, decoded.coverage)
        assertEquals(ClaimConfidence.LOW, decoded.confidence)
        assertEquals("Cần hỏi thêm.", decoded.reasoning)
        assertTrue("questions default to an empty list", decoded.questions.isEmpty())
        assertEquals("missing letter is empty, not null", "", decoded.draftLetter)
        assertNull(decoded.generatedAt)
        assertNull(decoded.model)
    }
}
