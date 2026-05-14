package com.warrantyvault.app.ui.screens.settings

import androidx.compose.foundation.background
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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Android
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.NotificationsActive
import androidx.compose.material.icons.filled.PhoneIphone
import androidx.compose.material.icons.filled.Public
import androidx.compose.material.icons.outlined.NotificationsNone
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
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
import androidx.compose.ui.unit.sp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.warrantyvault.app.network.ApiClient
import com.warrantyvault.app.network.ApiService
import com.warrantyvault.app.network.PushSubscriptionMeta
import com.warrantyvault.app.network.toUserMessage
import com.warrantyvault.app.ui.components.EmptyState
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.time.Duration
import java.time.OffsetDateTime
import java.time.format.DateTimeParseException

class PushDevicesViewModel(private val api: ApiService) : ViewModel() {
    sealed interface State {
        data object Loading : State
        data class Loaded(val subs: List<PushSubscriptionMeta>) : State
        data class Error(val message: String) : State
    }

    private val _state = MutableStateFlow<State>(State.Loading)
    val state: StateFlow<State> = _state.asStateFlow()

    fun load() {
        viewModelScope.launch {
            _state.value = State.Loading
            try {
                val res = api.listPushSubscriptions()
                _state.value = State.Loaded(res.subscriptions)
            } catch (e: Exception) {
                _state.value = State.Error(e.toUserMessage(ApiClient.json))
            }
        }
    }

    fun removeLocally(id: String) {
        val cur = _state.value
        if (cur is State.Loaded) {
            _state.value = State.Loaded(cur.subs.filterNot { it.id == id })
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PushDevicesScreen(
    api: ApiService,
    onBack: () -> Unit,
) {
    val vm = remember { PushDevicesViewModel(api) }
    val state by vm.state.collectAsState()
    val snackbarHost = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()

    var confirmDelete by remember { mutableStateOf<PushSubscriptionMeta?>(null) }
    var sendingTest by rememberSaveable { mutableStateOf(false) }
    var deletingId by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) { vm.load() }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Thiết bị nhận thông báo") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, "Quay lại")
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.background,
                ),
            )
        },
        snackbarHost = { SnackbarHost(snackbarHost) },
        containerColor = MaterialTheme.colorScheme.background,
    ) { padding ->
        Box(Modifier.padding(padding).fillMaxSize()) {
            when (val s = state) {
                is PushDevicesViewModel.State.Loading -> Box(
                    Modifier.fillMaxSize(),
                    contentAlignment = Alignment.Center,
                ) { CircularProgressIndicator() }

                is PushDevicesViewModel.State.Error -> Column(
                    Modifier.fillMaxSize().padding(24.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center,
                ) {
                    Icon(
                        Icons.Outlined.WarningAmber, null,
                        tint = MaterialTheme.colorScheme.error,
                        modifier = Modifier.size(40.dp),
                    )
                    Spacer(Modifier.height(8.dp))
                    Text(
                        s.message,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Spacer(Modifier.height(12.dp))
                    Button(onClick = { vm.load() }) { Text("Thử lại") }
                }

                is PushDevicesViewModel.State.Loaded -> {
                    if (s.subs.isEmpty()) {
                        EmptyState(
                            icon = Icons.Outlined.NotificationsNone,
                            title = "Chưa có thiết bị nào",
                            body = "Mày chưa đăng ký nhận thông báo trên thiết bị nào. " +
                                "Mở app trên điện thoại/máy tính khác để đăng ký thêm.",
                        )
                    } else {
                        LazyColumn(
                            modifier = Modifier.fillMaxSize(),
                            contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp),
                            verticalArrangement = Arrangement.spacedBy(12.dp),
                        ) {
                            item {
                                OutlinedButton(
                                    onClick = {
                                        scope.launch {
                                            sendingTest = true
                                            try {
                                                val res = api.sendTestPush()
                                                snackbarHost.showSnackbar(
                                                    "Đã gửi thử: ${res.sent} thành công, ${res.failed} lỗi"
                                                )
                                            } catch (e: Exception) {
                                                snackbarHost.showSnackbar(
                                                    e.toUserMessage(ApiClient.json)
                                                )
                                            } finally {
                                                sendingTest = false
                                            }
                                        }
                                    },
                                    enabled = !sendingTest,
                                    modifier = Modifier.fillMaxWidth().height(48.dp),
                                ) {
                                    if (sendingTest) {
                                        CircularProgressIndicator(
                                            strokeWidth = 2.dp,
                                            modifier = Modifier.size(18.dp),
                                        )
                                    } else {
                                        Icon(Icons.Filled.NotificationsActive, null)
                                        Spacer(Modifier.width(8.dp))
                                        Text(
                                            "Gửi thông báo thử",
                                            fontWeight = FontWeight.SemiBold,
                                        )
                                    }
                                }
                            }

                            items(s.subs, key = { it.id }) { sub ->
                                PushDeviceRow(
                                    sub = sub,
                                    deleting = deletingId == sub.id,
                                    onDelete = { confirmDelete = sub },
                                )
                            }
                        }
                    }
                }
            }
        }
    }

    confirmDelete?.let { sub ->
        AlertDialog(
            onDismissRequest = { confirmDelete = null },
            title = { Text("Xoá đăng ký?") },
            text = {
                Text(
                    "Thiết bị này sẽ không còn nhận thông báo từ WarrantyVault.",
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    val id = sub.id
                    confirmDelete = null
                    scope.launch {
                        deletingId = id
                        try {
                            api.unregisterPush(id)
                            vm.removeLocally(id)
                            snackbarHost.showSnackbar("Đã xoá thiết bị")
                        } catch (e: Exception) {
                            snackbarHost.showSnackbar(e.toUserMessage(ApiClient.json))
                        } finally {
                            deletingId = null
                        }
                    }
                }) {
                    Text(
                        "Xoá",
                        color = MaterialTheme.colorScheme.error,
                    )
                }
            },
            dismissButton = {
                TextButton(onClick = { confirmDelete = null }) { Text("Huỷ") }
            },
        )
    }
}

