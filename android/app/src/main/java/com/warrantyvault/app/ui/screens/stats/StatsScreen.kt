package com.warrantyvault.app.ui.screens.stats

import androidx.compose.animation.Crossfade
import androidx.compose.animation.core.tween
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CreditCard
import androidx.compose.material.icons.filled.Devices
import androidx.compose.material.icons.filled.FavoriteBorder
import androidx.compose.material.icons.filled.MonetizationOn
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.filled.Storefront
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
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
import com.warrantyvault.app.ui.viewModelFactory
import com.warrantyvault.app.network.ApiClient
import com.warrantyvault.app.network.ApiService
import com.warrantyvault.app.network.DeviceStatus
import com.warrantyvault.app.network.SubscriptionStatus
import com.warrantyvault.app.network.UserStats
import com.warrantyvault.app.network.WishlistStatus
import com.warrantyvault.app.network.toUserMessage
import com.warrantyvault.app.ui.components.ErrorState
import com.warrantyvault.app.ui.components.PageHeader
import com.warrantyvault.app.ui.components.SectionHeader
import com.warrantyvault.app.ui.theme.WVAccent
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.text.NumberFormat
import java.util.Locale

class StatsViewModel(private val api: ApiService) : ViewModel() {
    sealed interface State {
        data object Loading : State
        data class Loaded(val stats: UserStats) : State
        data class Error(val message: String) : State
    }

    private val _state = MutableStateFlow<State>(State.Loading)
    val state: StateFlow<State> = _state.asStateFlow()

    fun load() {
        viewModelScope.launch {
            _state.value = State.Loading
            try {
                val stats = api.getStats()
                _state.value = State.Loaded(stats)
            } catch (e: Exception) {
                _state.value = State.Error(e.toUserMessage(ApiClient.json))
            }
        }
    }
}

private enum class StatTone { Primary, Warning, Success, Tertiary }

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun StatsScreen(api: ApiService) {
    val vm: StatsViewModel = viewModel(
        factory = viewModelFactory { StatsViewModel(api) },
    )
    val state by vm.state.collectAsState()
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
                label = "stats-state",
            ) { s ->
                when (s) {
                    is StatsViewModel.State.Loading -> Column {
                        PageHeader("Thống kê", "Đang tổng kết của mày…")
                        Spacer(Modifier.height(24.dp))
                        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                            androidx.compose.material3.CircularProgressIndicator()
                        }
                    }
                    is StatsViewModel.State.Error -> ErrorState(
                        icon = Icons.Outlined.WarningAmber,
                        title = "Tải không được rồi",
                        body = s.message,
                        onRetry = { vm.load() },
                    )
                    is StatsViewModel.State.Loaded -> StatsBody(s.stats)
                }
            }
        }
    }
}

