import Foundation
import XCTest
@testable import WarrlyKit

/// Pure tests for the per-device / per-subscription reminder schedule
/// (`leadDays`). No simulator, no network — the same rules drive both forms and
/// both detail screens, so this is the one place that pins them.
final class LeadDaysRulesTests: KitTestCase {

    // MARK: - Normalisation

    func testNormalizeClampsDeduplicatesAndSortsDescending() {
        XCTAssertEqual(LeadDaysRules.normalize([400, -3, 7, 7, 30, 0]),
                       [365, 30, 7, 0],
                       "clamp into 0...365, drop the duplicate, sort descending")
        XCTAssertEqual(LeadDaysRules.normalize([7, 30]), [30, 7])
        XCTAssertEqual(LeadDaysRules.normalize([0]), [0],
                       "0 is a real schedule (the expiry day), not 'empty'")
        XCTAssertEqual(LeadDaysRules.normalize([365]), [365])
    }

    func testNormalizeCapsAtFiveKeepingTheLargestLeadTimes() {
        XCTAssertEqual(LeadDaysRules.normalize([1, 2, 3, 4, 5, 6]),
                       [6, 5, 4, 3, 2])
        XCTAssertEqual(LeadDaysRules.normalize([400, 1, 2, 3, 4, 5, 6]),
                       [365, 6, 5, 4, 3],
                       "clamping happens before the cap, so 400 becomes a real 365")
        XCTAssertEqual(LeadDaysRules.normalize([60, 30, 14, 7, 1, 0]).count, 5)
    }

    func testNormalizeKeepsAnEmptySelectionEmpty() {
        // Deliberate: the picker has to be able to SHOW "chưa chọn mốc nào".
        // Filling in the default here would hide the missing required choice.
        XCTAssertEqual(LeadDaysRules.normalize([]), [])
        XCTAssertEqual(LeadDaysRules.normalize([999, 999]), [365],
                       "duplicates collapse after clamping")
    }

    // MARK: - The wire contract

    func testIsValidEnforcesOneToFiveEntriesInRangeWithoutDuplicates() {
        XCTAssertTrue(LeadDaysRules.isValid([30, 7]))
        XCTAssertTrue(LeadDaysRules.isValid([0]))
        XCTAssertTrue(LeadDaysRules.isValid([365]))
        XCTAssertTrue(LeadDaysRules.isValid([60, 30, 14, 7, 1]))
        XCTAssertTrue(LeadDaysRules.isValid([7, 30]), "order is the server's job")

        XCTAssertFalse(LeadDaysRules.isValid([]), "empty array is a 400")
        XCTAssertFalse(LeadDaysRules.isValid([366]))
        XCTAssertFalse(LeadDaysRules.isValid([-1]))
        XCTAssertFalse(LeadDaysRules.isValid([30, 30]))
        XCTAssertFalse(LeadDaysRules.isValid([60, 30, 14, 7, 1, 0]))
    }

    func testWireValueNormalizesThenRejectsWhatCannotBeSent() {
        XCTAssertEqual(LeadDaysRules.wireValue([7, 30, 7]), [30, 7])
        XCTAssertNil(LeadDaysRules.wireValue([]))
        XCTAssertEqual(LeadDaysRules.wireValue([366]), [365],
                       "the clamp is part of normalising a candidate")
        XCTAssertEqual(LeadDaysRules.wireValue([1, 2, 3, 4, 5, 6]),
                       [6, 5, 4, 3, 2])
    }

    func testTogglingAddsRemovesClampsAndRespectsTheCap() {
        XCTAssertEqual(LeadDaysRules.toggling([], day: 30), [30])
        XCTAssertEqual(LeadDaysRules.toggling([30], day: 7), [30, 7])
        XCTAssertEqual(LeadDaysRules.toggling([30, 7], day: 30), [7])
        XCTAssertEqual(LeadDaysRules.toggling([], day: 999), [365])
        XCTAssertEqual(LeadDaysRules.toggling([60, 30, 14, 7, 1], day: 0),
                       [60, 30, 14, 7, 1],
                       "a sixth day is refused, never replacing a chosen one")
        XCTAssertEqual(LeadDaysRules.toggling([60, 30, 14, 7, 1], day: 30),
                       [60, 14, 7, 1],
                       "removing a chosen day still works at the cap")
    }

    func testDefaultsAndPresetsMatchTheProductDecision() {
        XCTAssertEqual(LeadDaysRules.defaults, [30, 7])
        XCTAssertEqual(LeadDaysRules.presets, [60, 30, 14, 7, 1, 0])
        XCTAssertEqual(LeadDaysRules.minimumCount, 1)
        XCTAssertEqual(LeadDaysRules.maximumCount, 5)
        XCTAssertEqual(LeadDaysRules.validRange, 0...365)
    }

    // MARK: - Models: decode, encode-when-set, tolerate absence

