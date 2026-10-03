package com.warrantyvault.app.ui.screens.dashboard

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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowForwardIos
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Inventory2
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Shield
import androidx.compose.material.icons.filled.WarningAmber
import androidx.compose.material.icons.outlined.GppBad
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
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
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import com.warrantyvault.app.network.ApiClient
import com.warrantyvault.app.network.ApiService
import com.warrantyvault.app.network.Device
import com.warrantyvault.app.network.Subscription
import com.warrantyvault.app.network.SubscriptionStatus
import com.warrantyvault.app.network.UpcomingReminder
import com.warrantyvault.app.network.UserStats
import com.warrantyvault.app.network.WishlistItem
import com.warrantyvault.app.network.WishlistStatus
import com.warrantyvault.app.network.toUserMessage
import com.warrantyvault.app.ui.components.CategoryLabels
import com.warrantyvault.app.ui.components.ErrorState
import com.warrantyvault.app.ui.components.SectionHeader
import com.warrantyvault.app.ui.components.pressScale
import com.warrantyvault.app.ui.theme.WVAccent
import com.warrantyvault.app.ui.viewModelFactory
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.text.NumberFormat
import java.time.LocalDate
import java.time.LocalTime
import java.time.format.DateTimeParseException
import java.time.temporal.ChronoUnit
import java.util.Locale

// ============================================================
// DashboardScreen — "Tổng quan" tab (mirrors iOS DashboardView)
//
// Hero greeting + 2×2 stat grid + sắp-hết-bảo-hành preview +
// chi phí subscription card + wishlist preview. Aggregates
// stats + reminders + subscriptions + wishlist in one screen.
// Warranty rows push to device detail; sub/wishlist rows are
// display-only (no cross-tab push) — same as iOS.
// ============================================================

/** Aggregated payload for the dashboard — one parallel fetch per source. */
data class DashboardData(
    val stats: UserStats,
    val reminders: List<UpcomingReminder>,
    val subscriptions: List<Subscription>,
    val wishlist: List<WishlistItem>,
    /**
     * Needed for the warranty stat grid: `GET /v1/reminders` can only describe
     * *upcoming* expiries, so "Đã hết hạn" has to come from the device list's
     * `effectiveWarrantyEnd` (same source as the web dashboard).
     */
    val devices: List<Device> = emptyList(),
)

class DashboardViewModel(private val api: ApiService) : ViewModel() {
    sealed interface State {
        data object Loading : State
        data class Loaded(val data: DashboardData) : State
        data class Error(val message: String) : State
    }

    private val _state = MutableStateFlow<State>(State.Loading)
    val state: StateFlow<State> = _state.asStateFlow()

    fun load() {
        viewModelScope.launch {
            _state.value = State.Loading
            try {
                val data = coroutineScope {
                    val stats = async { api.getStats() }
                    val reminders = async { api.listUpcomingReminders().reminders }
                    val subs = async { api.listSubscriptions().subscriptions }
                    val wish = async { api.listWishlist().items }
                    val devices = async { api.listDevices().devices }
                    DashboardData(
                        stats = stats.await(),
                        reminders = reminders.await(),
                        subscriptions = subs.await(),
                        wishlist = wish.await(),
                        devices = devices.await(),
                    )
                }
                _state.value = State.Loaded(data)
            } catch (e: Exception) {
                _state.value = State.Error(e.toUserMessage(ApiClient.json))
            }
        }
    }
}

private enum class StatTone { Primary, Warning, Success, Danger }

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DashboardScreen(
    api: ApiService,
    userName: String,
    onOpenDevice: (String) -> Unit = {},
    onOpenSearch: () -> Unit = {},
) {
    val vm: DashboardViewModel = viewModel(
        factory = viewModelFactory { DashboardViewModel(api) },
    )
    val state by vm.state.collectAsState()
    var refreshing by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(Unit) { vm.load() }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("") },
                actions = {
                    // The landing tab is where a global search has to be
                    // reachable from — one query covers all three lists.
                    IconButton(onClick = onOpenSearch) {
                        Icon(Icons.Filled.Search, "Tìm kiếm tất cả")
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.background,
                ),
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
                label = "dashboard-state",
            ) { s ->
                when (s) {
                    is DashboardViewModel.State.Loading -> Column {
                        GreetingHeader(userName)
                        Spacer(Modifier.height(24.dp))
                        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                            CircularProgressIndicator()
                        }
                    }
                    is DashboardViewModel.State.Error -> ErrorState(
                        icon = Icons.Outlined.WarningAmber,
                        title = "Tải không được rồi",
                        body = s.message,
                        onRetry = { vm.load() },
                    )
                    is DashboardViewModel.State.Loaded -> DashboardBody(
                        userName = userName,
                        data = s.data,
                        onOpenDevice = onOpenDevice,
                    )
                }
            }
        }
    }
}

