import AppIntents
import Foundation
import WarrlyKit

// MARK: - DeviceEntity

/// A device as Siri and Shortcuts see it.
///
/// It carries only the fields the entity picker shows. The expiry answer is
/// fetched live in `perform()`; the entity itself is resolved from the snapshot
/// cache (or, on a first run before any snapshot exists, from one API read).
struct DeviceEntity: AppEntity, Hashable {
    static var typeDisplayRepresentation = TypeDisplayRepresentation(name: "Device")
    static var defaultQuery = DeviceEntityQuery()

    let id: String
    let name: String
    let brand: String?
    let model: String?

    init(snapshotDevice: SnapshotDevice) {
        self.id = snapshotDevice.id
        self.name = snapshotDevice.name
        self.brand = snapshotDevice.brand
        self.model = snapshotDevice.model
    }

    init(device: Device) {
        self.id = device.id
        self.name = device.name
        self.brand = device.brand
        self.model = device.model
    }

    var displayRepresentation: DisplayRepresentation {
        let parts = [brand, model].compactMap { value -> String? in
            guard let value, !value.trimmingCharacters(in: .whitespaces).isEmpty else {
                return nil
            }
            return value
        }
        if parts.isEmpty {
            return DisplayRepresentation(title: "\(name)")
        }
        return DisplayRepresentation(
            title: "\(name)",
            subtitle: "\(parts.joined(separator: " · "))"
        )
    }
}

// MARK: - DeviceEntityQuery

/// Resolves devices for the Shortcuts parameter picker.
///
/// The App Group snapshot is the normal source: it is instant and offline. A
/// brand-new install has no snapshot yet, so a single API read is allowed as a
/// fallback. That read needs the Keychain token; when the phone is locked and
/// the token is unavailable the query simply returns no suggestions rather
/// than failing the whole shortcut.
struct DeviceEntityQuery: EntityQuery {
    func entities(for identifiers: [DeviceEntity.ID]) async throws -> [DeviceEntity] {
        let all = await Self.allDevices()
        return all.filter { identifiers.contains($0.id) }
    }

    func suggestedEntities() async throws -> [DeviceEntity] {
        await Self.allDevices()
    }

    private static func allDevices() async -> [DeviceEntity] {
        // Do not offer a cached device from a signed-out account. The app
        // clears the snapshot on sign-out, but a query can race that clear.
        guard WarrlyIntentSupport.hasSession else { return [] }
        if let snapshot = DeadlineSnapshotStore()?.read(), !snapshot.devices.isEmpty {
            return snapshot.devices.map(DeviceEntity.init(snapshotDevice:))
        }
        if let rows = try? await WarrlyIntentSupport.client().listDevices() {
            return rows.map(DeviceEntity.init(device:))
        }
        return []
    }
}

// MARK: - GetWarrantyExpiryIntent

/// "When does X expire?" — one live read, with an explicit snapshot fallback.
struct GetWarrantyExpiryIntent: AppIntent {
    static var title: LocalizedStringResource = "When does a warranty expire?"
    static var description = IntentDescription(
        "Tells you the date a device's warranty ends, and how many days are left."
    )

    static var parameterSummary: some ParameterSummary {
        Summary("When does \(\.$device) expire?")
    }

    @Parameter(title: "Device")
    var device: DeviceEntity

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let answer = await WarrlyIntentSupport.expiryAnswer(for: device)
        return .result(dialog: "\(answer)")
    }
}

// MARK: - OpenDeviceIntent

/// Opens the app straight on the device detail screen.
///
/// The id is written to the App Group and picked up by `AppRouter` on the next
/// activation. That is deliberate: Siri may run this intent while the app is
/// suspended, and a `UIApplication.open` from an intent process would not carry
/// the destination reliably.
struct OpenDeviceIntent: AppIntent {
    static var title: LocalizedStringResource = "Open a device"
    static var description = IntentDescription(
        "Opens Warrly on the detail screen for one device."
    )
    static var openAppWhenRun: Bool { true }

    static var parameterSummary: some ParameterSummary {
        Summary("Open \(\.$device)")
    }

    @Parameter(title: "Device")
    var device: DeviceEntity

    func perform() async throws -> some IntentResult {
        WarrlyIntentBridge.requestDevice(id: device.id)
        return .result()
    }
}

