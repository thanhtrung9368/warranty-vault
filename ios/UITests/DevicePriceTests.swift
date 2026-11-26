import XCTest

/// Device detail, foreign-currency price: the listed amount, the amount the
/// account was actually charged, the locked rate, and the reference-only
/// market block.
///
/// The contract under test (Warrly 1.0.3):
///   * `Giá mua` is the amount in the device's own currency (`999 USD`), never
///     relabelled as dong.
///   * `Thực tế bị charge` is the server-computed `purchasePriceVnd`.
///   * `Tỷ giá đã chốt` is the rate stored at entry.
///   * `Tỷ giá tham khảo` is today's market quote, marked `Chỉ tham khảo`, and
///     it must NOT overwrite the locked rate — the two rows show different
///     numbers and both stay on screen.
final class DevicePriceTests: WarrlyFlowTestCase {

    func testForeignPriceShowsListedChargedAndReferenceWithoutOverwritingRate() throws {
        try launch(.deviceUsdFx)

        UITestSupport.openDevice(named: Fixture.deviceName, in: app)

        // MARK: Listed price and the charge

        let purchaseTitle = app.staticTexts["Giá mua"]
        XCTAssertTrue(UITestSupport.scrollTo(purchaseTitle, in: app),
                      "Giá mua row never became visible")
        UITestSupport.assertRow(title: "Giá mua", value: Fixture.purchasePrice, in: app)

        let chargedTitle = app.staticTexts["Thực tế bị charge"]
        XCTAssertTrue(UITestSupport.scrollTo(chargedTitle, in: app),
                      "Thực tế bị charge row never became visible")
        UITestSupport.assertRow(title: "Thực tế bị charge",
                                value: Fixture.actualCharged,
                                in: app)

        let lockedTitle = app.staticTexts["Tỷ giá đã chốt"]
        XCTAssertTrue(UITestSupport.scrollTo(lockedTitle, in: app),
                      "Tỷ giá đã chốt row never became visible")
        UITestSupport.assertRow(title: "Tỷ giá đã chốt",
                                value: Fixture.lockedRate,
                                in: app)

        // MARK: Reference-only market block

        let referenceHeader = app.staticTexts["TỶ GIÁ THAM KHẢO"]
        XCTAssertTrue(UITestSupport.scrollTo(referenceHeader, in: app),
                      "Tỷ giá tham khảo block never became visible")
        XCTAssertTrue(app.staticTexts["Chỉ tham khảo"].exists,
                      "The reference block is missing its Chỉ tham khảo badge")
        XCTAssertTrue(app.staticTexts["Không thay đổi tỷ giá đã chốt."].exists,
                      "The reference block does not state that it leaves the locked rate alone")

        // The market table is a separate, asynchronous read: wait for a row it
        // renders rather than sleeping. Off-screen rows still exist once loaded.
        XCTAssertTrue(app.staticTexts["Tỷ giá thị trường"].waitForExistence(timeout: 10),
                      "The mock FX table never reached the reference block")
        XCTAssertTrue(UITestSupport.scrollTo(app.staticTexts["Tỷ giá thị trường"], in: app),
                      "Tỷ giá thị trường row never became visible")
        UITestSupport.assertRow(title: "Tỷ giá thị trường",
                                value: Fixture.marketRate,
                                in: app)

        XCTAssertTrue(UITestSupport.scrollTo(app.staticTexts["Giá tham khảo"], in: app),
                      "Giá tham khảo row never became visible")
        UITestSupport.assertRow(title: "Giá tham khảo",
                                value: Fixture.referencePrice,
                                in: app)

        XCTAssertTrue(UITestSupport.scrollTo(app.staticTexts["Chênh lệch"], in: app),
                      "Chênh lệch row never became visible")
        UITestSupport.assertRow(title: "Chênh lệch",
                                value: Fixture.referenceDelta,
                                in: app)

        // MARK: The reference must not become the stored rate

        // Both numbers exist at the same time and they are different. If the
        // market read had written `fxRate`, the locked row would now print the
        // market number and this constant would be gone.
        XCTAssertTrue(app.staticTexts[Fixture.lockedRate].exists,
                      "The locked rate changed after the reference table loaded")
        XCTAssertTrue(app.staticTexts[Fixture.marketRate].exists,
                      "The market rate is not shown beside the locked rate")
        XCTAssertNotEqual(Fixture.lockedRate, Fixture.marketRate,
                          "The fixture is meaningless if the two rates match")

        attachScreenshot(named: "device-price-reference")
    }
}
