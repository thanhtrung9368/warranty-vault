import Foundation
import XCTest
@testable import WarrantyVaultKit

/// Device resale (`soldAt` / `soldPrice`, migration 0006) — the pure half, plus
/// the proof at the wire level.
///
/// `PATCH /api/v1/devices/{id}` replaces the whole device. The web and Android
/// clients record sales, so an iOS save that does not send the pair back
/// **erases** one — a device sold on the web, status-tapped on iOS, came back
/// unsold. Both iOS save paths (the device form, and the status-only PATCH on the
/// detail screen) now carry the pair.
///
/// The last group of tests builds the very `DeviceInput` those two paths build
/// and asserts on the **literal JSON body on the wire**. A mapping-helper test is
/// not enough here: a key an `Optional` drops on the way to `JSONEncoder` is
/// exactly how the sale disappears.
final class DeviceResaleTests: KitTestCase {

    /// A device as the API returns it. `soldAt` is the shape the server really
    /// emits — `pgtype.Timestamp` marshals Z-less (`"2026-03-02T00:00:00"`), with
    /// no `Z` and no offset.
    private func deviceJSON(soldAt: String = #""2026-03-02T00:00:00""#,
                            soldPrice: String = "25000000") -> String {
        """
        {
          "id": "dev_1", "name": "iPhone 16", "category": "PHONE",
          "purchaseDate": "2026-03-01T00:00:00", "purchasePrice": 30000000,
          "status": "SOLD",
          "soldAt": \(soldAt),
          "soldPrice": \(soldPrice)
        }
        """
    }

    private func device(soldAt: String?, soldPrice: Int?) -> Device {
        let json = """
        {
          "id": "dev_1", "name": "iPhone 16", "category": "PHONE",
          "purchaseDate": "2026-03-01T00:00:00", "purchasePrice": 30000000,
          "status": "SOLD",
          "soldAt": \(soldAt.map { "\"\($0)\"" } ?? "null"),
          "soldPrice": \(soldPrice.map(String.init) ?? "null")
        }
        """
        return try! APIClient.decoder.decode(Device.self, from: Data(json.utf8))
    }

    /// Mirrors `DeviceFormView.submit` — the whole mapping, date step included:
    /// the form seeds itself from the loaded device (the pair through `carried`),
    /// puts the day into a date picker (`dayDate`), and writes it back through the
    /// same `pairErrors`/`apply` pair the save button uses.
    ///
    /// `timeZone` stands in for the device's zone, because that is what the picker
    /// draws its `Date` in — a save must produce the same calendar day in every
    /// one of them.
    private func formSave(_ stored: Device, in timeZone: TimeZone = .current) -> DeviceInput {
        let sale = DeviceResale.carried(from: stored)
        let recording = DeviceResale.hasSaleRecorded(sale)
        // What the picker holds, and what it hands back.
        let pickerDate = DeviceResale.dayDate(sale.soldAt, in: timeZone) ?? Date()
        let fields = ResaleFields(
            soldAt: recording ? DeviceResale.dayString(pickerDate, in: timeZone) : nil,
            soldPrice: recording ? sale.soldPrice : nil
        )

        var input = DeviceInput(name: stored.name,
                                category: stored.category,
                                purchaseDate: "2026-03-01")
        XCTAssertTrue(DeviceResale.pairErrors(fields, recording: recording).isEmpty,
                      "the form's own output must satisfy the server's pair rule")
        DeviceResale.apply(fields, to: &input)
        return input
    }

    /// The zones that break an instant-based or Vietnam-pinned date: far west and
    /// far east of the one the server's naive-UTC day is anchored in.
    private let extremeZones = ["Pacific/Midway", "America/Los_Angeles", "UTC",
                                "Asia/Ho_Chi_Minh", "Asia/Tokyo", "Pacific/Kiritimati"]

    /// Mirrors `DeviceDetailView.saveStatus`: every field of the loaded row is
    /// re-sent with only `status` changed.
    private func statusOnlyInput(_ stored: Device, status: DeviceStatus) -> DeviceInput {
        var input = DeviceInput(name: stored.name,
                                category: stored.category,
                                purchaseDate: "2026-03-01")
        input.brand = stored.brand
        input.model = stored.model
        input.serialNumber = stored.serialNumber
        input.purchasePlace = stored.purchasePlace
        input.purchasePrice = stored.purchasePrice
        input.status = status
        input.notes = stored.notes
        DeviceReturnWindow.apply(DeviceReturnWindow.carried(from: stored), to: &input)
        DeviceResale.apply(DeviceResale.carried(from: stored), to: &input)
        return input
    }

