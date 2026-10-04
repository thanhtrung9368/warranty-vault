package com.warrantyvault.app.i18n

import android.content.Context
import android.content.SharedPreferences
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.util.Locale

/**
 * The UI language, cached on the device.
 *
 * Follows the shape of [com.warrantyvault.app.ui.theme.ThemeStore]: plain
 * `SharedPreferences` (not EncryptedSharedPreferences — a language is not a
 * secret, and this value has to be readable from
 * [com.warrantyvault.app.MainActivity.attachBaseContext], which runs before the
 * encrypted store is unlocked) plus a `StateFlow` so the Activity can recreate
 * itself when the choice changes.
 *
 * ## Two stores, on purpose
 *
 * The AUTHORITATIVE record of the user's language is `User.locale` on the
 * server, because the cron push fan-out and the transactional emails run with no
 * request context and have nothing else to read (`docs/I18N_PLAN.md` §2.3). This
 * local copy exists for a different reason: the first frame after a cold start
 * has to be drawn before `GET /api/v1/auth/me` has answered, and a device with no
 * network still has to render. So the local value is what paints the UI and the
 * server value is what the push/email path uses — [AuthStore] reconciles them in
 * both directions (PATCH on change, adopt on sign-in).
 *
 * Nothing here is Robolectric-testable and nothing here is tested: the rule that
 * decides *which* language wins is [AppLanguage.resolve], which is pure and is
 * pinned by a JVM test.
 */
class LanguageStore(context: Context) {

    private val prefs: SharedPreferences =
        context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    private val _language = MutableStateFlow(current(context))

    /** The language the UI is rendering in. Collect to recreate on change. */
    val language: StateFlow<AppLanguage> = _language.asStateFlow()

    /**
     * Records an explicit choice. Writing to prefs is unconditional even when the
     * resolved value does not move (`StateFlow` conflates equal values, so
     * nothing recomposes): "the user picked Vietnamese on a Vietnamese phone"
     * must still be persisted, otherwise a later system-language change would
     * silently override a deliberate choice.
     */
    fun set(language: AppLanguage) {
        prefs.edit().putString(KEY_LANGUAGE, language.tag).apply()
        _language.value = language
    }

    /**
     * Adopts the `locale` the server holds for this account, without PATCHing it
     * back. Used on sign-in / bootstrap so a choice made on another device (or on
     * the web once phase 4 lands) follows the user here; a `null` (never chosen)
     * leaves the local choice alone rather than resetting it.
     */
    fun adoptFromServer(tag: String?) {
        val stored = AppLanguage.fromTag(tag) ?: return
        set(stored)
    }

    companion object {

        private const val PREFS_NAME = "wv_language"
        private const val KEY_LANGUAGE = "app_language"

        /** The raw stored tag, or `null` when the user has never chosen. */
        fun readTag(context: Context): String? =
            context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .getString(KEY_LANGUAGE, null)

        /**
         * Resolves the language for a context that may not be wrapped yet — this
         * is what [com.warrantyvault.app.MainActivity.attachBaseContext] calls, so
         * it takes the *unwrapped* base context and reads the raw preference
         * rather than a `StateFlow`.
         */
        fun current(context: Context): AppLanguage =
            AppLanguage.resolve(readTag(context), Locale.getDefault().language)
    }
}
