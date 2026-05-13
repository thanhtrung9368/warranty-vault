package com.warrantyvault.app.ui.screens.subscriptions

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
import androidx.compose.material.icons.filled.Autorenew
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Payments
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
import com.warrantyvault.app.network.Payment
import com.warrantyvault.app.network.PaymentInput
import com.warrantyvault.app.network.Subscription
import com.warrantyvault.app.network.toUserMessage
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

class SubscriptionDetailViewModel(
    private val api: ApiService,
    private val subscriptionId: String,
) : ViewModel() {
    sealed interface State {
        data object Loading : State
        data class Loaded(val subscription: Subscription) : State
        data class Error(val message: String) : State
    }

    private val _state = MutableStateFlow<State>(State.Loading)
    val state: StateFlow<State> = _state.asStateFlow()

    fun load() {
        viewModelScope.launch {
            _state.value = State.Loading
            try {
                val res = api.getSubscription(subscriptionId)
                _state.value = State.Loaded(res.subscription)
            } catch (e: Exception) {
                _state.value = State.Error(e.toUserMessage(ApiClient.json))
            }
        }
    }

    fun replace(sub: Subscription) {
        _state.value = State.Loaded(sub)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SubscriptionDetailScreen(
    api: ApiService,
    subscriptionId: String,
    onBack: () -> Unit,
) {
    val vm = remember(subscriptionId) {
        SubscriptionDetailViewModel(api, subscriptionId)
    }
    val state by vm.state.collectAsState()
    val scope = rememberCoroutineScope()

    var showLogPayment by rememberSaveable { mutableStateOf(false) }
    var showRenewConfirm by rememberSaveable { mutableStateOf(false) }
    var showEdit by rememberSaveable { mutableStateOf(false) }
    var actionError by remember { mutableStateOf<String?>(null) }
    var actionLoading by remember { mutableStateOf(false) }

    LaunchedEffect(subscriptionId) { vm.load() }

    val loaded = (state as? SubscriptionDetailViewModel.State.Loaded)?.subscription

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
                is SubscriptionDetailViewModel.State.Loading ->
                    CenterBox { CircularProgressIndicator() }
                is SubscriptionDetailViewModel.State.Error -> CenterBox {
                    Icon(Icons.Outlined.WarningAmber, null,
                        tint = MaterialTheme.colorScheme.error,
                        modifier = Modifier.size(40.dp))
                    Spacer(Modifier.height(8.dp))
                    Text(s.message, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Spacer(Modifier.height(12.dp))
                    Button(onClick = { vm.load() }) { Text("Thử lại") }
                }
                is SubscriptionDetailViewModel.State.Loaded -> Body(
                    sub = s.subscription,
                    actionError = actionError,
                    actionLoading = actionLoading,
                    onClearError = { actionError = null },
                    onLogPayment = { showLogPayment = true },
                    onRenew = { showRenewConfirm = true },
                )
            }
        }
    }

    if (showLogPayment && loaded != null) {
        LogPaymentSheet(
            defaultAmount = loaded.price,
            onDismiss = { showLogPayment = false },
            onConfirm = { input ->
                scope.launch {
                    actionLoading = true
                    actionError = null
                    try {
                        api.logSubscriptionPayment(loaded.id, input)
                        vm.load()
                        showLogPayment = false
                    } catch (e: Exception) {
                        actionError = e.toUserMessage(ApiClient.json)
                    } finally {
                        actionLoading = false
                    }
                }
            },
        )
    }

    if (showRenewConfirm && loaded != null) {
        AlertDialog(
            onDismissRequest = { showRenewConfirm = false },
            title = { Text("Gia hạn ngay?") },
            text = { Text("Tạo bản ghi thanh toán và đẩy ngày gia hạn kế tiếp.") },
            confirmButton = {
                TextButton(onClick = {
                    showRenewConfirm = false
                    scope.launch {
                        actionLoading = true
                        actionError = null
                        try {
                            api.renewSubscription(loaded.id)
                            vm.load()
                        } catch (e: Exception) {
                            actionError = e.toUserMessage(ApiClient.json)
                        } finally {
                            actionLoading = false
                        }
                    }
                }) { Text("Gia hạn") }
            },
            dismissButton = {
                TextButton(onClick = { showRenewConfirm = false }) { Text("Huỷ") }
            },
        )
    }

    if (showEdit && loaded != null) {
        SubscriptionEditSheet(
            api = api,
            existing = loaded,
            onDismiss = { showEdit = false },
            onSaved = { sub ->
                vm.replace(sub)
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
    sub: Subscription,
    actionError: String?,
    actionLoading: Boolean,
    onClearError: () -> Unit,
    onLogPayment: () -> Unit,
    onRenew: () -> Unit,
) {
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item { SummaryCard(sub) }

        if (actionError != null) {
            item { ErrorBanner(actionError, onClearError) }
        }

        item {
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                OutlinedButton(
                    onClick = onLogPayment,
                    enabled = !actionLoading,
                    modifier = Modifier.weight(1f),
                ) {
                    Icon(Icons.Filled.Payments, null)
                    Spacer(Modifier.width(6.dp))
                    Text("Ghi thanh toán")
                }
                OutlinedButton(
                    onClick = onRenew,
                    enabled = !actionLoading,
                    modifier = Modifier.weight(1f),
                ) {
                    Icon(Icons.Filled.Autorenew, null)
                    Spacer(Modifier.width(6.dp))
                    Text("Gia hạn ngay")
                }
            }
        }

        item {
            Text(
                "Lịch sử thanh toán (${sub.payments.size})",
                fontSize = 16.sp, fontWeight = FontWeight.SemiBold,
            )
        }

        if (sub.payments.isEmpty()) {
            item {
                Card(
                    colors = CardDefaults.cardColors(
                        containerColor = MaterialTheme.colorScheme.surface,
                    ),
                    elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
                    shape = RoundedCornerShape(20.dp),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Column(
                        Modifier.padding(16.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        Text("Chưa có thanh toán nào", fontWeight = FontWeight.SemiBold)
                        Spacer(Modifier.height(4.dp))
                        Text(
                            "Bấm \"Ghi thanh toán\" để thêm bản ghi đầu tiên.",
                            fontSize = 13.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
        } else {
            items(sub.payments, key = { it.id }) { p -> PaymentRow(p) }
        }
    }
}

@Composable
private fun SummaryCard(sub: Subscription) {
    val cs = MaterialTheme.colorScheme
    Card(
        colors = CardDefaults.cardColors(containerColor = cs.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
        shape = RoundedCornerShape(20.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(16.dp)) {
            Text(
                sub.name, fontSize = 18.sp,
                fontWeight = FontWeight.SemiBold, color = cs.onSurface,
            )
            val sub2 = listOfNotNull(sub.brand, sub.plan).joinToString(" • ")
            if (sub2.isNotEmpty()) {
                Text(sub2, fontSize = 13.sp, color = cs.onSurfaceVariant)
            }
            Spacer(Modifier.height(8.dp))
            DetailRow("Trạng thái", sub.status.label)
            DetailRow("Chu kỳ", sub.billingCycle.label)
            DetailRow("Giá", formatPriceCycle(sub.price, sub.billingCycle))
            DetailRow("Bắt đầu", sub.startedAt.take(10))
            sub.renewalDate?.let { DetailRow("Gia hạn", it.take(10)) }
            DetailRow("Auto-renew", if (sub.autoRenew) "Có" else "Không")
            if (!sub.accountEmail.isNullOrBlank()) {
                DetailRow("Tài khoản", sub.accountEmail)
            }
            if (!sub.paymentMethod.isNullOrBlank()) {
                DetailRow("Thanh toán", sub.paymentMethod)
            }
            if (!sub.notes.isNullOrBlank()) {
                Spacer(Modifier.height(4.dp))
                Text(sub.notes, fontSize = 13.sp, color = cs.onSurfaceVariant)
            }
        }
    }
}

@Composable
private fun PaymentRow(p: Payment) {
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
                    formatVnd(p.amount),
                    fontWeight = FontWeight.SemiBold,
                    fontSize = 15.sp,
                    color = cs.onSurface,
                    modifier = Modifier.weight(1f),
                )
                Text(
                    p.paidAt.take(10),
                    fontSize = 12.sp,
                    color = cs.onSurfaceVariant,
                )
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
private fun LogPaymentSheet(
    defaultAmount: Int,
    onDismiss: () -> Unit,
    onConfirm: (PaymentInput) -> Unit,
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val today = remember {
        SimpleDateFormat("yyyy-MM-dd", Locale.US)
            .apply { timeZone = TimeZone.getTimeZone("UTC") }
            .format(Date())
    }
    var amount by remember {
        mutableStateOf(defaultAmount.takeIf { it > 0 }?.toString() ?: "")
    }
    var paidAt by remember { mutableStateOf(today) }
    var note by remember { mutableStateOf("") }

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheetState) {
        Column(
            Modifier
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text("Ghi nhận thanh toán",
                fontSize = 18.sp, fontWeight = FontWeight.SemiBold)
            OutlinedTextField(
                value = amount,
                onValueChange = { amount = it.filter { c -> c.isDigit() } },
                label = { Text("Số tiền (VND) *") },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
                value = paidAt, onValueChange = { paidAt = it },
                label = { Text("Ngày thanh toán (YYYY-MM-DD) *") },
                modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
                value = note, onValueChange = { note = it },
                label = { Text("Ghi chú") },
                modifier = Modifier.fillMaxWidth(),
            )
            Button(
                onClick = {
                    val amt = amount.toIntOrNull() ?: 0
                    if (amt > 0 && paidAt.isNotBlank()) {
                        onConfirm(PaymentInput(
                            amount = amt,
                            paidAt = paidAt,
                            note = note.ifBlank { null },
                        ))
                    }
                },
                enabled = (amount.toIntOrNull() ?: 0) > 0 && paidAt.isNotBlank(),
                modifier = Modifier.fillMaxWidth().height(50.dp),
            ) { Text("Lưu") }
            Spacer(Modifier.height(20.dp))
        }
    }
}
