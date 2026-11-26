import UIKit
import XCTest

// ============================================================
// Shared support for the Warrly 1.0.3 XCUITest flows.
//
// ## Launch contract
//
// These tests are authored against the `WarrlyUITests` target and its
// `MockAPIServer` (owned by the UI-test infrastructure change). The contract
// they rely on:
//
//   * `-ui-testing` — required. Enables test mode and resets the app's local
//     state (Keychain token, RememberedEmail, UserDefaults language/app-lock/
//     ads, App Group inbox) before any store reads it. State does not leak
//     between tests.
//   * `WV_API_BASE_URL` — points the app at `MockAPIServer.baseURL`. It is the
//     test-gated companion the app only reads on the `-ui-testing` path
//     (`WV_BASE_URL` also works, but is not test-gated). ATS only exempts
//     `localhost`, so the mock URL uses `localhost`.
//   * `WV_QA_TOKEN` — the app's existing DEBUG-only token hook. Authenticated
//     scenarios use it instead of driving the login form; `.loggedOut` omits it.
//   * `-AppleLanguages (vi)` / `-AppleLocale vi_VN` — pins the UI language, so
//     the copy assertions below are the Vietnamese source strings the app
//     actually renders. `LocalizationStore` reads `Locale.preferredLanguages`.
//   * `-UIPreferredContentSizeCategoryName UICTContentSizeCategoryAccessibilityXXXL`
//     — the system's Dynamic Type override, used by DynamicTypeSmokeTests.
//
// A scenario is chosen by constructing `MockAPIServer(scenario:)`; the app does
// NOT read a scenario launch argument.
//
// ## Identifiers and text queries
//
// Base 1.0.3 exposes only three accessibility identifiers (`receipt-add`,
// `receipt-thumb-*`, `attachment-preview-close`), none of which these flows
// touch. The UI-test infrastructure adds `login.email` / `login.password` /
// `login.submit` and `dashboard.screen`; those are used here. Everything else
// (Settings, device detail, paywall, the AI card) has no identifier, so those
// queries use the accessibility labels and copy VoiceOver reads. Do not invent
// identifiers for them.
// ============================================================

/// The server scenarios these suites need, mapped onto the mock target's enum.
///
/// Kept as a local enum so the tests state which fixture set they require
/// instead of spreading a server type through six files.
enum FlowScenario {
    case loggedOut
    case dashboard
    case deviceUsdFx
    case settingsFree
    case premiumIneligible
    case premiumEligible

    var mockScenario: UITestScenario {
        switch self {
        case .loggedOut:          return .loggedOut
        case .dashboard:          return .dashboard
        case .deviceUsdFx:        return .deviceUsdFx
        case .settingsFree:       return .settingsFree
        case .premiumIneligible:  return .premiumIneligible
        case .premiumEligible:    return .premiumEligible
        }
    }
}

/// Base class: one mock server + one app launch per test.
///
/// `-ui-testing` reset is what makes a per-test launch safe: a login test can
/// leave a token in the Keychain and the next `loggedOut` launch still starts
/// at the login screen.
class WarrlyFlowTestCase: XCTestCase {
    let app = XCUIApplication()

    /// The fixture values the mock returns. They are duplicated here instead of
    /// imported so a fixture change in the test target is a visible edit on the
    /// assertion side too.
    enum Fixture {
        static let userEmail = "qa@warrly.test"
        static let userPassword = "qa-password"
        static let deviceName = "MacBook Pro QA"
        static let purchasePrice = "999 USD"
        static let lockedRate = "1 USD = 26.130 ₫"
        static let actualCharged = "26.103.870 ₫"
        static let marketRate = "1 USD = 26.500 ₫"
        static let referencePrice = "26.473.500 ₫"
        /// `26.103.870 − 26.473.500`, with the formatter's own minus sign.
        static let referenceDelta = "-369.630 ₫"
    }

    private var server: MockAPIServer?

    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    override func tearDownWithError() throws {
        app.terminate()
        server?.stop()
        server = nil
    }

