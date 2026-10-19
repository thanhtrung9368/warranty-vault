import Foundation
import XCTest
@testable import WarrlyKit

final class DeviceSpotlightTests: XCTestCase {

    private let device = SurfaceFixtures.device(
        id: "dev_42",
        name: "MacBook Pro 14",
        brand: "Apple",
        model: "M3 Pro",
        serial: "SN-12345",
        category: "LAPTOP"
    )

    func testIdentifierRoundTripsAndRejectsForeignItems() {
        let identifier = DeviceSpotlightRules.identifier(for: "dev_42")
        XCTAssertEqual(identifier, "com.warrly.device.dev_42")
        XCTAssertEqual(DeviceSpotlightRules.deviceId(fromIdentifier: identifier), "dev_42")
        XCTAssertNil(DeviceSpotlightRules.deviceId(fromIdentifier: "com.other.app.dev_42"))
        XCTAssertNil(DeviceSpotlightRules.deviceId(fromIdentifier: "com.warrly.device."))
    }

    func testRecordIndexesNameBrandModelAndSerialOnly() {
        let record = DeviceSpotlightRules.record(for: device)

        XCTAssertEqual(record.title, "MacBook Pro 14")
        XCTAssertEqual(record.identifier, "com.warrly.device.dev_42")
        XCTAssertEqual(record.deviceId, "dev_42")
        XCTAssertEqual(record.domainIdentifier, "com.warrly.devices")
        XCTAssertEqual(record.contentDescription, "Apple · M3 Pro · SN-12345")
        XCTAssertTrue(record.keywords.contains("MacBook Pro 14"))
        XCTAssertTrue(record.keywords.contains("Apple"))
        XCTAssertTrue(record.keywords.contains("M3 Pro"))
        XCTAssertTrue(record.keywords.contains("SN-12345"))
    }

    func testEmptyBrandModelAndSerialStillProduceTheDeviceName() {
        let bare = SurfaceFixtures.device(
            id: "dev_9", name: "Máy lọc nước", brand: nil, model: nil, serial: nil
        )
        let record = DeviceSpotlightRules.record(for: bare)
        XCTAssertEqual(record.title, "Máy lọc nước")
        XCTAssertEqual(record.contentDescription, "")
        XCTAssertEqual(record.keywords, ["Máy lọc nước"])
    }

    func testPlanDeletesDevicesThatLeftTheList() {
        let plan = DeviceSpotlightRules.plan(
            previousIdentifiers: [
                "com.warrly.device.dev_old",
                "com.warrly.device.dev_42",
            ],
            devices: [device]
        )

        XCTAssertEqual(plan.records.map(\.deviceId), ["dev_42"])
        XCTAssertEqual(plan.identifiersToDelete, ["com.warrly.device.dev_old"])
    }

    func testPlanOnSignOutDeletesEveryPreviousItem() {
        let plan = DeviceSpotlightRules.plan(
            previousIdentifiers: [
                "com.warrly.device.dev_1",
                "com.warrly.device.dev_2",
            ],
            devices: []
        )
        XCTAssertEqual(plan.records, [])
        XCTAssertEqual(
            plan.identifiersToDelete,
            ["com.warrly.device.dev_1", "com.warrly.device.dev_2"]
        )
    }

    func testPlanNeverDeletesWhenNothingWasIndexedBefore() {
        let plan = DeviceSpotlightRules.plan(previousIdentifiers: [], devices: [device])
        XCTAssertEqual(plan.records.count, 1)
        XCTAssertEqual(plan.identifiersToDelete, [])
    }
}
