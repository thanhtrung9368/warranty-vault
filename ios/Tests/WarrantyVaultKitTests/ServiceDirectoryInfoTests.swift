import Foundation
import XCTest
@testable import WarrantyVaultKit

/// Warranty service directory (FEATURE_IDEAS #15) — the honesty rules, pinned.
///
/// Three of them are the reason the feature exists at all, and each has tests
/// here rather than only in a view:
///
///   * `brand: null` means "no verified entry" (no seeded row **or** an ambiguous
///     match) and is explained in words — never an empty box, never an invented
///     URL;
///   * `phoneSource` decides whether a number may be dialled at all, and a number
///     the client cannot attribute is never promoted to "the user typed this";
///   * `phoneSource` is **lowercase on the wire** (`user` / `none`) while the enums
///     beside it are SCREAMING CASE — the casing that made an earlier client fail
///     to decode the whole response.
final class ServiceDirectoryInfoTests: KitTestCase {

    // MARK: - Fixtures
    //
    // Every fixture is assembled from plain values: quoting and `null` handling
    // happen inside these helpers, so no call site has to embed a string literal
    // (let alone an escaped one) inside another literal.

    /// `"key": <quoted value|null>,` — a JSON string field.
    private func pair(_ key: String, _ value: String?) -> String {
        "\"\(key)\": " + (value.map { "\"\($0)\"" } ?? "null") + ","
    }

    /// `"key": <raw JSON|null>,` — for a nested object or a literal `true`/`false`.
    private func rawPair(_ key: String, _ json: String?) -> String {
        "\"\(key)\": " + (json ?? "null") + ","
    }

    private func providerJSON(id: String = "samsung", name: String = "Samsung",
                              phone: String? = nil, address: String? = nil,
                              websiteUrl: String? = nil, notes: String? = nil) -> String {
        "{" + pair("id", id) + pair("name", name) + pair("phone", phone)
            + pair("address", address) + pair("websiteUrl", websiteUrl)
            + pair("notes", notes) + "\"end\": true}"
    }

    private func brandJSON(id: String = "x", name: String = "Hãng X",
                           serviceLocatorUrl: String? = nil, supportUrl: String? = nil,
                           notes: String? = nil) -> String {
        "{" + pair("brandId", id) + pair("name", name)
            + pair("serviceLocatorUrl", serviceLocatorUrl) + pair("supportUrl", supportUrl)
            + pair("notes", notes) + "\"end\": true}"
    }

    /// One `WarrantyCentre`. `phoneSource: nil` serialises as JSON `null` (a shape
    /// the server does not send but a client must survive); `omitPhoneSource: true`
    /// drops the key entirely.
    private func centreJSON(warrantyId: String = "w_1",
                            warrantyType: String = "STANDARD",
                            endDate: String? = "2027-01-15T00:00:00Z",
                            isActive: Bool? = true,
                            providerInput: String? = nil,
                            provider: String? = nil,
                            address: String? = nil,
                            phone: String? = nil,
                            phoneSource: String? = "none",
                            omitPhoneSource: Bool = false) -> String {
        """
        {\(pair("warrantyId", warrantyId))
         \(pair("warrantyType", warrantyType))
         \(rawPair("endDate", endDate.map { "\"\($0)\"" }))
         \(rawPair("isActive", isActive.map { $0 ? "true" : "false" }))
         \(pair("providerInput", providerInput))
         \(rawPair("provider", provider))
         \(pair("address", address))
         \(pair("phone", phone))
         \(omitPhoneSource ? "" : pair("phoneSource", phoneSource))"decoy": true}
        """
    }

    private func directoryJSON(brand: String? = nil,
                               brandInput: String? = "Samsung",
                               centres: [String] = [],
                               disclaimer: String = "App không lưu hotline.") -> String {
        """
        {"directory": {
          "deviceId": "dev_1", "deviceName": "Galaxy S24", "category": "PHONE",
          "brandInput": \(brandInput.map { "\"\($0)\"" } ?? "null"),
          "brand": \(brand ?? "null"),
          "centres": [\(centres.joined(separator: ","))],
          "disclaimer": "\(disclaimer)"
        }}
        """
    }

    private func directory(from json: String) throws -> ServiceDirectory {
        struct Wrapper: Decodable { let directory: ServiceDirectory }
        return try APIClient.decoder.decode(Wrapper.self, from: Data(json.utf8)).directory
    }

