import Foundation
import XCTest
@testable import WarrantyVaultKit

/// Handover certificate / share links (FEATURE_IDEAS #2) — the pure half, plus
/// the wire shapes the app binds to.
///
/// The tests that matter most here are the ones about the **one-time token**: the
/// server stores only its sha256, so the create response is the only moment the
/// credential exists on this device. The copy is asserted literally, because a UI
/// that softens the sentence is the failure mode — and the URL builder is asserted
/// against this client's own base URL, which (unlike the web's `GO_API_URL`) does
/// **not** carry an `/api` prefix.
final class ShareLinksTests: KitTestCase {

    // MARK: - Fixtures

    private func share(expiresAt: String,
                       revokedAt: String? = nil,
                       includeSerial: Bool = false,
                       viewCount: Int = 0,
                       lastViewedAt: String? = nil,
                       createdAt: String = "2026-04-01T00:00:00Z") -> DeviceShare {
        let payload: [String: Any?] = [
            "id": "sh_1", "deviceId": "dev_1",
            "expiresAt": expiresAt, "revokedAt": revokedAt,
            "includeSerial": includeSerial, "viewCount": viewCount,
            "lastViewedAt": lastViewedAt, "createdAt": createdAt,
        ]
        let data = try! JSONSerialization.data(withJSONObject: payload.compactMapValues { $0 ?? NSNull() })
        return try! APIClient.decoder.decode(DeviceShare.self, from: data)
    }

    private let now = makeDate("2026-04-10 09:00:00", format: "yyyy-MM-dd HH:mm:ss",
                              timeZone: TimeZone(identifier: "UTC")!)

    // MARK: - The absolute URL

    /// This client's base is the bare Go host (`AppConfig.baseURL`), unlike the
    /// web's `/api`-prefixed `GO_API_URL`, so the documented path slots straight in.
    func testCertificateURLJoinsThePathToThisClientsBase() {
        let url = ShareLinks.certificateURL(baseURL: URL(string: "http://localhost:4000"),
                                            sharePath: "/api/v1/public/shares/tok_abc")
        XCTAssertEqual(url?.absoluteString, "http://localhost:4000/api/v1/public/shares/tok_abc")
    }

    /// A deployment whose base *does* carry `/api` must not produce `/api/api/...`.
    func testCertificateURLDropsTheBasesOwnAPIPrefix() {
        XCTAssertEqual(
            ShareLinks.certificateURL(baseURL: URL(string: "https://wv.example/api/"),
                                      sharePath: "/api/v1/public/shares/tok_abc")?.absoluteString,
            "https://wv.example/api/v1/public/shares/tok_abc")
        XCTAssertEqual(
            ShareLinks.certificateURL(baseURL: URL(string: "https://wv.example/api"),
                                      sharePath: "/api/v1/public/shares/tok_abc")?.absoluteString,
            "https://wv.example/api/v1/public/shares/tok_abc")
    }

    /// Anything *before* that `/api` is a real reverse-proxy prefix and survives.
    func testCertificateURLKeepsADeploymentPrefixBeforeAPI() {
        XCTAssertEqual(
            ShareLinks.certificateURL(baseURL: URL(string: "https://host/wv/api"),
                                      sharePath: "/api/v1/public/shares/tok_abc")?.absoluteString,
            "https://host/wv/api/v1/public/shares/tok_abc")
    }

    func testCertificateURLPassesAnAbsoluteSharePathThroughUntouched() {
        let absolute = "https://cdn.example/c/abc"
        XCTAssertEqual(ShareLinks.certificateURL(baseURL: URL(string: "https://api.example"),
                                                 sharePath: absolute)?.absoluteString,
                       absolute)
    }

    /// The documented value carries `/api`, but a bare `/v1/...` still works — the
    /// same fallback the web client has.
    func testCertificateURLAddsTheAPIPrefixForABareV1Path() {
        XCTAssertEqual(
            ShareLinks.certificateURL(baseURL: URL(string: "https://api.example"),
                                      sharePath: "/v1/public/shares/tok_abc")?.absoluteString,
            "https://api.example/api/v1/public/shares/tok_abc")
    }

