package com.warrly

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.widget.Toast
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.annotation.StringRes
import androidx.compose.material3.Surface
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.core.content.ContextCompat
import androidx.core.content.IntentCompat
import androidx.core.net.toUri
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.lifecycleScope
import com.warrly.auth.AuthStore
import com.warrly.auth.BiometricAppLockAuthenticator
import com.warrly.i18n.LanguageStore
import com.warrly.i18n.LocaleSupport
import com.warrly.network.ApiClient
import com.warrly.network.toUserMessage
import com.warrly.share.ShareTarget
import com.warrly.share.SharedFile
import com.warrly.ui.RootScreen
import com.warrly.ui.screens.attachments.readPickedAttachment
import com.warrly.ui.theme.WarrlyTheme
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * `FragmentActivity`, not `ComponentActivity`: the app lock's
 * `androidx.biometric.BiometricPrompt` can only be hosted by a
 * `FragmentActivity` (it is a Fragment under the hood, also on API 28+).
 * `FragmentActivity` IS a `ComponentActivity`, so `setContent`,
 * `enableEdgeToEdge` and `registerForActivityResult` are unchanged.
 */
class MainActivity : FragmentActivity() {

    private val notificationPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { /* ignore — user choice persisted by system */ }

    /**
     * The language switch (phase 2 of docs/I18N_PLAN.md), in one override.
     *
     * This runs before `onCreate`, so the very first frame is already drawn in
     * the chosen language — there is no flash of the other one. It reads the
     * preference straight from `SharedPreferences` rather than through
     * `App.instance` (which may not be initialised on a process restore), and
     * falls back to the system language via the pure `AppLanguage.resolve`.
     *
     * Changing the language therefore needs no special path: the Activity is
     * recreated (see below) and this override runs again with the new value.
     */
    override fun attachBaseContext(newBase: Context) {
        super.attachBaseContext(LocaleSupport.wrap(newBase, LanguageStore.current(newBase)))
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        // Verify session on launch — RootScreen routes Login vs Main.
        App.instance.auth.bootstrap()

        // App lock ("Khoá bằng sinh trắc học"): this Activity is the host the
        // system BiometricPrompt is presented from.
        val appLock = App.instance.appLock
        (appLock.authenticator as? BiometricAppLockAuthenticator)?.attach(this)
        val promptReason = resources.getString(R.string.app_lock_prompt_reason)
        lifecycle.addObserver(LifecycleEventObserver { _, event ->
            when (event) {
                // Re-lock on BACKGROUNDING. `ON_STOP` is the Android equivalent of
                // iOS `.background`; `ON_PAUSE` also fires for dialogs, permission
                // prompts and multi-window focus changes, which must not lock.
                Lifecycle.Event.ON_STOP ->
                    if (!isChangingConfigurations) appLock.handleEnterBackground()

                // Prompt on the way back in — but only for a signed-in session
                // (iOS RootView guards `.active` the same way: there is nothing to
                // protect on the login screen). `isAuthenticating` inside the
                // store makes this a no-op while a prompt is already on screen, so
                // a recreation or a second `ON_START` cannot stack two.
                Lifecycle.Event.ON_START -> lifecycleScope.launch {
                    if (App.instance.auth.status.value is AuthStore.Status.Authenticated) {
                        appLock.handleForeground(promptReason)
                    } else {
                        // Capabilities can change while signed out too (the user
                        // may have removed the screen lock); cheap, no prompt.
                        appLock.refreshAvailability()
                    }
                }

                else -> Unit
            }
        })

        // A cold launch with a stored session goes Idle → Authenticated AFTER
        // ON_START, so that transition is the one that actually owns the first
        // prompt. (Without it, a locked app that restored a session would sit on
        // the cover until the user tapped "Mở khoá".) This mirrors the iOS
        // `AppLockScreen.task` prompt, which fires when the cover appears.
        lifecycleScope.launch {
            var wasAuthenticated = false
            App.instance.auth.status.collect { status ->
                val nowAuthenticated = status is AuthStore.Status.Authenticated
                if (nowAuthenticated && !wasAuthenticated &&
                    lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)
                ) {
                    appLock.handleForeground(promptReason)
                }
                wasAuthenticated = nowAuthenticated
            }
        }

