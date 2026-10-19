package com.warrly

import android.app.Application
import com.warrly.auth.AndroidAppLockCapabilities
import com.warrly.auth.AppLockStore
import com.warrly.auth.AuthStore
import com.warrly.auth.BiometricAppLockAuthenticator
import com.warrly.auth.SharedPreferencesAppLockStorage
import com.warrly.auth.TokenStore
import com.warrly.core.push.PushRegistrar
import com.warrly.i18n.LanguageStore
import com.warrly.network.ApiClient
import com.warrly.network.ApiService
import com.warrly.navigation.NavigationIntake
import com.warrly.share.ShareIntake
import com.warrly.ui.theme.ThemeStore
import com.warrly.widget.DeadlineSnapshotUpdater
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob

/**
 * Manual DI — small enough that we don't need Hilt yet. Holds the singletons
 * that every screen needs: TokenStore, ApiService, AuthStore.
 */
class App : Application() {

    lateinit var tokenStore: TokenStore
        private set
    lateinit var api: ApiService
        private set
    lateinit var auth: AuthStore
        private set
    lateinit var pushRegistrar: PushRegistrar
        private set
    lateinit var themeStore: ThemeStore
        private set

    /**
     * The opt-in app lock ("Khoá bằng sinh trắc học") — the Android twin of the
     * iOS `AppLockStore`. App-scoped so the lock survives Activity recreation
     * (language change, rotation) instead of re-prompting; the prompt itself is
     * hosted by whichever `MainActivity` is current (see
     * `BiometricAppLockAuthenticator.attach`).
     */
    lateinit var appLock: AppLockStore
        private set

    /**
     * The UI language (docs/I18N_PLAN.md phase 2). Read by
     * `MainActivity.attachBaseContext` to wrap the resources, and by the
     * `Accept-Language` provider below so the API answers in the same language
     * the screen is rendered in.
     */
    lateinit var languageStore: LanguageStore
        private set

    /**
     * Share target (#10) mailbox. Lives on `App` (process scope) rather than on
     * the Activity because the share arrives before the user is necessarily
     * signed in, and the Activity can be recreated in between: a link shared on
     * the login screen must survive until the wishlist form can show it.
     */
    lateinit var shareIntake: ShareIntake
        private set

    /**
     * A destination asked for by a launcher shortcut or the home-screen widget.
     *
     * Process-scoped for the same reason as [shareIntake]: the shortcut can be
     * tapped while the login screen is up, and the request has to survive until
     * the signed-in shell exists. `MainScreen` consumes it once and switches
     * tabs.
     */
    lateinit var navigationIntake: NavigationIntake
        private set

    /**
     * Keeps the home-screen widget's local snapshot in step with the account.
     *
     * The widget never calls the API itself; this updater captures
     * `GET /api/v1/reminders?withinDays=365` on foreground and after any
     * deadline-changing write (hooked centrally through OkHttp — see
     * `ApiClient.build`).
     */
    lateinit var deadlineSnapshots: DeadlineSnapshotUpdater
        private set

    /**
     * Process-scoped IO for the one job that must not be cancelled by an
     * Activity recreation: copying a shared photo/PDF out of its content URI.
     *
     * The URI's read grant lives with the receiving activity's task, so the copy
     * has to start **immediately** when the share arrives (the Activity does
     * that) — but it must also be allowed to *finish* if the user rotates or the
     * system recreates the Activity mid-read. `lifecycleScope` would cancel the
     * copy halfway and silently lose a share the user cannot re-share.
     *
     * It also hosts the widget snapshot refresh: that is a short background
     * write whose result must survive the Activity that triggered it (a rotation
     * during the request must not cancel the capture). It is deliberately not a
     * general escape hatch from lifecycle scoping.
     */
    lateinit var ioScope: CoroutineScope
        private set

    override fun onCreate() {
        super.onCreate()
        instance = this
        tokenStore = TokenStore(this)
        ioScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
        deadlineSnapshots = DeadlineSnapshotUpdater(this, ioScope, tokenStore)
        navigationIntake = NavigationIntake()
        languageStore = LanguageStore(this)
        // Both providers are lambdas read per request, so a language change in
        // Settings takes effect on the next call without rebuilding Retrofit.
        // `onDeadlineMutation` is the widget's write hook: it fires only for
        // successful writes that can move a warranty end date.
        api = ApiClient.build(
            baseUrl = BuildConfig.BASE_URL,
            tokenProvider = { tokenStore.read() },
            languageProvider = { languageStore.language.value.tag },
            onDeadlineMutation = { deadlineSnapshots.onMutation() },
        )
        deadlineSnapshots.attach(api)
        auth = AuthStore(tokenStore, api, languageStore = languageStore)
        pushRegistrar = PushRegistrar(api, tokenStore, auth)
        pushRegistrar.start()
        themeStore = ThemeStore(this)
        // Created here (not in the Activity) so the "locked" state survives a
        // recreation; `init` reads the stored preference and starts locked, so
        // protected content is never laid out before the cover.
        appLock = AppLockStore(
            authenticator = BiometricAppLockAuthenticator(this),
            storage = SharedPreferencesAppLockStorage(this),
            capabilities = AndroidAppLockCapabilities(this)::read,
        )
        shareIntake = ShareIntake()
    }

    companion object {
        @JvmStatic
        lateinit var instance: App
            private set
    }
}
