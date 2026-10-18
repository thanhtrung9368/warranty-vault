import Foundation

/// Rules for the `displayName` half of `PATCH /api/v1/auth/me`.
///
/// The contract (`openapi.yaml`, `auth/me` patch) models `displayName` as a
/// tri-state: an absent key keeps the stored name, `null` (or `""`) clears it,
/// and a value replaces it. The stored value is capped at **80 bytes** of UTF-8
/// — roughly 26 Vietnamese characters, not 80 characters.
///
/// This helper only maps what the user typed onto that tri-state. The byte cap
/// deliberately stays the server's call: the app shows the server's own
/// Vietnamese `fieldErrors.displayName` instead of imposing a second, local
/// limit that could disagree with it (Android's `ProfileEditSheet` makes the
/// same choice).
public enum DisplayNameRules {

    /// The wire field for a name the user typed.
    ///
    /// Blank / whitespace-only becomes `.clear` so the body says `null`
    /// explicitly rather than `""`. A non-blank name is sent trimmed, which is
    /// exactly what the server would store anyway; nothing is truncated, so an
    /// over-long name still reaches the server and comes back as a real
    /// validation error instead of being silently cut in half.
    public static func field(for raw: String) -> UpdateProfileInput.Field {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? .clear : .set(trimmed)
    }
}
