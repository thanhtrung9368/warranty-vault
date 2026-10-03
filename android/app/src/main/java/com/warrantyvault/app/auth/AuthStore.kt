package com.warrantyvault.app.auth

import android.os.Build
import com.warrantyvault.app.network.ApiService
import com.warrantyvault.app.network.DeleteAccountRequest
import com.warrantyvault.app.network.ForgotRequest
import com.warrantyvault.app.network.LoginInput
import com.warrantyvault.app.network.RegisterInput
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
 */
class AuthStore(
    private val tokenStore: TokenStore,
    private val api: ApiService,
    private val scope: CoroutineScope = CoroutineScope(SupervisorJob()),
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
                _status.value = Status.Authenticated(me)
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
        _status.value = Status.Authenticated(res.user)
    }

    suspend fun register(email: String, password: String, name: String?) {
        val res = api.register(RegisterInput(
            email = email, password = password, name = name,
            deviceLabel = deviceLabel(), platform = "android",
        ))
        tokenStore.write(res.accessToken)
        _status.value = Status.Authenticated(res.user)
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
     * Email cannot be changed through this call (or anywhere else yet); the
     * request body deliberately has no email field.
     */
    suspend fun updateDisplayName(displayName: String): UpdateProfileResponse {
        val res = api.updateProfile(UpdateProfileInput(displayName))
        _status.value = Status.Authenticated(res.user)
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

    private fun deviceLabel(): String {
        return "${Build.MANUFACTURER} ${Build.MODEL}".trim()
    }
}