    /// The canned `{device, warnings}` a PATCH answers with.
    private func saveResponse(soldAt: String = #""2026-03-02T00:00:00""#,
                              soldPrice: String = "25000000") -> String {
        """
        {"device": \(deviceJSON(soldAt: soldAt, soldPrice: soldPrice)), "warnings": []}
        """
    }

    // MARK: - Decoding

    func testDeviceDecodesTheResalePairFromAListPayload() throws {
        let stored = try APIClient.decoder.decode(Device.self, from: Data(deviceJSON().utf8))

        XCTAssertEqual(stored.soldAt, "2026-03-02T00:00:00")
        XCTAssertEqual(stored.soldPrice, 25_000_000)
        XCTAssertEqual(DeviceResale.carried(from: stored),
                       ResaleFields(soldAt: "2026-03-02", soldPrice: 25_000_000))
    }

    /// A server that predates 0006, or an unsold device, decodes as "chưa bán" —
    /// never as a zero price.
    func testDeviceDecodesMissingResaleFieldsAsNoSale() throws {
        let json = """
        {"id": "dev_2", "name": "Chuột", "category": "ACCESSORY",
         "purchaseDate": "2024-05-05T00:00:00", "purchasePrice": 200000, "status": "ACTIVE"}
        """
        let stored = try APIClient.decoder.decode(Device.self, from: Data(json.utf8))

        XCTAssertNil(stored.soldAt)
        XCTAssertNil(stored.soldPrice)
        XCTAssertFalse(DeviceResale.hasSaleRecorded(DeviceResale.carried(from: stored)))
        XCTAssertFalse(DeviceResale.isGiveAway(stored.soldPrice))
    }

    func testDetailBodyCarriesTheSamePair() throws {
        let detail = try APIClient.decoder.decode(DeviceDetail.self,
                                                  from: Data("{\"device\": \(deviceJSON())}".utf8))

        XCTAssertEqual(detail.device.soldAt, "2026-03-02T00:00:00")
        XCTAssertEqual(detail.device.soldPrice, 25_000_000)
        XCTAssertEqual(DeviceResale.carried(from: detail.device),
                       ResaleFields(soldAt: "2026-03-02", soldPrice: 25_000_000))
    }

    // MARK: - Wire → request

    /// `0` is a give-away, not an absence: it must survive as `0`.
    func testCarriedKeepsGiveAwayZeroDistinctFromNoSale() {
        XCTAssertEqual(DeviceResale.carried(soldAt: "2026-03-02T00:00:00", soldPrice: 0),
                       ResaleFields(soldAt: "2026-03-02", soldPrice: 0))
        XCTAssertEqual(DeviceResale.carried(soldAt: nil, soldPrice: nil), .none)
        XCTAssertTrue(DeviceResale.isGiveAway(0))
        XCTAssertFalse(DeviceResale.isGiveAway(nil))
        XCTAssertFalse(DeviceResale.isGiveAway(1_000))
        XCTAssertTrue(DeviceResale.hasSaleRecorded(ResaleFields(soldAt: "2026-03-02", soldPrice: 0)))
    }

    /// Only the calendar day is read, off the string, in every shape the server
    /// has emitted — an instant-based parse would move the day in a negative
    /// offset zone.
    func testSoldAtIsReducedToItsCalendarDayWithoutAnInstantParse() {
        let shapes = [
            "2026-03-02T00:00:00",       // what store.Device really marshals
            "2026-03-02T23:30:00",
            "2026-03-02T00:00:00Z",      // RFC3339, if a client ever sees one
            "2026-03-02T00:00:00+07:00",
            "2026-03-02",
        ]
        for wire in shapes {
            XCTAssertEqual(DeviceResale.carried(soldAt: wire, soldPrice: 25_000_000).soldAt,
                           "2026-03-02", "wrong day for \(wire)")
        }
        XCTAssertNil(DeviceResale.carried(soldAt: "   ", soldPrice: nil).soldAt)
        // An unreadable day is never invented, and cannot drag a dangling price
        // into a half-filled pair that Go would answer with a 400.
        XCTAssertEqual(DeviceResale.carried(soldAt: "không phải ngày", soldPrice: 25_000_000), .none)
        XCTAssertEqual(DeviceResale.carried(soldAt: "01/03/2026", soldPrice: 25_000_000), .none)
    }

