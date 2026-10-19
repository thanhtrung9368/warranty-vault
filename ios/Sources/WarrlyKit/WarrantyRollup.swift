// WarrantyRollup — the four warranty numbers on the dashboard, computed in one
// place so iOS, Android and the web agree about the same device.
//
// ## Why "Còn bảo hành" is not `active - soon`
//
// It used to be exactly that, and it was wrong twice over:
//
//  * a warranty ending in 9 days is *still* a warranty, so subtracting every
//    soon-to-expire device under-counted the protected list — with the seeded
//    account (one iPhone 9 days out) the tile read 0 while the row underneath
//    said "Còn 9 ngày";
//  * `activeDevices` came from the server's `devicesByStatus[.ACTIVE]`, which
//    counts rows whose status is ACTIVE whatever their warranty says, so the
//    subtraction also *kept* devices whose warranty had already lapsed.
//
// The day of expiry itself was treated as neither in warranty nor expired, so a
// device whose plan ended today fell out of all three tiles and the device count
// stopped adding up.
//
// The definition is now the one the tile's label states: in warranty while
// `effectiveWarrantyEnd >= today`. Within-30-days is an *alert*, not a different
// warranty state, so `soon` is a subset of `inWarranty` — never a second bucket
// to subtract. This mirrors `deviceRollup()` in
// android/app/src/main/java/com/warrly/ui/screens/dashboard/DeviceRollup.kt;
// both were fixed from the same field report, and a change here belongs there
// too.
//
// A device with no warranty (`effectiveWarrantyEnd == nil`) counts toward
// `total` only. A non-ACTIVE device is not "in warranty" — a sold or lost device
// is not something the user still has covered — but a past end date is expired
// whatever its status.

import Foundation

/// The four dashboard warranty numbers.
public struct WarrantyRollup: Sendable, Equatable {
    /// Every device on the account, warranty or not.
    public let total: Int
    /// "Còn bảo hành": status ACTIVE and the effective warranty end has not passed.
    public let inWarranty: Int
    /// "Sắp hết ≤30 ngày": the subset of `inWarranty` ending within `soonDays`.
    public let soon: Int
    /// "Đã hết hạn": every device whose effective warranty end has passed.
    public let expired: Int

    public init(total: Int, inWarranty: Int, soon: Int, expired: Int) {
        self.total = total
        self.inWarranty = inWarranty
        self.soon = soon
        self.expired = expired
    }
}

/// Rolls the device list up into the four dashboard numbers.
///
/// `today` and `soonDays` are injectable so the boundaries are testable rather
/// than dependent on the wall clock.
public func warrantyRollup(
    devices: [Device],
    today: Date = Date(),
    soonDays: Int = 30,
    calendar: Calendar = .current
) -> WarrantyRollup {
    var inWarranty = 0
    var soon = 0
    var expired = 0

    for device in devices {
        guard let end = device.effectiveWarrantyEnd else { continue }
        let days = CalendarDay.days(from: today, to: end, calendar: calendar)
        if days < 0 { expired += 1 }
        guard device.status == .ACTIVE, days >= 0 else { continue }
        inWarranty += 1
        if days <= soonDays { soon += 1 }
    }

    return WarrantyRollup(
        total: devices.count,
        inWarranty: inWarranty,
        soon: soon,
        expired: expired
    )
}
