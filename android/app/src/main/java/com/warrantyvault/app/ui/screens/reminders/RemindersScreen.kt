package com.warrantyvault.app.ui.screens.reminders

import androidx.compose.animation.Crossfade
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.NotificationsActive
import androidx.compose.material.icons.filled.NotificationsOff
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.warrantyvault.app.network.ApiClient
import com.warrantyvault.app.network.ApiService
import com.warrantyvault.app.network.UpcomingReminder
import com.warrantyvault.app.network.WarrantyType
import com.warrantyvault.app.network.toUserMessage
import com.warrantyvault.app.ui.components.EmptyState
import com.warrantyvault.app.ui.components.ErrorState
import com.warrantyvault.app.ui.components.PageHeader
import com.warrantyvault.app.ui.components.PillKind
import com.warrantyvault.app.ui.components.SkeletonList
import com.warrantyvault.app.ui.components.StatusPill
import com.warrantyvault.app.ui.components.pressScale
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.time.LocalDate
import java.time.format.DateTimeParseException

class RemindersViewModel(private val api: ApiService) : ViewModel() {
    sealed interface State {
        data object Loading : State
        data class Loaded(val items: List<UpcomingReminder>) : State
        data class Error(val message: String) : State
    }

    private val _state = MutableStateFlow<State>(State.Loading)
    val state: StateFlow<State> = _state.asStateFlow()

    fun load() {
        viewModelScope.launch {
            _state.value = State.Loading
            try {
                val items = api.listUpcomingReminders().reminders
                _state.value = State.Loaded(items)
            } catch (e: Exception) {
                _state.value = State.Error(e.toUserMessage(ApiClient.json))
            }
        }
    }

    fun dismiss(warrantyId: String, onError: (String) -> Unit, onSuccess: () -> Unit) {
        viewModelScope.launch {
            try {
                api.dismissWarrantyReminder(warrantyId)
                load()
                onSuccess()
            } catch (e: Exception) {
                onError(e.toUserMessage(ApiClient.json))
            }
        }
    }

    /** Un-dismisses a reminder (the "Hoàn tác" undo action) and reloads. */
    fun restore(warrantyId: String, onError: (String) -> Unit) {
        viewModelScope.launch {
            try {
                api.restoreWarrantyReminder(warrantyId)
                load()
            } catch (e: Exception) {
                onError(e.toUserMessage(ApiClient.json))
            }
        }
    }
}

private fun parseIsoDate(raw: String): LocalDate? {
    val ten = raw.take(10)
    return try {
        LocalDate.parse(ten)
    } catch (_: DateTimeParseException) {
        null
    }
}

private fun daysLeftFromIso(raw: String): Long? {
    val end = parseIsoDate(raw) ?: return null
    return java.time.temporal.ChronoUnit.DAYS.between(LocalDate.now(), end)
}