    /// `nil` is the honest answer: the UI disables copy/share instead of sending
    /// the buyer a broken link.
    func testCertificateURLRefusesWhatItCannotBuild() {
        XCTAssertNil(ShareLinks.certificateURL(baseURL: URL(string: "https://api.example"), sharePath: ""))
        XCTAssertNil(ShareLinks.certificateURL(baseURL: URL(string: "https://api.example"), sharePath: "   "))
        XCTAssertNil(ShareLinks.certificateURL(baseURL: nil, sharePath: "/api/v1/public/shares/x"))
        XCTAssertNil(ShareLinks.certificateURL(baseURL: URL(string: "ftp://api.example"),
                                               sharePath: "/api/v1/public/shares/x"))
        XCTAssertNil(ShareLinks.certificateURL(baseURL: URL(string: "https:///"),
                                               sharePath: "/api/v1/public/shares/x"))
    }

    func testTheTokenIsTheLastPathSegment() {
        XCTAssertEqual(ShareLinks.token(fromSharePath: "/api/v1/public/shares/tok_abc"), "tok_abc")
        XCTAssertEqual(ShareLinks.token(fromSharePath: "/api/v1/public/shares/tok_abc?x=1"), "tok_abc")
        XCTAssertEqual(ShareLinks.token(fromSharePath: "/api/v1/public/shares/tok_abc#frag"), "tok_abc")
        XCTAssertNil(ShareLinks.token(fromSharePath: "/"))
        XCTAssertNil(ShareLinks.token(fromSharePath: ""))
    }

    // MARK: - Bounds

    func testExpiryIsClampedToTheContractOrFallsBackToTheDefault() {
        XCTAssertEqual(ShareLinks.normalizedExpiryDays(nil), 30)
        XCTAssertEqual(ShareLinks.normalizedExpiryDays(0), 30)
        XCTAssertEqual(ShareLinks.normalizedExpiryDays(-1), 30)
        XCTAssertEqual(ShareLinks.normalizedExpiryDays(91), 30)
        XCTAssertEqual(ShareLinks.normalizedExpiryDays(1), 1)
        XCTAssertEqual(ShareLinks.normalizedExpiryDays(30), 30)
        XCTAssertEqual(ShareLinks.normalizedExpiryDays(90), 90)
    }

    func testEveryOfferedExpiryIsInsideTheContractAndTheDefaultIsOneOfThem() {
        XCTAssertEqual(ShareLinks.expiryChoices.count, 3)
        for choice in ShareLinks.expiryChoices {
            XCTAssertTrue((1...90).contains(choice.days), "\(choice.days) is outside 1...90")
        }
        XCTAssertTrue(ShareLinks.expiryChoices.contains { $0.days == ShareLinks.ttlDefaultDays },
                      "30 ngày must be offered, since it is what the server would default to")
        XCTAssertTrue(ShareLinks.expiryChoices.contains { $0.label.contains("mặc định") })
    }

    // MARK: - Lifecycle

    func testStatusIsLiveUntilTheExpiryPasses() {
        XCTAssertEqual(ShareLinks.status(share(expiresAt: "2026-04-10T09:00:01Z"), now: now), .live)
        XCTAssertEqual(ShareLinks.status(share(expiresAt: "2026-04-10T09:00:00Z"), now: now), .expired)
        XCTAssertEqual(ShareLinks.status(share(expiresAt: "2026-04-09T09:00:00Z"), now: now), .expired)
    }

    /// A link the owner killed stays "đã thu hồi" even after its expiry passes:
    /// that is the action they took, and the row is what the list would otherwise
    /// silently relabel.
    func testRevokedWinsOverExpired() {
        let revoked = share(expiresAt: "2026-04-01T00:00:00Z", revokedAt: "2026-04-02T00:00:00Z")
        XCTAssertEqual(ShareLinks.status(revoked, now: now), .revoked)
        XCTAssertEqual(ShareLinks.Status.revoked.label, "Đã thu hồi")
        XCTAssertFalse(ShareLinks.isLive(revoked, now: now))
    }

