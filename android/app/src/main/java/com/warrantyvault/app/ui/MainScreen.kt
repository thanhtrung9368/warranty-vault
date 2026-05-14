package com.warrantyvault.app.ui

import androidx.compose.animation.Crossfade
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.BarChart
import androidx.compose.material.icons.filled.CreditCard
import androidx.compose.material.icons.filled.Devices
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.outlined.BarChart
import androidx.compose.material.icons.outlined.CreditCard
import androidx.compose.material.icons.outlined.Devices
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
import com.warrantyvault.app.ui.screens.devices.DeviceDetailScreen
import com.warrantyvault.app.ui.screens.devices.DevicesScreen
import com.warrantyvault.app.ui.screens.reminders.RemindersScreen
import com.warrantyvault.app.ui.screens.settings.PushDevicesScreen
import com.warrantyvault.app.ui.screens.settings.SettingsScreen
import com.warrantyvault.app.ui.screens.stats.StatsScreen
import com.warrantyvault.app.ui.screens.subscriptions.SubscriptionDetailScreen
import com.warrantyvault.app.ui.screens.subscriptions.SubscriptionsScreen
import com.warrantyvault.app.ui.screens.wishlist.WishlistDetailScreen
import com.warrantyvault.app.ui.screens.wishlist.WishlistScreen

private enum class Tab(
    val label: String,
    val outlined: ImageVector,
    val filled: ImageVector,
) {
    Devices("Thiết bị", Icons.Outlined.Devices, Icons.Filled.Devices),
    Reminders("Nhắc", Icons.Outlined.Notifications, Icons.Filled.Notifications),
    Subscriptions("Gói", Icons.Outlined.CreditCard, Icons.Filled.CreditCard),
    Wishlist("Thèm", Icons.Outlined.StarBorder, Icons.Filled.Star),
    Stats("Thống kê", Icons.Outlined.BarChart, Icons.Filled.BarChart),
    Settings("Cài đặt", Icons.Outlined.Settings, Icons.Filled.Settings),
}

@Composable
fun MainScreen(auth: AuthStore) {
    var selected by remember { mutableStateOf(Tab.Devices) }
    var openDeviceId by rememberSaveable { mutableStateOf<String?>(null) }
    var openSubscriptionId by rememberSaveable { mutableStateOf<String?>(null) }
    var openWishlistId by rememberSaveable { mutableStateOf<String?>(null) }
    var openPushDevices by rememberSaveable { mutableStateOf(false) }

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
                    Tab.Devices       -> DevicesScreen(
                        api = App.instance.api,
                        onOpenDevice = { openDeviceId = it },
                    )
                    Tab.Reminders     -> RemindersScreen(
                        api = App.instance.api,
                        onOpenDevice = { openDeviceId = it },
                    )
                    Tab.Subscriptions -> SubscriptionsScreen(
                        api = App.instance.api,
                        onOpenSubscription = { openSubscriptionId = it },
                    )
                    Tab.Wishlist      -> WishlistScreen(
                        api = App.instance.api,
                        onOpenItem = { openWishlistId = it },
                    )
                    Tab.Stats         -> StatsScreen(api = App.instance.api)
                    Tab.Settings      -> SettingsScreen(
                        auth = auth,
                        themeStore = App.instance.themeStore,
                        onOpenPushDevices = { openPushDevices = true },
                    )
                }
            }
        }
    }
}
