import Foundation

// MARK: - WarrlySurface

/// The App Group surface shared by the app, the Share Extension and the
/// WidgetKit extension.
///
/// The widget cannot call the API: it has no bearer token, no Keychain access
/// group and (by design) no network client. So the app writes a small,
/// explicitly stamped snapshot into the same `group.com.warrly` container the
/// Share Extension already uses, and every other surface reads that file.
///
/// The snapshot is **not a cache the widget may silently treat as live**. It
/// carries `capturedAt`; `DeadlineWidgetRules` decides when it is old enough
/// that the UI must say "as of …" instead of implying the numbers are current.
public enum WarrlySurface {
    /// Must match the entitlement on `Warrly`, `ShareExtension` and
    /// `WarrlyWidget` (see `ios/project.yml`). A missing entitlement makes
    /// every entry point behave as "no snapshot yet" rather than crash.
    public static let appGroupIdentifier = SharedInbox.appGroupIdentifier

    /// Folder inside the App Group container. Kept separate from `ShareInbox`
    /// so clearing one never touches the other.
    public static let directoryName = "Surface"

    public static let snapshotFileName = "deadline-snapshot.json"

    /// The `kind` passed to `StaticConfiguration` and to
    /// `WidgetCenter.reloadTimelines(ofKind:)`. One constant so the app and the
    /// extension cannot disagree.
    public static let widgetKind = "WarrlyDeadlines"

    /// The `kind` of the Control Center / Lock Screen control (iOS 18+). It
    /// lives in the same widget extension as the deadline widget and reads the
    /// same App Group hand-off; it never reads the snapshot itself.
    public static let captureControlKind = "WarrlyCaptureReceipt"
}

// MARK: - DeadlineSnapshot

/// Everything the out-of-app surfaces need, captured at one instant.
///
/// Versioned so a future shape can be detected rather than misread. The current
/// version is `2`; the reader accepts an unknown future version (it decodes
/// what it knows) but never invents data for missing keys.
///
/// **v2** adds `counts`, the distinct-device buckets the Lock Screen accessory
/// families show. It is optional on purpose: a snapshot written by build 23
/// (version 1) has no `counts`, and refusing to decode it would blank every
/// widget on iOS 17 until the app is opened once. The accessory rules fall
/// back to counting the stored rows when `counts` is absent.
public struct DeadlineSnapshot: Codable, Equatable, Sendable {
    public static let currentVersion = 2

    public let version: Int

    /// When the app successfully fetched both feeds. This is the only honest
    /// answer to "how old is what the widget is showing".
    public let capturedAt: Date

    /// The reminder horizon the deadlines were read with (90 days, matching
    /// `RemindersStore`). The empty state says this number out loud instead of
    /// claiming the user has no warranties at all.
    public let windowDays: Int

    /// Sorted by `endDate` ascending. Capped by the builder; the widget only
    /// renders the first few, but a Shortcut may ask for the next one.
    public let deadlines: [SnapshotDeadline]

    /// Distinct-device counts across the **whole** filtered reminder feed,
    /// taken before `deadlines` is capped — that cap is exactly why the Lock
    /// Screen cannot count its own rows. `nil` in a version-1 snapshot.
    public let counts: DeadlineSnapshotCounts?

    /// Every device the account currently has, in the list projection the app
    /// already shows. Used by the App Intents entity picker; never by the
    /// widget's visible rows. Spotlight indexes the live list, not this file.
    public let devices: [SnapshotDevice]

    public init(
        version: Int = DeadlineSnapshot.currentVersion,
        capturedAt: Date,
        windowDays: Int,
        deadlines: [SnapshotDeadline],
        counts: DeadlineSnapshotCounts? = nil,
        devices: [SnapshotDevice]
    ) {
        self.version = version
        self.capturedAt = capturedAt
        self.windowDays = windowDays
        self.deadlines = deadlines
        self.counts = counts
        self.devices = devices
    }
}

// MARK: - DeadlineSnapshotCounts

