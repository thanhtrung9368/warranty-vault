package com.warrantyvault.app.ui.screens.wishlist

import androidx.compose.foundation.BorderStroke
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.AddShoppingCart
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.PriceChange
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
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.rememberModalBottomSheetState
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.warrantyvault.app.network.ApiClient
import com.warrantyvault.app.network.ApiService
import com.warrantyvault.app.network.PriceLogInput
import com.warrantyvault.app.network.WishlistInput
import com.warrantyvault.app.network.WishlistItem
import com.warrantyvault.app.network.WishlistPrice
import com.warrantyvault.app.network.WishlistStatus
import com.warrantyvault.app.network.toUserMessage
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

class WishlistDetailViewModel(
    private val api: ApiService,
    private val itemId: String,
) : ViewModel() {
    sealed interface State {
        data object Loading : State
        data class Loaded(val item: WishlistItem, val prices: List<WishlistPrice>) : State
        data class Error(val message: String) : State
    }

    private val _state = MutableStateFlow<State>(State.Loading)
    val state: StateFlow<State> = _state.asStateFlow()

    fun load() {
        viewModelScope.launch {
            _state.value = State.Loading
            try {
                val res = api.getWishlistItem(itemId)
                _state.value = State.Loaded(res.item, res.prices)
            } catch (e: Exception) {
                _state.value = State.Error(e.toUserMessage(ApiClient.json))
            }
        }
    }

    fun replace(item: WishlistItem, prices: List<WishlistPrice>? = null) {
        val current = _state.value
        val keepPrices = prices ?: (current as? State.Loaded)?.prices ?: emptyList()
        _state.value = State.Loaded(item, keepPrices)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WishlistDetailScreen(
    api: ApiService,
    itemId: String,
    onBack: () -> Unit,
) {
    val vm = remember(itemId) { WishlistDetailViewModel(api, itemId) }
    val state by vm.state.collectAsState()
    val scope = rememberCoroutineScope()

    var showLogPrice by rememberSaveable { mutableStateOf(false) }
    var showPurchaseConfirm by rememberSaveable { mutableStateOf(false) }
    var showEdit by rememberSaveable { mutableStateOf(false) }
    var actionError by remember { mutableStateOf<String?>(null) }
    var actionLoading by remember { mutableStateOf(false) }

    LaunchedEffect(itemId) { vm.load() }

    val loadedState = state as? WishlistDetailViewModel.State.Loaded
    val loaded = loadedState?.item

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(loaded?.name ?: "Chi tiết") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, "Quay lại")
                    }
                },
                actions = {
                    if (loaded != null) {
                        IconButton(onClick = { showEdit = true }) {
                            Icon(Icons.Filled.Edit, "Sửa")
                        }
                    }
                },
            )
        },
    ) { padding ->
        Box(Modifier.padding(padding).fillMaxSize()) {
            when (val s = state) {
                is WishlistDetailViewModel.State.Loading ->
                    CenterBox { CircularProgressIndicator() }
                is WishlistDetailViewModel.State.Error -> CenterBox {
                    Icon(Icons.Outlined.WarningAmber, null,
                        tint = MaterialTheme.colorScheme.error,
                        modifier = Modifier.size(40.dp))
                    Spacer(Modifier.height(8.dp))
                    Text(s.message, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Spacer(Modifier.height(12.dp))
                    Button(onClick = { vm.load() }) { Text("Thử lại") }
                }
                is WishlistDetailViewModel.State.Loaded -> Body(
                    item = s.item,
                    prices = s.prices,
                    actionError = actionError,
                    actionLoading = actionLoading,
                    onClearError = { actionError = null },
                    onLogPrice = { showLogPrice = true },
                    onMarkPurchased = { showPurchaseConfirm = true },
                )
            }
        }
    }

    if (showLogPrice && loaded != null) {
        LogPriceSheet(
            defaultPrice = loaded.currentPrice ?: loaded.initialPrice ?: 0,
            onDismiss = { showLogPrice = false },
            onConfirm = { input ->
                scope.launch {
                    actionLoading = true
                    actionError = null
                    try {
                        api.logWishlistPrice(loaded.id, input)
                        vm.load()
                        showLogPrice = false
                    } catch (e: Exception) {
                        actionError = e.toUserMessage(ApiClient.json)
                    } finally {
                        actionLoading = false
                    }
                }
            },
        )
    }

    if (showPurchaseConfirm && loaded != null) {
        AlertDialog(
            onDismissRequest = { showPurchaseConfirm = false },
            title = { Text("Đánh dấu đã mua?") },
            text = { Text("Mục sẽ chuyển sang trạng thái Đã mua.") },
            confirmButton = {
                TextButton(onClick = {
                    showPurchaseConfirm = false
                    scope.launch {
                        actionLoading = true
                        actionError = null
                        try {
                            val res = api.updateWishlistItem(
                                loaded.id,
                                WishlistInput(
                                    name = loaded.name,
                                    category = loaded.category,
                                    brand = loaded.brand,
                                    initialPrice = loaded.initialPrice,
                                    currentPrice = loaded.currentPrice,
                                    buyUrl = loaded.buyUrl,
                                    imageUrl = loaded.imageUrl,
                                    targetDate = loaded.targetDate?.take(10),
                                    priority = loaded.priority,
                                    status = WishlistStatus.PURCHASED,
                                    notes = loaded.notes,
                                    reminderIntervalDays = loaded.reminderIntervalDays,
                                ),
                            )
                            vm.replace(res.item)
                        } catch (e: Exception) {
                            actionError = e.toUserMessage(ApiClient.json)
                        } finally {
                            actionLoading = false
                        }
                    }
                }) { Text("Xác nhận") }
            },
            dismissButton = {
                TextButton(onClick = { showPurchaseConfirm = false }) { Text("Huỷ") }
            },
        )
    }

    if (showEdit && loaded != null) {
        WishlistEditSheet(
            api = api,
            existing = loaded,
            onDismiss = { showEdit = false },
            onSaved = { item ->
                vm.replace(item)
                showEdit = false
            },
            onDeleted = {
                showEdit = false
                onBack()
            },
        )
    }
}

