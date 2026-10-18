import Foundation
import XCTest
@testable import WarrlyKit

/// Warranty activation and the extended-cover deadline (Feature A) — the pure
/// half, plus the proof at the wire level.
///
/// The contract the API is being built against:
///
///  * `activationRequired` — boolean, default `false`;
///  * `activatedAt` — date-time, nullable, and **may be earlier than
///    `purchaseDate`** (a shop can pre-activate); iOS must not block it;
///  * `extendedCoverBuyBy` — date-time, nullable, the last day extended cover
///    can be bought.
///
/// `PATCH /api/v1/devices/{id}` replaces the whole device, so every save path —
/// the form and the status-only PATCH on the detail screen — has to send the
/// three values back. A helper test alone is not enough; the wire tests below
/// assert on the literal JSON body.
final class WarrantyActivationTests: KitTestCase {

    private func deviceJSON(activationRequired: String = "false",
                            activatedAt: String = "null",
                            extendedCoverBuyBy: String = "null",
                            purchaseDate: String = "2026-03-01T00:00:00") -> String {
        """
        {
          "id": "dev_1", "name": "iPhone 16", "category": "PHONE",
          "purchaseDate": "\(purchaseDate)", "purchasePrice": 30000000,
          "status": "ACTIVE",
          "activationRequired": \(activationRequired),
          "activatedAt": \(activatedAt),
          "extendedCoverBuyBy": \(extendedCoverBuyBy)
        }
        """
    }

    private func device(_ json: String) throws -> Device {
        try APIClient.decoder.decode(Device.self, from: Data(json.utf8))
    }

    private func encodedObject<T: Encodable>(_ value: T) throws -> [String: Any] {
        let data = try APIClient.encoder.encode(value)
        let object = try JSONSerialization.jsonObject(with: data)
        return try XCTUnwrap(object as? [String: Any])
    }

    // MARK: - Decoding

    func testDeviceDecodesTheThreeActivationFields() throws {
        let stored = try device(deviceJSON(
            activationRequired: "true",
            activatedAt: #""2026-03-02T00:00:00Z""#,
            extendedCoverBuyBy: #""2026-04-30T00:00:00Z""#
        ))

        XCTAssertEqual(stored.activationRequired, true)
        XCTAssertTrue(stored.isActivationRequired)
        XCTAssertEqual(stored.activatedAt, "2026-03-02T00:00:00Z")
        XCTAssertEqual(stored.extendedCoverBuyBy, "2026-04-30T00:00:00Z")
    }

    /// An older payload, or a server that has not shipped the fields yet, still
    /// decodes; an absent `activationRequired` means the documented default false.
    func testDeviceDecodesMissingActivationFieldsAsNotRequired() throws {
        let json = """
        {"id": "dev_2", "name": "Chuột", "category": "ACCESSORY",
         "purchaseDate": "2024-05-05T00:00:00", "purchasePrice": 200000, "status": "ACTIVE"}
        """
        let stored = try device(json)

        XCTAssertNil(stored.activationRequired)
        XCTAssertFalse(stored.isActivationRequired)
        XCTAssertNil(stored.activatedAt)
        XCTAssertNil(stored.extendedCoverBuyBy)
        XCTAssertEqual(WarrantyActivation.carried(from: stored), .none)
    }

    func testDetailBodyCarriesTheSameThreeFields() throws {
        let detail = try APIClient.decoder.decode(
            DeviceDetail.self,
            from: Data("""
            {"device": \(deviceJSON(activationRequired: "true",
                                    activatedAt: #""2026-03-02T00:00:00Z""#,
                                    extendedCoverBuyBy: #""2026-04-30T00:00:00Z""#))}
            """.utf8)
        )

        XCTAssertTrue(detail.device.isActivationRequired)
        XCTAssertEqual(detail.device.activatedAt, "2026-03-02T00:00:00Z")
        XCTAssertEqual(detail.device.extendedCoverBuyBy, "2026-04-30T00:00:00Z")
    }

