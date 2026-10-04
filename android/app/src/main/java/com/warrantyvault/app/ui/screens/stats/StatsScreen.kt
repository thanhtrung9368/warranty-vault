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
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AccountBalanceWallet
import androidx.compose.material.icons.filled.Autorenew
import androidx.compose.material.icons.filled.CreditCard
import androidx.compose.material.icons.filled.Devices
import androidx.compose.material.icons.filled.EventRepeat
import androidx.compose.material.icons.filled.FavoriteBorder
import androidx.compose.material.icons.filled.MonetizationOn
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.filled.VerifiedUser
import androidx.compose.material.icons.outlined.Info
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
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import com.warrantyvault.app.R
import com.warrantyvault.app.i18n.Money
import com.warrantyvault.app.i18n.appLocale
import com.warrantyvault.app.i18n.appStrings
import com.warrantyvault.app.network.ApiClient
import com.warrantyvault.app.network.ApiService
import com.warrantyvault.app.network.DeviceStatus
import com.warrantyvault.app.network.Forecast
import com.warrantyvault.app.network.ForecastBucket
import com.warrantyvault.app.network.ForecastWarranty
import com.warrantyvault.app.network.ForecastWishlistItem
import com.warrantyvault.app.network.SubscriptionStatus
import com.warrantyvault.app.network.UserStats
import com.warrantyvault.app.network.WishlistStatus
import com.warrantyvault.app.network.toUserMessage
import com.warrantyvault.app.ui.components.ErrorState
import com.warrantyvault.app.ui.components.PageHeader
import com.warrantyvault.app.ui.components.SectionHeader
import com.warrantyvault.app.ui.theme.WVAccent
import com.warrantyvault.app.ui.viewModelFactory
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

class StatsViewModel(private val api: ApiService) : ViewModel() {
    sealed interface State {
        data object Loading : State

        /**
         * The stats snapshot plus the forward-looking forecast.
         *
         * [forecast] is nullable because it is a **second** round trip
         * (`GET /api/v1/forecast`): if only that call fails (offline blip, an
         * older server without the endpoint) the tab still renders every
         * existing tile and simply omits "Dự báo chi tiêu". Blanking the whole
         * screen over the additive half would be a regression.
         */
        data class Loaded(val stats: UserStats, val forecast: Forecast? = null) : State
        data class Error(val message: String) : State
    }

    private val _state = MutableStateFlow<State>(State.Loading)
    val state: StateFlow<State> = _state.asStateFlow()

    fun load() {
        viewModelScope.launch {
            _state.value = State.Loading
            val stats = try {
                api.getStats()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _state.value = State.Error(e.toUserMessage(ApiClient.json))
                return@launch
            }
            // Additive: a failure here keeps the tab usable instead of replacing
            // real data with an error state. Cancellation is never swallowed.
            val forecast = try {
                api.getForecast(FORECAST_MONTHS)
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
                null
            }
            _state.value = State.Loaded(stats, forecast)
        }
    }

    companion object {
        /**
         * Window length requested from the API (1–24). The response's own
         * `months` is what the UI displays, so a server that clamps or defaults
         * the value can never make the header lie.
         */
        const val FORECAST_MONTHS = 12
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
                        PageHeader(stringResource(R.string.nav_stats), stringResource(R.string.stats_crunching_your_numbers))
                        Spacer(Modifier.height(24.dp))
                        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                            androidx.compose.material3.CircularProgressIndicator()
                        }
                    }
                    is StatsViewModel.State.Error -> ErrorState(
                        icon = Icons.Outlined.WarningAmber,
                        title = stringResource(R.string.dash_could_not_load_it),
                        body = s.message,
                        onRetry = { vm.load() },
                    )
                    is StatsViewModel.State.Loaded -> StatsBody(s.stats, s.forecast)
                }
            }
        }
    }
}