/// How many distinct devices have a deadline in each bucket.
///
/// Counted **per device**, not per warranty: a laptop with a standard and an
/// extended warranty is one device to the person reading the Lock Screen, and
/// the same warranty must not be counted twice. Buckets are cumulative —
/// `within7` includes `dueToday`, `within30` includes both — and only
/// non-negative day counts are included (the feed's window starts at today).
public struct DeadlineSnapshotCounts: Codable, Equatable, Sendable {
    public let dueToday: Int
    public let within7: Int
    public let within30: Int

    public static let zero = DeadlineSnapshotCounts(dueToday: 0, within7: 0, within30: 0)

    public init(dueToday: Int, within7: Int, within30: Int) {
        self.dueToday = dueToday
        self.within7 = within7
        self.within30 = within30
    }

    /// True when no deadline falls inside the next 30 days. The accessory copy
    /// then names the empty window instead of printing three zeroes.
    public var isEmpty: Bool { dueToday == 0 && within7 == 0 && within30 == 0 }

    /// Counts derived from the stored rows. Used for a version-1 snapshot (no
    /// `counts`) and by the widget-gallery placeholder. The stored rows are
    /// capped at 12, so these numbers can undercount a legacy snapshot that
    /// already hit the cap; the next app foreground writes a real v2 snapshot.
    public static func counting(
        deadlines: [SnapshotDeadline],
        now: Date,
        calendar: Calendar = .current
    ) -> DeadlineSnapshotCounts {
        counting(
            rows: deadlines.map { ($0.deviceId, $0.endDate) },
            now: now,
            calendar: calendar
        )
    }

    static func counting(
        reminders: [UpcomingReminder],
        now: Date,
        calendar: Calendar = .current
    ) -> DeadlineSnapshotCounts {
        counting(
            rows: reminders.map { ($0.deviceId, $0.endDate) },
            now: now,
            calendar: calendar
        )
    }

    private static func counting(
        rows: [(deviceId: String, endDate: Date)],
        now: Date,
        calendar: Calendar
    ) -> DeadlineSnapshotCounts {
        var today = Set<String>()
        var seven = Set<String>()
        var thirty = Set<String>()

        for row in rows {
            let days = DeadlineWidgetRules.daysRemaining(
                endDate: row.endDate,
                now: now,
                calendar: calendar
            )
            // The reminders feed starts at today 00:00, so a negative value is
            // only possible from a stale/foreign snapshot. "Daily" buckets must
            // not silently become "overdue" buckets.
            guard days >= 0 else { continue }
            if days <= 30 { thirty.insert(row.deviceId) }
            if days <= 7 { seven.insert(row.deviceId) }
            if days == 0 { today.insert(row.deviceId) }
        }

        return DeadlineSnapshotCounts(
            dueToday: today.count,
            within7: seven.count,
            within30: thirty.count
        )
    }
}

// MARK: - SnapshotDeadline

/// One warranty expiry the reminders feed reported.
///
/// `endDate` is stored as an instant; the day count is deliberately **not**
/// stored. A timeline entry at midnight must be able to recompute "1 day left"
/// → "expires today" without waiting for the app to write a new snapshot.
public struct SnapshotDeadline: Codable, Equatable, Sendable, Identifiable {
    public let warrantyId: String
    public let deviceId: String
    public let deviceName: String
    public let deviceCategory: String
    /// Raw `WarrantyType` wire value (`STANDARD`, `EXTENDED`, `THIRD_PARTY`).
    /// Kept as a string so a future type does not fail decoding an old snapshot.
    public let warrantyType: String
    public let provider: String?
    public let endDate: Date

    public var id: String { warrantyId }

    public init(
        warrantyId: String,
        deviceId: String,
        deviceName: String,
        deviceCategory: String,
        warrantyType: String,
        provider: String?,
        endDate: Date
    ) {
        self.warrantyId = warrantyId
        self.deviceId = deviceId
        self.deviceName = deviceName
        self.deviceCategory = deviceCategory
        self.warrantyType = warrantyType
        self.provider = provider
        self.endDate = endDate
    }
}

