package com.warrly.ui.screens.lock

import androidx.annotation.StringRes
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Fingerprint
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.warrly.R
import com.warrly.auth.AppLockFailure
import com.warrly.auth.AppLockNotice
import com.warrly.auth.AppLockStore
import com.warrly.auth.AppLockUnavailable
import com.warrly.auth.AuthStore
import kotlinx.coroutines.launch

/**
 * Full-screen cover shown while the app lock is engaged — the Android twin of
 * iOS `AppLockScreen` (`ios/App/RootView.swift`).
 *
 * Unlocking evaluates biometrics **with the device screen lock as fallback**, so
 * a failed or unavailable sensor degrades to the PIN instead of locking the user
 * out. "Đăng xuất" is the escape hatch of last resort: it clears the (keystore-
 * backed) session, and the account can always be reached again with email and
 * password.
 *
 * The automatic prompt is owned by `MainActivity`'s `ON_START` handler
 * (`AppLockStore.handleForeground`), not by this composable: presenting a
 * BiometricPrompt before the Activity has started can throw, and the
 * `isAuthenticating` guard already prevents the button and the lifecycle from
 * stacking two prompts. This screen only renders the state and offers a retry.
 *
 * It is a UI lock: the bearer token stays untouched in `TokenStore` and nothing
 * here encrypts data at rest.
 */
@Composable
fun AppLockScreen(
    auth: AuthStore,
    appLock: AppLockStore,
    modifier: Modifier = Modifier,
) {
    val scope = rememberCoroutineScope()
    val promptReason = stringResource(R.string.app_lock_prompt_reason)
    val authenticating by appLock.isAuthenticating.collectAsState()
    val failure by appLock.lastFailure.collectAsState()
    val cs = MaterialTheme.colorScheme

    Surface(
        modifier = modifier.fillMaxSize(),
        color = cs.background,
    ) {
        Box(Modifier.fillMaxSize()) {
            // Scrim: an opaque cover is not enough on its own — the signed-in
            // shell is still composed underneath and would receive taps that this
            // screen does not handle. The scrim sits ABOVE the shell but BELOW
            // this screen's own content (drawn later), so "Mở khoá" and "Đăng
            // xuất" still work while a blind tap on the cover does nothing.
            // Same idea as `ModalBottomSheet`'s scrim.
            Box(
                Modifier
                    .matchParentSize()
                    .pointerInput(Unit) { detectTapGestures(onTap = {}) },
            )
            Column(
                Modifier
                    .fillMaxSize()
                    .windowInsetsPadding(WindowInsets.safeDrawing)
                    .padding(horizontal = 28.dp, vertical = 24.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
            ) {
                Box(
                    Modifier
                        .size(96.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        Icons.Outlined.Lock,
                        contentDescription = null,
                        tint = cs.primary,
                        modifier = Modifier.size(64.dp),
                    )
                }
                Spacer(Modifier.height(12.dp))
                Text(
                    stringResource(R.string.app_lock_title),
                    fontSize = 22.sp,
                    fontWeight = FontWeight.Bold,
                    textAlign = TextAlign.Center,
                )
                Spacer(Modifier.height(8.dp))
                Text(
                    stringResource(R.string.app_lock_subtitle),
                    fontSize = 15.sp,
                    color = cs.onSurfaceVariant,
                    textAlign = TextAlign.Center,
                )
                Spacer(Modifier.height(24.dp))
                if (authenticating) {
                    CircularProgressIndicator(Modifier.size(28.dp))
                } else {
                    Button(
                        onClick = { scope.launch { appLock.unlock(promptReason) } },
                        shape = CircleShape,
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(52.dp),
                    ) {
                        Icon(Icons.Filled.Fingerprint, null, modifier = Modifier.size(20.dp))
                        Spacer(Modifier.width(8.dp))
                        Text(
                            stringResource(R.string.app_lock_unlock),
                            fontWeight = FontWeight.SemiBold,
                        )
                    }
                }

                failure?.let { failure ->
                    Spacer(Modifier.height(16.dp))
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(
                            Icons.Outlined.WarningAmber,
                            contentDescription = null,
                            tint = cs.error,
                            modifier = Modifier.size(16.dp),
                        )
                        Spacer(Modifier.width(6.dp))
                        Text(
                            stringResource(failure.messageRes()),
                            color = cs.error,
                            fontSize = 14.sp,
                            textAlign = TextAlign.Center,
                        )
                    }
                }

                Spacer(Modifier.height(20.dp))
                TextButton(
                    onClick = {
                        // Signing out is the escape hatch of last resort. The cover
                        // is NOT dropped here: `RootScreen` clears the lock when the
                        // auth status actually becomes unauthenticated, which is what
                        // keeps the shell hidden while the logout request is in
                        // flight (iOS awaits `auth.logout()` before
                        // `appLock.clearLock()` for the same reason). The next
                        // sign-in re-arms the lock from the stored preference,
                        // exactly like a cold launch.
                        auth.logout()
                    },
                ) {
                    Text(
                        stringResource(R.string.set_sign_out),
                        fontSize = 16.sp,
                        fontWeight = FontWeight.SemiBold,
                    )
                }
                Spacer(Modifier.height(4.dp))
                Text(
                    stringResource(R.string.app_lock_sign_out_hint),
                    fontSize = 13.sp,
                    color = cs.onSurfaceVariant,
                    textAlign = TextAlign.Center,
                )
            }
        }
    }
}

/**
 * Vietnamese copy for an authentication failure. Lives next to the screen that
 * shows it so every `AppLockFailure` is visibly handled — a new enum case fails
 * to compile here until it has something to say.
 */
@StringRes
fun AppLockFailure.messageRes(): Int = when (this) {
    AppLockFailure.BIOMETRICS_UNAVAILABLE -> R.string.app_lock_error_biometrics_unavailable
    AppLockFailure.BIOMETRICS_NOT_ENROLLED -> R.string.app_lock_error_biometrics_not_enrolled
    AppLockFailure.BIOMETRICS_LOCKED_OUT -> R.string.app_lock_error_lockout
    AppLockFailure.NO_DEVICE_CREDENTIAL -> R.string.app_lock_error_no_device_credential
    AppLockFailure.AUTHENTICATION_FAILED -> R.string.app_lock_error_auth_failed
    AppLockFailure.UNKNOWN -> R.string.app_lock_error_unknown
}

/** Vietnamese copy for "why can't I switch this on". */
@StringRes
fun AppLockUnavailable.messageRes(): Int = when (this) {
    AppLockUnavailable.NO_DEVICE_CREDENTIAL -> R.string.app_lock_unavailable_no_credential
    AppLockUnavailable.NO_BIOMETRIC_HARDWARE -> R.string.app_lock_unavailable_no_hardware
    AppLockUnavailable.BIOMETRICS_NOT_ENROLLED -> R.string.app_lock_unavailable_not_enrolled
}

/** Vietnamese copy for the one-shot self-disabled notice. */
@StringRes
fun AppLockNotice.messageRes(): Int = when (this) {
    AppLockNotice.DEVICE_CREDENTIAL_LOST -> R.string.app_lock_auto_disabled
}
