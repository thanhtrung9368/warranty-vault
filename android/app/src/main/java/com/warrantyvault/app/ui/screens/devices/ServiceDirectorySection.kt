package com.warrantyvault.app.ui.screens.devices

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.OpenInNew
import androidx.compose.material.icons.filled.Build
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Phone
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.warrantyvault.app.R
import com.warrantyvault.app.i18n.appStrings
import com.warrantyvault.app.network.ApiClient
import com.warrantyvault.app.network.ApiService
import com.warrantyvault.app.network.ServiceDirectory
import com.warrantyvault.app.network.WarrantyCentre
import com.warrantyvault.app.network.toUserMessage
import com.warrantyvault.app.ui.components.CategoryLabels

/**
 * "Đi bảo hành ở đâu" — the warranty directory card on the device detail screen
 * (FEATURE_IDEAS #15).
 *
 * Three tiers, never mixed (openapi `ServiceDirectory`):
 *
 *  1. **The brand's own locator** — the only service-centre information the repo
 *     is willing to publish, and only as a URL the brand maintains itself.
 *  2. **What the user wrote per warranty** — `address`/`phone`, with `phoneSource`
 *     rendered as attribution. This is the *only* contact information this app
 *     will present as contact information.
 *  3. **`null`** — the app does not know. Rendered as a Vietnamese sentence, never
 *     as an empty box, and never filled with a guess.
 *
 * A missing phone is **not** a silent gap: [NO_PHONE_MESSAGE] says there is none,
 * because a blank row next to a "call the hotline" expectation is exactly how a
 * user ends up assuming a number exists.
 */
@Composable
fun ServiceDirectorySection(api: ApiService, deviceId: String) {
    val s = appStrings()
    val context = LocalContext.current

    var directory by remember { mutableStateOf<ServiceDirectory?>(null) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(deviceId) {
        loading = true
        try {
            directory = api.getServiceDirectory(deviceId).directory
            error = null
        } catch (e: Exception) {
            error = e.toUserMessage(ApiClient.json)
        } finally {
            loading = false
        }
    }

    val cs = MaterialTheme.colorScheme

    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Filled.Build, null, tint = cs.primary)
            Spacer(Modifier.width(8.dp))
            Text(stringResource(R.string.dir_where_to_get_warranty_service),
                fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
        }

        val current = directory
        when {
            loading && current == null -> Row(verticalAlignment = Alignment.CenterVertically) {
                CircularProgressIndicator(strokeWidth = 2.dp, modifier = Modifier.size(16.dp))
                Spacer(Modifier.width(8.dp))
                Text(stringResource(R.string.dir_checking_the_directory), fontSize = 13.sp)
            }

            current == null -> error?.let {
                Text(it, color = cs.error, fontSize = 13.sp)
            }

            else -> {
                BrandLocatorCard(current)
                Spacer(Modifier.height(2.dp))
                Text(centreCountLabel(s, current.centres),
                    fontSize = 12.sp, color = cs.onSurfaceVariant)
                current.centres.forEach { centre ->
                    CentreCard(
                        centre = centre,
                        onDial = { phone -> openDialer(context, phone) },
                    )
                }
                directoryDisclaimer(current)?.let { disclaimer ->
                    DisclaimerCard(disclaimer)
                }
            }
        }

        // A load failure after a successful one keeps the data on screen; the
        // message above then explains the refresh problem without blanking it.
        if (!loading && current != null && error != null) {
            Text(error!!, color = cs.error, fontSize = 13.sp)
        }
    }
}

/**
 * Tier 1. The brand row, or the honest sentence when there is none.
 *
 * `brand == null` covers two different server-side reasons — no seeded row for
 * that brand, or a **tie** in the free-text match — and the copy names both
 * instead of implying the brand is unknown to the world. What it must never do is
 * render an empty card or build a search URL the server declined to give.
 */