    private let appleBrand = """
    {"brandId": "apple", "name": "Apple",
     "serviceLocatorUrl": "https://locate.apple.com/vn/vi/",
     "supportUrl": null, "notes": "Trang tra cứu trung tâm uỷ quyền."}
    """

    // MARK: - The brand tier

    func testABrandRowIsTheEntryState() throws {
        let dir = try directory(from: directoryJSON(brand: appleBrand))
        guard case .entry(let brand) = ServiceDirectoryInfo.brandState(dir) else {
            return XCTFail("expected an entry")
        }
        XCTAssertEqual(brand.name, "Apple")
        XCTAssertTrue(ServiceDirectoryInfo.hasVerifiedLink(brand))
        XCTAssertEqual(ServiceDirectoryInfo.brandLinks(brand).map { $0.label },
                       [DirectoryCopy.linkServiceLocatorLabel])
        XCTAssertEqual(ServiceDirectoryInfo.brandNote(brand), "Trang tra cứu trung tâm uỷ quyền.")
    }

    /// `brand: null` with brand text present names **both** honest causes — no
    /// seeded row, and an ambiguous match — and states that no URL is invented.
    func testANullBrandWithTextExplainsBothCausesAndInventsNoURL() throws {
        let dir = try directory(from: directoryJSON(brand: nil, brandInput: "Samsung"))
        guard case .noEntry(let title, let detail, let input) = ServiceDirectoryInfo.brandState(dir) else {
            return XCTFail("expected the no-entry state, not an empty box")
        }
        XCTAssertEqual(input, "Samsung")
        XCTAssertEqual(title, DirectoryCopy.noEntryTitle)
        XCTAssertTrue(detail.contains("Không có dòng nào khớp"), "cause 1: no seeded row")
        XCTAssertTrue(detail.contains("nhiều dòng khớp ngang nhau"),
                      "cause 2: the free-text match tied")
        XCTAssertTrue(detail.contains("không đoán"), "the app refuses to guess")
        XCTAssertTrue(detail.contains("không tự tạo URL"), "never an invented URL")
        XCTAssertFalse(title.isEmpty)
    }

    /// No brand text either: the answer is "add one", not a fake directory row.
    func testANullBrandWithoutTextAsksForTheBrandInsteadOfGuessing() throws {
        for input in [String?.none, "", "   "] {
            let dir = try directory(from: directoryJSON(brand: nil, brandInput: input))
            guard case .noInput(let title, let detail) = ServiceDirectoryInfo.brandState(dir) else {
                return XCTFail("expected the no-input state for brandInput \(String(describing: input))")
            }
            XCTAssertEqual(title, DirectoryCopy.noBrandInputTitle)
            XCTAssertTrue(detail.contains("Thêm hãng"))
        }
    }

    func testABrandRowWithoutALinkIsSaidOutLoud() throws {
        let dir = try directory(from: directoryJSON(brand: brandJSON(id: "x", name: "Hãng X")))
        guard case .entry(let entry) = ServiceDirectoryInfo.brandState(dir) else {
            return XCTFail("expected an entry")
        }
        XCTAssertFalse(ServiceDirectoryInfo.hasVerifiedLink(entry))
        XCTAssertEqual(DirectoryCopy.noVerifiedLink, "App không có link nào đã kiểm chứng cho hãng này.")
    }

    /// A catalog row is data, not code: only `http(s)` may become a tappable row.
    func testOnlyHTTPURLsBecomeLinks() {
        XCTAssertEqual(ServiceDirectoryInfo.safeExternalURL("https://locate.apple.com/vn")?.absoluteString,
                       "https://locate.apple.com/vn")
        XCTAssertEqual(ServiceDirectoryInfo.safeExternalURL("http://example.vn")?.absoluteString,
                       "http://example.vn")
        XCTAssertNil(ServiceDirectoryInfo.safeExternalURL("javascript:alert(1)"))
        XCTAssertNil(ServiceDirectoryInfo.safeExternalURL("data:text/html,<b>x</b>"))
        XCTAssertNil(ServiceDirectoryInfo.safeExternalURL("ftp://example.vn"))
        XCTAssertNil(ServiceDirectoryInfo.safeExternalURL("locate.apple.com"))
        XCTAssertNil(ServiceDirectoryInfo.safeExternalURL(""))
        XCTAssertNil(ServiceDirectoryInfo.safeExternalURL("   "))
        XCTAssertNil(ServiceDirectoryInfo.safeExternalURL(nil))
        XCTAssertNil(ServiceDirectoryInfo.safeExternalURL("https://"))
    }