    // MARK: - Wire → request

    func testCarriedReducesBothDatesToTheirCalendarDay() {
        let fields = WarrantyActivation.carried(
            activationRequired: true,
            activatedAt: "2026-03-02T23:30:00Z",
            extendedCoverBuyBy: "2026-04-30T00:00:00"
        )

        XCTAssertEqual(fields, ActivationFields(
            activationRequired: true,
            activatedAt: "2026-03-02",
            extendedCoverBuyBy: "2026-04-30"
        ))
    }

    func testCarriedNeverInventsADateFromUnreadableInput() {
        XCTAssertEqual(WarrantyActivation.carried(
            activationRequired: false,
            activatedAt: "không phải ngày",
            extendedCoverBuyBy: "01/03/2026"
        ), .none)
    }

    /// The explicit product rule: a shop can pre-activate, so an activation date
    /// before the invoice date is valid and must travel through untouched.
    func testActivationBeforePurchaseDateIsAllowed() throws {
        let stored = try device(deviceJSON(
            activationRequired: "false",
            activatedAt: #""2026-03-01T00:00:00Z""#,
            purchaseDate: "2026-03-10T00:00:00"
        ))
        let fields = WarrantyActivation.carried(from: stored)

        XCTAssertEqual(fields.activatedAt, "2026-03-01")
        XCTAssertEqual(WarrantyActivation.state(fields), .activated(on: "2026-03-01"))

        var input = DeviceInput(name: stored.name, category: stored.category,
                                purchaseDate: "2026-03-10")
        WarrantyActivation.apply(fields, to: &input)

        XCTAssertEqual(input.activatedAt, "2026-03-01",
                       "the API allows pre-activation; iOS must not flatten it")
    }

    // MARK: - Derived state

    func testRequiredAndNotActivatedIsItsOwnState() {
        let fields = ActivationFields(activationRequired: true,
                                      activatedAt: nil,
                                      extendedCoverBuyBy: nil)

        XCTAssertEqual(WarrantyActivation.state(fields), .requiredNotActivated)
        L.withLanguage(.vi) {
            XCTAssertEqual(WarrantyActivation.statusLabel(fields), "Chưa kích hoạt")
        }
        L.withLanguage(.en) {
            XCTAssertEqual(WarrantyActivation.statusLabel(fields), "Not activated")
        }
        XCTAssertTrue(WarrantyActivation.isVisible(fields))
    }

    func testActivatedDateWinsOverTheFlag() {
        let fields = ActivationFields(activationRequired: false,
                                      activatedAt: "2026-03-02T00:00:00Z",
                                      extendedCoverBuyBy: nil)

        XCTAssertEqual(WarrantyActivation.state(fields), .activated(on: "2026-03-02"))
        L.withLanguage(.vi) {
            XCTAssertEqual(WarrantyActivation.statusLabel(fields),
                           "Đã kích hoạt ngày 02/03/2026")
        }
        L.withLanguage(.en) {
            XCTAssertEqual(WarrantyActivation.statusLabel(fields),
                           "Activated on 02/03/2026")
        }
    }

    func testNotRequiredHasNoStatusRow() {
        let fields = ActivationFields(activationRequired: false,
                                      activatedAt: nil,
                                      extendedCoverBuyBy: nil)

        XCTAssertEqual(WarrantyActivation.state(fields), .notRequired)
        XCTAssertNil(WarrantyActivation.statusLabel(fields))
        XCTAssertFalse(WarrantyActivation.isVisible(fields))
    }

    func testBuyByDateAloneStillMakesTheSectionVisible() {
        let fields = ActivationFields(activationRequired: false,
                                      activatedAt: nil,
                                      extendedCoverBuyBy: "2026-04-30")

        XCTAssertEqual(WarrantyActivation.state(fields), .notRequired)
        XCTAssertNil(WarrantyActivation.statusLabel(fields))
        XCTAssertTrue(WarrantyActivation.isVisible(fields))
    }

