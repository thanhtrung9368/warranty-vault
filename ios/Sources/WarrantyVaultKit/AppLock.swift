import Combine
import Foundation
import LocalAuthentication

// MARK: - Biometrics / app lock
//
// The "Face ID & Touch ID" switch in Hồ sơ turns on an app lock: the next time
// the app comes to the foreground the UI is covered by `AppLockScreen` until
// the user authenticates.
//
// Design rules (deliberately conservative, and deliberately hard to get
// stranded by):
//
//  1. Opt-in and off by default. Turning it ON (and OFF) requires one
//     successful authentication first, so a user can never switch on a lock
//     they are unable to satisfy.
//  2. The switch can only be turned on when Face ID / Touch ID is both
//     supported *and* enrolled (`canEvaluatePolicy(.deviceOwnerAuthentication-
//     WithBiometrics)`), and a device passcode exists as the fallback.
//  3. Unlocking evaluates `.deviceOwnerAuthentication`, i.e. biometrics with
//     the device-passcode fallback. Face ID becoming unavailable (mask,
//     too many failed attempts, sensor covered) therefore degrades to the
//     passcode instead of locking the user out.
//  4. The one state that genuinely cannot be authenticated — no passcode at
//     all — never locks: `AppLockStore` detects `LAError.passcodeNotSet`,
//     turns the preference off and unlocks. Fail open, never strand.
//  5. Re-lock on backgrounding (not on `.inactive`, which also fires for the
//     app switcher, Control Center and system alerts). The cover is therefore
//     in place before the process is suspended, so the app-switcher card shows
//     the lock screen rather than the user's data.
//  6. The lock screen always offers an escape hatch: "Mở khoá" (retry, with
//     passcode fallback) and "Đăng xuất" (clears the Keychain session; the
//     user can always sign back in with email + password).
//
// The bearer token itself stays in the Keychain and is untouched by any of
// this. Nothing here encrypts data at rest — it is a UI lock, exactly like the
// iOS Files app's.

// MARK: - Availability

/// Which biometric sensor the device exposes.
public enum BiometricKind: String, Sendable, Equatable {
    case none, faceID, touchID, opticID

    /// Vietnamese-facing name; "Sinh trắc học" is the neutral fallback used in
    /// copy when the sensor is unknown/absent.
    public var label: String {
        switch self {
        case .faceID:  return "Face ID"
        case .touchID: return "Touch ID"
        case .opticID: return "Optic ID"
        case .none:    return "Sinh trắc học"
        }
    }
}

/// Snapshot of what the device can currently do, so the UI can disable the
/// switch *before* the user gets locked behind something unsatisfiable.
public struct AppLockAvailability: Equatable, Sendable {
    public let biometry: BiometricKind
    /// `canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics)` — the
    /// sensor exists and is enrolled.
    public let biometricsAvailable: Bool
    /// `canEvaluatePolicy(.deviceOwnerAuthentication)` — biometrics *or* the
    /// device passcode can authenticate.
    public let deviceOwnerAuthAvailable: Bool
    /// True when the device has no passcode at all (`LAError.passcodeNotSet`).
    /// This is the only state in which the lock could never be satisfied.
    public let passcodeNotSet: Bool

    public init(biometry: BiometricKind = .none,
                biometricsAvailable: Bool = false,
                deviceOwnerAuthAvailable: Bool = false,
                passcodeNotSet: Bool = false) {
        self.biometry = biometry
        self.biometricsAvailable = biometricsAvailable
        self.deviceOwnerAuthAvailable = deviceOwnerAuthAvailable
        self.passcodeNotSet = passcodeNotSet
    }

    /// The switch may be turned on only when biometrics are enrolled **and**
    /// the passcode fallback exists.
    public var canEnableLock: Bool {
        biometricsAvailable && deviceOwnerAuthAvailable && !passcodeNotSet
    }

    /// Vietnamese reason shown under the switch when it is disabled.
    public var unavailableReason: String? {
        if passcodeNotSet {
            return "Thiết bị chưa đặt mã mở khoá — hãy đặt mã trong Cài đặt iOS trước."
        }
        if !biometricsAvailable {
            if biometry == .none {
                return "Thiết bị này không hỗ trợ Face ID/Touch ID."
            }
            return "Chưa cài đặt \(biometry.label) trên thiết bị — hãy bật trong Cài đặt iOS."
        }
        if !deviceOwnerAuthAvailable {
            return "Thiết bị chưa đặt mã mở khoá — hãy đặt mã trong Cài đặt iOS trước."
        }
        return nil
    }
}

// MARK: - Errors

public enum AppLockError: Error, Equatable, Sendable {
    /// The user dismissed the system prompt — not worth an error banner.
    case userCancelled
    /// Authentication is impossible right now (not enrolled, locked out, no
    /// passcode…). `message` is user-facing Vietnamese.
    case unavailable(String)
    /// Authentication ran and failed (wrong face, too many attempts…).
    case failed(String)