@Composable
private fun DashboardBody(
    userName: String,
    data: DashboardData,
    onOpenDevice: (String) -> Unit,
) {
    val stats = data.stats

    // Reminders within 30 days, soonest first.
    val upcoming = remember(data.reminders) {
        data.reminders
            .mapNotNull { r -> daysLeftFromIso(r.endDate)?.let { r to it } }
            .filter { it.second in 0..30 }
            .sortedBy { it.second }
    }
    // Warranty counts come from the device list (max endDate per device), not
    // from the reminders feed — see DeviceRollup for why.
    val rollup = remember(data.devices) { deviceRollup(data.devices) }
    val totalDevices = rollup.total
    val expiringSoon = rollup.soon
    val expired = rollup.expired
    val safeActive = rollup.safeActive

    val monthlyTotal = stats.subscriptions.totalMonthlyVnd.toLong()
    val activeSubs = remember(data.subscriptions) {
        data.subscriptions
            .filter { it.status == SubscriptionStatus.ACTIVE }
            .sortedBy { it.renewalDate ?: "9999" }
    }
    val upcomingSubs = activeSubs.take(3)

    val wishItems = remember(data.wishlist) {
        data.wishlist
            .filter { it.status == WishlistStatus.WATCHING || it.status == WishlistStatus.DECIDED }
            .take(3)
    }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 0.dp, bottom = 24.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item { GreetingHeader(userName) }

        // 2×2 stat grid
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                StatTile(
                    icon = Icons.Filled.Inventory2,
                    value = "$totalDevices",
                    label = "Thiết bị",
                    sub = "đang theo dõi",
                    tone = StatTone.Primary,
                    modifier = Modifier.weight(1f),
                )
                StatTile(
                    icon = Icons.Filled.Shield,
                    value = "$safeActive",
                    label = "Còn bảo hành",
                    sub = "được bảo vệ",
                    tone = StatTone.Success,
                    modifier = Modifier.weight(1f),
                )
            }
        }
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                StatTile(
                    icon = Icons.Filled.WarningAmber,
                    value = "$expiringSoon",
                    label = "Sắp hết ≤30 ngày",
                    sub = if (expiringSoon > 0) "để ý nha" else "không có",
                    tone = StatTone.Warning,
                    modifier = Modifier.weight(1f),
                )
                StatTile(
                    icon = Icons.Outlined.GppBad,
                    value = "$expired",
                    label = "Đã hết hạn",
                    sub = "hết kèo",
                    tone = StatTone.Danger,
                    modifier = Modifier.weight(1f),
                )
            }
        }

        // Upcoming warranties
        item {
            Spacer(Modifier.height(4.dp))
            SectionHeader("Sắp hết bảo hành")
        }
        if (upcoming.isEmpty()) {
            item { AllGoodCard() }
        } else {
            items(upcoming.take(4)) { (reminder, days) ->
                WarrantyPreviewRow(
                    reminder = reminder,
                    days = days,
                    onClick = { onOpenDevice(reminder.deviceId) },
                )
            }
        }

        // Subscriptions cost card
        if (activeSubs.isNotEmpty()) {
            item {
                Spacer(Modifier.height(4.dp))
                SectionHeader("Gói đăng ký")
            }
            item {
                SubsCostCard(
                    monthlyTotal = monthlyTotal,
                    activeCount = activeSubs.size,
                    upcoming = upcomingSubs,
                )
            }
        }

        // Wishlist preview
        if (wishItems.isNotEmpty()) {
            item {
                Spacer(Modifier.height(4.dp))
                SectionHeader("Đang thèm")
            }
            items(wishItems, key = { it.id }) { item ->
                WishPreviewRow(item)
            }
        }
    }
}

// MARK: - Greeting

