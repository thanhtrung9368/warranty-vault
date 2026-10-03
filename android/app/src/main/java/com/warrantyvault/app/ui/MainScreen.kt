package com.warrantyvault.app.ui

import androidx.compose.animation.Crossfade
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.BarChart
import androidx.compose.material.icons.filled.CreditCard
import androidx.compose.material.icons.filled.Devices
import androidx.compose.material.icons.filled.GridView
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.outlined.BarChart
import androidx.compose.material.icons.outlined.CreditCard
import androidx.compose.material.icons.outlined.Devices
import androidx.compose.material.icons.outlined.GridView
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material.icons.outlined.StarBorder
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.warrantyvault.app.App
import com.warrantyvault.app.auth.AuthStore
import com.warrantyvault.app.ui.screens.actions.ActionQueueScreen
import com.warrantyvault.app.ui.screens.dashboard.DashboardScreen
import com.warrantyvault.app.ui.screens.devices.DeviceDetailScreen
import com.warrantyvault.app.ui.screens.devices.DevicesScreen
import com.warrantyvault.app.ui.screens.reminders.RemindersScreen
import com.warrantyvault.app.ui.screens.search.SearchScreen
import com.warrantyvault.app.ui.screens.settings.PushDevicesScreen
import com.warrantyvault.app.ui.screens.settings.SessionsScreen
import com.warrantyvault.app.ui.screens.settings.SettingsScreen
import com.warrantyvault.app.ui.screens.stats.StatsScreen
import com.warrantyvault.app.ui.screens.subscriptions.SubscriptionAuditScreen
import com.warrantyvault.app.ui.screens.subscriptions.SubscriptionDetailScreen
import com.warrantyvault.app.ui.screens.subscriptions.SubscriptionsScreen
import com.warrantyvault.app.ui.screens.wishlist.WishlistDetailScreen
import com.warrantyvault.app.ui.screens.wishlist.WishlistScreen

private enum class Tab(
    val label: String,
    val outlined: ImageVector,
    val filled: ImageVector,
) {
    Dashboard("Tổng quan", Icons.Outlined.GridView, Icons.Filled.GridView),
    Devices("Thiết bị", Icons.Outlined.Devices, Icons.Filled.Devices),
    Reminders("Nhắc", Icons.Outlined.Notifications, Icons.Filled.Notifications),
    Subscriptions("Gói", Icons.Outlined.CreditCard, Icons.Filled.CreditCard),
    Wishlist("Thèm", Icons.Outlined.StarBorder, Icons.Filled.Star),
    Stats("Thống kê", Icons.Outlined.BarChart, Icons.Filled.BarChart),
    Settings("Cài đặt", Icons.Outlined.Settings, Icons.Filled.Settings),
}