private fun warrantyTypeLabel(raw: String): String =
    runCatching { WarrantyType.valueOf(raw).label }.getOrDefault(raw)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RemindersScreen(
    api: ApiService,
    onOpenDevice: (String) -> Unit = {},
) {
    val vm = remember { RemindersViewModel(api) }
    val state by vm.state.collectAsState()
    var refreshing by remember { mutableStateOf(false) }
    var actionError by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val snackbarHostState = remember { SnackbarHostState() }

    fun onDismiss(warrantyId: String) {
        vm.dismiss(
            warrantyId,
            onError = { actionError = it },
            onSuccess = {
                scope.launch {
                    val res = snackbarHostState.showSnackbar(
                        message = "Đã ẩn nhắc nhở",
                        actionLabel = "Hoàn tác",
                    )
                    if (res == SnackbarResult.ActionPerformed) {
                        vm.restore(warrantyId) { actionError = it }
                    }
                }
            },
        )
    }

    LaunchedEffect(Unit) { vm.load() }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("") },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.background,
                ),
            )
        },
        snackbarHost = { SnackbarHost(snackbarHostState) },
        containerColor = MaterialTheme.colorScheme.background,
    ) { padding ->
        PullToRefreshBox(
            isRefreshing = refreshing,
            onRefresh = {
                scope.launch {
                    refreshing = true
                    vm.load()
                    refreshing = false
                }
            },
            modifier = Modifier.padding(padding).fillMaxSize(),
        ) {
            Crossfade(
                targetState = state,
                animationSpec = tween(220),
                label = "reminders-state",
            ) { s ->
                when (s) {
                    is RemindersViewModel.State.Loading -> Column {
                        PageHeader("Sắp hết bảo hành", "Đang tải…")
                        SkeletonList(count = 3)
                    }
                    is RemindersViewModel.State.Error -> ErrorState(
                        icon = Icons.Outlined.WarningAmber,
                        title = "Tải không được rồi",
                        body = s.message,
                        onRetry = { vm.load() },
                    )
                    is RemindersViewModel.State.Loaded -> {
                        if (s.items.isEmpty()) {
                            Column(Modifier.fillMaxSize()) {
                                PageHeader(
                                    "Sắp hết bảo hành",
                                    "Tao sẽ ping mày khi gần hết hạn",
                                )
                                EmptyState(
                                    icon = Icons.Filled.NotificationsActive,
                                    title = "Chill, chưa có gì sắp hết",
                                    body = "Tất cả thiết bị của mày đang trong hạn an toàn.",
                                    tone = MaterialTheme.colorScheme.primary,
                                )
                            }
                        } else {
                            Column {
                                actionError?.let {
                                    Card(
                                        colors = CardDefaults.cardColors(
                                            containerColor = MaterialTheme.colorScheme.errorContainer,
                                        ),
                                        shape = RoundedCornerShape(16.dp),
                                        modifier = Modifier.fillMaxWidth().padding(16.dp),
                                    ) {
                                        Row(
                                            Modifier.padding(12.dp),
                                            verticalAlignment = Alignment.CenterVertically,
                                        ) {
                                            Icon(Icons.Outlined.WarningAmber, null,
                                                tint = MaterialTheme.colorScheme.onErrorContainer)
                                            Spacer(Modifier.width(8.dp))
                                            Text(
                                                it,
                                                color = MaterialTheme.colorScheme.onErrorContainer,
                                                style = MaterialTheme.typography.bodySmall,
                                                modifier = Modifier.weight(1f),
                                            )
                                            TextButton(onClick = { actionError = null }) {
                                                Text("Đóng")
                                            }
                                        }
                                    }
                                }
                                LazyColumn(
                                    contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 0.dp, bottom = 24.dp),
                                    verticalArrangement = Arrangement.spacedBy(12.dp),
                                ) {
                                    item {
                                        PageHeader(
                                            "Sắp hết bảo hành",
                                            "${s.items.size} món cần để ý",
                                        )
                                    }
                                    items(s.items, key = { it.id }) { r ->
                                        ReminderCard(
                                            reminder = r,
                                            onOpenDevice = { onOpenDevice(r.deviceId) },
                                            onDismiss = { onDismiss(r.id) },
                                        )
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ReminderCard(
    reminder: UpcomingReminder,
    onOpenDevice: () -> Unit,
    onDismiss: () -> Unit,
) {
    val cs = MaterialTheme.colorScheme
    val days = daysLeftFromIso(reminder.endDate) ?: 0L
    val pillKind = when {
        days <= 3 -> PillKind.Danger
        days <= 7 -> PillKind.Warning
        else -> PillKind.Info
    }
    val pillLabel = when {
        days < 0L -> "Đã hết hạn"
        days == 0L -> "Hết hôm nay"
        days == 1L -> "Còn 1 ngày"
        else -> "Còn $days ngày"
    }
    val interactionSource = remember { MutableInteractionSource() }
    Card(
        onClick = onOpenDevice,
        interactionSource = interactionSource,
        colors = CardDefaults.cardColors(containerColor = cs.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
        shape = RoundedCornerShape(20.dp),
        modifier = Modifier
            .fillMaxWidth()
            .pressScale(interactionSource),
    ) {
        Column(Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                StatusPill(label = pillLabel, kind = pillKind)
                Spacer(Modifier.width(8.dp))
                Text(
                    warrantyTypeLabel(reminder.type),
                    style = MaterialTheme.typography.labelMedium,
                    color = cs.onSurfaceVariant,
                )
            }
            Spacer(Modifier.height(10.dp))
            Text(
                reminder.device.name,
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
                color = cs.onSurface,
            )
            if (reminder.device.category.isNotBlank()) {
                Text(
                    reminder.device.category,
                    style = MaterialTheme.typography.bodyMedium,
                    color = cs.onSurfaceVariant,
                )
            }
            Spacer(Modifier.height(6.dp))
            Text(
                "Hết hạn: ${reminder.endDate.take(10)}",
                style = MaterialTheme.typography.bodySmall,
                color = cs.onSurfaceVariant,
            )
            reminder.provider?.takeIf { it.isNotBlank() }?.let {
                Text(
                    "Đơn vị bảo hành: $it",
                    style = MaterialTheme.typography.bodySmall,
                    color = cs.onSurfaceVariant,
                )
            }
            Spacer(Modifier.height(8.dp))
            Row {
                TextButton(onClick = onDismiss) {
                    Icon(Icons.Filled.NotificationsOff, null, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(6.dp))
                    Text("Đã xem", style = MaterialTheme.typography.labelLarge)
                }
            }
        }
    }
}