    /// Both links, each labelled for what it is: a locator is not a support page.
    func testBothBrandLinksKeepTheirOwnLabels() throws {
        let brand = try APIClient.decoder.decode(BrandServiceInfo.self, from: Data("""
        {"brandId": "samsung", "name": "Samsung",
         "serviceLocatorUrl": "https://www.samsung.com/vn/support/service-center/",
         "supportUrl": "https://www.samsung.com/vn/support/", "notes": null}
        """.utf8))
        XCTAssertEqual(ServiceDirectoryInfo.brandLinks(brand).map { $0.label },
                       [DirectoryCopy.linkServiceLocatorLabel, DirectoryCopy.linkSupportLabel])
        XCTAssertEqual(ServiceDirectoryInfo.brandLinks(brand).map { $0.url.absoluteString },
                       ["https://www.samsung.com/vn/support/service-center/",
                        "https://www.samsung.com/vn/support/"])
    }

    // MARK: - The phone tier

    func testAUserPhoneIsTheUsersOwnAndIsDialable() {
        let disclosure = ServiceDirectoryInfo.phoneDisclosure(phone: "0901 234 567", source: .user)
        guard case .user(let phone, let label, let hint) = disclosure else {
            return XCTFail("expected the user state")
        }
        XCTAssertEqual(phone, "0901 234 567")
        XCTAssertEqual(label, "Do bạn tự ghi")
        XCTAssertTrue(hint.contains("app không kiểm chứng"))
        XCTAssertEqual(disclosure.dialURL?.absoluteString, "tel:0901234567")
    }

    /// `none` says there is nothing, in words that cannot be read as a hotline —
    /// and offers no call action.
    func testNoPhoneIsSaidRatherThanLeftBlank() {
        let cases: [(phone: String?, source: PhoneSource?)] = [
            (nil, nil),
            ("   ", nil),
            ("0901234567", PhoneSource.none),
            ("   ", PhoneSource.none),
        ]
        for (phone, source) in cases {
            let disclosure = ServiceDirectoryInfo.phoneDisclosure(phone: phone, source: source)
            guard case .none(let label, let hint) = disclosure else {
                return XCTFail("expected the none state for phone \(String(describing: phone))")
            }
            XCTAssertEqual(label, "Chưa có số điện thoại")
            XCTAssertTrue(hint.contains("không có số nào để hiện"))
            XCTAssertNil(disclosure.dialURL)
        }
    }

    /// A number whose source this client cannot attribute is shown **flagged**:
    /// never promoted to the user's own word, never dialled.
    func testAnUnattributablePhoneIsShownButNeverVerified() {
        let disclosure = ServiceDirectoryInfo.phoneDisclosure(phone: "1900 1234", source: nil)
        guard case .unverified(let phone, let label, let hint) = disclosure else {
            return XCTFail("expected the unverified state")
        }
        XCTAssertEqual(phone, "1900 1234")
        XCTAssertEqual(label, "Nguồn số chưa rõ")
        XCTAssertTrue(hint.contains("không coi nó là số đã kiểm chứng"))
        XCTAssertNil(disclosure.dialURL)
    }

    /// Only `user` yields a `tel:` URL — the gate lives in the disclosure type so
    /// no view can offer a call action on its own.
    func testOnlyAUserSourcedPhoneOffersATelAction() {
        XCTAssertNotNil(ServiceDirectoryInfo.phoneDisclosure(phone: "0901234567", source: .user).dialURL)
        XCTAssertNil(ServiceDirectoryInfo.phoneDisclosure(phone: "0901234567", source: nil).dialURL)
        XCTAssertNil(ServiceDirectoryInfo.phoneDisclosure(phone: "0901234567", source: .none).dialURL)
        XCTAssertNil(ServiceDirectoryInfo.phoneDisclosure(phone: nil, source: .user).dialURL)
    }

    /// A number that cannot be dialled (letters, an emoji, a marketing string) is
    /// rendered as text instead of a button that opens nothing. The formatting
    /// characters people actually type are stripped instead of refused.
    func testANonDialableNumberOffersNoAction() {
        XCTAssertNil(ServiceDirectoryInfo.dialURL(for: "gọi 1900"))
        XCTAssertNil(ServiceDirectoryInfo.dialURL(for: "   "))
        XCTAssertNil(ServiceDirectoryInfo.dialURL(for: "☎️"))
        XCTAssertEqual(ServiceDirectoryInfo.dialURL(for: "+84 (0) 901-234-567")?.absoluteString,
                       "tel:+840901-234-567")
        XCTAssertEqual(ServiceDirectoryInfo.dialURL(for: "090.123.4567")?.absoluteString,
                       "tel:0901234567")
        XCTAssertEqual(ServiceDirectoryInfo.dialURL(for: "*123#")?.absoluteString, "tel:*123#")
    }

