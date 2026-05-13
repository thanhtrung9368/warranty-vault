package com.warrantyvault.app.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import com.warrantyvault.app.auth.AuthStore
import com.warrantyvault.app.ui.screens.login.LoginScreen

@Composable
fun RootScreen(auth: AuthStore) {
    val status by auth.status.collectAsState()

    when (status) {
        is AuthStore.Status.Idle -> {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator()
            }
        }
        is AuthStore.Status.Unauthenticated -> {
            LoginScreen(auth = auth)
        }
        is AuthStore.Status.Authenticated -> {
            MainScreen(auth = auth)
        }
    }
}
