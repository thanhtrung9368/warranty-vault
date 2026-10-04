package com.warrantyvault.app

import android.app.Application
import com.warrantyvault.app.auth.AuthStore
import com.warrantyvault.app.auth.TokenStore
import com.warrantyvault.app.core.push.PushRegistrar
import com.warrantyvault.app.i18n.LanguageStore
import com.warrantyvault.app.network.ApiClient
import com.warrantyvault.app.network.ApiService
import com.warrantyvault.app.share.ShareIntake
import com.warrantyvault.app.ui.theme.ThemeStore

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

    override fun onCreate() {
        super.onCreate()
        instance = this
        tokenStore = TokenStore(this)
        languageStore = LanguageStore(this)
        // Both providers are lambdas read per request, so a language change in
        // Settings takes effect on the next call without rebuilding Retrofit.
        api = ApiClient.build(
            baseUrl = BuildConfig.BASE_URL,
            tokenProvider = { tokenStore.read() },
            languageProvider = { languageStore.language.value.tag },
        )
        auth = AuthStore(tokenStore, api, languageStore = languageStore)
        pushRegistrar = PushRegistrar(api, tokenStore, auth)
        pushRegistrar.start()
        themeStore = ThemeStore(this)
        shareIntake = ShareIntake()
    }

    companion object {
        @JvmStatic
        lateinit var instance: App
            private set
    }
}
