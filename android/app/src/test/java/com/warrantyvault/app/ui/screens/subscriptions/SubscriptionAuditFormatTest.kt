package com.warrantyvault.app.ui.screens.subscriptions

import com.warrantyvault.app.R
import com.warrantyvault.app.i18n.Money
import com.warrantyvault.app.i18n.ResCatalog
import com.warrantyvault.app.i18n.money
import com.warrantyvault.app.network.ActionCounts
import com.warrantyvault.app.testing.Fixtures
import com.warrantyvault.app.ui.components.PillKind
import com.warrantyvault.app.ui.screens.actions.ActionSeverity
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * "Soát gói đăng ký" — the pure half of the audit report.
 *
 * Most of these tests are honesty tests rather than formatting tests. The feature
 * is a *conclusion*, and the app it lives in has no usage telemetry, so the copy
 * is the risky part: it must never say a plan is unused, never turn a 2% rise
 * into an alert, and never claim nothing was changed unless the server said so.
 */
class SubscriptionAuditFormatTest {

    /**
     * The two catalogs, read off `res/values-vi/` and `res/values/`. Every
     * expected sentence below is the SAME string this test asserted against a
     * hardcoded literal before the conversion — that is what proves the move into
     * the resource table changed no bytes. [en] is asserted too, so a key that
     * only resolves in one language cannot pass.
     */
    private val vi = ResCatalog.vietnamese()
    private val en = ResCatalog.english()

    // ---- the honesty line ----

    /**
     * The app cannot know whether a subscription is used: there is no telemetry
     * and no bank-transaction access. Every sentence the screen can print must
     * therefore come from the server, which reports on RECORDING
     * ("lâu rồi không thấy ghi nhận gì") — never on usage.
     */
    @Test
    fun noLocalCopyEverClaimsASubscriptionIsUnused() {
        val thresholds = Fixtures.auditThresholds()
        val rendered = listOf(
            Fixtures.quietAuditFinding(),
            Fixtures.priceAuditFinding(material = false),
            Fixtures.priceAuditFinding(material = true),
            Fixtures.duplicateAuditFinding(),
        ).flatMap { finding ->
            listOfNotNull(
                finding.title,
                finding.detail,
                auditRuleLabel(vi, finding, thresholds),
                auditMaterialNote(vi, finding, thresholds),
                auditMoneyLine(vi, finding),
                auditTimelineNote(vi, finding),
                auditMinorPillLabel(vi, finding),
            )
        } + auditAdvisoryNote(vi, advisory = true)!! +
            auditThresholdLines(vi, thresholds) +
            vi.get(AUDIT_ENTRY_SUBTITLE)

        val forbidden = listOf("không dùng", "chưa dùng", "bỏ quên", "vô dụng", "lãng phí")
        forbidden.forEach { phrase ->
            assertFalse(
                "the audit must never say \"$phrase\" — the data cannot support it",
                rendered.any { it.contains(phrase, ignoreCase = true) },
            )
        }
    }

    /**
     * `advisory` is a statement about the server's behaviour, so it is repeated
     * only when the payload actually made it.
     */
    @Test
    fun advisoryNote_appearsOnlyWhenTheServerAssertedIt() {
        val note = auditAdvisoryNote(vi, advisory = true)
        assertEquals("Chỉ tư vấn: không có gì bị sửa, bị huỷ hay bị tắt tự động.", note)
        assertTrue(note!!.contains("không có gì bị sửa"))
        assertNull(auditAdvisoryNote(vi, advisory = false))
    }

    /** `material = false` must read as minor — never as an alert. */
    @Test
    fun materialFalse_isRenderedAsAMinorChangeWithTheThresholdNamed() {
        val minor = Fixtures.priceAuditFinding(material = false, increasePercent = 2)
        val note = auditMaterialNote(vi, minor, Fixtures.auditThresholds(priceRiseMinPercent = 5))

        assertEquals("Mức tăng này dưới 5% nên chỉ là thay đổi nhỏ — không phải cảnh báo.", note)
        assertTrue(note!!.contains("không phải cảnh báo"))
        assertEquals("Thay đổi nhỏ", auditMinorPillLabel(vi, minor))
    }

