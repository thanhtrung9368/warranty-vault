package com.warrly.auth

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

// MARK: - App lock ("Khoá bằng sinh trắc học")
//
// The Android twin of iOS `AppLockStore` (`ios/Sources/WarrlyKit/AppLock.swift`).
// Same product rules, deliberately copied rather than "reinterpreted":
//
//  1. Opt-in, OFF by default. Turning it ON and turning it OFF each require one
//     successful authentication first, so a user can never switch on a lock they
//     are unable to satisfy and can never silently switch one off.
//  2. The switch may only be turned on when biometrics are enrolled AND the
//     device has a lock screen (PIN / pattern / password). This is the Android
//     form of `canEnableLock`: a device with no credential never locks.
//  3. Unlocking evaluates biometrics WITH the device-credential fallback
//     (`BIOMETRIC_STRONG | DEVICE_CREDENTIAL`), the equivalent of iOS
//     `.deviceOwnerAuthentication` — not biometrics-only. A covered sensor, a
//     lockout or too many failed reads therefore degrades to the PIN instead of
//     stranding the user.
//  4. The one state that can never be authenticated — no credential at all —
//     never locks: it is detected at launch and at every foreground, the stored
//     preference is cleared and the app stays open. Fail open, never strand.
//  5. Re-lock on BACKGROUNDING (`ON_STOP`), not on transient interruption
//     (`ON_PAUSE`, which also fires for dialogs, permission prompts and
//     multi-window focus changes). The same split iOS draws between
//     `.background` and `.inactive`.
//  6. The lock screen always offers "Đăng xuất" as an escape hatch.
//
// It is a **UI lock only**. The bearer token stays in the (encrypted)
// `TokenStore` untouched and nothing here encrypts data at rest — exactly like
// the iOS Files-app-style lock. Nothing in this file may claim otherwise.
//
// ## Why the state machine is a plain Kotlin class
//
// The parts that can be tested without a device (state transitions, the
// "no credential" rule, re-lock on background) are pure: storage, device
// capabilities and the system prompt all enter through small interfaces. The
// real `BiometricPrompt` lives in `BiometricAppLockAuthenticator.kt`, which no
// JVM test can drive — see `AppLockStoreTest`.

/** Why the lock cannot be switched on, in a form the UI can turn into copy. */
enum class AppLockUnavailable {
    /** No PIN / pattern / password: the one state that can never authenticate. */
    NO_DEVICE_CREDENTIAL,

    /** No biometric sensor at all. */
    NO_BIOMETRIC_HARDWARE,

    /** A sensor exists but nothing is enrolled. */
    BIOMETRICS_NOT_ENROLLED,
}

/**
 * Snapshot of what the device can do right now, so the toggle can be disabled
 * *before* the user gets locked behind something unsatisfiable.
 *
 * The field names are the Android facts; the rules on top match
 * `AppLockAvailability` in `AppLock.swift` one for one.
 */
data class AppLockAvailability(
    val biometricHardware: Boolean = false,
    val biometricsEnrolled: Boolean = false,
    /** `KeyguardManager.isDeviceSecure` — a PIN / pattern / password is set. */
    val deviceSecured: Boolean = false,
) {
    /**
     * Rule 2: enrolled biometrics **and** a credential fallback. A device with
     * only a PIN but no fingerprint cannot enable the lock, exactly like iOS
     * requiring Face ID / Touch ID to be enrolled.
     */
    val canEnableLock: Boolean get() = biometricsEnrolled && deviceSecured

    /**
     * Vietnamese copy is resolved by the UI from this enum; the order matches
     * iOS `unavailableReason` (no passcode first, then unsupported sensor, then
     * not enrolled).
     */
    val unavailable: AppLockUnavailable?
        get() = when {
            !deviceSecured -> AppLockUnavailable.NO_DEVICE_CREDENTIAL
            !biometricHardware -> AppLockUnavailable.NO_BIOMETRIC_HARDWARE
            !biometricsEnrolled -> AppLockUnavailable.BIOMETRICS_NOT_ENROLLED
            else -> null
        }
}

