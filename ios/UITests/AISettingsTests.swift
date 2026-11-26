import XCTest

/// Settings → AI card: the 1.0.3 split consent disclosure and its opt-in
/// switch.
///
/// The disclosure is not a single footer paragraph any more. It is a lead
/// sentence, three numbered list items (one per thing the assistant does) and
/// three short paragraphs (retention, what Warrly keeps, and "draft only").
/// Those are the facts the consent turns on, so they are asserted one by one
/// instead of as one substring. The switch sits beside the card title with a
/// hidden label, so it is paired by its row band, not by a guessed identifier.
final class AISettingsTests: WarrlyFlowTestCase {

    private let cardTitle = "Quét hoá đơn, thẻ bảo hành & đánh giá bảo hành"
    private let lead = "Khi bật, trợ lý AI làm ba việc:"

    private let item1 = "Đọc ảnh/PDF hoá đơn hoặc thẻ bảo hành để tự điền thông tin. File đã giải mã được gửi tới Anthropic, dịch vụ AI ở Mỹ (ngoài Việt Nam)."
    private let item2 = "Đọc chín điều khoản hợp đồng từ thẻ bảo hành."
    private let item3 = "Đánh giá một lần sửa chữa có thuộc diện bảo hành không và soạn đơn gửi trung tâm. Nội dung phiếu sửa chữa, thông tin thiết bị và điều khoản hợp đồng cũng được gửi tới Anthropic."

    private let paragraph1 = "Anthropic tự động xoá đầu vào/đầu ra trong vòng 30 ngày (trừ khi pháp luật hoặc chính sách của họ yêu cầu giữ lâu hơn) và mặc định không dùng dữ liệu API để huấn luyện."
    private let paragraph2 = "Phía Warrly, ảnh/PDF vẫn được mã hoá; chỉ văn bản đọc được lưu dạng plaintext trong cơ sở dữ liệu để tìm kiếm."
    private let paragraph3 = "Mọi kết quả chỉ là gợi ý hoặc bản nháp để bạn kiểm tra lại, không phải quyết định. Mặc định tắt."

    func testAIConsentIsSplitIntoLeadListAndParagraphs() throws {
        try launch(.settingsFree)
        UITestSupport.openSettings(in: app)

        let title = app.staticTexts[cardTitle]
        XCTAssertTrue(UITestSupport.scrollTo(title, in: app),
                      "The AI card never became visible on Settings")

        let leadElement = UITestSupport.staticText(lead, in: app)
        XCTAssertTrue(UITestSupport.scrollTo(leadElement, in: app),
                      "The AI consent lead sentence is missing")

        // Three numbered items, each its own accessibility element (the app
        // combines the number and the sentence), not one run-on paragraph.
        let numbered = [
            (number: "1.", phrase: "Đọc ảnh/PDF hoá đơn", full: item1),
            (number: "2.", phrase: "Đọc chín điều khoản hợp đồng", full: item2),
            (number: "3.", phrase: "Đánh giá một lần sửa chữa", full: item3),
        ]
        for item in numbered {
            let element = app.descendants(matching: .any)
                .matching(NSPredicate(format: "label CONTAINS %@", item.phrase))
                .firstMatch
            XCTAssertTrue(element.exists, "AI consent item \(item.number) is missing")
            XCTAssertTrue(element.label.contains(item.number),
                          "AI consent item \(item.number) is not rendered as a numbered list item: \(element.label)")
            XCTAssertTrue(element.label.contains(item.full),
                          "AI consent item \(item.number) text changed")
        }

        // The three paragraphs are separate blocks below the list.
        let firstParagraph = UITestSupport.staticText(paragraph1, in: app)
        XCTAssertTrue(UITestSupport.scrollTo(firstParagraph, in: app),
                      "The retention paragraph is missing")
        XCTAssertTrue(UITestSupport.staticText(paragraph2, in: app).exists,
                      "The 'what Warrly keeps' paragraph is missing")
        XCTAssertTrue(UITestSupport.staticText(paragraph3, in: app).exists,
                      "The 'draft only' paragraph is missing")

        attachScreenshot(named: "settings-ai-consent")
    }

    func testAIOptInToggleExistsInTheCardAndStartsOff() throws {
        try launch(.settingsFree)
        UITestSupport.openSettings(in: app)

        let title = app.staticTexts[cardTitle]
        XCTAssertTrue(UITestSupport.scrollTo(title, in: app),
                      "The AI card never became visible on Settings")

        let toggle = UITestSupport.switchOverlapping(title, in: app)
        XCTAssertNotNil(toggle, "No switch found in the AI card's row")
        guard let toggle else { return }
        XCTAssertTrue(toggle.isEnabled, "The AI opt-in switch is disabled")

        // `GET /ai/opt-in` in the settings-free fixture answers false: the
        // consent default is OFF, and the subtitle says so.
        XCTAssertEqual(toggle.value as? String, "0",
                       "The AI opt-in switch is not off for a fresh account")
        XCTAssertTrue(app.staticTexts["Đang tắt — không gửi gì tới dịch vụ AI"].exists,
                      "The AI card does not say that nothing is sent while off")
    }
}
