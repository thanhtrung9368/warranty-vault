package com.warrantyvault.app.i18n

import android.content.Context
import android.content.res.Configuration
import java.util.Locale

/**
 * Wraps a [Context] so that `getString` / `stringResource` resolve against
 * [AppLanguage] instead of the system locale.
 *
 * This is the whole mechanism behind the Settings switcher, and it is
 * deliberately four lines: no AppCompat, no `AppCompatDelegate.setApplicationLocales`,
 * no new dependency. `androidx.appcompat` would be the standard answer — it
 * brings `autoStoreLocales` and an app-wide locale — but this app is a single
 * `ComponentActivity` (`MainActivity`) that is recreated on a language change,
 * so the per-Activity override is the smaller and more predictable tool. It also
 * keeps the locale explicit at exactly one place instead of a hidden global that
 * a future Activity would silently miss.
 *
 * Called from [com.warrantyvault.app.MainActivity.attachBaseContext], i.e. before
 * `onCreate`, so the first frame is already correct — there is no frame rendered
 * in the wrong language.
 *
 * Android glue, therefore untested here: everything that *decides* the language
 * lives in the pure [AppLanguage.resolve].
 */
object LocaleSupport {

    fun wrap(base: Context, language: AppLanguage): Context {
        val locale = Locale.forLanguageTag(language.tag)
        val config = Configuration(base.resources.configuration).apply {
            setLocale(locale)
            // Keep RTL/LTR correct for a future RTL language; a no-op for en/vi.
            setLayoutDirection(locale)
        }
        return base.createConfigurationContext(config)
    }
}
