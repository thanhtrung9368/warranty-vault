import Foundation

// MARK: - Dismissed reminders

/// One warranty the user has hidden with "Đã xem, ẩn đi" and can restore.
///
/// ## Why this reads the backup export
///
/// The Go reminders feed (`GET /api/v1/reminders`) deliberately *excludes*
/// dismissed rows, and `GET /api/v1/devices/{id}` projects only the active
/// reminder (`services.GetActiveReminderForWarranty`). The only documented
/// read that still carries `Reminder.isDismissed` for dismissed rows is the
/// backup export (`GET /api/v1/backup/export` → `devices[].warranties[].reminders[]`,
/// openapi `BackupDevice`), so that is what the "Đã ẩn" list parses. Restoring
/// then goes through the existing `DELETE /api/v1/warranties/{id}/reminder`.
///
/// This mirrors `website/src/lib/dismissed-reminders.ts` exactly. Pure and
/// synchronous so it can be unit tested without a backend.
public struct DismissedReminder: Sendable, Equatable, Identifiable {
    public let warrantyId: String
    public let deviceId: String
    public let deviceName: String
    public let deviceCategory: String
    public let deviceStatus: DeviceStatus
    /// `nil` when the server sends a type this build doesn't know yet.
    public let warrantyType: WarrantyType?
    /// The raw wire value, so an unknown type still renders.
    public let warrantyTypeRaw: String
    public let warrantyProvider: String?
    public let endDate: Date

    public init(warrantyId: String,
                deviceId: String,
                deviceName: String,
                deviceCategory: String,
                deviceStatus: DeviceStatus,
                warrantyType: WarrantyType?,
                warrantyTypeRaw: String,
                warrantyProvider: String?,
                endDate: Date) {
        self.warrantyId = warrantyId
        self.deviceId = deviceId
        self.deviceName = deviceName
        self.deviceCategory = deviceCategory
        self.deviceStatus = deviceStatus
        self.warrantyType = warrantyType
        self.warrantyTypeRaw = warrantyTypeRaw
        self.warrantyProvider = warrantyProvider
        self.endDate = endDate
    }

    /// One entry per warranty — a warranty can only be dismissed once at a
    /// time, because dismiss/restore flips the same `Reminder` row.
    public var id: String { warrantyId }

    public var warrantyTypeLabel: String { warrantyType?.label ?? warrantyTypeRaw }

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

    /// Structural subset of the v5 backup payload — only the fields the
    /// rollup needs, so a caller can hand over the parsed JSON without casts
    /// and tests can build tiny fixtures.
    private struct Backup: Decodable {
        let devices: [BackupDevice]?
    }

    private struct BackupDevice: Decodable {
        let id: String
        let name: String
        let category: String
        let status: String?
        let warranties: [BackupWarranty]?
    }

    private struct BackupWarranty: Decodable {
        let id: String
        let type: String
        let provider: String?
        let endDate: Date
        let reminders: [BackupReminder]?
    }

    private struct BackupReminder: Decodable {
        let isDismissed: Bool
    }

    /// Parses a `GET /api/v1/backup/export` payload into the list of dismissed
    /// reminders, newest warranty end date first.
    ///
    /// - Throws: whatever `JSONDecoder` throws when `data` isn't a backup
    ///   payload. Callers show "Không tải được danh sách nhắc nhở đã ẩn".
    public static func fromBackup(_ data: Data) throws -> [DismissedReminder] {
        let backup = try APIClient.decoder.decode(Backup.self, from: data)

        var out: [DismissedReminder] = []
        for device in backup.devices ?? [] {
            let status = device.status.flatMap(DeviceStatus.init(rawValue:)) ?? .ACTIVE
            for warranty in device.warranties ?? [] {
                let dismissed = (warranty.reminders ?? []).contains { $0.isDismissed }
                guard dismissed else { continue }
                out.append(DismissedReminder(
                    warrantyId: warranty.id,
                    deviceId: device.id,
                    deviceName: device.name,
                    deviceCategory: device.category,
                    deviceStatus: status,
                    warrantyType: WarrantyType(rawValue: warranty.type),
                    warrantyTypeRaw: warranty.type,
                    warrantyProvider: warranty.provider,
                    endDate: warranty.endDate
                ))
            }
        }
        return out.sorted { $0.endDate > $1.endDate }
    }
}
