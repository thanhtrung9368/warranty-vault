import Foundation
import XCTest
@testable import WarrlyKit

final class WarrlyDeepLinkTests: XCTestCase {

    func testDeviceURLRoundTrips() throws {
        let url = try XCTUnwrap(WarrlyDeepLink.deviceURL(id: "dev_42"))
        XCTAssertEqual(url.absoluteString, "warrly://device/dev_42")
        XCTAssertEqual(WarrlyDeepLink.deviceId(from: url), "dev_42")
    }

    func testOnlyTheDeviceHostAndSchemeAreAccepted() throws {
        XCTAssertNil(WarrlyDeepLink.deviceId(
            from: try XCTUnwrap(URL(string: "https://device/dev_42"))
        ))
        XCTAssertNil(WarrlyDeepLink.deviceId(
            from: try XCTUnwrap(URL(string: "warrly://settings/dev_42"))
        ))
        XCTAssertNil(WarrlyDeepLink.deviceId(
            from: try XCTUnwrap(URL(string: "warrly://device/"))
        ))
    }

    func testIntentBridgeWritesConsumesExactlyOnce() {
        let suite = "WarrlyIntentBridgeTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer {
            defaults.removePersistentDomain(forName: suite)
        }

        XCTAssertNil(WarrlyIntentBridge.consumePendingDevice(defaults: defaults))

        WarrlyIntentBridge.requestDevice(id: "dev_42", defaults: defaults)
        XCTAssertEqual(defaults.string(forKey: WarrlyDeepLink.pendingDeviceDefaultsKey), "dev_42")

        XCTAssertEqual(WarrlyIntentBridge.consumePendingDevice(defaults: defaults), "dev_42")
        XCTAssertNil(WarrlyIntentBridge.consumePendingDevice(defaults: defaults))
    }
}
