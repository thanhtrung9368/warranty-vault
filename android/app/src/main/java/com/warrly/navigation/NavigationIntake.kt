package com.warrly.navigation

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * One-shot mailbox for a destination requested by a shortcut or the widget.
 *
 * It lives on `App` (process scope), like `ShareIntake`, because the request can
 * arrive before the signed-in shell exists: a shortcut tapped on the login
 * screen must survive authentication and open the add-device sheet afterwards,
 * not be dropped because `MainScreen` was not composed yet.
 *
 * `consume` is compare-and-set, so a slow consumer cannot clear a newer request
 * that arrived while it was working.
 */
class NavigationIntake {

    private val _pending = MutableStateFlow<AppDestination?>(null)

    /** The destination waiting to be opened, if any. */
    val pending: StateFlow<AppDestination?> = _pending.asStateFlow()

    fun hold(destination: AppDestination) {
        _pending.value = destination
    }

    fun consume(destination: AppDestination) {
        _pending.compareAndSet(destination, null)
    }
}