    // MARK: - Buy-by countdown

    private let extremeZones = ["Pacific/Midway", "America/Los_Angeles", "UTC",
                                "Asia/Ho_Chi_Minh", "Asia/Tokyo", "Pacific/Kiritimati"]

    /// The countdown is the number the user decides on, so it is pinned in every
    /// zone rather than only where the test machine runs. `0` is "today is the
    /// last day"; a negative value is a closed window.
    func testBuyByCountdownUsesCalendarDaysInEveryZone() throws {
        for id in extremeZones {
            let tz = try XCTUnwrap(TimeZone(identifier: id), "unknown zone \(id)")
            var calendar = Calendar(identifier: .gregorian)
            calendar.timeZone = tz
            let now = makeDate("2026-04-10 09:00:00",
                               format: "yyyy-MM-dd HH:mm:ss", timeZone: tz)

            XCTAssertEqual(WarrantyActivation.buyByDaysLeft(
                "2026-04-13T00:00:00", now: now, calendar: calendar), 3,
                "three days out read wrong for a device in \(id)")
            XCTAssertEqual(WarrantyActivation.buyByDaysLeft(
                "2026-04-10T00:00:00", now: now, calendar: calendar), 0,
                "the last day must be 0, not 1, in \(id)")
            XCTAssertEqual(WarrantyActivation.buyByDaysLeft(
                "2026-04-01T00:00:00", now: now, calendar: calendar), -9,
                "a closed window read wrong for a device in \(id)")
            XCTAssertNil(WarrantyActivation.buyByDaysLeft(nil, now: now, calendar: calendar))
        }
    }

    func testBuyByNoteUsesTheExistingDayResolutionCopy() throws {
        let tz = try XCTUnwrap(TimeZone(identifier: "Asia/Ho_Chi_Minh"))
        let now = makeDate("2026-04-10 09:00:00",
                           format: "yyyy-MM-dd HH:mm:ss", timeZone: tz)
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = tz

        L.withLanguage(.vi) {
            XCTAssertEqual(WarrantyActivation.buyByNote(
                "2026-04-13T00:00:00", now: now, calendar: calendar), "còn 3 ngày")
            XCTAssertEqual(WarrantyActivation.buyByNote(
                "2026-04-10T00:00:00", now: now, calendar: calendar), "hôm nay là ngày cuối")
            XCTAssertEqual(WarrantyActivation.buyByNote(
                "2026-04-01T00:00:00", now: now, calendar: calendar), "đã qua 9 ngày")
        }
        L.withLanguage(.en) {
            XCTAssertEqual(WarrantyActivation.buyByNote(
                "2026-04-13T00:00:00", now: now, calendar: calendar), "3 days left")
        }
        XCTAssertNil(WarrantyActivation.buyByNote(nil, now: now, calendar: calendar))
    }

    // MARK: - The proof at the wire level

    func testCreateBodyLiterallyCarriesTheThreeFields() async throws {
        let json = deviceJSON(
            activationRequired: "true",
            activatedAt: #""2026-03-02T00:00:00Z""#,
            extendedCoverBuyBy: #""2026-04-30T00:00:00Z""#
        )
        StubURLProtocol.install(.json("""
        {"device": \(json), "warnings": []}
        """))
        let client = makeStubbedClient(token: "tok_abc")
        let stored = try device(json)

        var input = DeviceInput(name: stored.name, category: stored.category,
                                purchaseDate: "2026-03-01")
        WarrantyActivation.apply(WarrantyActivation.carried(from: stored), to: &input)
        _ = try await client.createDevice(input)

        let request = try XCTUnwrap(StubURLProtocol.lastRequest)
        XCTAssertEqual(request.httpMethod, "POST")
        let body = try request.jsonBody()
        XCTAssertEqual(body["activationRequired"] as? Bool, true)
        XCTAssertEqual(body["activatedAt"] as? String, "2026-03-02")
        XCTAssertEqual(body["extendedCoverBuyBy"] as? String, "2026-04-30")
    }