@Composable
private fun BrandLocatorCard(directory: ServiceDirectory) {
    val s = appStrings()
    val cs = MaterialTheme.colorScheme
    val context = LocalContext.current
    val brand = directory.brand
    val brandInput = directoryBrandInput(directory)

    Card(
        colors = CardDefaults.cardColors(containerColor = cs.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
        shape = RoundedCornerShape(20.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(stringResource(R.string.dir_the_brand_s_authorised_service_centres),
                fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = cs.onSurface)

            if (brand == null) {
                Text(
                    brandInput?.let { stringResource(R.string.dir_brand_you_typed, it) } ?: stringResource(R.string.dir_no_brand_recorded_for_this_device),
                    fontSize = 13.sp,
                    color = cs.onSurface,
                )
                Row(verticalAlignment = Alignment.Top) {
                    Icon(Icons.Outlined.WarningAmber, null,
                        tint = cs.onSurfaceVariant,
                        modifier = Modifier.size(16.dp))
                    Spacer(Modifier.width(6.dp))
                    Text(
                        if (brandInput == null) {
                            stringResource(NO_BRAND_EXPLANATION)
                        } else {
                            stringResource(NULL_BRAND_EXPLANATION)
                        },
                        fontSize = 12.sp,
                        color = cs.onSurfaceVariant,
                    )
                }
                return@Column
            }

            Text(brand.name, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
            // Category code → Vietnamese label via the shared mirror
            // (`ui/components/CategoryLabels.kt`); the payload carries only the code.
            Text(CategoryLabels.label(directory.category),
                fontSize = 12.sp, color = cs.onSurfaceVariant)
            if (brandInput != null && brandInput != brand.name) {
                // The match is fuzzy, so the user's own words stay visible next to
                // the row that was matched — the way `providerInput` does below.
                Text(stringResource(R.string.dir_you_typed, brandInput), fontSize = 12.sp, color = cs.onSurfaceVariant)
            }
            brandNote(brand)?.let {
                Text(it, fontSize = 12.sp, color = cs.onSurfaceVariant)
            }
            // Computed once: the same list decides both the buttons and the
            // "no verified link" line, so they can never contradict each other.
            val links = brandDirectoryLinks(s, brand)
            links.forEach { link ->
                TextButton(
                    onClick = { openDirectoryLink(context, link.url) },
                    contentPadding = PaddingValues(0.dp),
                ) {
                    Icon(Icons.AutoMirrored.Filled.OpenInNew, null,
                        modifier = Modifier.size(16.dp))
                    Spacer(Modifier.width(6.dp))
                    Text(link.label, fontSize = 13.sp)
                }
            }
            if (links.isEmpty()) {
                Text(stringResource(R.string.dir_this_brand_has_no_verified_lookup),
                    fontSize = 12.sp, color = cs.onSurfaceVariant)
            }
        }
    }
}

/**
 * Tier 2. One warranty's contact row.
 *
 * The rows and their order are the whole point:
 *
 *  * provider — the matched catalog name, or the user's own unmatched text
 *    ([centreProviderLine]); the fuzzy match is never implied to be exact;
 *  * status + end date — `isActive` is the **server's** verdict, and the date is
 *    formatted `dd/MM/yyyy` like every other date in this app;
 *  * address — only when the user wrote one;
 *  * phone — the [dialablePhone] projection. `phoneSource == "user"` → the number,
 *    tappable, **labelled with its source**; anything else → [NO_PHONE_MESSAGE].
 *    There is no branch that renders a number the app cannot attribute.
 */
@Composable
private fun CentreCard(centre: WarrantyCentre, onDial: (DialablePhone) -> Unit) {
    val s = appStrings()
    val cs = MaterialTheme.colorScheme
    val phone = dialablePhone(centre)

    Card(
        colors = CardDefaults.cardColors(containerColor = cs.surface),
        border = BorderStroke(1.dp, cs.outline),
        shape = RoundedCornerShape(12.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(centreProviderLine(s, centre),
                    fontSize = 14.sp,
                    fontWeight = if (isUnmatchedProvider(centre)) FontWeight.Normal
                    else FontWeight.SemiBold,
                    color = if (isUnmatchedProvider(centre)) cs.onSurfaceVariant else cs.onSurface,
                    modifier = Modifier.weight(1f))
                Text(stringResource(centre.warrantyType.labelRes),
                    fontSize = 11.sp, color = cs.onSurfaceVariant)
            }

            // Why this row is not a matched catalog entry — omitted entirely when
            // the user never recorded a provider, so the fallback line above is
            // never followed by a quote of nothing.
            unmatchedProviderNote(s, centre)?.let { note ->
                Text(note, fontSize = 12.sp, color = cs.onSurfaceVariant)
            }

            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(centreStatusLabel(s, centre),
                    fontSize = 12.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = if (centre.isActive) cs.primary else cs.onSurfaceVariant)
                centreEndDateLabel(s, centre)?.let {
                    Spacer(Modifier.width(6.dp))
                    Text("· $it", fontSize = 12.sp, color = cs.onSurfaceVariant)
                }
            }

            centreAddress(centre)?.let { address ->
                Text(address, fontSize = 12.sp, color = cs.onSurface)
            }

            if (phone == null) {
                // The absence itself, said out loud: `phoneSource: "none"` means
                // there is nothing, and this app has no hotline to fall back on.
                Text(stringResource(NO_PHONE_MESSAGE), fontSize = 12.sp, color = cs.onSurfaceVariant)
            } else {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    TextButton(
                        onClick = { onDial(phone) },
                        contentPadding = PaddingValues(0.dp),
                    ) {
                        Icon(Icons.Filled.Phone, null, modifier = Modifier.size(16.dp))
                        Spacer(Modifier.width(6.dp))
                        Text(phone.number, fontSize = 13.sp)
                    }
                    Spacer(Modifier.width(8.dp))
                    // Attribution, always: the app never verified this number and
                    // must not look as though it did.
                    Text(phone.attribution(s), fontSize = 11.sp, color = cs.onSurfaceVariant)
                }
            }
        }
    }
}

/**
 * Tier 3, spelled out. The server's `disclaimer` is rendered **verbatim** — it is
 * the app explaining why so many fields above are empty, and paraphrasing it
 * would be the one place this feature could start overselling.
 */
@Composable
private fun DisclaimerCard(disclaimer: String) {
    val cs = MaterialTheme.colorScheme
    Card(
        colors = CardDefaults.cardColors(containerColor = cs.surfaceContainerHighest),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
        shape = RoundedCornerShape(12.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(Modifier.padding(12.dp), verticalAlignment = Alignment.Top) {
            Icon(Icons.Filled.Info, null,
                tint = cs.onSurfaceVariant, modifier = Modifier.size(16.dp))
            Spacer(Modifier.width(8.dp))
            Text(disclaimer, fontSize = 12.sp, color = cs.onSurfaceVariant)
        }
    }
}
