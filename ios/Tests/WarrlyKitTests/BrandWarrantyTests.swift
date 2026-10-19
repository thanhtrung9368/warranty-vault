import Foundation
import XCTest
@testable import WarrlyKit

/// Brand warranty lookup ("Đối chiếu với hãng") — the pure half.
///
/// The feature exists because the date the user typed and the date the brand
/// holds are different facts. These tests pin the parts that must not drift:
/// the five wire fields and the mismatch shape, the copy selector for all four
/// mismatch kinds (plus a kind this build does not know), the "no lookup URL"
/// answer, the write rules, and the calendar-day arithmetic.
///
/// Language is always pinned with `L.withLanguage` — never inherited from the
/// machine (docs/I18N_PLAN.md §4 rule 3). The copy lives in computed properties
/// so one process can assert both languages; a stored `static let` would freeze
/// whichever language happened to read it first.
final class BrandWarrantyTests: KitTestCase {

    // MARK: - Fixtures

    private let utc = TimeZone(identifier: "UTC")!

    private func deviceJSON(
        status: String = #""PRE_ACTIVATED""#,
        start: String = #""2026-02-01T00:00:00""#,
        end: String = #""2027-02-01T00:00:00""#,
        checkedAt: String = #""2026-03-21T09:30:00""#,
        lookupURL: String = #""https://samsung.com/vn/support/warranty""#,
        mismatch: String = #"{"kind":"STARTS_BEFORE","days":47,"brandDate":"2026-02-01T00:00:00","purchaseDate":"2026-03-20T00:00:00"}"#
    ) -> String {
        """
        {
          "id": "dev_1", "name": "Galaxy S24", "category": "PHONE",
          "brand": "Samsung", "purchaseDate": "2026-03-20T00:00:00",
          "purchasePrice": 20990000, "status": "ACTIVE",
          "brandWarrantyStatus": \(status),
          "brandWarrantyStart": \(start),
          "brandWarrantyEnd": \(end),
          "brandCheckedAt": \(checkedAt),
          "brandLookupUrl": \(lookupURL),
          "warrantyMismatch": \(mismatch)
        }
        """
    }

    private func decodeDevice(_ json: String) throws -> Device {
        try APIClient.decoder.decode(Device.self, from: Data(json.utf8))
    }

    // MARK: - Wire decode

    func testDeviceDecodesTheFiveBrandFieldsAndTheMismatch() throws {
        let device = try decodeDevice(deviceJSON())

        XCTAssertEqual(device.brandWarrantyStatus, .PRE_ACTIVATED)
        // Raw strings, not `Date`s: only the leading day is ever displayed, and
        // parsing a Z-less timestamp as an instant would move that day.
        XCTAssertEqual(device.brandWarrantyStart, "2026-02-01T00:00:00")
        XCTAssertEqual(device.brandWarrantyEnd, "2027-02-01T00:00:00")
        XCTAssertEqual(device.brandCheckedAt, "2026-03-21T09:30:00")
        XCTAssertEqual(device.brandLookupUrl, "https://samsung.com/vn/support/warranty")

        let mismatch = try XCTUnwrap(device.warrantyMismatch)
        XCTAssertEqual(mismatch.kind, .STARTS_BEFORE)
        XCTAssertEqual(mismatch.days, 47)
        XCTAssertEqual(mismatch.brandDate, "2026-02-01T00:00:00")
        XCTAssertEqual(mismatch.purchaseDate, "2026-03-20T00:00:00")
    }

    func testDeviceDecodesMissingBrandFieldsAsNil() throws {
        let json = """
        {"id": "dev_2", "name": "Máy giặt", "category": "WASHING",
         "purchaseDate": "2025-01-01T00:00:00", "purchasePrice": 9000000,
         "status": "ACTIVE"}
        """
        let device = try decodeDevice(json)

        XCTAssertNil(device.brandWarrantyStatus)
        XCTAssertNil(device.brandWarrantyStart)
        XCTAssertNil(device.brandWarrantyEnd)
        XCTAssertNil(device.brandCheckedAt)
        XCTAssertNil(device.brandLookupUrl)
        XCTAssertNil(device.warrantyMismatch)
    }

