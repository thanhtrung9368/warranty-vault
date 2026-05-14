package com.warrantyvault.app.ui.screens.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.DarkMode
import androidx.compose.material.icons.filled.LightMode
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.SettingsBrightness
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.warrantyvault.app.App
import com.warrantyvault.app.BuildConfig
import com.warrantyvault.app.auth.AuthStore
import com.warrantyvault.app.ui.components.PageHeader
import com.warrantyvault.app.ui.components.SectionHeader
import com.warrantyvault.app.ui.theme.ThemePreference
import com.warrantyvault.app.ui.theme.ThemeStore
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(
    auth: AuthStore,
    themeStore: ThemeStore,
    onOpenPushDevices: () -> Unit = {},
) {
    val status by auth.status.collectAsState()
    val themePref by themeStore.preference.collectAsState()
    val cs = MaterialTheme.colorScheme
    var showChangePassword by rememberSaveable { mutableStateOf(false) }
    val snackbarHostState = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("") },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = cs.background,
                ),
            )
        },
        snackbarHost = { SnackbarHost(snackbarHostState) },
        containerColor = cs.background,
    ) { padding ->
        Column(
            Modifier
                .padding(padding)
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(bottom = 24.dp),
        ) {
            PageHeader("Cài đặt", "Cá nhân hoá tài khoản & giao diện của mày")

            // Profile card
            (status as? AuthStore.Status.Authenticated)?.user?.let { user ->
                Card(
                    colors = CardDefaults.cardColors(containerColor = cs.surface),
                    elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
                    shape = RoundedCornerShape(20.dp),
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp),
                ) {
                    Row(
                        Modifier.padding(16.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Box(
                            Modifier
                                .size(56.dp)
                                .clip(CircleShape)
                                .background(cs.primary.copy(alpha = 0.14f)),
                            contentAlignment = Alignment.Center,
                        ) {
                            Icon(
                                Icons.Filled.Person, null,
                                tint = cs.primary,
                                modifier = Modifier.size(30.dp),
                            )
                        }
                        Spacer(Modifier.size(12.dp))
                        Column(Modifier.weight(1f)) {
                            Text(
                                user.name ?: user.email,
                                style = MaterialTheme.typography.titleMedium,
                                fontWeight = FontWeight.SemiBold,
                            )
                            Text(
                                user.email,
                                style = MaterialTheme.typography.bodyMedium,
                                color = cs.onSurfaceVariant,
                            )
                        }
                    }
                }
            }

            Spacer(Modifier.height(16.dp))
            Box(Modifier.padding(horizontal = 16.dp)) {
                SectionHeader("Giao diện")
            }
            Spacer(Modifier.height(8.dp))
            Card(
                colors = CardDefaults.cardColors(containerColor = cs.surface),
                elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
                shape = RoundedCornerShape(20.dp),
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp),
            ) {
                Column {
                    ThemePreference.entries.forEachIndexed { index, pref ->
                        SettingsRow(
                            icon = iconFor(pref),
                            title = pref.label,
                            onClick = { themeStore.set(pref) },
                            trailing = {
                                RadioButton(
                                    selected = themePref == pref,
                                    onClick = { themeStore.set(pref) },
                                )
                            },
                            showDivider = index < ThemePreference.entries.size - 1,
                        )
                    }
                }
            }

            Spacer(Modifier.height(16.dp))
            Box(Modifier.padding(horizontal = 16.dp)) {
                SectionHeader("Tài khoản")
            }
            Spacer(Modifier.height(8.dp))
            Card(
                colors = CardDefaults.cardColors(containerColor = cs.surface),
                elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
                shape = RoundedCornerShape(20.dp),
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp),
            ) {
                Column {
                    SettingsRow(
                        icon = Icons.Filled.Lock,
                        title = "Đổi mật khẩu",
                        subtitle = "Cập nhật mật khẩu đăng nhập của mày.",
                        onClick = { showChangePassword = true },
                        showDivider = true,
                    )
                    SettingsRow(
                        icon = Icons.Filled.Notifications,
                        title = "Thiết bị nhận thông báo",
                        subtitle = "Quản lý các thiết bị đăng ký push notification.",
                        onClick = onOpenPushDevices,
                        showDivider = false,
                    )
                }
            }

            Spacer(Modifier.height(16.dp))
            Box(Modifier.padding(horizontal = 16.dp)) {
                SectionHeader("Hệ thống")
            }
            Spacer(Modifier.height(8.dp))
            Card(
                colors = CardDefaults.cardColors(containerColor = cs.surfaceContainerHighest),
                elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
                shape = RoundedCornerShape(20.dp),
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp),
            ) {
                Column(Modifier.padding(16.dp)) {
                    Text(
                        "Backend URL",
                        style = MaterialTheme.typography.labelMedium,
                        color = cs.onSurfaceVariant,
                        fontWeight = FontWeight.SemiBold,
                    )
                    Spacer(Modifier.height(4.dp))
                    Text(
                        BuildConfig.BASE_URL,
                        style = MaterialTheme.typography.bodyMedium,
                        color = cs.onSurface,
                    )
                }
            }

            Spacer(Modifier.height(28.dp))

            Button(
                onClick = { auth.logout() },
                colors = ButtonDefaults.buttonColors(
                    containerColor = cs.errorContainer,
                    contentColor = cs.onErrorContainer,
                ),
                shape = CircleShape,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp)
                    .height(52.dp),
            ) {
                Icon(Icons.AutoMirrored.Filled.Logout, null, modifier = Modifier.size(20.dp))
                Spacer(Modifier.size(8.dp))
                Text(
                    "Đăng xuất",
                    style = MaterialTheme.typography.labelLarge,
                    fontWeight = FontWeight.SemiBold,
                )
            }
        }
    }

    if (showChangePassword) {
        ChangePasswordSheet(
            api = App.instance.api,
            onDismiss = { showChangePassword = false },
            onSuccess = {
                showChangePassword = false
                scope.launch {
                    snackbarHostState.showSnackbar("Đã đổi mật khẩu thành công")
                }
            },
        )
    }
}