// MARK: - SnapshotDevice

/// A device as the app's own list renders it. Only fields the out-of-app
/// surfaces actually need are copied here; the serial number is deliberately
/// **not** in the shared file (Spotlight indexes it from the live list instead,
/// and the widget/App Intents never display it). Notes, claims, OCR text,
/// prices and account identity are never copied either.
public struct SnapshotDevice: Codable, Equatable, Sendable, Identifiable {
    public let id: String
    public let name: String
    public let category: String
    public let brand: String?
    public let model: String?
    /// Raw `DeviceStatus` wire value.
    public let status: String
    /// The list projection's effective warranty end, when it has one.
    public let effectiveWarrantyEnd: Date?

    public init(
        id: String,
        name: String,
        category: String,
        brand: String?,
        model: String?,
        status: String,
        effectiveWarrantyEnd: Date?
    ) {
        self.id = id
        self.name = name
        self.category = category
        self.brand = brand
        self.model = model
        self.status = status
        self.effectiveWarrantyEnd = effectiveWarrantyEnd
    }
}

// MARK: - DeadlineSnapshotBuilder

/// Builds the snapshot from the two existing reads. Pure and testable: it takes
/// values, never a client, and never reads the clock on its own unless the
/// caller asks for `Date()`.
public enum DeadlineSnapshotBuilder {
    /// The app's reminders screen uses 90 days; the widget uses the same
    /// horizon so the two cannot tell different stories about "due".
    public static let windowDays = 90

    /// Enough for the widget's four rows and Siri's "next one" question, while
    /// keeping the App Group file small. The reminders feed itself is heavier.
    public static let maxDeadlines = 12

    public static func build(
        devices: [Device],
        reminders: [UpcomingReminder],
        capturedAt: Date = Date(),
        windowDays: Int = DeadlineSnapshotBuilder.windowDays,
        calendar: Calendar = .current
    ) -> DeadlineSnapshot {
        var seen = Set<String>()
        // Filter first, then count, then cap. Counting the capped list would
        // make "9 due in 30 days" impossible to show on the Lock Screen as soon
        // as more than twelve deadlines exist.
        let visible = reminders
            // The default feed already excludes hidden reminders. Filtering
            // again here keeps a caller that passed `includeDismissed=true`
            // from silently resurrecting a deadline the user chose to hide.
            .filter { $0.isDismissed != true }
            .filter { seen.insert($0.id).inserted }

        let counts = DeadlineSnapshotCounts.counting(
            reminders: visible,
            now: capturedAt,
            calendar: calendar
        )

        let deadlineRows: [SnapshotDeadline] = visible
            .sorted { lhs, rhs in
                if lhs.endDate != rhs.endDate { return lhs.endDate < rhs.endDate }
                return lhs.device.name.localizedCaseInsensitiveCompare(rhs.device.name)
                    == .orderedAscending
            }
            .prefix(maxDeadlines)
            .map { reminder in
                SnapshotDeadline(
                    warrantyId: reminder.id,
                    deviceId: reminder.deviceId,
                    deviceName: reminder.device.name,
                    deviceCategory: reminder.device.category,
                    warrantyType: reminder.type.rawValue,
                    provider: reminder.provider,
                    endDate: reminder.endDate
                )
            }

        let deviceRows = devices
            .map { device in
                SnapshotDevice(
                    id: device.id,
                    name: device.name,
                    category: device.category,
                    brand: device.brand,
                    model: device.model,
                    status: device.status.rawValue,
                    effectiveWarrantyEnd: device.effectiveWarrantyEnd
                )
            }
            .sorted {
                $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending
            }

        return DeadlineSnapshot(
            capturedAt: capturedAt,
            windowDays: windowDays,
            deadlines: deadlineRows,
            counts: counts,
            devices: deviceRows
        )
    }
}

// MARK: - DeadlineSnapshotReadOutcome

