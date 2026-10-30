import Foundation

// Warranty claim rules ("Sửa chữa & bảo hành") — the pure half of the feature.
//
// A claim is the answer to `Device.status == .BROKEN`: it records where the
// machine went, what the shop said and whether the warranty paid. Everything
// this file decides is decided from the claim payload alone, so the device
// detail screen, the form and the tests can never disagree about it:
//
//   * **Open vs closed.** `OPEN` and `IN_REPAIR` are open; `RESOLVED`,
//     `REJECTED` and `CANCELLED` are closed. The status is the source of truth —
//     `closedAt` is a server-written timestamp, not the definition.
//   * **One open claim per device.** The server enforces it; `openClaim(in:)`
//     and `hasOpenClaim(in:)` are how the client mirrors it without a round trip.
//   * **The BROKEN dead end.** `needsRepairNudge` is the selector behind
//     "this device is marked broken and nothing was recorded about it" — the gap
//     this feature exists to close.
//   * **Money.** `costLabel` renders the VND amount, keeping "not recorded"
//     (`nil`) distinct from a real `0`.
//   * **The 409.** `saveFailure(_:)` turns `limit_reached` into copy with a way
//     out instead of a generic error.
//
// Dates stay the raw wire strings (see `Claim`): only their day is shown, and
// `dayLabel` reads it off the string so the calendar day cannot slide.

/// Which side of the one-open-claim rule a claim is on.
public enum ClaimLifecycle: Equatable, Sendable {
    /// `OPEN` or `IN_REPAIR` — the repair is still in progress.
    case open
    /// `RESOLVED`, `REJECTED` or `CANCELLED` — the repair is finished.
    case closed
}

public enum ClaimRules {

    // MARK: - Open vs closed

    /// The statuses that mean "in progress" and count against the one-open rule.
    public static let openStatuses: Set<ClaimStatus> = [.OPEN, .IN_REPAIR]

    /// The statuses that mean "finished". `closedAt` is server-owned for these.
    public static let closedStatuses: Set<ClaimStatus> = [.RESOLVED, .REJECTED, .CANCELLED]

    /// The derived lifecycle of a status. This is the ONLY place the partition
    /// is written down: every other helper below delegates here, so adding a
    /// status to the enum forces one decision instead of three.
    public static func lifecycle(_ status: ClaimStatus) -> ClaimLifecycle {
        openStatuses.contains(status) ? .open : .closed
    }

    public static func isOpen(_ status: ClaimStatus) -> Bool {
        lifecycle(status) == .open
    }

    public static func isClosed(_ status: ClaimStatus) -> Bool {
        lifecycle(status) == .closed
    }

    public static func isOpen(_ claim: Claim) -> Bool { isOpen(claim.status) }

    public static func isClosed(_ claim: Claim) -> Bool { isClosed(claim.status) }

    // MARK: - One open claim per device

    /// The device's open claims, oldest first. The server refuses a second open
    /// claim, so this is normally 0 or 1 entries; a payload with more is still
    /// handled without losing a row.
    public static func openClaims(in claims: [Claim]) -> [Claim] {
        claims.filter(isOpen).sorted(by: isOlderFirst)
    }

    public static func hasOpenClaim(in claims: [Claim]) -> Bool {
        claims.contains(where: isOpen)
    }

    /// The open claim a "device already has a repair open" answer points at.
    ///
    /// Deliberately the **oldest** open claim: if a server ever allows two, the
    /// one that has been open longest is the one blocking a new one, and it is
    /// the one the user should resolve first. `nil` when nothing is open.
    public static func openClaim(in claims: [Claim]) -> Claim? {
        openClaims(in: claims).first
    }

    /// Display order for a device's claims: **open first**, then newest first
    /// within each group, with the id as a stable tie-break.
    ///
    /// The open claim is what the user came to see, so it must not be buried
    /// under a year of history. `openedAt` is an ISO-shaped wire string, so a
    /// plain lexicographic comparison orders it correctly; a missing value sorts
    /// last inside its group instead of jumping to the top.
    public static func sortedForDisplay(_ claims: [Claim]) -> [Claim] {
        claims.sorted { lhs, rhs in
            let lhsOpen = isOpen(lhs)
            let rhsOpen = isOpen(rhs)
            if lhsOpen != rhsOpen { return lhsOpen }

            let lhsKey = openedSortKey(lhs)
            let rhsKey = openedSortKey(rhs)
            if lhsKey != rhsKey { return lhsKey > rhsKey }
            return lhs.id < rhs.id
        }
    }