    func testUpdateBodyLiterallyCarriesTheThreeFields() async throws {
        let json = deviceJSON(
            activationRequired: "true",
            activatedAt: #""2026-03-02T00:00:00Z""#,
            extendedCoverBuyBy: #""2026-04-30T00:00:00Z""#
        )
        StubURLProtocol.install(.json("""
        {"device": \(json), "warnings": []}
        """))
        let client = makeStubbedClient(token: "tok_abc")
        let stored = try device(json)

        var input = DeviceInput(name: stored.name, category: stored.category,
                                purchaseDate: "2026-03-01")
        WarrantyActivation.apply(WarrantyActivation.carried(from: stored), to: &input)
        _ = try await client.updateDevice(id: "dev_1", input)

        let request = try XCTUnwrap(StubURLProtocol.lastRequest)
        XCTAssertEqual(request.httpMethod, "PATCH")
        let raw = try XCTUnwrap(String(data: request.capturedBody, encoding: .utf8))
        XCTAssertTrue(raw.contains(#""activationRequired":true"#), raw)
        XCTAssertTrue(raw.contains(#""activatedAt":"2026-03-02""#), raw)
        XCTAssertTrue(raw.contains(#""extendedCoverBuyBy":"2026-04-30""#), raw)

        let body = try request.jsonBody()
        XCTAssertEqual(body["activationRequired"] as? Bool, true)
        XCTAssertEqual(body["activatedAt"] as? String, "2026-03-02")
        XCTAssertEqual(body["extendedCoverBuyBy"] as? String, "2026-04-30")
    }

    /// Nothing recorded sends `activationRequired: false` and omits both dates.
    /// On a full-replacement PATCH an omitted date is the documented "clear it";
    /// on create it is the server's null default — no value is invented either way.
    func testBodySendsFalseAndOmitsUnsetDates() async throws {
        let json = deviceJSON()
        StubURLProtocol.install(.json("""
        {"device": \(json), "warnings": []}
        """))
        let client = makeStubbedClient(token: "tok_abc")
        let stored = try device(json)

        var input = DeviceInput(name: stored.name, category: stored.category,
                                purchaseDate: "2026-03-01")
        WarrantyActivation.apply(WarrantyActivation.carried(from: stored), to: &input)
        _ = try await client.updateDevice(id: "dev_1", input)

        let body = try XCTUnwrap(StubURLProtocol.lastRequest).jsonBody()
        XCTAssertEqual(body["activationRequired"] as? Bool, false)
        XCTAssertNil(body["activatedAt"])
        XCTAssertNil(body["extendedCoverBuyBy"])
    }

    /// The status-only PATCH on the detail screen is still a full replacement.
    /// Tapping "Đã bán" must not erase an activation recorded elsewhere.
    func testCarryBackSaveKeepsTheStoredActivationFields() throws {
        let stored = try device(deviceJSON(
            activationRequired: "true",
            activatedAt: #""2026-03-02T00:00:00Z""#,
            extendedCoverBuyBy: #""2026-04-30T00:00:00Z""#
        ))

        var input = DeviceInput(name: stored.name, category: stored.category,
                                purchaseDate: "2026-03-01")
        input.status = .SOLD
        WarrantyActivation.apply(WarrantyActivation.carried(from: stored), to: &input)

        let payload = try encodedObject(input)
        XCTAssertEqual(payload["activationRequired"] as? Bool, true)
        XCTAssertEqual(payload["activatedAt"] as? String, "2026-03-02")
        XCTAssertEqual(payload["extendedCoverBuyBy"] as? String, "2026-04-30")
    }
}
