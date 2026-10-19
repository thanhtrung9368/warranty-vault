package com.warrly.ui.screens.devices

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.OpenInNew
import androidx.compose.material.icons.automirrored.outlined.CompareArrows
import androidx.compose.material.icons.automirrored.outlined.ManageSearch
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.outlined.CheckCircleOutline
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.MenuAnchorType
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TextField
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.warrly.R
import com.warrly.i18n.appStrings
import com.warrly.network.ApiClient
import com.warrly.network.ApiService
import com.warrly.network.BrandWarrantyStatus
import com.warrly.network.Device
import com.warrly.network.WarrantyMismatch
import com.warrly.network.fieldErrors
import com.warrly.network.toUserMessage
import com.warrly.ui.components.PillKind
import com.warrly.ui.components.SheetGroup
import com.warrly.ui.components.StatusPill
import com.warrly.ui.screens.vietnamDate
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

/**
 * "Đối chiếu với hãng" — the brand warranty card on the device detail.
 *
 * ## Why this is its own card, and why it sits high
 *
 * The typed warranty dates are a guess from the invoice; the manufacturer's
 * system is the authority. This card is the only place the two are shown
 * together, so it is placed directly under the device summary instead of being
 * buried between the repair tickets and the attachments. A disagreement the
 * user has to scroll to find is a disagreement they will not act on.
 *
 * ## The four states the card can be in
 *
 *  1. **Not checked** — says so, and that the typed dates came from the invoice.
 *  2. **Checked, dates agree** — says the two agree. Silence here would read as
 *     "not loaded"; the absence of a mismatch is itself the answer.
 *  3. **Checked, dates disagree** — the server's sentence with both dates, in a
 *     neutral container. It is information, not an error: no red, no warning
 *     triangle, no "your warranty may be invalid" claim. The app does not know
 *     which side is right; it knows they differ.
 *  4. **A recorded page** — the URL is a link back to the brand's own page, so
 *     the user can re-check instead of trusting a stored screenshot of words.
 *
 * ## The one rule that never bends
 *
 * When the API has no URL for the brand, the card says so and offers manual
 * recording. It never builds a search URL, a brand homepage guess or a
 * `https://<brand>.com` template. A wrong page can show another device's
 * warranty; "app chưa có trang này" is the honest answer.
 */
