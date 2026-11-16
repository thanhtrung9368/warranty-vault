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
//     passcode fallback), "Dùng mật khẩu" (the account password, checked by
//     the API — see `AppLockPasswordError`), and last "Đăng xuất" (clears the
//     Keychain session; the user can always sign back in with email +
//     password).
//  7. The password is a *fallback for the fallback*. It is never compared
//     locally, never cached and never stored: the only thing that can check an
//     account password is the server, so `unlock(password:verify:)` hands the
//     typed value to the auth layer and unlocks only when that call succeeds.
//     A transport failure leaves the app locked and says the check could not be
//     made.
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
        case .none:    return L.t("Sinh trắc học")
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
            return L.t("Thiết bị chưa đặt mã mở khoá — hãy đặt mã trong Cài đặt iOS trước.")
        }
        if !biometricsAvailable {
            if biometry == .none {
                return L.t("Thiết bị này không hỗ trợ Face ID/Touch ID.")
            }
            return L.t("Chưa cài đặt %@ trên thiết bị — hãy bật trong Cài đặt iOS.", biometry.label)
        }
        if !deviceOwnerAuthAvailable {
            return L.t("Thiết bị chưa đặt mã mở khoá — hãy đặt mã trong Cài đặt iOS trước.")
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
            return L.t("Đã huỷ xác thực.")
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

// MARK: - Password fallback errors

/// Why typing the account password did not open the app.
///
/// There are exactly three things the lock screen may say, and they are kept
/// apart on purpose: a wrong password is a fact about the password, a rate limit
/// is a fact about the server's throttle, and "cannot verify" is a fact about
/// the request that never reached an answer. Collapsing the last two into the
/// first is how a user with the right password gets told it is wrong.
///
/// There is deliberately no "attempts left" case: the UI does not count
/// attempts, because a local counter would be a guess rather than the server's
/// answer.
public enum AppLockPasswordError: Error, Equatable, Sendable {
    /// The API answered **401** `invalid_credentials` — the password is wrong.
    case wrongPassword
    /// The API answered **429** `rate_limited` — its own per-account / per-IP
    /// throttle, not anything this app counted.
    case rateLimited
    /// No answer, or an answer that proves nothing: a transport failure, a
    /// timeout, a 5xx, a 4xx that is not about the password, a malformed login
    /// response, or a session that changed while the request was in flight.
    /// The app stays locked and the existing session is untouched.
    case cannotVerify

    /// User-facing copy, in the language the lock screen is rendering.
    public var message: String {
        switch self {
        case .wrongPassword:
            return L.t("Mật khẩu không đúng. Thử lại.")
        case .rateLimited:
            return L.t("Bạn đã thử quá nhiều lần. Đợi một lát rồi thử lại.")
        case .cannotVerify:
            return L.t("Ứng dụng chưa kiểm tra được mật khẩu lúc này. Kiểm tra kết nối mạng rồi thử lại.")
        }
    }

    /// Maps whatever the auth layer threw onto one of the three outcomes.
    ///
    /// `POST /api/v1/auth/login` uses **401** for a bad password and **429** for
    /// its rate limiter (`api/internal/handlers/auth.go`); every other status is
    /// something else going wrong. A `.decoding` or transport failure is
    /// "could not check", never "wrong password" — guessing otherwise would
    /// accuse a user whose password was fine.
    public static func from(_ error: Error) -> AppLockPasswordError {
        if let local = error as? AppLockPasswordError { return local }
        if let api = error as? APIError {
            switch api.statusCode {
            case 401: return .wrongPassword
            case 429: return .rateLimited
            default:  return .cannotVerify
            }
        }
        return .cannotVerify
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
        context.localizedFallbackTitle = L.t("Dùng mã mở khoá")
        context.localizedCancelTitle = L.t("Huỷ")

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
            return .failed(L.t("Không xác thực được. Thử lại."))
        }
        switch LAError.Code(rawValue: error.code) {
        case .userCancel, .appCancel, .systemCancel:
            return .userCancelled
        case .biometryNotAvailable:
            return .unavailable(L.t("Thiết bị không hỗ trợ sinh trắc học."))
        case .biometryNotEnrolled:
            return .unavailable(L.t("Chưa cài đặt Face ID/Touch ID trên thiết bị."))
        case .biometryLockout:
            return .unavailable(L.t("Sinh trắc học đang tạm bị khoá. Dùng mã mở khoá để tiếp tục."))
        case .passcodeNotSet:
            return .unavailable(L.t("Thiết bị chưa đặt mã mở khoá."))
        case .authenticationFailed:
            return .failed(L.t("Xác thực không thành công. Thử lại."))
        default:
            return .failed(L.t("Không xác thực được. Thử lại."))
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
public let appLockPromptReason = L.t("Mở khoá Warrly để xem dữ liệu bảo hành.")

/// The app lock's state machine. Owned by the app (`@StateObject` in
/// `WarrlyApp`) and rendered by `AppLockScreen`.
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
    /// True while a typed password is being checked against the API.
    @Published public private(set) var isVerifyingPassword = false
    /// The last password attempt's failure, in the lock screen's language, for
    /// the inline note under the field. Cleared when the next attempt starts.
    @Published public private(set) var passwordError: String?
    /// Set when the lock turned itself off because the device lost its
    /// passcode. The account screen shows it until the switch is touched again
    /// or the lock is re-enabled.
    @Published public private(set) var autoDisabledNotice: String?

    private let authenticator: BiometricAuthenticating
    private let storage: AppLockStorage
    private let reason: String
    /// Screenshot QA only — see `init`. Constant `false` outside DEBUG.
    private let isQAForced: Bool

    public init(authenticator: BiometricAuthenticating = LocalAuthenticationAuthenticator(),
                storage: AppLockStorage = UserDefaultsAppLockStorage(),
                reason: String = appLockPromptReason) {
        self.authenticator = authenticator
        self.storage = storage
        self.reason = reason

        let availability = authenticator.availability()
        self.availability = availability

        // Screenshot QA only: a headless simulator has no device passcode, so
        // the safety net below (rule 4) switches the lock off before the cover
        // can be photographed. `WV_QA_APP_LOCK` forces the cover **on** for that
        // shot: it never removes a lock, it is DEBUG-only, and a Release build
        // compiles the branch — and the environment variable — out.
        let qaForced: Bool
        #if DEBUG
        qaForced = ProcessInfo.processInfo.environment["WV_QA_APP_LOCK"] != nil
        #else
        qaForced = false
        #endif
        self.isQAForced = qaForced

        let storedEnabled = storage.isEnabled
        // Rule 4: never lock when there is no way to authenticate.
        if qaForced {
            self.isEnabled = true
            self.isLocked = true
        } else if storedEnabled && availability.passcodeNotSet {
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
        // The QA-forced cover exists precisely because this device has no
        // passcode; re-reading would run the safety net and unlock, which is the
        // one thing the screenshot has to show. Release never takes this branch.
        guard !isQAForced else { return }
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

    /// Called when the scene becomes active again: re-reads what the device can
    /// still do, and **locks harder if it can no longer verify** — but never
    /// opens a prompt by itself.
    ///
    /// It used to `await unlock()` here, and that was a loop: a cancelled Face ID
    /// sheet returns the app to `.active`, which called this, which re-opened the
    /// sheet. Two `.onChange(of: scenePhase)` handlers did it, so cancelling could
    /// re-prompt from both. Unlocking is now a tap (`Mở khoá`) or the `.task` that
    /// runs when the cover appears — never a side effect of coming back.
    public func handleForegroundWithoutPrompt() {
        refreshAvailability()
    }

    /// Dropped by the app on logout — there is nothing to protect once the
    /// session is gone, and the next launch re-locks via `init`.
    public func clearLock() {
        isLocked = false
        lastError = nil
        passwordError = nil
    }

    // MARK: Unlock

    /// Prompts for biometrics (with passcode fallback) when locked. A no-op
    /// while a prompt is already on screen, so repeated `.active` notifications
    /// can't stack system alerts.
    public func unlock() async {
        guard isLocked, !isAuthenticating else { return }
        if availability.passcodeNotSet {
            // Fail open, never strand (rule 4) — except for the QA-forced cover,
            // which is locked *because* this device has no passcode. Release
            // never reaches the second condition (`isQAForced` is a constant
            // `false`), so the fail-open rule is unchanged there.
            if !isQAForced { isLocked = false }
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
            lastError = L.t("Không xác thực được. Thử lại.")
        }
    }

    /// Unlocks with the account password instead of biometrics.
    ///
    /// The password is handed **only** to `verify`, which must prove it against
    /// the API and throw when it is wrong; this store keeps no hash, no cached
    /// answer and no local comparison, so a guess cannot open the app and a
    /// failed request cannot do it either. Any thrown error is rendered as one of
    /// the three `AppLockPasswordError` messages.
    ///
    /// - Parameters:
    ///   - password: exactly what the user typed. Never trimmed — leading or
    ///     trailing whitespace is part of a password.
    ///   - verify: the proof step. The app passes the auth store, which logs in
    ///     against the server and adopts the fresh session.
    public func unlock(password: String, verify: (String) async throws -> Void) async {
        guard isLocked, !isVerifyingPassword, !password.isEmpty else { return }
        isVerifyingPassword = true
        passwordError = nil
        defer { isVerifyingPassword = false }
        do {
            try await verify(password)
            isLocked = false
            lastError = nil
            passwordError = nil
        } catch {
            passwordError = AppLockPasswordError.from(error).message
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
            lastError = L.t("Không xác thực được. Thử lại.")
            return false
        }
    }

    // MARK: Safety net

    private func disableWithoutAuthentication(notice: String) {
        storage.isEnabled = false
        isEnabled = false
        isLocked = false
        passwordError = nil
        autoDisabledNotice = notice
    }

    /// Consumes the one-shot notice so the account screen shows it once.
    public func acknowledgeAutoDisabledNotice() {
        autoDisabledNotice = nil
    }

    static let passcodeLostNotice =
        L.t("Đã tắt khoá ứng dụng vì thiết bị không còn mã mở khoá để xác thực.")
}
