import XCTest

/// Dashboard smoke: the landing tab must answer with the fixture's deadline,
/// not with its "nothing here" or "could not load" fallbacks.
///
/// The dashboard reads devices, reminders, subscriptions and wishlist in
/// parallel. An absent fixture therefore has two very different shapes — an
/// empty state or an error card — and both are asserted absent here so a mock
/// that silently stops serving one feed cannot pass this suite.
final class DashboardSmokeTests: WarrlyFlowTestCase {

    /// Copy that means the dashboard could not show the data it has.
    private let fallbackCopy = [
        "Chưa có hạn nào",                      // genuine empty account
        "Không tải được hạn gần nhất",          // reminders/subscriptions/wishlist failed
        "Một số hạn có thể chưa được tải.",     // partial failure with candidates
        "Không kết nối được máy chủ.",          // bootstrap retry screen
    ]

    func testDashboardLoadsWithoutEmptyOrErrorFallback() throws {
        try launch(.dashboard)

        XCTAssertTrue(UITestSupport.waitForTab("Tổng quan", index: 0, in: app),
                      "Authenticated shell did not appear")
        XCTAssertTrue(app.navigationBars["Tổng quan"].waitForExistence(timeout: 10),
                      "Dashboard navigation bar is missing")
        // Stable root anchor added for XCUITest. A SwiftUI identifier can land
        // on the ScrollView or on one of its children, so both are accepted.
        let identifiedScrollView = app.scrollViews["dashboard.screen"]
        let identifiedDescendant = app.descendants(matching: .any)["dashboard.screen"]
        let foundAnchor = identifiedScrollView.waitForExistence(timeout: 5)
            || identifiedDescendant.waitForExistence(timeout: 5)
        XCTAssertTrue(foundAnchor, "dashboard.screen identifier is missing")

        // The lead card is one combined accessibility element (its children are
        // combined), so the fixture device name is what proves the card carries
        // real data rather than a skeleton.
        let leadCard = app.buttons
            .matching(NSPredicate(format: "label CONTAINS %@", Fixture.deviceName))
            .firstMatch
        XCTAssertTrue(leadCard.waitForExistence(timeout: 10),
                      "Dashboard did not render a deadline card for \(Fixture.deviceName)")

        for copy in fallbackCopy {
            XCTAssertFalse(app.staticTexts[copy].exists,
                           "Dashboard showed fallback copy: \(copy)")
        }

        attachScreenshot(named: "dashboard-loaded")
    }
}