// MARK: - NextDeadlineIntent

/// "What expires next?" — answered from the snapshot alone, so it works
/// offline and cannot hang on a network read. The dialog carries the snapshot's
/// "as of" line when it is old.
struct NextDeadlineIntent: AppIntent {
    static var title: LocalizedStringResource = "What expires next?"
    static var description = IntentDescription(
        "Reads the next warranty deadline from the last time the app synced."
    )

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let language = SharedInboxLanguage.resolved()
        let snapshot = WarrlyIntentSupport.hasSession
            ? DeadlineSnapshotStore()?.read()
            : nil
        let answer = WarrantyExpiryRules.nextDeadlineAnswer(
            snapshot: snapshot,
            language: language
        )
        return .result(dialog: "\(answer)")
    }
}

// MARK: - Shortcuts discoverability

/// App Shortcuts make the three intents show up in the Shortcuts app and in
/// Siri without the user building anything. Phrases must include
/// `\(.applicationName)`; parameterised phrases use the entity parameter.
struct WarrlyShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: GetWarrantyExpiryIntent(),
            phrases: [
                "When does \(\.$device) expire in \(.applicationName)",
                "\(\.$device) hết hạn khi nào trong \(.applicationName)",
            ],
            shortTitle: "Warranty expiry",
            systemImageName: "shield.lefthalf.filled"
        )
        AppShortcut(
            intent: OpenDeviceIntent(),
            phrases: [
                "Open \(\.$device) in \(.applicationName)",
                "Mở \(\.$device) trong \(.applicationName)",
            ],
            shortTitle: "Open device",
            systemImageName: "shippingbox"
        )
        AppShortcut(
            intent: NextDeadlineIntent(),
            phrases: [
                "What expires next in \(.applicationName)",
                "Mốc nào sắp hết hạn trong \(.applicationName)",
            ],
            shortTitle: "Next deadline",
            systemImageName: "calendar.badge.clock"
        )
    }
}

// MARK: - WarrlyIntentSupport

/// The transport behind the intents: an authenticated client for the one live
/// read, and the snapshot for everything else.
enum WarrlyIntentSupport {
    static func language() -> AppLanguage {
        SharedInboxLanguage.resolved()
    }

    /// Reading the Keychain also answers "is there a session at all?". Without
    /// it, an intent could fall back to a snapshot that a sign-out is about to
    /// remove and answer with the previous account's devices.
    static var hasSession: Bool {
        KeychainStore().read() != nil
    }

    static func client() -> APIClient {
        let baseURL: URL
        do {
            baseURL = try BaseURLResolver.resolve(
                bundleValue: Bundle.main.object(
                    forInfoDictionaryKey: BaseURLResolver.infoPlistKey
                ) as? String,
                environmentValue: ProcessInfo.processInfo.environment[
                    BaseURLResolver.environmentKey
                ]
            )
        } catch {
            // The host app refuses to launch without this. Reaching this branch
            // means the intent ran outside the app bundle; the request will
            // fail and the caller falls back to the snapshot.
            baseURL = URL(string: "https://api.warrly.com")!
        }

        let keychain = KeychainStore()
        return APIClient(
            baseURL: baseURL,
            tokenProvider: { keychain.read() },
            languageProvider: { language() }
        )
    }

    static func expiryAnswer(for entity: DeviceEntity) async -> String {
        let language = language()
        guard hasSession else {
            return WarrantyExpiryRules.answer(
                deviceName: entity.name,
                source: .unavailable,
                language: language
            ).text
        }
        do {
            let detail = try await client().getDevice(id: entity.id)
            return WarrantyExpiryRules.answer(
                deviceName: detail.name,
                source: .live(detail.warranties ?? []),
                language: language
            ).text
        } catch {
            if let snapshot = DeadlineSnapshotStore()?.read(),
               let device = snapshot.devices.first(where: { $0.id == entity.id }),
               let end = device.effectiveWarrantyEnd {
                return WarrantyExpiryRules.answer(
                    deviceName: entity.name,
                    source: .cache(
                        endDate: end,
                        capturedAt: snapshot.capturedAt
                    ),
                    language: language
                ).text
            }
            return WarrantyExpiryRules.answer(
                deviceName: entity.name,
                source: .unavailable,
                language: language
            ).text
        }
    }
}
