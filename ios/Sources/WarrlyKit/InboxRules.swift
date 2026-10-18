import Foundation

// Capture-first inbox rules — the pure half of "attachments with no device yet".
//
// The contract (openapi `/api/v1/inbox`, `POST /api/v1/attachments/{id}/file`)
// splits one question into three small ones, and each of them is a place where a
// UI-only implementation would silently lie:
//
//  1. **How many are waiting?** The nav badge counts the rows the inbox
//     endpoint returned, minus any row that explicitly carries a device id.
//     The endpoint is the authority: the implemented `AttachmentMeta` DTO omits
//     `deviceId` entirely, so absence means "unfiled", not "unknown".
//  2. **Is this row unfiled?** `deviceId == nil` is the contract's definition.
//     Blank is treated as absent as well: an empty string is not a device id,
//     and treating it as one would hide the row from the inbox forever.
//  3. **What does a failed filing mean?** `409 limit_reached` (lowercased on
//     the wire) is not a generic error — it is "this device is full, and the
//     item is still in your inbox". The wording has to name both ways out (pick
//     another device, or delete), because retrying the same device can never
//     succeed.

public enum InboxRules {

    // MARK: - Count badge

    /// Values above this are rendered as `"99+"`; the row badge is a capsule,
    /// not a number field.
    public static let maxBadgeCount = 99

    /// Text for the inbox badge, or `nil` when there is nothing waiting.
    ///
    /// `nil` (rather than `"0"`) is what lets SwiftUI omit the badge entirely.
    /// Negative input is treated as empty rather than rendered as `-1`.
    public static func badgeText(for count: Int) -> String? {
        guard count > 0 else { return nil }
        return count > maxBadgeCount ? "\(maxBadgeCount)+" : "\(count)"
    }

    /// The badge for a fetched inbox payload.
    ///
    /// Every row the endpoint returns is unfiled by definition; counting through
    /// `isUnfiled` only matters if a future/foreign payload explicitly carries a
    /// device id. It must never drop a row just because `deviceId` is absent.
    public static func badgeText(for attachments: [AttachmentMeta]) -> String? {
        badgeText(for: unfiledCount(attachments))
    }

    /// Number of attachments in `attachments` that still have no device.
    public static func unfiledCount(_ attachments: [AttachmentMeta]) -> Int {
        attachments.reduce(into: 0) { total, attachment in
            if isUnfiled(attachment) { total += 1 }
        }
    }

    // MARK: - Filed / unfiled

    /// `true` when the attachment has no device yet — the inbox definition.
    ///
    /// `nil` and a whitespace-only string both mean "no device". `nil` is the
    /// common case: the currently implemented `AttachmentMeta` DTO omits
    /// `deviceId` entirely, and the inbox endpoint only ever returns unfiled
    /// rows. Treating absence as unfiled is therefore both safe and required —
    /// the opposite default would empty the inbox for every real server payload.
    public static func isUnfiled(_ attachment: AttachmentMeta) -> Bool {
        guard let raw = attachment.deviceId else { return true }
        return raw.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    /// `true` when the attachment is already on a device, i.e. the opposite of
    /// `isUnfiled`. Kept as a named helper so UI code reads without a negation.
    public static func isFiled(_ attachment: AttachmentMeta) -> Bool {
        !isUnfiled(attachment)
    }

    // MARK: - Filing failures

    /// Maps the error `POST /api/v1/attachments/{id}/file` can raise into the
    /// three cases the UI actually renders.
    ///
    /// The real wire code is **lowercase** `limit_reached`: the Go error writer
    /// lowercases the service constant before building the envelope, and the
    /// shared error schema in `openapi.yaml` documents that form. The comparison
    /// is case-insensitive so the uppercase spelling in the endpoint description
    /// (and any future server that stops lowercasing) still works.
    ///
    /// Only a 409 **meaning limit-reached** is `deviceFull`. A 409 with another
    /// code is a different conflict and keeps the server's own message — showing
    /// "device is full" for it would send the user hunting for a device slot
    /// that was never the problem.
    public static func fileFailure(_ error: Error) -> InboxFileFailure {
        guard let apiError = error as? APIError else {
            return .other(error.localizedDescription)
        }
        guard case let .server(status, envelope) = apiError else {
            return .other(apiError.localizedDescription)
        }
        // Case-insensitive on the code: the contract spells it `LIMIT_REACHED`,
        // while the real handler emits `limit_reached`. Both mean the same 409
        // and both deserve the same two ways out.
        if status == 409,
           envelope.error.caseInsensitiveCompare("LIMIT_REACHED") == .orderedSame {
            return .deviceFull
        }
        if status == 404 {
            return .attachmentNotFound
        }
        return .other(envelope.message ?? apiError.localizedDescription)
    }
}

/// What went wrong while filing an inbox item, in the terms the screen needs.
///
/// `deviceFull` is the only case with a chosen recovery: keep the item, pick a
/// different device, or delete it. The other cases have nothing to pick — they
/// are either gone or a transient/server-side failure.
public enum InboxFileFailure: Equatable, Sendable {
    /// The target device already has its five attachments (`409 limit_reached`).
    case deviceFull
    /// The attachment no longer exists (deleted elsewhere; `404`).
    case attachmentNotFound
    /// Anything else, carrying the server's already-localized message.
    case other(String)

    /// Whether the device picker should stay available as the way out.
    public var isDeviceFull: Bool {
        if case .deviceFull = self { return true }
        return false
    }

    /// Whether the row is gone and should simply leave the inbox.
    public var isAttachmentNotFound: Bool {
        if case .attachmentNotFound = self { return true }
        return false
    }

    /// Dialog title. Short enough to be read before the message.
    public var title: String {
        switch self {
        case .deviceFull:          return L.t("Thiết bị đã đầy")
        case .attachmentNotFound:  return L.t("Không tìm thấy tệp")
        case .other:               return L.t("Không gán được tệp")
        }
    }

    /// The body copy. For `deviceFull` it names both recovery paths explicitly;
    /// for the other cases the server's message is passed through untouched.
    public var message: String {
        switch self {
        case .deviceFull:
            return L.t("Thiết bị này đã có đủ 5 tệp đính kèm. Chọn thiết bị khác, hoặc xoá tệp này.")
        case .attachmentNotFound:
            return L.t("Không tìm thấy tệp đính kèm. Có thể nó đã bị xoá ở nơi khác.")
        case .other(let message):
            return message
        }
    }
}
