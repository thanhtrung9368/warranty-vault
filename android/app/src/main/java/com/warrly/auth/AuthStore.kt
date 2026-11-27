package com.warrly.auth

import android.os.Build
import com.warrly.i18n.AppLanguage
import com.warrly.i18n.LanguageStore
import com.warrly.network.ApiService
import com.warrly.network.ChangeEmailRequest
import com.warrly.network.ChangeEmailResult
import com.warrly.network.ConfirmEmailChangeRequest
import com.warrly.network.ConfirmEmailChangeResult
import com.warrly.network.DeleteAccountRequest
import com.warrly.network.ForgotRequest
import com.warrly.network.LoginInput
import com.warrly.network.RegisterInput
import com.warrly.network.UpdateLocaleInput
import com.warrly.network.UpdateProfileInput
import com.warrly.network.UpdateProfileResponse
import com.warrly.network.UpdateReminderEmailFallbackInput
import com.warrly.network.User
import com.warrly.network.isUnauthorized
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.util.Locale

/**
 * App-scoped auth state. The MainActivity hands the same instance to every
 * Compose screen via composition local. Talks to ApiService + TokenStore.
 *
 * [languageStore] is optional only so the JVM tests can build a store without
 * Android's `SharedPreferences`. In the app it is always supplied
 * (`App.onCreate`), which is what makes the language choice follow the account:
 * every place a [User] arrives — bootstrap, login, register, and both PATCHes —
 * runs it through [applyUser].
 */
