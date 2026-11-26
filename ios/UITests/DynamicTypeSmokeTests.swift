import XCTest

/// Dynamic Type smoke at AX3 (Accessibility Extra Extra Extra Large), the size
/// the 1.0.3 UI sweep fixed: labels move above their values, rows switch to a
/// stacked axis and section footers wrap instead of widening the page.
///
/// The launch argument is the system's own override; no app hook is involved.
/// "Not clipped" is asserted two ways because XCUITest has no direct ellipsis
/// query:
///   1. every visible `Text` must stay inside the window horizontally (text
///      pushed off-screen is the other way large type gets lost);
///   2. for the critical copy, the element's frame must be tall enough for the
///      lines its accessibility label needs at the same AX3 font size
///      (`UITestSupport.assertNotClipped`).
///
/// A full-screen screenshot is attached to each test as the human-reviewable
/// half of that check.
final class DynamicTypeSmokeTests: WarrlyFlowTestCase {

    private let aiTitle = "Quét hoá đơn, thẻ bảo hành & đánh giá bảo hành"
    private let aiLead = "Khi bật, trợ lý AI làm ba việc:"
    private let retentionParagraph = "Anthropic tự động xoá đầu vào/đầu ra trong vòng 30 ngày (trừ khi pháp luật hoặc chính sách của họ yêu cầu giữ lâu hơn) và mặc định không dùng dữ liệu API để huấn luyện."

    func testSettingsAtAccessibilityXXXLDoesNotClipCriticalText() throws {
        try launch(.settingsFree,
                   extraArguments: UITestSupport.accessibilityXXXLArguments)

        UITestSupport.openSettings(in: app)

        // Proves the launch argument actually reached the app: a footnote
        // section header is ~16 pt tall at the default size and needs real
        // vertical room at AX3.
        let sectionHeader = app.staticTexts["GIAO DIỆN"]
        XCTAssertTrue(UITestSupport.scrollTo(sectionHeader, in: app),
                      "Settings never rendered the Giao diện section")
        XCTAssertGreaterThan(sectionHeader.frame.height, 25,
                             "AX3 did not apply: the footnote header is only \(sectionHeader.frame.height) pt tall")
        UITestSupport.assertNotClipped(sectionHeader, style: .footnote, weight: .semibold, in: app)

        // A shared row at AX3: the title must be fully present in the
        // accessibility tree and the row must stay tappable.
        let premiumRow = UITestSupport.element(containing: "Nâng cấp Warrly Premium", in: app)
        XCTAssertTrue(UITestSupport.scrollTo(premiumRow, in: app),
                      "The Premium row disappeared at AX3")
        XCTAssertTrue(premiumRow.label.contains("Nâng cấp Warrly Premium"),
                      "The Premium row title is truncated at AX3: \(premiumRow.label)")

        // The split AI consent: long body title, lead, and a multi-line footer
        // paragraph. These are the blocks whose copy grows fastest with type.
        let title = UITestSupport.staticText(aiTitle, in: app)
        XCTAssertTrue(UITestSupport.scrollTo(title, in: app, maxSwipes: 40),
                      "The AI card title never became visible at AX3")
        UITestSupport.assertNotClipped(title, style: .body, in: app)

        let lead = UITestSupport.staticText(aiLead, in: app)
        XCTAssertTrue(UITestSupport.scrollTo(lead, in: app, maxSwipes: 40),
                      "The AI consent lead never became visible at AX3")
        UITestSupport.assertNotClipped(lead, style: .footnote, in: app)

        let paragraph = UITestSupport.staticText(retentionParagraph, in: app)
        XCTAssertTrue(UITestSupport.scrollTo(paragraph, in: app, maxSwipes: 40),
                      "The retention paragraph never became visible at AX3")
        UITestSupport.assertNotClipped(paragraph, style: .footnote, in: app)

        UITestSupport.assertVisibleTextsStayInWindow(in: app)
        attachScreenshot(named: "dynamic-type-ax3-settings")
    }

    func testDeviceDetailAtAccessibilityXXXLDoesNotClipPriceRows() throws {
        try launch(.deviceUsdFx,
                   extraArguments: UITestSupport.accessibilityXXXLArguments)

        UITestSupport.openDevice(named: Fixture.deviceName, in: app)

        // "Giá mua": the label must wrap rather than lose characters, and its
        // value must still be the device's own currency.
        let purchaseTitle = app.staticTexts["Giá mua"]
        XCTAssertTrue(UITestSupport.scrollTo(purchaseTitle, in: app),
                      "Giá mua never became visible at AX3")
        UITestSupport.assertNotClipped(purchaseTitle, style: .body, in: app)
        XCTAssertTrue(app.staticTexts[Fixture.purchasePrice].exists,
                      "The listed price is missing at AX3")

        // The two rows that must not collapse into one another: the actual
        // charge and the locked rate are separate facts.
        let chargedTitle = app.staticTexts["Thực tế bị charge"]
        XCTAssertTrue(UITestSupport.scrollTo(chargedTitle, in: app),
                      "Thực tế bị charge never became visible at AX3")
        UITestSupport.assertNotClipped(chargedTitle, style: .body, in: app)
        XCTAssertTrue(app.staticTexts[Fixture.actualCharged].exists,
                      "The actual charged amount is missing at AX3")

        let lockedTitle = app.staticTexts["Tỷ giá đã chốt"]
        XCTAssertTrue(UITestSupport.scrollTo(lockedTitle, in: app),
                      "Tỷ giá đã chốt never became visible at AX3")
        UITestSupport.assertNotClipped(lockedTitle, style: .body, in: app)
        XCTAssertTrue(app.staticTexts[Fixture.lockedRate].exists,
                      "The locked rate is missing at AX3")

        // The reference block is the third price surface and the one with the
        // most copy; it must still render its badge at AX3.
        let referenceHeader = app.staticTexts["TỶ GIÁ THAM KHẢO"]
        XCTAssertTrue(UITestSupport.scrollTo(referenceHeader, in: app),
                      "Tỷ giá tham khảo never became visible at AX3")
        XCTAssertTrue(app.staticTexts["Chỉ tham khảo"].exists,
                      "The reference badge is missing at AX3")

        UITestSupport.assertVisibleTextsStayInWindow(in: app)
        attachScreenshot(named: "dynamic-type-ax3-device-detail")
    }
}
