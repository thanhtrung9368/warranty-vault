import Foundation

// MARK: - DeviceSearchRecord

/// The fields that go into one Spotlight item.
///
/// It is a plain value on purpose: `CSSearchableItemAttributeSet` only exists
/// on Apple platforms with CoreSpotlight linked, and the rules (which fields,
/// which identifier, what gets deleted) are the part that can be wrong. The app
/// layer does the one mechanical translation into CoreSpotlight.
public struct DeviceSearchRecord: Equatable, Sendable, Identifiable {
    public let identifier: String
    public let deviceId: String
    public let title: String
    public let contentDescription: String
    public let keywords: [String]
    public let domainIdentifier: String

    public var id: String { identifier }

    public init(
        identifier: String,
        deviceId: String,
        title: String,
        contentDescription: String,
        keywords: [String],
        domainIdentifier: String
    ) {
        self.identifier = identifier
        self.deviceId = deviceId
        self.title = title
        self.contentDescription = contentDescription
        self.keywords = keywords
        self.domainIdentifier = domainIdentifier
    }
}

// MARK: - SpotlightIndexPlan

/// What one re-index pass should write and what it should remove.
public struct SpotlightIndexPlan: Equatable, Sendable {
    public let records: [DeviceSearchRecord]
    /// Identifiers present in the previous index but absent from the current
    /// device list — the deleted devices.
    public let identifiersToDelete: [String]

    public init(records: [DeviceSearchRecord], identifiersToDelete: [String]) {
        self.records = records
        self.identifiersToDelete = identifiersToDelete
    }
}

// MARK: - DeviceSpotlightRules

/// What Warrly puts into Spotlight, and what it deliberately does not.
///
/// Only fields the app already shows on a device row/detail are indexed: name,
/// brand, model and serial number. Notes, claim text, OCR output, prices and
/// account identity are **not** indexed — a system search result is readable by
/// anyone who picks up an unlocked phone, and Spotlight keeps its own copy.
///
/// Re-indexing is a full plan each time (the device ceiling is 500 rows), with
/// deletions computed from the identifiers the previous pass actually wrote.
/// That avoids `deleteSearchableItems(withDomainIdentifiers:)` wiping the index
/// before the replacement has been accepted.
public enum DeviceSpotlightRules {
    public static let domainIdentifier = "com.warrly.devices"
    public static let identifierPrefix = "com.warrly.device."

    public static func identifier(for deviceId: String) -> String {
        identifierPrefix + deviceId
    }

    /// Recovers the device id from a Spotlight hit's unique identifier. Used by
    /// the app when the user taps a result.
    public static func deviceId(fromIdentifier identifier: String) -> String? {
        guard identifier.hasPrefix(identifierPrefix) else { return nil }
        let id = String(identifier.dropFirst(identifierPrefix.count))
        return id.isEmpty ? nil : id
    }

    public static func record(for device: Device) -> DeviceSearchRecord {
        let parts = [
            trimmed(device.brand),
            trimmed(device.model),
            trimmed(device.serialNumber),
        ].compactMap { $0 }

        var keywords = [device.name]
        keywords.append(contentsOf: parts)

        return DeviceSearchRecord(
            identifier: identifier(for: device.id),
            deviceId: device.id,
            title: device.name,
            contentDescription: parts.joined(separator: " · "),
            keywords: deduplicated(keywords),
            domainIdentifier: domainIdentifier
        )
    }

    public static func records(for devices: [Device]) -> [DeviceSearchRecord] {
        devices.map(record(for:))
    }

    /// Builds the write set and the delete set in one pass.
    ///
    /// `previousIdentifiers` must be the identifiers the last **successful**
    /// index write stored. Passing `[]` (first run, or after a sign-out) means
    /// nothing is deleted; passing the previous set with `devices: []` deletes
    /// every device, which is what sign-out does.
    public static func plan(
        previousIdentifiers: [String],
        devices: [Device]
    ) -> SpotlightIndexPlan {
        let records = records(for: devices)
        let current = Set(records.map(\.identifier))
        let stale = previousIdentifiers.filter { !current.contains($0) }
        return SpotlightIndexPlan(records: records, identifiersToDelete: stale)
    }

    // MARK: Private

    private static func trimmed(_ raw: String?) -> String? {
        guard let value = raw?.trimmingCharacters(in: .whitespacesAndNewlines),
              !value.isEmpty else { return nil }
        return value
    }

    private static func deduplicated(_ values: [String]) -> [String] {
        var seen = Set<String>()
        var out: [String] = []
        for value in values {
            let key = value.lowercased()
            if seen.insert(key).inserted { out.append(value) }
        }
        return out
    }
}
