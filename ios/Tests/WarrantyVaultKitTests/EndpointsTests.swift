import Foundation
import XCTest
@testable import WarrantyVaultKit

/// Asserts the exact HTTP shape (method, path, query, auth header, body) each
/// `Endpoints.swift` method produces. Every request is served by `StubURLProtocol`.
final class EndpointsTests: KitTestCase {

    // MARK: - Auth

    func testLoginPostsCredentialsWithoutAuthHeader() async throws {
        StubURLProtocol.install(.json(#"""
        {"accessToken": "tok_1", "expiresAt": "2026-01-01T00:00:00Z",
         "user": {"id": "usr_1", "email": "trung@example.vn", "name": "Trung", "aiOptIn": true}}
        """#))
        let client = makeStubbedClient(token: "stale-token")

        let result = try await client.login(LoginInput(email: "trung@example.vn",
                                                       password: "matkhau123"))

        XCTAssertEqual(result.accessToken, "tok_1")
        XCTAssertEqual(result.user.email, "trung@example.vn")

        let request = try XCTUnwrap(StubURLProtocol.lastRequest)
        XCTAssertEqual(request.httpMethod, "POST")
        XCTAssertEqual(request.url?.path, "/api/v1/auth/login")
        XCTAssertNil(request.url?.query)
        XCTAssertEqual(request.value(forHTTPHeaderField: "Content-Type"), "application/json")
        XCTAssertNil(request.value(forHTTPHeaderField: "Authorization"),
                     "login must not send a bearer token")

        let body = try request.jsonBody()
        XCTAssertEqual(body["email"] as? String, "trung@example.vn")
        XCTAssertEqual(body["password"] as? String, "matkhau123")
        XCTAssertEqual(body["platform"] as? String, "ios")
    }

    func testMeLogoutAndDeleteAccount() async throws {
        let client = makeStubbedClient(token: "tok_abc")

        StubURLProtocol.install(.json(#"""
        {"user": {"id": "usr_1", "email": "trung@example.vn", "name": null, "aiOptIn": false}}
        """#))
        let user = try await client.me()
        XCTAssertEqual(user.id, "usr_1")
        XCTAssertNil(user.name)
        XCTAssertEqual(user.aiOptIn, false)

        var request = try XCTUnwrap(StubURLProtocol.lastRequest)
        XCTAssertEqual(request.httpMethod, "GET")
        XCTAssertEqual(request.url?.path, "/api/v1/auth/me")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer tok_abc")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Accept"), "application/json")

        StubURLProtocol.install(.empty(statusCode: 204))
        try await client.logout()
        request = try XCTUnwrap(StubURLProtocol.lastRequest)
        XCTAssertEqual(request.httpMethod, "POST")
        XCTAssertEqual(request.url?.path, "/api/v1/auth/logout")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer tok_abc")

        StubURLProtocol.install(.empty(statusCode: 204))
        try await client.deleteAccount(password: "matkhau123")
        request = try XCTUnwrap(StubURLProtocol.lastRequest)
        XCTAssertEqual(request.httpMethod, "DELETE")
        XCTAssertEqual(request.url?.path, "/api/v1/auth/me")
        XCTAssertEqual(try request.jsonBody()["password"] as? String, "matkhau123")
    }

    // MARK: - Email change (2 steps)

    /// Step 1 is authenticated and needs the current password; step 2 is not
    /// authenticated at all — the mailed token *is* the credential. The response
    /// of step 1 has no token field, by design.
    func testEmailChangeRequestAndConfirmUseTheExactContract() async throws {
        let client = makeStubbedClient(token: "tok_abc")

        StubURLProtocol.install(.json(#"""
        {"ok": true, "message": "Nếu địa chỉ mới hợp lệ và chưa được dùng cho tài khoản khác, một email xác nhận đã được gửi tới địa chỉ mới."}
        """#))
        let requested = try await client.requestEmailChange(
            EmailChangeInput(newEmail: "moi@example.vn", currentPassword: "matkhau123")
        )

        XCTAssertTrue(requested.ok)
        XCTAssertEqual(requested.message?.contains("chưa được dùng cho tài khoản khác"), true,
                       "the server's neutral message is surfaced as-is")
        var request = try XCTUnwrap(StubURLProtocol.lastRequest)
        XCTAssertEqual(request.httpMethod, "POST")
        XCTAssertEqual(request.url?.path, "/api/v1/auth/change-email")
        XCTAssertNil(request.url?.query)
        XCTAssertEqual(request.value(forHTTPHeaderField: "Content-Type"), "application/json")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer tok_abc",
                       "step 1 requires the bearer token")
        let body = try request.jsonBody()
        XCTAssertEqual(body["newEmail"] as? String, "moi@example.vn")
        XCTAssertEqual(body["currentPassword"] as? String, "matkhau123")
        XCTAssertEqual(body.keys.sorted(), ["currentPassword", "newEmail"],
                       "exactly {newEmail, currentPassword} — nothing else")

        StubURLProtocol.install(.json(#"""
        {"ok": true, "message": "Đã đổi email. Vào /login để đăng nhập lại bằng địa chỉ mới."}
        """#))
        let confirmed = try await client.confirmEmailChange(token: "tok_raw_1")

        XCTAssertTrue(confirmed.ok)
        request = try XCTUnwrap(StubURLProtocol.lastRequest)
        XCTAssertEqual(request.httpMethod, "POST")
        XCTAssertEqual(request.url?.path, "/api/v1/auth/confirm-email-change")
        XCTAssertEqual(try request.jsonBody()["token"] as? String, "tok_raw_1")
        XCTAssertEqual(try request.jsonBody().keys.sorted(), ["token"])
        XCTAssertNil(request.value(forHTTPHeaderField: "Authorization"),
                     "confirm is unauthenticated — the token is the credential")
    }

    func testConfirmEmailChangeSurfacesInvalidToken() async throws {
        StubURLProtocol.install(.json(#"""
        {"error": "invalid_email_change_token",
         "message": "Link xác nhận không hợp lệ hoặc đã hết hạn. Yêu cầu link mới."}
        """#, statusCode: 400))
        let client = makeStubbedClient(token: "tok_abc")

        let error = await captureAPIError { try await client.confirmEmailChange(token: "used") }

        guard case let .server(status, envelope)? = error else {
            return XCTFail("expected a server APIError, got \(String(describing: error))")
        }
        XCTAssertEqual(status, 400)
        XCTAssertEqual(envelope.error, "invalid_email_change_token")
        XCTAssertEqual(envelope.message, "Link xác nhận không hợp lệ hoặc đã hết hạn. Yêu cầu link mới.")
    }

    // MARK: - Cross-entity search

    func testSearchBuildsQueryAndClampsThePerGroupLimit() async throws {
        StubURLProtocol.install(.json(#"""
        {"query": "samsung", "devices": [\#(Fixtures.device)], "subscriptions": [],
         "wishlist": [\#(Fixtures.wishlistItem)]}
        """#))
        let client = makeStubbedClient(token: "tok_abc")

        let results = try await client.search(q: "  samsung  ")

        XCTAssertEqual(results.query, "samsung")
        XCTAssertEqual(results.devices.map(\.id), ["dev_1"])
        XCTAssertTrue(results.subscriptions.isEmpty)
        XCTAssertEqual(results.wishlist.map(\.id), ["wish_1"])
        XCTAssertEqual(results.totalCount, 2)

        var request = try XCTUnwrap(StubURLProtocol.lastRequest)
        XCTAssertEqual(request.httpMethod, "GET")
        XCTAssertEqual(request.url?.path, "/api/v1/search")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer tok_abc")
        XCTAssertEqual(queryItems(of: request), ["q": "samsung", "limit": "20"],
                       "q is trimmed; limit defaults to the server's 20")
        XCTAssertEqual(request.url?.query, "q=samsung&limit=20")

        // `limit` is per group and the server 400s outside 1...50, so the client
        // clamps before it ever sends it.
        _ = try await client.search(q: "samsung", limit: 500)
        request = try XCTUnwrap(StubURLProtocol.lastRequest)
        XCTAssertEqual(queryItems(of: request), ["q": "samsung", "limit": "50"])

        _ = try await client.search(q: "samsung", limit: 0)
        request = try XCTUnwrap(StubURLProtocol.lastRequest)
        XCTAssertEqual(queryItems(of: request), ["q": "samsung", "limit": "20"])
    }

    /// Deleting the last character of the box must not raise: a blank `q` is a
    /// plain 200 with three empty groups.
    func testSearchWithBlankQueryIsA200WithEmptyGroups() async throws {
        StubURLProtocol.install(.json(#"""
        {"query": "", "devices": [], "subscriptions": [], "wishlist": []}
        """#))
        let client = makeStubbedClient(token: "tok_abc")

        let results = try await client.search(q: "   ")

        XCTAssertTrue(results.isEmpty)
        XCTAssertEqual(results.query, "")
        XCTAssertTrue(results.sections.isEmpty)
        let request = try XCTUnwrap(StubURLProtocol.lastRequest)
        XCTAssertEqual(request.url?.path, "/api/v1/search")
        XCTAssertEqual(queryItems(of: request), ["q": "", "limit": "20"])
        XCTAssertEqual(SearchPhase.resolve(query: "   ", isLoading: false, results: results, error: nil),
                       .idle, "clearing the box returns to the idle state, never an error")
    }

    // MARK: - Devices

    func testListDevicesBuildsQueryItemsAndOmitsThemWhenEmpty() async throws {
        StubURLProtocol.install(.json(#"{"devices": []}"#))
        let client = makeStubbedClient(token: "tok_abc")

        let devices = try await client.listDevices(filter: .init(q: "mac book",
                                                                 category: "LAPTOP",
                                                                 status: .ACTIVE,
                                                                 sort: "price",
                                                                 dir: "desc"))

        XCTAssertTrue(devices.isEmpty)
        var request = try XCTUnwrap(StubURLProtocol.lastRequest)
        XCTAssertEqual(request.httpMethod, "GET")
        XCTAssertEqual(request.url?.path, "/api/v1/devices")
        XCTAssertEqual(queryItems(of: request), [
            "q": "mac book",
            "category": "LAPTOP",
            "status": "ACTIVE",
            "sort": "price",
            "dir": "desc",
        ])
        XCTAssertEqual(request.url?.query?.contains("q=mac%20book"), true,
                       "query values must be percent-encoded")

        _ = try await makeStubbedClient().listDevices()
        request = try XCTUnwrap(StubURLProtocol.lastRequest)
        XCTAssertNil(request.url?.query, "no filter -> no query string at all")
        XCTAssertNil(request.value(forHTTPHeaderField: "Authorization"),
                     "no token provider value -> no auth header")
    }

    func testGetDeviceUsesIDInPathAndUnwrapsDetail() async throws {
        StubURLProtocol.install(.json(#"""
        {"device": {"id": "dev_9", "name": "Máy lọc nước", "category": "HOME",
                    "purchaseDate": "2025-02-02T00:00:00Z", "purchasePrice": 8000000,
                    "status": "ACTIVE",
                    "warranties": [{"id": "war_9", "deviceId": "dev_9", "type": "STANDARD",
                                    "startDate": "2025-02-02T00:00:00Z",
                                    "endDate": "2027-02-02T00:00:00Z", "months": 24}]}}
        """#))
        let client = makeStubbedClient(token: "tok_abc")

        let device = try await client.getDevice(id: "dev_9")

        XCTAssertEqual(device.id, "dev_9")
        XCTAssertEqual(device.name, "Máy lọc nước")
        XCTAssertEqual(device.warranties?.first?.months, 24)
        XCTAssertEqual(StubURLProtocol.lastRequest?.url?.path, "/api/v1/devices/dev_9")
    }

    func testDeviceCreateUpdateDeleteUseExpectedVerbs() async throws {
        let client = makeStubbedClient(token: "tok_abc")
        var input = DeviceInput(name: "iPhone 16", category: "PHONE", purchaseDate: "2025-05-20")
        input.purchasePrice = 22_990_000

        StubURLProtocol.install(.json(#"""
        {"device": {"id": "dev_new", "name": "iPhone 16", "category": "PHONE",
                    "purchaseDate": "2025-05-20", "purchasePrice": 22990000, "status": "ACTIVE"},
         "warnings": []}
        """#))
        let created = try await client.createDevice(input)
        XCTAssertEqual(created.device.id, "dev_new")
        XCTAssertTrue(created.warningsOrEmpty.isEmpty)
        var request = try XCTUnwrap(StubURLProtocol.lastRequest)
        XCTAssertEqual(request.httpMethod, "POST")
        XCTAssertEqual(request.url?.path, "/api/v1/devices")
        XCTAssertEqual(try request.jsonBody()["name"] as? String, "iPhone 16")

        StubURLProtocol.install(.json(#"""
        {"device": {"id": "dev_new", "name": "iPhone 16 Pro", "category": "PHONE",
                    "purchaseDate": "2025-05-20", "purchasePrice": 22990000, "status": "ACTIVE"},
         "warnings": [{"code": "IMEI_LENGTH", "field": "serialNumber",
                       "message": "Chuỗi số này không phải IMEI 15 chữ số."}]}
        """#))
        let updated = try await client.updateDevice(id: "dev_new", input)
        XCTAssertEqual(updated.device.name, "iPhone 16 Pro")
        XCTAssertEqual(updated.warningsOrEmpty.map(\.code), ["IMEI_LENGTH"])
        request = try XCTUnwrap(StubURLProtocol.lastRequest)
        XCTAssertEqual(request.httpMethod, "PATCH")
        XCTAssertEqual(request.url?.path, "/api/v1/devices/dev_new")

        StubURLProtocol.install(.empty(statusCode: 204))
        try await client.deleteDevice(id: "dev_new")
        request = try XCTUnwrap(StubURLProtocol.lastRequest)
        XCTAssertEqual(request.httpMethod, "DELETE")
        XCTAssertEqual(request.url?.path, "/api/v1/devices/dev_new")
    }

    /// `POST`/`PATCH /api/v1/devices` answer `{device, warnings}` and **nothing
    /// is blocked**: the save succeeded, the warned-about value was kept, and a
    /// client must not turn the payload into an error.
    func testDeviceSaveCarriesNonBlockingWarningsNextToTheDevice() async throws {
        StubURLProtocol.install(.json(#"""
        {"device": {"id": "dev_7", "name": "iPhone 16", "category": "PHONE",
                    "purchaseDate": "2025-05-20", "purchasePrice": 22990000,
                    "status": "ACTIVE", "serialNumber": "356938035643809"},
         "warnings": [{"code": "IMEI_CHECKSUM", "field": "serialNumber",
                       "message": "IMEI đủ 15 chữ số nhưng sai số kiểm tra — có thể gõ nhầm một chữ số."}]}
        """#))
        let client = makeStubbedClient(token: "tok_abc")
        var input = DeviceInput(name: "iPhone 16", category: "PHONE", purchaseDate: "2025-05-20")
        input.serialNumber = "356938035643809"

        let result = try await client.createDevice(input)

        XCTAssertEqual(result.device.id, "dev_7")
        XCTAssertEqual(result.device.serialNumber, "356938035643809")
        XCTAssertEqual(result.warningsOrEmpty.first?.codeKind, .IMEI_CHECKSUM)
        XCTAssertEqual(result.warningsOrEmpty.first?.field, "serialNumber")
        XCTAssertEqual(result.warningsOrEmpty.first?.fieldLabel, "Serial / IMEI")
        XCTAssertEqual(result.warningsOrEmpty.first?.displayMessage,
                       "IMEI đủ 15 chữ số nhưng sai số kiểm tra — có thể gõ nhầm một chữ số.")
    }

    // MARK: - Device sessions

    func testSessionListAndRevokeUseTheExactContract() async throws {
        let client = makeStubbedClient(token: "tok_abc")

        StubURLProtocol.install(.json(#"""
        {"sessions": [
          {"id": "ses_now", "deviceLabel": "iPhone 16 Pro", "platform": "ios",
           "current": true, "lastSeenAt": "2026-03-01T08:00:00Z",
           "createdAt": "2026-02-01T08:00:00Z", "expiresAt": "2026-04-01T08:00:00Z"},
          {"id": "ses_old", "deviceLabel": null, "platform": null,
           "current": false, "lastSeenAt": "2026-02-20T08:00:00Z",
           "createdAt": "2026-01-20T08:00:00Z", "expiresAt": "2026-03-20T08:00:00Z"}
        ]}
        """#))
        let sessions = try await client.listSessions()

        XCTAssertEqual(sessions.map(\.id), ["ses_now", "ses_old"])
        XCTAssertEqual(sessions.first?.current, true)
        XCTAssertEqual(SessionLabels.deviceLabel(sessions[0]), "iPhone 16 Pro")
        XCTAssertEqual(SessionLabels.deviceLabel(sessions[1]), "Không rõ thiết bị",
                       "a null deviceLabel renders the documented fallback, not a blank row")
        XCTAssertEqual(SessionLabels.platformLabel(sessions[1]), "Không rõ nền tảng")

        var request = try XCTUnwrap(StubURLProtocol.lastRequest)
        XCTAssertEqual(request.httpMethod, "GET")
        XCTAssertEqual(request.url?.path, "/api/v1/auth/sessions")
        XCTAssertNil(request.url?.query)
        XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer tok_abc")

        // Revoking a *different* device: the local token keeps working.
        StubURLProtocol.install(.json(#"""
        {"ok": true, "current": false, "alreadyRevoked": false,
         "message": "Đã thu hồi phiên đăng nhập."}
        """#))
        let other = try await client.revokeSession(id: "ses_old")
        XCTAssertEqual(SessionRevokeOutcome.of(other), .revoked)
        request = try XCTUnwrap(StubURLProtocol.lastRequest)
        XCTAssertEqual(request.httpMethod, "DELETE")
        XCTAssertEqual(request.url?.path, "/api/v1/auth/sessions/ses_old")
        XCTAssertNil(request.url?.query)
        XCTAssertTrue(request.capturedBody.isEmpty)

        // Revoking the *current* session: same call, but the bearer is dead from
        // here on, so the caller must clear the Keychain and return to login.
        StubURLProtocol.install(.json(#"""
        {"ok": true, "current": true, "alreadyRevoked": true,
         "message": "Đã thu hồi phiên hiện tại. Hãy đăng nhập lại."}
        """#))
        let selfRevoke = try await client.revokeSession(id: "ses_now")
        XCTAssertEqual(SessionRevokeOutcome.of(selfRevoke), .signedOutLocally,
                       "current beats alreadyRevoked — the local token is dead either way")
        request = try XCTUnwrap(StubURLProtocol.lastRequest)
        XCTAssertEqual(request.httpMethod, "DELETE")
        XCTAssertEqual(request.url?.path, "/api/v1/auth/sessions/ses_now")
    }

    // MARK: - Action queue ("Việc cần xử lý")

    /// The queue read is opt-in: the flag is sent **only** when the caller asks
    /// for the snoozed rows, and `true` only ever ADDS rows server-side.
    func testListActionItemsSendsTheSnoozedFlagOnlyWhenAsked() async throws {
        StubURLProtocol.install(.json(#"""
        {"generatedAt": "2026-03-15T00:00:00Z",
         "items": [{"itemKey": "WARRANTY_EXPIRED:war_1", "kind": "WARRANTY_EXPIRED",
                    "severity": "HIGH", "title": "Bảo hành đã hết hạn",
                    "detail": "Gói Tiêu chuẩn của «MacBook Pro 14» đã hết hạn ngày 01/03/2026 (14 ngày trước).",
                    "deviceId": "dev_1", "warrantyId": "war_1",
                    "dueDate": "2026-03-01T00:00:00Z", "amountVnd": 4294967296}],
         "counts": {"total": 1, "high": 1, "medium": 0, "low": 0},
         "snoozedCount": 4, "note": "Danh sách này chỉ gồm những việc app TỰ SUY RA…"}
        """#))
        let client = makeStubbedClient(token: "tok_abc")

        let queue = try await client.listActionItems()

        XCTAssertEqual(queue.items.map(\.itemKey), ["WARRANTY_EXPIRED:war_1"])
        XCTAssertEqual(queue.items.first?.title, "Bảo hành đã hết hạn",
                       "the server's own sentence is carried through untouched")
        XCTAssertEqual(queue.items.first?.amountVnd, 4_294_967_296, "int64 money is not narrowed")
        XCTAssertEqual(ActionQueueRules.badgeCount(queue.counts), 1)
        XCTAssertEqual(queue.snoozedCount, 4, "the separate \"đang hoãn\" number is kept apart")
        XCTAssertTrue(queue.note.contains("TỰ SUY RA"))

        var request = try XCTUnwrap(StubURLProtocol.lastRequest)
        XCTAssertEqual(request.httpMethod, "GET")
        XCTAssertEqual(request.url?.path, "/api/v1/actions")
        XCTAssertNil(request.url?.query,
                     "the default read sends nothing — snoozed=false would just be noise")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer tok_abc")

        // The opt-in read. A snoozed row is only ever distinguishable by
        // `snoozedUntil`, which is why `isSnoozed` is derived from it.
        StubURLProtocol.install(.json(#"""
        {"generatedAt": "2026-03-15T00:00:00Z",
         "items": [{"itemKey": "WARRANTY_EXPIRED:war_1", "kind": "WARRANTY_EXPIRED",
                    "severity": "HIGH", "title": "t", "detail": "d", "deviceId": "dev_1"},
                   {"itemKey": "DEVICE_MISSING_SERIAL:dev_2", "kind": "DEVICE_MISSING_SERIAL",
                    "severity": "LOW", "title": "t", "detail": "d", "deviceId": "dev_2",
                    "snoozedUntil": "2026-06-13T00:00:00Z"}],
         "counts": {"total": 1, "high": 1, "medium": 0, "low": 0},
         "snoozedCount": 1, "note": "n"}
        """#))
        let withSnoozed = try await client.listActionItems(snoozed: true)

        XCTAssertEqual(withSnoozed.items.count, 2)
        XCTAssertEqual(withSnoozed.items.filter(\.isSnoozed).map(\.itemKey),
                       ["DEVICE_MISSING_SERIAL:dev_2"])
        XCTAssertEqual(ActionQueueRules.badgeCount(withSnoozed.counts), 1,
                       "the badge never grows with the snoozed flag")
        request = try XCTUnwrap(StubURLProtocol.lastRequest)
        XCTAssertEqual(queryItems(of: request), ["snoozed": "true"])
    }

    /// `itemKey` is `<KIND>:<entityId>`. The colon is percent-encoded in the path
    /// segment, and the route still resolves to the snooze endpoints — asserted
    /// here on our own path rather than assumed from the web's result.
    func testSnoozeAndUnsnoozePercentEncodeTheItemKeyInThePath() async throws {
        let client = makeStubbedClient(token: "tok_abc")
        let itemKey = "WARRANTY_EXPIRED:clx1234"

        StubURLProtocol.install(.json(#"""
        {"itemKey": "WARRANTY_EXPIRED:clx1234",
         "snoozedUntil": "2026-06-13T00:00:00Z", "days": 90}
        """#))
        let result = try await client.snoozeActionItem(itemKey, days: 90)

        XCTAssertEqual(result.days, 90)
        XCTAssertEqual(result.itemKey, itemKey)
        XCTAssertEqual(ActionQueueRules.snoozeConfirmation(result),
                       "Đã hoãn 90 ngày — việc này hiện lại 13/06/2026")

        var request = try XCTUnwrap(StubURLProtocol.lastRequest)
        XCTAssertEqual(request.httpMethod, "POST")
        XCTAssertEqual(request.url?.path, "/api/v1/actions/WARRANTY_EXPIRED:clx1234/snooze",
                       "the path segment is one segment, holding the whole key")
        XCTAssertEqual(request.url?.absoluteString,
                       "https://api.example.test/api/v1/actions/WARRANTY_EXPIRED%3Aclx1234/snooze",
                       "the colon is percent-encoded on the wire")
        XCTAssertNil(request.url?.query)
        XCTAssertEqual(try request.jsonBody()["days"] as? Int, 90)

        // No `days` at all is the server's own 90-day default: no body is sent.
        StubURLProtocol.install(.json(#"""
        {"itemKey": "WARRANTY_EXPIRED:clx1234",
         "snoozedUntil": "2026-06-13T00:00:00Z", "days": 90}
        """#))
        _ = try await client.snoozeActionItem(itemKey)
        request = try XCTUnwrap(StubURLProtocol.lastRequest)
        XCTAssertTrue(request.capturedBody.isEmpty, "no days ⇒ no body, so the server's default applies")

        StubURLProtocol.install(.json(#"{"ok": true, "itemKey": "WARRANTY_EXPIRED:clx1234"}"#))
        try await client.unsnoozeActionItem(itemKey)
        request = try XCTUnwrap(StubURLProtocol.lastRequest)
        XCTAssertEqual(request.httpMethod, "DELETE")
        XCTAssertEqual(request.url?.absoluteString,
                       "https://api.example.test/api/v1/actions/WARRANTY_EXPIRED%3Aclx1234/snooze")
        XCTAssertTrue(request.capturedBody.isEmpty)
    }

    /// An id containing a slash must not be able to split the path into extra
    /// segments — it is escaped with the colon.
    func testItemKeyPathEscapesSlashesToo() {
        XCTAssertEqual(APIClient.actionSnoozePath("WARRANTY_EXPIRED:a/b"),
                       "/api/v1/actions/WARRANTY_EXPIRED%3Aa%2Fb/snooze")
        XCTAssertEqual(APIClient.actionSnoozePath("DEVICE_MISSING_RECEIPT:dev_1"),
                       "/api/v1/actions/DEVICE_MISSING_RECEIPT%3Adev_1/snooze")
    }

    // MARK: - Forecast

    func testForecastRequestsTheWindowAndDecodesBuckets() async throws {
        StubURLProtocol.install(.json(#"""
        {"generatedAt": "2026-03-15T00:00:00Z", "windowStart": "2026-03-15T00:00:00Z",
         "windowEnd": "2027-03-15T00:00:00Z", "months": 12, "currency": "VND",
         "subscriptionTotalVnd": 1059000, "subscriptionAutoRenewTotalVnd": 708000,
         "subscriptionMonthlyAverageVnd": 353000, "subscriptionsCount": 3, "chargesCount": 5,
         "buckets": [{"month": "2026-03", "subscriptionVnd": 118000,
                      "subscriptionAutoRenewVnd": 118000, "subscriptionCount": 1,
                      "warrantyExpiringVnd": 0, "warrantyExpiringCount": 0,
                      "wishlistTargetVnd": 0, "wishlistTargetCount": 0}],
         "upcomingWarranties": [], "upcomingWishlist": [],
         "note": "Chỉ các kỳ gia hạn subscription là khoản chắc chắn bị trừ."}
        """#))
        let client = makeStubbedClient(token: "tok_abc")

        let forecast = try await client.forecast(months: 12)

        XCTAssertEqual(forecast.months, 12)
        XCTAssertEqual(forecast.buckets.count, 1, "the bucket array is taken as sent")
        XCTAssertEqual(forecast.subscriptionAutoRenewTotalVnd, 708_000)
        XCTAssertTrue(forecast.note.contains("chắc chắn bị trừ"))

        var request = try XCTUnwrap(StubURLProtocol.lastRequest)
        XCTAssertEqual(request.httpMethod, "GET")
        XCTAssertEqual(request.url?.path, "/api/v1/forecast")
        XCTAssertEqual(queryItems(of: request)["months"], "12")
        XCTAssertEqual(queryItems(of: request).count, 1, "exactly one query parameter")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer tok_abc")

        let emptyBody = #"""
        {"generatedAt": "2026-03-15T00:00:00Z", "windowStart": "2026-03-15T00:00:00Z",
         "windowEnd": "2027-03-15T00:00:00Z", "months": 1, "currency": "VND",
         "subscriptionTotalVnd": 0, "subscriptionAutoRenewTotalVnd": 0,
         "subscriptionMonthlyAverageVnd": 0, "subscriptionsCount": 0, "chargesCount": 0,
         "buckets": [], "upcomingWarranties": [], "upcomingWishlist": [], "note": "n"}
        """#

        // Out-of-range windows are clamped client-side, so they can never turn
        // into the server's documented 400.
        StubURLProtocol.install(.json(emptyBody))
        _ = try await client.forecast(months: 0)
        request = try XCTUnwrap(StubURLProtocol.lastRequest)
        XCTAssertEqual(queryItems(of: request)["months"], "1")

        StubURLProtocol.install(.json(emptyBody))
        _ = try await client.forecast(months: 99)
        request = try XCTUnwrap(StubURLProtocol.lastRequest)
        XCTAssertEqual(queryItems(of: request)["months"], "24")

        StubURLProtocol.install(.json(emptyBody))
        _ = try await client.forecast()
        request = try XCTUnwrap(StubURLProtocol.lastRequest)
        XCTAssertEqual(queryItems(of: request)["months"], "12", "default window is 12 months")
    }

    // MARK: - Warranties + reminders

    func testWarrantyCreateAndReminderToggling() async throws {
        let client = makeStubbedClient(token: "tok_abc")

        StubURLProtocol.install(.json(#"""
        {"warranty": {"id": "war_new", "deviceId": "dev_1", "type": "EXTENDED",
                      "startDate": "2025-03-12T00:00:00Z", "endDate": "2027-03-12T00:00:00Z",
                      "months": 24}}
        """#))
        let warranty = try await client.createWarranty(
            deviceId: "dev_1",
            WarrantyInput(type: .EXTENDED, startDate: "2025-03-12", months: 24)
        )
        XCTAssertEqual(warranty.id, "war_new")
        XCTAssertEqual(warranty.type, .EXTENDED)
        var request = try XCTUnwrap(StubURLProtocol.lastRequest)
        XCTAssertEqual(request.httpMethod, "POST")
        XCTAssertEqual(request.url?.path, "/api/v1/devices/dev_1/warranties")
        let body = try request.jsonBody()
        XCTAssertEqual(body["type"] as? String, "EXTENDED")
        XCTAssertEqual(body["months"] as? Int, 24)

        StubURLProtocol.install(.empty(statusCode: 204))
        try await client.dismissReminder(warrantyId: "war_1")
        request = try XCTUnwrap(StubURLProtocol.lastRequest)
        XCTAssertEqual(request.httpMethod, "POST")
        XCTAssertEqual(request.url?.path, "/api/v1/warranties/war_1/reminder")

        StubURLProtocol.install(.empty(statusCode: 204))
        try await client.restoreReminder(warrantyId: "war_1")
        request = try XCTUnwrap(StubURLProtocol.lastRequest)
        XCTAssertEqual(request.httpMethod, "DELETE")
        XCTAssertEqual(request.url?.path, "/api/v1/warranties/war_1/reminder")
    }

    func testListUpcomingRemindersSendsWithinDaysQuery() async throws {
        StubURLProtocol.install(.json(#"""
        {"reminders": [{"id": "war_1", "deviceId": "dev_1",
                        "device": {"id": "dev_1", "name": "Tủ lạnh", "category": "HOME"},
                        "type": "STANDARD", "provider": null,
                        "startDate": "2024-09-09T00:00:00Z",
                        "endDate": "2026-09-09T00:00:00Z", "months": 24}]}
        """#))
        let client = makeStubbedClient(token: "tok_abc")

        let reminders = try await client.listUpcomingReminders(withinDays: 14)

        XCTAssertEqual(reminders.count, 1)
        XCTAssertEqual(reminders.first?.device.name, "Tủ lạnh")
        XCTAssertNil(reminders.first?.isDismissed,
                     "the plain feed doesn't send the dismissed flag")
        XCTAssertNil(reminders.first?.device.status,
                     "the plain feed doesn't send a device status either")
        let request = try XCTUnwrap(StubURLProtocol.lastRequest)
        XCTAssertEqual(request.url?.path, "/api/v1/reminders")
        XCTAssertEqual(queryItems(of: request), ["withinDays": "14"],
                       "includeDismissed must be omitted unless it is asked for")
    }

    func testListUpcomingRemindersCanOptIntoDismissedRows() async throws {
        StubURLProtocol.install(.json(#"""
        {"reminders": [{"id": "war_hidden", "deviceId": "dev_2",
                        "device": {"id": "dev_2", "name": "Nồi chiên", "category": "KITCHEN",
                                   "status": "BROKEN"},
                        "type": "STANDARD", "provider": null,
                        "startDate": "2024-11-02T00:00:00Z",
                        "endDate": "2028-11-02T00:00:00Z", "months": 48,
                        "isDismissed": true}]}
        """#))
        let client = makeStubbedClient(token: "tok_abc")

        let reminders = try await client.listUpcomingReminders(withinDays: 365,
                                                               includeDismissed: true)

        XCTAssertEqual(reminders.count, 1)
        XCTAssertEqual(reminders.first?.id, "war_hidden")
        XCTAssertEqual(reminders.first?.isDismissed, true)
        XCTAssertEqual(reminders.first?.device.status, "BROKEN")
        let request = try XCTUnwrap(StubURLProtocol.lastRequest)
        XCTAssertEqual(request.httpMethod, "GET")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer tok_abc")
        XCTAssertEqual(request.url?.path, "/api/v1/reminders")
        XCTAssertEqual(queryItems(of: request),
                       ["withinDays": "365", "includeDismissed": "true"])
    }

    func testAttachmentDownloadURLBuildsFileURL() async throws {
        let client = makeStubbedClient(baseURL: "https://api.example.test")

        let plain = await client.attachmentDownloadURL(id: "att_1")
        XCTAssertEqual(plain.absoluteString, "https://api.example.test/api/files/att_1")

        let forced = await client.attachmentDownloadURL(id: "att 1", download: true)
        XCTAssertEqual(forced.absoluteString,
                       "https://api.example.test/api/files/att%201?download=1")
        XCTAssertEqual(StubURLProtocol.requests.count, 0, "building a URL must not hit the network")
    }

    // MARK: - Subscriptions

    func testSubscriptionDetailDefaultsPaymentsAndLogsPayment() async throws {
        let client = makeStubbedClient(token: "tok_abc")

        StubURLProtocol.install(.json(#"""
        {"subscription": {
            "id": "sub_1", "name": "iCloud+ 200GB", "billingCycle": "MONTHLY",
            "price": 59000, "startedAt": "2025-01-05T00:00:00Z",
            "renewalDate": "2025-06-05T00:00:00Z", "autoRenew": true, "status": "ACTIVE",
            "payments": [
              {"id": "pay_1", "subscriptionId": "sub_1", "amount": 59000,
               "paidAt": "2025-05-05T00:00:00Z", "note": "Apple ID"}
            ]}}
        """#))
        let (subscription, payments) = try await client.getSubscription(id: "sub_1")

        XCTAssertEqual(subscription.id, "sub_1")
        XCTAssertEqual(subscription.billingCycle, .MONTHLY)
        XCTAssertEqual(payments.map(\.id), ["pay_1"])
        XCTAssertEqual(payments.first?.note, "Apple ID")
        var request = try XCTUnwrap(StubURLProtocol.lastRequest)
        XCTAssertEqual(request.httpMethod, "GET")
        XCTAssertEqual(request.url?.path, "/api/v1/subscriptions/sub_1")

        // A subscription without a `payments` array decodes as an empty history.
        StubURLProtocol.install(.json(#"{"subscription": \#(Fixtures.subscription)}"#))
        let (bare, noPayments) = try await client.getSubscription(id: "sub_1")
        XCTAssertEqual(bare.name, "iCloud+ 200GB")
        XCTAssertTrue(noPayments.isEmpty)

        StubURLProtocol.install(.json(#"""
        {"payment": {"id": "pay_9", "subscriptionId": "sub_1", "amount": 59000,
                     "paidAt": "2025-06-05T00:00:00Z"}}
        """#))
        let payment = try await client.logSubscriptionPayment(
            id: "sub_1", PaymentInput(amount: 59_000, paidAt: "2025-06-05", note: "Gia hạn"))

        XCTAssertEqual(payment.id, "pay_9")
        request = try XCTUnwrap(StubURLProtocol.lastRequest)
        XCTAssertEqual(request.httpMethod, "POST")
        XCTAssertEqual(request.url?.path, "/api/v1/subscriptions/sub_1/payments")
        XCTAssertEqual(try request.jsonBody()["note"] as? String, "Gia hạn")
    }

    /// `GET /api/v1/subscriptions/audit` is a plain authenticated read of its own
    /// route — it is not the detail route, and it writes nothing.
    func testSubscriptionAuditReadsItsOwnRoute() async throws {
        StubURLProtocol.install(.json(#"""
        {"generatedAt": "2026-03-15T00:00:00Z",
         "findings": [{"findingKey": "PRICE_INCREASED:sub_1", "kind": "PRICE_INCREASED",
                       "severity": "MEDIUM", "title": "Giá gói đã tăng",
                       "detail": "«iCloud+ 200GB» tăng từ 59.000 ₫ lên 61.000 ₫ (+2.000 ₫, +3%) ở kỳ thanh toán ngày 01/02/2026.",
                       "subscriptionIds": ["sub_1"], "names": ["iCloud+ 200GB"],
                       "monthlyVnd": 61000, "chargedTotalVnd": 0, "chargeCount": 0,
                       "previousAmountVnd": 59000, "amountVnd": 61000, "increaseVnd": 2000,
                       "increasePercent": 3, "material": false,
                       "lastRecordedAt": "2026-02-01T00:00:00"}],
         "counts": {"total": 1, "high": 0, "medium": 1, "low": 0},
         "advisory": true,
         "thresholds": {"quietMinAutoCharges": 3, "quietMinMonths": 6, "upcomingRenewalDays": 14,
                        "priceRiseMinPercent": 5, "duplicateNormalized": true},
         "note": "Đây là số liệu TỰ SOÁT từ những gì bạn đã ghi…"}
        """#))
        let client = makeStubbedClient(token: "tok_abc")

        let audit = try await client.subscriptionAudit()

        XCTAssertEqual(audit.counts.total, 1)
        XCTAssertTrue(audit.advisory)
        XCTAssertEqual(audit.thresholds?.priceRiseMinPercent, 5)
        XCTAssertEqual(audit.findings.first?.material, false)
        XCTAssertEqual(SubscriptionAuditRules.minorPillLabel(try XCTUnwrap(audit.findings.first)),
                       "Thay đổi nhỏ")
        XCTAssertTrue(audit.note.contains("TỰ SOÁT"))

        let request = try XCTUnwrap(StubURLProtocol.lastRequest)
        XCTAssertEqual(request.httpMethod, "GET")
        XCTAssertEqual(request.url?.path, "/api/v1/subscriptions/audit")
        XCTAssertNil(request.url?.query)
        XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer tok_abc")
        XCTAssertTrue(request.capturedBody.isEmpty, "the audit is a read — nothing is written by it")
    }

    // MARK: - Wishlist

    func testWishlistListDetailAndMutations() async throws {
        let client = makeStubbedClient(token: "tok_abc")

        StubURLProtocol.install(.json(#"{"items": [\#(Fixtures.wishlistItem)]}"#))
        let items = try await client.listWishlist()
        XCTAssertEqual(items.count, 1)
        XCTAssertEqual(StubURLProtocol.lastRequest?.url?.path, "/api/v1/wishlist")

        StubURLProtocol.install(.json(#"""
        {"item": \#(Fixtures.wishlistItem),
         "prices": [{"id": "wp_1", "itemId": "wish_1", "price": 5290000,
                     "note": "Sale 12/12", "recordedAt": "2025-12-12T03:00:00Z"}]}
        """#))
        let (item, prices) = try await client.getWishlistItem(id: "wish_1")
        XCTAssertEqual(item.id, "wish_1")
        XCTAssertEqual(item.priority, .WANT)
        XCTAssertEqual(prices.map(\.price), [5_290_000])
        XCTAssertEqual(StubURLProtocol.lastRequest?.url?.path, "/api/v1/wishlist/wish_1")

        StubURLProtocol.install(.empty(statusCode: 204))
        try await client.updateWishlistItem(id: "wish_1", WishlistInput(name: "AirPods Pro 3"))
        var request = try XCTUnwrap(StubURLProtocol.lastRequest)
        XCTAssertEqual(request.httpMethod, "PATCH")
        XCTAssertEqual(request.url?.path, "/api/v1/wishlist/wish_1")
        XCTAssertEqual(try request.jsonBody()["name"] as? String, "AirPods Pro 3")

        StubURLProtocol.install(.empty(statusCode: 204))
        try await client.deleteWishlistItem(id: "wish_1")
        request = try XCTUnwrap(StubURLProtocol.lastRequest)
        XCTAssertEqual(request.httpMethod, "DELETE")
        XCTAssertEqual(request.url?.path, "/api/v1/wishlist/wish_1")

        StubURLProtocol.install(.empty(statusCode: 204))
        try await client.logWishlistPrice(id: "wish_1", PriceLogInput(price: 5_190_000))
        request = try XCTUnwrap(StubURLProtocol.lastRequest)
        XCTAssertEqual(request.httpMethod, "POST")
        XCTAssertEqual(request.url?.path, "/api/v1/wishlist/wish_1/prices")
        XCTAssertEqual(try request.jsonBody()["price"] as? Int, 5_190_000)
    }

    // MARK: - Backup / catalog / stats

    func testBackupExportAndImport() async throws {
        let client = makeStubbedClient(token: "tok_abc")
        let payload = Data(#"{"version": 5, "devices": [{"name": "iPad"}]}"#.utf8)

        StubURLProtocol.install(.raw(payload))
        let exported = try await client.exportBackup()
        XCTAssertEqual(exported, payload)
        var request = try XCTUnwrap(StubURLProtocol.lastRequest)
        XCTAssertEqual(request.httpMethod, "GET")
        XCTAssertEqual(request.url?.path, "/api/v1/backup/export")

        StubURLProtocol.install(.json(#"""
        {"result": {"imported": 1, "skipped": 0, "wishlistImported": 0,
                    "wishlistSkipped": 0, "subImported": 0, "subSkipped": 0}}
        """#))
        let result = try await client.importBackup(payload, mode: "merge")

        XCTAssertEqual(result.imported, 1)
        request = try XCTUnwrap(StubURLProtocol.lastRequest)
        XCTAssertEqual(request.httpMethod, "POST")
        XCTAssertEqual(request.url?.path, "/api/v1/backup/import")
        XCTAssertEqual(queryItems(of: request), ["mode": "merge"])
        XCTAssertEqual(request.value(forHTTPHeaderField: "Content-Type"), "application/json")
        XCTAssertEqual(request.capturedBody, payload,
                       "the picked file must be forwarded byte-for-byte, not re-encoded")
    }

    func testCatalogAndStatsRequests() async throws {
        StubURLProtocol.install(.json(#"""
        {"categories": [{"code": "PHONE", "name": "Điện thoại"}], "brands": [],
         "stores": [], "warrantyProviders": []}
        """#))
        let client = makeStubbedClient(token: "tok_abc")

        let catalog = try await client.catalog()
        XCTAssertEqual(catalog.categories.map(\.name), ["Điện thoại"])
        XCTAssertEqual(StubURLProtocol.lastRequest?.url?.path, "/api/v1/catalog")

        StubURLProtocol.install(.json(#"""
        {"devices": {"total": 1, "byStatus": {"ACTIVE": 1}, "totalPurchasePrice": 100},
         "subscriptions": {"total": 0, "byStatus": {}, "totalMonthlyVnd": 0},
         "wishlist": {"total": 0, "byStatus": {}, "totalCurrentPriceWatching": 0}}
        """#))
        let stats = try await client.getStats()
        XCTAssertEqual(stats.devices.total, 1)
        XCTAssertEqual(StubURLProtocol.lastRequest?.url?.path, "/api/v1/stats")
    }

    // MARK: - Push / AI

    func testPushEndpoints() async throws {
        let client = makeStubbedClient(token: "tok_abc")

        StubURLProtocol.install(.json(#"""
        {"subscriptions": [{"id": "push_1", "endpoint": "apns-token", "platform": "apns",
                            "userAgent": "iPhone 16 Pro", "createdAt": "2026-01-02T03:04:05Z"}]}
        """#))
        let subscriptions = try await client.listPushSubscriptions()
        XCTAssertEqual(subscriptions.first?.platform, .apns)
        XCTAssertEqual(StubURLProtocol.lastRequest?.url?.path, "/api/v1/push")

        StubURLProtocol.install(.empty(statusCode: 204))
        try await client.registerPush(NativePushInput(platform: .apns, token: "apns-token"))
        var request = try XCTUnwrap(StubURLProtocol.lastRequest)
        XCTAssertEqual(request.httpMethod, "POST")
        XCTAssertEqual(request.url?.path, "/api/v1/push/register")
        XCTAssertEqual(try request.jsonBody()["platform"] as? String, "apns")
        XCTAssertEqual(try request.jsonBody()["token"] as? String, "apns-token")

        StubURLProtocol.install(.empty(statusCode: 204))
        try await client.unregisterPush(id: "push_1")
        request = try XCTUnwrap(StubURLProtocol.lastRequest)
        XCTAssertEqual(request.httpMethod, "DELETE")
        XCTAssertEqual(request.url?.path, "/api/v1/push/push_1")

        StubURLProtocol.install(.json(#"{"sent": 2, "failed": 1}"#))
        let (sent, failed) = try await client.sendTestPush()
        XCTAssertEqual(sent, 2)
        XCTAssertEqual(failed, 1)
        XCTAssertEqual(StubURLProtocol.lastRequest?.httpMethod, "POST")
        XCTAssertEqual(StubURLProtocol.lastRequest?.url?.path, "/api/v1/push/test")
    }

    func testAIOptInEndpointsUseGETAndPUT() async throws {
        let client = makeStubbedClient(token: "tok_abc")

        StubURLProtocol.install(.json(#"{"aiOptIn": false}"#))
        let enabled = try await client.getAIOptIn()
        XCTAssertFalse(enabled)
        var request = try XCTUnwrap(StubURLProtocol.lastRequest)
        XCTAssertEqual(request.httpMethod, "GET")
        XCTAssertEqual(request.url?.path, "/api/v1/ai/opt-in")

        StubURLProtocol.install(.json(#"{"aiOptIn": true}"#))
        let updated = try await client.setAIOptIn(true)
        XCTAssertTrue(updated)
        request = try XCTUnwrap(StubURLProtocol.lastRequest)
        XCTAssertEqual(request.httpMethod, "PUT")
        XCTAssertEqual(request.url?.path, "/api/v1/ai/opt-in")
        XCTAssertEqual(try request.jsonBody()["enabled"] as? Bool, true)
    }
}
