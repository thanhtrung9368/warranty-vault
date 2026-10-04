import Foundation
import XCTest
@testable import WarrantyVaultKit

// The wire half of the language feature: the `Accept-Language` header on every
// request, the tri-state `PATCH /auth/me` body, and `User.locale` decoding.
//
// Both halves fail silently if they are wrong — a missing header just means
// English validation errors under a Vietnamese UI, and a body that drops
// `locale` means push notifications keep arriving in the old language — so they
// are pinned here rather than left to a manual check.
final class LocalizationWireTests: KitTestCase {

    override func tearDown() {
        L.language = nil
        super.tearDown()
    }

    // MARK: - Accept-Language

    func testSelectedLanguageIsSentOnEveryAuthenticatedRequest() async throws {
        L.language = .en
        StubURLProtocol.install(.json(#"{"devices":[],"page":1,"pageSize":20,"total":0}"#))
        let client = makeStubbedClient(token: "tok")

        _ = try? await client.listDevices()

        let header = StubURLProtocol.lastRequest?.value(forHTTPHeaderField: "Accept-Language")
        XCTAssertEqual(header, "en")
    }

    func testVietnameseIsSentWhenVietnameseIsSelected() async throws {
        L.language = .vi
        StubURLProtocol.install(.json(#"{"devices":[],"page":1,"pageSize":20,"total":0}"#))
        let client = makeStubbedClient(token: "tok")

        _ = try? await client.listDevices()

        XCTAssertEqual(StubURLProtocol.lastRequest?.value(forHTTPHeaderField: "Accept-Language"),
                       "vi")
    }

    func testTheHeaderIsAlsoSentBeforeThereIsAToken() async throws {
        // Sign-in errors are server copy too ("Email hoặc mật khẩu không đúng"),
        // and they are rendered on the one screen a user reaches without a
        // session — so the header cannot be tied to being authenticated.
        L.language = .vi
        StubURLProtocol.install(.json(#"{"accessToken":"t","expiresAt":"2026-01-01T00:00:00Z","user":{"id":"u","email":"a@b.c"}}"#))
        let client = makeStubbedClient()

        _ = try? await client.login(LoginInput(email: "a@b.c", password: "secret123"))

        XCTAssertEqual(StubURLProtocol.lastRequest?.value(forHTTPHeaderField: "Accept-Language"),
                       "vi")
    }

    func testTheHeaderIsSentWhenUploadingAndWhenImportingRawBytes() async throws {
        L.language = .en
        let client = makeStubbedClient(token: "tok")

        StubURLProtocol.install(.init(body: Data()))
        _ = try? await client.uploadAttachment(
            deviceId: "dev_1", fileName: "a.jpg", fileType: "image/jpeg",
            data: Data([0x01]), description: nil
        )
        XCTAssertEqual(StubURLProtocol.lastRequest?.value(forHTTPHeaderField: "Accept-Language"),
                       "en")

        StubURLProtocol.install(.json(#"{"imported":0,"skipped":0,"wishlistImported":0,"wishlistSkipped":0,"subImported":0,"subSkipped":0}"#))
        _ = try? await client.importBackup(Data("{}".utf8), mode: "merge")
        XCTAssertEqual(StubURLProtocol.lastRequest?.value(forHTTPHeaderField: "Accept-Language"),
                       "en")
    }

    func testNoHeaderIsSentWhenNothingHasChosenALanguage() async throws {
        // `nil` must leave the server's own chain intact (?lang= →
        // Accept-Language → User.locale → en) instead of forcing English.
        L.language = nil
        StubURLProtocol.install(.json(#"{"devices":[],"page":1,"pageSize":20,"total":0}"#))
        let client = makeStubbedClient(token: "tok")

        _ = try? await client.listDevices()

        XCTAssertNil(StubURLProtocol.lastRequest?.value(forHTTPHeaderField: "Accept-Language"))
    }

    // MARK: - PATCH /auth/me

    func testSettingALanguageSendsTheTriStateBody() async throws {
        StubURLProtocol.install(.json(#"{"user":{"id":"u","email":"a@b.c","locale":"vi"}}"#))
        let client = makeStubbedClient(token: "tok")

        let result = try await client.updateProfile(UpdateProfileInput(locale: .set("vi")))

        let request = try XCTUnwrap(StubURLProtocol.lastRequest)
        XCTAssertEqual(request.httpMethod, "PATCH")
        XCTAssertEqual(request.url?.path, "/api/v1/auth/me")
        let body = try request.jsonBody()
        XCTAssertEqual(body["locale"] as? String, "vi")
        // ABSENT, not null: an untouched field must not be cleared by a write
        // that was only about the language.
        XCTAssertFalse(body.keys.contains("displayName"))
        XCTAssertEqual(result.user.preferredLanguage, .vi)
    }

    func testClearingALanguageSendsAnExplicitNull() async throws {
        StubURLProtocol.install(.json(#"{"user":{"id":"u","email":"a@b.c"}}"#))
        let client = makeStubbedClient(token: "tok")

        let result = try await client.updateProfile(UpdateProfileInput(locale: .clear))

        let body = try XCTUnwrap(StubURLProtocol.lastRequest).jsonBody()
        // `null` and "key absent" are different requests: the first clears the
        // stored language, the second leaves it alone.
        XCTAssertTrue(body.keys.contains("locale"))
        XCTAssertTrue(body["locale"] is NSNull)
        XCTAssertNil(result.user.preferredLanguage)
    }

    func testUnchangedFieldsAreOmittedEntirely() throws {
        let data = try APIClient.encoder.encode(UpdateProfileInput(displayName: .set("Trung")))
        let body = try XCTUnwrap(
            JSONSerialization.jsonObject(with: data) as? [String: Any]
        )
        XCTAssertEqual(body["displayName"] as? String, "Trung")
        XCTAssertFalse(body.keys.contains("locale"))
    }

    // MARK: - User.locale decoding

    func testUserWithoutLocaleDecodes() throws {
        // The server omits the key entirely while it is null, so every old
        // response has to keep decoding.
        let user = try APIClient.decoder.decode(User.self, from: Data(#"""
        {"id":"u","email":"a@b.c","name":null}
        """#.utf8))
        XCTAssertNil(user.locale)
        XCTAssertNil(user.preferredLanguage)
    }

    func testUserWithRegionTaggedLocaleStillResolves() throws {
        let user = try APIClient.decoder.decode(User.self, from: Data(#"""
        {"id":"u","email":"a@b.c","locale":"vi-VN"}
        """#.utf8))
        XCTAssertEqual(user.locale, "vi-VN")
        XCTAssertEqual(user.preferredLanguage, .vi)
    }

    func testAnUnknownStoredLocaleDoesNotBreakDecoding() throws {
        // A future third language must not lock a user out of their own account.
        let user = try APIClient.decoder.decode(User.self, from: Data(#"""
        {"id":"u","email":"a@b.c","locale":"fr"}
        """#.utf8))
        XCTAssertNil(user.preferredLanguage)
    }
}