/** Why an authentication attempt did not succeed. Cancellation is separate. */
enum class AppLockFailure {
    BIOMETRICS_UNAVAILABLE,
    BIOMETRICS_NOT_ENROLLED,
    BIOMETRICS_LOCKED_OUT,
    NO_DEVICE_CREDENTIAL,
    AUTHENTICATION_FAILED,
    UNKNOWN,
}

/**
 * Outcome of one `BiometricPrompt` call.
 *
 * [Cancelled] is deliberately distinct from [Failed]: backing out of the system
 * prompt is not an error worth shouting about (iOS `AppLockError.isCancellation`
 * makes the same call), so it stays silent and keeps the app locked.
 */
sealed interface AppLockAuthResult {
    data object Success : AppLockAuthResult
    data object Cancelled : AppLockAuthResult
    data class Failed(val failure: AppLockFailure) : AppLockAuthResult
}

/**
 * The seam over the system prompt. `BiometricAppLockAuthenticator` is the
 * production implementation; tests inject a fake so every branch is reachable
 * deterministically.
 */
fun interface AppLockAuthenticator {
    suspend fun authenticate(reason: String): AppLockAuthResult
}

/**
 * Persistence for the on/off switch. It is a UI preference, not a secret — a
 * flag that says "cover the screen", never a key — so plain SharedPreferences
 * is the right home (the bearer token keeps its own encrypted store).
 */
interface AppLockStorage {
    var isEnabled: Boolean
}

/** One-shot explanation shown in Settings after the lock disabled itself. */
enum class AppLockNotice {
    /** The device lost its PIN / pattern / password, so the lock can't be met. */
    DEVICE_CREDENTIAL_LOST,
}

/**
 * The app lock's state machine. App-scoped (`App.onCreate`) and observed by
 * `RootScreen`, `MainActivity` and the Settings row.
 *
 * [capabilities] is a function rather than a value so a device-capability change
 * (credential removed in system settings) can be re-read on every foreground,
 * exactly like iOS `refreshAvailability()`.
 */
