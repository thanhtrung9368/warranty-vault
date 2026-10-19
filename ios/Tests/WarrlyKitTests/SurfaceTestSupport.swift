import Foundation
@testable import WarrlyKit

// Fixtures shared by the out-of-app surface tests: the snapshot, the widget
// rules, Spotlight and the expiry answer. All dates are UTC instants decoded
// through the app's real decoder, so the tests exercise the same date path the
// app does instead of a hand-built `Date`.

enum SurfaceFixtures {
    static let utc = TimeZone(secondsFromGMT: 0)!

    static func calendar() -> Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = utc
        return calendar
    }

    static func date(_ iso: String) -> Date {
        guard let date = ISO8601DateFormatter().date(from: iso) else {
            fatalError("Bad fixture date: \(iso)")
        }
        return date
    }

    static func device(
        id: String = "dev_1",
        name: String = "iPhone 15",
        brand: String? = "Apple",
        model: String? = "A3090",
        serial: String? = "SN-1",
        category: String = "PHONE",
        status: String = "ACTIVE",
        effectiveEnd: String? = nil
    ) -> Device {
        var json: [String: Any] = [
            "id": id,
            "name": name,
            "category": category,
            "purchaseDate": "2025-01-01T00:00:00Z",
            "purchasePrice": 20_000_000,
            "status": status,
        ]
        if let brand { json["brand"] = brand }
        if let model { json["model"] = model }
        if let serial { json["serialNumber"] = serial }
        if let effectiveEnd { json["effectiveWarrantyEnd"] = effectiveEnd }
        return decode(Device.self, from: json)
    }

    static func reminder(
        id: String = "war_1",
        deviceId: String = "dev_1",
        deviceName: String = "iPhone 15",
        category: String = "PHONE",
        endDate: String,
        isDismissed: Bool? = nil,
        type: String = "STANDARD",
        provider: String? = nil
    ) -> UpcomingReminder {
        var json: [String: Any] = [
            "id": id,
            "deviceId": deviceId,
            "device": [
                "id": deviceId,
                "name": deviceName,
                "category": category,
            ],
            "type": type,
            "startDate": "2025-01-01T00:00:00Z",
            "endDate": endDate,
            "months": 12,
        ]
        json["provider"] = provider.map { $0 as Any } ?? NSNull()
        if let isDismissed { json["isDismissed"] = isDismissed }
        return decode(UpcomingReminder.self, from: json)
    }

    static func warranty(
        id: String = "war_1",
        deviceId: String = "dev_1",
        endDate: String,
        type: String = "STANDARD"
    ) -> Warranty {
        decode(Warranty.self, from: [
            "id": id,
            "deviceId": deviceId,
            "type": type,
            "startDate": "2025-01-01T00:00:00Z",
            "endDate": endDate,
            "months": 12,
        ])
    }

    private static func decode<T: Decodable>(_ type: T.Type, from json: [String: Any]) -> T {
        do {
            let data = try JSONSerialization.data(withJSONObject: json)
            return try APIClient.decoder.decode(T.self, from: data)
        } catch {
            fatalError("Fixture decode failed for \(T.self): \(error)")
        }
    }
}
