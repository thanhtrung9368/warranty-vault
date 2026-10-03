package com.warrantyvault.app

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.material3.Surface
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.core.content.ContextCompat
import com.warrantyvault.app.share.ShareTarget
import com.warrantyvault.app.ui.RootScreen
import com.warrantyvault.app.ui.theme.WarrantyVaultTheme

class MainActivity : ComponentActivity() {

    private val notificationPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { /* ignore — user choice persisted by system */ }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        // Verify session on launch — RootScreen routes Login vs Main.
        App.instance.auth.bootstrap()

        // Android 13+ runtime permission for notifications. On older versions
        // the manifest permission alone is sufficient.
        maybeRequestNotificationPermission()

        // Share target (#10). `savedInstanceState != null` means this is a
        // RECREATION — a rotation, a dark-mode switch, or a process-death
        // restore — and Android redelivers the very same ACTION_SEND intent
        // here. Consuming it again would reopen the wishlist form on top of
        // whatever the user was doing (and discard what they had typed), which
        // is the classic bug in this feature. ShareTarget.deliver() owns that
        // rule so it is unit-tested instead of trusted.
        handleShareIntent(intent, fromSavedState = savedInstanceState != null)

        setContent {
            val themePref by App.instance.themeStore.preference.collectAsState()
            WarrantyVaultTheme(preference = themePref) {
                Surface(modifier = Modifier) {
                    RootScreen(auth = App.instance.auth)
                }
            }
        }
    }

    /**
     * A share that arrives while the app is already running. With
     * `launchMode="singleTop"` (manifest) this is the normal path for a
     * foreground app; it is always a genuine new share — there is no saved
     * instance state involved — so it is never treated as a duplicate.
     *
     * [setIntent] keeps `getIntent()` in sync with the newest intent, so a
     * later recreation restores the *current* share rather than an old one.
     */
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleShareIntent(intent, fromSavedState = false)
    }

    private fun handleShareIntent(intent: Intent?, fromSavedState: Boolean) {
        when (val delivery = ShareTarget.deliver(intent?.toSharePayload(), fromSavedState)) {
            is ShareTarget.Delivery.Captured ->
                // Parked, not shown: the form lives in the signed-in shell, and
                // the user may still be looking at the login screen. MainScreen
                // picks it up as soon as it exists.
                App.instance.shareIntake.hold(delivery.product)

            is ShareTarget.Delivery.Rejected ->
                // No link we can use. Say so — opening an empty form (or
                // nothing at all) would look like the share worked.
                Toast.makeText(
                    this,
                    ShareTarget.message(delivery.reason),
                    Toast.LENGTH_LONG,
                ).show()

            ShareTarget.Delivery.Ignored -> Unit
        }
    }

    private fun maybeRequestNotificationPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
        val granted = ContextCompat.checkSelfPermission(
            this, Manifest.permission.POST_NOTIFICATIONS,
        ) == PackageManager.PERMISSION_GRANTED
        if (!granted) {
            notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }
}

/**
 * The only Android-aware step of the share intake: flatten the two extras this
 * feature reads into the pure [ShareTarget.Payload]. `EXTRA_TEXT` is a
 * `CharSequence` — several senders pass a `Spanned` string — so it is flattened
 * with `getCharSequenceExtra` rather than cast to `String`.
 */
private fun Intent.toSharePayload(): ShareTarget.Payload = ShareTarget.Payload(
    action = action,
    type = type,
    text = getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString(),
    subject = getCharSequenceExtra(Intent.EXTRA_SUBJECT)?.toString(),
)
