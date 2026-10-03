import Foundation
import XCTest
@testable import WarrantyVaultKit

/// Exchange / return window round trip (migration 0010) — the pure half.
///
/// This is a PRESERVE-ONLY feature in this pass: no input, no picker, no setting.
/// `PATCH /api/v1/devices/{id}` replaces the whole device, so the only thing that
/// matters is that an edit made on iOS sends back exactly what it loaded. A device
/// that arrives with a window recorded elsewhere must leave with the same window —
/// otherwise the first iOS edit silently destroys data another client wrote.
///
/// The last two tests here go one level deeper than the mapping helpers: they
/// build the very `DeviceInput` the form builds, encode it through the real
/// `APIClient` and assert on the **literal JSON body on the wire**. A helper test
/// alone cannot prove the key survives `JSONEncoder` — and a dropped key is
/// exactly how the window gets cleared.
final class DeviceReturnWindowTests: KitTestCase {

    /// A device as the API returns it. `receivedAt` is the server's RFC3339 UTC
    /// timestamp (`…Z`); the Z-less form openapi documents is exercised below too,
    /// because a client that only handles one of the two shapes loses a day.
    private func deviceJSON(returnWindowDays: String = "30",
                            receivedAt: String = #""2026-03-02T00:00:00Z""#,
                            returnDeadline: String = #""2026-04-01T00:00:00Z""#) -> String {
        """
        {
          "id": "dev_1", "name": "iPhone 16", "category": "PHONE",
          "purchaseDate": "2026-03-01T00:00:00", "purchasePrice": 30000000,
          "status": "ACTIVE",
          "returnWindowDays": \(returnWindowDays),
          "receivedAt": \(receivedAt),
          "returnDeadline": \(returnDeadline)
        }
        """
    }

    private func device(returnWindowDays: Int?, receivedAt: String?) -> Device {
        let json = """
        {
          "id": "dev_1", "name": "iPhone 16", "category": "PHONE",
          "purchaseDate": "2026-03-01T00:00:00", "purchasePrice": 30000000,
          "status": "ACTIVE",
          "returnWindowDays": \(returnWindowDays.map(String.init) ?? "null"),
          "receivedAt": \(receivedAt.map { "\"\($0)\"" } ?? "null")
        }
        """
        return try! APIClient.decoder.decode(Device.self, from: Data(json.utf8))
    }

    /// Mirrors the form exactly: form state is seeded from the loaded device and
    /// fed back through the same `carried`/`apply` pair the save button uses.
    private func roundTrip(_ stored: Device) -> DeviceInput {
        let fields = DeviceReturnWindow.carried(from: stored)
        var input = DeviceInput(name: stored.name,
                                category: stored.category,
                                purchaseDate: "2026-03-01")
        DeviceReturnWindow.apply(fields, to: &input)
        return input
    }

    // MARK: - Decoding

    func testDeviceDecodesTheWindowFieldsFromAListPayload() throws {
        let stored = try APIClient.decoder.decode(Device.self, from: Data(deviceJSON().utf8))

        XCTAssertEqual(stored.returnWindowDays, 30)
        XCTAssertEqual(stored.receivedAt, "2026-03-02T00:00:00Z")
        XCTAssertEqual(stored.returnDeadline, "2026-04-01T00:00:00Z")
        XCTAssertEqual(DeviceReturnWindow.deadlineLabel(stored.returnDeadline), "01/04/2026")
    }

    /// A server that predates 0010, or a bare write response, decodes as unknown.
    func testDeviceDecodesMissingWindowFieldsAsUnknown() throws {
        let json = """
        {"id": "dev_2", "name": "Chuột", "category": "ACCESSORY",
         "purchaseDate": "2024-05-05T00:00:00", "purchasePrice": 200000, "status": "ACTIVE"}
        """
        let stored = try APIClient.decoder.decode(Device.self, from: Data(json.utf8))

        XCTAssertNil(stored.returnWindowDays)
        XCTAssertNil(stored.receivedAt)
        XCTAssertNil(stored.returnDeadline)
        XCTAssertNil(DeviceReturnWindow.deadlineLabel(stored.returnDeadline))
        XCTAssertFalse(DeviceReturnWindow.hasReturnWindow(stored.returnWindowDays))
    }