    @Test
    fun materialTrueOrAbsent_producesNoSofteningNote() {
        assertNull(auditMaterialNote(vi, Fixtures.priceAuditFinding(material = true), Fixtures.auditThresholds()))
        assertNull(auditMaterialNote(vi, Fixtures.priceAuditFinding(material = null), Fixtures.auditThresholds()))
        assertNull(auditMinorPillLabel(vi, Fixtures.priceAuditFinding(material = true)))
        // Still honest without thresholds: the server's own verdict is repeated,
        // no number is invented.
        assertEquals(
            "Mức tăng này được đánh giá là nhỏ — không phải cảnh báo.",
            auditMaterialNote(vi, Fixtures.priceAuditFinding(material = false), thresholds = null),
        )
    }

    /**
     * "Ngày ghi nhận gần nhất" is a RECORDING date, not a usage date. The label
     * is pinned because the openapi is explicit that the app cannot know when a
     * plan was last used.
     */
    @Test
    fun timeline_labelsTheLastPaymentAsARecordingAndNeverAsUsage() {
        val line = auditTimelineNote(vi, Fixtures.quietAuditFinding())!!

        assertEquals("Khoản ghi nhận gần nhất: 01/02/2026 · Kỳ gia hạn tới: 10/03/2026 (còn 6 ngày)", line)
        assertTrue(line.contains("Khoản ghi nhận gần nhất"))
        assertFalse(line.contains("dùng lần cuối"))
        assertNull(auditTimelineNote(vi, Fixtures.duplicateAuditFinding()))
    }

    // ---- the rule behind a verdict ----

    @Test
    fun ruleLabel_statesTheThresholdsThatProducedTheFinding() {
        val thresholds = Fixtures.auditThresholds(
            quietMinAutoCharges = 3,
            quietMinMonths = 6,
            priceRiseMinPercent = 5,
        )

        val quiet = auditRuleLabel(vi, Fixtures.quietAuditFinding(), thresholds)!!
        assertTrue(quiet, quiet.contains("ít nhất 3 lần"))
        assertTrue(quiet, quiet.contains("ít nhất 6 tháng"))
        assertTrue(quiet, quiet.contains("không có khoản nào do bạn tự ghi"))

        val price = auditRuleLabel(vi, Fixtures.priceAuditFinding(material = true), thresholds)!!
        assertTrue(price, price.contains("hai kỳ thanh toán liền kề"))
        assertTrue(price, price.contains("từ 5% trở lên mới coi là đáng kể"))
    }

    @Test
    fun ruleLabel_namesTheDuplicateSignalThatMatched() {
        val sameName = auditRuleLabel(vi, 
            Fixtures.duplicateAuditFinding(reason = "SAME_NAME"),
            Fixtures.auditThresholds(duplicateNormalized = true),
        )!!
        assertTrue(sameName, sameName.contains("bỏ dấu"))

        val sameBrand = auditRuleLabel(vi, 
            Fixtures.duplicateAuditFinding(reason = "SAME_BRAND_CATEGORY"),
            Fixtures.auditThresholds(),
        )!!
        assertTrue(sameBrand, sameBrand.contains("cùng hãng và cùng loại"))

        // Without the normalisation flag the weaker claim is the honest one.
        assertFalse(
            auditRuleLabel(vi, 
                Fixtures.duplicateAuditFinding(reason = "SAME_NAME"),
                Fixtures.auditThresholds(duplicateNormalized = false),
            )!!.contains("bỏ dấu"),
        )
    }

    /** No thresholds ⇒ no rule line, rather than a guessed threshold. */
    @Test
    fun ruleLabel_isAbsentWhenThePayloadCarriesNoThresholds() {
        val thresholds = null
        assertNull(auditRuleLabel(vi, Fixtures.quietAuditFinding(), thresholds))
        assertNull(auditRuleLabel(vi, Fixtures.priceAuditFinding(), thresholds))
        // A duplicate rule that needs no threshold can still be stated.
        assertTrue(auditRuleLabel(vi, Fixtures.duplicateAuditFinding(), thresholds)!!.isNotBlank())
    }

