package com.warrantyvault.app.auth

import android.os.Build
import com.warrantyvault.app.network.ApiService
import com.warrantyvault.app.network.ForgotRequest
import com.warrantyvault.app.network.LoginInput
import com.warrantyvault.app.network.RegisterInput
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

    fun logout() {
        scope.launch {
            try { api.logout() } catch (_: Exception) {}
            tokenStore.clear()
            _status.value = Status.Unauthenticated
        }
    }

    private fun deviceLabel(): String {
        return "${Build.MANUFACTURER} ${Build.MODEL}".trim()
    }
}
