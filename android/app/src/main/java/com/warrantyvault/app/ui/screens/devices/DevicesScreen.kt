package com.warrantyvault.app.ui.screens.devices

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
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Inventory2
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
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
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import com.warrantyvault.app.network.ApiClient
import com.warrantyvault.app.ui.viewModelFactory
import com.warrantyvault.app.network.ApiService
import com.warrantyvault.app.network.Device
import com.warrantyvault.app.network.DeviceStatus
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
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.text.NumberFormat
import java.util.Locale

class DevicesViewModel(private val api: ApiService) : ViewModel() {
    sealed interface State {
        data object Loading : State
        data class Loaded(val devices: List<Device>) : State
        data class Error(val message: String) : State
    }

    private val _state = MutableStateFlow<State>(State.Loading)
    val state: StateFlow<State> = _state.asStateFlow()

    fun load() {
        viewModelScope.launch {
            _state.value = State.Loading
            try {
                val res = api.listDevices()
                _state.value = State.Loaded(res.devices)
            } catch (e: Exception) {
                _state.value = State.Error(e.toUserMessage(ApiClient.json))
            }
        }
    }

    fun prepend(device: Device) {
        _state.update {
            when (it) {
                is State.Loaded -> State.Loaded(listOf(device) + it.devices)
                else -> it
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DevicesScreen(
    api: ApiService,
    onOpenDevice: (String) -> Unit = {},
) {
    val vm: DevicesViewModel = viewModel(
        factory = viewModelFactory { DevicesViewModel(api) },
    )
    val state by vm.state.collectAsState()
    var showAdd by rememberSaveable { mutableStateOf(false) }
    var refreshing by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

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
        floatingActionButton = {
            ExtendedFloatingActionButton(
                onClick = { showAdd = true },
                containerColor = MaterialTheme.colorScheme.primary,
                contentColor = MaterialTheme.colorScheme.onPrimary,
                shape = RoundedCornerShape(28.dp),
                icon = { Icon(Icons.Filled.Add, null) },
                text = { Text("Thêm thiết bị", fontWeight = FontWeight.SemiBold) },
            )
        },
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
                label = "devices-state",
            ) { s ->
                when (s) {
                    is DevicesViewModel.State.Loading -> Column {
                        PageHeader(
                            "Thiết bị",
                            "Đang tải danh sách của mày…",
                        )
                        SkeletonList(count = 5)
                    }
                    is DevicesViewModel.State.Error -> ErrorState(
                        icon = Icons.Outlined.WarningAmber,
                        title = "Tải không được rồi",
                        body = s.message,
                        onRetry = { vm.load() },
                    )
                    is DevicesViewModel.State.Loaded -> {
                        if (s.devices.isEmpty()) {
                            Column(Modifier.fillMaxSize()) {
                                PageHeader(
                                    "Thiết bị",
                                    "Theo dõi bảo hành & ngày mua",
                                )
                                EmptyState(
                                    icon = Icons.Filled.Inventory2,
                                    title = "Chưa có thiết bị nào, mày",
                                    body = "Thêm cái đầu tiên để bắt đầu theo dõi bảo hành nha.",
                                    ctaLabel = "Thêm thiết bị đầu tiên",
                                    onCta = { showAdd = true },
                                )
                            }
                        } else {
                            DeviceList(
                                devices = s.devices,
                                onClick = onOpenDevice,
                            )
                        }
                    }
                }
            }
        }
    }

    if (showAdd) {
        AddDeviceSheet(
            api = api,
            onDismiss = { showAdd = false },
            onCreated = { device ->
                vm.prepend(device)
                showAdd = false
            },
        )
    }
}

@Composable
private fun DeviceList(devices: List<Device>, onClick: (String) -> Unit) {
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 0.dp, bottom = 96.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            PageHeader(
                "Thiết bị",
                "${devices.size} món đang theo dõi",
                modifier = Modifier.padding(horizontal = 0.dp),
            )
        }
        items(devices, key = { it.id }) { device ->
            DeviceCard(device, onClick = { onClick(device.id) })
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun DeviceCard(device: Device, onClick: () -> Unit) {
    val cs = MaterialTheme.colorScheme
    val interactionSource = remember { MutableInteractionSource() }
    Card(
        onClick = onClick,
        interactionSource = interactionSource,
        colors = CardDefaults.cardColors(containerColor = cs.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
        shape = RoundedCornerShape(20.dp),
        modifier = Modifier
            .fillMaxWidth()
            .pressScale(interactionSource),
    ) {
        Row(
            modifier = Modifier.padding(16.dp),
            verticalAlignment = Alignment.Top,
        ) {
            Box(
                Modifier
                    .size(48.dp)
                    .clip(RoundedCornerShape(14.dp))
                    .background(cs.primary.copy(alpha = 0.12f)),
                contentAlignment = Alignment.Center,
            ) {
                Icon(Icons.Filled.Inventory2, null, tint = cs.primary)
            }
            Spacer(Modifier.width(12.dp))
            Column(Modifier.fillMaxWidth()) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        device.name,
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.SemiBold,
                        color = cs.onSurface,
                        modifier = Modifier.weight(1f),
                    )
                    DeviceStatusPill(device.status)
                }
                if (device.brand != null) {
                    val sub = device.brand + (device.model?.let { " • $it" } ?: "")
                    Text(
                        sub,
                        style = MaterialTheme.typography.bodyMedium,
                        color = cs.onSurfaceVariant,
                    )
                }
                Spacer(Modifier.height(8.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        formatVnd(device.purchasePrice),
                        style = MaterialTheme.typography.labelMedium,
                        color = cs.onSurfaceVariant,
                    )
                    Spacer(Modifier.weight(1f))
                    Text(
                        device.purchaseDate.take(10),
                        style = MaterialTheme.typography.labelMedium,
                        color = cs.onSurfaceVariant,
                    )
                }
            }
        }
    }
}

@Composable
private fun DeviceStatusPill(status: DeviceStatus) {
    val kind = when (status) {
        DeviceStatus.ACTIVE  -> PillKind.Success
        DeviceStatus.EXPIRED -> PillKind.Neutral
        DeviceStatus.SOLD    -> PillKind.Info
        DeviceStatus.BROKEN  -> PillKind.Danger
        DeviceStatus.LOST    -> PillKind.Warning
    }
    StatusPill(label = status.label, kind = kind)
}

internal fun formatVnd(amount: Int): String {
    val nf = NumberFormat.getNumberInstance(Locale("vi", "VN"))
    return nf.format(amount) + "đ"
}