    @Test
    fun ruleLabel_isAbsentForAKindThisBuildDoesNotKnow() {
        val unknown = Fixtures.priceAuditFinding().copy(kind = "SOMETHING_NEW")
        assertNull(auditRuleLabel(vi, unknown, Fixtures.auditThresholds()))
        assertNull(auditMoneyLine(vi, unknown))
    }

    // ---- money, as int64 ----

    @Test
    fun moneyLine_restatesTheServersOwnFiguresPerKind() {
        assertEquals(
            "Máy đã tự trừ: 4.680.000 ₫ · 18 lần",
            auditMoneyLine(vi, Fixtures.quietAuditFinding()),
        )
        assertEquals(
            "Tăng 10.000 ₫ (+17%)",
            auditMoneyLine(vi, Fixtures.priceAuditFinding(increaseVnd = 10_000, increasePercent = 17)),
        )
        assertEquals(
            "Tăng 10.000 ₫ (kỳ trước 0 ₫ nên không tính được %)",
            auditMoneyLine(vi, Fixtures.priceAuditFinding(increaseVnd = 10_000, increasePercent = null)),
        )
        assertEquals(
            "Quy đổi tháng của cả hai: ~40.000 ₫",
            auditMoneyLine(vi, Fixtures.duplicateAuditFinding(monthlyVnd = 40_000)),
        )
    }

    /** int64 money must not be narrowed to `Int` anywhere on this screen. */
    @Test
    fun moneyLine_handlesInt64Magnitudes() {
        val big = Fixtures.quietAuditFinding(
            chargedTotalVnd = 12_000_000_000L,
            chargeCount = 4_000_000_000L,
        )
        assertEquals("Máy đã tự trừ: 12.000.000.000 ₫ · 4000000000 lần", auditMoneyLine(vi, big))
    }

    @Test
    fun moneyLine_isAbsentWhenThereIsNoFigureToShow() {
        assertNull(auditMoneyLine(vi, Fixtures.quietAuditFinding(chargeCount = 0)))
        assertNull(auditMoneyLine(vi, Fixtures.priceAuditFinding(increaseVnd = null)))
        assertNull(auditMoneyLine(vi, Fixtures.duplicateAuditFinding(monthlyVnd = 0)))
    }

    // ---- thresholds card, links, ordering ----

    @Test
    fun thresholdLines_describeEveryRuleThatIsActuallyOn() {
        val lines = auditThresholdLines(vi, Fixtures.auditThresholds())

        assertEquals(4, lines.size)
        assertTrue(lines[0], lines[0].contains("≥ 3 khoản máy tự trừ"))
        assertTrue(lines[0], lines[0].contains("≥ 6 tháng"))
        assertTrue(lines[1], lines[1].contains("5%"))
        assertTrue(lines[2], lines[2].contains("14 ngày"))
        assertTrue(lines[3], lines[3].contains("bỏ dấu"))
    }

    @Test
    fun thresholdLines_omitUnsetRulesAndTheWholeCardWhenThereIsNothingToSay() {
        assertTrue(auditThresholdLines(vi, null).isEmpty())
        // The normalisation rule is a real flag, so turning it off drops its line.
        assertEquals(3, auditThresholdLines(vi, Fixtures.auditThresholds(duplicateNormalized = false)).size)
        val zeros = Fixtures.auditThresholds(
            quietMinAutoCharges = 0,
            quietMinMonths = 0,
            upcomingRenewalDays = 0,
            priceRiseMinPercent = 0,
            duplicateNormalized = false,
        )
        assertTrue(auditThresholdLines(vi, zeros).isEmpty())
    }

    @Test
    fun links_pairEveryInvolvedSubscriptionWithItsName() {
        val duplicate = Fixtures.duplicateAuditFinding(idA = "sub-3", idB = "sub-4")
        assertEquals(
            listOf(AuditLink("sub-3", "iCloud+"), AuditLink("sub-4", "icloud +")),
            auditLinks(duplicate),
        )
        assertEquals(
            listOf(AuditLink("sub-1", "Netflix")),
            auditLinks(Fixtures.quietAuditFinding(subscriptionId = "sub-1", name = "Netflix")),
        )
    }

