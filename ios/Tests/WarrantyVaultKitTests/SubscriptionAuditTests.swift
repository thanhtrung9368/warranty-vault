import Foundation
import XCTest
@testable import WarrantyVaultKit

/// "Soát gói đăng ký" — the pure half of the audit report.
///
/// Most of these are honesty tests rather than formatting tests. The feature is a
/// *conclusion*, and the app has no usage telemetry, so the copy is the risky
/// part: it must never say a plan is unused, never turn a 2% rise into an alert,
/// never label a payment date as a usage date, and never claim nothing was changed
/// unless the server said so.
final class SubscriptionAuditTests: KitTestCase {

    private func findingJSON(kind: String = "QUIET_AUTO_RENEW", severity: String = "HIGH",
                             subscriptionIds: [String] = ["sub_1"],
                             names: [String] = ["iCloud+ 200GB"],
                             monthlyVnd: Int64 = 59_000,
                             chargedTotalVnd: Int64 = 0,
                             chargeCount: Int64 = 0,
                             extra: String = "") -> String {
        let ids = subscriptionIds.map { "\"\($0)\"" }.joined(separator: ", ")
        let nameList = names.map { "\"\($0)\"" }.joined(separator: ", ")
        return """
        {"findingKey": "\(kind):x", "kind": "\(kind)", "severity": "\(severity)",
         "title": "Tiêu đề do server viết", "detail": "Chi tiết do server viết",
         "subscriptionIds": [\(ids)], "names": [\(nameList)],
         "monthlyVnd": \(monthlyVnd), "chargedTotalVnd": \(chargedTotalVnd),
         "chargeCount": \(chargeCount)\(extra)}
        """
    }

    private func finding(_ json: String) throws -> SubscriptionAuditFinding {
        try APIClient.decoder.decode(SubscriptionAuditFinding.self, from: Data(json.utf8))
    }

    private func thresholds(quietMinAutoCharges: Int = 3, quietMinMonths: Int = 6,
                            upcomingRenewalDays: Int = 14, priceRiseMinPercent: Int = 5,
                            duplicateNormalized: Bool = true) throws -> SubscriptionAuditThresholds {
        let json = """
        {"quietMinAutoCharges": \(quietMinAutoCharges), "quietMinMonths": \(quietMinMonths),
         "upcomingRenewalDays": \(upcomingRenewalDays), "priceRiseMinPercent": \(priceRiseMinPercent),
         "duplicateNormalized": \(duplicateNormalized)}
        """
        return try APIClient.decoder.decode(SubscriptionAuditThresholds.self, from: Data(json.utf8))
    }

    private func quietFinding() throws -> SubscriptionAuditFinding {
        try finding(findingJSON(
            chargedTotalVnd: 354_000, chargeCount: 6,
            extra: #", "lastRecordedAt": "2026-02-01T00:00:00", "#
                + #""nextRenewalAt": "2026-03-10T00:00:00", "daysUntilRenewal": 6"#
        ))
    }

    private func priceFinding(material: Bool?, increasePercent: Int? = 2) throws -> SubscriptionAuditFinding {
        let materialJSON = material.map { "\($0)" } ?? "null"
        let percentJSON = increasePercent.map { "\($0)" } ?? "null"
        return try finding(findingJSON(
            kind: "PRICE_INCREASED", severity: "MEDIUM",
            extra: #", "previousAmountVnd": 59000, "amountVnd": 61000, "increaseVnd": 2000, "#
                + #""increasePercent": \#(percentJSON), "material": \#(materialJSON), "#
                + #""lastRecordedAt": "2026-02-01T00:00:00""#
        ))
    }

    private func duplicateFinding(reason: String = "SAME_NAME") throws -> SubscriptionAuditFinding {
        try finding(findingJSON(
            kind: "DUPLICATE", severity: "LOW",
            subscriptionIds: ["sub_1", "sub_2"],
            names: ["iCloud+ 200GB", "ICLOUD+ 200GB"],
            monthlyVnd: 118_000,
            extra: #", "reason": "\#(reason)""#
        ))
    }

    // MARK: - The honesty line