class AppLockStore(
    val authenticator: AppLockAuthenticator,
    private val storage: AppLockStorage,
    private val capabilities: () -> AppLockAvailability,
) {

    private val _isEnabled = MutableStateFlow(false)

    /** The stored preference — what the Settings switch reflects. */
    val isEnabled: StateFlow<Boolean> = _isEnabled.asStateFlow()

    private val _isLocked = MutableStateFlow(false)

    /**
     * True while the UI must be covered. Starts `true` on a cold launch when the
     * lock is on, so protected content is never rendered first.
     */
    val isLocked: StateFlow<Boolean> = _isLocked.asStateFlow()

    private val _isAuthenticating = MutableStateFlow(false)
    val isAuthenticating: StateFlow<Boolean> = _isAuthenticating.asStateFlow()

    private val _availability = MutableStateFlow(AppLockAvailability())
    val availability: StateFlow<AppLockAvailability> = _availability.asStateFlow()

    /** Last non-cancellation failure, for the lock-screen / Settings banner. */
    private val _lastFailure = MutableStateFlow<AppLockFailure?>(null)
    val lastFailure: StateFlow<AppLockFailure?> = _lastFailure.asStateFlow()

    /** Set when the lock turned itself off because the credential disappeared. */
    private val _autoDisabledNotice = MutableStateFlow<AppLockNotice?>(null)
    val autoDisabledNotice: StateFlow<AppLockNotice?> = _autoDisabledNotice.asStateFlow()

    init {
        val availability = capabilities()
        _availability.value = availability
        val storedEnabled = storage.isEnabled
        if (storedEnabled && !availability.deviceSecured) {
            // Rule 4: never lock when there is no way to authenticate.
            storage.isEnabled = false
            _isEnabled.value = false
            _isLocked.value = false
            _autoDisabledNotice.value = AppLockNotice.DEVICE_CREDENTIAL_LOST
        } else {
            _isEnabled.value = storedEnabled
            _isLocked.value = storedEnabled
        }
    }

    // ---- Lifecycle ---------------------------------------------------------

    /** Re-reads device capabilities. Cheap, never prompts. */
    fun refreshAvailability() {
        val availability = capabilities()
        _availability.value = availability
        if (_isEnabled.value && !availability.deviceSecured) {
            disableWithoutAuthentication(AppLockNotice.DEVICE_CREDENTIAL_LOST)
        }
    }

    /**
     * Called when the activity reaches `ON_STOP` — i.e. the app is no longer
     * visible. Locks immediately, with no grace period, so the cover is in place
     * before the process can be suspended and the app-switcher card shows the
     * lock screen rather than the user's data.
     *
     * Deliberately NOT `ON_PAUSE`: that fires for in-app dialogs, permission
     * prompts and multi-window focus changes, and locking there would prompt the
     * user mid-gesture.
     */
    fun handleEnterBackground() {
        if (!_isEnabled.value) return
        if (!_availability.value.deviceSecured) return
        _isLocked.value = true
    }

    /** Called when the activity reaches `ON_START` again. Prompts if locked. */
    suspend fun handleForeground(promptReason: String) {
        refreshAvailability()
        if (_isLocked.value) unlock(promptReason)
    }

    /**
     * Dropped on sign-out: there is nothing to protect once the session is gone,
     * and the next cold launch re-locks from the stored preference (rule 4 of the
     * iOS store's lifecycle does the same through `init`).
     */
    fun clearLock() {
        _isLocked.value = false
        _lastFailure.value = null
    }

    // ---- Unlock ------------------------------------------------------------

    /**
     * Prompts for biometrics (with the device-credential fallback) while locked.
     * A no-op while a prompt is already on screen, so repeated `ON_START`
     * notifications and the "Mở khoá" button can't stack system prompts.
     */
    suspend fun unlock(promptReason: String) {
        if (!_isLocked.value || _isAuthenticating.value) return
        if (!_availability.value.deviceSecured) {
            disableWithoutAuthentication(AppLockNotice.DEVICE_CREDENTIAL_LOST)
            return
        }
        _isAuthenticating.value = true
        try {
            when (val result = authenticateSafely(promptReason)) {
                is AppLockAuthResult.Success -> {
                    _isLocked.value = false
                    _lastFailure.value = null
                }
                is AppLockAuthResult.Cancelled -> Unit // stay locked, no banner
                is AppLockAuthResult.Failed -> _lastFailure.value = result.failure
            }
        } finally {
            _isAuthenticating.value = false
        }
    }

    // ---- Toggle ------------------------------------------------------------

    /**
     * Flips the switch. Both directions authenticate first, so neither turning
     * the lock on nor silently turning it off is possible without proving
     * control of the device.
     */
    suspend fun setEnabled(enabled: Boolean, promptReason: String) {
        if (enabled == _isEnabled.value) return
        if (enabled) enable(promptReason) else disable(promptReason)
    }

    private suspend fun enable(promptReason: String) {
        refreshAvailability()
        val availability = _availability.value
        if (!availability.canEnableLock) {
            // Never prompt for a lock that can't be satisfied; the row already
            // shows `availability.unavailable` as its subtitle.
            return
        }
        if (!authenticateForChange(promptReason)) return
        storage.isEnabled = true
        _isEnabled.value = true
        _isLocked.value = false
        _lastFailure.value = null
        _autoDisabledNotice.value = null
    }

    private suspend fun disable(promptReason: String) {
        if (!authenticateForChange(promptReason)) return
        storage.isEnabled = false
        _isEnabled.value = false
        _isLocked.value = false
        _lastFailure.value = null
    }

    /** Returns `true` when the user proved it's them. */
    private suspend fun authenticateForChange(promptReason: String): Boolean {
        _isAuthenticating.value = true
        return try {
            when (val result = authenticateSafely(promptReason)) {
                is AppLockAuthResult.Success -> true
                is AppLockAuthResult.Cancelled -> false
                is AppLockAuthResult.Failed -> {
                    _lastFailure.value = result.failure
                    false
                }
            }
        } finally {
            _isAuthenticating.value = false
        }
    }

    /**
     * The authenticator is contractually non-throwing, but a crashed prompt must
     * not leave `isAuthenticating` stuck or the lock silently open, so anything
     * escaping it becomes the generic failure.
     *
     * Coroutine cancellation is NOT a failure: it happens when the host Activity
     * is destroyed with the prompt up, and swallowing it would keep a cancelled
     * coroutine running. It is rethrown.
     */
    private suspend fun authenticateSafely(promptReason: String): AppLockAuthResult =
        try {
            authenticator.authenticate(promptReason)
        } catch (cancellation: kotlinx.coroutines.CancellationException) {
            throw cancellation
        } catch (_: Exception) {
            AppLockAuthResult.Failed(AppLockFailure.UNKNOWN)
        }

    // ---- Safety net --------------------------------------------------------

    private fun disableWithoutAuthentication(notice: AppLockNotice) {
        storage.isEnabled = false
        _isEnabled.value = false
        _isLocked.value = false
        _autoDisabledNotice.value = notice
    }

    /** Consumes the one-shot notice so Settings shows it once. */
    fun acknowledgeAutoDisabledNotice() {
        _autoDisabledNotice.value = null
    }
}