    /// Display order for a **cross-device** list: strictly newest `openedAt`
    /// first, open and closed mixed together.
    ///
    /// The cross-device screen answers "what have I had repaired lately?", so
    /// the date is the ordering the user expects; pinning open rows to the top
    /// (as the per-device section does) would make an old open claim outrank a
    /// repair closed yesterday. A missing `openedAt` sorts last, and the id is
    /// the stable tie-break.
    public static func sortedNewestFirst(_ claims: [Claim]) -> [Claim] {
        claims.sorted { lhs, rhs in
            let lhsKey = openedSortKey(lhs)
            let rhsKey = openedSortKey(rhs)
            let lhsMissing = lhsKey.isEmpty
            let rhsMissing = rhsKey.isEmpty
            if lhsMissing != rhsMissing { return !lhsMissing }
            if lhsKey != rhsKey { return lhsKey > rhsKey }
            return lhs.id < rhs.id
        }
    }

    // MARK: - The BROKEN dead end

    /// `true` when a device is marked **BROKEN** and nothing is being done about
    /// it — the exact state this feature exists to catch.
    ///
    /// This is a selector, not an alert: the device detail renders an inline
    /// card offering "start a repair" when it is true, and nothing when any
    /// claim is already open. `LOST` and `SOLD` devices do not nudge — the gap
    /// is specifically "broken, and no repair has been recorded".
    public static func needsRepairNudge(status: DeviceStatus, claims: [Claim]) -> Bool {
        status == .BROKEN && !hasOpenClaim(in: claims)
    }

    /// Convenience so a caller holding a device and its claims cannot pass the
    /// wrong claim list.
    public static func needsRepairNudge(device: Device, claims: [Claim]) -> Bool {
        needsRepairNudge(status: device.status, claims: claims)
    }

    // MARK: - Money

    /// The claim's cost as grouped VND (`"1.500.000 ₫"`), or `nil` when the
    /// claim carries no cost — which is different from `0`.
    ///
    /// `0` is a real value and renders `"0 ₫"`: a free repair is an answer, and
    /// collapsing it into "not recorded" would hide the most common outcome of a
    /// warranty repair. The server rejects a negative cost, so no sign handling
    /// is needed here beyond what `VndFormat` already does.
    public static func costLabel(_ cost: Int?) -> String? {
        guard let cost else { return nil }
        return VndFormat.string(Int64(cost))
    }

    // MARK: - Reading the stored days

    /// `dd/MM/yyyy` for a wire date, or `nil` when there is not one there.
    ///
    /// Delegates to the same day reduction `DeviceResale` and
    /// `DeviceReturnWindow` use: the value is a calendar day, so parsing it as
    /// an instant could move the calendar day by the device's offset.
    public static func dayLabel(_ wire: String?) -> String? {
        DeviceReturnWindow.deadlineLabel(wire)
    }

    /// `YYYY-MM-DD` → the `Date` a date picker should hold for that day, in
    /// `timeZone`. `nil` when the wire value carries no readable day.
    public static func dayDate(_ wire: String?, in timeZone: TimeZone = .current) -> Date? {
        WireDay.date(from: wire, in: timeZone)
    }

    /// The `YYYY-MM-DD` a `Date` stands for in `timeZone` — the inverse of
    /// `dayDate(_:in:)`. Used for the form's write side.
    public static func dayString(_ date: Date, in timeZone: TimeZone = .current) -> String {
        WireDay.string(from: date, in: timeZone)
    }

    // MARK: - Validation

    // Rune caps mirrored from the contract (`ClaimInput`'s `maxLength` values).
    // The form enforces them as the user types, in Unicode scalars — the same
    // unit Go's `[]rune` counts — so an over-long sentence is a blocked keystroke
    // rather than a 400 after the round trip.

    public static let maxIssueRunes = 1000
    public static let maxDiagnosisRunes = 500
    public static let maxOutcomeRunes = 500
    public static let maxTicketNumberRunes = 100
    public static let maxServiceCenterRunes = 200

