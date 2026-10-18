import Foundation
import XCTest
@testable import WarrlyKit

/// The `displayName` half of `PATCH /api/v1/auth/me`.
///
/// The wire body is tri-state (`openapi.yaml`), and both mistakes it allows are
/// silent: a blank name sent as `""` instead of `null` leaves the stale name in
/// place, while a name trimmed on one side and not the other makes the row show
/// something different from what was stored. Pinned here rather than left to a
/// manual check.
final class DisplayNameRulesTests: KitTestCase {

    func testABlankNameClearsInsteadOfBeingSentAsAnEmptyString() {
        XCTAssertEqual(DisplayNameRules.field(for: ""), .clear)
    }

    func testWhitespaceOnlyNamesAlsoClear() {
        // The server maps blank → NULL; the client asks for the same thing
        // explicitly so the body is `{"displayName": null}` rather than a
        // string that only looks empty.
        XCTAssertEqual(DisplayNameRules.field(for: "   "), .clear)
        XCTAssertEqual(DisplayNameRules.field(for: "\n\t "), .clear)
    }

    func testANameIsSentTrimmed() {
        XCTAssertEqual(DisplayNameRules.field(for: "  Trung  "), .set("Trung"))
        XCTAssertEqual(DisplayNameRules.field(for: "Nguyễn Văn A\n"), .set("Nguyễn Văn A"))
    }

    func testInnerSpacesAreLeftAlone() {
        // Only the edges are touched: "Văn  A" is the user's own formatting.
        XCTAssertEqual(DisplayNameRules.field(for: " Nguyễn  Văn A "), .set("Nguyễn  Văn A"))
    }

    func testAnOverLongNameIsNotTruncatedLocally() {
        // The 80-byte cap is the server's call. Sending the whole string is
        // what makes the server answer with `fieldErrors.displayName`, which is
        // the Vietnamese copy the sheet shows; truncating here would silently
        // store a name the user never typed.
        let long = String(repeating: "ế", count: 60) // 180 bytes of UTF-8
        XCTAssertEqual(DisplayNameRules.field(for: long), .set(long))
    }

    func testClearingEncodesAnExplicitNullAndKeepsLocaleAbsent() throws {
        let data = try APIClient.encoder.encode(
            UpdateProfileInput(displayName: DisplayNameRules.field(for: "   "))
        )
        let body = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])

        XCTAssertTrue(body.keys.contains("displayName"), "`null`, not an absent key")
        XCTAssertTrue(body["displayName"] is NSNull)
        // Editing a name must not wipe the account's stored language.
        XCTAssertFalse(body.keys.contains("locale"))
    }

    func testSettingANameEncodesTheTrimmedValue() throws {
        let data = try APIClient.encoder.encode(
            UpdateProfileInput(displayName: DisplayNameRules.field(for: " Trung "))
        )
        let body = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])

        XCTAssertEqual(body["displayName"] as? String, "Trung")
        XCTAssertFalse(body.keys.contains("locale"))
    }
}