@Composable
private fun SettingsRow(
    icon: ImageVector,
    title: String,
    subtitle: String? = null,
    onClick: (() -> Unit)? = null,
    trailing: @Composable (() -> Unit)? = null,
    showDivider: Boolean = false,
) {
    val cs = MaterialTheme.colorScheme
    Column {
        Row(
            Modifier
                .fillMaxWidth()
                .let { if (onClick != null) it.clickable(onClick = onClick) else it }
                .padding(horizontal = 16.dp, vertical = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                Modifier
                    .size(40.dp)
                    .clip(RoundedCornerShape(12.dp))
                    .background(cs.primary.copy(alpha = 0.10f)),
                contentAlignment = Alignment.Center,
            ) {
                Icon(icon, null, tint = cs.primary, modifier = Modifier.size(22.dp))
            }
            Spacer(Modifier.size(12.dp))
            Column(
                Modifier.weight(1f),
                verticalArrangement = Arrangement.Center,
            ) {
                Text(
                    title,
                    style = MaterialTheme.typography.bodyLarge,
                    fontWeight = FontWeight.Medium,
                    color = cs.onSurface,
                )
                if (subtitle != null) {
                    Text(
                        subtitle,
                        style = MaterialTheme.typography.bodySmall,
                        color = cs.onSurfaceVariant,
                    )
                }
            }
            if (trailing != null) trailing()
        }
        if (showDivider) {
            androidx.compose.material3.HorizontalDivider(
                color = cs.outlineVariant.copy(alpha = 0.5f),
                modifier = Modifier.padding(start = 68.dp),
            )
        }
    }
}

private fun iconFor(pref: ThemePreference): ImageVector = when (pref) {
    ThemePreference.System -> Icons.Filled.SettingsBrightness
    ThemePreference.Light  -> Icons.Filled.LightMode
    ThemePreference.Dark   -> Icons.Filled.DarkMode
}