    public var message: String {
        switch self {
        case .userCancelled:
            return "Đã huỷ xác thực."
        case .unavailable(let m), .failed(let m):
            return m
        }
    }

    /// Cancellations stay silent in the UI.
    public var isCancellation: Bool {
        if case .userCancelled = self { return true }
        return false
    }
}

// MARK: - Authenticator

/// Thin seam over `LAContext` so the lock's state machine is unit-testable
/// without touching the real biometric prompt.
public protocol BiometricAuthenticating: Sendable {
    func availability() -> AppLockAvailability
    /// Prompts for biometrics with the device-passcode fallback. Returns
    /// normally on success, throws `AppLockError` otherwise.
    func authenticate(reason: String) async throws
}

/// Production implementation.
public struct LocalAuthenticationAuthenticator: BiometricAuthenticating {

    public init() {}

    public func availability() -> AppLockAvailability {
        // A fresh context per query: a context that has already failed or been
        // locked out reports stale state.
        let biometrics = LAContext()
        var biometricsError: NSError?
        let biometricsOK = biometrics.canEvaluatePolicy(
            .deviceOwnerAuthenticationWithBiometrics, error: &biometricsError)

        let owner = LAContext()
        var ownerError: NSError?
        let ownerOK = owner.canEvaluatePolicy(.deviceOwnerAuthentication, error: &ownerError)

        let code = ownerError.map { LAError.Code(rawValue: $0.code) }
        return AppLockAvailability(
            biometry: Self.kind(biometrics.biometryType),
            biometricsAvailable: biometricsOK,
            deviceOwnerAuthAvailable: ownerOK,
            passcodeNotSet: code == .passcodeNotSet
        )
    }

    public func authenticate(reason: String) async throws {
        let context = LAContext()
        // Shown on the passcode fallback button of the system sheet.
        context.localizedFallbackTitle = "Dùng mã mở khoá"
        context.localizedCancelTitle = "Huỷ"

        var error: NSError?
        guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &error) else {
            throw Self.appLockError(from: error)
        }

        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            context.evaluatePolicy(.deviceOwnerAuthentication,
                                   localizedReason: reason) { success, evaluateError in
                if success {
                    continuation.resume()
                } else {
                    continuation.resume(throwing: Self.appLockError(from: evaluateError))
                }
            }
        }
    }

    // MARK: Helpers

    static func kind(_ type: LABiometryType) -> BiometricKind {
        if type == .faceID { return .faceID }
        if type == .touchID { return .touchID }
        // Optic ID (visionOS 1 / iOS 17 / macOS 14) — the kit itself deploys
        // one OS version lower, so it has to be an availability-guarded compare
        // rather than a switch case.
        if #available(iOS 17.0, macOS 14.0, *) {
            if type == .opticID { return .opticID }
        }
        return .none
    }

    static func appLockError(from error: Error?) -> AppLockError {
        guard let error = error as NSError? else {
            return .failed("Không xác thực được. Thử lại.")
        }
        switch LAError.Code(rawValue: error.code) {
        case .userCancel, .appCancel, .systemCancel:
            return .userCancelled
        case .biometryNotAvailable:
            return .unavailable("Thiết bị không hỗ trợ sinh trắc học.")
        case .biometryNotEnrolled:
            return .unavailable("Chưa cài đặt Face ID/Touch ID trên thiết bị.")
        case .biometryLockout:
            return .unavailable("Sinh trắc học đang tạm bị khoá. Dùng mã mở khoá để tiếp tục.")
        case .passcodeNotSet:
            return .unavailable("Thiết bị chưa đặt mã mở khoá.")
        case .authenticationFailed:
            return .failed("Xác thực không thành công. Thử lại.")
        default:
            return .failed("Không xác thực được. Thử lại.")
        }
    }
}

// MARK: - Preference storage

/// Persistence for the on/off switch. Not a secret (it is a UI preference, not
/// a key), so `UserDefaults` is the right home; the protocol exists so tests
/// don't touch the shared defaults.
public protocol AppLockStorage: AnyObject {
    var isEnabled: Bool { get set }
}

public final class UserDefaultsAppLockStorage: AppLockStorage {
    public static let defaultKey = "wv_app_lock_enabled"

    private let defaults: UserDefaults
    private let key: String

    public init(defaults: UserDefaults = .standard,
                key: String = UserDefaultsAppLockStorage.defaultKey) {
        self.defaults = defaults
        self.key = key
    }

    public var isEnabled: Bool {
        get { defaults.bool(forKey: key) }
        set { defaults.set(newValue, forKey: key) }
    }
}

// MARK: - Store

/// Vietnamese prompt shown inside the system biometric sheet. Top-level rather
/// than a `static let` on the `@MainActor` store so it can be a default
/// argument from a nonisolated context.
public let appLockPromptReason = "Mở khoá WarrantyVault để xem dữ liệu bảo hành."