    /// Starts the fixture server, points the app at it, and launches.
    ///
    /// - Parameters:
    ///   - scenario: fixture set served by `MockAPIServer`.
    ///   - authenticated: injects `WV_QA_TOKEN` so `/auth/me` succeeds without
    ///     driving the login screen. Pass `false` for `.loggedOut`.
    ///   - environment: extra launch-environment values (e.g. the StoreKit
    ///     fixture flags the paywall tests document).
    ///   - extraArguments: extra launch arguments (e.g. Dynamic Type).
    func launch(_ scenario: FlowScenario,
                authenticated: Bool = true,
                environment: [String: String] = [:],
                extraArguments: [String] = []) throws {
        let server = MockAPIServer(scenario: scenario.mockScenario)
        try server.start()
        self.server = server

        app.launchEnvironment["WV_API_BASE_URL"] = server.baseURL.absoluteString
        if authenticated {
            app.launchEnvironment["WV_QA_TOKEN"] = "qa-token"
        }
        for (key, value) in environment {
            app.launchEnvironment[key] = value
        }

        app.launchArguments = [
            "-ui-testing",
            "-AppleLanguages", "(vi)",
            "-AppleLocale", "vi_VN",
        ] + extraArguments
        app.launch()
    }

    /// Keeps the full-screen evidence with the test result (`.keepAlways` so it
    /// survives a red run too).
    func attachScreenshot(named name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}

// MARK: - Queries, navigation, scrolling, geometry

enum UITestSupport {
    /// The system launch argument that renders the app at AX3.
    static let accessibilityXXXLArguments = [
        "-UIPreferredContentSizeCategoryName",
        "UICTContentSizeCategoryAccessibilityXXXL",
    ]

    // MARK: Queries

    /// Any accessible element whose label contains `text`.
    ///
    /// Deliberately type-agnostic: a SwiftUI `Button` row, a `Text` and a
    /// combined accessibility element all need the same query, and the app has
    /// no identifiers for them.
    static func element(containing text: String, in app: XCUIApplication) -> XCUIElement {
        app.descendants(matching: .any)
            .matching(NSPredicate(format: "label CONTAINS %@", text))
            .firstMatch
    }

    /// An exact `Text` match by label, expressed as a predicate.
    ///
    /// XCUITest rejects a string subscript longer than 128 characters
    /// outright (it treats the string as an identifier), so any paragraph copy
    /// must go through a predicate even though it is still an exact match.
    static func staticText(_ text: String, in app: XCUIApplication) -> XCUIElement {
        app.staticTexts
            .matching(NSPredicate(format: "label == %@", text))
            .firstMatch
    }

    /// Exact label first, then the same contains fallback.
    ///
    /// Row buttons concatenate their title and subtitle, so an exact match is
    /// preferred where the screen has one (`Cài đặt`) and a contains match is
    /// the safety net where it does not.
    static func element(exactly text: String, in app: XCUIApplication) -> XCUIElement {
        let exact = app.descendants(matching: .any)
            .matching(NSPredicate(format: "label == %@", text))
            .firstMatch
        return exact.exists ? exact : element(containing: text, in: app)
    }

    /// A tappable element containing `text`, preferring a real `Button`.
    ///
    /// A SwiftUI row exposes both the `Button` (with its combined label) and
    /// its child `Text`. Tapping the child happens to forward, but only the
    /// button carries the row's full hit area; on a row clipped by the bottom
    /// safe area, tapping the child's centre can land on the home indicator
    /// instead. Prefer the button where one exists.
    static func tappableElement(containing text: String, in app: XCUIApplication) -> XCUIElement {
        let predicate = NSPredicate(format: "label CONTAINS %@", text)
        let button = app.buttons.matching(predicate).firstMatch
        if button.exists { return button }
        return app.descendants(matching: .any).matching(predicate).firstMatch
    }

    // MARK: Login fields

    /// The login form's email field. The app exposes `login.email` /
    /// `login.password` / `login.submit` identifiers (added for XCUITest); the
    /// first-field fallback keeps the suite usable if an identifier ever moves
    /// onto a wrapper, which is exactly the failure the smoke test already
    /// guards against.
    static func loginField(_ identifier: String,
                           secure: Bool,
                           in app: XCUIApplication) -> XCUIElement {
        let query = secure ? app.secureTextFields : app.textFields
        let identified = query[identifier]
        return identified.waitForExistence(timeout: 5) ? identified : query.firstMatch
    }