    func testDetailBodyCarriesTheSameThreeFields() throws {
        let json = """
        {"device": \(deviceJSON())}
        """
        let detail = try APIClient.decoder.decode(DeviceDetail.self, from: Data(json.utf8))

        XCTAssertEqual(detail.device.returnWindowDays, 30)
        XCTAssertEqual(detail.device.receivedAt, "2026-03-02T00:00:00Z")
        XCTAssertEqual(detail.device.returnDeadline, "2026-04-01T00:00:00Z")
        XCTAssertEqual(DeviceReturnWindow.carried(from: detail.device),
                       ReturnWindowFields(returnWindowDays: 30, receivedAt: "2026-03-02"))
    }

    // MARK: - Wire → request

    func testCarriedKeepsZeroDistinctFromUnknown() {
        // "cửa hàng không cho đổi trả" is a recorded answer, not an absence.
        XCTAssertEqual(DeviceReturnWindow.carried(returnWindowDays: 0, receivedAt: nil),
                       ReturnWindowFields(returnWindowDays: 0, receivedAt: nil))
        XCTAssertEqual(DeviceReturnWindow.carried(returnWindowDays: nil, receivedAt: nil),
                       ReturnWindowFields(returnWindowDays: nil, receivedAt: nil))
        XCTAssertEqual(DeviceReturnWindow.carried(returnWindowDays: 365, receivedAt: nil).returnWindowDays,
                       365)
        XCTAssertTrue(DeviceReturnWindow.hasReturnWindow(0))
        XCTAssertTrue(DeviceReturnWindow.isNoExchange(0))
    }

    func testReceivedAtIsReducedToItsCalendarDayWithoutAnInstantParse() {
        // Only the date half may be used, in either wire shape the server has
        // emitted: RFC3339 with `Z`, and the Z-less form openapi documents.
        XCTAssertEqual(DeviceReturnWindow.carried(returnWindowDays: 30,
                                                  receivedAt: "2026-03-02T00:00:00Z").receivedAt,
                       "2026-03-02")
        XCTAssertEqual(DeviceReturnWindow.carried(returnWindowDays: 30,
                                                  receivedAt: "2026-03-02T23:30:00Z").receivedAt,
                       "2026-03-02")
        XCTAssertEqual(DeviceReturnWindow.carried(returnWindowDays: 30,
                                                  receivedAt: "2026-03-02T00:00:00").receivedAt,
                       "2026-03-02")
        XCTAssertEqual(DeviceReturnWindow.carried(returnWindowDays: 30,
                                                  receivedAt: "2026-03-02T23:30:00").receivedAt,
                       "2026-03-02")
        XCTAssertEqual(DeviceReturnWindow.carried(returnWindowDays: 30,
                                                  receivedAt: "2026-03-02").receivedAt,
                       "2026-03-02")
        XCTAssertNil(DeviceReturnWindow.carried(returnWindowDays: 30, receivedAt: "   ").receivedAt)
        // Unreadable input is never invented into a window.
        XCTAssertNil(DeviceReturnWindow.carried(returnWindowDays: 30, receivedAt: "không phải ngày").receivedAt)
        XCTAssertNil(DeviceReturnWindow.carried(returnWindowDays: 30, receivedAt: "01/03/2026").receivedAt)
    }

    // MARK: - The round trip through the form mapping

    func testRoundTripPreservesBothFields() {
        let input = roundTrip(device(returnWindowDays: 30, receivedAt: "2026-03-02T00:00:00"))

        XCTAssertEqual(input.returnWindowDays, 30)
        XCTAssertEqual(input.receivedAt, "2026-03-02")
    }

    func testRoundTripPreservesTheMeaningfulZero() {
        let input = roundTrip(device(returnWindowDays: 0, receivedAt: nil))

        XCTAssertEqual(input.returnWindowDays, 0, "0 must survive as 0, not become absent")
        XCTAssertNil(input.receivedAt, "no delivery date stays unknown")
    }

    func testRoundTripLeavesAnUnknownWindowUnknown() {
        let input = roundTrip(device(returnWindowDays: nil, receivedAt: nil))

        XCTAssertNil(input.returnWindowDays)
        XCTAssertNil(input.receivedAt)
    }

    func testRoundTripPreservesAWindowWithNoDeliveryDate() {
        let input = roundTrip(device(returnWindowDays: 365, receivedAt: nil))

        XCTAssertEqual(input.returnWindowDays, 365)
        XCTAssertNil(input.receivedAt)
    }

    // MARK: - The proof at the wire level