    /// The app cannot know whether a subscription is used: there is no telemetry
    /// and no bank-transaction access. Every sentence the screen can print must
    /// therefore come from the server, which reports on RECORDING
    /// ("lâu rồi không thấy ghi nhận gì") — never on usage.
    func testNoLocalCopyEverClaimsASubscriptionIsUnused() throws {
        let t = try thresholds()
        let rendered: [String] = try [
            quietFinding(), priceFinding(material: false), priceFinding(material: true),
            duplicateFinding(),
        ].flatMap { f in
            [
                f.title, f.detail,
                SubscriptionAuditRules.ruleLabel(f, thresholds: t),
                SubscriptionAuditRules.materialNote(f, thresholds: t),
                SubscriptionAuditRules.moneyLine(f),
                SubscriptionAuditRules.timelineNote(f),
                SubscriptionAuditRules.minorPillLabel(f),
                SubscriptionAuditRules.severityLabel(f.severity),
            ].compactMap { $0 }
        } + [
            SubscriptionAuditRules.advisoryNote(true),
            SubscriptionAuditRules.entryTitle,
            SubscriptionAuditRules.entrySubtitle,
            SubscriptionAuditRules.subtitle(ActionCounts(total: 2, high: 1, medium: 1, low: 0)),
        ].compactMap { $0 } + SubscriptionAuditRules.thresholdLines(t)

        let forbidden = ["không dùng", "chưa dùng", "bỏ quên", "vô dụng", "lãng phí", "dùng lần cuối"]
        for phrase in forbidden {
            XCTAssertFalse(rendered.contains { $0.lowercased().contains(phrase) },
                           "the audit must never say \"\(phrase)\" — the data cannot support it")
        }
    }

    /// `advisory` is a statement about the server's behaviour, so it is repeated
    /// only when the payload actually made it.
    func testAdvisoryNoteAppearsOnlyWhenTheServerAssertedIt() {
        XCTAssertEqual(SubscriptionAuditRules.advisoryNote(true),
                       "Chỉ tư vấn: không có gì bị sửa, bị huỷ hay bị tắt tự động.")
        XCTAssertNil(SubscriptionAuditRules.advisoryNote(false))
    }

    /// A payload without `advisory` must not be described as harmless.
    func testAuditWithoutAdvisoryDegradesInsteadOfClaimingHarmlessness() throws {
        let json = """
        {"generatedAt": "2026-03-15T00:00:00Z", "findings": [],
         "counts": {"total": 0, "high": 0, "medium": 0, "low": 0}, "note": "n"}
        """
        let audit = try APIClient.decoder.decode(SubscriptionAudit.self, from: Data(json.utf8))

        XCTAssertFalse(audit.advisory)
        XCTAssertNil(SubscriptionAuditRules.advisoryNote(audit.advisory))
        XCTAssertNil(audit.thresholds)
        XCTAssertTrue(SubscriptionAuditRules.thresholdLines(audit.thresholds).isEmpty,
                      "no thresholds ⇒ the rule card is hidden, not invented")
        XCTAssertNil(SubscriptionAuditRules.ruleLabel(try quietFinding(), thresholds: audit.thresholds))
    }

    // MARK: - material: false

    /// `material = false` must read as minor — never as an alert — and the
    /// threshold that produced that judgement is named, not hard-coded.
    func testMaterialFalseIsRenderedAsAMinorChangeWithTheThresholdNamed() throws {
        let minor = try priceFinding(material: false, increasePercent: 2)
        let note = SubscriptionAuditRules.materialNote(minor, thresholds: try thresholds(priceRiseMinPercent: 5))

        XCTAssertEqual(note, "Mức tăng này dưới 5% nên chỉ là thay đổi nhỏ — không phải cảnh báo.")
        XCTAssertEqual(SubscriptionAuditRules.minorPillLabel(minor), "Thay đổi nhỏ")
        XCTAssertTrue(SubscriptionAuditRules.isMinorPriceRise(minor))
    }

    func testMaterialTrueOrAbsentProducesNoSofteningAndNoMinorPill() throws {
        let t = try thresholds()
        XCTAssertNil(SubscriptionAuditRules.materialNote(try priceFinding(material: true), thresholds: t))
        XCTAssertNil(SubscriptionAuditRules.materialNote(try priceFinding(material: nil), thresholds: t))
        XCTAssertNil(SubscriptionAuditRules.minorPillLabel(try priceFinding(material: true)))
        XCTAssertFalse(SubscriptionAuditRules.isMinorPriceRise(try priceFinding(material: true)))
        // Still honest without thresholds: the server's verdict is repeated, no
        // number is invented.
        XCTAssertEqual(SubscriptionAuditRules.materialNote(try priceFinding(material: false), thresholds: nil),
                       "Mức tăng này được đánh giá là nhỏ — không phải cảnh báo.")
    }

    /// A small rise is still listed (only its prominence changes), and the rule
    /// line says so.
    func testASmallRiseIsListedButDescribedAsImmaterial() throws {
        let minor = try priceFinding(material: false)
        let lines = SubscriptionAuditRules.thresholdLines(try thresholds(priceRiseMinPercent: 5))
        let priceLine = try XCTUnwrap(lines.first { $0.contains("Tăng giá") })

        XCTAssertTrue(priceLine.contains("mọi mức tăng đều được báo"))
        XCTAssertTrue(priceLine.contains("5%"))
        XCTAssertEqual(SubscriptionAuditRules.moneyLine(minor), "Tăng 2.000 ₫ (+2%)")
    }