@Composable
private fun PushDeviceRow(
    sub: PushSubscriptionMeta,
    deleting: Boolean,
    onDelete: () -> Unit,
) {
    val cs = MaterialTheme.colorScheme
    Card(
        colors = CardDefaults.cardColors(containerColor = cs.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
        shape = RoundedCornerShape(20.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(
            Modifier.padding(14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            val (icon, tint) = iconFor(sub.platform)
            Box(
                Modifier
                    .size(44.dp)
                    .clip(CircleShape)
                    .background(tint.copy(alpha = 0.14f)),
                contentAlignment = Alignment.Center,
            ) {
                Icon(icon, null, tint = tint, modifier = Modifier.size(24.dp))
            }
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    PlatformPill(sub.platform)
                    Spacer(Modifier.width(8.dp))
                    Text(
                        labelFor(sub),
                        style = MaterialTheme.typography.bodyLarge,
                        fontWeight = FontWeight.Medium,
                        color = cs.onSurface,
                    )
                }
                Spacer(Modifier.height(2.dp))
                Text(
                    "Đăng ký ${relativeVi(sub.createdAt)}",
                    style = MaterialTheme.typography.bodySmall,
                    color = cs.onSurfaceVariant,
                )
            }
            IconButton(
                onClick = onDelete,
                enabled = !deleting,
            ) {
                if (deleting) {
                    CircularProgressIndicator(
                        strokeWidth = 2.dp,
                        modifier = Modifier.size(18.dp),
                    )
                } else {
                    Icon(
                        Icons.Filled.Delete, "Xoá",
                        tint = cs.error,
                    )
                }
            }
        }
    }
}

@Composable
private fun PlatformPill(platform: String) {
    val cs = MaterialTheme.colorScheme
    val label = when (platform.lowercase()) {
        "fcm" -> "Android"
        "apns" -> "iOS"
        "web" -> "Web"
        else -> platform
    }
    Box(
        Modifier
            .clip(CircleShape)
            .background(cs.primary.copy(alpha = 0.14f))
            .padding(horizontal = 8.dp, vertical = 2.dp),
    ) {
        Text(
            label,
            fontSize = 11.sp,
            fontWeight = FontWeight.SemiBold,
            color = cs.primary,
        )
    }
}

private fun iconFor(platform: String) =
    when (platform.lowercase()) {
        "fcm" -> Icons.Filled.Android to androidx.compose.ui.graphics.Color(0xFF3DDC84)
        "apns" -> Icons.Filled.PhoneIphone to androidx.compose.ui.graphics.Color(0xFF007AFF)
        else -> Icons.Filled.Public to androidx.compose.ui.graphics.Color(0xFF6B7280)
    }

private fun labelFor(sub: PushSubscriptionMeta): String {
    val ua = sub.userAgent?.trim().orEmpty()
    if (ua.isNotEmpty()) {
        // Pick a short hint — trim long UA strings to first chunk.
        val short = ua.split(" ", ";").firstOrNull { it.length >= 3 } ?: ua
        return short.take(28)
    }
    val tail = sub.endpoint.takeLast(8)
    return "Thiết bị …$tail"
}

private fun relativeVi(iso: String): String {
    val past = try {
        OffsetDateTime.parse(iso)
    } catch (_: DateTimeParseException) {
        return "vừa rồi"
    } catch (_: Exception) {
        return "vừa rồi"
    }
    val now = OffsetDateTime.now()
    val d = Duration.between(past, now)
    val secs = d.seconds
    return when {
        secs < 60 -> "vừa rồi"
        secs < 3600 -> "${secs / 60} phút trước"
        secs < 86_400 -> "${secs / 3600} giờ trước"
        secs < 30L * 86_400 -> "${secs / 86_400} ngày trước"
        secs < 365L * 86_400 -> "${secs / (30L * 86_400)} tháng trước"
        else -> "${secs / (365L * 86_400)} năm trước"
    }
}