class AuthStore(
    private val tokenStore: TokenStore,
    private val api: ApiService,
    private val scope: CoroutineScope = CoroutineScope(SupervisorJob()),
    private val languageStore: LanguageStore? = null,
) {

    sealed interface Status {
        data object Idle : Status
        data object Unauthenticated : Status
        /**
         * [bootstrap] could not prove the stored session — a dead socket, a
         * timeout, a `5xx`, a decode failure — but the server never said the
         * token was invalid. The token is kept and `RootScreen` shows a retry
         * screen; only a `401` is a sign-out. Mirrors iOS's `.unreachable`.
         */
        data object Unreachable : Status
        data class Authenticated(val user: User) : Status
    }

    private val _status = MutableStateFlow<Status>(Status.Idle)
    val status: StateFlow<Status> = _status.asStateFlow()

    /**
     * Restore session on launch — verify any cached token via /me.
     *
     * Only a `401` ends the session: the server has answered that the stored
     * bearer is dead (revoked from another device, expired, password changed
     * elsewhere), so the token is cleared and the app goes to Login. Anything
     * else — network, timeout, `5xx`, decoding — means "could not check", not
     * "signed out": the token stays in the keystore and the status becomes
     * [Status.Unreachable], which `RootScreen` renders as a retry screen. This
     * used to clear the token on every throw, so one dropped packet at launch
     * signed the user out.
     */
    fun bootstrap() {
        scope.launch {
            val tok = tokenStore.read()
            if (tok.isNullOrBlank()) {
                _status.value = Status.Unauthenticated
                return@launch
            }
            try {
                val me = api.me().user
                applyUser(me)
            } catch (e: Exception) {
                if (e.isUnauthorized) {
                    tokenStore.clear()
                    _status.value = Status.Unauthenticated
                } else {
                    _status.value = Status.Unreachable
                }
            }
        }
    }

    suspend fun login(email: String, password: String) {
        val res = api.login(LoginInput(
            email = email, password = password,
            deviceLabel = deviceLabel(), platform = "android",
        ))
        tokenStore.write(res.accessToken)
        applyUser(res.user)
    }

    suspend fun register(email: String, password: String, name: String?) {
        val res = api.register(RegisterInput(
            email = email, password = password, name = name,
            deviceLabel = deviceLabel(), platform = "android",
        ))
        tokenStore.write(res.accessToken)
        applyUser(res.user)
    }

    suspend fun forgotPassword(email: String) {
        api.forgotPassword(ForgotRequest(email = email))
    }

    /**
     * `PATCH /api/v1/auth/me` — saves the display name and republishes the
     * authenticated status so every screen reading `status` (the Settings
     * profile card, the dashboard greeting) shows the new name immediately.
     *
     * [displayName] is sent verbatim: the server trims it and maps a blank
     * value to NULL, so `""` is the documented way to clear the name. The 80
     * **byte** cap is enforced server-side only — this never truncates, it lets
     * the 400 `fieldErrors.displayName` message through for the sheet to show.
     *
     * Changing the account email is NOT this call and never was:
     * `PATCH /auth/me` answers 400 for an `email`/`newEmail` key. The real flow
     * is [changeEmail] + [confirmEmailChange] below.
     */
    suspend fun updateDisplayName(displayName: String): UpdateProfileResponse {
        val res = api.updateProfile(UpdateProfileInput(displayName))
        _status.value = Status.Authenticated(res.user)
        return res
    }

    /**
     * `PATCH /api/v1/auth/me` with **only** `locale` — the half of the language
     * switch that outlives this device.
     *
     * The UI language itself is the local [LanguageStore] (it has to render
     * before `/me` answers, and offline); this call exists because the cron push
     * fan-out and the transactional emails run with no request context and can
     * only read `User.locale` (`docs/I18N_PLAN.md` §2.3). So the switcher saves
     * BOTH, and a failure here is surfaced rather than swallowed — a silent
     * failure would leave the account receiving Vietnamese push while the app
     * renders English.
     *
     * [choice] is `null` for "Theo thiết bị". It deliberately no longer sends
     * `{"locale": null}`: that CLEARS `User.locale`, which leaves the cron with
     * no language to render a push or an email in, so an English interface got
     * Vietnamese artifacts. The language the phone resolves to is stored
     * instead, and remembered as a mirror so the Settings row keeps ticking
     * "Theo thiết bị" (the local [LanguageStore.stored] stays `null`). iOS
     * `LocalizationStore.select(nil)` does the same.
     *
     * Local state moves only after the PATCH answers: a failure must leave the
     * UI on the language the account actually holds.
     */
    suspend fun updateLocale(choice: AppLanguage?): UpdateProfileResponse {
        val resolved = choice
            ?: languageStore?.deviceLanguage
            ?: AppLanguage.forSystemLanguage(Locale.getDefault().language)
        val res = api.updateLocale(UpdateLocaleInput(resolved.tag))
        _status.value = Status.Authenticated(res.user)
        when (choice) {
            // The account now holds the resolved language as a mirror, not a
            // choice: the row must stay on "Theo thiết bị".
            null -> languageStore?.followDevice(resolved, res.user.id)
            else -> languageStore?.set(choice)
        }
        return res
    }

    /**
     * `PATCH /api/v1/auth/me` with **only** `reminderEmailFallback` — the
     * reminder email fallback opt-in (#8).
     *
     * It lives on the account, not on this device: the Go cron renders the
     * fallback email with no request context, exactly like the language it
     * renders it in. Sent on its own so it cannot disturb the display name or
     * the stored language (all three keys are independent on the server).
     *
     * The store adopts the returned user, so the Settings row and its footer
     * render the value the account actually holds. Throws on failure — the
     * screen shows the server's message in a snackbar and the switch stays on
     * the real value.
     */
    suspend fun updateReminderEmailFallback(enabled: Boolean): UpdateProfileResponse {
        val res = api.updateReminderEmailFallback(UpdateReminderEmailFallbackInput(enabled))
        _status.value = Status.Authenticated(res.user)
        return res
    }

    /**
     * Step 1 of the email change: asks the server to mail a single-use token to
     * [newEmail]. The account address does NOT change here — the old one keeps
     * working until [confirmEmailChange] succeeds — and the response is neutral
     * by contract, so the UI must not read it as "the mail was delivered".
     */
    suspend fun changeEmail(newEmail: String, currentPassword: String): ChangeEmailResult =
        api.changeEmail(ChangeEmailRequest(newEmail = newEmail, currentPassword = currentPassword))

    /**
     * Step 2: consumes the token. On success the server has already changed the
     * address **and revoked every session**, which makes the local bearer token
     * dead — so this drops it and returns to the login screen, the same route
     * [deleteAccount] and [endLocalSession] take. It throws on failure so the
     * sheet can show the server's message.
     */
    suspend fun confirmEmailChange(token: String): ConfirmEmailChangeResult {
        val res = api.confirmEmailChange(ConfirmEmailChangeRequest(token))
        tokenStore.clear()
        _status.value = Status.Unauthenticated
        return res
    }

    fun logout() {
        scope.launch {
            try { api.logout() } catch (_: Exception) {}
            tokenStore.clear()
            _status.value = Status.Unauthenticated
        }
    }

    /**
     * Permanently deletes the account (server requires the current password),
     * then clears the token and drops to the unauthenticated state. Throws on
     * failure so the caller can surface the error.
     */
    suspend fun deleteAccount(password: String) {
        api.deleteAccount(DeleteAccountRequest(password))
        tokenStore.clear()
        _status.value = Status.Unauthenticated
    }

    /**
     * Drops the local session for the one case where the token is **already
     * dead**: the user revoked the CURRENT login session from the sessions
     * screen (`DELETE /api/v1/auth/sessions/{id}` → `current = true`). Same end
     * state as [logout] / [deleteAccount] — token cleared, back to the login
     * screen — but deliberately without a request, because the next
     * authenticated call would answer 401.
     *
     * Synchronous so a Compose click handler can call it directly.
     */
    fun endLocalSession() {
        tokenStore.clear()
        _status.value = Status.Unauthenticated
    }

    /**
     * The one-shot "the server no longer accepts this session" transition,
     * called by the OkHttp 401 observer installed in `ApiClient.build` (see
     * `AuthInterceptor`). A request that carried the bearer came back `401`
     * while the app was open — a revoked or expired session — so this ends it
     * exactly once and returns to Login.
     *
     * It is deliberately narrow, the same rules as iOS
     * `AuthStore.handleUnauthorizedSession`:
     *
     *  * only meaningful while [Status.Authenticated]. During [bootstrap] the
     *    status is `Idle`/`Unreachable`, so a `/me` 401 is owned by
     *    [bootstrap]'s own catch, which is the call that knows whether a token
     *    existed. A login/register 401 never carries a bearer, and the
     *    interceptor skips those paths anyway.
     *  * one-shot: a pull-to-refresh that fires five lists at once signs out on
     *    the first 401 and every other one is a no-op (compare-and-set), rather
     *    than a second transition or a loop.
     *
     * Synchronous and thread-safe so the OkHttp worker can call it directly;
     * `MutableStateFlow` is safe to publish from any thread.
     */
    fun handleUnauthorizedSession() {
        val current = _status.value
        if (current !is Status.Authenticated) return
        tokenStore.clear()
        _status.compareAndSet(current, Status.Unauthenticated)
    }

    /**
     * Publishes [user] as the authenticated status AND reconciles the UI
     * language with the account's stored `locale`.
     *
     * An explicit `locale` is adopted one-way here (server → device): a choice
     * made on the web or another phone follows the user.
     *
     * A `null` `locale` — the account has never stored one — does not reset the
     * device-derived language, and it is also the state that leaves push and
     * email in the artifact fallback forever. [LanguageStore.adoptFromServer]
     * therefore mirrors the resolved language back to the account, once, and
     * remembers which value it wrote so the row keeps showing "Theo thiết bị".
     */
    private fun applyUser(user: User) {
        _status.value = Status.Authenticated(user)
        languageStore?.adoptFromServer(user.locale, user.id)
    }

    private fun deviceLabel(): String {
        return "${Build.MANUFACTURER} ${Build.MODEL}".trim()
    }
}
