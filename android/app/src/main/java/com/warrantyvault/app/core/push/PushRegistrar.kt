package com.warrantyvault.app.core.push

import android.os.Build
import android.util.Log
import com.google.firebase.messaging.FirebaseMessaging
import com.warrantyvault.app.auth.AuthStore
import com.warrantyvault.app.auth.TokenStore
import com.warrantyvault.app.network.ApiService
import com.warrantyvault.app.network.NativePushInput
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/**
 * Bridges FCM token lifecycle to the backend `/api/v1/push/register` endpoint.
 *
 * Two trigger paths:
 *  1) [start] watches AuthStore — every time we transition into Authenticated,
 *     we fetch the current FCM token and POST it.
 *  2) [WVMessagingService.onNewToken] calls [registerToken] directly on rotation.
 *
 * Both paths short-circuit silently when there's no auth bearer token or
 * Firebase isn't configured — the caller doesn't need to know which.
 */
class PushRegistrar(
    private val api: ApiService,
    private val tokenStore: TokenStore,
    private val authStore: AuthStore,
    private val scope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.IO),
) {

    fun start() {
        scope.launch {
            authStore.status.collectLatest { status ->
                if (status is AuthStore.Status.Authenticated) {
                    runCatching { fetchAndRegister() }
                        .onFailure { Log.w(TAG, "auto-register on login failed", it) }
                }
            }
        }
    }

    suspend fun registerToken(fcmToken: String) {
        // No bearer = user not logged in. Token will be picked up next login.
        if (tokenStore.read().isNullOrBlank()) return
        try {
            api.registerPush(
                NativePushInput(
                    platform = "fcm",
                    token = fcmToken,
                    userAgent = "${Build.MANUFACTURER} ${Build.MODEL} (Android ${Build.VERSION.RELEASE})",
                ),
            )
        } catch (e: Exception) {
            Log.w(TAG, "registerPush failed", e)
        }
    }

    private suspend fun fetchAndRegister() {
        val token = runCatching { fetchFcmToken() }.getOrNull() ?: return
        registerToken(token)
    }

    private suspend fun fetchFcmToken(): String =
        suspendCancellableCoroutine { cont ->
            FirebaseMessaging.getInstance().token
                .addOnSuccessListener { cont.resume(it) }
                .addOnFailureListener { cont.resumeWithException(it) }
        }

    companion object {
        private const val TAG = "PushRegistrar"
    }
}
