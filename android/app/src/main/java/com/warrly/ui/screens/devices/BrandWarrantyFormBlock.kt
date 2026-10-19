package com.warrly.ui.screens.devices

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.OpenInNew
import androidx.compose.material.icons.automirrored.outlined.ManageSearch
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
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
import com.warrly.network.BrandOption
import com.warrly.network.toUserMessage
import com.warrly.ui.components.StatusPill
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

/**
 * The same brand warranty lookup, inside the add/edit device form.
 *
 * ## Why it is here as well as on the detail screen
 *
 * A device often becomes "worth checking" at the moment it is added: the user has
 * the box, the serial and the invoice on the counter. Making them save first and
 * then hunt for the action is friction that loses the data. The form therefore
 * offers the action before the row exists, and the answer travels with the
 * `POST`/`PATCH` in the five `brandWarranty*` fields.
 *
 * ## What differs from the detail card
 *
 * Nothing is written here. The record sheet's `persist` only updates the form's
 * local [draft]; [com.warrly.ui.screens.devices.AddDeviceSheet] sends it with the
 * device when the user taps Save. The note at the bottom says so rather than
 * letting the user believe a tap saved it.
 *
 * Everything else is shared with [BrandWarrantySection]: the same pure rules,
 * the same "no URL for this brand" sentence, the same record sheet, and the same
 * refusal to guess a page.
 */
@Composable
internal fun BrandWarrantyFormBlock(
    api: ApiService,
    /** The free-text brand currently typed into the form. */
    brandName: String,
    /** The catalog the form already loaded; empty means "fetch it". */
    brands: List<BrandOption>,
    draft: BrandWarrantyDraft,
    onDraftChange: (BrandWarrantyDraft) -> Unit,
) {
    val s = appStrings()
    val cs = MaterialTheme.colorScheme
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    var checking by remember { mutableStateOf(false) }
    var notice by remember { mutableStateOf<BrandLookupNotice?>(null) }
    var showRecord by remember { mutableStateOf(false) }
    var openedUrl by remember { mutableStateOf<String?>(null) }

    // The lookup answer belongs to ONE brand. Editing the brand field makes a
    // previous "no page for this brand" sentence (or a previously opened URL)
    // stale; the saved record stays, because it is the user's data, but the
    // transient answer must be asked for again. Same rule as the web form.
    LaunchedEffect(brandName) {
        notice = null
        openedUrl = null
    }

    fun checkWithBrand() {
        if (checking) return
        scope.launch {
            checking = true
            notice = null
            try {
                val state = loadBrandLookupState(
                    api = api,
                    brandName = brandName,
                    // The form loads the catalog on open. Only if that failed do
                    // we pay for a second read — never silently pretend the brand
                    // has no page just because the local list is empty.
                    brands = brands.takeIf { it.isNotEmpty() },
                )
                when (state) {
                    is BrandLookupState.Available -> {
                        openedUrl = state.url
                        if (openBrandWarrantyPage(context, state.url)) {
                            showRecord = true
                        } else {
                            notice = BrandLookupNotice.Failed(s.get(R.string.dir_no_app_for_link))
                        }
                    }
                    BrandLookupState.NoUrl, BrandLookupState.NoBrand -> {
                        openedUrl = null
                        notice = BrandLookupNotice.Unavailable(
                            brandLookupMissingMessage(s, brandName),
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

    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
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
                fontSize = 14.sp,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier.weight(1f),
            )
            draft.status?.let { status ->
                StatusPill(
                    label = brandWarrantyStatusLabel(s, status),
                    kind = brandWarrantyStatusPillKind(status),
                )
            }
        }

        if (draft.hasRecord()) {
            BrandRecordRows(draft)
        } else {
            Text(
                stringResource(R.string.brand_record_none),
                fontSize = 12.sp,
                color = cs.onSurfaceVariant,
            )
        }

        // No mismatch line here: it is computed by the server from the SAVED
        // row, and the draft can change after a new lookup. Showing the old
        // sentence next to new dates would be a stale claim. The detail card
        // shows the fresh one after Save.
        notice?.let { BrandLookupNoticeRow(it) }

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

        Text(
            stringResource(R.string.brand_form_hint),
            fontSize = 12.sp,
            color = cs.onSurfaceVariant,
        )
        Text(
            stringResource(R.string.brand_form_save_note),
            fontSize = 12.sp,
            color = cs.onSurfaceVariant,
        )
    }

    if (showRecord) {
        BrandWarrantyRecordSheet(
            initial = draft,
            prefilledUrl = openedUrl,
            onDismiss = { showRecord = false },
            onSaved = {
                showRecord = false
                openedUrl = null
            },
            persist = { recorded -> onDraftChange(recorded) },
        )
    }
}
