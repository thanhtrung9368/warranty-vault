package com.warrantyvault.app

import android.app.Application
import com.warrantyvault.app.auth.AuthStore
import com.warrantyvault.app.auth.TokenStore
import com.warrantyvault.app.core.push.PushRegistrar
import com.warrantyvault.app.network.ApiClient
import com.warrantyvault.app.network.ApiService
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

    override fun onCreate() {
        super.onCreate()
        instance = this
        tokenStore = TokenStore(this)
        api = ApiClient.build(BuildConfig.BASE_URL) { tokenStore.read() }
        auth = AuthStore(tokenStore, api)
        pushRegistrar = PushRegistrar(api, tokenStore, auth)
        pushRegistrar.start()
        themeStore = ThemeStore(this)
    }

    companion object {
        @JvmStatic
        lateinit var instance: App
            private set
    }
}