    func testStatusLabelsAreTheThreeDocumentedStates() {
        XCTAssertEqual(ShareLinks.Status.live.label, "Đang hoạt động")
        XCTAssertEqual(ShareLinks.Status.expired.label, "Đã hết hạn")
        XCTAssertEqual(ShareLinks.Status.revoked.label, "Đã thu hồi")
    }

    func testRemainingLabelAvoidsSubDayPrecision() {
        XCTAssertEqual(ShareLinks.remainingLabel(share(expiresAt: "2026-04-13T09:00:00Z"), now: now),
                       "Còn 3 ngày")
        XCTAssertEqual(ShareLinks.remainingLabel(share(expiresAt: "2026-04-10T20:00:00Z"), now: now),
                       "Còn dưới 1 ngày")
        // A link that is no longer live has the status badge to say why.
        XCTAssertNil(ShareLinks.remainingLabel(share(expiresAt: "2026-04-09T09:00:00Z"), now: now))
        XCTAssertNil(ShareLinks.remainingLabel(
            share(expiresAt: "2026-05-01T09:00:00Z", revokedAt: "2026-04-02T00:00:00Z"), now: now))
    }

    func testViewLabelCountsFetchesNotBuyerIdentity() {
        XCTAssertEqual(ShareLinks.viewLabel(0), "Chưa ai mở")
        XCTAssertEqual(ShareLinks.viewLabel(1), "Đã mở 1 lần")
        XCTAssertEqual(ShareLinks.viewLabel(12), "Đã mở 12 lần")
        XCTAssertEqual(ShareLinks.viewLabel(-3), "Chưa ai mở")
    }

    func testSerialExposureLabelSaysWhatTheLinkCarries() {
        XCTAssertEqual(ShareLinks.serialExposureLabel(false), "Chỉ serial che giữa")
        XCTAssertEqual(ShareLinks.serialExposureLabel(true), "Kèm serial/IMEI đầy đủ")
    }

    func testOnlyLiveLinksCountAgainstTheCap() {
        let live = (0..<9).map { share(expiresAt: "2026-05-01T09:00:00Z", createdAt: "2026-04-0\($0 + 1)T00:00:00Z") }
        let dead = [share(expiresAt: "2026-04-01T09:00:00Z"),
                    share(expiresAt: "2026-05-01T09:00:00Z", revokedAt: "2026-04-02T00:00:00Z")]
        let all = live + dead

        let cap = ShareLinks.capacity(all, now: now)
        XCTAssertEqual(cap.live, 9)
        XCTAssertEqual(cap.remaining, 1)
        XCTAssertFalse(cap.full)
        XCTAssertEqual(ShareLinks.capacityLine(all, now: now), "9/10 link còn hiệu lực")
    }

    func testTheTenthLiveLinkIsTheLastOneAndTheLineSaysWhy() {
        let shares = (0..<10).map { share(expiresAt: "2026-05-01T09:00:00Z", createdAt: "2026-04-0\(($0 % 9) + 1)T00:00:00Z") }
        let cap = ShareLinks.capacity(shares, now: now)
        XCTAssertEqual(cap.live, 10)
        XCTAssertEqual(cap.remaining, 0)
        XCTAssertTrue(cap.full)
        XCTAssertEqual(ShareLinks.capacityLine(shares, now: now),
                       "10/10 link còn hiệu lực — đã đạt giới hạn, thu hồi bớt để tạo thêm")
    }

    func testSplitKeepsTheServersNewestFirstOrderInsideBothGroups() {
        let a = share(expiresAt: "2026-05-01T09:00:00Z", createdAt: "2026-04-09T00:00:00Z")
        let b = share(expiresAt: "2026-04-01T09:00:00Z", createdAt: "2026-04-08T00:00:00Z")
        let c = share(expiresAt: "2026-05-02T09:00:00Z", createdAt: "2026-04-07T00:00:00Z")

        let split = ShareLinks.split([a, b, c], now: now)
        XCTAssertEqual(split.live.map(\.createdAt), [a.createdAt, c.createdAt])
        XCTAssertEqual(split.dead.map(\.createdAt), [b.createdAt])
    }

    // MARK: - Failures