    /// The line that must be on screen wherever a phone is (or is not).
    func testThePhoneHonestyLineSaysTheAppIsNeverTheSource() {
        XCTAssertTrue(DirectoryCopy.phoneHonesty.contains("App không phải nguồn của số điện thoại nào"))
        XCTAssertTrue(DirectoryCopy.phoneHonesty.contains("không phải hotline"))
    }

    // MARK: - The centre tier

    func testTheProviderLineAlwaysHasSomethingToShow() throws {
        let matched = try directory(from: directoryJSON(centres: [
            centreJSON(providerInput: "TT Bảo hành Samsung",
                       provider: providerJSON(id: "samsung", name: "Samsung")),
        ])).centres[0]
        let matchedState = ServiceDirectoryInfo.providerState(matched)
        XCTAssertEqual(matchedState.line, "Samsung")
        XCTAssertEqual(matchedState, .matched(name: "Samsung", input: "TT Bảo hành Samsung",
                                             note: DirectoryCopy.providerMatchedNote))

        let unmatched = try directory(from: directoryJSON(centres: [
            centreJSON(providerInput: "Trung tâm bảo hành"),
        ])).centres[0]
        guard case .unmatched(let name, let input, let note) = ServiceDirectoryInfo.providerState(unmatched) else {
            return XCTFail("expected the unmatched state")
        }
        XCTAssertNil(name)
        XCTAssertEqual(input, "Trung tâm bảo hành")
        XCTAssertTrue(note.contains("không đoán"))

        let empty = try directory(from: directoryJSON(centres: [centreJSON()])).centres[0]
        XCTAssertEqual(ServiceDirectoryInfo.providerState(empty).line, "Chưa ghi nơi bảo hành")
        XCTAssertEqual(ServiceDirectoryInfo.providerState(empty).line, DirectoryCopy.noProvider)
    }

    func testCentreStatusPrefersTheServersIsActiveAndFallsBackToTheEndDate() throws {
        let now = makeDate("2026-04-10 09:00:00", format: "yyyy-MM-dd HH:mm:ss",
                           timeZone: TimeZone(identifier: "UTC")!)

        let active = try directory(from: directoryJSON(centres: [centreJSON()])).centres[0]
        XCTAssertEqual(ServiceDirectoryInfo.centreStatus(active, now: now), .active)

        let expired = try directory(from: directoryJSON(centres: [
            centreJSON(isActive: false),
        ])).centres[0]
        XCTAssertEqual(ServiceDirectoryInfo.centreStatus(expired, now: now), .expired)

        // No server flag: the end date decides, and "no end date" is its own answer.
        let future = try directory(from: directoryJSON(centres: [
            centreJSON(endDate: "2027-01-01T00:00:00Z", isActive: nil),
        ])).centres[0]
        XCTAssertEqual(ServiceDirectoryInfo.centreStatus(future, now: now), .active)

        let past = try directory(from: directoryJSON(centres: [
            centreJSON(endDate: "2026-01-01T00:00:00Z", isActive: nil),
        ])).centres[0]
        XCTAssertEqual(ServiceDirectoryInfo.centreStatus(past, now: now), .expired)

        let undated = try directory(from: directoryJSON(centres: [
            centreJSON(endDate: nil, isActive: nil),
        ])).centres[0]
        XCTAssertEqual(ServiceDirectoryInfo.centreStatus(undated, now: now), .undated)
        XCTAssertEqual(ServiceDirectoryInfo.CentreStatus.undated.label, "Chưa ghi hạn")
    }

    func testWarrantyTypeLabelsFallBackHonestly() {
        XCTAssertEqual(ServiceDirectoryInfo.warrantyTypeLabel("STANDARD"), "Tiêu chuẩn")
        XCTAssertEqual(ServiceDirectoryInfo.warrantyTypeLabel("EXTENDED"), "Mở rộng")
        XCTAssertEqual(ServiceDirectoryInfo.warrantyTypeLabel("THIRD_PARTY"), "Bên thứ ba")
        XCTAssertEqual(ServiceDirectoryInfo.warrantyTypeLabel("SOMETHING_NEW"), "SOMETHING_NEW")
        XCTAssertEqual(ServiceDirectoryInfo.warrantyTypeLabel(""), DirectoryCopy.unknownWarrantyType)
    }