    func testDeviceAndSubscriptionDecodeLeadDaysAndTolerateItsAbsence() throws {
        let device = try APIClient.decoder.decode(Device.self, from: Data(#"""
        {"id": "dev_1", "name": "Nồi chiên", "category": "KITCHEN",
         "purchaseDate": "2025-03-12T00:00:00Z", "purchasePrice": 1500000,
         "status": "ACTIVE", "leadDays": [30, 7, 0]}
        """#.utf8))
        XCTAssertEqual(device.leadDays, [30, 7, 0])

        let olderDevice = try APIClient.decoder.decode(Device.self, from: Data(#"""
        {"id": "dev_2", "name": "Ấm siêu tốc", "category": "KITCHEN",
         "purchaseDate": "2024-11-02", "purchasePrice": 0, "status": "BROKEN"}
        """#.utf8))
        XCTAssertNil(olderDevice.leadDays, "an old cached payload must still decode")

        let subscription = try APIClient.decoder.decode(Subscription.self, from: Data(#"""
        {"id": "sub_1", "name": "iCloud+", "billingCycle": "MONTHLY",
         "price": 59000, "startedAt": "2025-01-05T00:00:00Z",
         "renewalDate": "2025-06-05T00:00:00Z", "autoRenew": true,
         "status": "ACTIVE", "leadDays": [14, 3]}
        """#.utf8))
        XCTAssertEqual(subscription.leadDays, [14, 3])

        let olderSubscription = try APIClient.decoder.decode(Subscription.self, from: Data(#"""
        {"id": "sub_2", "name": "Netflix", "billingCycle": "MONTHLY",
         "price": 260000, "startedAt": "2025-01-05T00:00:00Z",
         "renewalDate": "2025-06-05T00:00:00Z", "autoRenew": true,
         "status": "ACTIVE"}
        """#.utf8))
        XCTAssertNil(olderSubscription.leadDays)
    }

    func testDeviceAndSubscriptionEncodeLeadDaysWhenSetAndDropItWhenNil() throws {
        // The read models are `Codable`; a non-nil array MUST survive encoding
        // (a server-side cache/round-trip must not lose the schedule), while a
        // nil value may be dropped — the contract defines absent as "unchanged"
        // on update and as the `[30, 7]` default on create.
        let device = try APIClient.decoder.decode(Device.self, from: Data(#"""
        {"id": "dev_1", "name": "Nồi chiên", "category": "KITCHEN",
         "purchaseDate": "2025-03-12T00:00:00Z", "purchasePrice": 1500000,
         "status": "ACTIVE", "leadDays": [30, 7]}
        """#.utf8))
        var object = try encodedObject(device)
        XCTAssertEqual(object["leadDays"] as? [Int], [30, 7])

        let noSchedule = try APIClient.decoder.decode(Device.self, from: Data(#"""
        {"id": "dev_2", "name": "Ấm siêu tốc", "category": "KITCHEN",
         "purchaseDate": "2024-11-02", "purchasePrice": 0, "status": "BROKEN"}
        """#.utf8))
        object = try encodedObject(noSchedule)
        XCTAssertNil(object["leadDays"])

        var subscription = try APIClient.decoder.decode(Subscription.self, from: Data(#"""
        {"id": "sub_1", "name": "iCloud+", "billingCycle": "MONTHLY",
         "price": 59000, "startedAt": "2025-01-05T00:00:00Z",
         "renewalDate": "2025-06-05T00:00:00Z", "autoRenew": true,
         "status": "ACTIVE", "leadDays": [60, 30, 14]}
        """#.utf8))
        object = try encodedObject(subscription)
        XCTAssertEqual(object["leadDays"] as? [Int], [60, 30, 14])

        subscription = try APIClient.decoder.decode(Subscription.self, from: Data(#"""
        {"id": "sub_2", "name": "Netflix", "billingCycle": "MONTHLY",
         "price": 260000, "startedAt": "2025-01-05T00:00:00Z",
         "renewalDate": "2025-06-05T00:00:00Z", "autoRenew": true,
         "status": "ACTIVE"}
        """#.utf8))
        object = try encodedObject(subscription)
        XCTAssertNil(object["leadDays"])
    }

    func testDeviceDetailBodyCarriesLeadDays() throws {
        let detail = try APIClient.decoder.decode(DeviceDetail.self, from: Data(#"""
        {"device": {"id": "dev_1", "name": "Nồi chiên", "category": "KITCHEN",
                    "purchaseDate": "2025-03-12T00:00:00Z", "purchasePrice": 1500000,
                    "status": "ACTIVE", "leadDays": [14]}}
        """#.utf8))
        XCTAssertEqual(detail.device.leadDays, [14])
    }

    func testInputsEncodeLeadDaysWhenSetAndOmitItWhenNil() throws {
        var deviceInput = DeviceInput(name: "iPhone 16", category: "PHONE",
                                      purchaseDate: "2025-05-20")
        deviceInput.leadDays = [60, 30, 14]
        var object = try encodedObject(deviceInput)
        XCTAssertEqual(object["leadDays"] as? [Int], [60, 30, 14])

        deviceInput.leadDays = nil
        object = try encodedObject(deviceInput)
        XCTAssertNil(object["leadDays"],
                     "nil is omitted — on update that means 'keep the stored schedule'")

        var subscriptionInput = SubscriptionInput(name: "Spotify", billingCycle: .MONTHLY,
                                                  price: 59_000,
                                                  startedAt: "2025-02-01")
        subscriptionInput.leadDays = [7]
        object = try encodedObject(subscriptionInput)
        XCTAssertEqual(object["leadDays"] as? [Int], [7])

        subscriptionInput.leadDays = nil
        object = try encodedObject(subscriptionInput)
        XCTAssertNil(object["leadDays"])
    }

    // MARK: - Display strings

    func testVietnameseSummaryReadsNaturally() {
        L.withLanguage(.vi) {
            XCTAssertEqual(LeadDaysRules.summary([30, 7]), "Nhắc trước 30 và 7 ngày")
            XCTAssertEqual(LeadDaysRules.summary([7, 30]), "Nhắc trước 30 và 7 ngày",
                           "the display normalises the order itself")
            XCTAssertEqual(LeadDaysRules.summary([60, 30, 14]),
                           "Nhắc trước 60, 30 và 14 ngày")
            XCTAssertEqual(LeadDaysRules.summary([14]), "Nhắc trước 14 ngày")
            XCTAssertEqual(LeadDaysRules.summary([0]), "Nhắc trước 0 ngày")
            XCTAssertEqual(LeadDaysRules.dayListText([30, 7]), "30 và 7 ngày")
            XCTAssertEqual(LeadDaysRules.dayListText([14]), "14 ngày")
        }
    }

    func testEnglishSummaryAndDayListInflect() {
        L.withLanguage(.en) {
            XCTAssertEqual(LeadDaysRules.summary([30, 7]),
                           "Reminds you 30 and 7 days before")
            XCTAssertEqual(LeadDaysRules.summary([1]), "Reminds you 1 day before",
                           "one day must not become '1 days'")
            XCTAssertEqual(LeadDaysRules.dayListText([30, 7]), "30 and 7 days")
            XCTAssertEqual(LeadDaysRules.dayListText([1]), "1 day")
        }
    }

    func testSummaryHidesWhenThereIsNoSchedule() {
        XCTAssertNil(LeadDaysRules.summary([]))
        XCTAssertEqual(LeadDaysRules.dayListText([]), "")
    }

    // MARK: - Endpoints: the field really rides on create and update

    func testDeviceCreateAndUpdateSendLeadDays() async throws {
        StubURLProtocol.install(.json(#"""
        {"device": {"id": "dev_9", "name": "Máy lọc nước", "category": "HOME",
                    "purchaseDate": "2025-02-02T00:00:00Z", "purchasePrice": 8000000,
                    "status": "ACTIVE", "leadDays": [14, 3]},
         "warnings": []}
        """#))
        let client = makeStubbedClient(token: "tok_abc")
        var input = DeviceInput(name: "Máy lọc nước", category: "HOME",
                                purchaseDate: "2025-02-02")
        input.leadDays = [14, 3]

        _ = try await client.createDevice(input)
        var request = try XCTUnwrap(StubURLProtocol.lastRequest)
        XCTAssertEqual(request.httpMethod, "POST")
        var body = try request.jsonBody()
        XCTAssertEqual(body["leadDays"] as? [Int], [14, 3])

        _ = try await client.updateDevice(id: "dev_9", input)
        request = try XCTUnwrap(StubURLProtocol.lastRequest)
        XCTAssertEqual(request.httpMethod, "PATCH")
        body = try request.jsonBody()
        XCTAssertEqual(body["leadDays"] as? [Int], [14, 3])
    }

    func testSubscriptionCreateAndUpdateSendLeadDays() async throws {
        StubURLProtocol.install(.json(#"""
        {"subscription": {"id": "sub_9", "name": "Netflix", "billingCycle": "MONTHLY",
                          "price": 260000, "startedAt": "2025-01-05T00:00:00Z",
                          "renewalDate": "2025-06-05T00:00:00Z", "autoRenew": true,
                          "status": "ACTIVE", "leadDays": [60, 30]}}
        """#))
        let client = makeStubbedClient(token: "tok_abc")
        var input = SubscriptionInput(name: "Netflix", billingCycle: .MONTHLY,
                                      price: 260_000, startedAt: "2025-01-05")
        input.leadDays = [60, 30]

        _ = try await client.createSubscription(input)
        var request = try XCTUnwrap(StubURLProtocol.lastRequest)
        XCTAssertEqual(request.httpMethod, "POST")
        var body = try request.jsonBody()
        XCTAssertEqual(body["leadDays"] as? [Int], [60, 30])

        _ = try await client.updateSubscription(id: "sub_9", input)
        request = try XCTUnwrap(StubURLProtocol.lastRequest)
        XCTAssertEqual(request.httpMethod, "PATCH")
        body = try request.jsonBody()
        XCTAssertEqual(body["leadDays"] as? [Int], [60, 30])
    }

    // MARK: - Helpers

    private func encodedObject<T: Encodable>(_ value: T) throws -> [String: Any] {
        let data = try APIClient.encoder.encode(value)
        let object = try JSONSerialization.jsonObject(with: data)
        return try XCTUnwrap(object as? [String: Any])
    }
}
