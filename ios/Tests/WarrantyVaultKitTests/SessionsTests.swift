import Foundation
import XCTest
@testable import WarrantyVaultKit

/// `GET/DELETE /api/v1/auth/sessions` — model decoding, the documented
/// fallbacks, and the "revoking the current session kills this token" rule.
final class SessionsTests: KitTestCase {

    // MARK: - Fixtures

    private static let listJSON = #"""
    {"sessions": [
      {"id": "ses_current", "deviceLabel": "iPhone 16 Pro", "platform": "ios",
       "current": true, "lastSeenAt": "2026-03-01T08:00:00Z",
       "createdAt": "2026-02-01T08:00:00Z", "expiresAt": "2026-04-01T08:00:00Z"},
      {"id": "ses_old", "deviceLabel": null, "platform": null,
       "current": false, "lastSeenAt": "2026-02-20T08:00:00Z",
       "createdAt": "2026-01-20T08:00:00Z", "expiresAt": "2026-03-20T08:00:00Z"},
      {"id": "ses_web", "deviceLabel": "Chrome trên Windows", "platform": "web",
       "current": false, "lastSeenAt": "2026-02-25T08:00:00Z",
       "createdAt": "2026-02-10T08:00:00Z", "expiresAt": "2026-03-10T08:00:00Z"}
    ]}
    """#

    func testListDecodesEverySessionFieldAndKeepsTheCurrentFlag() async throws {
        StubURLProtocol.install(.json(Self.listJSON))
        let client = makeStubbedClient(token: "tok_abc")

        let sessions = try await client.listSessions()

        XCTAssertEqual(sessions.map(\.id), ["ses_current", "ses_old", "ses_web"])
        XCTAssertEqual(sessions[0].current, true)
        XCTAssertEqual(sessions[0].deviceLabel, "iPhone 16 Pro")
        XCTAssertEqual(sessions[0].platform, "ios")
        XCTAssertEqual(sessions[1].current, false)
        XCTAssertNil(sessions[1].deviceLabel, "the wire value stays nil — the fallback is presentation")
        XCTAssertNil(sessions[1].platform)
        XCTAssertEqual(sessions[2].platform, "web")
        XCTAssertEqual(sessions[0].createdAt, makeDate("2026-02-01T08:00:00Z", format: "yyyy-MM-dd'T'HH:mm:ssZZZZZ"))
        XCTAssertEqual(sessions[0].expiresAt, makeDate("2026-04-01T08:00:00Z", format: "yyyy-MM-dd'T'HH:mm:ssZZZZZ"))

        let request = try XCTUnwrap(StubURLProtocol.lastRequest)
        XCTAssertEqual(request.httpMethod, "GET")
        XCTAssertEqual(request.url?.path, "/api/v1/auth/sessions")
        XCTAssertNil(request.url?.query, "no parameters on the sessions read")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer tok_abc")
    }

    /// The field is documented as always `[]`. A missing key must still read as
    /// "no other device is signed in" rather than as a decode failure.
    func testEmptyAndAbsentSessionListsBothReadAsEmpty() async throws {
        let client = makeStubbedClient(token: "tok_abc")

        StubURLProtocol.install(.json(#"{"sessions": []}"#))
        let empty = try await client.listSessions()
        XCTAssertEqual(empty, [])

        StubURLProtocol.install(.json(#"{}"#))
        let absent = try await client.listSessions()
        XCTAssertEqual(absent, [])
    }

    // MARK: - deviceLabel fallback

    func testNilAndBlankDeviceLabelsFallBackToTheVietnameseString() {
        XCTAssertEqual(SessionLabels.deviceLabel(raw: nil), "Không rõ thiết bị")
        XCTAssertEqual(SessionLabels.deviceLabel(raw: ""), "Không rõ thiết bị")
        XCTAssertEqual(SessionLabels.deviceLabel(raw: "   \n "), "Không rõ thiết bị",
                       "a whitespace-only label must not render as a blank row")
        XCTAssertEqual(SessionLabels.deviceLabel(raw: "  iPad của mẹ  "), "iPad của mẹ")
        XCTAssertEqual(SessionLabels.unknownDevice, "Không rõ thiết bị",
                       "this is the string the API documents — keep it verbatim")
    }

    func testDeviceLabelUsesTheSessionValueWhenPresent() throws {
        let sessions = try APIClient.decoder.decode(
            SessionList.self, from: Data(Self.listJSON.utf8)
        ).sessions ?? []
        XCTAssertEqual(SessionLabels.deviceLabel(sessions[0]), "iPhone 16 Pro")
        XCTAssertEqual(SessionLabels.deviceLabel(sessions[1]), "Không rõ thiết bị")
    }

    // MARK: - platform mapping

    func testPlatformMappingCoversTheThreeDocumentedValues() {
        XCTAssertEqual(SessionLabels.platformLabel(raw: "web"), "Trình duyệt web")
        XCTAssertEqual(SessionLabels.platformLabel(raw: "ios"), "iPhone / iPad")
        XCTAssertEqual(SessionLabels.platformLabel(raw: "android"), "Android")
        XCTAssertEqual(SessionLabels.platformLabel(raw: "IOS"), "iPhone / iPad",
                       "case must not matter")
        XCTAssertEqual(SessionLabels.platformLabel(raw: nil), "Không rõ nền tảng")
        XCTAssertEqual(SessionLabels.platformLabel(raw: ""), "Không rõ nền tảng",
                       "the server normalises every unknown value to null")
        XCTAssertEqual(SessionLabels.platformLabel(raw: "  web  "), "Trình duyệt web")
        // `apns`/`fcm` are PushSubscription codes and can never reach a session
        // (`normalizePlatform` maps them to null). Should one ever arrive, it is
        // printed as-is instead of being silently mapped to a device type.
        XCTAssertEqual(SessionLabels.platformLabel(raw: "apns"), "apns")
        XCTAssertEqual(SessionLabels.platformLabel(raw: "harmony"), "harmony")
    }

    // MARK: - Revoke result

    func testRevokeUsesTheIDInThePathAndDecodesTheResult() async throws {
        StubURLProtocol.install(.json(#"""
        {"ok": true, "current": false, "alreadyRevoked": false,
         "message": "Đã thu hồi phiên đăng nhập."}
        """#))
        let client = makeStubbedClient(token: "tok_abc")

        let result = try await client.revokeSession(id: "ses_old")

        XCTAssertTrue(result.ok)
        XCTAssertFalse(result.current)
        XCTAssertFalse(result.alreadyRevoked)
        XCTAssertEqual(SessionRevokeOutcome.of(result), .revoked)

        let request = try XCTUnwrap(StubURLProtocol.lastRequest)
        XCTAssertEqual(request.httpMethod, "DELETE")
        XCTAssertEqual(request.url?.path, "/api/v1/auth/sessions/ses_old")
        XCTAssertNil(request.url?.query)
        XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer tok_abc")
        XCTAssertTrue(request.capturedBody.isEmpty, "DELETE carries no body")
    }

    /// `alreadyRevoked` is a success: same 200, nothing changed server-side.
    func testAlreadyRevokedIsSuccessNotAnError() async throws {
        StubURLProtocol.install(.json(#"""
        {"ok": true, "current": false, "alreadyRevoked": true,
         "message": "Phiên này đã được thu hồi trước đó."}
        """#))
        let result = try await makeStubbedClient(token: "tok_abc").revokeSession(id: "ses_old")

        XCTAssertTrue(result.ok)
        XCTAssertEqual(SessionRevokeOutcome.of(result), .alreadyRevoked)
        XCTAssertEqual(SessionLabels.message(for: result), "Phiên này đã được thu hồi trước đó.")
    }

    /// THE rule of this feature: revoking the session you are holding kills the
    /// token you are holding, so the app must clear it and go back to login.
    func testRevokingTheCurrentSessionInvalidatesTheLocalToken() async throws {
        StubURLProtocol.install(.json(#"""
        {"ok": true, "current": true, "alreadyRevoked": false,
         "message": "Đã thu hồi phiên hiện tại. Hãy đăng nhập lại."}
        """#))
        let result = try await makeStubbedClient(token: "tok_abc")
            .revokeSession(id: "ses_current")

        XCTAssertTrue(result.current)
        XCTAssertEqual(SessionRevokeOutcome.of(result), .signedOutLocally)
        XCTAssertEqual(SessionLabels.message(for: result),
                       "Đã thu hồi phiên hiện tại. Hãy đăng nhập lại.")
    }

    /// Revoking twice: the session is already gone *and* it is the one calling.
    /// `signedOutLocally` has to win, otherwise the app would sit on a dead
    /// bearer token thinking nothing happened.
    func testCurrentBeatsAlreadyRevokedWhenBothAreTrue() {
        let result = SessionRevokeResult(ok: true, current: true, alreadyRevoked: true,
                                         message: "")
        XCTAssertEqual(SessionRevokeOutcome.of(result), .signedOutLocally)
        XCTAssertEqual(SessionLabels.message(for: result),
                       "Đã đăng xuất thiết bị này. Hãy đăng nhập lại.",
                       "an empty server message falls back to local copy")
    }

    func testFallbackMessagesFollowTheOutcomeWhenTheServerSendsNone() {
        XCTAssertEqual(
            SessionLabels.message(for: .init(ok: true, current: false, alreadyRevoked: false, message: "  ")),
            "Đã thu hồi phiên đăng nhập."
        )
        XCTAssertEqual(
            SessionLabels.message(for: .init(ok: true, current: false, alreadyRevoked: true, message: "")),
            "Phiên này đã được thu hồi trước đó."
        )
    }
}