    func testCentreCountLabel() throws {
        XCTAssertEqual(ServiceDirectoryInfo.centreCountLabel([]), "Thiết bị chưa có gói bảo hành nào")
        let one = try directory(from: directoryJSON(centres: [centreJSON()])).centres
        XCTAssertEqual(ServiceDirectoryInfo.centreCountLabel(one), "1 gói bảo hành")
        let three = try directory(from: directoryJSON(centres: [
            centreJSON(warrantyId: "w_1"), centreJSON(warrantyId: "w_2"), centreJSON(warrantyId: "w_3"),
        ])).centres
        XCTAssertEqual(ServiceDirectoryInfo.centreCountLabel(three), "3 gói bảo hành")
    }

    func testTheSummaryCountsOnlyPhonesTheUserTyped() throws {
        let dir = try directory(from: directoryJSON(centres: [
            centreJSON(warrantyId: "w_1", providerInput: "Samsung",
                       provider: providerJSON(id: "samsung", name: "Samsung"),
                       address: "12 Lê Lợi", phone: "0901234567", phoneSource: "user"),
            centreJSON(warrantyId: "w_2", phone: "1900 1234", phoneSource: "none"),
            centreJSON(warrantyId: "w_3", providerInput: "Trung tâm bảo hành"),
        ]))
        let summary = ServiceDirectoryInfo.contactSummary(dir)
        XCTAssertEqual(summary.centres, 3)
        XCTAssertEqual(summary.withUserPhone, 1, "a number whose source is not `user` must not be counted")
        XCTAssertEqual(summary.withUserAddress, 1)
        XCTAssertEqual(summary.unmatchedProviders, 1)
        XCTAssertEqual(summary.line,
                       "1/3 gói có số điện thoại do bạn tự ghi · 1 gói chưa khớp danh bạ nhà bảo hành. App không có hotline nào trong hai con số đó.")
    }

    func testNoWarrantiesMeansNoCentresAndThatIsSaid() throws {
        let dir = try directory(from: directoryJSON(centres: []))
        XCTAssertTrue(dir.centres.isEmpty)
        XCTAssertEqual(ServiceDirectoryInfo.contactSummary(dir).line, DirectoryCopy.noCentres)
    }

    // MARK: - The server's own words

    func testTheDisclaimerIsSurfacedVerbatim() throws {
        let text = "App không lưu hotline hay địa chỉ trung tâm bảo hành; số hiện ra là do bạn tự ghi."
        let dir = try directory(from: directoryJSON(disclaimer: text))
        XCTAssertEqual(ServiceDirectoryInfo.disclaimer(dir), text)

        let blank = try directory(from: directoryJSON(disclaimer: "   "))
        XCTAssertNil(ServiceDirectoryInfo.disclaimer(blank), "a blank disclaimer is nothing, not an empty box")
    }

    func testTheSectionHintExplainsWhyThereIsNoHotline() {
        XCTAssertTrue(DirectoryCopy.sectionHint.contains("một hotline sai còn tệ hơn không có"))
        XCTAssertTrue(DirectoryCopy.sectionHint.contains("do bạn tự ghi"))
    }

    // MARK: - Casing: lowercase `phoneSource` on the wire

    /// The whole point: `phoneSource` is lowercase while `warrantyType` beside it
    /// is SCREAMING CASE, and a client that assumed otherwise lost the response.
    func testARealisticDirectoryPayloadDecodesWithLowercasePhoneSource() throws {
        let dir = try directory(from: directoryJSON(
            brand: appleBrand,
            centres: [
                centreJSON(warrantyId: "w_1", providerInput: "Apple Store",
                           provider: providerJSON(id: "apple", name: "Apple"),
                           address: "12 Lê Lợi, Q.1", phone: "0901234567", phoneSource: "user"),
                centreJSON(warrantyId: "w_2", warrantyType: "THIRD_PARTY",
                           providerInput: "Trung tâm bảo hành"),
            ]))

        XCTAssertEqual(dir.deviceId, "dev_1")
        XCTAssertEqual(dir.centres.count, 2)
        XCTAssertEqual(dir.centres[0].phoneSource, PhoneSource.user)
        XCTAssertEqual(dir.centres[1].phoneSource, PhoneSource.none)
        XCTAssertEqual(dir.centres[1].warrantyType, "THIRD_PARTY")
        XCTAssertEqual(ServiceDirectoryInfo.phoneDisclosure(dir.centres[0]).dialURL?.absoluteString,
                       "tel:0901234567")
        XCTAssertNil(ServiceDirectoryInfo.phoneDisclosure(dir.centres[1]).dialURL)
    }

