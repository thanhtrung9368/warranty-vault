package com.warrantyvault.app.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider

/**
 * Tiny generic [ViewModelProvider.Factory] so screen-level ViewModels can be
 * obtained via `viewModel()` while still receiving the [ApiService]-style
 * constructor dependency they need.
 *
 * Using `viewModel()` (instead of `remember { ... }`) lets the ViewModel
 * survive configuration changes — its `LaunchedEffect(Unit) { vm.load() }`
 * then runs once for the screen's lifetime instead of re-firing on every
 * rotation.
 *
 * Usage:
 * ```
 * val vm: DevicesViewModel = viewModel { DevicesViewModel(api) }
 * ```
 */
@Suppress("UNCHECKED_CAST")
fun <VM : ViewModel> viewModelFactory(create: () -> VM): ViewModelProvider.Factory =
    object : ViewModelProvider.Factory {
        override fun <T : ViewModel> create(modelClass: Class<T>): T = create() as T
    }
