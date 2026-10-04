package com.warrantyvault.app.core.push

import com.warrantyvault.app.R
import com.warrantyvault.app.i18n.LanguageStore
import com.warrantyvault.app.i18n.LocaleSupport
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import com.warrantyvault.app.App
import com.warrantyvault.app.MainActivity
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * Receives FCM tokens + notifications. Tokens are forwarded to the backend
 * via PushRegistrar; messages are surfaced as system notifications.
 */
class WVMessagingService : FirebaseMessagingService() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onNewToken(token: String) {
        // Token may rotate at any time. Best-effort register; user may not
        // be logged in yet — registrar will skip in that case.
        scope.launch {
            runCatching { App.instance.pushRegistrar.registerToken(token) }
                .onFailure { Log.w(TAG, "register token failed", it) }
        }
    }

    override fun onMessageReceived(remoteMessage: RemoteMessage) {
        val title = remoteMessage.notification?.title
            ?: remoteMessage.data["title"]
            ?: getString(R.string.app_name)
        val body = remoteMessage.notification?.body
            ?: remoteMessage.data["body"]
            ?: ""
        showNotification(title, body)
    }

    private fun showNotification(title: String, body: String) {
        val mgr = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            // IMPORTANCE_HIGH so heads-up banner shows even while app is in
            // foreground.
            // A Service is NOT wrapped by MainActivity.attachBaseContext, so the
            // app's chosen language has to be resolved here explicitly — otherwise
            // the channel would follow the phone's system locale and an in-app
            // switch to English would leave this one surface Vietnamese.
            val strings = LocaleSupport.wrap(this, LanguageStore.current(this))
            val channel = NotificationChannel(
                CHANNEL_ID,
                strings.getString(R.string.push_channel_warranty_name),
                NotificationManager.IMPORTANCE_HIGH,
            ).apply {
                description = strings.getString(R.string.push_channel_warranty_desc)
            }
            mgr.createNotificationChannel(channel)
        }

        val intent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
        }
        val pi = PendingIntent.getActivity(
            this, 0, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        val notif = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .setContentIntent(pi)
            .build()

        mgr.notify(System.currentTimeMillis().toInt(), notif)
    }

    companion object {
        private const val TAG = "WVMessaging"
        private const val CHANNEL_ID = "warranty-vault-default"
    }
}