    func testRoundTripPreservesBothHalves() {
        let input = formSave(device(soldAt: "2026-03-02T00:00:00", soldPrice: 25_000_000))

        XCTAssertEqual(input.soldAt, "2026-03-02")
        XCTAssertEqual(input.soldPrice, 25_000_000)
    }

    func testRoundTripPreservesTheGiveAwayZero() {
        let input = formSave(device(soldAt: "2026-03-02T00:00:00", soldPrice: 0))

        XCTAssertEqual(input.soldPrice, 0, "0₫ is a recorded give-away, not an absence")
        XCTAssertEqual(input.soldAt, "2026-03-02")
    }

    func testRoundTripLeavesAnUnsoldDeviceUnsold() {
        let input = formSave(device(soldAt: nil, soldPrice: nil))

        XCTAssertNil(input.soldAt)
        XCTAssertNil(input.soldPrice)
    }

    /// The date picker's `Date` is drawn in the device's own zone, so the day it
    /// holds and the day written back have to be one and the same *there* — in
    /// Midway (UTC−11) as much as in Kiritimati (UTC+14). A Vietnam-pinned parse
    /// puts the 2nd on the 1st for anyone west of UTC+7; an instant parse of the
    /// wire value does it for anyone east.
    func testPickerDayRoundTripsExactlyInEveryDeviceZone() throws {
        for id in extremeZones {
            let zone = try XCTUnwrap(TimeZone(identifier: id))
            let date = try XCTUnwrap(DeviceResale.dayDate("2026-03-02T00:00:00", in: zone),
                                     "no picker date in \(id)")
            XCTAssertEqual(DeviceResale.dayString(date, in: zone), "2026-03-02",
                           "the calendar day drifted for a device in \(id)")
        }
        XCTAssertNil(DeviceResale.dayDate(nil, in: .current))
        XCTAssertNil(DeviceResale.dayDate("không phải ngày", in: .current))
    }

    /// The zone above is not decoration: the same stored day is a different
    /// instant in each zone, which is exactly why it must be read — and written
    /// back — in the zone the picker draws in rather than in a hardcoded one.
    func testTheStoredDayIsReadInTheGivenZoneAndNotInAHardcodedOne() throws {
        let utc = try XCTUnwrap(TimeZone(identifier: "UTC"))
        let losAngeles = try XCTUnwrap(TimeZone(identifier: "America/Los_Angeles"))

        let midnightUTC = try XCTUnwrap(DeviceResale.dayDate("2026-03-02T00:00:00", in: utc))
        let midnightLA = try XCTUnwrap(DeviceResale.dayDate("2026-03-02T00:00:00", in: losAngeles))

        XCTAssertNotEqual(midnightUTC, midnightLA, "the zone parameter must be honoured")
        // Midnight UTC on the 2nd is still the 1st west of it — which is why the
        // wire day must never be parsed as an instant.
        XCTAssertEqual(DeviceResale.dayString(midnightUTC, in: losAngeles), "2026-03-01")
        // Read in the zone it is drawn in, the stored day is the stored day.
        XCTAssertEqual(DeviceResale.dayString(midnightLA, in: losAngeles), "2026-03-02")
        XCTAssertEqual(DeviceResale.dayString(midnightUTC, in: utc), "2026-03-02")
    }

    // MARK: - The pair rule, in the server's own words

    func testPairErrorsUseTheServersOwnVietnameseCopy() {
        // The exact strings services.ValidateDeviceInput writes into fieldErrors.
        XCTAssertEqual(DeviceResale.soldAtRequiredMessage, "Thiếu ngày bán")
        XCTAssertEqual(DeviceResale.soldPriceRequiredMessage, "Thiếu giá bán")
        XCTAssertEqual(DeviceResale.soldPriceInvalidMessage, "Giá bán không hợp lệ")

        XCTAssertEqual(DeviceResale.pairErrors(ResaleFields(soldAt: nil, soldPrice: 25_000_000)),
                       ["soldAt": ["Thiếu ngày bán"]])
        XCTAssertEqual(DeviceResale.pairErrors(ResaleFields(soldAt: "2026-03-02", soldPrice: nil)),
                       ["soldPrice": ["Thiếu giá bán"]])
        XCTAssertEqual(DeviceResale.pairErrors(ResaleFields(soldAt: "2026-03-02", soldPrice: -1)),
                       ["soldPrice": ["Giá bán không hợp lệ"]])
    }