    /// An unexpected casing or an unknown value must not fail the whole response —
    /// it becomes "nguồn chưa rõ" and the rest of the directory survives. The
    /// `null` and missing-key shapes are covered too: both mean the same thing to
    /// this client, and neither is promoted to `user`.
    func testAnUnknownOrMissingPhoneSourceDoesNotKillTheDirectory() throws {
        let payloads = [
            centreJSON(warrantyId: "w_1", phone: "0901234567", phoneSource: "USER"),
            centreJSON(warrantyId: "w_1", phone: "0901234567", phoneSource: "User"),
            centreJSON(warrantyId: "w_1", phone: "0901234567", phoneSource: "app"),
            centreJSON(warrantyId: "w_1", phone: "0901234567", phoneSource: nil),
            centreJSON(warrantyId: "w_1", phone: "0901234567", omitPhoneSource: true),
        ]
        for payload in payloads {
            let dir = try directory(from: directoryJSON(centres: [payload]))
            XCTAssertEqual(dir.centres.count, 1, "the payload must decode: \(payload)")
            XCTAssertNil(dir.centres[0].phoneSource)
            XCTAssertNil(ServiceDirectoryInfo.phoneDisclosure(dir.centres[0]).dialURL,
                         "a number with an unattributable source must never be dialled")
            XCTAssertEqual(ServiceDirectoryInfo.contactSummary(dir).withUserPhone, 0)
        }
    }

    /// Nulls everywhere are answers, not errors: the whole bundle still decodes and
    /// every branch still has something to show.
    func testADirectoryOfNullsStillDecodesAndSaysSomething() throws {
        let dir = try directory(from: """
        {"directory": {"deviceId": "dev_1", "deviceName": "Máy", "category": "PHONE",
                       "brandInput": null, "brand": null,
                       "centres": [{"warrantyId": "w_1", "warrantyType": "STANDARD",
                                    "endDate": null, "isActive": false, "providerInput": null,
                                    "provider": null, "address": null, "phone": null,
                                    "phoneSource": "none"}],
                       "disclaimer": "."}}
        """)
        XCTAssertNil(dir.brandInput)
        XCTAssertNil(dir.brand)
        guard case .noInput = ServiceDirectoryInfo.brandState(dir) else {
            return XCTFail("expected the no-input brand state")
        }
        XCTAssertNil(ServiceDirectoryInfo.centreAddress(dir.centres[0]))
        XCTAssertEqual(ServiceDirectoryInfo.providerState(dir.centres[0]).line, DirectoryCopy.noProvider)
        XCTAssertEqual(ServiceDirectoryInfo.phoneDisclosure(dir.centres[0]),
                       .none(label: DirectoryCopy.phoneNoneLabel, hint: DirectoryCopy.phoneNoneHint))
    }

    /// A missing `centres` key is treated as "no rows" rather than failing the
    /// whole directory — an empty answer this feature must never give by accident.
    func testAMissingCentresArrayIsNoRowsNotAFailedDecode() throws {
        let dir = try directory(from: """
        {"directory": {"deviceId": "dev_1", "deviceName": "Máy", "category": "PHONE",
                       "brand": null, "disclaimer": "."}}
        """)
        XCTAssertTrue(dir.centres.isEmpty)
        XCTAssertEqual(dir.category, "PHONE")
    }

    // MARK: - The endpoint

    func testServiceDirectoryRequestPathAndEnvelope() async throws {
        StubURLProtocol.install(.json(directoryJSON(
            brand: appleBrand,
            centres: [centreJSON(phone: "0901234567", phoneSource: "user")])))
        let client = makeStubbedClient(token: "tok_abc")

        let dir = try await client.serviceDirectory(deviceId: "dev_1")

        let request = try XCTUnwrap(StubURLProtocol.lastRequest)
        XCTAssertEqual(request.httpMethod, "GET")
        XCTAssertEqual(request.url?.path, "/api/v1/devices/dev_1/service-directory")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer tok_abc")
        XCTAssertEqual(dir.brand?.name, "Apple")
        XCTAssertEqual(dir.centres[0].phoneSource, PhoneSource.user)
    }
}
