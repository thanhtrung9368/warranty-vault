package com.warrly.i18n

import android.content.Context
import android.content.SharedPreferences
import com.warrly.network.ApiService
import com.warrly.network.UpdateLocaleInput
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.util.Locale

/**
 * The UI language, cached on the device.
 *
 * Follows the shape of [com.warrly.ui.theme.ThemeStore]: plain
 * `SharedPreferences` (not EncryptedSharedPreferences — a language is not a
 * secret, and this value has to be readable from
 * [com.warrly.MainActivity.attachBaseContext], which runs before the
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
 * server value is what the push/email path uses — [com.warrly.auth.AuthStore]
 * reconciles them in both directions (PATCH on change, adopt on sign-in).
 *
 * ## What is written back, and why "theo thiết bị" is not `null`
 *
 * The language shown on screen and the language stored for the account are not
 * the same decision. "Theo thiết bị" is a real third state: the app keeps
 * following the device, but the server still needs ONE answer it can render a
 * push or an email in, months later, with no device to ask. So this store
 * persists the **resolved** language — never "system", and never `null` — while
 * [stored] stays `null` and the Settings sheet keeps ticking "Theo thiết bị".
 *
 * That write is what stops a notification leaking the wrong language: an account
 * with `locale IS NULL` is rendered in the artifact fallback (Vietnamese), and
 * "Theo thiết bị" used to leave the column NULL for everyone who never opened
 * the picker. An English interface therefore got Vietnamese push and email. iOS
 * `LocalizationStore` does the same (`adopt(user:)` + `select(nil)`).
 *
 * ## The mirror marker
 *
 * The server cannot tell "the person chose Vietnamese" from "this device
 * mirrored Vietnamese because that is what the phone speaks", so the app
 * remembers which value it wrote. Without the marker the mirrored value would
 * come back on the next `/me` looking like an explicit choice and the Settings
 * row would silently move from "Theo thiết bị" to "Tiếng Việt" — a UI change the
 * write is not allowed to cause.
 *
 * The marker is keyed by account id, not stored globally: a phone can sign into
 * more than one account, and the next account's deliberate choice must not look
 * like this device's mirror (that would show "Theo thiết bị" for a language
 * somebody explicitly picked, and could overwrite it on the next device-language
 * change).
 *
 * Nothing here is Robolectric-testable and nothing here is tested: the rule that
 * decides *which* language wins is [AppLanguage.resolve], which is pure and is
 * pinned by a JVM test.
 */
class LanguageStore(context: Context, private val scope: CoroutineScope) {

    private val appContext: Context = context.applicationContext

    private val prefs: SharedPreferences =
        appContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    private val _language = MutableStateFlow(current(context))

    /** The language the UI is rendering in. Collect to recreate on change. */
    val language: StateFlow<AppLanguage> = _language.asStateFlow()

    /**
     * The language the user *chose*, or `null` when the app is following the
     * device ("Theo thiết bị").
     *
     * Kept separate from [language] on purpose, exactly like iOS
     * `LocalizationStore.storedChoice`: "the phone is Vietnamese" and "the user
     * chose Vietnamese" are different states, and only the second one is an
     * explicit choice. Both persist a language to the account; the first
     * persists the RESOLVED one through [adoptFromServer]. The language sheet
     * ticks "Theo thiết bị" off this, not off the resolved language.
     */
    private val _stored = MutableStateFlow(AppLanguage.fromTag(readTag(appContext)))
    val stored: StateFlow<AppLanguage?> = _stored.asStateFlow()

    /**
     * The client the silent device-mode mirror writes through.
     *
     * Assigned by [attach] from `App.onCreate`, which builds the `ApiService`
     * after this store (the client's `Accept-Language` provider reads
     * [language], so the dependency points this way round).
     */
    private var api: ApiService? = null

    /** Wires the `PATCH /auth/me` client used by the device-mode mirror. */
    fun attach(api: ApiService) {
        this.api = api
    }

    /**
     * The phone's own language, ignoring any explicit choice.
     *
     * Deliberately not [current]: `current` lets a stored choice win, and the
     * "Theo thiết bị" row has to send what the PHONE resolves to even while the
     * user is still on an explicit language — picking "Theo thiết bị" after
     * choosing English on a Vietnamese phone must send `vi`.
     */
    val deviceLanguage: AppLanguage
        get() = AppLanguage.forSystemLanguage(Locale.getDefault().language)

    /**
     * Records an explicit choice. Writing to prefs is unconditional even when the
     * resolved value does not move (`StateFlow` conflates equal values, so
     * nothing recomposes): "the user picked Vietnamese on a Vietnamese phone"
     * must still be persisted, otherwise a later system-language change would
     * silently override a deliberate choice.
     *
     * The mirror marker is dropped because the account no longer holds a
     * device-derived value: the next `/me` must adopt this one as a CHOICE.
     */
    fun set(language: AppLanguage) {
        prefs.edit()
            .putString(KEY_LANGUAGE, language.tag)
            .remove(KEY_MIRRORED_ACCOUNT)
            .remove(KEY_MIRRORED_LANGUAGE)
            .apply()
        _stored.value = language
        _language.value = language
    }

