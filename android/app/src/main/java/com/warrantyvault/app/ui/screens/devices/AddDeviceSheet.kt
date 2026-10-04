package com.warrantyvault.app.ui.screens.devices

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.PictureAsPdf
import androidx.compose.material.icons.outlined.DocumentScanner
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
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
import androidx.compose.material3.TextField
import androidx.compose.material3.rememberModalBottomSheetState
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
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.warrantyvault.app.R
import com.warrantyvault.app.i18n.AppStrings
import com.warrantyvault.app.i18n.appStrings
import com.warrantyvault.app.network.ApiClient
import com.warrantyvault.app.network.ApiService
import com.warrantyvault.app.network.BrandOption
import com.warrantyvault.app.network.CategoryOption
import com.warrantyvault.app.network.Device
import com.warrantyvault.app.network.DeviceInput
import com.warrantyvault.app.network.DeviceStatus
import com.warrantyvault.app.network.DeviceWarning
import com.warrantyvault.app.network.DraftDevice
import com.warrantyvault.app.network.StoreOption
import com.warrantyvault.app.network.fieldErrors
import com.warrantyvault.app.network.toUserMessage
import com.warrantyvault.app.ui.components.CategoryLabels
import com.warrantyvault.app.ui.components.SheetGroup
import com.warrantyvault.app.ui.screens.common.StoreAutocompleteField
import com.warrantyvault.app.ui.theme.WVAccent
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AddDeviceSheet(
    api: ApiService,
    onDismiss: () -> Unit,
    /**
     * Called after a **successful** save with the device plus the advisory
     * `warnings` the write returned. The device is already saved when this runs;
     * warnings are "đã lưu, nhưng trông sai", so the host shows them
     * non-blockingly (the sheet is closing) rather than treating them as errors.
     */
    onSaved: (Device, List<DeviceWarning>) -> Unit,
    existing: Device? = null,
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val scope = rememberCoroutineScope()
    val isEdit = existing != null

    var name by remember { mutableStateOf(existing?.name ?: "") }
    var brand by remember { mutableStateOf(existing?.brand ?: "") }
    var model by remember { mutableStateOf(existing?.model ?: "") }
    var price by remember {
        mutableStateOf((existing?.purchasePrice ?: 0).takeIf { it > 0 }?.toString() ?: "")
    }
    var months by remember {
        mutableStateOf(if (isEdit) "" else "12")
    }
    var notes by remember { mutableStateOf(existing?.notes ?: "") }
    var category by remember { mutableStateOf(existing?.category ?: "PHONE") }
    var status by remember { mutableStateOf(existing?.status ?: DeviceStatus.ACTIVE) }
    var purchaseDate by remember {
        mutableStateOf(existing?.purchaseDate?.take(10) ?: today())
    }
    var serial by remember { mutableStateOf(existing?.serialNumber ?: "") }
    var purchasePlace by remember { mutableStateOf(existing?.purchasePlace ?: "") }
    // Resale (roadmap #12). `soldAt` is read exactly like `purchaseDate` above:
    // a naive-UTC timestamp whose first 10 chars are the calendar date. A blank
    // price stays blank rather than becoming 0 so "chưa bán" (null) and a
    // give-away (0 ₫) are distinguishable.
    var soldDate by remember { mutableStateOf(soldDateInput(existing?.soldAt)) }
    var soldPrice by remember { mutableStateOf(existing?.soldPrice?.toString().orEmpty()) }
    // Exchange/return window (migration 0010) — PRESERVED, never edited here.
    //
    // `PATCH /api/v1/devices/{id}` replaces every field, so a save that omits
    // `returnWindowDays`/`receivedAt` DELETES a window recorded by the web or iOS
    // client. These two hold whatever was loaded, purely so the request can send
    // it straight back; there is intentionally no input bound to them (see
    // DeviceReturnWindow.kt). Blank means "chưa biết" and stays `null`.
    var returnWindowDays by remember { mutableStateOf(returnWindowDaysInput(existing?.returnWindowDays)) }
    var receivedAt by remember { mutableStateOf(receivedAtInput(existing?.receivedAt)) }

    var categoryOptions by remember { mutableStateOf<List<CategoryOption>>(emptyList()) }
    var brandOptions by remember { mutableStateOf<List<BrandOption>>(emptyList()) }
    var storeOptions by remember { mutableStateOf<List<StoreOption>>(emptyList()) }

    var submitting by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    // Per-field 400s from the server (the resale pair rule lands here:
    // fieldErrors.soldAt / fieldErrors.soldPrice). Same pattern as
    // ChangePasswordSheet — the server's Vietnamese copy is shown as-is.
    var fieldErrors by remember { mutableStateOf<Map<String, List<String>>>(emptyMap()) }

    fun firstFieldError(name: String): String? = fieldErrors[name]?.firstOrNull()

    // OCR receipt scan (create flow only, gated on the per-user AI opt-in).
    val context = LocalContext.current
    val s = appStrings()
    var scanning by remember { mutableStateOf(false) }
    var scanInfo by remember { mutableStateOf<DraftDevice?>(null) }
    // Warnings from the AI draft (values it KEPT but flagged), kept apart from
    // `unmatched` (values it could not use and dropped). Both come off the same
    // draft; only the second one means "you must type this yourself".
    var scanWarnings by remember { mutableStateOf<List<DeviceWarning>>(emptyList()) }
    var aiOptIn by remember { mutableStateOf(false) }

    // Seeds the form from an extracted draft. Category only applied when it
    // matches a known catalog code; brand/place set verbatim. Never persists —
    // the user reviews & taps save.
    fun applyDraft(d: DraftDevice) {
        d.name?.takeIf { it.isNotBlank() }?.let { name = it }
        d.category?.let { c ->
            if (categoryOptions.any { it.code.equals(c, ignoreCase = true) }) category = c
        }
        d.brand?.takeIf { it.isNotBlank() }?.let { brand = it }
        d.model?.takeIf { it.isNotBlank() }?.let { model = it }
        d.serialNumber?.takeIf { it.isNotBlank() }?.let { serial = it }
        d.purchaseDate?.takeIf { it.isNotBlank() }?.let { purchaseDate = it }
        d.purchasePrice?.let { price = it.toString() }
        d.purchasePlace?.takeIf { it.isNotBlank() }?.let { purchasePlace = it }
        d.warrantyMonths?.let { months = it.toString() }
    }

    // One path for both pickers: sniff the real type → send as-is or transcode
    // to JPEG → POST. A PDF takes the "as-is" branch, an image photo the same
    // one (a HEIC/GIF image is re-encoded first, see ReceiptFiles.plan).
    fun startScan(uri: Uri) {
        scope.launch {
            scanning = true
            error = null
            scanInfo = null
            scanWarnings = emptyList()
            try {
                val draft = extractReceiptFromUri(context, s, api, uri)
                applyDraft(draft)
                scanInfo = draft
                scanWarnings = draft.warnings
            } catch (e: Exception) {
                error = e.toUserMessage(ApiClient.json)
            } finally {
                scanning = false
            }
        }
    }

    val receiptPicker = rememberLauncherForActivityResult(
        ActivityResultContracts.PickVisualMedia(),
    ) { uri: Uri? ->
        if (uri != null) startScan(uri)
    }

    // PDF receipts (roadmap #15). The photo picker cannot return a PDF at all,
    // so the widened scan flow adds the document picker next to it instead of
    // replacing it — the image path (camera / gallery) stays exactly as it was.
    val receiptPdfPicker = rememberLauncherForActivityResult(
        ActivityResultContracts.OpenDocument(),
    ) { uri: Uri? ->
        if (uri != null) startScan(uri)
    }

    LaunchedEffect(Unit) {
        if (!isEdit) {
            runCatching { api.getAIOptIn() }.onSuccess { aiOptIn = it.aiOptIn }
        }
        runCatching { api.catalog() }
            .onSuccess {
                categoryOptions = it.categories
                brandOptions = it.brands
                storeOptions = it.stores
            }
            .onFailure {
                // Offline fallback: the full catalog, straight from the one
                // shared label table — not a hand-copied shortlist.
                categoryOptions = CategoryLabels.table.map { CategoryOption(it.key, it.value) }
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
                if (isEdit) stringResource(R.string.devadd_edit_device) else stringResource(R.string.dev_add_device),
                fontSize = 18.sp, fontWeight = FontWeight.SemiBold,
            )

            if (!isEdit && aiOptIn) {
                OutlinedButton(
                    onClick = {
                        receiptPicker.launch(
                            PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly),
                        )
                    },
                    enabled = !scanning,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    if (scanning) {
                        CircularProgressIndicator(
                            modifier = Modifier.width(18.dp).height(18.dp),
                            strokeWidth = 2.dp,
                        )
                    } else {
                        Icon(Icons.Outlined.DocumentScanner, contentDescription = null)
                    }
                    Spacer(Modifier.width(8.dp))
                    Text(if (scanning) stringResource(R.string.devadd_scanning_the_invoice) else stringResource(R.string.devadd_scan_an_invoice_warranty_slip))
                }
                // PDF receipts: the Go endpoint takes a PDF as a `document`
                // block, which the photo picker can't hand over.
                OutlinedButton(
                    onClick = { receiptPdfPicker.launch(arrayOf("application/pdf")) },
                    enabled = !scanning,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Icon(Icons.Filled.PictureAsPdf, contentDescription = null)
                    Spacer(Modifier.width(8.dp))
                    Text(stringResource(R.string.devadd_choose_a_pdf_invoice))
                }
                Text(
                    stringResource(R.string.devadd_scan_hint),
                    fontSize = 12.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                scanInfo?.let { d ->
                    val head = if (d.confidence == "high") {
                        stringResource(R.string.devadd_draft_filled_in_from_the_invoice)
                    } else {
                        stringResource(R.string.devadd_draft_filled_in_the_confidence_is)
                    }
                    Text(
                        head,
                        fontSize = 12.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    // Two different meanings, two different lines:
                    //   unmatched = we could not use it (you must enter it),
                    //   warnings  = we used it but it looks wrong (still saved).
                    val review = draftReview(s, d)
                    review.unmatched?.let {
                        Text(
                            it,
                            fontSize = 12.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    review.warnings?.let {
                        Text(
                            it,
                            fontSize = 12.sp,
                            color = WVAccent.current.warning,
                        )
                    }
                }
            }

            SheetGroup {
                OutlinedTextField(
                    value = name, onValueChange = { name = it },
                    label = { Text(stringResource(R.string.devadd_device_name)) },
                    modifier = Modifier.fillMaxWidth(),
                )
                CategoryDropdown(
                    options = categoryOptions,
                    selected = category,
                    onSelected = { category = it },
                )
                BrandAutocomplete(
                    category = category,
                    brands = brandOptions,
                    value = brand,
                    onValueChange = { brand = it },
                )
                OutlinedTextField(
                    value = model, onValueChange = { model = it },
                    label = { Text("Model") },
                    modifier = Modifier.fillMaxWidth(),
                )
                // Amber advisory under the serial box when the scan flagged the
                // value it kept. Not `isError`: the serial is legitimate until
                // proven otherwise and the save must not look blocked.
                val serialWarning = deviceWarningsForField(scanWarnings).firstOrNull()
                OutlinedTextField(
                    value = serial,
                    onValueChange = {
                        serial = it
                        scanWarnings = emptyList()
                    },
                    label = { Text(stringResource(R.string.devadd_serial_number)) },
                    supportingText = serialWarning?.let {
                        {
                            Text(
                                deviceWarningMessage(s, it),
                                color = WVAccent.current.warning,
                            )
                        }
                    },
                    modifier = Modifier.fillMaxWidth(),
                )
            }

            SheetGroup {
                OutlinedTextField(
                    value = price, onValueChange = { price = it.filter { c -> c.isDigit() } },
                    label = { Text(stringResource(R.string.devadd_price_vnd)) },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = purchaseDate, onValueChange = { purchaseDate = it },
                    label = { Text(stringResource(R.string.devadd_purchase_date_yyyy_mm_dd)) },
                    modifier = Modifier.fillMaxWidth(),
                )
                StoreAutocompleteField(
                    stores = storeOptions,
                    value = purchasePlace,
                    onValueChange = { purchasePlace = it },
                )
                // Warranty fields are only relevant when creating — edit mode keeps
                // existing warranty rows untouched and exposes them on the detail
                // screen.
                if (!isEdit) {
                    OutlinedTextField(
                        value = months,
                        onValueChange = { months = it.filter { c -> c.isDigit() } },
                        label = { Text(stringResource(R.string.devadd_warranty_length_months)) },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }

            // Resale (roadmap #12). The server owns the pair rule: exactly one of
            // the two is a 400, so its field errors are surfaced under the fields
            // instead of being pre-empted by a local check.
            SheetGroup {
                Text(
                    stringResource(R.string.devadd_resale_details_optional),
                    fontSize = 13.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                OutlinedTextField(
                    value = soldPrice,
                    onValueChange = {
                        soldPrice = it.filter { c -> c.isDigit() }
                        fieldErrors = fieldErrors - "soldPrice"
                    },
                    label = { Text(stringResource(R.string.devadd_sale_price_vnd)) },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    isError = firstFieldError("soldPrice") != null,
                    supportingText = firstFieldError("soldPrice")?.let {
                        { Text(it, color = MaterialTheme.colorScheme.error) }
                    },
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = soldDate,
                    onValueChange = {
                        soldDate = it
                        fieldErrors = fieldErrors - "soldAt"
                    },
                    label = { Text(stringResource(R.string.devadd_sale_date_yyyy_mm_dd)) },
                    isError = firstFieldError("soldAt") != null,
                    supportingText = firstFieldError("soldAt")?.let {
                        { Text(it, color = MaterialTheme.colorScheme.error) }
                    },
                    modifier = Modifier.fillMaxWidth(),
                )
                Text(
                    stringResource(R.string.devadd_fill_in_both_to_record_a),
                    fontSize = 12.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            SheetGroup {
                if (isEdit) {
                    StatusDropdown(selected = status, onSelected = { status = it })
                }
                OutlinedTextField(
                    value = notes, onValueChange = { notes = it },
                    label = { Text(stringResource(R.string.devadd_note)) },
                    modifier = Modifier.fillMaxWidth(),
                )
            }

            error?.let {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Outlined.WarningAmber, null,
                        tint = MaterialTheme.colorScheme.error)
                    Spacer(Modifier.width(4.dp))
                    Text(it, color = MaterialTheme.colorScheme.error, fontSize = 13.sp)
                }
            }

            Button(
                onClick = {
                    scope.launch {
                        submitting = true; error = null; fieldErrors = emptyMap()
                        val input = DeviceInput(
                            name = name.trim(),
                            category = category,
                            brand = brand.ifBlank { null },
                            model = model.ifBlank { null },
                            serialNumber = serial.ifBlank { null },
                            purchaseDate = purchaseDate,
                            purchasePrice = price.toIntOrNull() ?: 0,
                            purchasePlace = purchasePlace.ifBlank { null },
                            status = status,
                            notes = notes.ifBlank { null },
                            // Both blank ⇒ null ⇒ the server clears any recorded
                            // sale (the keys are then omitted, which Go decodes
                            // as nil exactly like an explicit null).
                            soldAt = soldDateRequest(soldDate),
                            soldPrice = soldPriceRequest(soldPrice),
                            // Round-tripped verbatim so an edit here can never
                            // clear a window another client recorded. On create
                            // both are blank ⇒ null ⇒ nothing was recorded, and
                            // nothing can be erased.
                            returnWindowDays = returnWindowDaysRequest(returnWindowDays),
                            receivedAt = receivedAtRequest(receivedAt),
                            warrantyMonths = if (isEdit) 0 else (months.toIntOrNull() ?: 0),
                        )
                        try {
                            val res = if (existing != null) {
                                api.updateDevice(existing.id, input)
                            } else {
                                api.createDevice(input)
                            }
                            // Success: hand the host the device AND the advisories
                            // it came back with, so they survive the dismiss.
                            onSaved(res.device, res.warnings)
                        } catch (e: Exception) {
                            val fe = e.fieldErrors(ApiClient.json)
                            fieldErrors = fe
                            // soldAt/soldPrice are rendered under their own fields;
                            // every other server error still needs a visible place.
                            val inline = setOf("soldAt", "soldPrice")
                            error = if (fe.isEmpty() || fe.keys.any { it !in inline }) {
                                e.toUserMessage(ApiClient.json)
                            } else {
                                null
                            }
                        } finally {
                            submitting = false
                        }
                    }
                },
                enabled = name.isNotBlank() && purchaseDate.isNotBlank() && !submitting,
                shape = CircleShape,
                colors = ButtonDefaults.buttonColors(
                    containerColor = MaterialTheme.colorScheme.primary,
                ),
                modifier = Modifier.fillMaxWidth().height(52.dp),
            ) {
                if (submitting) {
                    CircularProgressIndicator(
                        strokeWidth = 2.dp,
                        modifier = Modifier.height(20.dp),
                        color = MaterialTheme.colorScheme.onPrimary,
                    )
                } else {
                    Text(
                        if (isEdit) stringResource(R.string.devadd_update) else stringResource(R.string.action_save),
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
private fun CategoryDropdown(
    options: List<CategoryOption>,
    selected: String,
    onSelected: (String) -> Unit,
) {
    var expanded by remember { mutableStateOf(false) }
    val selectedLabel = options.firstOrNull { it.code == selected }?.name ?: selected

    ExposedDropdownMenuBox(
        expanded = expanded,
        onExpandedChange = { expanded = it },
    ) {
        TextField(
            value = selectedLabel,
            onValueChange = {},
            readOnly = true,
            label = { Text(stringResource(R.string.devadd_category)) },
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = expanded) },
            modifier = Modifier
                .fillMaxWidth()
                .menuAnchor(MenuAnchorType.PrimaryNotEditable),
        )
        ExposedDropdownMenu(
            expanded = expanded,
            onDismissRequest = { expanded = false },
        ) {
            options.forEach { opt ->
                DropdownMenuItem(
                    text = { Text(opt.name) },
                    onClick = {
                        onSelected(opt.code)
                        expanded = false
                    },
                )
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun StatusDropdown(
    selected: DeviceStatus,
    onSelected: (DeviceStatus) -> Unit,
) {
    var expanded by remember { mutableStateOf(false) }
    ExposedDropdownMenuBox(
        expanded = expanded,
        onExpandedChange = { expanded = it },
    ) {
        TextField(
            value = stringResource(selected.labelRes),
            onValueChange = {},
            readOnly = true,
            label = { Text(stringResource(R.string.devadd_status)) },
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = expanded) },
            modifier = Modifier
                .fillMaxWidth()
                .menuAnchor(MenuAnchorType.PrimaryNotEditable),
        )
        ExposedDropdownMenu(
            expanded = expanded,
            onDismissRequest = { expanded = false },
        ) {
            DeviceStatus.entries.forEach { s ->
                DropdownMenuItem(
                    text = { Text(stringResource(s.labelRes)) },
                    onClick = { onSelected(s); expanded = false },
                )
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun BrandAutocomplete(
    category: String,
    brands: List<BrandOption>,
    value: String,
    onValueChange: (String) -> Unit,
) {
    val filtered = remember(category, brands, value) {
        brands
            .filter { it.categoryCodes.isEmpty() || it.categoryCodes.contains(category) }
            .filter {
                value.isBlank() || it.name.contains(value, ignoreCase = true)
            }
            .take(8)
    }
    var expanded by remember { mutableStateOf(false) }

    ExposedDropdownMenuBox(
        expanded = expanded && filtered.isNotEmpty(),
        onExpandedChange = { expanded = it },
    ) {
        OutlinedTextField(
            value = value,
            onValueChange = {
                onValueChange(it)
                expanded = true
            },
            label = { Text(stringResource(R.string.devadd_brand)) },
            modifier = Modifier
                .fillMaxWidth()
                .menuAnchor(MenuAnchorType.PrimaryEditable),
        )
        if (filtered.isNotEmpty()) {
            ExposedDropdownMenu(
                expanded = expanded,
                onDismissRequest = { expanded = false },
            ) {
                filtered.forEach { b ->
                    DropdownMenuItem(
                        text = { Text(b.name) },
                        onClick = {
                            onValueChange(b.name)
                            expanded = false
                        },
                    )
                }
            }
        }
    }
}

private fun today(): String =
    SimpleDateFormat("yyyy-MM-dd", Locale.US)
        .apply { timeZone = java.util.TimeZone.getTimeZone("UTC") }
        .format(Date())

// Reads the picked receipt (an image from the photo picker, or a PDF from the
// document picker), sends it to the Go OCR endpoint, returns the draft. The
// server decrypts/validates/maps and never persists — the caller seeds the form
// and the user confirms.
//
// The multipart Content-Type is what the MAGIC BYTES say, not what the content
// provider claims: the handler compares the declared type against the received
// bytes (`files.DetectAndValidate`) and 400s on a mismatch, and providers do
// mislabel HEIC photos as `image/jpeg`. A PDF is sent byte-for-byte — it is a
// `document` block on the server side and must never be decoded as an image;
// only HEIC/GIF take the client-side JPEG transcode.
private suspend fun extractReceiptFromUri(
    context: android.content.Context,
    s: AppStrings,
    api: ApiService,
    uri: Uri,
): DraftDevice {
    val resolver = context.contentResolver
    val bytes = withContext(Dispatchers.IO) {
        resolver.openInputStream(uri)?.use { it.readBytes() }
    } ?: throw IllegalStateException(context.getString(R.string.devadd_could_not_read_file))
    val part = when (val plan = ReceiptFiles.plan(bytes)) {
        is ReceiptPlan.SendAsIs -> receiptPart(bytes, plan.mime, plan.fileName)
        ReceiptPlan.TranscodeToJpeg -> {
            val jpeg = transcodeReceiptToJpeg(s, bytes)
            receiptPart(jpeg, "image/jpeg", "receipt.jpg")
        }
        ReceiptPlan.Unsupported -> throw IllegalStateException(context.getString(ReceiptFiles.UNSUPPORTED_MESSAGE))
    }
    return api.extractReceipt(part).draft
}

private fun receiptPart(bytes: ByteArray, mime: String, fileName: String): MultipartBody.Part {
    val body: RequestBody = bytes.toRequestBody(mime.toMediaTypeOrNull())
    return MultipartBody.Part.createFormData("file", fileName, body)
}