    // MARK: - Rule lines come from the payload

    func testThresholdLinesAreBuiltFromThePayloadsOwnNumbers() throws {
        let lines = SubscriptionAuditRules.thresholdLines(
            try thresholds(quietMinAutoCharges: 4, quietMinMonths: 9,
                           upcomingRenewalDays: 21, priceRiseMinPercent: 7,
                           duplicateNormalized: false)
        )

        XCTAssertEqual(lines.count, 3, "duplicateNormalized = false ⇒ the name-matching line is left out")
        XCTAssertTrue(lines[0].contains("≥ 4 khoản") && lines[0].contains("≥ 9 tháng"))
        XCTAssertTrue(lines[1].contains("7%"))
        XCTAssertTrue(lines[2].contains("21 ngày"))

        let normalized = SubscriptionAuditRules.thresholdLines(try thresholds())
        XCTAssertTrue(normalized.contains { $0.contains("bỏ dấu") })
    }

    func testRuleLabelStatesTheThresholdsThatProducedTheFinding() throws {
        let t = try thresholds()
        let quiet = try XCTUnwrap(SubscriptionAuditRules.ruleLabel(try quietFinding(), thresholds: t))
        XCTAssertTrue(quiet.contains("ít nhất 3 lần"))
        XCTAssertTrue(quiet.contains("ít nhất 6 tháng"))

        let price = try XCTUnwrap(SubscriptionAuditRules.ruleLabel(try priceFinding(material: false), thresholds: t))
        XCTAssertTrue(price.contains("5%"))

        let sameName = try XCTUnwrap(SubscriptionAuditRules.ruleLabel(try duplicateFinding(), thresholds: t))
        XCTAssertTrue(sameName.contains("trùng tên"))
        XCTAssertTrue(sameName.contains("bỏ dấu"))

        let sameBrand = try XCTUnwrap(
            SubscriptionAuditRules.ruleLabel(try duplicateFinding(reason: "SAME_BRAND_CATEGORY"), thresholds: t)
        )
        XCTAssertTrue(sameBrand.contains("cùng hãng và cùng loại"))
    }

    // MARK: - Figures + labels

    /// "Khoản ghi nhận gần nhất" is a RECORDING date, not a usage date. The label
    /// is pinned because openapi is explicit that the app cannot know when a plan
    /// was last used.
    func testTimelineLabelsTheLastPaymentAsARecordingAndNeverAsUsage() throws {
        let line = try XCTUnwrap(SubscriptionAuditRules.timelineNote(try quietFinding()))

        XCTAssertEqual(line, "Khoản ghi nhận gần nhất: 01/02/2026 · Kỳ gia hạn tới: 10/03/2026 (còn 6 ngày)")
        XCTAssertTrue(line.contains("Khoản ghi nhận gần nhất"))
        XCTAssertFalse(line.lowercased().contains("dùng lần cuối"))
        XCTAssertNil(SubscriptionAuditRules.timelineNote(try duplicateFinding()))
    }

    func testMoneyLinesUseThePayloadsOwnFigures() throws {
        let quiet = try quietFinding()
        XCTAssertEqual(SubscriptionAuditRules.moneyLine(quiet), "Máy đã tự trừ: 354.000 ₫ · 6 lần")

        // chargeCount 0 ⇒ nothing to claim.
        XCTAssertNil(SubscriptionAuditRules.moneyLine(try finding(findingJSON())))

        // A previous period of 0đ cannot be a percentage — and the server says so
        // by sending increasePercent = null.
        XCTAssertEqual(SubscriptionAuditRules.moneyLine(try priceFinding(material: true, increasePercent: nil)),
                       "Tăng 2.000 ₫ (kỳ trước 0đ nên không tính được %)")

        XCTAssertEqual(SubscriptionAuditRules.moneyLine(try duplicateFinding()),
                       "Quy đổi tháng của cả hai: ~118.000 ₫")
    }

