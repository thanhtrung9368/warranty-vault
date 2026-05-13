package com.warrantyvault.app.auth

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/**
 * Secure persistent token storage. Backed by EncryptedSharedPreferences so
 * the token is encrypted with a key in the Android Keystore — readable only
 * by this app, even on rooted devices it's still hardware-backed on most.
 */
class TokenStore(context: Context) {

    private val prefs = run {
        val masterKey = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        EncryptedSharedPreferences.create(
            context,
            FILE_NAME,
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }

    fun read(): String? = prefs.getString(KEY_TOKEN, null)

    fun write(token: String) {
        prefs.edit().putString(KEY_TOKEN, token).apply()
    }

    fun clear() {
        prefs.edit().remove(KEY_TOKEN).apply()
    }

    companion object {
        private const val FILE_NAME = "wv_secure_prefs"
        private const val KEY_TOKEN = "session_token"
    }
}