@Composable
private fun StatsBody(stats: UserStats, forecast: Forecast?) {
    val s = appStrings()
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
                stringResource(R.string.nav_stats),
                stringResource(R.string.stats_a_quick_look_at_your_digital),
            )
        }

        // Hero stat — total devices
        item {
            HeroStatCard(
                icon = Icons.Filled.Devices,
                value = "${devices.total}",
                label = stringResource(R.string.stats_total_devices),
                subtitle = if (devices.total > 0)
                    stringResource(R.string.stats_of_which_are_in_use, activeDevices)
                else
                    stringResource(R.string.stats_no_devices_yet),
                tone = StatTone.Primary,
            )
        }

        item {
            Spacer(Modifier.height(4.dp))
            SectionHeader(stringResource(R.string.nav_devices))
        }
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                StatTile(
                    icon = Icons.Filled.Schedule,
                    value = "$activeDevices",
                    label = stringResource(R.string.stats_in_use),
                    tone = StatTone.Warning,
                    modifier = Modifier.weight(1f),
                )
                StatTile(
                    icon = Icons.Filled.MonetizationOn,
                    value = formatVndShort(devices.totalPurchasePrice),
                    label = stringResource(R.string.stats_total_value),
                    tone = StatTone.Primary,
                    modifier = Modifier.weight(1f),
                )
            }
        }
        // Warranty-package spend (SUM of Warranty.cost) shipped with
        // `devices.totalWarrantyCost`. Only rendered once the server sends it —
        // older Go builds decode to null and we keep the old two tiles.
        devices.totalWarrantyCost?.let { warrantyCost ->
            item {
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    StatTile(
                        icon = Icons.Filled.VerifiedUser,
                        value = formatVndShort(warrantyCost),
                        label = stringResource(R.string.stats_warranty_costs),
                        tone = StatTone.Success,
                        modifier = Modifier.weight(1f),
                    )
                    StatTile(
                        icon = Icons.Filled.AccountBalanceWallet,
                        value = formatVndShort(devices.totalSpend),
                        label = stringResource(R.string.stats_total_spent),
                        tone = StatTone.Primary,
                        modifier = Modifier.weight(1f),
                    )
                }
            }
        }

        item {
            Spacer(Modifier.height(4.dp))
            SectionHeader(stringResource(R.string.subs_subscriptions))
        }
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                StatTile(
                    icon = Icons.Filled.CreditCard,
                    value = "$activeSubs",
                    label = stringResource(R.string.stats_active, subs.total),
                    tone = StatTone.Primary,
                    modifier = Modifier.weight(1f),
                )
                StatTile(
                    icon = Icons.Filled.MonetizationOn,
                    value = formatVndShort(subs.totalMonthlyVnd),
                    label = stringResource(R.string.stats_per_month),
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
                    label = stringResource(R.string.stats_wishlist, wish.total),
                    tone = StatTone.Tertiary,
                    modifier = Modifier.weight(1f),
                )
                StatTile(
                    icon = Icons.Filled.FavoriteBorder,
                    value = formatVndShort(wish.totalCurrentPriceWatching),
                    label = stringResource(R.string.stats_projected_total),
                    tone = StatTone.Tertiary,
                    modifier = Modifier.weight(1f),
                )
            }
        }

        // ─── Dự báo chi tiêu (GET /api/v1/forecast) ──────────────────────────
        // The forward-looking half of the app: month-by-month subscription
        // charges plus the warranty expiries and wishlist target dates landing
        // in the same window. Rendered only when the call succeeded — it is an
        // additive second round trip and must never take the tiles above it
        // down with it.
        forecast?.let { f ->
            item {
                Spacer(Modifier.height(4.dp))
                SectionHeader(stringResource(R.string.stats_spending_forecast))
            }
            item { ForecastHeadlineCard(f) }
            // The API's own Vietnamese honesty line, shown verbatim: the warranty
            // and wishlist figures are savings references, not commitments.
            item { ForecastNoteCard(forecastNoteText(s, f)) }

            val buckets = forecastActiveBuckets(f)
            val nothingComing =
                buckets.isEmpty() && f.upcomingWarranties.isEmpty() && f.upcomingWishlist.isEmpty()
            if (nothingComing) {
                item { ForecastEmptyCard(f) }
            }
            if (buckets.isNotEmpty()) {
                item { ForecastSubHeader(stringResource(R.string.stats_month_by_month)) }
                // Scale of the bars comes from the payload, never from a fixed
                // 12: the window is normally `months + 1` buckets wide.
                val maxCharge = buckets.maxOf { it.subscriptionVnd }
                items(buckets, key = { it.month }) { bucket ->
                    ForecastBucketCard(bucket, maxCharge)
                }
            }
            if (f.upcomingWarranties.isNotEmpty()) {
                item { ForecastSubHeader(stringResource(R.string.stats_warranty_expiring_soon)) }
                items(f.upcomingWarranties, key = { "w-${it.id}" }) { ForecastWarrantyRow(it) }
            }
            if (f.upcomingWishlist.isNotEmpty()) {
                item { ForecastSubHeader(stringResource(R.string.stats_wishlist_hitting_its_target_date)) }
                items(f.upcomingWishlist, key = { "wl-${it.id}" }) { ForecastWishlistRow(it) }
            }
        }
    }
}