@Composable
private fun StatsBody(stats: UserStats) {
    val devices = stats.devices
    val subs = stats.subscriptions
    val wish = stats.wishlist

    val activeDevices = devices.byStatus[DeviceStatus.ACTIVE.name] ?: 0
    val activeSubs = subs.byStatus[SubscriptionStatus.ACTIVE.name] ?: 0
    val watchingWish = (wish.byStatus[WishlistStatus.WATCHING.name] ?: 0) +
        (wish.byStatus[WishlistStatus.DECIDED.name] ?: 0)

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(start = 16.dp, end = 16.dp, top = 0.dp, bottom = 24.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            PageHeader(
                "Thống kê",
                "Cái nhìn nhanh về tài sản số của mày",
            )
        }

        // Hero stat — total devices
        item {
            HeroStatCard(
                icon = Icons.Filled.Devices,
                value = "${devices.total}",
                label = "Tổng số thiết bị",
                subtitle = if (devices.total > 0)
                    "Trong đó $activeDevices đang dùng"
                else
                    "Chưa có thiết bị nào",
                tone = StatTone.Primary,
            )
        }

        item {
            Spacer(Modifier.height(4.dp))
            SectionHeader("Thiết bị")
        }
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                StatTile(
                    icon = Icons.Filled.Schedule,
                    value = "$activeDevices",
                    label = "Đang dùng",
                    tone = StatTone.Warning,
                    modifier = Modifier.weight(1f),
                )
                StatTile(
                    icon = Icons.Filled.MonetizationOn,
                    value = formatVndShort(devices.totalPurchasePrice.toLong()),
                    label = "Tổng giá trị",
                    tone = StatTone.Primary,
                    modifier = Modifier.weight(1f),
                )
            }
        }

        item {
            Spacer(Modifier.height(4.dp))
            SectionHeader("Gói dịch vụ")
        }
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                StatTile(
                    icon = Icons.Filled.CreditCard,
                    value = "$activeSubs",
                    label = "Đang chạy / ${subs.total}",
                    tone = StatTone.Primary,
                    modifier = Modifier.weight(1f),
                )
                StatTile(
                    icon = Icons.Filled.MonetizationOn,
                    value = formatVndShort(subs.totalMonthlyVnd.toLong()),
                    label = "Mỗi tháng",
                    tone = StatTone.Success,
                    modifier = Modifier.weight(1f),
                )
            }
        }

        item {
            Spacer(Modifier.height(4.dp))
            SectionHeader("Wishlist")
        }
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                StatTile(
                    icon = Icons.Filled.Star,
                    value = "$watchingWish",
                    label = "Đang thèm / ${wish.total}",
                    tone = StatTone.Tertiary,
                    modifier = Modifier.weight(1f),
                )
                StatTile(
                    icon = Icons.Filled.FavoriteBorder,
                    value = formatVndShort(wish.totalCurrentPriceWatching.toLong()),
                    label = "Tổng dự kiến",
                    tone = StatTone.Tertiary,
                    modifier = Modifier.weight(1f),
                )
            }
        }
    }
}

@Composable
private fun HeroStatCard(
    icon: ImageVector,
    value: String,
    label: String,
    subtitle: String,
    tone: StatTone,
) {
    val cs = MaterialTheme.colorScheme
    val (fg, bg) = toneColors(tone)
    Card(
        colors = CardDefaults.cardColors(containerColor = bg),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
        shape = RoundedCornerShape(24.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(
            Modifier.padding(20.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                Modifier
                    .size(64.dp)
                    .clip(CircleShape)
                    .background(fg.copy(alpha = 0.18f)),
                contentAlignment = Alignment.Center,
            ) {
                Icon(icon, null, tint = fg, modifier = Modifier.size(32.dp))
            }
            Spacer(Modifier.width(16.dp))
            Column(Modifier.weight(1f)) {
                Text(
                    value,
                    style = MaterialTheme.typography.displaySmall,
                    fontWeight = FontWeight.Bold,
                    color = fg,
                    letterSpacing = (-1).sp,
                )
                Text(
                    label,
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.SemiBold,
                    color = cs.onBackground,
                )
                Spacer(Modifier.height(2.dp))
                Text(
                    subtitle,
                    style = MaterialTheme.typography.bodySmall,
                    color = cs.onSurfaceVariant,
                )
            }
        }
    }
}

@Composable
private fun StatTile(
    icon: ImageVector,
    value: String,
    label: String,
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
                color = cs.onBackground.copy(alpha = 0.78f),
            )
        }
    }
}

@Composable
private fun toneColors(tone: StatTone): Pair<Color, Color> {
    val cs = MaterialTheme.colorScheme
    val accent = WVAccent.current
    return when (tone) {
        StatTone.Primary  -> cs.primary to cs.primaryContainer
        StatTone.Warning  -> accent.warning to accent.warningContainer
        StatTone.Success  -> accent.success to accent.successContainer
        StatTone.Tertiary -> cs.tertiary to cs.tertiaryContainer
    }
}

private fun formatVnd(amount: Long): String {
    val nf = NumberFormat.getNumberInstance(Locale("vi", "VN"))
    return nf.format(amount) + "đ"
}

/** Compact VND formatter — keeps stat tiles readable on phones. */
private fun formatVndShort(amount: Long): String {
    if (amount < 1_000_000) return formatVnd(amount)
    if (amount < 1_000_000_000) {
        val millions = amount / 1_000_000.0
        return "%.1fM₫".format(millions).replace(",", ".")
    }
    val billions = amount / 1_000_000_000.0
    return "%.1fB₫".format(billions).replace(",", ".")
}