    /// The login form's primary action, by identifier with a copy fallback.
    static func loginSubmit(in app: XCUIApplication) -> XCUIElement {
        let identified = app.buttons["login.submit"]
        return identified.waitForExistence(timeout: 5)
            ? identified
            : app.buttons["Đăng nhập"]
    }

    // MARK: Navigation

    /// The tab's button on either shell the app can draw.
    ///
    /// `WVSidebarAdaptableShell` uses `sidebarAdaptable`, which renders a
    /// vertical sidebar instead of a bottom tab bar on a regular-width window
    /// (iPad, an unfolded foldable, the Duo). A sidebar item is a plain
    /// `Button`, not `tabBars.buttons`, so a tab query that only looks at
    /// `tabBars` reports "dashboard never appeared" while the dashboard is
    /// already on screen. Both shapes are accepted here.
    static func tabButton(_ title: String, index: Int, in app: XCUIApplication) -> XCUIElement {
        let barButton = app.tabBars.buttons[title]
        if barButton.exists { return barButton }
        let anyButton = app.buttons
            .matching(NSPredicate(format: "label == %@", title))
            .firstMatch
        if anyButton.exists { return anyButton }
        return app.tabBars.buttons.element(boundBy: index)
    }

    /// Waits for a tab, in the bottom bar or the sidebar, without assuming which
    /// shell the current window width produced.
    @discardableResult
    static func waitForTab(_ title: String,
                           index: Int,
                           in app: XCUIApplication,
                           timeout: TimeInterval = 15) -> Bool {
        let barButton = app.tabBars.buttons[title]
        if barButton.exists { return true }
        let anyButton = app.buttons
            .matching(NSPredicate(format: "label == %@", title))
            .firstMatch
        if anyButton.waitForExistence(timeout: 3) { return true }
        return barButton.waitForExistence(timeout: timeout)
    }

    /// Taps a tab by its accessibility label, falling back to its position if
    /// the label is abbreviated on a narrow/sidebar layout.
    static func selectTab(_ title: String,
                          index: Int,
                          in app: XCUIApplication,
                          file: StaticString = #filePath,
                          line: UInt = #line) {
        let barButton = app.tabBars.buttons[title]
        if barButton.exists {
            barButton.tap()
            return
        }
        let anyButton = app.buttons
            .matching(NSPredicate(format: "label == %@", title))
            .firstMatch
        if anyButton.waitForExistence(timeout: 5) {
            anyButton.tap()
            return
        }
        if barButton.waitForExistence(timeout: 5) {
            barButton.tap()
            return
        }
        let byIndex = app.tabBars.buttons.element(boundBy: index)
        XCTAssertTrue(byIndex.waitForExistence(timeout: 5),
                      "Neither the tab bar nor the sidebar exposed \(title) (index \(index))",
                      file: file, line: line)
        byIndex.tap()
    }

    /// Tôi tab → Cài đặt.
    static func openSettings(in app: XCUIApplication,
                             file: StaticString = #filePath,
                             line: UInt = #line) {
        selectTab("Tôi", index: 4, in: app, file: file, line: line)
        XCTAssertTrue(app.navigationBars["Tôi"].waitForExistence(timeout: 10),
                      "The Tôi tab did not open", file: file, line: line)
        let row = tappableElement(containing: "Cài đặt", in: app)
        XCTAssertTrue(scrollTo(row, in: app),
                      "Couldn't reach the Cài đặt row on the Tôi tab",
                      file: file, line: line)
        row.tap()
        XCTAssertTrue(app.navigationBars["Cài đặt"].waitForExistence(timeout: 10),
                      "Cài đặt did not open",
                      file: file, line: line)
    }

