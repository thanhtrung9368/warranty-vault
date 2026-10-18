package com.warrly.auth

import android.app.KeyguardManager
import android.content.Context
import android.content.SharedPreferences
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import com.warrly.R
import java.lang.ref.WeakReference
import kotlin.coroutines.resume
import kotlinx.coroutines.suspendCancellableCoroutine

/**
 * The real device facts behind [AppLockAvailability].
 *
 * `BiometricManager.canAuthenticate(BIOMETRIC_STRONG)` is the AndroidX answer to
 * "is a strong biometric enrolled", and `KeyguardManager.isDeviceSecure` is the
 * answer to "does this device have a lock screen at all" — the state rule 4 is
 * about. A device with neither is the only one that can never authenticate.
 */
class AndroidAppLockCapabilities(private val context: Context) {

    fun read(): AppLockAvailability {
        val canAuthenticate = BiometricManager.from(context)
            .canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG)
        val keyguard = context.getSystemService(Context.KEYGUARD_SERVICE) as? KeyguardManager
        return AppLockAvailability(
            biometricHardware = canAuthenticate != BiometricManager.BIOMETRIC_ERROR_NO_HARDWARE,
            biometricsEnrolled = canAuthenticate == BiometricManager.BIOMETRIC_SUCCESS,
            deviceSecured = keyguard?.isDeviceSecure == true,
        )
    }
}

/**
 * Persistence for the on/off switch, following the `ThemeStore` /
 * `LanguageStore` pattern: a plain `SharedPreferences` file, one key, no
 * encryption. The flag is a preference ("cover the screen"), never a secret —
 * the bearer token has its own encrypted store and is untouched by this.
 */
class SharedPreferencesAppLockStorage(context: Context) : AppLockStorage {

    private val prefs: SharedPreferences =
        context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    override var isEnabled: Boolean
        get() = prefs.getBoolean(KEY_ENABLED, false)
        set(value) = prefs.edit().putBoolean(KEY_ENABLED, value).apply()

    private companion object {
        const val PREFS_NAME = "wv_app_lock"
        const val KEY_ENABLED = "app_lock_enabled"
    }
}

/**
 * Production [AppLockAuthenticator] — the actual `androidx.biometric`
 * `BiometricPrompt`.
 *
 * Unlocking allows `BIOMETRIC_STRONG | DEVICE_CREDENTIAL`, i.e. biometrics with
 * the device PIN / pattern / password as the fallback: the equivalent of iOS
 * `.deviceOwnerAuthentication` (not `.deviceOwnerAuthenticationWithBiometrics`).
 * `setAllowedAuthenticators` only accepts that combination from API 30, so
 * below 30 the deprecated-but-supported `setDeviceCredentialAllowed(true)`,
 * which is the same request routed through AndroidX's compat dialog, is used.
 *
 * The prompt needs a `FragmentActivity` host. MainActivity is one, and attaches
 * itself via [attach] on create / [detach] on destroy; the reference is weak so
 * a recreated Activity is never leaked.
 */
class BiometricAppLockAuthenticator(private val context: Context) : AppLockAuthenticator {

    private var host: WeakReference<FragmentActivity>? = null

    fun attach(activity: FragmentActivity) {
        host = WeakReference(activity)
    }

    fun detach(activity: FragmentActivity) {
        if (host?.get() === activity) host = null
    }

    override suspend fun authenticate(reason: String): AppLockAuthResult {
        val activity = host?.get()
        if (activity == null || activity.isFinishing || activity.isDestroyed) {
            return AppLockAuthResult.Failed(AppLockFailure.UNKNOWN)
        }
        return suspendCancellableCoroutine { continuation ->
            val prompt = BiometricPrompt(
                activity,
                ContextCompat.getMainExecutor(activity),
                object : BiometricPrompt.AuthenticationCallback() {
                    override fun onAuthenticationSucceeded(
                        result: BiometricPrompt.AuthenticationResult,
                    ) {
                        if (continuation.isActive) continuation.resume(AppLockAuthResult.Success)
                    }

                    override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                        if (continuation.isActive) {
                            continuation.resume(appLockResultForBiometricError(errorCode))
                        }
                    }

                    // A single non-matching read: the system prompt stays open so
                    // the user can retry. Not a result.
                    override fun onAuthenticationFailed() = Unit
                },
            )
            val info = BiometricPrompt.PromptInfo.Builder()
                .setTitle(reason)
                .setSubtitle(context.getString(R.string.app_lock_prompt_subtitle))
                // Do not require the extra "confirm" tap after a successful read.
                .setConfirmationRequired(false)
                .apply {
                    if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.R) {
                        setAllowedAuthenticators(
                            BiometricManager.Authenticators.BIOMETRIC_STRONG or
                                BiometricManager.Authenticators.DEVICE_CREDENTIAL,
                        )
                    } else {
                        // API 28/29 reject BIOMETRIC_STRONG|DEVICE_CREDENTIAL from
                        // setAllowedAuthenticators; this is the documented pre-30
                        // spelling of the same request.
                        @Suppress("DEPRECATION")
                        setDeviceCredentialAllowed(true)
                    }
                }
                .build()
            continuation.invokeOnCancellation { prompt.cancelAuthentication() }
            prompt.authenticate(info)
        }
    }
}