    /// A half-filled pair is refused *before* it reaches the wire, and the switch
    /// being on means "both blanks" is a half too.
    func testPairErrorsRefuseAHalfFilledPairAndAnEmptyRecording() {
        XCTAssertEqual(DeviceResale.pairErrors(ResaleFields(soldAt: nil, soldPrice: 25_000_000)),
                       ["soldAt": ["Thiếu ngày bán"]])
        XCTAssertEqual(DeviceResale.pairErrors(ResaleFields(soldAt: "2026-03-02", soldPrice: nil)),
                       ["soldPrice": ["Thiếu giá bán"]])
        // "Ghi nhận đã bán" is on but nothing was filled in: the date is what is
        // missing, and that is what the user is told.
        XCTAssertEqual(DeviceResale.pairErrors(.none, recording: true),
                       ["soldAt": ["Thiếu ngày bán"]])
        // Switch off ⇒ nothing to record, so nothing to complain about.
        XCTAssertTrue(DeviceResale.pairErrors(.none, recording: false).isEmpty)
    }

    func testPairErrorsAcceptACompleteSaleAnAbsentOneAndAGiveAway() {
        XCTAssertTrue(DeviceResale.pairErrors(ResaleFields(soldAt: "2026-03-02", soldPrice: 25_000_000)).isEmpty)
        XCTAssertTrue(DeviceResale.pairErrors(.none, recording: false).isEmpty)
        XCTAssertTrue(DeviceResale.pairErrors(ResaleFields(soldAt: "2026-03-02", soldPrice: 0)).isEmpty)
        XCTAssertTrue(DeviceResale.pairErrors(ResaleFields(soldAt: "2026-03-02", soldPrice: 30_000_000)).isEmpty)
    }

    // MARK: - The proof at the wire level