@Composable
private fun ForecastSubHeader(text: String) {
    Text(
        text,
        style = MaterialTheme.typography.titleSmall,
        fontWeight = FontWeight.SemiBold,
        modifier = Modifier.padding(top = 4.dp),
    )
}

/**
 * Headline of the forecast: everything scheduled in the window, then the split
 * that matters — money that **will** be auto-charged versus money the user still
 * has to decide about. The two are separate tiles on purpose; collapsing them
 * into one number would present a decision as a charge.
 */
@Composable
private fun ForecastHeadlineCard(f: Forecast) {
    val s = appStrings()
    val cs = MaterialTheme.colorScheme
    Card(
        colors = CardDefaults.cardColors(containerColor = cs.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
        shape = RoundedCornerShape(20.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(16.dp)) {
            Text(
                stringResource(R.string.stats_projected, forecastWindowLabel(s, f)),
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.SemiBold,
                color = cs.onSurface,
            )
            Spacer(Modifier.height(6.dp))
            Text(
                formatVnd(f.subscriptionTotalVnd),
                style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.Bold,
                color = cs.primary,
                letterSpacing = (-0.5).sp,
            )
            Text(
                stringResource(R.string.stats_every_subscription_renewal_inside_the_window),
                style = MaterialTheme.typography.bodySmall,
                color = cs.onSurfaceVariant,
            )
            Spacer(Modifier.height(12.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                StatTile(
                    icon = Icons.Filled.Autorenew,
                    value = formatVnd(f.subscriptionAutoRenewTotalVnd),
                    label = stringResource(R.string.stats_charged_automatically),
                    tone = StatTone.Success,
                    modifier = Modifier.weight(1f),
                )
                StatTile(
                    icon = Icons.Filled.EventRepeat,
                    value = formatVnd(forecastManualRenewTotalVnd(f)),
                    label = stringResource(R.string.stats_you_renew_these_yourself),
                    tone = StatTone.Warning,
                    modifier = Modifier.weight(1f),
                )
            }
            Spacer(Modifier.height(10.dp))
            Text(
                stringResource(
                    R.string.stats_forecast_summary,
                    f.chargesCount,
                    f.subscriptionsCount,
                    formatVnd(f.subscriptionMonthlyAverageVnd),
                ) + " " + stringResource(R.string.stats_converted_not_used_in_the_total),
                style = MaterialTheme.typography.bodySmall,
                color = cs.onSurfaceVariant,
            )
        }
    }
}

/**
 * The API's `note`, displayed as-is. This is not decoration: it is the sentence
 * that says LIFETIME is never charged, that the first/last month are partial,
 * and that the warranty + wishlist money is possible rather than certain.
 */
@Composable
private fun ForecastNoteCard(note: String) {
    val cs = MaterialTheme.colorScheme
    Card(
        colors = CardDefaults.cardColors(containerColor = cs.surfaceContainerHighest),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
        shape = RoundedCornerShape(16.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(Modifier.padding(12.dp)) {
            Icon(
                Icons.Outlined.Info, null,
                tint = cs.onSurfaceVariant,
                modifier = Modifier.size(18.dp),
            )
            Spacer(Modifier.width(8.dp))
            Text(
                note,
                style = MaterialTheme.typography.bodySmall,
                color = cs.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun ForecastEmptyCard(f: Forecast) {
    val cs = MaterialTheme.colorScheme
    Card(
        colors = CardDefaults.cardColors(containerColor = cs.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
        shape = RoundedCornerShape(20.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Text(
            pluralStringResource(R.plurals.stats_nothing_is_projected_for_the_next, f.months, f.months),
            style = MaterialTheme.typography.bodyMedium,
            color = cs.onSurfaceVariant,
            modifier = Modifier.padding(16.dp),
        )
    }
}

/**
 * One bucket = one calendar month. The bar is the month's subscription money
 * relative to the biggest month in the window; the solid segment is the part
 * that will be auto-charged, the pale rest is what the user decides about.
 */
@Composable
private fun ForecastBucketCard(bucket: ForecastBucket, maxCharge: Long) {
    val s = appStrings()
    val cs = MaterialTheme.colorScheme
    val accent = WVAccent.current
    Card(
        colors = CardDefaults.cardColors(containerColor = cs.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
        shape = RoundedCornerShape(20.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    forecastMonthLabel(s, bucket.month),
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.SemiBold,
                    color = cs.onSurface,
                    modifier = Modifier.weight(1f),
                )
                if (bucket.subscriptionCount > 0) {
                    Text(
                        formatVnd(bucket.subscriptionVnd),
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold,
                        color = cs.primary,
                    )
                }
            }
            if (bucket.subscriptionCount > 0) {
                Spacer(Modifier.height(8.dp))
                Box(
                    Modifier
                        .fillMaxWidth()
                        .height(8.dp)
                        .clip(CircleShape)
                        .background(cs.surfaceVariant),
                ) {
                    Box(
                        Modifier
                            .fillMaxWidth(forecastBarFraction(bucket.subscriptionVnd, maxCharge))
                            .height(8.dp)
                            .clip(CircleShape)
                            .background(cs.primary.copy(alpha = 0.30f)),
                    ) {
                        Box(
                            Modifier
                                .fillMaxWidth(forecastAutoShare(bucket))
                                .height(8.dp)
                                .background(cs.primary),
                        )
                    }
                }
                Spacer(Modifier.height(6.dp))
                Text(
                    stringResource(
                        R.string.stats_forecast_bucket_split,
                        formatVnd(bucket.subscriptionAutoRenewVnd),
                        formatVnd(forecastManualRenewVnd(bucket)),
                        bucket.subscriptionCount,
                    ),
                    style = MaterialTheme.typography.bodySmall,
                    color = cs.onSurfaceVariant,
                )
            }
            // Possible spends. Deliberately NOT added to the figure above and
            // always labelled — the API documents both as references.
            if (bucket.warrantyExpiringCount > 0) {
                Spacer(Modifier.height(6.dp))
                ForecastAdvisoryLine(
                    text = stringResource(
                        R.string.stats_forecast_warranty_line,
                        bucket.warrantyExpiringCount,
                    ) + " · " + stringResource(
                        R.string.stats_reference_may_happen,
                        formatVnd(bucket.warrantyExpiringVnd),
                    ),
                    tint = accent.warning,
                )
            }
            if (bucket.wishlistTargetCount > 0) {
                Spacer(Modifier.height(6.dp))
                ForecastAdvisoryLine(
                    text = stringResource(
                        R.string.stats_forecast_wishlist_line,
                        bucket.wishlistTargetCount,
                    ) + " · " + stringResource(
                        R.string.stats_recorded_price_may_happen,
                        formatVnd(bucket.wishlistTargetVnd),
                    ),
                    tint = cs.tertiary,
                )
            }
        }
    }
}

@Composable
private fun ForecastAdvisoryLine(text: String, tint: Color) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Icon(Icons.Outlined.WarningAmber, null, tint = tint, modifier = Modifier.size(14.dp))
        Spacer(Modifier.width(6.dp))
        Text(
            text,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun ForecastWarrantyRow(w: ForecastWarranty) {
    val s = appStrings()
    val cs = MaterialTheme.colorScheme
    val accent = WVAccent.current
    Card(
        colors = CardDefaults.cardColors(containerColor = cs.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
        shape = RoundedCornerShape(20.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(14.dp)) {
            Text(
                w.deviceName,
                style = MaterialTheme.typography.bodyLarge,
                fontWeight = FontWeight.Medium,
                color = cs.onSurface,
            )
            Text(
                buildString {
                    append(forecastWarrantyTypeLabel(s, w.type))
                    append(
                        stringResource(
                            R.string.stats_forecast_expires_on,
                            forecastDateLabel(w.endDate),
                        ),
                    )
                    w.provider?.takeIf { it.isNotBlank() }?.let { append(" · $it") }
                },
                style = MaterialTheme.typography.bodySmall,
                color = cs.onSurfaceVariant,
            )
            Spacer(Modifier.height(4.dp))
            // `null` means "no price recorded", which is NOT 0 ₫ — say so.
            ForecastAdvisoryLine(
                text = w.costVnd?.let {
                    stringResource(R.string.stats_old_plan_price_a_reference_for, formatVnd(it))
                } ?: stringResource(R.string.stats_no_price_recorded_for_the_old),
                tint = accent.warning,
            )
        }
    }
}

@Composable
private fun ForecastWishlistRow(item: ForecastWishlistItem) {
    val s = appStrings()
    val cs = MaterialTheme.colorScheme
    Card(
        colors = CardDefaults.cardColors(containerColor = cs.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
        shape = RoundedCornerShape(20.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(14.dp)) {
            Text(
                item.name,
                style = MaterialTheme.typography.bodyLarge,
                fontWeight = FontWeight.Medium,
                color = cs.onSurface,
            )
            Text(
                "${forecastPriorityLabel(s, item.priority)} · " +
                    "${forecastWishlistStatusLabel(s, item.status)} · " +
                    stringResource(R.string.stats_target, forecastDateLabel(item.targetDate)),
                style = MaterialTheme.typography.bodySmall,
                color = cs.onSurfaceVariant,
            )
            Spacer(Modifier.height(4.dp))
            ForecastAdvisoryLine(
                text = item.currentPriceVnd?.let {
                    stringResource(R.string.stats_last_recorded_price_may_happen_not, formatVnd(it))
                } ?: stringResource(R.string.stats_no_price_ever_entered_not_a),
                tint = cs.tertiary,
            )
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

/**
 * Money in the UI language (see `i18n/Money.kt`). `@Composable` because the
 * amount, unlike the sentence around it, follows the *selected* language rather
 * than the phone's.
 */
@Composable
private fun formatVnd(amount: Long): String = Money.of(amount, appLocale())

/** Compact VND formatter — keeps stat tiles readable on phones. */
@Composable
private fun formatVndShort(amount: Long): String {
    if (amount < 1_000_000) return formatVnd(amount)
    if (amount < 1_000_000_000) {
        val millions = amount / 1_000_000.0
        return "%.1fM₫".format(millions).replace(",", ".")
    }
    val billions = amount / 1_000_000_000.0
    return "%.1fB₫".format(billions).replace(",", ".")
}