@Composable
private fun Body(
    item: WishlistItem,
    prices: List<WishlistPrice>,
    actionError: String?,
    actionLoading: Boolean,
    onClearError: () -> Unit,
    onLogPrice: () -> Unit,
    onMarkPurchased: () -> Unit,
) {
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item { SummaryCard(item) }

        if (actionError != null) {
            item { ErrorBanner(actionError, onClearError) }
        }

        item {
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                OutlinedButton(
                    onClick = onLogPrice,
                    enabled = !actionLoading,
                    modifier = Modifier.weight(1f),
                ) {
                    Icon(Icons.Filled.PriceChange, null)
                    Spacer(Modifier.width(6.dp))
                    Text("Ghi giá mới")
                }
                if (item.status != WishlistStatus.PURCHASED) {
                    OutlinedButton(
                        onClick = onMarkPurchased,
                        enabled = !actionLoading,
                        modifier = Modifier.weight(1f),
                    ) {
                        Icon(Icons.Filled.AddShoppingCart, null)
                        Spacer(Modifier.width(6.dp))
                        Text("Đã mua")
                    }
                }
            }
        }

        if (prices.isNotEmpty()) {
            item {
                Text(
                    "Lịch sử giá (${prices.size})",
                    fontSize = 16.sp, fontWeight = FontWeight.SemiBold,
                )
            }
            items(prices, key = { it.id }) { p -> PriceRow(p) }
        }
    }
}

