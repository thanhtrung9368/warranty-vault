package com.warrly.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import com.warrly.auth.AppLockStore
import com.warrly.auth.AuthStore
import com.warrly.ui.screens.lock.AppLockScreen
import com.warrly.ui.screens.login.LoginScreen

/**
 * Auth gate (login vs. the signed-in shell) and the app-lock gate.
 *
 * The lock cover is deliberately rendered as a SIBLING of the shell inside a
 * `Box`, exactly like the `ZStack` cover in `ios/App/RootView.swift`: the shell
 * keeps its state underneath and the cover sits above it until the user
 * authenticates. It is shown only for an authenticated session — there is
 * nothing to protect on the login screen.
 */
@Composable
fun RootScreen(auth: AuthStore, appLock: AppLockStore) {
    val status by auth.status.collectAsState()
    val isLocked by appLock.isLocked.collectAsState()
    val authenticated = status is AuthStore.Status.Authenticated

    // Signing out clears the session, so drop the lock with it (iOS
    // `onChange(of: isAuthenticated)` does the same); the next cold launch
    // re-locks from the stored preference.
    //
    // `remember`ed, not a bare `LaunchedEffect(authenticated)`: on a cold launch
    // the status is `Idle` first, and clearing on that initial `false` would
    // unlock before the stored session (and its lock) is even restored.
    var wasAuthenticated by remember { mutableStateOf(false) }
    LaunchedEffect(authenticated) {
        if (wasAuthenticated && !authenticated) appLock.clearLock()
        wasAuthenticated = authenticated
    }

    Box(Modifier.fillMaxSize()) {
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
                MainScreen(auth = auth, appLock = appLock)
            }
        }

        if (authenticated && isLocked) {
            AppLockScreen(auth = auth, appLock = appLock)
        }
    }
}