    /// Thiết bị tab → the named device's detail screen.
    static func openDevice(named name: String,
                           in app: XCUIApplication,
                           file: StaticString = #filePath,
                           line: UInt = #line) {
        selectTab("Thiết bị", index: 1, in: app, file: file, line: line)
        XCTAssertTrue(app.navigationBars["Thiết bị"].waitForExistence(timeout: 10),
                      "Device list did not load",
                      file: file, line: line)

        let row = tappableElement(containing: name, in: app)
        XCTAssertTrue(scrollTo(row, in: app),
                      "Couldn't reach device \(name) in the list",
                      file: file, line: line)
        row.tap()
        XCTAssertTrue(app.navigationBars[name].waitForExistence(timeout: 10),
                      "Device detail for \(name) did not open",
                      file: file, line: line)
    }

    /// Cài đặt → the Premium row → paywall sheet.
    static func openPaywall(in app: XCUIApplication,
                            premium: Bool,
                            file: StaticString = #filePath,
                            line: UInt = #line) {
        openSettings(in: app, file: file, line: line)
        let rowTitle = premium ? "Premium đang hoạt động" : "Nâng cấp Warrly Premium"
        let row = tappableElement(containing: rowTitle, in: app)
        XCTAssertTrue(scrollTo(row, in: app),
                      "Couldn't reach the Premium row",
                      file: file, line: line)
        row.tap()
        XCTAssertTrue(app.navigationBars["Warrly Premium"].waitForExistence(timeout: 10),
                      "The Premium paywall did not open",
                      file: file, line: line)
        dismissAlertIfPresent(in: app)
    }

    /// The paywall's `premium.errorMessage` alert is the app's honest answer
    /// when StoreKit has no products. It sits above the copy these tests read,
    /// so dismiss it first; the assertions then say what the screen shows.
    static func dismissAlertIfPresent(in app: XCUIApplication) {
        let alert = app.alerts.firstMatch
        guard alert.waitForExistence(timeout: 2) else { return }
        let ok = alert.buttons["OK"]
        if ok.exists {
            ok.tap()
        } else if alert.buttons.firstMatch.exists {
            alert.buttons.firstMatch.tap()
        }
    }

    // MARK: Scrolling

    /// Scrolls until `element` is on screen and hittable.
    ///
    /// SwiftUI's `ScrollView` keeps off-screen text in the accessibility tree,
    /// so `exists` alone is not visibility. Swipes are plain `swipeUp()` calls
    /// (no sleeps): the loop checks after each one and reverses if a long
    /// content jump overshot the target upwards.
    @discardableResult
    static func scrollTo(_ element: XCUIElement,
                         in app: XCUIApplication,
                         maxSwipes: Int = 24) -> Bool {
        let window = app.windows.firstMatch
        for _ in 0..<maxSwipes {
            if isOnScreen(element, in: window) { return true }
            if element.exists, element.frame.maxY < window.frame.minY {
                nudgeScroll(in: app, towardsTop: true)
            } else {
                nudgeScroll(in: app, towardsTop: false)
            }
        }
        return isOnScreen(element, in: window)
    }