/// What `DeadlineSnapshotStore.readOutcome()` found. The three cases have three
/// different user-facing answers, so collapsing them would make the widget
/// claim "nothing is due" when it simply could not read the file.
///
/// `unreadable` is the lock-before-first-unlock case: the App Group file exists
/// but the process cannot read or decode it. It is **not** an empty account.
public enum DeadlineSnapshotReadOutcome: Equatable, Sendable {
    /// No snapshot has ever been written (fresh install, signed out, or the
    /// App Group entitlement is missing).
    case missing
    /// A file exists but its bytes are unavailable or do not decode.
    case unreadable
    case snapshot(DeadlineSnapshot)

    public var snapshot: DeadlineSnapshot? {
        if case let .snapshot(snapshot) = self { return snapshot }
        return nil
    }
}

// MARK: - DeadlineSnapshotStore

/// Reads and writes the snapshot inside the App Group container.
///
/// `init?(appGroupIdentifier:)` is what the app and the extension use;
/// `init(rootURL:)` exists so tests run against a temporary directory. A
/// missing container returns `nil` — the app keeps working with no widget, and
/// the widget renders its "open the app once" state.
public struct DeadlineSnapshotStore {
    public let fileURL: URL
    private let fileManager: FileManager

    public init(fileURL: URL, fileManager: FileManager = .default) {
        self.fileURL = fileURL
        self.fileManager = fileManager
    }

    public init(rootURL: URL, fileManager: FileManager = .default) {
        self.init(
            fileURL: rootURL.appendingPathComponent(WarrlySurface.snapshotFileName),
            fileManager: fileManager
        )
    }

    public init?(
        appGroupIdentifier: String = WarrlySurface.appGroupIdentifier,
        fileManager: FileManager = .default
    ) {
        guard let container = fileManager.containerURL(
            forSecurityApplicationGroupIdentifier: appGroupIdentifier
        ) else { return nil }
        self.init(
            rootURL: container.appendingPathComponent(
                WarrlySurface.directoryName, isDirectory: true
            ),
            fileManager: fileManager
        )
    }

    /// The last complete snapshot, or `nil` when there is none (or it is
    /// unreadable). Kept for callers that only need the payload — App Intents
    /// and Shortcuts — where the two failure modes lead to the same fallback.
    /// The widget uses `readOutcome()` because its Lock Screen copy must not
    /// turn "could not read" into "nothing due".
    public func read() -> DeadlineSnapshot? {
        readOutcome().snapshot
    }

    /// Distinguishes a missing file from a file this process cannot read.
    ///
    /// `fileExists` is checked before the read so a locked, unreadable file is
    /// reported as `unreadable` instead of looking like a fresh install. Both
    /// states are silent in the log: the extension has no logger and must not
    /// print paths.
    public func readOutcome() -> DeadlineSnapshotReadOutcome {
        guard fileManager.fileExists(atPath: fileURL.path) else { return .missing }
        guard let data = try? Data(contentsOf: fileURL) else { return .unreadable }
        guard let snapshot = try? Self.decoder.decode(DeadlineSnapshot.self, from: data) else {
            return .unreadable
        }
        return .snapshot(snapshot)
    }

    /// Writes atomically. A half-written file must never be readable: the
    /// widget process can be woken between any two instructions.
    public func write(_ snapshot: DeadlineSnapshot) throws {
        try fileManager.createDirectory(
            at: fileURL.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        let data = try Self.encoder.encode(snapshot)
        try data.write(to: fileURL, options: .atomic)
    }

    /// Removes the snapshot. Used on sign-out so the next account on the same
    /// phone cannot see the previous one's devices in a widget.
    public func clear() {
        try? fileManager.removeItem(at: fileURL)
    }

    private static let encoder: JSONEncoder = {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .secondsSince1970
        encoder.outputFormatting = [.sortedKeys]
        return encoder
    }()

    private static let decoder: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .secondsSince1970
        return decoder
    }()
}
