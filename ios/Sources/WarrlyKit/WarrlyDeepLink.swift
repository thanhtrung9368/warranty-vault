import Foundation

// MARK: - WarrlyDeepLink

/// The one URL shape the app treats as a device deep link:
///
///     warrly://device/<device-id>
///
/// It is used by the widget's tap target and by the "open this device" App
/// Intent. The intent queues the id in the App Group rather than opening this
/// URL (Siri may run before the UI exists); `AppRouter` consumes it. Parsing
/// lives here so it is tested without `AppRouter`.
public enum WarrlyDeepLink {
    public static let scheme = "warrly"
    public static let deviceHost = "device"

    /// App Group defaults key the "open device" intent writes. The app consumes
    /// it on the next activation, so the intent works even if the app was not
    /// running when Siri handled it.
    public static let pendingDeviceDefaultsKey = "wv.pendingDeviceId"

    /// In-process signal for the already-running case. The App Group key is the
    /// durable path; this only saves a scene-phase round trip.
    public static let pendingDeviceNotification = Notification.Name("WarrlyOpenDevice")

    public static func deviceURL(id: String) -> URL? {
        var components = URLComponents()
        components.scheme = scheme
        components.host = deviceHost
        components.path = "/" + id
        return components.url
    }

    /// Returns the device id for a well-formed Warrly device URL, never for any
    /// other scheme/host.
    public static func deviceId(from url: URL) -> String? {
        guard url.scheme?.lowercased() == scheme,
              (url.host ?? "").lowercased() == deviceHost,
              let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        else { return nil }

        let id = components.path
            .trimmingCharacters(in: CharacterSet(charactersIn: "/"))
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return id.isEmpty ? nil : id
    }
}

// MARK: - WarrlyIntentBridge

/// The App Group hand-off used by the "Open device" intent.
///
/// Kept in the Kit so the key and the notification name are identical on both
/// sides of the process boundary and so the write is a single tested line.
public enum WarrlyIntentBridge {
    public static func requestDevice(
        id: String,
        appGroupIdentifier: String = WarrlySurface.appGroupIdentifier,
        defaults: UserDefaults? = nil,
        notificationCenter: NotificationCenter = .default
    ) {
        let shared = defaults ?? UserDefaults(suiteName: appGroupIdentifier)
        shared?.set(id, forKey: WarrlyDeepLink.pendingDeviceDefaultsKey)
        notificationCenter.post(name: WarrlyDeepLink.pendingDeviceNotification, object: id)
    }

    /// Reads and clears the pending id. `nil` when there is nothing to open.
    public static func consumePendingDevice(
        appGroupIdentifier: String = WarrlySurface.appGroupIdentifier,
        defaults: UserDefaults? = nil
    ) -> String? {
        let shared = defaults ?? UserDefaults(suiteName: appGroupIdentifier)
        guard let id = shared?.string(forKey: WarrlyDeepLink.pendingDeviceDefaultsKey),
              !id.isEmpty else { return nil }
        shared?.removeObject(forKey: WarrlyDeepLink.pendingDeviceDefaultsKey)
        return id
    }

    /// Drops a queued "open device" request on sign-out. Without this, the next
    /// account on the same phone could inherit a request pointing at an id that
    /// belongs to the previous one.
    public static func clearPendingDevice(
        appGroupIdentifier: String = WarrlySurface.appGroupIdentifier,
        defaults: UserDefaults? = nil
    ) {
        let shared = defaults ?? UserDefaults(suiteName: appGroupIdentifier)
        shared?.removeObject(forKey: WarrlyDeepLink.pendingDeviceDefaultsKey)
    }
}
