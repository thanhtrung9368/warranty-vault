import XCTest

/// Login screen (unauthenticated launch).
///
/// Everything a person must be able to find before they can sign in: the
/// title, both field labels, the password reveal control, the forgotten-
/// password entry, the primary action and the register link. The login form
/// carries stable XCUITest identifiers (`login.email`, `login.password`,
/// `login.submit`); the visible copy is asserted too, because that is what
/// VoiceOver reads and what a localisation change can break.
final class LoginScreenTests: WarrlyFlowTestCase {

    func testLoginScreenShowsCopyAndAccessibilityLabels() throws {
        try launch(.loggedOut, authenticated: false)

        XCTAssertTrue(app.staticTexts["Đăng nhập Warrly"].waitForExistence(timeout: 10),
                      "Login title never appeared")
        XCTAssertTrue(app.staticTexts["Email"].exists,
                      "Email field label is missing")
        XCTAssertTrue(app.staticTexts["Mật khẩu"].exists,
                      "Password field label is missing")

        // The identifiers are the stable anchors; the labels above are the
        // human-facing check.
        XCTAssertTrue(app.textFields["login.email"].exists,
                      "login.email identifier is missing from the email field")
        XCTAssertTrue(app.secureTextFields["login.password"].exists,
                      "login.password identifier is missing from the password field")
        XCTAssertTrue(app.buttons["login.submit"].exists,
                      "login.submit identifier is missing from the sign-in button")

        // The reveal control is an icon-only button, so its accessibility label
        // is the only name it has.
        XCTAssertTrue(app.buttons["Hiện mật khẩu"].exists,
                      "Password reveal control has no accessibility label")

        XCTAssertTrue(app.buttons["Quên mật khẩu?"].exists,
                      "Forgot-password entry is missing")

        let register = app.buttons
            .matching(NSPredicate(format: "label CONTAINS %@", "Tạo tài khoản"))
            .firstMatch
        XCTAssertTrue(register.exists, "Register link is missing")

        let submit = UITestSupport.loginSubmit(in: app)
        XCTAssertTrue(submit.exists, "Sign-in button is missing")
        XCTAssertFalse(submit.isEnabled,
                       "Sign-in must stay disabled until both fields have content")
    }

    func testEmptyOrPartialFieldsKeepSubmitDisabled() throws {
        try launch(.loggedOut, authenticated: false)

        let submit = UITestSupport.loginSubmit(in: app)
        XCTAssertTrue(submit.waitForExistence(timeout: 10),
                      "Sign-in button never appeared")

        // Nothing typed: both fields are empty after the `-ui-testing` reset.
        XCTAssertFalse(submit.isEnabled, "Submit is enabled with both fields empty")

        let email = UITestSupport.loginField("login.email", secure: false, in: app)
        XCTAssertTrue(email.exists, "Email field is missing")
        let password = UITestSupport.loginField("login.password", secure: true, in: app)
        XCTAssertTrue(password.exists, "Password field is missing")

        // Return on the email field moves focus to the password field (the
        // form's own onSubmit), so neither field needs to be tapped and the
        // test cannot depend on whether the software keyboard covers the card.
        email.tap()
        email.typeText(Fixture.userEmail + "\n")

        XCTAssertFalse(submit.isEnabled,
                       "Submit is enabled with the password still empty")

        if password.isHittable { password.tap() }
        password.typeText(Fixture.userPassword)
        let becomesEnabled = expectation(
            for: NSPredicate(format: "enabled == true"),
            evaluatedWith: submit
        )
        wait(for: [becomesEnabled], timeout: 5)
    }

    func testMockLoginLandsOnDashboard() throws {
        try launch(.loggedOut, authenticated: false)

        let title = app.staticTexts["Đăng nhập Warrly"]
        XCTAssertTrue(title.waitForExistence(timeout: 10),
                      "Login screen never appeared")

        let email = UITestSupport.loginField("login.email", secure: false, in: app)
        let password = UITestSupport.loginField("login.password", secure: true, in: app)
        XCTAssertTrue(email.exists && password.exists, "Login fields are missing")

        email.tap()
        email.typeText(Fixture.userEmail + "\n")
        if password.isHittable { password.tap() }
        // The password field's submit action is the form's own submit (Go-style
        // `onSubmit` → `submit()`), so Return signs in without hunting for a CTA
        // that the keyboard may cover.
        password.typeText(Fixture.userPassword + "\n")

        // The authenticated shell's first tab is the landing screen. The nav
        // bar, not the tab bar, is the shell-independent signal: a
        // regular-width window draws the tabs as a sidebar.
        XCTAssertTrue(app.navigationBars["Tổng quan"].waitForExistence(timeout: 15),
                      "A successful mock login did not land on the dashboard")
        XCTAssertFalse(title.exists, "Login screen is still on screen after login")
    }
}
