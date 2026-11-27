import XCTest

/// The one end-to-end smoke test for the XCUITest infrastructure:
///
/// 1. start the in-process mock API on `127.0.0.1`,
/// 2. launch the real app with `-ui-testing` and `WV_API_BASE_URL` pointing at
///    that server (and nothing else — no production credentials, no Lan/Duo),
/// 3. sign in with the fixture account through the real login form,
/// 4. wait for the dashboard and attach a screenshot.
///
/// If this passes, the target, the launch-argument handshake, the app's base
/// URL override and the mock API are all wired correctly. The deeper flows live
/// in the other suites in this directory.
final class WarrlySmokeTests: XCTestCase {

    private var server: MockAPIServer!
    private var app: XCUIApplication!

    override func setUpWithError() throws {
        continueAfterFailure = false

        server = MockAPIServer(scenario: .dashboard)
        try server.start()

        app = XCUIApplication()
        // `-ui-testing` is what enables the test-only base URL path and the
        // deterministic reset of Keychain/UserDefaults in `UITestSupport`.
        // Vietnamese copy is pinned so "Đăng nhập" is stable on any machine.
        app.launchArguments = [
            "-ui-testing",
            "-AppleLanguages", "(vi)",
            "-AppleLocale", "vi_VN",
        ]
        app.launchEnvironment["WV_API_BASE_URL"] = server.baseURL.absoluteString
        // Defensive: `-ui-testing` already suppresses the ads sequence, but this
        // is the existing DEBUG QA switch and keeps an accidental regression
        // from putting a system consent sheet over the login form.
        app.launchEnvironment["WV_QA_NO_ADS"] = "1"
    }

    override func tearDownWithError() throws {
        app?.terminate()
        server?.stop()
        server = nil
        app = nil
    }

    func testLoginWithMockAccountReachesDashboard() throws {
        app.launch()

        // MARK: Login screen

        let identifiedEmail = app.textFields["login.email"]
        let email = identifiedEmail.waitForExistence(timeout: 20)
            ? identifiedEmail
            : app.textFields.firstMatch
        XCTAssertTrue(
            email.exists,
            "The login form never appeared. The app likely crashed at launch (check the base URL) or stayed on the bootstrap spinner."
        )
        email.tap()
        // A tap alone is not enough: the field is focused by the same run loop
        // that raises the keyboard, and typing before it is up fails with
        // "Neither element nor any descendant has keyboard focus" (seen once in
        // a 14-test run). Wait for the keyboard, and tap again once if it never
        // arrives, so this flake is about keystroke timing and not the app.
        if !app.keyboards.firstMatch.waitForExistence(timeout: 5) {
            email.tap()
            XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5),
                          "The keyboard never opened for the email field")
        }
        email.typeText(UITestFixtures.userEmail)

        let identifiedPassword = app.secureTextFields["login.password"]
        let password = identifiedPassword.waitForExistence(timeout: 5)
            ? identifiedPassword
            : app.secureTextFields.firstMatch
        XCTAssertTrue(password.exists,
                      "The password field is missing from the login form.")
        password.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5),
                      "The keyboard is not up for the password field")
        // The field's submit label is `.go` and its `onSubmit` calls the same
        // login path as the button; the newline submits without needing the CTA
        // to be visible above the keyboard on a small phone.
        password.typeText(UITestFixtures.password + "\n")

        // MARK: Dashboard

        // The identifier is on DashboardView's root ScrollView. The tab bar is
        // the fallback because a SwiftUI accessibility identifier can surface on
        // a descendant rather than the scroll view itself after an OS update.
        let dashboard = app.scrollViews["dashboard.screen"]
        let tabBar = app.tabBars.firstMatch
        let dashboardAppeared = dashboard.waitForExistence(timeout: 30)
            || tabBar.waitForExistence(timeout: 10)

        XCTAssertTrue(
            dashboardAppeared,
            "The dashboard did not appear after signing in against the mock API. The login request, the fixture response or the base URL override is broken."
        )

        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "dashboard-after-mock-login"
        screenshot.lifetime = .keepAlways
        add(screenshot)
    }
}
