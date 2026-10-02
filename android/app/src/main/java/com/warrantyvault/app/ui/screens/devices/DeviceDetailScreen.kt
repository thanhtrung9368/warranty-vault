package com.warrantyvault.app.ui.screens.devices

import androidx.compose.foundation.BorderStroke
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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.DeleteOutline
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.NotificationsActive
import androidx.compose.material.icons.filled.NotificationsOff
import androidx.compose.material.icons.filled.VerifiedUser
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.warrantyvault.app.network.ApiClient
import com.warrantyvault.app.network.ApiService
import com.warrantyvault.app.network.Device
import com.warrantyvault.app.network.Warranty
import com.warrantyvault.app.network.toUserMessage
import com.warrantyvault.app.ui.theme.WVAccent
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class DeviceDetailViewModel(
    private val api: ApiService,
    private val deviceId: String,
) : ViewModel() {
    sealed interface State {
        data object Loading : State
        data class Loaded(val device: Device) : State
        data class Error(val message: String) : State
    }

    private val _state = MutableStateFlow<State>(State.Loading)
    val state: StateFlow<State> = _state.asStateFlow()

    fun load() {
        viewModelScope.launch {
            _state.value = State.Loading
            try {
                val res = api.getDevice(deviceId)
                _state.value = State.Loaded(res.device)
            } catch (e: Exception) {
                _state.value = State.Error(e.toUserMessage(ApiClient.json))
            }
        }
    }

    /**
     * Applies a locally-edited device without refetching.
     *
     * `PATCH /api/v1/devices/{id}` answers with a bare `store.Device` row — no
     * `warranties`, no `attachments`, no `effectiveWarrantyEnd`. Assigning that
     * straight into the Loaded state used to blank the whole "Bảo hành" and
     * "Hoá đơn" sections of the detail screen until the user pulled to refresh,
     * so anything the response omits is carried over from what we already have.
     */
    fun replaceDevice(device: Device) {
        val current = (_state.value as? State.Loaded)?.device
        _state.value = State.Loaded(
            device.copy(
                warranties = device.warranties.ifEmpty { current?.warranties ?: emptyList() },
                effectiveWarrantyEnd = device.effectiveWarrantyEnd
                    ?: current?.effectiveWarrantyEnd,
                attachmentCount = if (device.attachmentCount != 0) {
                    device.attachmentCount
                } else {
                    current?.attachmentCount ?: 0
                },
            ),
        )
    }

    /**
     * `DELETE /api/v1/devices/{id}` — cascades to the device's warranties,
     * reminders and attachments server-side. Was reachable from the web
     * (`delete-device-button.tsx`) but had no Android entry point at all.
     */
    fun delete(onDeleted: () -> Unit, onError: (String) -> Unit) {
        viewModelScope.launch {
            try {
                api.deleteDevice(deviceId)
                onDeleted()
            } catch (e: Exception) {
                onError(e.toUserMessage(ApiClient.json))
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DeviceDetailScreen(
    api: ApiService,
    deviceId: String,
    onBack: () -> Unit,
) {
    val vm = remember(deviceId) { DeviceDetailViewModel(api, deviceId) }
    val state by vm.state.collectAsState()
    val scope = rememberCoroutineScope()

    var refreshing by remember { mutableStateOf(false) }
    var showAddSheet by rememberSaveable { mutableStateOf(false) }
    var showEditDevice by rememberSaveable { mutableStateOf(false) }
    var editingWarrantyId by rememberSaveable { mutableStateOf<String?>(null) }
    var deletingWarrantyId by rememberSaveable { mutableStateOf<String?>(null) }
    var showDeleteDevice by rememberSaveable { mutableStateOf(false) }
    var deletingDevice by remember { mutableStateOf(false) }
    var actionError by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(deviceId) { vm.load() }

    val deviceLoaded = (state as? DeviceDetailViewModel.State.Loaded)?.device

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(deviceLoaded?.name ?: "Chi tiết") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, "Quay lại")
                    }
                },
                actions = {
                    if (deviceLoaded != null) {
                        IconButton(onClick = { showEditDevice = true }) {
                            Icon(Icons.Filled.Edit, "Sửa thiết bị")
                        }
                        IconButton(onClick = { showDeleteDevice = true }) {
                            Icon(
                                Icons.Filled.DeleteOutline, "Xoá thiết bị",
                                tint = MaterialTheme.colorScheme.error,
                            )
                        }
                    }
                },
            )
        },
        floatingActionButton = {
            if (deviceLoaded != null) {
                FloatingActionButton(
                    onClick = { showAddSheet = true },
                    containerColor = MaterialTheme.colorScheme.primary,
                ) {
                    Icon(Icons.Filled.Add, "Thêm bảo hành",
                        tint = MaterialTheme.colorScheme.onPrimary)
                }
            }
        },
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
            when (val s = state) {
                is DeviceDetailViewModel.State.Loading -> CenterBox { CircularProgressIndicator() }
                is DeviceDetailViewModel.State.Error -> CenterBox {
                    Icon(Icons.Outlined.WarningAmber, null,
                        tint = MaterialTheme.colorScheme.error,
                        modifier = Modifier.size(40.dp))
                    Spacer(Modifier.height(8.dp))
                    Text(s.message, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Spacer(Modifier.height(12.dp))
                    Button(onClick = { vm.load() }) { Text("Thử lại") }
                }
                is DeviceDetailViewModel.State.Loaded -> {
                    DeviceDetailBody(
                        api = api,
                        device = s.device,
                        actionError = actionError,
                        onClearError = { actionError = null },
                        onEdit = { editingWarrantyId = it.id },
                        onDelete = { deletingWarrantyId = it.id },
                        onToggleReminder = { warranty ->
                            scope.launch {
                                actionError = null
                                try {
                                    if (warranty.isDismissed) {
                                        api.restoreWarrantyReminder(warranty.id)
                                    } else {
                                        api.dismissWarrantyReminder(warranty.id)
                                    }
                                    vm.load()
                                } catch (e: Exception) {
                                    actionError = e.toUserMessage(ApiClient.json)
                                }
                            }
                        },
                    )
                }
            }
        }
    }

    if (showAddSheet && deviceLoaded != null) {
        WarrantyEditSheet(
            api = api,
            deviceId = deviceLoaded.id,
            existing = null,
            onDismiss = { showAddSheet = false },
            onSaved = {
                showAddSheet = false
                vm.load()
            },
        )
    }

    if (showEditDevice && deviceLoaded != null) {
        AddDeviceSheet(
            api = api,
            existing = deviceLoaded,
            onDismiss = { showEditDevice = false },
            onCreated = { updated ->
                showEditDevice = false
                vm.replaceDevice(updated)
            },
        )
    }

    val editing = editingWarrantyId?.let { id ->
        deviceLoaded?.warranties?.firstOrNull { it.id == id }
    }
    if (editing != null && deviceLoaded != null) {
        WarrantyEditSheet(
            api = api,
            deviceId = deviceLoaded.id,
            existing = editing,
            onDismiss = { editingWarrantyId = null },
            onSaved = {
                editingWarrantyId = null
                vm.load()
            },
        )
    }

    val deleting = deletingWarrantyId?.let { id ->
        deviceLoaded?.warranties?.firstOrNull { it.id == id }
    }
    if (deleting != null) {
        AlertDialog(
            onDismissRequest = { deletingWarrantyId = null },
            title = { Text("Xoá gói bảo hành?") },
            text = {
                Text("Hành động này không thể hoàn tác. Gói \"${deleting.type.label}\" sẽ bị xoá khỏi thiết bị.")
            },
            confirmButton = {
                TextButton(onClick = {
                    val id = deleting.id
                    deletingWarrantyId = null
                    scope.launch {
                        try {
                            api.deleteWarranty(id)
                            vm.load()
                        } catch (e: Exception) {
                            actionError = e.toUserMessage(ApiClient.json)
                        }
                    }
                }) { Text("Xoá", color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = {
                TextButton(onClick = { deletingWarrantyId = null }) { Text("Huỷ") }
            },
        )
    }

    // Delete the whole device (web: DeleteDeviceButton). Cascades server-side.
    if (showDeleteDevice && deviceLoaded != null) {
        AlertDialog(
            onDismissRequest = { if (!deletingDevice) showDeleteDevice = false },
            title = { Text("Xóa thiết bị?") },
            text = {
                Text(
                    "Hành động này sẽ xóa vĩnh viễn \"${deviceLoaded.name}\" cùng toàn bộ " +
                        "file đính kèm và nhắc nhở. Không thể khôi phục.",
                )
            },
            confirmButton = {
                TextButton(
                    enabled = !deletingDevice,
                    onClick = {
                        deletingDevice = true
                        actionError = null
                        vm.delete(
                            onDeleted = {
                                deletingDevice = false
                                showDeleteDevice = false
                                onBack()
                            },
                            onError = {
                                deletingDevice = false
                                showDeleteDevice = false
                                actionError = it
                            },
                        )
                    },
                ) { Text(if (deletingDevice) "Đang xoá…" else "Xoá", color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = {
                TextButton(enabled = !deletingDevice, onClick = { showDeleteDevice = false }) {
                    Text("Huỷ")
                }
            },
        )
    }
}

@Composable
private fun DeviceDetailBody(
    api: ApiService,
    device: Device,
    actionError: String?,
    onClearError: () -> Unit,
    onEdit: (Warranty) -> Unit,
    onDelete: (Warranty) -> Unit,
    onToggleReminder: (Warranty) -> Unit,
) {
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item { DeviceSummaryCard(device) }
        item {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Filled.VerifiedUser, null,
                    tint = MaterialTheme.colorScheme.primary)
                Spacer(Modifier.width(8.dp))
                Text("Bảo hành",
                    fontSize = 16.sp,
                    fontWeight = FontWeight.SemiBold)
                Spacer(Modifier.weight(1f))
                Text("${device.warranties.size}/5",
                    fontSize = 12.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        if (actionError != null) {
            item {
                Card(
                    colors = CardDefaults.cardColors(
                        containerColor = MaterialTheme.colorScheme.errorContainer,
                    ),
                    elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
                    shape = RoundedCornerShape(16.dp),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Row(
                        Modifier.padding(12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(Icons.Outlined.WarningAmber, null,
                            tint = MaterialTheme.colorScheme.onErrorContainer)
                        Spacer(Modifier.width(8.dp))
                        Text(actionError,
                            color = MaterialTheme.colorScheme.onErrorContainer,
                            fontSize = 13.sp,
                            modifier = Modifier.weight(1f))
                        TextButton(onClick = onClearError) { Text("Đóng") }
                    }
                }
            }
        }
        if (device.warranties.isEmpty()) {
            item {
                Card(
                    colors = CardDefaults.cardColors(
                        containerColor = MaterialTheme.colorScheme.surfaceContainerHighest,
                    ),
                    elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
                    shape = RoundedCornerShape(20.dp),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Column(
                        Modifier.padding(20.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        Text("Chưa có gói bảo hành nào",
                            style = MaterialTheme.typography.titleSmall,
                            fontWeight = FontWeight.SemiBold)
                        Spacer(Modifier.height(4.dp))
                        Text("Bấm nút + để thêm gói đầu tiên.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
        } else {
            items(device.warranties, key = { it.id }) { warranty ->
                WarrantyCard(
                    warranty = warranty,
                    onEdit = { onEdit(warranty) },
                    onDelete = { onDelete(warranty) },
                    onToggleReminder = { onToggleReminder(warranty) },
                )
            }
        }
        item { Spacer(Modifier.height(12.dp)) }
        item { AttachmentsSection(api = api, deviceId = device.id) }
    }
}

@Composable
private fun DeviceSummaryCard(device: Device) {
    val cs = MaterialTheme.colorScheme
    Card(
        colors = CardDefaults.cardColors(containerColor = cs.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
        shape = RoundedCornerShape(20.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(20.dp)) {
            Text(device.name,
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.Bold,
                color = cs.onSurface)
            val sub = listOfNotNull(device.brand, device.model).joinToString(" • ")
            if (sub.isNotBlank()) {
                Text(sub, fontSize = 13.sp, color = cs.onSurfaceVariant)
            }
            Spacer(Modifier.height(8.dp))
            DetailRow("Trạng thái", device.status.label)
            DetailRow("Mua ngày", device.purchaseDate.take(10))
            if (device.purchasePrice > 0) {
                DetailRow("Giá", formatVnd(device.purchasePrice))
            }
            if (!device.purchasePlace.isNullOrBlank()) {
                DetailRow("Nơi mua", device.purchasePlace)
            }
            if (!device.serialNumber.isNullOrBlank()) {
                DetailRow("Số serial", device.serialNumber)
            }
            // Resale (roadmap #12) — only when a sale is actually recorded.
            // `soldAt` is a naive-UTC timestamp like `purchaseDate`, so only the
            // date half is shown (see DeviceResale.kt). Labels mirror the web
            // detail page's "Bán lại" card.
            if (hasSaleRecord(device.soldAt, device.soldPrice)) {
                Spacer(Modifier.height(8.dp))
                Text("Bán lại",
                    fontSize = 13.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = cs.onSurface)
                val soldDate = soldDateInput(device.soldAt)
                if (soldDate.isNotBlank()) {
                    DetailRow("Ngày bán", soldDate)
                }
                val soldPrice = device.soldPrice
                if (soldPrice != null) {
                    DetailRow("Giá bán", formatVnd(soldPrice))
                    saleProfit(soldPrice, device.purchasePrice)?.let { profit ->
                        DetailRow(
                            "Lãi/lỗ",
                            saleProfitLabel(profit),
                            valueColor = when {
                                profit > 0 -> WVAccent.current.success
                                profit < 0 -> cs.error
                                else -> cs.onSurface
                            },
                        )
                    }
                }
            }
            if (!device.notes.isNullOrBlank()) {
                Spacer(Modifier.height(4.dp))
                Text(device.notes, fontSize = 13.sp, color = cs.onSurfaceVariant)
            }
        }
    }
}

@Composable
private fun DetailRow(label: String, value: String, valueColor: Color? = null) {
    Row(Modifier.fillMaxWidth().padding(vertical = 2.dp)) {
        Text(label,
            fontSize = 13.sp,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.width(100.dp))
        Text(value,
            fontSize = 13.sp,
            color = valueColor ?: MaterialTheme.colorScheme.onSurface)
    }
}

@Composable
private fun WarrantyCard(
    warranty: Warranty,
    onEdit: () -> Unit,
    onDelete: () -> Unit,
    onToggleReminder: () -> Unit,
) {
    val cs = MaterialTheme.colorScheme
    Card(
        colors = CardDefaults.cardColors(containerColor = cs.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
        shape = RoundedCornerShape(20.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                TypeChip(warranty.type.label)
                Spacer(Modifier.width(8.dp))
                if (warranty.isDismissed) {
                    Box(
                        Modifier
                            .clip(RoundedCornerShape(50))
                            .background(cs.onSurfaceVariant.copy(alpha = 0.15f))
                            .padding(horizontal = 8.dp, vertical = 3.dp),
                    ) {
                        Text("Đã tắt nhắc",
                            fontSize = 11.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = cs.onSurfaceVariant)
                    }
                }
                Spacer(Modifier.weight(1f))
                IconButton(onClick = onEdit) {
                    Icon(Icons.Filled.Edit, "Sửa", tint = cs.onSurfaceVariant)
                }
                IconButton(onClick = onDelete) {
                    Icon(Icons.Filled.Delete, "Xoá", tint = cs.error)
                }
            }
            if (!warranty.provider.isNullOrBlank()) {
                Text(warranty.provider,
                    fontSize = 14.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = cs.onSurface)
            }
            Spacer(Modifier.height(6.dp))
            DetailRow("Bắt đầu", warranty.startDate.take(10))
            DetailRow("Kết thúc", warranty.endDate.take(10))
            DetailRow("Số tháng", "${warranty.months} tháng")
            warranty.cost?.let { if (it > 0) DetailRow("Chi phí", formatVnd(it)) }
            if (!warranty.address.isNullOrBlank()) {
                DetailRow("Địa chỉ", warranty.address)
            }
            if (!warranty.phone.isNullOrBlank()) {
                DetailRow("Điện thoại", warranty.phone)
            }
            if (!warranty.notes.isNullOrBlank()) {
                Spacer(Modifier.height(4.dp))
                Text(warranty.notes,
                    fontSize = 13.sp,
                    color = cs.onSurfaceVariant,
                    textDecoration = TextDecoration.None)
            }
            Spacer(Modifier.height(8.dp))
            Row {
                TextButton(onClick = onToggleReminder) {
                    if (warranty.isDismissed) {
                        Icon(Icons.Filled.NotificationsActive, null)
                        Spacer(Modifier.width(6.dp))
                        Text("Bật lại nhắc")
                    } else {
                        Icon(Icons.Filled.NotificationsOff, null)
                        Spacer(Modifier.width(6.dp))
                        Text("Tắt nhắc")
                    }
                }
            }
        }
    }
}

@Composable
private fun TypeChip(label: String) {
    val cs = MaterialTheme.colorScheme
    Box(
        Modifier
            .clip(RoundedCornerShape(50))
            .background(cs.primary.copy(alpha = 0.15f))
            .padding(horizontal = 10.dp, vertical = 4.dp),
    ) {
        Text(label,
            fontSize = 11.sp,
            fontWeight = FontWeight.SemiBold,
            color = cs.primary)
    }
}

@Composable
private fun CenterBox(content: @Composable androidx.compose.foundation.layout.ColumnScope.() -> Unit) {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) { content() }
    }
}

internal fun todayUtcIso(): String {
    val fmt = SimpleDateFormat("yyyy-MM-dd", Locale.US)
    fmt.timeZone = java.util.TimeZone.getTimeZone("UTC")
    return fmt.format(Date())
}
