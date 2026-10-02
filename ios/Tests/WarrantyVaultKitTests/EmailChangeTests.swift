import Foundation
import XCTest
@testable import WarrantyVaultKit

/// Email change: the value rules the form applies before calling
/// `POST /api/v1/auth/change-email` / `/confirm-email-change`. The HTTP shape is
/// asserted in `EndpointsTests`; what matters here is that a pasted *link* — the
/// only thing the mailed page can be on iOS, since it is a web URL the app
/// cannot open as a session — is not submitted as if it were the token.
final class EmailChangeTests: KitTestCase {

    // MARK: - Address normalisation

    func testEmailIsTrimmedAndLowercased() {
        XCTAssertEqual(EmailChangeRules.normalizedEmail("  Moi@Example.VN "), "moi@example.vn")
        XCTAssertEqual(EmailChangeRules.normalizedEmail("trung@example.vn"), "trung@example.vn")
        XCTAssertEqual(EmailChangeRules.normalizedEmail("\nmoi@example.vn\t"), "moi@example.vn")
        XCTAssertEqual(EmailChangeRules.normalizedEmail("   "), "")
    }

    // MARK: - Token extraction

    func testRawTokenIsPassedThrough() {
        XCTAssertEqual(EmailChangeRules.token(fromPasted: "abc123def456"), "abc123def456")
        XCTAssertEqual(EmailChangeRules.token(fromPasted: "  abc123def456\n"), "abc123def456")
        XCTAssertEqual(EmailChangeRules.token(fromPasted: ""), "")
        XCTAssertEqual(EmailChangeRules.token(fromPasted: "   "), "")
    }

    /// The email contains `<APP_URL>/confirm-email/<token>`; copying that link
    /// (the bigger tap target) must still confirm, not fail with
    /// `invalid_email_change_token`.
    func testConfirmLinkIsReducedToItsToken() {
        XCTAssertEqual(
            EmailChangeRules.token(fromPasted: "https://app.warrantyvault.vn/confirm-email/raw-token-1"),
            "raw-token-1")
        XCTAssertEqual(
            EmailChangeRules.token(fromPasted: "http://localhost:3000/confirm-email/raw-token-1"),
            "raw-token-1")
        XCTAssertEqual(
            EmailChangeRules.token(fromPasted: "https://app.example.vn/confirm-email/raw-token-1/"),
            "raw-token-1", "trailing slash")
        XCTAssertEqual(
            EmailChangeRules.token(fromPasted: "https://app.example.vn/confirm-email/raw-token-1?utm=email"),
            "raw-token-1", "query string")
        XCTAssertEqual(
            EmailChangeRules.token(fromPasted: "https://app.example.vn/confirm-email/raw-token-1#top"),
            "raw-token-1", "fragment")
        XCTAssertEqual(
            EmailChangeRules.token(fromPasted: "  https://app.example.vn/confirm-email/raw-token-1  "),
            "raw-token-1", "surrounding whitespace")
        XCTAssertEqual(
            EmailChangeRules.token(fromPasted: "Bấm vào đây: https://app.example.vn/confirm-email/raw-token-1 nhé"),
            "raw-token-1", "pasted sentence around the link")
    }

    func testUnrelatedTextIsNotMangled() {
        // Anything without the marker stays exactly as typed (trimmed), so a
        // token that happens to contain slashes or a colon still works.
        XCTAssertEqual(EmailChangeRules.token(fromPasted: "a/b/c"), "a/b/c")
        XCTAssertEqual(EmailChangeRules.token(fromPasted: "https://example.vn/reset/abc"), "https://example.vn/reset/abc")
    }

    func testTokenTTLMatchesTheServer() {
        XCTAssertEqual(EmailChangeRules.tokenTTLMinutes, 30,
                       "both email-change and password-reset tokens live 30 minutes")
    }
}
