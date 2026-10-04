package com.warrantyvault.app.i18n

/**
 * The two languages this app ships, and the rule that picks one.
 *
 * The app renders from `res/values/` (English) and `res/values-vi/`
 * (Vietnamese) — see `docs/I18N_PLAN.md` §2.4, and the header of
 * `res/values/strings.xml` for why the catalog is split across files.
 *
 * ## Why the choice is explicit rather than left to Android
 *
 * Android already resolves `values-vi/` on a Vietnamese phone. What it cannot do
 * is let the user pick a language that differs from the system one, and it
 * cannot tell [com.warrantyvault.app.network.AuthInterceptor] which
 * `Accept-Language` to send. The API resolves its own language from that header
 * (`?lang=` → `Accept-Language` → `User.locale` → `en`), so if the UI is forced
 * to Vietnamese while the header says nothing, a converted endpoint answers in
 * English inside a Vietnamese screen — the exact mismatch
 * `website/src/lib/api/client.ts` documents with its `UI_LANGUAGE` constant.
 * One enum therefore drives BOTH the resource lookup and the header.
 *
 * ## The fallback is the system language, not [DEFAULT]
 *
 * `DEFAULT` (`en`) is what the *product* defaults to, and it is what a system
 * set to anything other than `vi` gets. But a phone set to Vietnamese gets a
 * Vietnamese app without touching anything, which is what §2.4 asks for ("điện
 * thoại họ đặt tiếng Việt → nhận tiếng Việt") and what an Android user expects:
 * the app has a `values-vi/` folder, so the system locale is already a signal
 * the user gave us. An explicit choice in Settings always wins over it.
 */
enum class AppLanguage(val tag: String) {
    En("en"),
    Vi("vi");

    companion object {

        /** The product default, used when nothing else is known. */
        val DEFAULT: AppLanguage = En

        /**
         * Parses a BCP-47-ish tag (`"vi"`, `"vi-VN"`, `"EN"`) into a supported
         * language, or `null` when this app does not speak it.
         *
         * Region and script subtags are ignored: `"vi-VN"` is [Vi]. A tag for a
         * language we do not ship is `null` rather than an exception — an
         * unsupported language must degrade to the default, never fail.
         */
        fun fromTag(raw: String?): AppLanguage? {
            val norm = raw?.trim()?.lowercase()?.takeIf { it.isNotEmpty() } ?: return null
            return entries.firstOrNull { norm == it.tag || norm.startsWith(it.tag + "-") }
        }

        /** What to render when the user has not chosen anything. */
        fun forSystemLanguage(systemLanguageTag: String?): AppLanguage =
            fromTag(systemLanguageTag) ?: DEFAULT

        /**
         * The one rule: an explicit [stored] choice (the Settings switcher, or a
         * `locale` restored from `GET /api/v1/auth/me`) wins; otherwise the
         * system language decides; otherwise [DEFAULT].
         *
         * Pure and clock-free so it is pinned by a JVM test
         * (`test/.../i18n/AppLanguageTest.kt`) instead of by a device.
         */
        fun resolve(stored: String?, systemLanguageTag: String?): AppLanguage =
            fromTag(stored) ?: forSystemLanguage(systemLanguageTag)
    }
}