@Composable
private fun GreetingHeader(userName: String) {
    val cs = MaterialTheme.colorScheme
    val hour = remember { LocalTime.now().hour }
    val greeting = when {
        hour < 12 -> "Chào buổi sáng,"
        hour < 18 -> "Chào buổi chiều,"
        else -> "Chào buổi tối,"
    }
    Column(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 4.dp, vertical = 12.dp),
    ) {
        Text(
            greeting,
            style = MaterialTheme.typography.bodyLarge,
            color = cs.onSurfaceVariant,
        )
        Spacer(Modifier.height(2.dp))
        Text(
            userName,
            style = MaterialTheme.typography.headlineLarge,
            fontWeight = FontWeight.Bold,
            letterSpacing = (-0.5).sp,
            color = cs.onBackground,
        )
    }
}

// MARK: - Stat tile

@Composable
private fun StatTile(
    icon: ImageVector,
    value: String,
    label: String,
    sub: String,
    tone: StatTone,
    modifier: Modifier = Modifier,
) {
    val cs = MaterialTheme.colorScheme
    val (fg, bg) = toneColors(tone)
    Card(
        colors = CardDefaults.cardColors(containerColor = bg),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
        shape = RoundedCornerShape(20.dp),
        modifier = modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(16.dp)) {
            Box(
                Modifier
                    .size(36.dp)
                    .clip(CircleShape)
                    .background(fg.copy(alpha = 0.18f)),
                contentAlignment = Alignment.Center,
            ) {
                Icon(icon, null, tint = fg, modifier = Modifier.size(20.dp))
            }
            Spacer(Modifier.height(12.dp))
            Text(
                value,
                style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.Bold,
                color = fg,
                letterSpacing = (-0.5).sp,
            )
            Spacer(Modifier.height(2.dp))
            Text(
                label,
                style = MaterialTheme.typography.bodySmall,
                fontWeight = FontWeight.SemiBold,
                color = cs.onBackground.copy(alpha = 0.85f),
            )
            Text(
                sub,
                style = MaterialTheme.typography.bodySmall,
                color = cs.onSurfaceVariant,
            )
        }
    }
}

// MARK: - Warranty preview row

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun WarrantyPreviewRow(
    reminder: UpcomingReminder,
    days: Long,
    onClick: () -> Unit,
) {
    val cs = MaterialTheme.colorScheme
    val accent = WVAccent.current
    val pillColor = when {
        days <= 3 -> cs.error
        days <= 7 -> accent.warning
        else -> cs.primary
    }
    val pillLabel = when {
        days == 0L -> "Hết hôm nay"
        days == 1L -> "Còn 1 ngày"
        else -> "Còn $days ngày"
    }
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
            Modifier.padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) {
                Text(
                    reminder.device.name,
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.SemiBold,
                    color = cs.onSurface,
                )
                if (reminder.device.category.isNotBlank()) {
                    Text(
                        CategoryLabels.label(reminder.device.category),
                        style = MaterialTheme.typography.bodySmall,
                        color = cs.onSurfaceVariant,
                    )
                }
            }
            Spacer(Modifier.width(10.dp))
            Box(
                Modifier
                    .clip(RoundedCornerShape(999.dp))
                    .background(pillColor.copy(alpha = 0.14f))
                    .padding(horizontal = 10.dp, vertical = 5.dp),
            ) {
                Text(
                    pillLabel,
                    style = MaterialTheme.typography.labelMedium,
                    fontWeight = FontWeight.SemiBold,
                    color = pillColor,
                )
            }
            Spacer(Modifier.width(8.dp))
            Icon(
                Icons.AutoMirrored.Filled.ArrowForwardIos,
                null,
                tint = cs.onSurfaceVariant.copy(alpha = 0.5f),
                modifier = Modifier.size(13.dp),
            )
        }
    }
}

@Composable
private fun AllGoodCard() {
    val cs = MaterialTheme.colorScheme
    Card(
        colors = CardDefaults.cardColors(containerColor = cs.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
        shape = RoundedCornerShape(20.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(
            Modifier.padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                Icons.Filled.CheckCircle,
                null,
                tint = WVAccent.current.success,
                modifier = Modifier.size(28.dp),
            )
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(
                    "Tất cả đều ngon",
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.SemiBold,
                    color = cs.onSurface,
                )
                Text(
                    "Không có gói nào sắp hết trong 30 ngày",
                    style = MaterialTheme.typography.bodySmall,
                    color = cs.onSurfaceVariant,
                )
            }
        }
    }
}