@Composable
private fun SummaryCard(item: WishlistItem) {
    val cs = MaterialTheme.colorScheme
    Card(
        colors = CardDefaults.cardColors(containerColor = cs.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
        shape = RoundedCornerShape(20.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(16.dp)) {
            Text(
                item.name, fontSize = 18.sp,
                fontWeight = FontWeight.SemiBold, color = cs.onSurface,
            )
            if (!item.brand.isNullOrBlank()) {
                Text(item.brand, fontSize = 13.sp, color = cs.onSurfaceVariant)
            }
            Spacer(Modifier.height(8.dp))
            DetailRow("Trạng thái", item.status.label)
            DetailRow("Ưu tiên", item.priority.label)
            item.initialPrice?.let { DetailRow("Giá ban đầu", formatVnd(it)) }
            item.currentPrice?.let { DetailRow("Giá hiện tại", formatVnd(it)) }
            item.targetDate?.let { DetailRow("Dự định mua", it.take(10)) }
            item.reminderIntervalDays?.let { DetailRow("Nhắc lại", "$it ngày") }
            if (!item.buyUrl.isNullOrBlank()) {
                DetailRow("URL mua", item.buyUrl)
            }
            if (!item.notes.isNullOrBlank()) {
                Spacer(Modifier.height(4.dp))
                Text(item.notes, fontSize = 13.sp, color = cs.onSurfaceVariant)
            }
        }
    }
}

@Composable
private fun PriceRow(p: WishlistPrice) {
    val cs = MaterialTheme.colorScheme
    Card(
        colors = CardDefaults.cardColors(containerColor = cs.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
        shape = RoundedCornerShape(20.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    formatVnd(p.price),
                    fontWeight = FontWeight.SemiBold,
                    fontSize = 15.sp,
                    color = cs.onSurface,
                    modifier = Modifier.weight(1f),
                )
                (p.createdAt ?: p.recordedAt)?.take(10)?.let {
                    Text(it, fontSize = 12.sp, color = cs.onSurfaceVariant)
                }
            }
            if (!p.note.isNullOrBlank()) {
                Spacer(Modifier.height(4.dp))
                Text(p.note, fontSize = 13.sp, color = cs.onSurfaceVariant)
            }
        }
    }
}

@Composable
private fun DetailRow(label: String, value: String) {
    Row(Modifier.fillMaxWidth().padding(vertical = 2.dp)) {
        Text(
            label, fontSize = 13.sp,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.width(110.dp),
        )
        Text(value, fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurface)
    }
}

@Composable
private fun ErrorBanner(message: String, onClose: () -> Unit) {
    Card(
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.errorContainer,
        ),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(
            Modifier.padding(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(Icons.Outlined.WarningAmber, null,
                tint = MaterialTheme.colorScheme.onErrorContainer)
            Spacer(Modifier.width(8.dp))
            Text(
                message,
                color = MaterialTheme.colorScheme.onErrorContainer,
                fontSize = 13.sp, modifier = Modifier.weight(1f),
            )
            TextButton(onClick = onClose) { Text("Đóng") }
        }
    }
}

@Composable
private fun CenterBox(content: @Composable androidx.compose.foundation.layout.ColumnScope.() -> Unit) {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) { content() }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun LogPriceSheet(
    defaultPrice: Int,
    onDismiss: () -> Unit,
    onConfirm: (PriceLogInput) -> Unit,
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    var price by remember {
        mutableStateOf(defaultPrice.takeIf { it > 0 }?.toString() ?: "")
    }
    var note by remember { mutableStateOf("") }

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheetState) {
        Column(
            Modifier
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text("Ghi nhận giá mới",
                fontSize = 18.sp, fontWeight = FontWeight.SemiBold)
            OutlinedTextField(
                value = price,
                onValueChange = { price = it.filter { c -> c.isDigit() } },
                label = { Text("Giá (VND) *") },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
                value = note, onValueChange = { note = it },
                label = { Text("Ghi chú") },
                modifier = Modifier.fillMaxWidth(),
            )
            Button(
                onClick = {
                    val p = price.toIntOrNull() ?: 0
                    if (p > 0) onConfirm(PriceLogInput(p, note.ifBlank { null }))
                },
                enabled = (price.toIntOrNull() ?: 0) > 0,
                modifier = Modifier.fillMaxWidth().height(50.dp),
            ) { Text("Lưu") }
            Spacer(Modifier.height(20.dp))
        }
    }
}
