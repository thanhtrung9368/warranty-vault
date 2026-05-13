package com.warrantyvault.app

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.material3.Surface
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.core.content.ContextCompat
import com.warrantyvault.app.ui.RootScreen
import com.warrantyvault.app.ui.theme.WarrantyVaultTheme

class MainActivity : ComponentActivity() {

    private val notificationPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { /* ignore — user choice persisted by system */ }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        // Verify session on launch — RootScreen routes Login vs Main.
        App.instance.auth.bootstrap()

        // Android 13+ runtime permission for notifications. On older versions
        // the manifest permission alone is sufficient.
        maybeRequestNotificationPermission()

        setContent {
            val themePref by App.instance.themeStore.preference.collectAsState()
            WarrantyVaultTheme(preference = themePref) {
                Surface(modifier = Modifier) {
                    RootScreen(auth = App.instance.auth)
                }
            }
        }
    }

    private fun maybeRequestNotificationPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
        val granted = ContextCompat.checkSelfPermission(
            this, Manifest.permission.POST_NOTIFICATIONS,
        ) == PackageManager.PERMISSION_GRANTED
        if (!granted) {
            notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }
}