// MARK: - Subscriptions cost card

@Composable
private fun SubsCostCard(
    monthlyTotal: Long,
    activeCount: Int,
    upcoming: List<Subscription>,
) {
    val cs = MaterialTheme.colorScheme
    Card(
        colors = CardDefaults.cardColors(containerColor = cs.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
        shape = RoundedCornerShape(20.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.Bottom) {
                Text(
                    formatVnd(monthlyTotal),
                    style = MaterialTheme.typography.headlineMedium,
                    fontWeight = FontWeight.Bold,
                    color = cs.onSurface,
                    letterSpacing = (-0.5).sp,
                )
                Spacer(Modifier.width(6.dp))
                Text(
                    "/ tháng",
                    style = MaterialTheme.typography.bodyMedium,
                    color = cs.onSurfaceVariant,
                    modifier = Modifier.padding(bottom = 3.dp),
                )
            }
            Text(
                "~ ${formatVnd(monthlyTotal * 12)}/năm · $activeCount gói đang chạy",
                style = MaterialTheme.typography.bodySmall,
                color = cs.onSurfaceVariant,
            )
            if (upcoming.isNotEmpty()) {
                Spacer(Modifier.height(12.dp))
                Box(Modifier.fillMaxWidth().height(0.5.dp).background(cs.outlineVariant))
                Spacer(Modifier.height(10.dp))
                Text(
                    "SẮP GIA HẠN",
                    style = MaterialTheme.typography.labelSmall,
                    fontWeight = FontWeight.SemiBold,
                    color = cs.onSurfaceVariant,
                )
                Spacer(Modifier.height(6.dp))
                upcoming.forEach { sub ->
                    val days = sub.renewalDate?.let { daysLeftFromIso(it) }
                    Row(
                        Modifier.fillMaxWidth().padding(vertical = 4.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            sub.name,
                            style = MaterialTheme.typography.bodyMedium,
                            color = cs.onSurface,
                            modifier = Modifier.weight(1f),
                        )
                        Text(
                            sub.renewalDate?.take(10) ?: "—",
                            style = MaterialTheme.typography.bodySmall,
                            color = if (days != null && days < 0L) cs.error else cs.onSurfaceVariant,
                        )
                    }
                }
            }
        }
    }
}

// MARK: - Wishlist preview row

@Composable
private fun WishPreviewRow(item: WishlistItem) {
    val cs = MaterialTheme.colorScheme
    Card(
        colors = CardDefaults.cardColors(containerColor = cs.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
        shape = RoundedCornerShape(20.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(
            Modifier.padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) {
                Text(
                    item.name,
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.SemiBold,
                    color = cs.onSurface,
                )
                val subtitle = listOfNotNull(
                    item.brand?.takeIf { it.isNotBlank() },
                    item.targetDate?.take(10),
                ).joinToString(" • ")
                if (subtitle.isNotBlank()) {
                    Text(
                        subtitle,
                        style = MaterialTheme.typography.bodySmall,
                        color = cs.onSurfaceVariant,
                    )
                }
            }
            item.currentPrice?.let {
                Spacer(Modifier.width(10.dp))
                Text(
                    formatVnd(it.toLong()),
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.SemiBold,
                    color = cs.onSurface,
                )
            }
        }
    }
}

// MARK: - Helpers

@Composable
private fun toneColors(tone: StatTone): Pair<Color, Color> {
    val cs = MaterialTheme.colorScheme
    val accent = WVAccent.current
    return when (tone) {
        StatTone.Primary -> cs.primary to cs.primaryContainer
        StatTone.Warning -> accent.warning to accent.warningContainer
        StatTone.Success -> accent.success to accent.successContainer
        StatTone.Danger -> cs.error to cs.errorContainer
    }
}

private fun parseIsoDate(raw: String): LocalDate? =
    try {
        LocalDate.parse(raw.take(10))
    } catch (_: DateTimeParseException) {
        null
    }

private fun daysLeftFromIso(raw: String): Long? {
    val end = parseIsoDate(raw) ?: return null
    return ChronoUnit.DAYS.between(LocalDate.now(), end)
}

private fun formatVnd(amount: Long): String {
    val nf = NumberFormat.getNumberInstance(Locale("vi", "VN"))
    return nf.format(amount) + "đ"
}