    /// Money on the wire is int64; a narrower field would silently drop a value
    /// this size and blank the screen.
    func testLargeInt64AmountsSurviveDecodingAndFormatting() throws {
        let json = """
        {"findingKey": "PRICE_INCREASED:x", "kind": "PRICE_INCREASED", "severity": "MEDIUM",
         "title": "t", "detail": "d", "subscriptionIds": ["s1"], "names": ["Gói"],
         "monthlyVnd": 4294967296, "chargedTotalVnd": 4294967296, "chargeCount": 4294967296,
         "increaseVnd": 4294967296, "previousAmountVnd": 0, "amountVnd": 4294967296}
        """
        let decoded = try finding(json)

        XCTAssertEqual(decoded.monthlyVnd, 4_294_967_296)
        XCTAssertEqual(decoded.chargedTotalVnd, 4_294_967_296)
        XCTAssertEqual(decoded.chargeCount, 4_294_967_296)
        XCTAssertEqual(decoded.increaseVnd, 4_294_967_296)
        XCTAssertEqual(SubscriptionAuditRules.moneyLine(decoded), "Tăng 4.294.967.296 ₫ (kỳ trước 0đ nên không tính được %)")
        XCTAssertEqual(SubscriptionAuditRules.formatVnd(-1_234_567), "-1.234.567 ₫")
        XCTAssertEqual(SubscriptionAuditRules.formatVnd(0), "0 ₫")
    }

    func testLinksPairIdsWithNamesAndSurviveAMissingName() throws {
        let duplicate = try duplicateFinding()
        XCTAssertEqual(SubscriptionAuditRules.links(duplicate).map(\.subscriptionId), ["sub_1", "sub_2"])
        XCTAssertEqual(SubscriptionAuditRules.links(duplicate).map(\.name), ["iCloud+ 200GB", "ICLOUD+ 200GB"])

        // An id with no matching name still yields a link: the id is enough to open
        // the row, and dropping it would hide the only way to act on the finding.
        let nameless = try finding("""
        {"findingKey": "DUPLICATE:a+b", "kind": "DUPLICATE", "severity": "LOW",
         "title": "t", "detail": "d", "subscriptionIds": ["a", "b"], "names": [],
         "monthlyVnd": 0, "chargedTotalVnd": 0, "chargeCount": 0}
        """)
        XCTAssertEqual(SubscriptionAuditRules.links(nameless).map(\.subscriptionId), ["a", "b"])
        XCTAssertEqual(SubscriptionAuditRules.links(nameless).map(\.name), [nil, nil])
    }

    func testOrderingAndCounts() throws {
        let auditJSON = """
        {"generatedAt": "2026-03-15T00:00:00Z",
         "findings": [
           \(duplicateFindingJSON()),
           \(quietFindingJSON()),
           \(priceFindingJSON())
         ],
         "counts": {"total": 3, "high": 1, "medium": 1, "low": 1},
         "advisory": true,
         "thresholds": {"quietMinAutoCharges": 3, "quietMinMonths": 6, "upcomingRenewalDays": 14,
                        "priceRiseMinPercent": 5, "duplicateNormalized": true},
         "note": "Đây là số liệu TỰ SOÁT từ những gì bạn đã ghi…"}
        """
        let audit = try APIClient.decoder.decode(SubscriptionAudit.self, from: Data(auditJSON.utf8))

        XCTAssertEqual(SubscriptionAuditRules.sorted(audit.findings).map(\.kind),
                       ["QUIET_AUTO_RENEW", "PRICE_INCREASED", "DUPLICATE"])
        XCTAssertEqual(SubscriptionAuditRules.findingCount(audit), 3)
        XCTAssertEqual(SubscriptionAuditRules.findingCount(nil), 0)
        XCTAssertEqual(SubscriptionAuditRules.subtitle(audit.counts), "3 phát hiện cần xem lại")
        XCTAssertEqual(SubscriptionAuditRules.subtitle(ActionCounts(total: 0, high: 0, medium: 0, low: 0)),
                       "Không có gì đáng lưu ý")
        XCTAssertTrue(audit.advisory)
        XCTAssertTrue(audit.note.contains("TỰ SOÁT"), "the server's note is surfaced as-is")
    }

    private func quietFindingJSON() -> String {
        """
        {"findingKey": "QUIET_AUTO_RENEW:s1", "kind": "QUIET_AUTO_RENEW", "severity": "HIGH",
         "title": "t", "detail": "d", "subscriptionIds": ["s1"], "names": ["A"],
         "monthlyVnd": 59000, "chargedTotalVnd": 1, "chargeCount": 1}
        """
    }

    private func priceFindingJSON() -> String {
        """
        {"findingKey": "PRICE_INCREASED:s2", "kind": "PRICE_INCREASED", "severity": "MEDIUM",
         "title": "t", "detail": "d", "subscriptionIds": ["s2"], "names": ["B"],
         "monthlyVnd": 61000, "chargedTotalVnd": 0, "chargeCount": 0}
        """
    }

    private func duplicateFindingJSON() -> String {
        """
        {"findingKey": "DUPLICATE:s3+s4", "kind": "DUPLICATE", "severity": "LOW",
         "title": "t", "detail": "d", "subscriptionIds": ["s3", "s4"], "names": ["C", "D"],
         "monthlyVnd": 118000, "chargedTotalVnd": 0, "chargeCount": 0}
        """
    }
}