        // Recreate when Settings changes the language. `applied` starts at the
        // value this Activity was built with, so the collector's first emission
        // (a StateFlow always replays its current value) is not mistaken for a
        // change — which would otherwise be an infinite recreate loop.
        var applied = App.instance.languageStore.language.value
        lifecycleScope.launch {
            App.instance.languageStore.language.collect { language ->
                if (language != applied) {
                    applied = language
                    recreate()
                }
            }
        }

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
            WarrlyTheme(preference = themePref) {
                Surface(modifier = Modifier) {
                    RootScreen(auth = App.instance.auth, appLock = App.instance.appLock)
                }
            }
        }
    }

    override fun onDestroy() {
        (App.instance.appLock.authenticator as? BiometricAppLockAuthenticator)?.detach(this)
        super.onDestroy()
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

            is ShareTarget.Delivery.CapturedFile -> readSharedFile(delivery.file)

            is ShareTarget.Delivery.Rejected ->
                // Nothing usable. Say so — opening an empty form (or nothing
                // at all) would look like the share worked.
                //
                // Rendered from resources rather than `ShareTarget.message()`
                // so it follows the UI language; `ShareTarget` stays plain
                // Kotlin (no `R`, no `android.*`) and keeps the Vietnamese
                // mirror that ShareTargetTest pins.
                toast(getString(messageRes(delivery.reason)))

            ShareTarget.Delivery.Ignored -> Unit
        }
    }

    /**
     * Copies a shared photo/PDF out of its content URI **now**.
     *
     * `EXTRA_STREAM` is a transient grant: the receiver may read the URI while
     * the activity that received the intent is alive, and not necessarily after
     * it is gone. The bytes therefore have to be read in this callback, not from
     * a worker, a WorkManager job, or "when the user gets to the inbox later".
     * `readPickedAttachment` is the one shared reader: it enforces the same 5 MB
     * cap as every other attachment path and throws a localized sentence when
     * the file is too large or unreadable.
     *
     * [App.ioScope] rather than `lifecycleScope`: a rotation cancels
     * `lifecycleScope` and would abandon the copy halfway, losing a share whose
     * URI grant disappears with the activity. The copy starts immediately
     * either way; the process scope only lets that already-started read finish.
     *
     * The bytes are parked in [com.warrly.share.ShareIntake] for the Inbox
     * screen's confirmation card. If this fails, a Toast says why and no
     * half-read file is left behind. The Toast is posted to the main thread
     * because this runs on IO and may outlive the Activity instance.
     */
    private fun readSharedFile(file: ShareTarget.FileShare) {
        val uri = file.uri.toUri()
        // The Activity context (not `applicationContext`) is passed to the
        // reader because `readPickedAttachment` resolves its "too large" /
        // "cannot read" sentence from resources, and only the Activity is
        // wrapped with the language the user picked. The coroutine keeps this
        // reference for the duration of one short copy; the Toast itself uses
        // the application context so a destroyed Activity is not retained.
        val uiContext = this
        App.instance.ioScope.launch {
            try {
                val picked = readPickedAttachment(
                    context = uiContext,
                    uri = uri,
                    // A wildcard declared type (`image/*`) is not a usable
                    // multipart Content-Type; only a concrete one can stand in
                    // for a provider that reports nothing.
                    fallbackMimeType = file.mimeType
                        .takeIf { it != ShareTarget.MIME_TYPE_IMAGE_WILDCARD },
                )
                val resolvedMime = ShareTarget.baseMime(picked.mimeType) ?: picked.mimeType
                if (!ShareTarget.isStorableFileMime(resolvedMime)) {
                    // The OS filter's image wildcard let a type through that the
                    // upload pipeline cannot store (BMP/SVG/TIFF/…): refuse it
                    // here rather than after a doomed upload.
                    val message = uiContext.getString(R.string.share_rejected_unsupported_file)
                    withContext(Dispatchers.Main) { toast(message) }
                    return@launch
                }
                App.instance.shareIntake.hold(
                    SharedFile(
                        fileName = picked.fileName,
                        // Store the normalised type: the multipart part needs a
                        // bare media type, not `image/jpeg; name=…`.
                        mimeType = resolvedMime,
                        bytes = picked.bytes,
                    ),
                )
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                val message = e.toUserMessage(ApiClient.json, uiContext)
                withContext(Dispatchers.Main) { toast(message) }
            }
        }
    }

    private fun toast(message: String) {
        Toast.makeText(applicationContext, message, Toast.LENGTH_LONG).show()
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
 * The only Android-aware step of the share flattening: turn the extras this
 * feature reads into the pure [ShareTarget.Payload]. `EXTRA_TEXT` is a
 * `CharSequence` — several senders pass a `Spanned` string — so it is flattened
 * with `getCharSequenceExtra` rather than cast to `String`.
 *
 * A stream can arrive in two places, both handled: `EXTRA_STREAM` (the normal
 * single-file share) and `ClipData` (some senders put the URI only in the clip,
 * and it is also where a multi-select share carries its list). Both are read
 * with the AndroidX compat helpers so API 33's typed-Parcelable API and the
 * older untyped one behave the same.
 */
private fun Intent.toSharePayload(): ShareTarget.Payload {
    val streams = sharedStreamUris()
    return ShareTarget.Payload(
        action = action,
        type = type,
        text = getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString(),
        subject = getCharSequenceExtra(Intent.EXTRA_SUBJECT)?.toString(),
        stream = streams.firstOrNull()?.toString(),
        streamCount = streams.size,
    )
}

/**
 * Every `content://`-ish URI the intent carries, from `EXTRA_STREAM` first and
 * `ClipData` second. The size matters: [ShareTarget.deliver] rejects more than
 * one, because this app keeps one pending share and the manifest advertises
 * `ACTION_SEND` only.
 *
 * `runCatching` around the parcelable reads is deliberate: a malformed sender
 * that puts an `ArrayList` where a single URI is expected would otherwise
 * throw a `ClassCastException` while the share is being classified.
 */
private fun Intent.sharedStreamUris(): List<Uri> {
    val single = runCatching {
        IntentCompat.getParcelableExtra(this, Intent.EXTRA_STREAM, Uri::class.java)
    }.getOrNull()
    if (single != null) return listOf(single)

    val multiple = runCatching {
        IntentCompat.getParcelableArrayListExtra(this, Intent.EXTRA_STREAM, Uri::class.java)
    }.getOrNull()
    if (!multiple.isNullOrEmpty()) return multiple

    val clip = clipData ?: return emptyList()
    return (0 until clip.itemCount).mapNotNull { clip.getItemAt(it).uri }
}

/**
 * Why a shared item was refused, as a string resource. The mapping lives here
 * rather than in `ShareTarget` so that file stays free of `R` / Android types
 * (it is unit-tested as ordinary JVM code).
 */
@StringRes
private fun messageRes(reason: ShareTarget.Reason): Int = when (reason) {
    ShareTarget.Reason.NO_LINK -> R.string.share_rejected_no_link
    ShareTarget.Reason.UNSUPPORTED_SCHEME -> R.string.share_rejected_unsupported_scheme
    ShareTarget.Reason.UNSUPPORTED_FILE_TYPE -> R.string.share_rejected_unsupported_file
    ShareTarget.Reason.FILE_WITHOUT_STREAM -> R.string.share_rejected_no_file
    ShareTarget.Reason.MULTIPLE_FILES -> R.string.share_rejected_multiple_files
}