    /// A naive client would send neither key and Go would read `nil` for both,
    /// clearing the window. Both keys must be present with the stored values.
    func testPatchBodyLiterallyCarriesBothKeys() async throws {
        StubURLProtocol.install(.json(#"""
        {"device": \#(deviceJSON()), "warnings": []}
        """#))
        let client = makeStubbedClient(token: "tok_abc")

        _ = try await client.updateDevice(
            id: "dev_1",
            roundTrip(try APIClient.decoder.decode(Device.self, from: Data(deviceJSON().utf8)))
        )

        let request = try XCTUnwrap(StubURLProtocol.lastRequest)
        XCTAssertEqual(request.httpMethod, "PATCH")
        let raw = try XCTUnwrap(String(data: request.capturedBody, encoding: .utf8))
        XCTAssertTrue(raw.contains(#""returnWindowDays":30"#), "returnWindowDays missing from \(raw)")
        XCTAssertTrue(raw.contains(#""receivedAt":"2026-03-02""#), "receivedAt missing from \(raw)")

        let body = try request.jsonBody()
        XCTAssertEqual(body["returnWindowDays"] as? Int, 30)
        XCTAssertEqual(body["receivedAt"] as? String, "2026-03-02")
    }

    /// `0` is a value, not an absence: it must be on the wire as `0`.
    func testPatchBodyCarriesZeroRatherThanDroppingIt() async throws {
        StubURLProtocol.install(.json(#"""
        {"device": \#(deviceJSON(returnWindowDays: "0", receivedAt: "null", returnDeadline: "null")), "warnings": []}
        """#))
        let client = makeStubbedClient(token: "tok_abc")
        let stored = try APIClient.decoder.decode(
            Device.self,
            from: Data(deviceJSON(returnWindowDays: "0", receivedAt: "null", returnDeadline: "null").utf8)
        )

        _ = try await client.updateDevice(id: "dev_1", roundTrip(stored))

        let request = try XCTUnwrap(StubURLProtocol.lastRequest)
        let raw = try XCTUnwrap(String(data: request.capturedBody, encoding: .utf8))
        XCTAssertTrue(raw.contains(#""returnWindowDays":0"#), "the meaningful 0 was dropped: \(raw)")
        let body = try request.jsonBody()
        XCTAssertEqual(body["returnWindowDays"] as? Int, 0)
        XCTAssertNil(body["receivedAt"], "nothing recorded ⇒ no date is invented")
    }

    /// And nothing recorded invents nothing: the keys stay out of the JSON, which
    /// is the same `nil` the server already holds.
    func testPatchBodyOmitsTheKeysWhenNothingWasRecorded() async throws {
        StubURLProtocol.install(.json(#"""
        {"device": {"id": "dev_1", "name": "iPhone 16", "category": "PHONE",
                    "purchaseDate": "2026-03-01T00:00:00", "purchasePrice": 30000000,
                    "status": "ACTIVE"}, "warnings": []}
        """#))
        let client = makeStubbedClient(token: "tok_abc")

        _ = try await client.updateDevice(
            id: "dev_1",
            roundTrip(device(returnWindowDays: nil, receivedAt: nil))
        )

        let request = try XCTUnwrap(StubURLProtocol.lastRequest)
        let body = try request.jsonBody()
        XCTAssertNil(body["returnWindowDays"], "nothing was recorded, so no value may be invented")
        XCTAssertNil(body["receivedAt"])
        XCTAssertFalse(try XCTUnwrap(String(data: request.capturedBody, encoding: .utf8))
            .contains("returnWindowDays"))
    }

    // MARK: - The read-only derived deadline

    func testDeadlineLabelNeverInventsADate() {
        XCTAssertEqual(DeviceReturnWindow.deadlineLabel("2026-04-01T00:00:00Z"), "01/04/2026")
        XCTAssertEqual(DeviceReturnWindow.deadlineLabel("2026-04-01T00:00:00"), "01/04/2026")
        XCTAssertEqual(DeviceReturnWindow.deadlineLabel("2026-04-01"), "01/04/2026")
        XCTAssertNil(DeviceReturnWindow.deadlineLabel(nil))
        XCTAssertNil(DeviceReturnWindow.deadlineLabel(""))
        XCTAssertNil(DeviceReturnWindow.deadlineLabel("2026/04/01"))
        XCTAssertNil(DeviceReturnWindow.deadlineLabel("2026-4-1"))
    }

    /// The zones that break a single happy anchor: UTC−11, UTC−7, UTC, UTC+7,
    /// UTC+9, UTC+14. The same six `WireDayTests` / `DeviceResaleTests` pin the
    /// day round trips across.
    private let extremeZones = ["Pacific/Midway", "America/Los_Angeles", "UTC",
                                "Asia/Ho_Chi_Minh", "Asia/Tokyo", "Pacific/Kiritimati"]

    private func zone(_ id: String) throws -> TimeZone {
        try XCTUnwrap(TimeZone(identifier: id), "unknown zone \(id)")
    }

    /// The same three cases, judged **in every zone** rather than only at UTC.
    ///
    /// This test used to pin the calendar to UTC, which is exactly why it never
    /// caught the off-by-one: at UTC the wire day's UTC midnight *is* the caller's
    /// midnight, so anchoring one side in UTC and the other in the caller's zone
    /// agrees there and only there. The day count is the whole answer this row
    /// gives the user ("how long do I still have"), so each zone is asserted with
    /// the same `now` on its own wall clock at 09:00.
    func testDeadlineNoteUsesCalendarDaysWithZeroMeaningTodayIsTheLastDayInEveryZone() throws {
        for id in extremeZones {
            let tz = try zone(id)
            var calendar = Calendar(identifier: .gregorian)
            calendar.timeZone = tz
            let now = makeDate("2026-04-10 09:00:00", format: "yyyy-MM-dd HH:mm:ss", timeZone: tz)

            XCTAssertEqual(DeviceReturnWindow.deadlineNote("2026-04-13T00:00:00", now: now, calendar: calendar),
                           "còn 3 ngày", "three days out read wrong for a device in \(id)")
            XCTAssertEqual(DeviceReturnWindow.deadlineNote("2026-04-10T00:00:00", now: now, calendar: calendar),
                           "hôm nay là ngày cuối", "the last day read wrong for a device in \(id)")
            XCTAssertEqual(DeviceReturnWindow.deadlineNote("2026-04-01T00:00:00", now: now, calendar: calendar),
                           "đã qua 9 ngày", "an elapsed window read wrong for a device in \(id)")
            XCTAssertNil(DeviceReturnWindow.deadlineNote(nil, now: now, calendar: calendar))
        }
    }

    /// The reported bug, in the reported zone: a Los Angeles caller at 09:00 on
    /// 2026-04-10 was told "còn 2 ngày" for a deadline of `2026-04-13T00:00:00`,
    /// because midnight UTC on the 13th is 17:00 on the 12th in UTC−7 and the old
    /// code counted from there. One day short is a wrong answer, not a rounding
    /// difference: it is the number the user decides on.
    func testDeadlineNoteIsNotOneDayShortWestOfUTC() throws {
        let la = try zone("America/Los_Angeles")
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = la
        let now = makeDate("2026-04-10 09:00:00", format: "yyyy-MM-dd HH:mm:ss", timeZone: la)

        XCTAssertEqual(DeviceReturnWindow.daysLeft("2026-04-13T00:00:00", now: now, calendar: calendar), 3)
        XCTAssertEqual(DeviceReturnWindow.deadlineNote("2026-04-13T00:00:00", now: now, calendar: calendar),
                       "còn 3 ngày")
    }

    /// The bug itself, stated as arithmetic so the fix cannot be "simplified" back:
    /// the old anchor was a UTC-pinned parse whose result was then measured on the
    /// caller's calendar. Kept as an executable description of what was wrong.
    func testTheOldUTCPinnedAnchorIsWhyWestOfUTCWasOneDayShort() throws {
        let la = try zone("America/Los_Angeles")
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = la
        let now = makeDate("2026-04-10 09:00:00", format: "yyyy-MM-dd HH:mm:ss", timeZone: la)

        // What the removed `utcDay` formatter produced…
        let utcPinned = DateFormatter()
        utcPinned.locale = Locale(identifier: "en_US_POSIX")
        utcPinned.dateFormat = "yyyy-MM-dd"
        utcPinned.timeZone = TimeZone(identifier: "UTC")
        let legacyDeadline = try XCTUnwrap(utcPinned.date(from: "2026-04-13"))
        let legacy = calendar.dateComponents(
            [.day],
            from: calendar.startOfDay(for: now),
            to: calendar.startOfDay(for: legacyDeadline)
        ).day
        XCTAssertEqual(legacy, 2, "the old anchor is only interesting because it was wrong")

        // …and what the caller's own zone gives, which is the day on the screen.
        let fixed = try XCTUnwrap(WireDay.date(from: "2026-04-13", in: la))
        XCTAssertEqual(calendar.dateComponents(
            [.day],
            from: calendar.startOfDay(for: now),
            to: calendar.startOfDay(for: fixed)
        ).day, 3)
    }
}
