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
import androidx.compose.material.icons.filled.AttachFile
import androidx.compose.material.icons.filled.Inventory2
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.SearchOff
import androidx.compose.material.icons.filled.SwapVert
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
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
import com.warrantyvault.app.ui.components.FilterOption
import com.warrantyvault.app.ui.components.ListFilterBar
import com.warrantyvault.app.ui.components.PageHeader
import com.warrantyvault.app.ui.components.PillKind
import com.warrantyvault.app.ui.components.SkeletonList
import com.warrantyvault.app.ui.components.SortMenuButton
import com.warrantyvault.app.ui.components.StatusPill
import com.warrantyvault.app.ui.components.WarrantyPill
import com.warrantyvault.app.ui.components.pressScale
import com.warrantyvault.app.ui.components.warrantyState
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.text.NumberFormat
import java.util.Locale

/**
 * Sort choices in the device list — the web dropdown in
 * `website/src/components/devices-filter-bar.tsx`, same 7 options, same order.
 * The values map 1:1 onto the `sort` / `dir` query params of `GET /v1/devices`
 * (openapi enum: purchaseDate | warrantyEndDate | price | name).
 */
enum class DeviceSort(val sort: String, val dir: String, val label: String) {
    PurchaseDateDesc("purchaseDate", "desc", "Ngày mua mới nhất"),
    PurchaseDateAsc("purchaseDate", "asc", "Ngày mua cũ nhất"),
    WarrantyEndAsc("warrantyEndDate", "asc", "BH sắp hết trước"),
    WarrantyEndDesc("warrantyEndDate", "desc", "BH lâu hết trước"),
    PriceDesc("price", "desc", "Giá cao nhất"),
    PriceAsc("price", "asc", "Giá thấp nhất"),
    NameAsc("name", "asc", "Tên A-Z"),
}

class DevicesViewModel(private val api: ApiService) : ViewModel() {
    sealed interface State {
        data object Loading : State
        data class Loaded(val devices: List<Device>) : State
        data class Error(val message: String) : State
    }

    private val _state = MutableStateFlow<State>(State.Loading)
    val state: StateFlow<State> = _state.asStateFlow()

    fun load(
        query: String = "",
        status: DeviceStatus? = null,
        sort: DeviceSort = DeviceSort.PurchaseDateDesc,
    ) {
        viewModelScope.launch {
            _state.value = State.Loading
            try {
                val res = api.listDevices(
                    q = query.trim().ifBlank { null },
                    status = status?.name,
                    sort = sort.sort,
                    dir = sort.dir,
                )
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
    onOpenSearch: () -> Unit = {},
) {
    val vm: DevicesViewModel = viewModel(
        factory = viewModelFactory { DevicesViewModel(api) },
    )
    val state by vm.state.collectAsState()
    var showAdd by rememberSaveable { mutableStateOf(false) }
    var refreshing by remember { mutableStateOf(false) }
    // Filter state — mirrors the web `devices-filter-bar.tsx` (search box, status
    // pills, sort dropdown). Values are persisted across rotation.
    var query by rememberSaveable { mutableStateOf("") }
    var statusFilter by rememberSaveable { mutableStateOf<String?>(null) }
    var sortKey by rememberSaveable { mutableStateOf(DeviceSort.PurchaseDateDesc.name) }
    val sort = DeviceSort.valueOf(sortKey)
    val status = statusFilter?.let { runCatching { DeviceStatus.valueOf(it) }.getOrNull() }
    val isFiltered = query.isNotBlank() || status != null
    val scope = rememberCoroutineScope()

    fun reload() = vm.load(query = query, status = status, sort = sort)

    // Debounced so each keystroke doesn't fire a request (web waits 300ms too).
    LaunchedEffect(query, statusFilter, sortKey) {
        if (query.isNotBlank()) kotlinx.coroutines.delay(300)
        vm.load(query = query, status = status, sort = sort)
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("") },
                actions = {
                    // Global search (`GET /v1/search`), distinct from the filter
                    // box below: that one narrows this list server-side, this one
                    // looks across devices, subscriptions and wishlist.
                    IconButton(onClick = onOpenSearch) {
                        Icon(Icons.Filled.Search, "Tìm kiếm tất cả")
                    }
                },
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
                    reload()
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
                        onRetry = { reload() },
                    )
                    is DevicesViewModel.State.Loaded -> {
                        DeviceList(
                            devices = s.devices,
                            isFiltered = isFiltered,
                            query = query,
                            onQueryChange = { query = it },
                            statusKey = statusFilter ?: ALL_STATUSES,
                            onStatusChange = { statusFilter = it.takeIf { k -> k != ALL_STATUSES } },
                            sort = sort,
                            onSortChange = { sortKey = it.name },
                            onClick = onOpenDevice,
                            onAddFirst = { showAdd = true },
                        )
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
                // Optimistic insert for instant feedback, then reconcile: POST
                // answers with a bare device row, so `effectiveWarrantyEnd` /
                // `attachmentCount` (list-row projection only) would otherwise
                // read as "no warranty, no files" until the next refresh.
                vm.prepend(device)
                showAdd = false
                reload()
            },
        )
    }
}