    /// A 409 is the documented cap; the local sentence is the one that tells the
    /// user what to *do* about it.
    func testAFailedCreateExplainsTheCapLocally() {
        XCTAssertEqual(
            ShareLinks.failureMessage(status: 409, serverMessage: "Đã đạt giới hạn",
                                      fallback: ShareCopy.createFailed),
            ShareCopy.limitReached)
        XCTAssertTrue(ShareCopy.limitReached.contains("10 link còn hiệu lực"))
    }

    func testOtherFailuresPreferTheServersVietnameseSentence() {
        XCTAssertEqual(
            ShareLinks.failureMessage(status: 400, serverMessage: "expiresInDays không hợp lệ",
                                      fallback: ShareCopy.createFailed),
            "expiresInDays không hợp lệ")
        XCTAssertEqual(ShareLinks.failureMessage(status: nil, serverMessage: "   ",
                                                 fallback: ShareCopy.createFailed),
                       ShareCopy.createFailed)
        XCTAssertEqual(ShareLinks.failureMessage(status: 500, serverMessage: nil,
                                                 fallback: ShareCopy.revokeFailed),
                       ShareCopy.revokeFailed)
    }

    // MARK: - The one-time rule, pinned as text

    /// The guard is more than one sentence: the stakes are the title, the warning
    /// says the token cannot be recovered, and closing is refused until the link
    /// was copied or acknowledged. Every one of those strings is pinned here so a
    /// screen cannot quietly drop one.
    func testTheOneTimeWarningAndItsCloseGateArePinned() {
        XCTAssertEqual(ShareCopy.oneTimeTitle, "Link chỉ hiện một lần")

        let warning = ShareCopy.oneTimeWarning
        XCTAssertTrue(warning.contains("MỘT LẦN"), "the one-time rule must be stated in the warning")
        XCTAssertTrue(warning.contains("mã băm"), "why it cannot be recovered: only a hash is stored")
        XCTAssertTrue(warning.contains("kể cả bạn"), "not even the owner can read it again")
        XCTAssertTrue(warning.contains("tạo link mới"), "the only remedy")
        XCTAssertTrue(warning.contains("trước khi đóng"), "the instruction must precede dismissal")

        // The dismissal guard, in the words the user sees next to the control.
        XCTAssertTrue(ShareCopy.closeBlockedHint.contains("Sao chép link"))
        XCTAssertTrue(ShareCopy.closeBlockedHint.contains("tick xác nhận"))
        XCTAssertTrue(ShareCopy.ackLabel.contains("không xem lại được"))
    }

    /// The section says what a link is before the dialog is ever opened, so the
    /// first warning is not a surprise.
    func testTheSectionHintStatesTheProjectionAndTheOneTimeRule() {
        XCTAssertTrue(ShareCopy.sectionHint.contains("không cần đăng nhập"))
        XCTAssertTrue(ShareCopy.sectionHint.contains("không có giá, ghi chú hay ảnh hoá đơn"))
        XCTAssertTrue(ShareCopy.sectionHint.contains("Token chỉ hiện một lần"))
    }

    /// What the buyer sees, and — the reason a seller can send the link — what the
    /// certificate never contains.
    func testTheProjectionCopyNamesTheSensitiveFieldsThatNeverLeave() {
        let never = ShareCopy.certificateNeverShown.joined(separator: " | ")
        XCTAssertTrue(never.contains("Giá mua, giá bán, lãi/lỗ"))
        XCTAssertTrue(never.contains("Chi phí từng gói bảo hành"))
        XCTAssertTrue(never.contains("Ghi chú"))
        XCTAssertTrue(never.contains("Ảnh hoá đơn và mọi file đính kèm"))
        XCTAssertTrue(never.contains("Các thiết bị khác"))

        let shows = ShareCopy.certificateShows.joined(separator: " | ")
        XCTAssertTrue(shows.contains("Serial che giữa"))
        XCTAssertTrue(shows.contains("Ngày hết hạn bảo hành xa nhất"))
    }