@Composable
fun MainScreen(auth: AuthStore) {
    var selected by remember { mutableStateOf(Tab.Dashboard) }
    val authStatus by auth.status.collectAsState()
    val userName = (authStatus as? AuthStore.Status.Authenticated)?.user?.let { u ->
        u.name?.takeIf { it.isNotBlank() } ?: u.email.substringBefore("@")
    } ?: "Bạn"
    var openDeviceId by rememberSaveable { mutableStateOf<String?>(null) }
    var openSubscriptionId by rememberSaveable { mutableStateOf<String?>(null) }
    var openWishlistId by rememberSaveable { mutableStateOf<String?>(null) }
    var openPushDevices by rememberSaveable { mutableStateOf(false) }
    // Device sessions (GET/DELETE /api/v1/auth/sessions) — the other leaf route
    // of Settings, next to the push-target list. Revoking the CURRENT session
    // kills the token this app is holding, so the host answers by dropping to
    // login (AuthStore.endLocalSession), the same route delete-account takes.
    var openSessions by rememberSaveable { mutableStateOf(false) }
    // Global search (GET /api/v1/search) is a full-screen surface of the shell
    // rather than a tab: the tab bar already carries seven destinations, and a
    // search is a detour you come back from, not a place you live in. Checked
    // *after* the detail routes so a result can push a detail screen on top and
    // Back lands on the results again.
    //
    // The keyword lives here, not in SearchScreen: the route swap removes that
    // composable from the tree, and a local rememberSaveable would then come
    // back empty after opening a result.
    var openSearch by rememberSaveable { mutableStateOf(false) }
    var searchQuery by rememberSaveable { mutableStateOf("") }
    // "Việc cần xử lý" (GET /api/v1/actions) — the derived work queue. A
    // full-screen route of the shell rather than an eighth tab: the bar already
    // carries seven destinations, and the Dashboard is where a workload is
    // noticed, so that is where the entry point (and its badge) lives.
    var openActions by rememberSaveable { mutableStateOf(false) }
    // "Soát gói đăng ký" (GET /api/v1/subscriptions/audit) — hung off the
    // Subscriptions tab. Checked after the detail routes as well, so tapping a
    // finding pushes the subscription on top of the report and Back returns here.
    var openAudit by rememberSaveable { mutableStateOf(false) }

    val devId = openDeviceId
    if (devId != null) {
        DeviceDetailScreen(
            api = App.instance.api,
            deviceId = devId,
            onBack = { openDeviceId = null },
        )
        return
    }
    val subId = openSubscriptionId
    if (subId != null) {
        SubscriptionDetailScreen(
            api = App.instance.api,
            subscriptionId = subId,
            onBack = { openSubscriptionId = null },
        )
        return
    }
    val wishId = openWishlistId
    if (wishId != null) {
        WishlistDetailScreen(
            api = App.instance.api,
            itemId = wishId,
            onBack = { openWishlistId = null },
        )
        return
    }
    if (openPushDevices) {
        PushDevicesScreen(
            api = App.instance.api,
            onBack = { openPushDevices = false },
        )
        return
    }
    if (openSessions) {
        SessionsScreen(
            api = App.instance.api,
            onCurrentSessionRevoked = {
                openSessions = false
                auth.endLocalSession()
            },
            onBack = { openSessions = false },
        )
        return
    }
    if (openSearch) {
        SearchScreen(
            api = App.instance.api,
            query = searchQuery,
            onQueryChange = { searchQuery = it },
            onBack = { openSearch = false },
            onOpenDevice = { openDeviceId = it },
            onOpenSubscription = { openSubscriptionId = it },
            onOpenWishlistItem = { openWishlistId = it },
        )
        return
    }
    if (openActions) {
        ActionQueueScreen(
            api = App.instance.api,
            onBack = { openActions = false },
            onOpenDevice = { openDeviceId = it },
            onOpenSubscription = { openSubscriptionId = it },
            onOpenWishlistItem = { openWishlistId = it },
        )
        return
    }
    if (openAudit) {
        SubscriptionAuditScreen(
            api = App.instance.api,
            onBack = { openAudit = false },
            onOpenSubscription = { openSubscriptionId = it },
        )
        return
    }

    Scaffold(
        bottomBar = {
            NavigationBar(
                containerColor = MaterialTheme.colorScheme.surface,
                tonalElevation = 0.dp,
            ) {
                Tab.entries.forEach { tab ->
                    val isSelected = selected == tab
                    NavigationBarItem(
                        selected = isSelected,
                        onClick = { selected = tab },
                        icon = {
                            Icon(
                                if (isSelected) tab.filled else tab.outlined,
                                null,
                            )
                        },
                        label = {
                            Text(
                                tab.label,
                                style = MaterialTheme.typography.labelMedium,
                                fontWeight = if (isSelected) FontWeight.SemiBold else FontWeight.Normal,
                            )
                        },
                        colors = NavigationBarItemDefaults.colors(
                            selectedIconColor = MaterialTheme.colorScheme.primary,
                            selectedTextColor = MaterialTheme.colorScheme.primary,
                            indicatorColor = MaterialTheme.colorScheme.primaryContainer,
                            unselectedIconColor = MaterialTheme.colorScheme.onSurfaceVariant,
                            unselectedTextColor = MaterialTheme.colorScheme.onSurfaceVariant,
                        ),
                    )
                }
            }
        }
    ) { padding ->
        Box(Modifier.padding(padding)) {
            Crossfade(
                targetState = selected,
                animationSpec = tween(durationMillis = 220),
                label = "tab-crossfade",
            ) { current ->
                when (current) {
                    Tab.Dashboard     -> DashboardScreen(
                        api = App.instance.api,
                        userName = userName,
                        onOpenDevice = { openDeviceId = it },
                        onOpenSearch = { openSearch = true },
                        onOpenActions = { openActions = true },
                    )
                    Tab.Devices       -> DevicesScreen(
                        api = App.instance.api,
                        onOpenDevice = { openDeviceId = it },
                        onOpenSearch = { openSearch = true },
                    )
                    Tab.Reminders     -> RemindersScreen(
                        api = App.instance.api,
                        onOpenDevice = { openDeviceId = it },
                    )
                    Tab.Subscriptions -> SubscriptionsScreen(
                        api = App.instance.api,
                        onOpenSubscription = { openSubscriptionId = it },
                        onOpenSearch = { openSearch = true },
                        onOpenAudit = { openAudit = true },
                    )
                    Tab.Wishlist      -> WishlistScreen(
                        api = App.instance.api,
                        onOpenItem = { openWishlistId = it },
                        onOpenSearch = { openSearch = true },
                    )
                    Tab.Stats         -> StatsScreen(api = App.instance.api)
                    Tab.Settings      -> SettingsScreen(
                        auth = auth,
                        themeStore = App.instance.themeStore,
                        api = App.instance.api,
                        onOpenPushDevices = { openPushDevices = true },
                        onOpenSessions = { openSessions = true },
                    )
                }
            }
        }
    }
}