/// The app lock's state machine. Owned by the app (`@StateObject` in
/// `WarrantyVaultApp`) and rendered by `AppLockScreen`.
@MainActor
public final class AppLockStore: ObservableObject {

    @Published public private(set) var isEnabled: Bool
    /// True while the UI must be covered. Starts `true` on a cold launch when
    /// the lock is on, so protected content is never rendered first.
    @Published public private(set) var isLocked: Bool
    @Published public private(set) var isAuthenticating = false
    @Published public private(set) var availability: AppLockAvailability
    /// Last non-cancellation failure, Vietnamese, for the lock screen banner.
    @Published public private(set) var lastError: String?
    /// Set when the lock turned itself off because the device lost its
    /// passcode. The account screen shows it until the switch is touched again
    /// or the lock is re-enabled.
    @Published public private(set) var autoDisabledNotice: String?

    private let authenticator: BiometricAuthenticating
    private let storage: AppLockStorage
    private let reason: String

    public init(authenticator: BiometricAuthenticating = LocalAuthenticationAuthenticator(),
                storage: AppLockStorage = UserDefaultsAppLockStorage(),
                reason: String = appLockPromptReason) {
        self.authenticator = authenticator
        self.storage = storage
        self.reason = reason

        let availability = authenticator.availability()
        self.availability = availability

        let storedEnabled = storage.isEnabled
        // Rule 4: never lock when there is no way to authenticate.
        if storedEnabled && availability.passcodeNotSet {
            self.isEnabled = false
            self.isLocked = false
            self.autoDisabledNotice = Self.passcodeLostNotice
            storage.isEnabled = false
        } else {
            self.isEnabled = storedEnabled
            self.isLocked = storedEnabled
        }
    }

    // MARK: Lifecycle

    /// Re-reads device capabilities. Cheap, no prompt.
    public func refreshAvailability() {
        availability = authenticator.availability()
        if isEnabled && availability.passcodeNotSet {
            disableWithoutAuthentication(notice: Self.passcodeLostNotice)
        }
    }

    /// Called when the scene moves to `.background`. Locks immediately — no
    /// grace period — so the cover is up before the process is suspended.
    public func handleEnterBackground() {
        guard isEnabled, !availability.passcodeNotSet else { return }
        isLocked = true
    }

    /// Called when the scene becomes active again.
    public func handleForeground() async {
        refreshAvailability()
        if isLocked { await unlock() }
    }

    /// Dropped by the app on logout — there is nothing to protect once the
    /// session is gone, and the next launch re-locks via `init`.
    public func clearLock() {
        isLocked = false
        lastError = nil
    }

    // MARK: Unlock

    /// Prompts for biometrics (with passcode fallback) when locked. A no-op
    /// while a prompt is already on screen, so repeated `.active` notifications
    /// can't stack system alerts.
    public func unlock() async {
        guard isLocked, !isAuthenticating else { return }
        if availability.passcodeNotSet {
            isLocked = false
            return
        }
        isAuthenticating = true
        defer { isAuthenticating = false }
        do {
            try await authenticator.authenticate(reason: reason)
            isLocked = false
            lastError = nil
        } catch let error as AppLockError {
            lastError = error.isCancellation ? nil : error.message
        } catch {
            lastError = "Không xác thực được. Thử lại."
        }
    }

    // MARK: Toggle

    /// Flip the switch. Both directions authenticate first, so neither turning
    /// the lock on nor silently turning it off is possible without proving
    /// control of the device.
    public func setEnabled(_ enabled: Bool) async {
        guard enabled != isEnabled else { return }
        if enabled {
            await enable()
        } else {
            await disable()
        }
    }

    private func enable() async {
        refreshAvailability()
        guard availability.canEnableLock else {
            lastError = availability.unavailableReason
            return
        }
        guard await authenticateForChange() else { return }
        storage.isEnabled = true
        isEnabled = true
        isLocked = false
        lastError = nil
        autoDisabledNotice = nil
    }

    private func disable() async {
        guard await authenticateForChange() else { return }
        storage.isEnabled = false
        isEnabled = false
        isLocked = false
        lastError = nil
    }

    /// Returns `true` when the user proved it's them.
    private func authenticateForChange() async -> Bool {
        isAuthenticating = true
        defer { isAuthenticating = false }
        do {
            try await authenticator.authenticate(reason: reason)
            return true
        } catch let error as AppLockError {
            lastError = error.isCancellation ? nil : error.message
            return false
        } catch {
            lastError = "Không xác thực được. Thử lại."
            return false
        }
    }

    // MARK: Safety net

    private func disableWithoutAuthentication(notice: String) {
        storage.isEnabled = false
        isEnabled = false
        isLocked = false
        autoDisabledNotice = notice
    }

    /// Consumes the one-shot notice so the account screen shows it once.
    public func acknowledgeAutoDisabledNotice() {
        autoDisabledNotice = nil
    }

    static let passcodeLostNotice =
        "Đã tắt khoá ứng dụng vì thiết bị không còn mã mở khoá để xác thực."
}