    /// Client-side mirror of the contract's two hard rules, in the server's
    /// `fieldErrors` shape. `[:]` means "send it".
    ///
    ///  * `issue` is required and is trimmed before it is checked, so a box full
    ///    of spaces is not an answer;
    ///  * `cost` is non-negative when present (`nil` is allowed).
    ///
    /// Everything else on the form is optional by contract; the server may still
    /// reject a `warrantyId` that belongs to another device, and that error is
    /// surfaced from `APIError.fieldErrors` untouched.
    public static func validationErrors(issue: String, cost: Int?) -> [String: [String]] {
        var errors: [String: [String]] = [:]
        if issue.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors["issue"] = [L.t("Vui lòng nhập mô tả lỗi.")]
        }
        if let cost, cost < 0 {
            errors["cost"] = [L.t("Chi phí không được âm.")]
        }
        return errors
    }

    public static func isValid(issue: String, cost: Int?) -> Bool {
        validationErrors(issue: issue, cost: cost).isEmpty
    }

    // MARK: - The 409

    /// Title for the "a repair is already open" surface, both the proactive
    /// warning on the create form and the 409 alert.
    public static var openClaimTitle: String { L.t("Thiết bị đã có lần sửa chữa đang mở") }

    /// Body copy for the same surface. It says what the rule is *and* what to do
    /// instead, so the user is never left with "limit reached" and no next step.
    public static var openClaimExistsMessage: String {
        L.t("Mỗi thiết bị chỉ có một lần sửa chữa đang mở. Cập nhật lần đang mở thay vì tạo lần mới.")
    }

    /// Button title that takes the user to the claim that is already open.
    public static var openClaimActionTitle: String { L.t("Xem lần đang mở") }

    /// Maps the error a claim save can raise into the cases the form renders.
    ///
    /// The real wire code is **lowercase** `limit_reached` (the Go error writer
    /// lowercases the service constant, exactly as it does for the attachment
    /// limit), but the comparison is case-insensitive so the uppercase spelling
    /// in the contract table still works.
    ///
    /// Only a 409 **meaning limit-reached** becomes `openClaimExists`. A 409
    /// with another code is a different conflict and keeps the server's own
    /// message — showing "a repair is already open" there would send the user
    /// hunting for a claim that was never the problem.
    public static func saveFailure(_ error: Error) -> ClaimSaveFailure {
        guard let apiError = error as? APIError else {
            return .other(error.localizedDescription)
        }
        guard case let .server(status, envelope) = apiError else {
            return .other(apiError.localizedDescription)
        }
        if status == 409,
           envelope.error.caseInsensitiveCompare("limit_reached") == .orderedSame {
            return .openClaimExists
        }
        if status == 404 {
            return .claimNotFound
        }
        return .other(envelope.message ?? apiError.localizedDescription)
    }

    // MARK: - Private

    /// Descending lexicographic key for `openedAt`. Absent last.
    private static func openedSortKey(_ claim: Claim) -> String {
        claim.openedAt.trimmingCharacters(in: .whitespaces)
    }

    private static func isOlderFirst(_ lhs: Claim, _ rhs: Claim) -> Bool {
        let lhsKey = openedSortKey(lhs)
        let rhsKey = openedSortKey(rhs)
        if lhsKey != rhsKey { return lhsKey < rhsKey }
        return lhs.id < rhs.id
    }
}

/// What went wrong while saving a claim, in the terms the form needs.
///
/// `openClaimExists` is the only case with a chosen recovery — show the open
/// claim and let the user go to it. The others have nothing to open.
public enum ClaimSaveFailure: Equatable, Sendable {
    /// The device already has an `OPEN`/`IN_REPAIR` claim (`409 limit_reached`).
    case openClaimExists
    /// The claim being edited no longer exists (`404`).
    case claimNotFound
    /// Anything else, carrying the server's already-localized message.
    case other(String)

    public var isOpenClaimExists: Bool {
        if case .openClaimExists = self { return true }
        return false
    }

    public var isClaimNotFound: Bool {
        if case .claimNotFound = self { return true }
        return false
    }

    /// Short title for the alert.
    public var title: String {
        switch self {
        case .openClaimExists: return ClaimRules.openClaimTitle
        case .claimNotFound:   return L.t("Không tìm thấy lần sửa chữa")
        case .other:           return L.t("Không lưu được lần sửa chữa")
        }
    }

    /// Body copy. For `openClaimExists` it names the rule and the way forward;
    /// for the other cases the server's message is passed through untouched.
    public var message: String {
        switch self {
        case .openClaimExists:
            return ClaimRules.openClaimExistsMessage
        case .claimNotFound:
            return L.t("Lần sửa chữa này không còn tồn tại. Có thể nó đã bị xoá ở nơi khác.")
        case .other(let message):
            return message
        }
    }
}
