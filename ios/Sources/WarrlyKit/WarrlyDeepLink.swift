import Foundation

// MARK: - WarrlyDeepLink

/// The URL shapes the app treats as its own:
///
///     warrly://device/<device-id>   — open that device
///     warrly://capture              — open receipt capture (inbox, no device)
///
/// The device URL is used by the widget's tap target and by the "open this
/// device" App Intent. The capture URL is the URL half of the Control Center
/// hand-off (the control itself uses an `OpenIntent` and the App Group key
/// below so it survives a cold start). Parsing lives here so it is tested
/// without `AppRouter`.
public enum WarrlyDeepLink {
    public static let scheme = "warrly"
    public static let deviceHost = "device"
    public static let captureHost = "capture"

    /// App Group defaults key the "open device" intent writes. The app consumes
    /// it on the next activation, so the intent works even if the app was not
    /// running when Siri handled it.
    public static let pendingDeviceDefaultsKey = "wv.pendingDeviceId"

    /// App Group defaults key the Control Center control writes. Same rule as
    /// the device key: the control can run before the app has a UI, so the
    /// request waits in the shared container.
    public static let pendingCaptureDefaultsKey = "wv.pendingCapture"

    /// In-process signal for the already-running case. The App Group key is the
    /// durable path; this only saves a scene-phase round trip.
    public static let pendingDeviceNotification = Notification.Name("WarrlyOpenDevice")
    public static let pendingCaptureNotification = Notification.Name("WarrlyOpenCapture")

    public static func deviceURL(id: String) -> URL? {
        var components = URLComponents()
        components.scheme = scheme
        components.host = deviceHost
        components.path = "/" + id
        return components.url
    }

    /// `warrly://capture`, the URL form of the receipt-capture hand-off.
    public static func captureURL() -> URL? {
        var components = URLComponents()
        components.scheme = scheme
        components.host = captureHost
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

    /// True only for exactly `warrly://capture` (no path, no query). A stray
    /// path must not be treated as a capture request.
    public static func isCaptureURL(_ url: URL) -> Bool {
        guard url.scheme?.lowercased() == scheme,
              (url.host ?? "").lowercased() == captureHost,
              let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        else { return false }
        return components.path.isEmpty || components.path == "/"
    }
}

// MARK: - WarrlyIntentBridge

/// The App Group hand-off used by the "Open device" and "Capture a receipt"
/// intents.
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

    // MARK: Capture

    /// Queues "open receipt capture". Called by the Control Center control's
    /// `OpenIntent` before the app exists; the app consumes the flag on its next
    /// activation.
    public static func requestCapture(
        appGroupIdentifier: String = WarrlySurface.appGroupIdentifier,
        defaults: UserDefaults? = nil,
        notificationCenter: NotificationCenter = .default
    ) {
        let shared = defaults ?? UserDefaults(suiteName: appGroupIdentifier)
        shared?.set(true, forKey: WarrlyDeepLink.pendingCaptureDefaultsKey)
        notificationCenter.post(name: WarrlyDeepLink.pendingCaptureNotification, object: nil)
    }

    /// Reads and clears the pending capture flag. `false` when there is nothing
    /// to open.
    public static func consumePendingCapture(
        appGroupIdentifier: String = WarrlySurface.appGroupIdentifier,
        defaults: UserDefaults? = nil
    ) -> Bool {
        let shared = defaults ?? UserDefaults(suiteName: appGroupIdentifier)
        guard shared?.bool(forKey: WarrlyDeepLink.pendingCaptureDefaultsKey) == true else {
            return false
        }
        shared?.removeObject(forKey: WarrlyDeepLink.pendingCaptureDefaultsKey)
        return true
    }

    /// Drops a queued capture request on sign-out, for the same reason as
    /// `clearPendingDevice`.
    public static func clearPendingCapture(
        appGroupIdentifier: String = WarrlySurface.appGroupIdentifier,
        defaults: UserDefaults? = nil
    ) {
        let shared = defaults ?? UserDefaults(suiteName: appGroupIdentifier)
        shared?.removeObject(forKey: WarrlyDeepLink.pendingCaptureDefaultsKey)
    }
}