    /// `includeSerial` is off by default, and each state explains exactly what it
    /// exposes — no implication of verification that is not there.
    func testTheSerialOptInExplainsBothStates() {
        XCTAssertTrue(ShareCopy.serialOffNote.hasPrefix("Mặc định TẮT"))
        XCTAssertTrue(ShareCopy.serialOffNote.contains("serial che giữa"))
        XCTAssertTrue(ShareCopy.serialOnNote.hasPrefix("BẬT"))
        XCTAssertTrue(ShareCopy.serialOnNote.contains("IMEI"))
        XCTAssertTrue(ShareCopy.serialOnNote.contains("chuyển tiếp"))
        XCTAssertEqual(ShareCopy.serialLabel, "Kèm serial/IMEI đầy đủ trong phiếu")
    }

    func testTheShareSheetMessageCarriesNoPriceAndNoAccountName() {
        XCTAssertEqual(ShareCopy.shareSubject(deviceName: "iPhone 16"),
                       "Phiếu bàn giao bảo hành cho \"iPhone 16\"")
        XCTAssertTrue(ShareCopy.shareMessage.contains("không cần đăng nhập"))
        XCTAssertTrue(ShareCopy.shareMessage.contains("có hạn"))
    }

    // MARK: - The wire shapes

    func testListSharesDecodesTheOwnerViewIncludingDeadRows() async throws {
        StubURLProtocol.install(.json(#"""
        {"shares": [
          {"id": "sh_2", "deviceId": "dev_1", "expiresAt": "2026-05-01T00:00:00Z",
           "revokedAt": null, "includeSerial": true, "viewCount": 3,
           "lastViewedAt": "2026-04-09T10:00:00Z", "createdAt": "2026-04-01T00:00:00Z"},
          {"id": "sh_1", "deviceId": "dev_1", "expiresAt": "2026-04-02T00:00:00Z",
           "revokedAt": "2026-04-03T00:00:00Z", "includeSerial": false, "viewCount": 0,
           "lastViewedAt": null, "createdAt": "2026-03-01T00:00:00Z"}
        ]}
        """#))
        let client = makeStubbedClient(token: "tok_abc")

        let shares = try await client.listShares(deviceId: "dev_1")

        XCTAssertEqual(shares.count, 2)
        XCTAssertEqual(shares[0].id, "sh_2")
        XCTAssertTrue(shares[0].includeSerial)
        XCTAssertEqual(shares[0].viewCount, 3)
        XCTAssertEqual(shares[1].revokedAt, makeDate("2026-04-03T00:00:00Z",
                                                     format: "yyyy-MM-dd'T'HH:mm:ssZZZZZ"))
        XCTAssertNil(shares[1].lastViewedAt)
        // An explicit `now`: the fixture's expiry is in the past by wall-clock
        // time, and a test that depended on today's date would rot.
        let at = makeDate("2026-04-10 09:00:00", format: "yyyy-MM-dd HH:mm:ss",
                          timeZone: TimeZone(identifier: "UTC")!)
        XCTAssertEqual(ShareLinks.capacity(shares, now: at).live, 1)
    }

    /// An empty list is a 200 with `[]`, never `null` — and a device that belongs
    /// to someone else answers the same way, which is the whole point.
    func testAnEmptyShareListDecodes() async throws {
        StubURLProtocol.install(.json(#"{"shares": []}"#))
        let client = makeStubbedClient(token: "tok_abc")
        let shares = try await client.listShares(deviceId: "dev_1")
        XCTAssertTrue(shares.isEmpty)
    }

    func testCreateSharePostsTheChosenExpiryAndSerialAndReturnsTheOneTimeToken() async throws {
        StubURLProtocol.install(.json(#"""
        {"share": {"id": "sh_9", "deviceId": "dev_1",
                   "expiresAt": "2026-07-09T00:00:00Z", "revokedAt": null,
                   "includeSerial": true, "viewCount": 0, "lastViewedAt": null,
                   "createdAt": "2026-04-10T00:00:00Z",
                   "token": "raw-token-shown-once",
                   "sharePath": "/api/v1/public/shares/raw-token-shown-once"}}
        """#, statusCode: 201))
        let client = makeStubbedClient(token: "tok_abc")

        let created = try await client.createShare(
            deviceId: "dev_1",
            CreateShareInput(expiresInDays: 90, includeSerial: true)
        )

        let request = try XCTUnwrap(StubURLProtocol.lastRequest)
        XCTAssertEqual(request.httpMethod, "POST")
        XCTAssertEqual(request.url?.path, "/api/v1/devices/dev_1/shares")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer tok_abc")
        let body = try request.jsonBody()
        XCTAssertEqual(body["expiresInDays"] as? Int, 90)
        XCTAssertEqual(body["includeSerial"] as? Bool, true)

        XCTAssertEqual(created.token, "raw-token-shown-once")
        XCTAssertEqual(created.sharePath, "/api/v1/public/shares/raw-token-shown-once")
        // The DeviceShare half is decoded from the same flat object.
        XCTAssertEqual(created.share.id, "sh_9")
        XCTAssertTrue(created.share.includeSerial)
        XCTAssertEqual(created.share.viewCount, 0)
        XCTAssertNil(created.share.revokedAt)

        // …and the token becomes the buyer's URL, on this client's host.
        XCTAssertEqual(
            ShareLinks.certificateURL(baseURL: URL(string: "http://localhost:4000"),
                                      sharePath: created.sharePath)?.absoluteString,
            "http://localhost:4000/api/v1/public/shares/raw-token-shown-once")
    }

    /// An out-of-range value never reaches the wire: the server would answer 400,
    /// and the user's intent ("as long as allowed") is unambiguous.
    func testCreateShareClampsAnOutOfRangeExpiryBeforeItReachesTheWire() async throws {
        StubURLProtocol.install(.json(#"""
        {"share": {"id": "sh_9", "deviceId": "dev_1",
                   "expiresAt": "2026-05-10T00:00:00Z", "revokedAt": null,
                   "includeSerial": false, "viewCount": 0, "lastViewedAt": null,
                   "createdAt": "2026-04-10T00:00:00Z", "token": "t",
                   "sharePath": "/api/v1/public/shares/t"}}
        """#, statusCode: 201))
        let client = makeStubbedClient(token: "tok_abc")

        _ = try await client.createShare(deviceId: "dev_1", CreateShareInput(expiresInDays: 400))

        let body = try XCTUnwrap(StubURLProtocol.lastRequest).jsonBody()
        XCTAssertEqual(body["expiresInDays"] as? Int, 30)
        XCTAssertEqual(body["includeSerial"] as? Bool, false)
    }

    func testAConflictOnTheEleventhLinkSurfacesAsA409() async throws {
        StubURLProtocol.install(.json(#"""
        {"error": "LIMIT_REACHED", "message": "Thiết bị đã có 10 link còn hiệu lực"}
        """#, statusCode: 409))
        let client = makeStubbedClient(token: "tok_abc")

        let error = await captureAPIError {
            try await client.createShare(deviceId: "dev_1")
        }
        guard case let .server(status, envelope)? = error else {
            return XCTFail("expected a server error, got \(String(describing: error))")
        }
        XCTAssertEqual(status, 409)
        XCTAssertEqual(ShareLinks.failureMessage(status: status, serverMessage: envelope.message,
                                                 fallback: ShareCopy.createFailed),
                       ShareCopy.limitReached)
    }

    func testRevokeShareIsAnIdempotentDelete() async throws {
        StubURLProtocol.install(.json(#"{"ok": true}"#))
        let client = makeStubbedClient(token: "tok_abc")

        try await client.revokeShare(id: "sh_9")

        let request = try XCTUnwrap(StubURLProtocol.lastRequest)
        XCTAssertEqual(request.httpMethod, "DELETE")
        XCTAssertEqual(request.url?.path, "/api/v1/shares/sh_9")
    }

    /// A foreign id is a 404 — indistinguishable from an id that never existed.
    func testRevokingSomebodyElsesLinkIsANotFound() async throws {
        StubURLProtocol.install(.json(#"{"error": "NOT_FOUND"}"#, statusCode: 404))
        let client = makeStubbedClient(token: "tok_abc")

        let error = await captureAPIError { try await client.revokeShare(id: "sh_other") }
        guard case let .server(status, _)? = error else {
            return XCTFail("expected a server error, got \(String(describing: error))")
        }
        XCTAssertEqual(status, 404)
    }
}