/**
 * Maps one `BiometricPrompt.ERROR_*` code to a result.
 *
 * Kept here, free of `androidx.biometric` types, so the two rules that matter
 * are unit-testable on the JVM: backing out is a silent cancellation, and every
 * other failure is surfaced. The numeric values are the framework's
 * `BiometricPrompt` constants, which the AndroidX wrapper passes through
 * unchanged (see `androidx.biometric.BiometricPrompt.ERROR_*`).
 */
fun appLockResultForBiometricError(code: Int): AppLockAuthResult = when (code) {
    BIOMETRIC_ERROR_USER_CANCELED,
    BIOMETRIC_ERROR_NEGATIVE_BUTTON,
    BIOMETRIC_ERROR_CANCELED,
    -> AppLockAuthResult.Cancelled

    BIOMETRIC_ERROR_NO_BIOMETRICS ->
        AppLockAuthResult.Failed(AppLockFailure.BIOMETRICS_NOT_ENROLLED)

    BIOMETRIC_ERROR_HW_NOT_PRESENT,
    BIOMETRIC_ERROR_HW_UNAVAILABLE,
    -> AppLockAuthResult.Failed(AppLockFailure.BIOMETRICS_UNAVAILABLE)

    BIOMETRIC_ERROR_LOCKOUT,
    BIOMETRIC_ERROR_LOCKOUT_PERMANENT,
    -> AppLockAuthResult.Failed(AppLockFailure.BIOMETRICS_LOCKED_OUT)

    BIOMETRIC_ERROR_NO_DEVICE_CREDENTIAL ->
        AppLockAuthResult.Failed(AppLockFailure.NO_DEVICE_CREDENTIAL)

    else -> AppLockAuthResult.Failed(AppLockFailure.AUTHENTICATION_FAILED)
}

// androidx.biometric.BiometricPrompt error codes (framework values, stable).
private const val BIOMETRIC_ERROR_HW_UNAVAILABLE = 1
private const val BIOMETRIC_ERROR_CANCELED = 5
private const val BIOMETRIC_ERROR_LOCKOUT = 7
private const val BIOMETRIC_ERROR_LOCKOUT_PERMANENT = 9
private const val BIOMETRIC_ERROR_USER_CANCELED = 10
private const val BIOMETRIC_ERROR_NO_BIOMETRICS = 11
private const val BIOMETRIC_ERROR_HW_NOT_PRESENT = 12
private const val BIOMETRIC_ERROR_NEGATIVE_BUTTON = 13
private const val BIOMETRIC_ERROR_NO_DEVICE_CREDENTIAL = 14