    /// The form's save path. A naive client sent neither key and Go read `nil`
    /// for both, erasing the sale.
    func testPatchBodyLiterallyCarriesBothKeys() async throws {
        StubURLProtocol.install(.json(saveResponse()))
        let client = makeStubbedClient(token: "tok_abc")

        _ = try await client.updateDevice(
            id: "dev_1",
            formSave(try APIClient.decoder.decode(Device.self, from: Data(deviceJSON().utf8)))
        )

        let request = try XCTUnwrap(StubURLProtocol.lastRequest)
        XCTAssertEqual(request.httpMethod, "PATCH")
        XCTAssertTrue(request.url?.path.hasSuffix("/api/v1/devices/dev_1") == true)
        let raw = try XCTUnwrap(String(data: request.capturedBody, encoding: .utf8))
        XCTAssertTrue(raw.contains(#""soldAt":"2026-03-02""#), "soldAt missing from \(raw)")
        XCTAssertTrue(raw.contains(#""soldPrice":25000000"#), "soldPrice missing from \(raw)")

        let body = try request.jsonBody()
        XCTAssertEqual(body["soldAt"] as? String, "2026-03-02")
        XCTAssertEqual(body["soldPrice"] as? Int, 25_000_000)
    }

    /// The same day, on the wire, from every device zone the picker could be
    /// drawn in. The stored `soldAt` is a naive-UTC string and the picker's `Date`
    /// is zoned, so this is where an instant parse would show up as a one-day slip.
    func testPatchBodyCarriesTheSameDayFromEveryDeviceZone() async throws {
        let stored = try APIClient.decoder.decode(Device.self, from: Data(deviceJSON().utf8))

        for id in extremeZones {
            StubURLProtocol.reset()
            StubURLProtocol.install(.json(saveResponse()))
            let client = makeStubbedClient(token: "tok_abc")
            let zone = try XCTUnwrap(TimeZone(identifier: id))

            _ = try await client.updateDevice(id: "dev_1", formSave(stored, in: zone))

            let request = try XCTUnwrap(StubURLProtocol.lastRequest)
            let raw = try XCTUnwrap(String(data: request.capturedBody, encoding: .utf8))
            XCTAssertTrue(raw.contains(#""soldAt":"2026-03-02""#),
                          "the calendar day slipped for a device in \(id): \(raw)")
            XCTAssertTrue(raw.contains(#""soldPrice":25000000"#),
                          "the price went missing for a device in \(id): \(raw)")
        }
    }

    /// A give-away is `0`, and `0` must be on the wire — not dropped by a
    /// truthiness check and not turned into `null`.
    func testPatchBodyCarriesZeroRatherThanDroppingIt() async throws {
        StubURLProtocol.install(.json(saveResponse(soldPrice: "0")))
        let client = makeStubbedClient(token: "tok_abc")
        let stored = try APIClient.decoder.decode(
            Device.self, from: Data(deviceJSON(soldPrice: "0").utf8)
        )

        _ = try await client.updateDevice(id: "dev_1", formSave(stored))

        let request = try XCTUnwrap(StubURLProtocol.lastRequest)
        let raw = try XCTUnwrap(String(data: request.capturedBody, encoding: .utf8))
        XCTAssertTrue(raw.contains(#""soldPrice":0"#), "the give-away was dropped: \(raw)")
        let body = try request.jsonBody()
        XCTAssertEqual(body["soldPrice"] as? Int, 0)
        XCTAssertEqual(body["soldAt"] as? String, "2026-03-02")
    }

    /// And nothing recorded invents nothing: both keys stay out of the JSON,
    /// which is the same `nil` the server already holds.
    func testPatchBodyOmitsBothKeysWhenNoSaleWasRecorded() async throws {
        StubURLProtocol.install(.json("""
        {"device": {"id": "dev_1", "name": "iPhone 16", "category": "PHONE",
                    "purchaseDate": "2026-03-01T00:00:00", "purchasePrice": 30000000,
                    "status": "ACTIVE"}, "warnings": []}
        """))
        let client = makeStubbedClient(token: "tok_abc")

        _ = try await client.updateDevice(
            id: "dev_1",
            formSave(device(soldAt: nil, soldPrice: nil))
        )

        let request = try XCTUnwrap(StubURLProtocol.lastRequest)
        let raw = try XCTUnwrap(String(data: request.capturedBody, encoding: .utf8))
        XCTAssertFalse(raw.contains("soldAt"), "nothing was recorded, so no value may be invented: \(raw)")
        XCTAssertFalse(raw.contains("soldPrice"))
    }

    /// The form's own output can never violate the server's pair rule — for each
    /// state the switch can be in. This is what keeps a locally-cleared sale from
    /// arriving as half a sale, i.e. a 400 the user cannot act on.
    func testFormOutputNeverViolatesThePairRule() async throws {
        let states: [(name: String, stored: Device)] = [
            ("no sale", device(soldAt: nil, soldPrice: nil)),
            ("give-away", device(soldAt: "2026-03-02T00:00:00", soldPrice: 0)),
            ("sold", device(soldAt: "2026-03-02T00:00:00", soldPrice: 25_000_000)),
        ]
        let hasBothOrNeither: ([String: Any]) -> Bool = { body in
            (body["soldAt"] == nil) == (body["soldPrice"] == nil)
        }

        for state in states {
            StubURLProtocol.reset()
            StubURLProtocol.install(.json(saveResponse(soldAt: "null", soldPrice: "null")))
            let client = makeStubbedClient(token: "tok_abc")

            _ = try await client.updateDevice(id: "dev_1", formSave(state.stored))

            let request = try XCTUnwrap(StubURLProtocol.lastRequest)
            let body = try request.jsonBody()
            XCTAssertTrue(hasBothOrNeither(body), "\(state.name) sent half a pair: \(body)")
        }
    }

    /// The status-only PATCH — the *other* path that was destroying sales. Tapping
    /// "Đã bán" must not cost the user the figures they recorded elsewhere.
    func testStatusOnlyPatchPreservesTheSale() async throws {
        StubURLProtocol.install(.json(saveResponse()))
        let client = makeStubbedClient(token: "tok_abc")
        let stored = try APIClient.decoder.decode(Device.self, from: Data(deviceJSON().utf8))

        let result = try await client.updateDevice(
            id: "dev_1",
            statusOnlyInput(stored, status: .BROKEN)   // a status the row did not have
        )

        let request = try XCTUnwrap(StubURLProtocol.lastRequest)
        let raw = try XCTUnwrap(String(data: request.capturedBody, encoding: .utf8))
        XCTAssertTrue(raw.contains(#""status":"BROKEN""#), "the status itself must still change: \(raw)")
        XCTAssertTrue(raw.contains(#""soldAt":"2026-03-02""#),
                      "a status tap erased the sale date: \(raw)")
        XCTAssertTrue(raw.contains(#""soldPrice":25000000"#),
                      "a status tap erased the sale price: \(raw)")
        let body = try request.jsonBody()
        XCTAssertEqual(body["soldPrice"] as? Int, 25_000_000)

        // The write response is a bare `store.Device`: it must carry the pair too,
        // or the row the store swaps in would render as unsold until a reload.
        XCTAssertEqual(result.device.soldAt, "2026-03-02T00:00:00")
        XCTAssertEqual(result.device.soldPrice, 25_000_000)
    }

    /// A give-away survives a status tap as well — `0` is data, not "empty".
    func testStatusOnlyPatchKeepsAGiveAwayOnTheWire() async throws {
        StubURLProtocol.install(.json(saveResponse(soldPrice: "0")))
        let client = makeStubbedClient(token: "tok_abc")
        let stored = try APIClient.decoder.decode(
            Device.self, from: Data(deviceJSON(soldPrice: "0").utf8)
        )

        _ = try await client.updateDevice(id: "dev_1", statusOnlyInput(stored, status: .LOST))

        let request = try XCTUnwrap(StubURLProtocol.lastRequest)
        let raw = try XCTUnwrap(String(data: request.capturedBody, encoding: .utf8))
        XCTAssertTrue(raw.contains(#""soldPrice":0"#), "the give-away was dropped: \(raw)")
    }

    /// A status-only save on an unsold device must not invent a sale either.
    func testStatusOnlyPatchInventsNothingForAnUnsoldDevice() async throws {
        StubURLProtocol.install(.json(saveResponse(soldAt: "null", soldPrice: "null")))
        let client = makeStubbedClient(token: "tok_abc")

        _ = try await client.updateDevice(
            id: "dev_1",
            statusOnlyInput(device(soldAt: nil, soldPrice: nil), status: .BROKEN)
        )

        let request = try XCTUnwrap(StubURLProtocol.lastRequest)
        let raw = try XCTUnwrap(String(data: request.capturedBody, encoding: .utf8))
        XCTAssertFalse(raw.contains("soldAt"), raw)
        XCTAssertFalse(raw.contains("soldPrice"), raw)
    }

    // MARK: - The derived profit/loss

    func testProfitLossUsesTheSameWordingAndMoneyFormatAsWebAndAndroid() {
        XCTAssertEqual(DeviceResale.profitLoss(purchasePrice: 30_000_000, soldPrice: 35_000_000),
                       SaleProfitLoss(amount: 5_000_000, tone: .profit, label: "Lãi 5.000.000 ₫"))
        XCTAssertEqual(DeviceResale.profitLoss(purchasePrice: 30_000_000, soldPrice: 25_000_000),
                       SaleProfitLoss(amount: -5_000_000, tone: .loss, label: "Lỗ 5.000.000 ₫"))
        XCTAssertEqual(DeviceResale.profitLoss(purchasePrice: 30_000_000, soldPrice: 30_000_000),
                       SaleProfitLoss(amount: 0, tone: .even, label: "Hoà vốn"))
    }

    func testProfitLossShowsNothingWithoutASaleAndAFullLossForAGiveAway() {
        XCTAssertNil(DeviceResale.profitLoss(purchasePrice: 30_000_000, soldPrice: nil))
        // 0đ for a device bought at 30.000.000đ is the worst case, not "no data".
        XCTAssertEqual(DeviceResale.profitLoss(purchasePrice: 30_000_000, soldPrice: 0)?.label,
                       "Lỗ 30.000.000 ₫")
    }

    // MARK: - Read-only formatting

    func testDayLabelFormatsOnlyTheStoredDay() {
        XCTAssertEqual(DeviceResale.dayLabel("2026-03-02T00:00:00"), "02/03/2026")
        XCTAssertEqual(DeviceResale.dayLabel("2026-03-02T23:30:00Z"), "02/03/2026")
        XCTAssertNil(DeviceResale.dayLabel(nil))
        XCTAssertNil(DeviceResale.dayLabel(""))
        XCTAssertNil(DeviceResale.dayLabel("02/03/2026"))
    }
}