    /**
     * Records "Theo thiết bị" after the account acknowledged [mirrored] — the
     * resolved language the caller just PATCHed.
     *
     * [mirrored] is passed in rather than recomputed so the marker names the
     * exact value that reached the server. Called only after a successful
     * PATCH: a failed write leaves this store untouched, which is what keeps the
     * sheet on the old row and stops the app claiming a mirror the account does
     * not hold.
     */
    fun followDevice(mirrored: AppLanguage, accountId: String) {
        prefs.edit().remove(KEY_LANGUAGE).apply()
        _stored.value = null
        _language.value = mirrored
        rememberMirror(accountId, mirrored)
    }

    /**
     * Adopts the `locale` the server holds for this account — and mirrors the
     * resolved language when the account stores no explicit choice.
     *
     * A `null` `locale` means "never stored". It must NOT reset the
     * device-derived language, and it is exactly the state that leaves every
     * push and both mails in the artifact fallback forever, because the cron has
     * no request to read a language from. So the resolved language is written
     * back here, as a concrete value: never `null`, never "system".
     *
     * A stored value equal to this device's mirror for [accountId] is not a
     * choice and keeps the row on "Theo thiết bị"; anything else is someone's
     * deliberate choice (possibly from the web or another phone) and is adopted
     * as one.
     */
    fun adoptFromServer(tag: String?, accountId: String) {
        val fromServer = AppLanguage.fromTag(tag)
        val mirrored = readMirror(accountId)

        if (fromServer != null && (fromServer != mirrored || _stored.value != null)) {
            set(fromServer)
            return
        }

        // "Theo thiết bị": either the account stores nothing yet, or what it
        // stores is this device's own mirror of the phone language.
        val resolved = deviceLanguage
        prefs.edit().remove(KEY_LANGUAGE).apply()
        _stored.value = null
        _language.value = resolved
        mirror(resolved, fromServer, accountId)
    }

    /**
     * Persists [resolved] for an account on "Theo thiết bị".
     *
     * Silent and best-effort on purpose: the user did not ask for this write, so
     * it must not show the save spinner or an error. A failure leaves the marker
     * untouched and the next `/me` tries again; until then the account keeps the
     * artifact fallback (Vietnamese), which is what the server already did.
     *
     * The marker is written only after the PATCH succeeds — a failed write must
     * not leave the app believing the account holds a language it does not.
     */
    private fun mirror(resolved: AppLanguage, fromServer: AppLanguage?, accountId: String) {
        // The account already stores what this phone resolves to: a `/me` that
        // changed nothing must not produce a write. Compared against the SERVER
        // value, not the marker: a marker left under another account must never
        // suppress the write this account still needs.
        if (fromServer == resolved) return
        val api = api ?: return
        scope.launch {
            try {
                api.updateLocale(UpdateLocaleInput(resolved.tag))
                rememberMirror(accountId, resolved)
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
                // Retried by the next adopt. Nothing to surface: the UI is
                // already in the right language and the account keeps its
                // fallback until this succeeds.
            }
        }
    }

    /**
     * The language this device last wrote to `User.locale` for [accountId] while
     * the user was on "Theo thiết bị", or `null`.
     *
     * Scoped to the account because the mirror is not a property of the phone:
     * leaving it global would make the next account's deliberate choice look
     * like this device's mirror. A mirror for a different account is ignored
     * here, so that choice is adopted as an explicit one.
     */
    private fun readMirror(accountId: String): AppLanguage? {
        if (prefs.getString(KEY_MIRRORED_ACCOUNT, null) != accountId) return null
        return AppLanguage.fromTag(prefs.getString(KEY_MIRRORED_LANGUAGE, null))
    }

    private fun rememberMirror(accountId: String, language: AppLanguage) {
        prefs.edit()
            .putString(KEY_MIRRORED_ACCOUNT, accountId)
            .putString(KEY_MIRRORED_LANGUAGE, language.tag)
            .apply()
    }

    companion object {

        private const val PREFS_NAME = "wv_language"
        private const val KEY_LANGUAGE = "app_language"

        /** The account the mirror below belongs to — see [readMirror]. */
        private const val KEY_MIRRORED_ACCOUNT = "mirrored_account"

        /** The language this device last wrote for that account in device mode. */
        private const val KEY_MIRRORED_LANGUAGE = "mirrored_language"

        /** The raw stored tag, or `null` when the user has never chosen. */
        fun readTag(context: Context): String? =
            context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .getString(KEY_LANGUAGE, null)

        /**
         * Resolves the language for a context that may not be wrapped yet — this
         * is what [com.warrly.MainActivity.attachBaseContext] calls, so
         * it takes the *unwrapped* base context and reads the raw preference
         * rather than a `StateFlow`.
         */
        fun current(context: Context): AppLanguage =
            AppLanguage.resolve(readTag(context), Locale.getDefault().language)
    }
}
