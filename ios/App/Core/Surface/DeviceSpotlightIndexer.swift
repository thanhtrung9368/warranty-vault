import CoreSpotlight
import Foundation
import UniformTypeIdentifiers
import WarrlyKit

/// The app-side half of Spotlight indexing.
///
/// The rules — which fields, which identifier, what to delete — live in
/// `DeviceSpotlightRules` and are unit-tested. This file only translates them
/// into `CSSearchableItem`s and talks to `CSSearchableIndex`.
///
/// Failure is deliberately silent: Spotlight is a convenience, and a device
/// index that is temporarily unavailable (or a simulator without one) must not
/// break the app or the deadline snapshot refresh.
enum DeviceSpotlightIndexer {
    private static let indexedIdentifiersKey = "wv.spotlight.indexedIds"

    private static var defaults: UserDefaults? {
        UserDefaults(suiteName: WarrlySurface.appGroupIdentifier)
    }

    static func reindex(devices: [Device]) async {
        let previous = defaults?.stringArray(forKey: indexedIdentifiersKey) ?? []
        let plan = DeviceSpotlightRules.plan(
            previousIdentifiers: previous,
            devices: devices
        )

        do {
            if !plan.records.isEmpty {
                try await CSSearchableIndex.default().indexSearchableItems(
                    plan.records.map(makeItem)
                )
            }
            // Delete only after the new items were accepted. A deleted device
            // must disappear, but a failed write must not leave a half-empty
            // index behind.
            if !plan.identifiersToDelete.isEmpty {
                try await CSSearchableIndex.default().deleteSearchableItems(
                    withIdentifiers: plan.identifiersToDelete
                )
            }
            defaults?.set(
                plan.records.map(\.identifier),
                forKey: indexedIdentifiersKey
            )
        } catch {
            // Keep the old identifier list: the next pass still knows what to
            // delete for devices that are already gone.
        }
    }

    static func clear() async {
        let previous = defaults?.stringArray(forKey: indexedIdentifiersKey) ?? []
        if !previous.isEmpty {
            try? await CSSearchableIndex.default()
                .deleteSearchableItems(withIdentifiers: previous)
        }
        // Also drop items from an older app version that did not persist the
        // identifier list. This is the domain-wide belt-and-braces pass.
        try? await CSSearchableIndex.default().deleteSearchableItems(
            withDomainIdentifiers: [DeviceSpotlightRules.domainIdentifier]
        )
        defaults?.removeObject(forKey: indexedIdentifiersKey)
    }

    private static func makeItem(_ record: DeviceSearchRecord) -> CSSearchableItem {
        let attributes = CSSearchableItemAttributeSet(contentType: UTType.text)
        attributes.title = record.title
        attributes.displayName = record.title
        attributes.contentDescription = record.contentDescription
        attributes.keywords = record.keywords
        return CSSearchableItem(
            uniqueIdentifier: record.identifier,
            domainIdentifier: record.domainIdentifier,
            attributeSet: attributes
        )
    }
}
