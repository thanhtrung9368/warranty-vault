import Foundation

// ============================================================
// Push routing — where a tapped reminder notification opens.
//
// The server already decides the destination when it sends the push: every
// APNs payload carries a top-level `url` (`api/internal/cron/run.go`, sent by
// `api/internal/push/apns.go`):
//
//     {"aps": {...}, "url": "/devices/<device-id>"}
//     {"aps": {...}, "url": "/subscriptions/<subscription-id>"}
//
// iOS used to ignore the key entirely — `WVNotificationDelegate.didReceive` was
// a no-op — so every tap landed on whatever tab was last open. That is worse
// than doing nothing: a "BH sắp hết" alert opened a screen that had no relation
// to the device it was about.
//
// The parser lives here rather than in `AppDelegate` so `swift test` can pin the
// two things that matter without a simulator:
//
//   * the two known paths map to the right screen;
//   * **anything else maps to `nil`.** A missing key, a malformed path, a
//     `/wishlist/<id>` (no destination screen yet) and the `warrly://device/<id>`
//     deep-link shape this enum does not handle all have to do nothing. Opening
//     "the last screen" on an unknown key is how a notification tap starts
//     showing the wrong device.
// ============================================================

/// The screen a tapped push asks for.
public enum PushDestination: Hashable, Sendable {
    case device(String)
    case subscription(String)

    /// Reads the `url` key out of a notification's `userInfo`.
    ///
    /// The value is expected to be a `String`; any other JSON type (a number, a
    /// dictionary, an absent key) is "no destination", never a guess.
    public static func from(userInfo: [AnyHashable: Any]) -> PushDestination? {
        guard let raw = userInfo[WarrlyPush.urlKey] as? String else { return nil }
        return parse(raw)
    }

    /// Parses the server's `url` value.
    ///
    /// Accepts the documented server path (`/devices/<id>`) and, defensively,
    /// an absolute URL with the same path (`https://api.warrly.com/devices/<id>`)
    /// — a future payload could send one. A site-relative value without the
    /// leading slash is refused: it is not one of the shapes this contract
    /// defines, and guessing is how the wrong screen opens.
    public static func parse(_ raw: String) -> PushDestination? {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, let path = normalizedPath(trimmed) else { return nil }

        let parts = path.split(separator: "/", omittingEmptySubsequences: true)
        guard parts.count == 2 else { return nil }
        let id = String(parts[1]).trimmingCharacters(in: .whitespacesAndNewlines)
        guard !id.isEmpty else { return nil }

        switch parts[0].lowercased() {
        case "devices":       return .device(id)
        case "subscriptions": return .subscription(id)
        default:              return nil
        }
    }

    /// The path half of the value, or `nil` when the value is not rooted at the
    /// site root. A query string or fragment is dropped before splitting so it
    /// can never become part of an id.
    private static func normalizedPath(_ raw: String) -> String? {
        if raw.hasPrefix("/") {
            var path = raw
            if let cut = path.firstIndex(where: { $0 == "?" || $0 == "#" }) {
                path = String(path[..<cut])
            }
            return path
        }
        guard let url = URL(string: raw), url.scheme != nil, url.host != nil,
              !url.path.isEmpty else { return nil }
        return url.path
    }
}

// MARK: - Notification permission

/// `UNAuthorizationStatus` reduced to the three answers that matter to the app.
///
/// Deliberately free of `UserNotifications`: the decision below is pinned by
/// `swift test` on macOS, where that framework does not exist. `PushRegistrar`
/// maps the real status onto this enum.
public enum NotificationPermission: String, Sendable, Equatable, CaseIterable {
    /// The user has never been asked — the only state a prompt may appear in.
    case notDetermined
    /// The user said no (or the system refuses to prompt again).
    case denied
    /// Granted: full, provisional or ephemeral. Never ask again.
    case authorized
}

/// When the app may show its one-time "may we remind you?" rationale.
///
/// The app used to be able to ask for notification permission **only** from
/// Settings, and launch only re-registered an already-granted user. A user who
/// never opened Settings was running a reminder app that never reminded them.
///
/// The fix is one offer, at the first moment the user has created something
/// worth reminding about — the first successful device save — never at cold
/// launch (where it would compete with the ads consent flow for prompts) and
/// never again after that. If the user ignores or declines the rationale, the
/// Settings toggle is still there; re-asking would be nagging.
public enum NotificationPrimerRules {
    /// - Parameters:
    ///   - permission: the current system answer.
    ///   - alreadyOffered: persisted once-ever flag. It is set when the
    ///     rationale is *shown*, not when permission is granted, so a user who
    ///     dismisses the card is not asked again.
    public static func shouldOffer(permission: NotificationPermission,
                                   alreadyOffered: Bool) -> Bool {
        permission == .notDetermined && !alreadyOffered
    }
}

/// Names shared by the producer (`AppDelegate`) and the consumer (`AppRouter`).
public enum WarrlyPush {
    /// The top-level payload key the Go cron and APNs sender write.
    public static let urlKey = "url"

    /// Posted on the main queue when a notification tap names a destination.
    /// The destination travels in `userInfo[destinationUserInfoKey]` as a
    /// `PushDestination`; `AppRouter` owns the navigation that follows.
    public static let destinationNotification = Notification.Name("WarrlyPushDestination")
    public static let destinationUserInfoKey = "destination"
}