@Composable
internal fun BrandWarrantySection(
    api: ApiService,
    device: Device,
    /** Called after a record was saved so the host can reload the detail row. */
    onSaved: () -> Unit,
) {
    val s = appStrings()
    val cs = MaterialTheme.colorScheme
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    var checking by remember(device.id) { mutableStateOf(false) }
    var notice by remember(device.id) { mutableStateOf<BrandLookupNotice?>(null) }
    var showRecord by remember(device.id) { mutableStateOf(false) }
    // The URL opened by the last lookup, prefilled into the record sheet. `null`
    // when the user opens the sheet manually — the sheet then falls back to the
    // URL already stored on the device, never to a constructed one.
    var openedUrl by remember(device.id) { mutableStateOf<String?>(null) }

    fun checkWithBrand() {
        if (checking) return
        scope.launch {
            checking = true
            notice = null
            try {
                val state = loadBrandLookupState(api, device.brand)
                when (state) {
                    is BrandLookupState.Available -> {
                        openedUrl = state.url
                        if (openBrandWarrantyPage(context, state.url)) {
                            // The browser takes over now; the record sheet is
                            // waiting when the user comes back with the answer.
                            showRecord = true
                        } else {
                            notice = BrandLookupNotice.Failed(
                                s.get(R.string.dir_no_app_for_link),
                            )
                        }
                    }
                    BrandLookupState.NoUrl, BrandLookupState.NoBrand -> {
                        openedUrl = null
                        notice = BrandLookupNotice.Unavailable(
                            brandLookupMissingMessage(s, device.brand),
                        )
                    }
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                notice = BrandLookupNotice.Failed(
                    s.get(R.string.brand_lookup_failed, e.toUserMessage(ApiClient.json, context)),
                )
            } finally {
                checking = false
            }
        }
    }

    Card(
        colors = CardDefaults.cardColors(containerColor = cs.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
        shape = RoundedCornerShape(20.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(
            Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    Icons.AutoMirrored.Outlined.ManageSearch,
                    null,
                    tint = cs.primary,
                    modifier = Modifier.size(20.dp),
                )
                Spacer(Modifier.width(8.dp))
                Text(
                    stringResource(R.string.brand_lookup_title),
                    fontSize = 16.sp,
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.weight(1f),
                )
                device.brandWarrantyStatus?.let { status ->
                    StatusPill(
                        label = brandWarrantyStatusLabel(s, status),
                        kind = brandWarrantyStatusPillKind(status),
                    )
                }
            }

            if (device.hasBrandWarrantyRecord()) {
                BrandRecordRows(brandWarrantyDraftOf(device))
            } else {
                Text(
                    stringResource(R.string.brand_record_none),
                    fontSize = 12.sp,
                    color = cs.onSurfaceVariant,
                )
            }

            val mismatch = device.warrantyMismatch
            if (mismatch != null) {
                MismatchBlock(mismatch)
            } else if (brandWarrantyAgrees(device)) {
                Row(verticalAlignment = Alignment.Top) {
                    Icon(
                        Icons.Outlined.CheckCircleOutline,
                        null,
                        tint = cs.primary,
                        modifier = Modifier.size(16.dp),
                    )
                    Spacer(Modifier.width(6.dp))
                    Text(
                        stringResource(R.string.brand_record_agree),
                        fontSize = 12.sp,
                        color = cs.onSurfaceVariant,
                    )
                }
            }

            notice?.let { current -> BrandLookupNoticeRow(current) }

            OutlinedButton(
                onClick = { checkWithBrand() },
                enabled = !checking,
                modifier = Modifier.fillMaxWidth(),
            ) {
                if (checking) {
                    CircularProgressIndicator(
                        strokeWidth = 2.dp,
                        modifier = Modifier.size(16.dp),
                    )
                } else {
                    Icon(
                        Icons.AutoMirrored.Filled.OpenInNew,
                        null,
                        modifier = Modifier.size(16.dp),
                    )
                }
                Spacer(Modifier.width(6.dp))
                Text(
                    if (checking) {
                        stringResource(R.string.brand_lookup_checking)
                    } else {
                        stringResource(R.string.brand_lookup_action)
                    },
                )
            }
            TextButton(
                onClick = {
                    openedUrl = null
                    showRecord = true
                },
                modifier = Modifier.fillMaxWidth(),
            ) {
                Icon(Icons.Filled.Edit, null, modifier = Modifier.size(16.dp))
                Spacer(Modifier.width(6.dp))
                Text(stringResource(R.string.brand_lookup_manual))
            }
        }
    }

    if (showRecord) {
        BrandWarrantyRecordSheet(
            initial = brandWarrantyDraftOf(device),
            prefilledUrl = openedUrl,
            onDismiss = { showRecord = false },
            onSaved = {
                showRecord = false
                openedUrl = null
                onSaved()
            },
            persist = { draft ->
                api.updateDevice(device.id, deviceInputForBrandWarranty(device, draft))
            },
        )
    }
}

/** One line for [BrandLookupNotice], shared by the detail card and the form. */
@Composable
internal fun BrandLookupNoticeRow(notice: BrandLookupNotice) {
    val cs = MaterialTheme.colorScheme
    Row(verticalAlignment = Alignment.Top) {
        Icon(
            if (notice is BrandLookupNotice.Failed) {
                Icons.Outlined.WarningAmber
            } else {
                Icons.Outlined.Info
            },
            null,
            tint = if (notice is BrandLookupNotice.Failed) cs.error else cs.onSurfaceVariant,
            modifier = Modifier.size(16.dp),
        )
        Spacer(Modifier.width(6.dp))
        Text(
            notice.text,
            fontSize = 12.sp,
            color = if (notice is BrandLookupNotice.Failed) cs.error else cs.onSurfaceVariant,
        )
    }
}

/** The recorded dates, in the same order as the brand's own page. */
@Composable
internal fun BrandRecordRows(draft: BrandWarrantyDraft) {
    val cs = MaterialTheme.colorScheme
    val start = vietnamDate(draft.startDate)
    val end = vietnamDate(draft.endDate)
    val checked = brandCheckedAtLabel(draft.checkedAt)

    start?.let {
        BrandRow(stringResource(R.string.brand_record_start), it)
    }
    end?.let {
        BrandRow(stringResource(R.string.brand_record_end), it)
    }
    checked?.let {
        BrandRow(stringResource(R.string.brand_record_checked), it)
    }
    brandLookupUrl(draft.lookupUrl)?.let { url ->
        val context = LocalContext.current
        var failed by remember(url) { mutableStateOf(false) }
        TextButton(
            onClick = {
                failed = !openBrandWarrantyPage(context, url)
            },
            contentPadding = androidx.compose.foundation.layout.PaddingValues(0.dp),
        ) {
            Icon(
                Icons.AutoMirrored.Filled.OpenInNew,
                null,
                modifier = Modifier.size(16.dp),
            )
            Spacer(Modifier.width(6.dp))
            Text(stringResource(R.string.brand_record_open_page), fontSize = 13.sp)
        }
        if (failed) {
            Text(
                stringResource(R.string.dir_no_app_for_link),
                fontSize = 12.sp,
                color = cs.error,
            )
        }
    }
}

@Composable
private fun BrandRow(label: String, value: String) {
    Row(Modifier.fillMaxWidth().padding(vertical = 1.dp)) {
        Text(
            label,
            fontSize = 12.sp,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.width(132.dp),
        )
        Text(value, fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurface)
    }
}

/**
 * The mismatch, deliberately not an error box.
 *
 * Uses `secondaryContainer` (a calm, non-semantic surface) rather than
 * `errorContainer`: the app knows the two systems disagree, not that the user's
 * record is wrong. The sentence carries the number and both dates; the title is
 * the only emphasis.
 */
@Composable
internal fun MismatchBlock(mismatch: WarrantyMismatch) {
    val s = appStrings()
    val cs = MaterialTheme.colorScheme
    val message = brandMismatchMessage(s, mismatch)
    Card(
        colors = CardDefaults.cardColors(containerColor = cs.secondaryContainer),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
        shape = RoundedCornerShape(16.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(Modifier.padding(12.dp), verticalAlignment = Alignment.Top) {
            Icon(
                Icons.AutoMirrored.Outlined.CompareArrows,
                null,
                tint = cs.onSecondaryContainer,
                modifier = Modifier.size(18.dp),
            )
            Spacer(Modifier.width(8.dp))
            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(
                    stringResource(R.string.brand_mismatch_title),
                    fontSize = 13.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = cs.onSecondaryContainer,
                )
                if (message != null) {
                    Text(message, fontSize = 12.sp, color = cs.onSecondaryContainer)
                } else {
                    // Unknown kind from a newer server: show the two dates, but
                    // do not invent a direction the app cannot justify.
                    val dates = listOfNotNull(
                        vietnamDate(mismatch.brandDate),
                        vietnamDate(mismatch.purchaseDate),
                    ).joinToString(" · ")
                    if (dates.isNotBlank()) {
                        Text(dates, fontSize = 12.sp, color = cs.onSecondaryContainer)
                    }
                }
            }
        }
    }
}

/**
 * The record sheet: status, the two dates the brand showed, and the URL that was
 * opened. This is the part competitors do not do — they link out and forget; the
 * stored answer is what makes the mismatch visible on the next visit.
 *
 * `checkedAt` is stamped **on save**, not when the sheet opened: the user may
 * leave the sheet open while reading the brand's page, and "checked at" should
 * mean the moment the answer was recorded.
 *
 * [persist] is the only difference between the two hosts. On the device detail
 * it PATCHes the whole device; inside the add/edit form it just moves the values
 * into form state and the form's Save sends them later.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun BrandWarrantyRecordSheet(
    initial: BrandWarrantyDraft,
    prefilledUrl: String?,
    onDismiss: () -> Unit,
    onSaved: () -> Unit,
    persist: suspend (BrandWarrantyDraft) -> Unit,
) {
    val s = appStrings()
    val cs = MaterialTheme.colorScheme
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)

    var status by remember { mutableStateOf(initial.status) }
    var startText by remember { mutableStateOf(initial.startDate.orEmpty()) }
    var endText by remember { mutableStateOf(initial.endDate.orEmpty()) }
    // The URL just opened wins over the stored one; both are shown in the field
    // so the user can see (and correct) exactly what will be saved.
    var urlText by remember { mutableStateOf(prefilledUrl ?: initial.lookupUrl.orEmpty()) }
    var saving by remember { mutableStateOf(false) }
    var localError by remember { mutableStateOf<String?>(null) }
    var serverFields by remember { mutableStateOf<Map<String, List<String>>>(emptyMap()) }
    // The preview is the sheet's opening time; the value actually SAVED is
    // stamped inside `save()`, because the user may spend a while on the
    // brand's page before recording the answer.
    val checkedAtPreview = remember { brandCheckedAtNow() }

    val statusServerError = serverFields["brandWarrantyStatus"]?.firstOrNull()
    val startServerError = serverFields["brandWarrantyStart"]?.firstOrNull()
    val endServerError = serverFields["brandWarrantyEnd"]?.firstOrNull()
    val urlServerError = serverFields["brandLookupUrl"]?.firstOrNull()

    fun clearErrors(field: String? = null) {
        localError = null
        serverFields = if (field == null) emptyMap() else serverFields - field
    }

    fun save() {
        val draft = BrandWarrantyDraft(
            status = status,
            startDate = brandWarrantyDateRequest(startText),
            endDate = brandWarrantyDateRequest(endText),
            lookupUrl = urlText.trim().ifBlank { null },
            checkedAt = brandCheckedAtNow(),
        )
        brandWarrantyDraftProblem(draft)?.let {
            localError = brandWarrantyProblemMessage(s, it)
            return
        }
        scope.launch {
            saving = true
            localError = null
            serverFields = emptyMap()
            try {
                persist(draft)
                onSaved()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                serverFields = e.fieldErrors(ApiClient.json)
                localError = e.toUserMessage(ApiClient.json, context)
            } finally {
                saving = false
            }
        }
    }

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheetState) {
        Column(
            Modifier
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(
                stringResource(R.string.brand_sheet_title),
                fontSize = 18.sp,
                fontWeight = FontWeight.SemiBold,
            )
            Text(
                stringResource(R.string.brand_sheet_hint),
                fontSize = 12.sp,
                color = cs.onSurfaceVariant,
            )

            SheetGroup {
                BrandStatusDropdown(
                    selected = status,
                    error = statusServerError,
                    onSelected = {
                        status = it
                        clearErrors("brandWarrantyStatus")
                    },
                )
                OutlinedTextField(
                    value = startText,
                    onValueChange = {
                        startText = it
                        clearErrors("brandWarrantyStart")
                    },
                    label = { Text(stringResource(R.string.brand_sheet_start)) },
                    isError = startServerError != null,
                    supportingText = startServerError?.let { { Text(it, color = cs.error) } },
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = endText,
                    onValueChange = {
                        endText = it
                        clearErrors("brandWarrantyEnd")
                    },
                    label = { Text(stringResource(R.string.brand_sheet_end)) },
                    isError = endServerError != null,
                    supportingText = endServerError?.let { { Text(it, color = cs.error) } },
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = urlText,
                    onValueChange = {
                        urlText = it
                        clearErrors("brandLookupUrl")
                    },
                    label = { Text(stringResource(R.string.brand_sheet_url)) },
                    isError = urlServerError != null,
                    supportingText = urlServerError?.let { { Text(it, color = cs.error) } },
                    modifier = Modifier.fillMaxWidth(),
                )
                Text(
                    stringResource(
                        R.string.brand_sheet_checked,
                        brandCheckedAtLabel(checkedAtPreview) ?: checkedAtPreview.take(10),
                    ),
                    fontSize = 12.sp,
                    color = cs.onSurfaceVariant,
                )
            }

            localError?.let {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(
                        Icons.Outlined.WarningAmber,
                        null,
                        tint = cs.error,
                        modifier = Modifier.size(16.dp),
                    )
                    Spacer(Modifier.width(6.dp))
                    Text(it, color = cs.error, fontSize = 13.sp)
                }
            }

            Button(
                onClick = { save() },
                enabled = !saving,
                shape = CircleShape,
                colors = ButtonDefaults.buttonColors(containerColor = cs.primary),
                modifier = Modifier.fillMaxWidth().height(52.dp),
            ) {
                if (saving) {
                    CircularProgressIndicator(
                        strokeWidth = 2.dp,
                        modifier = Modifier.height(20.dp),
                        color = cs.onPrimary,
                    )
                } else {
                    Text(
                        stringResource(R.string.brand_sheet_save),
                        fontWeight = FontWeight.SemiBold,
                    )
                }
            }
            Spacer(Modifier.height(20.dp))
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun BrandStatusDropdown(
    selected: BrandWarrantyStatus?,
    error: String?,
    onSelected: (BrandWarrantyStatus) -> Unit,
) {
    var expanded by remember { mutableStateOf(false) }
    val s = appStrings()
    ExposedDropdownMenuBox(
        expanded = expanded,
        onExpandedChange = { expanded = it },
    ) {
        TextField(
            value = selected?.let { brandWarrantyStatusLabel(s, it) }
                ?: stringResource(R.string.brand_sheet_choose_status),
            onValueChange = {},
            readOnly = true,
            label = { Text(stringResource(R.string.brand_sheet_status)) },
            isError = error != null,
            supportingText = error?.let { { Text(it, color = MaterialTheme.colorScheme.error) } },
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = expanded) },
            modifier = Modifier
                .fillMaxWidth()
                .menuAnchor(MenuAnchorType.PrimaryNotEditable),
        )
        ExposedDropdownMenu(
            expanded = expanded,
            onDismissRequest = { expanded = false },
        ) {
            BrandWarrantyStatus.entries.forEach { option ->
                DropdownMenuItem(
                    text = { Text(brandWarrantyStatusLabel(s, option)) },
                    onClick = {
                        onSelected(option)
                        expanded = false
                    },
                )
            }
        }
    }
}
