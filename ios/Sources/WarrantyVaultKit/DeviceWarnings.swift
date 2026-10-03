import Foundation

// MARK: - Non-blocking serial advisories
//
// Mirrors the `warnings` array `POST /api/v1/devices` and
// `PATCH /api/v1/devices/{id}` return next to `device` (openapi.yaml →
// DeviceWarning), and the identical array inside the AI receipt draft.
//
// The rule that matters: **nothing is blocked.** The device *was* saved, and the
// only correct client behaviour is a yellow advisory that says so — never an
// error state, never a reason to drop the value the user typed (a serial is not
// always an IMEI, and refusing a valid serial is worse than the typo it would
// prevent).

/// One advisory about a value that *was* stored.
public struct DeviceWarning: Decodable, Sendable, Equatable, Hashable {
    /// Wire code — kept as a string so a new server-side code can't fail
    /// decoding; `codeKind` maps the three documented ones.
    public let code: String
    /// Request/draft field the warning is about. Always `serialNumber` today,
    /// read as a string for the same reason.
    public let field: String
    /// Vietnamese sentence written to be shown to the user as-is.
    public let message: String

    public var codeKind: DeviceWarningCode? { DeviceWarningCode(rawValue: code) }

    /// What to render: the API's own sentence whenever it sent one, otherwise a
    /// local fallback for the known codes, otherwise the code itself.
    public var displayMessage: String {
        let trimmed = message.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmed.isEmpty { return trimmed }
        if let kind = codeKind { return kind.fallbackMessage }
        return code
    }

    /// Vietnamese label of the field this is about ("Serial / IMEI").
    public var fieldLabel: String { DeviceWarningRules.fieldLabel(field) }
}

/// The three codes the API documents today.
public enum DeviceWarningCode: String, Sendable, CaseIterable {
    /// 15 digits but the Luhn checksum fails — usually one mistyped digit.
    case IMEI_CHECKSUM
    /// All-digits string of length 14/16/17, i.e. not a 15-digit IMEI.
    case IMEI_LENGTH
    /// Already used by a *different* device of the same user. `Device.serialNumber`
    /// has no unique index, so this can only ever be an advisory.
    case SERIAL_DUPLICATE

    /// Short label for a chip.
    public var label: String {
        switch self {
        case .IMEI_CHECKSUM:   return "IMEI sai checksum"
        case .IMEI_LENGTH:     return "Độ dài IMEI"
        case .SERIAL_DUPLICATE: return "Serial trùng"
        }
    }

    /// Used **only** when the server sent an empty `message`.
    public var fallbackMessage: String {
        switch self {
        case .IMEI_CHECKSUM:
            return "IMEI đủ 15 chữ số nhưng sai số kiểm tra — có thể bạn gõ nhầm một chữ số."
        case .IMEI_LENGTH:
            return "Chuỗi số này không phải IMEI 15 chữ số."
        case .SERIAL_DUPLICATE:
            return "Serial này đã có ở một thiết bị khác của bạn."
        }
    }
}

public enum DeviceWarningRules {
    /// Row label for the field a warning is about.
    public static func fieldLabel(_ field: String) -> String {
        switch field {
        case "serialNumber": return "Serial / IMEI"
        case "":             return "Thiết bị"
        default:             return field
        }
    }
}

/// Response envelope of `POST /api/v1/devices` and `PATCH /api/v1/devices/{id}`:
/// the saved device plus its advisories.
public struct DeviceSaveResult: Decodable, Sendable {
    public let device: Device
    /// Documented as always present and `[]` when nothing is worth flagging;
    /// optional here only so a server that omits it can't fail the save path.
    public let warnings: [DeviceWarning]?

    /// Never-nil view for the UI.
    public var warningsOrEmpty: [DeviceWarning] { warnings ?? [] }
}

/// Vietnamese copy for the two advisory surfaces, so the distinction between
/// "we could not use this" (`unmatched`) and "we used it and it looks wrong"
/// (`warnings`) is stated in words rather than implied by colour.
public enum DeviceWarningCopy {

    /// Heading shown after a successful save that produced advisories.
    public static let savedHeading = "Đã lưu thiết bị"
    /// The line that makes "non-blocking" explicit.
    public static let savedNote =
        "Thiết bị đã được lưu. Đây là cảnh báo, không phải lỗi — bạn không cần sửa gì cả."
    /// Dismiss button on the advisory card.
    public static let savedDismiss = "Xong"

    /// Draft-scan counterpart: values that were kept.
    public static let draftWarningsNote = "Đã điền, nhưng có vẻ sai — kiểm tra lại."
    /// Draft-scan counterpart: values that were thrown away.
    public static let draftUnmatchedNote = "Không đọc được, bạn tự nhập."
}