    /// "Reached" means the element is hittable, its centre is inside the
    /// window, and at least half of its frame is visible.
    ///
    /// Full containment is not a usable test at AX3: a consent paragraph can be
    /// 578 pt tall in a 620 pt viewport, while one `swipeUp()` moves the content
    /// by more than the 42 pt of free space, so there is no scroll offset where
    /// the whole frame fits. Requiring full containment made `scrollTo` swipe to
    /// the bottom and fail on an element that had passed through the viewport.
    /// Moves the main vertical scroll view by about 45% of its height.
    ///
    /// `XCUIApplication.swipeUp()` is a fling: its distance depends on the
    /// content, and at AX3 one fling can jump a 578 pt paragraph clean past a
    /// 620 pt viewport. A press-and-drag on the tallest scroll view (the main
    /// one, not the receipt strip) is a bounded, repeatable step, so the
    /// visibility check after each step can actually land on the target.
    private static func nudgeScroll(in app: XCUIApplication, towardsTop: Bool) {
        let scrollViews = app.scrollViews.allElementsBoundByIndex
        guard let container = scrollViews.max(by: { $0.frame.height < $1.frame.height }),
              container.exists
        else {
            if towardsTop { app.swipeDown() } else { app.swipeUp() }
            return
        }
        let startY: CGFloat = towardsTop ? 0.30 : 0.75
        let endY: CGFloat = towardsTop ? 0.75 : 0.30
        let start = container.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: startY))
        let end = container.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: endY))
        start.press(forDuration: 0.05, thenDragTo: end)
    }

    private static func isOnScreen(_ element: XCUIElement, in window: XCUIElement) -> Bool {
        guard element.exists, element.isHittable else { return false }
        let frame = element.frame
        let windowFrame = window.frame
        guard frame.width > 1, frame.height > 1,
              frame.minX >= windowFrame.minX - 1,
              frame.maxX <= windowFrame.maxX + 1
        else { return false }

        let centre = CGPoint(x: frame.midX, y: frame.midY)
        guard windowFrame.contains(centre) else { return false }

        let visible = frame.intersection(windowFrame)
        guard !visible.isNull, visible.height > 0 else { return false }

        // A paragraph taller than roughly half the window can never satisfy a
        // strict inset at AX3; covering at least half of itself (with its
        // centre on screen) is the meaningful "scrolled to it" state there.
        if frame.height > windowFrame.height * 0.5 {
            return visible.height >= frame.height * 0.5
        }

        // Everything else is something the test is about to tap or read as a
        // row. Keep it clear of the navigation bar and of the home-indicator /
        // tab-bar strip: a row whose centre is at y=675 of a 678 pt window is
        // "inside" but a tap there is swallowed at the screen edge.
        let safeTop = windowFrame.minY + 64
        let safeBottom = windowFrame.maxY - 80
        return frame.minY >= safeTop && frame.maxY <= safeBottom
    }

    // MARK: Row assertions

    /// Asserts a label and its value are the same visual row.
    ///
    /// The app's fact rows keep the two strings as separate `Text`s, so a
    /// global "this string exists somewhere" check could pass while the row
    /// paired the wrong numbers. The vertical midpoint is the row identity.
    static func assertRow(title: String,
                          value: String,
                          in app: XCUIApplication,
                          file: StaticString = #filePath,
                          line: UInt = #line) {
        let titleElement = app.staticTexts[title]
        let valueElement = app.staticTexts[value]
        XCTAssertTrue(titleElement.waitForExistence(timeout: 5),
                      "Row title \(title) is missing", file: file, line: line)
        XCTAssertTrue(valueElement.waitForExistence(timeout: 5),
                      "Row value \(value) is missing", file: file, line: line)
        guard titleElement.exists, valueElement.exists else { return }
        XCTAssertLessThan(abs(titleElement.frame.midY - valueElement.frame.midY), 60,
                          "\(title) and \(value) are not on the same row",
                          file: file, line: line)
    }

    // MARK: Dynamic Type geometry

    /// Checks that a text element is fully laid out at AX3, not clipped.
    ///
    /// XCUITest cannot ask "is there an ellipsis?" but it can compare the
    /// element's frame with the space its accessibility label needs at the same
    /// Dynamic Type size. `UIFont.preferredFont(forTextStyle:compatibleWith:)`
    /// resolves the app's semantic style at AX3 (the app uses `.system(textStyle)`),
    /// then `label.size(withAttributes:)` estimates the required width. If the
    /// frame is shorter than that many lines allow, the text was constrained to
    /// fewer lines than its copy needs — the clip this smoke test exists for.
    ///
    /// Horizontal bounds are checked too: a frame wider than the window is text
    /// pushed off-screen, which is just as lost as an ellipsis.
    static func assertNotClipped(_ element: XCUIElement,
                                 style: UIFont.TextStyle = .body,
                                 weight: UIFont.Weight = .regular,
                                 in app: XCUIApplication,
                                 file: StaticString = #filePath,
                                 line: UInt = #line) {
        XCTAssertTrue(element.exists, "Missing text element to check", file: file, line: line)
        guard element.exists else { return }

        let frame = element.frame
        let windowFrame = app.windows.firstMatch.frame
        XCTAssertGreaterThan(frame.height, 20,
                             "Text is clipped to \(frame.height) pt tall",
                             file: file, line: line)
        XCTAssertGreaterThanOrEqual(frame.minX, windowFrame.minX - 1,
                                    "Text starts outside the window", file: file, line: line)
        XCTAssertLessThanOrEqual(frame.maxX, windowFrame.maxX + 1,
                                 "Text runs outside the window", file: file, line: line)
        guard frame.width > 1 else { return }

        let referenceFont = UIFont.preferredFont(
            forTextStyle: style,
            compatibleWith: UITraitCollection(
                preferredContentSizeCategory: .accessibilityExtraExtraExtraLarge
            )
        )
        let measuringFont = UIFont.systemFont(ofSize: referenceFont.pointSize, weight: weight)
        let measuredWidth = (element.label as NSString)
            .size(withAttributes: [.font: measuringFont])
            .width
        let requiredLines = max(CGFloat(1), ceil(measuredWidth / frame.width))
        let expectedHeight = requiredLines * measuringFont.lineHeight

        // 0.80, not 1.0: SwiftUI's line height and an attributed-string
        // measurement differ by a few percent, while a 3-of-4-line clip is
        // 0.75 and still fails.
        XCTAssertGreaterThanOrEqual(
            frame.height,
            expectedHeight * 0.80,
            """
            Text is likely clipped at AX3: "\(element.label)" needs about \
            \(Int(requiredLines)) line(s) (~\(Int(expectedHeight)) pt) but its \
            frame is only \(Int(frame.height)) pt tall.
            """,
            file: file, line: line
        )
    }

    /// Asserts no *visible* `Text` contains `needle` (case-sensitive).
    ///
    /// Used for negative claims like "no 7-day trial promise": the screen
    /// behind a modal sheet can still be in the accessibility tree, and
    /// Settings legitimately says "30 và 7 ngày" in its notification footer.
    /// Filtering on `isHittable` keeps the claim scoped to the sheet the user
    /// can actually read and tap.
    static func assertNoVisibleText(containing needle: String,
                                    in app: XCUIApplication,
                                    file: StaticString = #filePath,
                                    line: UInt = #line) {
        for element in app.staticTexts.allElementsBoundByIndex
        where element.exists && element.isHittable {
            XCTAssertFalse(element.label.contains(needle),
                           "Unexpected visible copy containing \"\(needle)\": \(element.label)",
                           file: file, line: line)
        }
    }

    /// Every visible `Text` must be inside the window horizontally.
    ///
    /// At AX3 a long line that refuses to wrap does not render an ellipsis the
    /// test can see; it pushes its own frame past the screen edge. This catches
    /// that shape across the whole visible screen, so the check is not limited
    /// to the handful of labels named individually.
    static func assertVisibleTextsStayInWindow(in app: XCUIApplication,
                                               file: StaticString = #filePath,
                                               line: UInt = #line) {
        let windowFrame = app.windows.firstMatch.frame
        for element in app.staticTexts.allElementsBoundByIndex {
            guard element.exists, element.isHittable else { continue }
            let frame = element.frame
            guard frame.width > 1, frame.height > 1 else { continue }
            XCTAssertGreaterThanOrEqual(
                frame.minX, windowFrame.minX - 1,
                "Text starts outside the window: \"\(element.label)\"",
                file: file, line: line
            )
            XCTAssertLessThanOrEqual(
                frame.maxX, windowFrame.maxX + 1,
                "Text runs outside the window: \"\(element.label)\"",
                file: file, line: line
            )
        }
    }

    /// The switch that shares a vertical band with `labelElement`.
    ///
    /// The AI opt-in toggle is a `Toggle("", ...)` with a hidden label and no
    /// identifier, so there is no string to query. Its row is the band that
    /// contains the visible title; that is what pairs the consent copy with the
    /// control it consents to rather than with the first switch on Settings.
    static func switchOverlapping(_ labelElement: XCUIElement,
                                  in app: XCUIApplication) -> XCUIElement? {
        guard labelElement.exists else { return nil }
        let row = labelElement.frame
        return app.switches.allElementsBoundByIndex.first { candidate in
            guard candidate.exists else { return false }
            let frame = candidate.frame
            return frame.minY < row.maxY && frame.maxY > row.minY
        }
    }
}
