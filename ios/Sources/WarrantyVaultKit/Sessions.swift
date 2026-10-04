import Foundation

// MARK: - Device sessions
//
// Mirrors `GET /api/v1/auth/sessions` + `DELETE /api/v1/auth/sessions/{id}`
// (openapi.yaml → SessionSummary / SessionList / SessionRevokeResult).
//
// Why this exists at all: `POST /api/v1/auth/logout` only kills the token that
// sends it and a password reset kills *everything*. A sliding 30-day TTL means a
// session that is used at least once a week never expires, so handing the phone
// to someone used to be a silent, one-way decision. With this list it isn't.
//
// Two things this screen is NOT:
//   * it is not the push-subscription list (`GET /api/v1/push`, "Thiết bị nhận
//     thông báo") — deleting a push target only stops notifications, it does
//     not revoke access;
//   * `id` is the `Session` row's primary key, never the token or its hash.

/// One active login session. Only non-revoked, non-expired rows are returned,
/// newest activity first, at most 100.
public struct SessionSummary: Decodable, Sendable, Identifiable, Hashable {
    /// `Session` row id — the value `DELETE /api/v1/auth/sessions/{id}` wants.
    public let id: String
    /// Label the client sent at login. `nil` for clients that sent none (the
    /// API documents the "Không rõ thiết bị" fallback — see `SessionLabels`).
    public let deviceLabel: String?
    /// Raw wire value. openapi types it `web | ios | android | null`, and the
    /// server (`normalizePlatform`) maps anything else — including the push
    /// codes `apns`/`fcm`, which belong to a different entity — to `null`. The
    /// mapping to Vietnamese lives in `SessionLabels.platformLabel`.
    public let platform: String?
    /// `true` = the session sending this request ("Thiết bị này").
    public let current: Bool
    /// Last activity (refreshed at most every 5 minutes).
    public let lastSeenAt: Date
    /// When the session was created (the login).
    public let createdAt: Date
    /// Current expiry. Sliding: activity after 7 days pushes it out 30 more.
    public let expiresAt: Date
}

public struct SessionList: Decodable, Sendable {
    /// Always `[]`, never `null` — but tolerated as absent for old servers.
    public let sessions: [SessionSummary]?
}

/// Result of `DELETE /api/v1/auth/sessions/{id}`.
public struct SessionRevokeResult: Decodable, Sendable, Equatable {
    public let ok: Bool
    /// `true` when the revoked session is the one calling. **The stored bearer
    /// token is already dead**: every later request answers 401, so the client
    /// must clear the Keychain and return to login.
    public let current: Bool
    /// `true` when the session had already been revoked. Success, not an error —
    /// the endpoint is idempotent and `revokedAt` is not overwritten.
    public let alreadyRevoked: Bool
    /// Vietnamese sentence meant to be shown to the user as-is.
    public let message: String
}

/// What a revoke call means for this device.
///
/// Precedence matters: a session can be **both** the current one and already
/// revoked (revoking twice), and the local token is dead either way, so
/// `signedOutLocally` must win over `alreadyRevoked`.
public enum SessionRevokeOutcome: Equatable, Sendable {
    /// The row is gone; drop it from the list.
    case revoked
    /// It was already gone before this call (idempotent success).
    case alreadyRevoked
    /// The current session went away: clear the Keychain, go back to login.
    case signedOutLocally

    public static func of(_ result: SessionRevokeResult) -> SessionRevokeOutcome {
        if result.current { return .signedOutLocally }
        return result.alreadyRevoked ? .alreadyRevoked : .revoked
    }
}

// MARK: - Presentation

/// Vietnamese labels for session rows. Pure so the fallbacks are unit-tested
/// instead of being re-invented in a view.
public enum SessionLabels {

    /// The API's documented fallback for a `null` `deviceLabel`.
    public static let unknownDevice = L.t("Không rõ thiết bị")
    /// Marker for the session doing the calling.
    public static let thisDevice = L.t("Thiết bị này")
    /// Fallback when `platform` is missing or unknown.
    public static let unknownPlatform = L.t("Không rõ nền tảng")

    /// Human label for a row's title. A `null` label **and** a blank/whitespace
    /// one both fall back, so the row can never render as an empty line.
    public static func deviceLabel(_ session: SessionSummary) -> String {
        deviceLabel(raw: session.deviceLabel)
    }

    public static func deviceLabel(raw: String?) -> String {
        let trimmed = raw?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return trimmed.isEmpty ? unknownDevice : trimmed
    }

    /// Vietnamese rendering of the session's `platform`.
    ///
    /// The field is a three-value enum plus null: openapi documents
    /// `web | ios | android | null`, and `normalizePlatform` in
    /// `api/internal/handlers/auth.go` maps every other string to `null`. So
    /// there is deliberately **no** `apns`/`fcm` branch — those are
    /// `PushSubscription.platform` codes on a different entity and cannot appear
    /// on a session. An unforeseen non-empty value is printed as-is rather than
    /// guessed at.
    public static func platformLabel(raw: String?) -> String {
        let value = (raw ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        switch value.lowercased() {
        case "web":     return L.t("Trình duyệt web")
        case "ios":     return "iPhone / iPad"
        case "android": return "Android"
        case "":        return unknownPlatform
        default:        return value
        }
    }

    public static func platformLabel(_ session: SessionSummary) -> String {
        platformLabel(raw: session.platform)
    }

    /// Toast/dialog copy for a revoke result: the server's own Vietnamese
    /// message when it sent one, otherwise a locally-written fallback that
    /// matches the outcome.
    public static func message(for result: SessionRevokeResult) -> String {
        let trimmed = result.message.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmed.isEmpty { return trimmed }
        switch SessionRevokeOutcome.of(result) {
        case .signedOutLocally: return L.t("Đã đăng xuất thiết bị này. Hãy đăng nhập lại.")
        case .alreadyRevoked:   return L.t("Phiên này đã được thu hồi trước đó.")
        case .revoked:          return L.t("Đã thu hồi phiên đăng nhập.")
        }
    }
}
