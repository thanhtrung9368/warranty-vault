import Foundation

// ============================================================
// WarrantyRepairAdjustment — the display-only "time in repair" extension
//
// Vietnamese consumer law (Luật 19/2023, Điều 30 khoản 2 điểm c) says the time
// a product spends being repaired is **not counted against** its warranty
// period. The API already stores both ends of that interval on every claim
// (`Claim.openedAt` and the server-owned `Claim.closedAt`), so the extension is
// a pure computation over rows the app has already read.
//
// ## Display-only, by construction
//
// Nothing here writes. The server's `Warranty.endDate` is the source of truth
// for what the retailer recorded and for when the server fires its reminders;
// silently moving either would be a data change, not a display change. This
// value is what the *user* is entitled to see, and every surface that shows it
// must say so in the same breath — see `legalNote`.
//
// ## The exact rule
//
// A claim contributes **only** when:
//
//   1. its status is terminal (`RESOLVED`, `REJECTED` or `CANCELLED` — the
//      same partition `ClaimRules` owns), **and**
//   2. the server actually wrote a `closedAt` (a terminal status with no close
//      stamp is an incomplete row, not a completed repair), **and**
//   3. both instants can be read.
//
// `openedAt` / `closedAt` are RFC 3339 **instants** (`openapi.yaml`: "Là
// instant: RFC 3339 UTC kèm Z"), not calendar days. They are converted into the
// caller's calendar before subtracting: a claim closed at 05:30 ICT is stored
// `…T22:30Z` on the previous UTC day, and reading that day off the string made
// the extension one day short; a claim opened at 03:00 ICT is stored `…T20:00Z`
// on the previous day and made it one day long. `ClaimRules.instantDay` owns
// that conversion.
//
// The contribution is `closedDay − openedDay` in **whole calendar days**,
// floored at `0`. A same-day repair therefore adds `0`: no whole day was lost.
// A negative interval (bad historical data) also adds `0` rather than shrinking
// the warranty. `openedAt` is never used to decide openness — the status is the
// source of truth, exactly as `ClaimRules` documents.
//
// The sum is per **device**, because the entitlement belongs to the device's
// warranty cover, not to one package. Callers add it to the effective end (the
// max `endDate`) and to the raw end shown by a reminder row.
// ============================================================

/// The result of applying a device's closed repairs to one warranty end date.
public struct WarrantyRepairExtension: Equatable, Sendable {
    /// Summed whole repair days across contributing claims.
    public let days: Int
    /// How many claims contributed at least one whole day. A same-day repair
    /// is excluded here even though it is a valid closed interval.
    public let claimCount: Int
    /// The server's stored end date, untouched.
    public let rawEnd: Date
    /// `rawEnd + days`, on the caller's calendar.
    public let adjustedEnd: Date

    public init(days: Int, claimCount: Int, rawEnd: Date, adjustedEnd: Date) {
        self.days = max(0, days)
        self.claimCount = max(0, claimCount)
        self.rawEnd = rawEnd
        self.adjustedEnd = adjustedEnd
    }

    /// `true` when at least one whole day was added.
    public var hasExtension: Bool { days > 0 }
}

public enum WarrantyRepairAdjustment {

    // MARK: - Per claim

    /// Whole calendar days one claim contributed, or `nil` when it contributes
    /// nothing — an open claim, a terminal status without `closedAt`, or a wire
    /// value that carries no readable date.
    ///
    /// `0` is a real answer (a same-day repair): it satisfies the "closed and
    /// stamped" tests but adds no whole day.
    ///
    /// The two instants are reduced to the day they fall on **in `calendar`'s
    /// time zone** before they are subtracted — never their UTC day. See the
    /// file header for the two one-day errors the UTC day produced.
    public static func repairDays(
        for claim: Claim,
        calendar: Calendar = .current
    ) -> Int? {
        guard ClaimRules.isClosed(claim),
              let opened = ClaimRules.instantDay(claim.openedAt,
                                                 in: calendar.timeZone),
              let closed = ClaimRules.instantDay(claim.closedAt,
                                                 in: calendar.timeZone)
        else { return nil }

        let days = CalendarDay.days(from: opened, to: closed, calendar: calendar)
        return max(0, days)
    }

    /// The device's summed extension days. `0` when no claim qualifies.
    public static func extensionDays(
        claims: [Claim],
        calendar: Calendar = .current
    ) -> Int {
        claims.reduce(0) { $0 + (repairDays(for: $1, calendar: calendar) ?? 0) }
    }

    /// How many claims contributed at least one day. Reported next to the total
    /// so a sum of `0` from several same-day repairs is not confused with "no
    /// closed repairs".
    public static func contributingClaimCount(
        claims: [Claim],
        calendar: Calendar = .current
    ) -> Int {
        claims.filter { (repairDays(for: $0, calendar: calendar) ?? 0) > 0 }.count
    }

    // MARK: - Per warranty end

    /// Applies the device's claims to one raw end date.
    public static func adjust(
        rawEnd: Date,
        claims: [Claim],
        calendar: Calendar = .current
    ) -> WarrantyRepairExtension {
        let days = extensionDays(claims: claims, calendar: calendar)
        let adjusted = add(days: days, to: rawEnd, calendar: calendar)
        return WarrantyRepairExtension(
            days: days,
            claimCount: contributingClaimCount(claims: claims, calendar: calendar),
            rawEnd: rawEnd,
            adjustedEnd: adjusted
        )
    }

    /// Convenience for a caller holding a claims list already reduced to a
    /// per-device map (the reminders feed reads claims once): reuse the same
    /// arithmetic without re-filtering the same rows.
    public static func add(days: Int,
                           to rawEnd: Date,
                           calendar: Calendar = .current) -> Date {
        guard days > 0 else { return rawEnd }
        return calendar.date(byAdding: .day, value: days, to: rawEnd) ?? rawEnd
    }

    // MARK: - Copy

    /// The sentence every surface that shows an adjusted date must print.
    ///
    /// It names the law and — just as important — says the retailer has not
    /// necessarily agreed to it. The extension is calculated by this app from
    /// the user's own claim records; it is not a negotiated outcome.
    public static var legalNote: String {
        L.t("Đây là quyền lợi theo khoản 2.c Điều 30 Luật 19/2023, không phải thoả thuận với cửa hàng.")
    }

    /// "Đã cộng N ngày sửa chữa vào hạn bảo hành." — the count line that sits
    /// next to `legalNote`. Plurals go through `L.p` so English inflects.
    public static func addedDaysLabel(_ days: Int) -> String {
        L.p("Đã cộng %d ngày sửa chữa vào hạn bảo hành.", days)
    }
}