    /// A future sixth status must not take the whole device payload down; it
    /// reads as the honest `.UNKNOWN`.
    func testUnknownStatusDoesNotFailTheWholeDevice() throws {
        let device = try decodeDevice(deviceJSON(status: #""TRANSFERRED""#))

        XCTAssertEqual(device.brandWarrantyStatus, .UNKNOWN)
        XCTAssertEqual(device.brandWarrantyStart, "2026-02-01T00:00:00")
        XCTAssertEqual(device.warrantyMismatch?.days, 47)
    }

    /// Same for a future mismatch kind: the flag survives, the kind is `nil`,
    /// and the generic copy still carries the day count and both dates.
    func testUnknownMismatchKindKeepsTheFlagAndTheDates() throws {
        let device = try decodeDevice(deviceJSON(
            mismatch: #"{"kind":"REPAIRED_AND_REREGISTERED","days":9,"brandDate":"2026-03-11T00:00:00","purchaseDate":"2026-03-20T00:00:00"}"#
        ))
        let mismatch = try XCTUnwrap(device.warrantyMismatch)
        XCTAssertNil(mismatch.kind)
        XCTAssertEqual(mismatch.days, 9)

        let state = BrandWarrantyRules.mismatchState(
            mismatch,
            fields: BrandWarrantyRules.carried(from: device)
        )
        guard case .mismatch = state else {
            return XCTFail("an unknown kind must still be a mismatch, got \(state)")
        }
        L.withLanguage(.en) {
            XCTAssertEqual(BrandWarrantyRules.mismatchHeadline(mismatch),
                           "The brand's warranty dates differ from your estimate by 9 days")
            XCTAssertEqual(BrandWarrantyRules.mismatchDatesLine(mismatch),
                           "Brand says: 11/03/2026 · Compared date: 20/03/2026")
        }
    }

    /// A malformed computed object must not take down the whole device read. It
    /// degrades to the generic copy, not to a decoding failure.
    func testMalformedMismatchAndStatusDoNotFailTheDevice() throws {
        let device = try decodeDevice(deviceJSON(
            status: "123",
            mismatch: #"{"kind":123,"days":"not-a-number","brandDate":[],"purchaseDate":{}}"#
        ))
        XCTAssertEqual(device.brandWarrantyStatus, .UNKNOWN)
        let mismatch = try XCTUnwrap(device.warrantyMismatch)
        XCTAssertNil(mismatch.kind)
        XCTAssertEqual(mismatch.days, 0)
        XCTAssertNil(mismatch.brandDate)
        XCTAssertNil(mismatch.purchaseDate)
        // The rest of the payload is intact.
        XCTAssertEqual(device.brandWarrantyStart, "2026-02-01T00:00:00")
    }

    func testDetailBodyCarriesTheSameSixFields() throws {
        let json = #"{"device": \#(deviceJSON())}"#
        let detail = try APIClient.decoder.decode(DeviceDetail.self, from: Data(json.utf8))

        XCTAssertEqual(detail.device.brandWarrantyStatus, .PRE_ACTIVATED)
        XCTAssertEqual(detail.device.brandWarrantyStart, "2026-02-01T00:00:00")
        XCTAssertEqual(detail.device.brandCheckedAt, "2026-03-21T09:30:00")
        XCTAssertEqual(detail.device.brandLookupUrl, "https://samsung.com/vn/support/warranty")
        XCTAssertEqual(detail.device.warrantyMismatch?.kind, .STARTS_BEFORE)
        XCTAssertEqual(BrandWarrantyRules.carried(from: detail.device),
                       BrandWarrantyFields(status: .PRE_ACTIVATED,
                                           start: "2026-02-01",
                                           end: "2027-02-01",
                                           checkedAt: "2026-03-21T09:30:00",
                                           lookupUrl: "https://samsung.com/vn/support/warranty"))
    }

    // MARK: - Service info

    func testBrandServiceInfoDecodesNullableLookupURL() throws {
        let withURL = try APIClient.decoder.decode(BrandServiceInfoResponse.self, from: Data("""
        {"brandId": "samsung", "name": "Samsung",
         "serviceLocatorUrl": "https://samsung.com/vn/support/centres",
         "supportUrl": null, "notes": null,
         "warrantyLookupUrl": "https://samsung.com/vn/support/warranty"}
        """.utf8))
        XCTAssertEqual(withURL.info?.warrantyLookupUrl, "https://samsung.com/vn/support/warranty")

        // The contract's whole point: null for some brands.
        let withoutURL = try APIClient.decoder.decode(BrandServiceInfoResponse.self, from: Data("""
        {"brandId": "apple", "name": "Apple", "warrantyLookupUrl": null}
        """.utf8))
        XCTAssertNil(withoutURL.info?.warrantyLookupUrl)
        XCTAssertEqual(BrandWarrantyRules.lookupAvailability(withoutURL.info?.warrantyLookupUrl),
                       .missing)

        // A known brand with no directory row is a 200 with `serviceInfo: null`,
        // not an error and not a row with a null URL.
        let noRow = try APIClient.decoder.decode(BrandServiceInfoResponse.self, from: Data("""
        {"serviceInfo": null}
        """.utf8))
        XCTAssertNil(noRow.info)
        XCTAssertEqual(BrandWarrantyRules.lookupAvailability(noRow.info?.warrantyLookupUrl),
                       .missing)
    }

    func testBrandServiceInfoAcceptsTheDocumentedWrapperShapes() throws {
        for wrapper in ["serviceInfo", "brand", "brandServiceInfo", "info"] {
            let json = #"{"\#(wrapper)": {"brandId": "apple", "name": "Apple", "warrantyLookupUrl": "https://checkcoverage.apple.com"}}"#
            let payload = try APIClient.decoder.decode(BrandServiceInfoResponse.self,
                                                       from: Data(json.utf8))
            XCTAssertEqual(payload.info?.brandId, "apple", wrapper)
            XCTAssertEqual(payload.info?.warrantyLookupUrl, "https://checkcoverage.apple.com", wrapper)
        }
    }

    func testBrandServiceInfoEndpointUsesTheExactRouteAndAuth() async throws {
        StubURLProtocol.install(.json("""
        {"serviceInfo": {"brandId": "samsung", "name": "Samsung",
                         "warrantyLookupUrl": "https://samsung.com/vn/support/warranty"}}
        """))
        let client = makeStubbedClient(token: "tok_abc")

        let fetched = try await client.brandServiceInfo(brandId: "samsung")
        let info = try XCTUnwrap(fetched)

        XCTAssertEqual(info.brandId, "samsung")
        XCTAssertEqual(info.warrantyLookupUrl, "https://samsung.com/vn/support/warranty")
        let request = try XCTUnwrap(StubURLProtocol.lastRequest)
        XCTAssertEqual(request.httpMethod, "GET")
        XCTAssertEqual(request.url?.path, "/api/v1/brands/samsung/service-info")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer tok_abc")
        XCTAssertNil(request.url?.query)
    }

    func testBrandServiceInfoEndpointReturnsNilForAKnownBrandWithNoRow() async throws {
        StubURLProtocol.install(.json(#"{"serviceInfo": null}"#))
        let client = makeStubbedClient(token: "tok_abc")

        let info = try await client.brandServiceInfo(brandId: "acer")

        XCTAssertNil(info, "a null serviceInfo is 'no directory row', not a decoding failure")
    }

    /// The same `BrandServiceInfo` shape is embedded in the service directory;
    /// the lookup URL must arrive there too, or the directory and the new route
    /// would disagree about a brand.
    func testServiceDirectoryBrandCarriesTheLookupURL() throws {
        let directory = try APIClient.decoder.decode(ServiceDirectory.self, from: Data("""
        {"deviceId": "dev_1", "deviceName": "Galaxy S24", "category": "PHONE",
         "brandInput": "Samsung",
         "brand": {"brandId": "samsung", "name": "Samsung",
                   "serviceLocatorUrl": "https://samsung.com/vn/support/centres",
                   "supportUrl": null,
                   "warrantyLookupUrl": "https://samsung.com/vn/support/warranty",
                   "notes": null},
         "centres": [], "disclaimer": "…"}
        """.utf8))

        XCTAssertEqual(directory.brand?.warrantyLookupUrl,
                       "https://samsung.com/vn/support/warranty")
    }

    func testBrandServiceInfoPathEscapesTheBrandId() {
        XCTAssertEqual(APIClient.brandServiceInfoPath("samsung"),
                       "/api/v1/brands/samsung/service-info")
        XCTAssertEqual(APIClient.brandServiceInfoPath("a/b"),
                       "/api/v1/brands/a%2Fb/service-info")
        XCTAssertEqual(APIClient.brandServiceInfoPath("a:b"),
                       "/api/v1/brands/a%3Ab/service-info")
    }

    // MARK: - DeviceInput

    func testDeviceInputCarriesTheFiveFieldsAndNeverTheMismatch() async throws {
        let client = makeStubbedClient(token: "tok_abc")
        StubURLProtocol.install(.json("""
        {"device": {"id": "dev_1", "name": "Galaxy S24", "category": "PHONE",
                    "purchaseDate": "2026-03-20T00:00:00", "purchasePrice": 0,
                    "status": "ACTIVE"}, "warnings": []}
        """))

        var input = DeviceInput(name: "Galaxy S24", category: "PHONE",
                                purchaseDate: "2026-03-20")
        BrandWarrantyRules.apply(
            BrandWarrantyFields(status: .PRE_ACTIVATED,
                                start: "2026-02-01T23:30:00",
                                end: "2027-02-01",
                                checkedAt: "2026-03-21T09:30:00Z",
                                lookupUrl: "https://samsung.com/vn/support/warranty"),
            to: &input
        )
        _ = try await client.updateDevice(id: "dev_1", input)

        let body = try XCTUnwrap(StubURLProtocol.lastRequest).jsonBody()
        XCTAssertEqual(body["brandWarrantyStatus"] as? String, "PRE_ACTIVATED")
        XCTAssertEqual(body["brandWarrantyStart"] as? String, "2026-02-01")
        XCTAssertEqual(body["brandWarrantyEnd"] as? String, "2027-02-01")
        XCTAssertEqual(body["brandCheckedAt"] as? String, "2026-03-21T09:30:00Z")
        XCTAssertEqual(body["brandLookupUrl"] as? String, "https://samsung.com/vn/support/warranty")
        XCTAssertNil(body["warrantyMismatch"], "the mismatch is read-only on the contract")
    }

    /// A cleared check must be **absent** from the body, not an empty string or
    /// a fake "UNKNOWN": absent and null both mean "clear" to Go, and the five
    /// keys must disappear together.
    func testDeviceInputOmitsEveryBrandKeyWhenTheCheckIsCleared() async throws {
        let client = makeStubbedClient(token: "tok_abc")
        StubURLProtocol.install(.json("""
        {"device": {"id": "dev_1", "name": "Galaxy S24", "category": "PHONE",
                    "purchaseDate": "2026-03-20T00:00:00", "purchasePrice": 0,
                    "status": "ACTIVE"}, "warnings": []}
        """))

        var input = DeviceInput(name: "Galaxy S24", category: "PHONE",
                                purchaseDate: "2026-03-20")
        BrandWarrantyRules.apply(.empty, to: &input)
        _ = try await client.updateDevice(id: "dev_1", input)

        let body = try XCTUnwrap(StubURLProtocol.lastRequest).jsonBody()
        for key in ["brandWarrantyStatus", "brandWarrantyStart", "brandWarrantyEnd",
                    "brandCheckedAt", "brandLookupUrl"] {
            XCTAssertNil(body[key], "\(key) must be omitted so a PATCH clears it")
        }
    }

    func testCarriedPreservesARecordedCheckAndDropsAnUnopenableURL() throws {
        let device = try decodeDevice(deviceJSON(
            start: #""2026-02-01T23:30:00""#,
            end: #""2027-02-01T00:00:00Z""#,
            lookupURL: #""javascript:alert(1)""#
        ))
        let fields = BrandWarrantyRules.carried(from: device)

        XCTAssertEqual(fields.start, "2026-02-01", "the calendar day never slides")
        XCTAssertEqual(fields.end, "2027-02-01")
        XCTAssertEqual(fields.checkedAt, "2026-03-21T09:30:00",
                       "the check instant is not a day and is preserved")
        XCTAssertNil(fields.lookupUrl,
                     "an unopenable legacy URL is not carried into a save that would 400")
    }

    // MARK: - Lookup availability

    func testLookupAvailabilityAcceptsOnlyAbsoluteHTTPURLs() {
        XCTAssertEqual(BrandWarrantyRules.lookupAvailability("https://checkcoverage.apple.com"),
                       .available(URL(string: "https://checkcoverage.apple.com")!))
        XCTAssertEqual(BrandWarrantyRules.lookupAvailability("http://example.vn"),
                       .available(URL(string: "http://example.vn")!))
        XCTAssertEqual(BrandWarrantyRules.lookupAvailability("  https://example.vn  "),
                       .available(URL(string: "https://example.vn")!))

        for raw in [nil, "", "   ", "example.vn", "/support", "javascript:alert(1)",
                    "data:text/html,x", "ftp://example.vn", "https://",
                    "https://example.vn/a b"] {
            XCTAssertEqual(BrandWarrantyRules.lookupAvailability(raw), .missing,
                           "\(String(describing: raw)) must not become an openable action")
        }
    }

    func testNoLookupURLCopyIsBilingualAndNamesTheLimit() {
        L.withLanguage(.vi) {
            XCTAssertEqual(BrandWarrantyCopy.lookupMissingTitle,
                           "App không có trang tra cứu của hãng này")
            XCTAssertTrue(BrandWarrantyCopy.lookupMissingDetail.contains("không tự đoán URL"))
        }
        L.withLanguage(.en) {
            XCTAssertEqual(BrandWarrantyCopy.lookupMissingTitle,
                           "We don't have this brand's lookup page")
            XCTAssertTrue(BrandWarrantyCopy.lookupMissingDetail.contains("won't guess a URL"))
            XCTAssertTrue(BrandWarrantyCopy.lookupUnknownBrandDetail.contains("catalog"))
        }
    }

    // MARK: - Brand id resolution

    func testBrandIdMatchesAFoldedExactName() {
        let brands = [
            BrandOption(id: "apple", name: "Apple", categoryCodes: ["PHONE"]),
            BrandOption(id: "samsung", name: "Samsung", categoryCodes: ["PHONE"]),
            BrandOption(id: "dienmay", name: "Điện Máy", categoryCodes: ["HOME"]),
        ]
        XCTAssertEqual(BrandWarrantyRules.brandId(for: "Apple", in: brands), "apple")
        XCTAssertEqual(BrandWarrantyRules.brandId(for: " apple ", in: brands), "apple")
        XCTAssertEqual(BrandWarrantyRules.brandId(for: "SAMSUNG", in: brands), "samsung")
        XCTAssertEqual(BrandWarrantyRules.brandId(for: "dien may", in: brands), "dienmay")
        XCTAssertEqual(BrandWarrantyRules.brandId(for: "  Điện   Máy ", in: brands), "dienmay")
    }

    func testBrandIdRefusesToGuessWhenMissingAmbiguousOrSubstring() {
        let brands = [
            BrandOption(id: "samsung", name: "Samsung", categoryCodes: ["PHONE"]),
            BrandOption(id: "dup_1", name: "An", categoryCodes: ["HOME"]),
            BrandOption(id: "dup_2", name: "An", categoryCodes: ["HOME"]),
        ]
        XCTAssertNil(BrandWarrantyRules.brandId(for: "Sam", in: brands),
                     "a substring is not a match")
        XCTAssertNil(BrandWarrantyRules.brandId(for: "Apple Việt Nam", in: brands))
        XCTAssertNil(BrandWarrantyRules.brandId(for: "An", in: brands),
                     "two ids with the same name are ambiguous")
        XCTAssertNil(BrandWarrantyRules.brandId(for: "  ", in: brands))
        XCTAssertNil(BrandWarrantyRules.brandId(for: nil, in: brands))
        XCTAssertNil(BrandWarrantyRules.brandId(for: "Samsung", in: []))
    }

    // MARK: - Mismatch copy

    private func mismatch(_ kind: WarrantyMismatchKind, days: Int = 47) -> WarrantyMismatch {
        WarrantyMismatch(kind: kind, days: days,
                         brandDate: "2026-02-01T00:00:00",
                         purchaseDate: "2026-03-20T00:00:00")
    }

    func testMismatchCopyForEveryKindInVietnamese() {
        L.withLanguage(.vi) {
            XCTAssertEqual(BrandWarrantyRules.mismatchHeadline(mismatch(.STARTS_BEFORE)),
                           "Hãng ghi bảo hành bắt đầu trước ngày mua 47 ngày")
            XCTAssertEqual(BrandWarrantyRules.mismatchHeadline(mismatch(.STARTS_AFTER)),
                           "Hãng ghi bảo hành bắt đầu sau ngày mua 47 ngày")
            XCTAssertEqual(BrandWarrantyRules.mismatchHeadline(mismatch(.ENDED_EARLIER)),
                           "Hãng ghi bảo hành kết thúc sớm hơn mốc bạn đang tính 47 ngày")
            XCTAssertEqual(BrandWarrantyRules.mismatchHeadline(mismatch(.ENDED_LATER)),
                           "Hãng ghi bảo hành kết thúc muộn hơn mốc bạn đang tính 47 ngày")
            XCTAssertEqual(BrandWarrantyRules.mismatchDatesLine(mismatch(.STARTS_BEFORE)),
                           "Hãng ghi: 01/02/2026 · Ngày mua: 20/03/2026")
            // For ENDED_* the contract's `purchaseDate` field carries the app's
            // whole-unit warranty end, not the invoice date.
            XCTAssertEqual(BrandWarrantyRules.mismatchDatesLine(mismatch(.ENDED_EARLIER)),
                           "Hãng ghi: 01/02/2026 · Mốc bạn đang tính: 20/03/2026")
        }
    }

    func testMismatchCopyForEveryKindInEnglishInflectsTheDayCount() {
        L.withLanguage(.en) {
            XCTAssertEqual(BrandWarrantyRules.mismatchHeadline(mismatch(.STARTS_BEFORE)),
                           "The brand says the warranty started 47 days before your purchase date")
            XCTAssertEqual(BrandWarrantyRules.mismatchHeadline(mismatch(.STARTS_BEFORE, days: 1)),
                           "The brand says the warranty started 1 day before your purchase date")
            XCTAssertEqual(BrandWarrantyRules.mismatchHeadline(mismatch(.STARTS_AFTER)),
                           "The brand says the warranty started 47 days after your purchase date")
            XCTAssertEqual(BrandWarrantyRules.mismatchHeadline(mismatch(.ENDED_EARLIER)),
                           "The brand says the warranty ended 47 days earlier than your estimate")
            XCTAssertEqual(BrandWarrantyRules.mismatchHeadline(mismatch(.ENDED_LATER)),
                           "The brand says the warranty ended 47 days later than your estimate")
            XCTAssertEqual(BrandWarrantyRules.mismatchHeadline(mismatch(.ENDED_LATER, days: 1)),
                           "The brand says the warranty ended 1 day later than your estimate")
            XCTAssertEqual(BrandWarrantyRules.mismatchDatesLine(mismatch(.STARTS_BEFORE)),
                           "Brand says: 01/02/2026 · Purchase date: 20/03/2026")
            XCTAssertEqual(BrandWarrantyRules.mismatchDatesLine(mismatch(.ENDED_LATER)),
                           "Brand says: 01/02/2026 · Your estimate: 20/03/2026")
        }
    }

    func testMismatchDatesLineDegradesWhenOneDateIsMissing() {
        let brandOnly = WarrantyMismatch(kind: .STARTS_BEFORE, days: 3,
                                         brandDate: "2026-02-01", purchaseDate: nil)
        let purchaseOnly = WarrantyMismatch(kind: .STARTS_BEFORE, days: 3,
                                            brandDate: nil, purchaseDate: "2026-03-20")
        let neither = WarrantyMismatch(kind: .STARTS_BEFORE, days: 3,
                                       brandDate: nil, purchaseDate: nil)
        L.withLanguage(.en) {
            XCTAssertEqual(BrandWarrantyRules.mismatchDatesLine(brandOnly), "Brand says: 01/02/2026")
            XCTAssertEqual(BrandWarrantyRules.mismatchDatesLine(purchaseOnly),
                           "Purchase date: 20/03/2026")
            XCTAssertNil(BrandWarrantyRules.mismatchDatesLine(neither))
        }
    }

    // MARK: - Mismatch state

    func testNoMismatchWithBrandDatesSaysTheTwoSidesAgree() {
        let fields = BrandWarrantyFields(status: .ACTIVE,
                                         start: "2026-03-20",
                                         end: "2027-03-20",
                                         checkedAt: "2026-03-21T09:30:00Z")
        XCTAssertEqual(BrandWarrantyRules.mismatchState(nil, fields: fields), .agrees)
        L.withLanguage(.en) {
            let state = BrandWarrantyRules.MismatchState.agrees
            XCTAssertEqual(BrandWarrantyRules.stateTitle(state),
                           "The brand's dates and yours agree.")
            XCTAssertEqual(BrandWarrantyRules.stateDetail(state),
                           "The latest check found no difference in the warranty dates.")
        }
    }

    /// `warrantyMismatch == nil` alone is not agreement: a device that was never
    /// checked is a different answer.
    func testNeverCheckedIsNotAgreement() {
        XCTAssertEqual(BrandWarrantyRules.mismatchState(nil, fields: .empty), .notChecked)
        L.withLanguage(.vi) {
            XCTAssertEqual(BrandWarrantyRules.stateTitle(.notChecked), "Chưa đối chiếu với hãng")
            XCTAssertNotNil(BrandWarrantyRules.stateDetail(.notChecked))
        }
    }

    /// A status-only check — NOT_REGISTERED, say — carries no date to compare.
    /// Calling that agreement would be a lie.
    func testStatusOnlyCheckIsNotAgreement() {
        let fields = BrandWarrantyFields(status: .NOT_REGISTERED,
                                         checkedAt: "2026-03-21T09:30:00Z")
        let state = BrandWarrantyRules.mismatchState(nil, fields: fields)
        XCTAssertEqual(state, .statusOnly(status: .NOT_REGISTERED))
        L.withLanguage(.en) {
            XCTAssertEqual(BrandWarrantyRules.stateTitle(state), "Brand has no record of this device")
            XCTAssertEqual(BrandWarrantyRules.stateDetail(state),
                           "The brand has no specific warranty date to compare with your estimate.")
        }
    }

    func testMismatchWinsOverRecordedDates() {
        let fields = BrandWarrantyFields(status: .ACTIVE,
                                         start: "2026-03-20",
                                         end: "2027-03-20")
        let state = BrandWarrantyRules.mismatchState(mismatch(.STARTS_BEFORE), fields: fields)
        guard case .mismatch(let value) = state else {
            return XCTFail("expected mismatch, got \(state)")
        }
        XCTAssertEqual(value.days, 47)
        XCTAssertNil(BrandWarrantyRules.stateTitle(state), "the per-kind headline is the title")
        XCTAssertEqual(BrandWarrantyRules.stateDetail(state),
                       "Hãng ghi: 01/02/2026 · Ngày mua: 20/03/2026")
    }

    func testCopyFollowsTheSelectedLanguageAtRuntime() {
        L.withLanguage(.vi) {
            XCTAssertEqual(BrandWarrantyCopy.mismatchBadge, "Lệch ngày BH")
        }
        L.withLanguage(.en) {
            XCTAssertEqual(BrandWarrantyCopy.mismatchBadge, "Date mismatch")
            XCTAssertEqual(BrandWarrantyStatus.ACTIVE.label, "Brand says it's still covered")
        }
    }

    func testStatusLabelsInBothLanguages() {
        L.withLanguage(.vi) {
            XCTAssertEqual(BrandWarrantyStatus.ACTIVE.label, "Hãng ghi còn bảo hành")
            XCTAssertEqual(BrandWarrantyStatus.EXPIRED.label, "Hãng ghi đã hết hạn")
            XCTAssertEqual(BrandWarrantyStatus.NOT_REGISTERED.label, "Hãng chưa ghi nhận máy này")
            XCTAssertEqual(BrandWarrantyStatus.PRE_ACTIVATED.label, "Máy đã được kích hoạt trước")
            XCTAssertEqual(BrandWarrantyStatus.UNKNOWN.label, "Hãng chưa rõ tình trạng")
        }
        L.withLanguage(.en) {
            XCTAssertEqual(BrandWarrantyStatus.ACTIVE.label, "Brand says it's still covered")
            XCTAssertEqual(BrandWarrantyStatus.EXPIRED.label, "Brand says it's expired")
            XCTAssertEqual(BrandWarrantyStatus.NOT_REGISTERED.label,
                           "Brand has no record of this device")
            XCTAssertEqual(BrandWarrantyStatus.PRE_ACTIVATED.label, "Device was pre-activated")
            XCTAssertEqual(BrandWarrantyStatus.UNKNOWN.label, "Brand status unknown")
        }
    }

    // MARK: - Validation (the server's three rules, mirrored)

    func testStatusIsRequiredWheneverAnotherOneOfTheFiveIsSet() {
        let cases: [(BrandWarrantyFields, Bool)] = [
            (.empty, true),
            (BrandWarrantyFields(status: .NOT_REGISTERED), true),
            (BrandWarrantyFields(start: "2026-02-01"), false),
            (BrandWarrantyFields(end: "2027-02-01"), false),
            (BrandWarrantyFields(checkedAt: "2026-03-21T09:30:00Z"), false),
            (BrandWarrantyFields(lookupUrl: "https://example.vn"), false),
            (BrandWarrantyFields(status: .ACTIVE, start: "2026-02-01"), true),
        ]
        L.withLanguage(.en) {
            for (fields, valid) in cases {
                let errors = BrandWarrantyRules.validationErrors(fields)
                if valid {
                    XCTAssertNil(errors["brandWarrantyStatus"], "\(fields)")
                } else {
                    XCTAssertEqual(errors["brandWarrantyStatus"],
                                   ["The brand warranty status is required when you record a date or a lookup link"],
                                   "\(fields)")
                }
            }
        }
    }

    func testEndMustNotPrecedeStart() {
        let fields = BrandWarrantyFields(status: .ACTIVE,
                                         start: "2026-03-20",
                                         end: "2026-03-01")
        L.withLanguage(.vi) {
            XCTAssertEqual(BrandWarrantyRules.validationErrors(fields)["brandWarrantyEnd"],
                           ["Ngày hết hạn bảo hành hãng không được trước ngày bắt đầu"])
        }
        XCTAssertTrue(BrandWarrantyRules.endPrecedesStart(start: "2026-03-20", end: "2026-03-01"))
        XCTAssertFalse(BrandWarrantyRules.endPrecedesStart(start: "2026-03-01", end: "2026-03-20"))
        XCTAssertFalse(BrandWarrantyRules.endPrecedesStart(start: "2026-03-01", end: "2026-03-01"))
        XCTAssertFalse(BrandWarrantyRules.endPrecedesStart(start: nil, end: "2026-03-01"))

        // Same day and start-only are both valid; an unreadable date is the
        // server's problem, not a client-side rejection of a future wire shape.
        XCTAssertNil(BrandWarrantyRules.validationErrors(
            BrandWarrantyFields(status: .ACTIVE, start: "2026-03-20", end: "2026-03-20")
        )["brandWarrantyEnd"])
        XCTAssertNil(BrandWarrantyRules.validationErrors(
            BrandWarrantyFields(status: .ACTIVE, start: "2026-03-20")
        )["brandWarrantyEnd"])
        XCTAssertNil(BrandWarrantyRules.validationErrors(
            BrandWarrantyFields(status: .ACTIVE, start: "not-a-day", end: "2026-03-20")
        )["brandWarrantyEnd"])
    }

    func testLookupURLMustBeAnAbsoluteHTTPURL() {
        L.withLanguage(.en) {
            XCTAssertEqual(
                BrandWarrantyRules.validationErrors(
                    BrandWarrantyFields(status: .ACTIVE, lookupUrl: "samsung.com")
                )["brandLookupUrl"],
                ["The brand lookup link must be an absolute http/https URL"]
            )
        }
        XCTAssertNil(BrandWarrantyRules.validationErrors(
            BrandWarrantyFields(status: .ACTIVE, lookupUrl: "https://samsung.com")
        )["brandLookupUrl"])
        XCTAssertNil(BrandWarrantyRules.validationErrors(
            BrandWarrantyFields(status: .ACTIVE, lookupUrl: "   ")
        )["brandLookupUrl"])
    }

    func testClearingAllFiveFieldsIsValid() {
        XCTAssertTrue(BrandWarrantyRules.validationErrors(.empty).isEmpty)
        XCTAssertTrue(BrandWarrantyRules.isEmpty(.empty))
        XCTAssertFalse(BrandWarrantyRules.isEmpty(BrandWarrantyFields(status: .UNKNOWN)))
        // The server trims before it validates; whitespace is not a record.
        XCTAssertTrue(BrandWarrantyRules.isEmpty(BrandWarrantyFields(start: "   ",
                                                                     lookupUrl: "\n")))
        XCTAssertFalse(BrandWarrantyFields(start: "   ").hasComparableBrandDate)
        // An end date alone is not a comparison: on a device with no
        // whole-unit warranty the server returns nil meaning "nothing to
        // compare", and claiming agreement there would be a lie.
        XCTAssertFalse(BrandWarrantyFields(end: "2029-01-01").hasComparableBrandDate)
        XCTAssertTrue(BrandWarrantyFields(start: "2026-01-01").hasComparableBrandDate)
    }

    // MARK: - Day arithmetic

    func testSignedDaysBetweenCountsCalendarDays() {
        XCTAssertEqual(BrandWarrantyRules.signedDaysBetween("2026-03-01", "2026-03-08"), 7)
        XCTAssertEqual(BrandWarrantyRules.signedDaysBetween("2026-03-08", "2026-03-01"), -7)
        XCTAssertEqual(BrandWarrantyRules.signedDaysBetween("2026-03-01", "2026-03-01"), 0)
        // A wire timestamp and a bare day mean the same calendar day.
        XCTAssertEqual(BrandWarrantyRules.signedDaysBetween("2026-03-01T23:59:00", "2026-03-08"),
                       7)
        XCTAssertNil(BrandWarrantyRules.signedDaysBetween(nil, "2026-03-08"))
        XCTAssertNil(BrandWarrantyRules.signedDaysBetween("not-a-day", "2026-03-08"))
    }

    /// The difference is between calendar days, so it is independent of the
    /// caller's zone and of DST (a local-time anchor would make these 6 or 8).
    func testDayArithmeticIsUnaffectedByTimeZoneOrDST() {
        // US DST starts 2026-03-08; Europe starts 2026-03-29.
        XCTAssertEqual(BrandWarrantyRules.signedDaysBetween("2026-03-07", "2026-03-09"), 2)
        XCTAssertEqual(BrandWarrantyRules.signedDaysBetween("2026-03-28", "2026-03-30"), 2)
        XCTAssertEqual(BrandWarrantyRules.signedDaysBetween("2026-10-31", "2026-11-02"), 2)
        // The function has no zone parameter at all: a day is a day.
        XCTAssertEqual(BrandWarrantyRules.signedDaysBetween("2026-03-07", "2026-04-07"), 31)
    }

    func testCheckedAtStringIsRFC3339UTC() {
        let date = makeDate("2026-10-19 09:24:20", format: "yyyy-MM-dd HH:mm:ss", timeZone: utc)
        XCTAssertEqual(BrandWarrantyRules.checkedAtString(date), "2026-10-19T09:24:20Z")
    }

    func testCheckedAgoLabelAndDaysSinceChecked() {
        let now = makeDate("2026-03-24 12:00:00", format: "yyyy-MM-dd HH:mm:ss", timeZone: utc)
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = utc

        XCTAssertEqual(BrandWarrantyRules.daysSinceChecked("2026-03-21T09:30:00",
                                                           now: now, calendar: calendar), 3)
        XCTAssertEqual(BrandWarrantyRules.daysSinceChecked("2026-03-24T00:00:00",
                                                           now: now, calendar: calendar), 0)
        XCTAssertEqual(BrandWarrantyRules.daysSinceChecked("2026-03-25T00:00:00",
                                                           now: now, calendar: calendar), -1)
        XCTAssertNil(BrandWarrantyRules.daysSinceChecked(nil, now: now, calendar: calendar))

        L.withLanguage(.en) {
            XCTAssertEqual(BrandWarrantyRules.checkedAgoLabel("2026-03-21T09:30:00",
                                                              now: now, calendar: calendar),
                           "Checked 3 days ago")
            XCTAssertEqual(BrandWarrantyRules.checkedAgoLabel("2026-03-22T09:30:00",
                                                              now: now, calendar: calendar),
                           "Checked 2 days ago")
            XCTAssertEqual(BrandWarrantyRules.checkedAgoLabel("2026-03-24T09:30:00",
                                                              now: now, calendar: calendar),
                           "Checked today")
            // Clock skew is not a negative age.
            XCTAssertEqual(BrandWarrantyRules.checkedAgoLabel("2026-03-26T09:30:00",
                                                              now: now, calendar: calendar),
                           "Checked today")
        }
        L.withLanguage(.vi) {
            XCTAssertEqual(BrandWarrantyRules.checkedAgoLabel("2026-03-21T09:30:00",
                                                              now: now, calendar: calendar),
                           "Đối chiếu 3 ngày trước")
        }
    }

    func testDayLabelReadsTheWireDayWithoutShiftingIt() {
        XCTAssertEqual(BrandWarrantyRules.dayLabel("2026-03-02T23:30:00"), "02/03/2026")
        XCTAssertEqual(BrandWarrantyRules.dayLabel("2026-03-02"), "02/03/2026")
        XCTAssertEqual(BrandWarrantyRules.dayLabel("2026-03-02T23:30:00-07:00"), "02/03/2026")
        XCTAssertNil(BrandWarrantyRules.dayLabel("not-a-day"))
        XCTAssertNil(BrandWarrantyRules.dayLabel(nil))
    }

    func testStatusAndMismatchEncodeThroughCodable() throws {
        let status = try APIClient.decoder.decode(BrandWarrantyStatus.self,
                                                  from: Data(#""PRE_ACTIVATED""#.utf8))
        XCTAssertEqual(status, .PRE_ACTIVATED)
        let encoded = try APIClient.encoder.encode(status)
        XCTAssertEqual(String(decoding: encoded, as: UTF8.self), #""PRE_ACTIVATED""#)

        let mismatch = mismatch(.STARTS_BEFORE)
        let decoded = try APIClient.decoder.decode(WarrantyMismatch.self,
                                                   from: APIClient.encoder.encode(mismatch))
        XCTAssertEqual(decoded, mismatch)
    }
}