@Composable
private fun DeviceList(
    devices: List<Device>,
    isFiltered: Boolean,
    query: String,
    onQueryChange: (String) -> Unit,
    statusKey: String,
    onStatusChange: (String) -> Unit,
    sort: DeviceSort,
    onSortChange: (DeviceSort) -> Unit,
    onClick: (String) -> Unit,
    onAddFirst: () -> Unit,
) {
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 0.dp, bottom = 96.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            PageHeader(
                "Thiết bị",
                "${devices.size} món đang theo dõi" + if (isFiltered) " (đã lọc)" else "",
                modifier = Modifier.padding(horizontal = 0.dp),
            )
        }
        item {
            ListFilterBar(
                query = query,
                onQueryChange = onQueryChange,
                placeholder = "Tìm theo tên, hãng, model, serial...",
                options = statusOptions,
                selectedKey = statusKey,
                onSelect = onStatusChange,
                modifier = Modifier.padding(horizontal = 4.dp),
                trailing = {
                    SortMenuButton(
                        options = DeviceSort.entries,
                        current = sort,
                        label = { it.label },
                        onSelect = onSortChange,
                    )
                },
            )
        }
        if (devices.isEmpty()) {
            item {
                EmptyState(
                    icon = if (isFiltered) Icons.Filled.SearchOff else Icons.Filled.Inventory2,
                    title = if (isFiltered) "Không có gì khớp bộ lọc" else "Chưa có thiết bị nào, mày",
                    body = if (isFiltered) {
                        "Thử nới bộ lọc hoặc xoá ô tìm kiếm xem sao."
                    } else {
                        "Thêm cái đầu tiên để bắt đầu theo dõi bảo hành nha."
                    },
                    ctaLabel = if (isFiltered) null else "Thêm thiết bị đầu tiên",
                    onCta = if (isFiltered) null else onAddFirst,
                )
            }
        }
        items(devices, key = { it.id }) { device ->
            DeviceCard(device, onClick = { onClick(device.id) })
        }
    }
}

/** The status facet row: "Tất cả" + the five `DeviceStatus` labels. */
private val statusOptions: List<FilterOption> =
    listOf(FilterOption(ALL_STATUSES, "Tất cả")) +
        DeviceStatus.entries.map { FilterOption(it.name, it.label) }

internal const val ALL_STATUSES = "ALL"

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
                if (device.brand != null || device.attachmentCount > 0) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        if (device.brand != null) {
                            Text(
                                device.brand + (device.model?.let { " • $it" } ?: ""),
                                style = MaterialTheme.typography.bodyMedium,
                                color = cs.onSurfaceVariant,
                            )
                        }
                        if (device.attachmentCount > 0) {
                            Spacer(Modifier.width(8.dp))
                            Icon(
                                Icons.Filled.AttachFile, "Tệp đính kèm",
                                tint = cs.onSurfaceVariant,
                                modifier = Modifier.size(14.dp),
                            )
                            Text(
                                "${device.attachmentCount}",
                                style = MaterialTheme.typography.labelSmall,
                                color = cs.onSurfaceVariant,
                            )
                        }
                    }
                }
                // Warranty state of the device (max endDate across its
                // warranties) — the web table's "Bảo hành" column.
                Spacer(Modifier.height(6.dp))
                WarrantyPill(warrantyState(device.effectiveWarrantyEnd))
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
