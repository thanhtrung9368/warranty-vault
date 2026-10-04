package com.warrantyvault.app.auth

import android.os.Build
import com.warrantyvault.app.i18n.AppLanguage
import com.warrantyvault.app.i18n.LanguageStore
import com.warrantyvault.app.network.ApiService
import com.warrantyvault.app.network.ChangeEmailRequest
import com.warrantyvault.app.network.ChangeEmailResult
import com.warrantyvault.app.network.ConfirmEmailChangeRequest
import com.warrantyvault.app.network.ConfirmEmailChangeResult
import com.warrantyvault.app.network.DeleteAccountRequest
import com.warrantyvault.app.network.ForgotRequest
import com.warrantyvault.app.network.LoginInput
import com.warrantyvault.app.network.RegisterInput
import com.warrantyvault.app.network.UpdateLocaleInput
import com.warrantyvault.app.network.UpdateProfileInput
import com.warrantyvault.app.network.UpdateProfileResponse
import com.warrantyvault.app.network.User
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

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
        data class Authenticated(val user: User) : Status
    }

    private val _status = MutableStateFlow<Status>(Status.Idle)
    val status: StateFlow<Status> = _status.asStateFlow()

    /** Restore session on launch — verify any cached token via /me. */
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
            } catch (_: Exception) {
                tokenStore.clear()
                _status.value = Status.Unauthenticated
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
     */
    suspend fun updateLocale(language: AppLanguage): UpdateProfileResponse {
        val res = api.updateLocale(UpdateLocaleInput(language.tag))
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
     * Publishes [user] as the authenticated status AND reconciles the UI
     * language with the account's stored `locale`.
     *
     * Adoption is one-way here (server → device) and never echoed back with a
     * PATCH, because nothing changed server-side. A `null` `locale` — the account
     * has never chosen one — leaves the local choice alone on purpose: a fresh
     * install on a Vietnamese phone is Vietnamese from the system locale, and
     * resetting that to the product default would be a downgrade
     * (`docs/I18N_PLAN.md` §2.4).
     */
    private fun applyUser(user: User) {
        _status.value = Status.Authenticated(user)
        languageStore?.adoptFromServer(user.locale)
    }

    private fun deviceLabel(): String {
        return "${Build.MANUFACTURER} ${Build.MODEL}".trim()
    }
}
