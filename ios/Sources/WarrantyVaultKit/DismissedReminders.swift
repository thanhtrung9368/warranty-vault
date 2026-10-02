import Foundation

// MARK: - Dismissed reminders

/// One warranty the user has hidden with "Đã xem, ẩn đi" and can restore.
///
/// ## Where these rows come from
///
/// `GET /api/v1/reminders?includeDismissed=true` — the light reminders feed
/// with the hidden rows opted back in. Each row carries a top-level
/// `isDismissed` flag and its device's `status`, so the "Đã ẩn" list no longer
/// has to pull the whole account export (`devices[].warranties[].reminders[]`)
/// just to find out what is hidden. Without the flag the feed keeps excluding
/// dismissed rows, so its existing callers and response shape are untouched.
///
/// The server returns hidden rows regardless of the owning device's status (a
/// reminder hidden on a device that has since been sold must not disappear),
/// so `deviceStatus` is mapped from whatever the row carries rather than
/// assumed to be ACTIVE.
///
/// Restoring goes through the existing `DELETE /api/v1/warranties/{id}/reminder`.
///
/// This mirrors `website/src/lib/dismissed-reminders.ts`. Pure and synchronous
/// so it can be unit tested without a backend.
public struct DismissedReminder: Sendable, Equatable, Identifiable {
    public let warrantyId: String
    public let deviceId: String
    public let deviceName: String
    public let deviceCategory: String
    public let deviceStatus: DeviceStatus
    public let warrantyType: WarrantyType
    public let warrantyProvider: String?
    public let endDate: Date

    public init(warrantyId: String,
                deviceId: String,
                deviceName: String,
                deviceCategory: String,
                deviceStatus: DeviceStatus,
                warrantyType: WarrantyType,
                warrantyProvider: String?,
                endDate: Date) {
        self.warrantyId = warrantyId
        self.deviceId = deviceId
        self.deviceName = deviceName
        self.deviceCategory = deviceCategory
        self.deviceStatus = deviceStatus
        self.warrantyType = warrantyType
        self.warrantyProvider = warrantyProvider
        self.endDate = endDate
    }

    /// One entry per warranty — a warranty can only be dismissed once at a
    /// time, because dismiss/restore flips the same `Reminder` row.
    public var id: String { warrantyId }

    public var warrantyTypeLabel: String { warrantyType.label }

    /// Vietnamese label for the owning device's category.
    public var deviceCategoryLabel: String { CategoryLabels.label(for: deviceCategory) }

    /// Whole days until `endDate` (negative once it has passed).
    public func daysRemaining(from now: Date = Date(), calendar: Calendar = .current) -> Int {
        calendar.dateComponents([.day],
                                from: calendar.startOfDay(for: now),
                                to: calendar.startOfDay(for: endDate)).day ?? 0
    }
}

public enum DismissedReminders {

    /// Filters a `GET /api/v1/reminders?includeDismissed=true` payload down to
    /// the hidden rows, newest warranty end date first.
    ///
    /// `isDismissed` is optional on the wire — only the opt-in read sends it —
    /// so a row that omits it counts as *visible* and is skipped, which keeps
    /// this correct even if it is handed a plain upcoming feed by mistake.
    /// `device.status` is optional too and defaults to ACTIVE, so the status
    /// badge only shows up for the rows that really are on a non-active device.
    public static func fromReminders(_ reminders: [UpcomingReminder]) -> [DismissedReminder] {
        reminders.compactMap { reminder in
            guard reminder.isDismissed == true else { return nil }
            return DismissedReminder(
                warrantyId: reminder.id,
                deviceId: reminder.deviceId,
                deviceName: reminder.device.name,
                deviceCategory: reminder.device.category,
                deviceStatus: reminder.device.status
                    .flatMap(DeviceStatus.init(rawValue:)) ?? .ACTIVE,
                warrantyType: reminder.type,
                warrantyProvider: reminder.provider,
                endDate: reminder.endDate
            )
        }
        .sorted { $0.endDate > $1.endDate }
    }
}