    @Test
    fun links_surviveAMissingNameSoTheFindingStaysActionable() {
        val nameless = Fixtures.duplicateAuditFinding().copy(names = emptyList())
        assertEquals(
            listOf(AuditLink("sub-3", null), AuditLink("sub-4", null)),
            auditLinks(nameless),
        )
        assertTrue(auditLinks(Fixtures.quietAuditFinding().copy(subscriptionIds = listOf(" "))).isEmpty())
    }

    @Test
    fun sort_isSeverityThenBiggestMonthlyDrainThenKey() {
        val low = Fixtures.duplicateAuditFinding(monthlyVnd = 40_000)
        val highSmall = Fixtures.quietAuditFinding(subscriptionId = "sub-9", monthlyVnd = 10_000)
        val highBig = Fixtures.quietAuditFinding(subscriptionId = "sub-8", monthlyVnd = 900_000)
        val medium = Fixtures.priceAuditFinding(monthlyVnd = 69_000)

        assertEquals(
            listOf("QUIET_AUTO_RENEW:sub-8", "QUIET_AUTO_RENEW:sub-9", "PRICE_INCREASED:sub-2", "DUPLICATE:sub-3+sub-4"),
            auditSortFindings(listOf(low, highSmall, medium, highBig)).map { it.findingKey },
        )
    }

    @Test
    fun severity_isGradedInTheAuditsOwnWords() {
        assertEquals(ActionSeverity.HIGH, auditSeverityOf("HIGH"))
        assertEquals(ActionSeverity.UNKNOWN, auditSeverityOf("WHATEVER"))
        assertEquals("Đáng chú ý", auditSeverityLabel(vi, ActionSeverity.HIGH))
        assertEquals("Nên xem lại", auditSeverityLabel(vi, ActionSeverity.MEDIUM))
        assertEquals("Nhắc nhẹ", auditSeverityLabel(vi, ActionSeverity.LOW))
        assertEquals(PillKind.Danger, auditSeverityOf("HIGH").pill)
        assertEquals(PillKind.Neutral, auditSeverityOf("WHATEVER").pill)
    }

    @Test
    fun subtitle_countsTheFindingsTheServerCounted() {
        assertEquals("Không có gì đáng lưu ý", auditSubtitle(vi, ActionCounts(0, 0, 0, 0)))
        assertEquals("1 phát hiện cần xem lại", auditSubtitle(vi, ActionCounts(1, 1, 0, 0)))
        assertEquals("4 phát hiện cần xem lại", auditSubtitle(vi, ActionCounts(4, 1, 1, 2)))
    }

    @Test
    fun empty_isDecidedByTheFindingsList() {
        assertTrue(auditIsEmpty(Fixtures.subscriptionAudit(findings = emptyList())))
        assertFalse(auditIsEmpty(Fixtures.subscriptionAudit()))
    }

    /**
     * The shared VND formatter: Vietnamese grouping, `₫` suffix, `Long` input.
     *
     * `formatVndLong` used to be a private copy here; it is now `Money` (the one
     * implementation all six screens delegate to), so this asserts the same thing
     * one level down, and adds the English shape the audit screen renders when the
     * app is in English.
     *
     * The Vietnamese shape is `1.000.000 ₫` (space, U+20AB), which is what Go's
     * `FormatMoney` and the web emit — see the header of `VietnameseFormatterTest`
     * for why these assertions moved.
     */
    @Test
    fun money_matchesTheRestOfTheAppInRangeAndGivesEnglishItsOwnShape() {
        listOf(0, 999, 1_000, 12_500_000).forEach { amount ->
            assertEquals(Money.vietnamese(amount.toInt().toLong()), Money.vietnamese(amount.toLong()))
            assertEquals(Money.vietnamese(amount.toLong()), vi.money(amount.toLong()))
        }
        assertEquals("1.000.000 ₫", vi.money(1_000_000))
        assertEquals("₫1,000,000", en.money(1_000_000))
        assertEquals("-₫5,000", en.money(-5_000))
    }
}
