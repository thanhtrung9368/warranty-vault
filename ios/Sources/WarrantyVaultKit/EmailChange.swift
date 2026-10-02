import Foundation

// MARK: - Email change (POST /api/v1/auth/change-email → /confirm-email-change)
//
// Two steps, because moving an account to a new address has to prove control of
// that address:
//
//   1. `POST /api/v1/auth/change-email` — new address + **current password**
//      (so a stolen bearer token alone cannot move the account). The server
//      mails a single-use, 30-minute token to the *new* address. `User.email`
//      is untouched: the old address keeps working until step 2 succeeds.
//   2. `POST /api/v1/auth/confirm-email-change` — body `{token}` only, **no
//      bearer token**: the token is the credential. On success the server
//      updates the address and revokes every session.
//
// The mailed link points at `<APP_URL>/confirm-email/<token>`, which is a *web*
// page a native client cannot open as a session. The email therefore also
// carries the raw token as text ("Hoặc nhập mã xác nhận trong ứng dụng") — see
// `api/internal/email/resend.go::SendEmailChange` — and that is what this client
// consumes.

/// Body of `POST /api/v1/auth/change-email` (step 1 of 2).
public struct EmailChangeInput: Encodable, Sendable {
    public var newEmail: String
    public var currentPassword: String

    public init(newEmail: String, currentPassword: String) {
        self.newEmail = newEmail
        self.currentPassword = currentPassword
    }
}

/// Response of `POST /api/v1/auth/change-email`.
///
/// Deliberately **neutral**: the same `message` comes back whether the token was
/// mailed or the address already belongs to another account (so the endpoint
/// cannot be used to enumerate accounts), and there is **no token field** — the
/// raw token only ever travels in the email. The client must not try to tell
/// those two cases apart, and must not claim the mail was definitely sent.
public struct EmailChangeResult: Decodable, Sendable {
    public let ok: Bool
    public let message: String?
}

/// Response of `POST /api/v1/auth/confirm-email-change` (step 2 of 2).
public struct ConfirmEmailChangeResult: Decodable, Sendable {
    public let ok: Bool
    public let message: String?
}

/// Client-side rules for the email-change form.
public enum EmailChangeRules {

    /// Trim + lowercase, exactly what the server does before it compares or
    /// stores the address. Normalising locally means the value shown back to the
    /// user ("đã gửi tới …") is the value that was actually requested.
    public static func normalizedEmail(_ raw: String) -> String {
        raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }

    /// Extracts the raw token from whatever the user pasted.
    ///
    /// The email shows both a link and the bare token, and the link is the
    /// bigger tap target — so people copy the whole
    /// `<APP_URL>/confirm-email/<token>` URL. Posting that URL as the token
    /// fails with `invalid_email_change_token` for no good reason, so a pasted
    /// confirm-email link is reduced to its last path component (query string,
    /// fragment and trailing slash dropped). Anything else is returned trimmed
    /// and untouched.
    public static func token(fromPasted raw: String) -> String {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return "" }

        guard let marker = trimmed.range(of: "/confirm-email/") else { return trimmed }
        var token = String(trimmed[marker.upperBound...])
        // Cut anything that followed the token: whitespace (a pasted line),
        // a query string, a fragment.
        if let cut = token.firstIndex(where: { $0.isWhitespace }) { token = String(token[..<cut]) }
        if let cut = token.firstIndex(where: { $0 == "?" || $0 == "#" }) { token = String(token[..<cut]) }
        return token.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    }

    /// The server's TTL for both email-change and password-reset tokens.
    public static let tokenTTLMinutes = 30
}
