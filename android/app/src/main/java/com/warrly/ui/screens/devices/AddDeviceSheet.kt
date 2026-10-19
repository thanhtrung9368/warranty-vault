package com.warrly.ui.screens.devices

import android.Manifest
import android.content.pm.PackageManager
import android.net.Uri
import android.widget.Toast
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
import androidx.compose.material.icons.outlined.CurrencyExchange
import androidx.compose.material.icons.outlined.DocumentScanner
import androidx.compose.material.icons.outlined.QrCodeScanner
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.MenuAnchorType
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TextField
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import com.warrly.R
import com.warrly.i18n.AppStrings
import com.warrly.i18n.appStrings
import com.warrly.network.ApiClient
import com.warrly.network.ApiService
import com.warrly.network.BrandOption
import com.warrly.network.CategoryOption
import com.warrly.network.DEFAULT_CURRENCY
import com.warrly.network.DEFAULT_LEAD_DAYS
import com.warrly.network.Device
import com.warrly.network.DeviceInput
import com.warrly.network.DeviceStatus
import com.warrly.network.DeviceWarning
import com.warrly.network.DraftDevice
import com.warrly.network.StoreOption
import com.warrly.network.fieldErrors
import com.warrly.network.leadDaysForRequest
import com.warrly.network.normalizeLeadDays
import com.warrly.network.toUserMessage
import com.warrly.ui.components.CategoryLabels
import com.warrly.ui.components.LeadDaysPicker
import com.warrly.ui.components.SheetGroup
import com.warrly.ui.screens.common.StoreAutocompleteField
import com.warrly.ui.theme.WVAccent
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
    /**
     * Opens the capture-first inbox. Only meaningful on the **create** flow,
     * where a receipt scan has already uploaded its file there (see
     * `startScan`); the edit flow cannot scan, so its host leaves this null.
     *
     * The host is expected to close this sheet before switching tabs — a file
     * that is now in the inbox should be reachable from the screen that shows
     * the inbox, not buried under a modal.
     */
    onOpenInbox: (() -> Unit)? = null,
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
    // Multi-currency device. `currency` is the ISO code sent back on every save;
    // `fxRateText` is the locked VND-per-unit rate the user typed or fetched.
    // Both are loaded from `existing` so an edit can never relabel a foreign
    // device as dong or drop the rate a previous client stored.
    var currency by remember { mutableStateOf(normalizeCurrency(existing?.currency)) }
    var fxRateText by remember { mutableStateOf(existing?.fxRate?.toString().orEmpty()) }
    var fxLoading by remember { mutableStateOf(false) }
    var fxNotice by remember { mutableStateOf<FxNotice?>(null) }
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
    // Reminder schedule (`leadDays`) — editable here, unlike the read-only return
    // window above. The API accepts 1..5 days, each 0..365; the picker normalises
    // every change, so this state is always sorted descending and de-duped. A
    // device loaded from a server that predates the field decodes to the old
    // fixed schedule (30/7), so an edit can never blank it.
    var leadDays by remember {
        mutableStateOf(normalizeLeadDays(existing?.leadDays ?: DEFAULT_LEAD_DAYS))
    }
    // Warranty activation + extended-cover deadline (DeviceActivation.kt).
    // `activationRequired` is a plain boolean; the two dates use the same
    // `take(10)` wire shape as `purchaseDate`. Nothing compares the activation
    // date with the purchase date: a shop may pre-activate before the invoice.
    var activationRequired by remember {
        mutableStateOf(existing?.activationRequired ?: false)
    }
    var activatedAt by remember { mutableStateOf(activatedAtInput(existing?.activatedAt)) }
    var extendedCoverBuyBy by remember {
        mutableStateOf(extendedCoverBuyByInput(existing?.extendedCoverBuyBy))
    }
    // Brand warranty lookup. The five fields are loaded so an edit can never
    // erase a record another client captured (PATCH replaces the whole row), and
    // are updated in place when the user records an answer from the brand's page
    // before saving. `null` on a brand-new device, which is the contract's
    // "never checked" state.
    var brandWarrantyDraft by remember {
        mutableStateOf(existing?.let { brandWarrantyDraftOf(it) } ?: BrandWarrantyDraft())
    }

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
    val keyboardController = LocalSoftwareKeyboardController.current
    var scanning by remember { mutableStateOf(false) }
    var scanInfo by remember { mutableStateOf<DraftDevice?>(null) }
    // Warnings from the AI draft (values it KEPT but flagged), kept apart from
    // `unmatched` (values it could not use and dropped). Both come off the same
    // draft; only the second one means "you must type this yourself".
    var scanWarnings by remember { mutableStateOf<List<DeviceWarning>>(emptyList()) }
    var aiOptIn by remember { mutableStateOf(false) }

    /**
     * `GET /api/v1/fx/rates?base=<currency>` — the "Lấy tỷ giá" action.
     *
     * Success fills the rate field; `stale = true` keeps the filled value and
     * says it may be old. **503 is the documented failure**: the sheet says the
     * rate service is unavailable and leaves the field exactly as editable as it
     * was, because a rate the user types is still perfectly valid. Any other
     * failure shows the server's message.
     */
    fun fetchFxRate() {
        val code = normalizeCurrency(currency)
        if (code == DEFAULT_CURRENCY) return
        scope.launch {
            fxLoading = true
            fxNotice = null
            try {
                val rates = api.getFxRates(code)
                val rate = rateToVnd(code, rates.rates)
                if (rate == null) {
                    fxNotice = FxNotice(s.get(R.string.devadd_fx_no_vnd_quote, code), isError = true)
                } else {
                    fxRateText = rate.toString()
                    fieldErrors = fieldErrors - "fxRate"
                    fxNotice = if (rates.stale) {
                        FxNotice(s.get(R.string.devadd_fx_stale), isError = false)
                    } else {
                        null
                    }
                }
            } catch (e: kotlinx.coroutines.CancellationException) {
                throw e
            } catch (e: retrofit2.HttpException) {
                fxNotice = if (e.code() == 503) {
                    FxNotice(s.get(R.string.devadd_fx_unavailable), isError = true)
                } else {
                    FxNotice(
                        s.get(R.string.devadd_fx_failed, e.toUserMessage(ApiClient.json, context)),
                        isError = true,
                    )
                }
            } catch (e: Exception) {
                fxNotice = FxNotice(
                    s.get(R.string.devadd_fx_failed, e.toUserMessage(ApiClient.json, context)),
                    isError = true,
                )
            } finally {
                fxLoading = false
            }
        }
    }

    // ---- Serial / IMEI scan -------------------------------------------------
    // The camera is the highest-value way into this form: the serial is the
    // field users mistype and the one every service centre asks for. The result
    // goes into the very same `serial` state as typing (see the trailing icon
    // below) — it is a draft the user can edit, and nothing is saved until Save.
    var showSerialScanner by rememberSaveable { mutableStateOf(false) }
    // `null` = no permission problem on screen. ASK_AGAIN vs BLOCKED decides
    // whether the dialog offers a retry or the Settings route (see
    // `cameraPermissionProblem`); a plain "denied" toast would leave a
    // permanently-denied user with no way forward.
    var cameraProblem by remember { mutableStateOf<CameraPermissionProblem?>(null) }

    val cameraPermission = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted ->
        if (granted) {
            showSerialScanner = true
        } else {
            // Read AFTER the answer: `shouldShowRequestPermissionRationale` is
            // also false before the first request, so asking it earlier would
            // misreport "blocked" on the very first denial.
            val activity = context.findActivity()
            val canAskAgain = activity != null && ActivityCompat.shouldShowRequestPermissionRationale(
                activity,
                Manifest.permission.CAMERA,
            )
            cameraProblem = cameraPermissionProblem(granted, canAskAgain)
        }
    }

    fun openSerialScanner() {
        // The tapped icon lives inside a focused text field, so the IME is almost
        // certainly up. Leaving it up lets it squeeze the dialog's camera preview
        // (a separate window), which is the last thing a scanner needs.
        keyboardController?.hide()
        val granted = ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) ==
            PackageManager.PERMISSION_GRANTED
        if (granted) showSerialScanner = true else cameraPermission.launch(Manifest.permission.CAMERA)
    }

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

    // One path for both pickers: upload the file to the inbox first, then ask
    // the server to read that attachment. Uploading first is what makes the OCR
    // transcript searchable: only the `attachmentId` branch has a row to persist
    // it on (`extractedTextStored=true`). The old one-shot multipart call had no
    // attachment, so it returned the draft and threw the text away.
    //
    // A successful upload is a real inbox item *before* the user saves anything.
    // If extraction then fails there is no draft to explain it, so the flow
    // deletes the file it just created (see `scanReceiptFromUri`); if that delete
    // fails the error sentence says the file is still in the inbox.
    fun startScan(uri: Uri) {
        scope.launch {
            scanning = true
            error = null
            scanInfo = null
            scanWarnings = emptyList()
            try {
                val draft = scanReceiptFromUri(context, s, api, uri)
                applyDraft(draft)
                scanInfo = draft
                scanWarnings = draft.warnings
            } catch (e: ReceiptScanFailed) {
                error = receiptScanFailureMessage(
                    s,
                    e.failure.toUserMessage(ApiClient.json, context),
                    e.cleanup,
                )
            } catch (e: kotlinx.coroutines.CancellationException) {
                // Leaving the sheet mid-scan is a cancellation, not a failed
                // scan: do not paint an error, and do not try to clean up in a
                // coroutine that is already being torn down.
                throw e
            } catch (e: Exception) {
                error = e.toUserMessage(ApiClient.json, context)
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
                    // The file exists in the inbox NOW — before Save, and even
                    // if the form is abandoned. The draft above only fills
                    // fields; it does not own the upload. Say both things
                    // plainly, and give the user the one tap that reaches the
                    // file. `extractedTextStored` decides whether the second
                    // sentence promises search or admits it did not persist.
                    Text(
                        receiptInboxNotice(s, d.extractedTextStored),
                        fontSize = 12.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    onOpenInbox?.let { openInbox ->
                        TextButton(onClick = openInbox) {
                            Text(stringResource(R.string.devadd_open_inbox))
                        }
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
                //
                // The trailing icon is the serial/IMEI scan action: the field is
                // exactly where the user is about to type the number off the box,
                // so the camera belongs there rather than in the sheet header. A
                // scan only fills this state — the edit + Save flow is unchanged.
                val serialWarning = deviceWarningsForField(scanWarnings).firstOrNull()
                OutlinedTextField(
                    value = serial,
                    onValueChange = {
                        serial = it
                        scanWarnings = emptyList()
                    },
                    label = { Text(stringResource(R.string.devadd_serial_number)) },
                    trailingIcon = {
                        IconButton(onClick = { openSerialScanner() }) {
                            Icon(
                                Icons.Outlined.QrCodeScanner,
                                stringResource(R.string.scan_action),
                            )
                        }
                    },
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
                // Price and currency side by side: the amount is meaningless
                // without the unit, and a non-VND device always needs a locked
                // rate. The price field holds the amount in the device's own
                // currency; the rate field's supporting text shows the VND value
                // that will be stored, so the two can never be confused.
                Row(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.Top,
                ) {
                    OutlinedTextField(
                        value = price,
                        onValueChange = { price = it.filter { c -> c.isDigit() } },
                        label = { Text(stringResource(R.string.devadd_price)) },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                        modifier = Modifier.weight(1f),
                    )
                    CurrencyDropdown(
                        selected = currency,
                        options = currencyOptions(currency),
                        onSelected = { picked ->
                            val next = normalizeCurrency(picked)
                            if (next != normalizeCurrency(currency)) {
                                // A rate for the old currency is not a rate for
                                // the new one; clear it rather than silently
                                // storing the wrong conversion.
                                currency = next
                                fxRateText = ""
                                fxNotice = null
                            }
                            fieldErrors = fieldErrors - "currency" - "fxRate"
                        },
                    )
                }
                if (normalizeCurrency(currency) != DEFAULT_CURRENCY) {
                    val parsedRate = parseFxRate(fxRateText)
                    // No price typed yet ⇒ no preview (a "₫0" line would look
                    // like the app had stored something).
                    val equivalent = price
                        .takeIf { it.isNotBlank() }
                        ?.toIntOrNull()
                        ?.let { priceVnd(it, parsedRate) }
                    val rateError = firstFieldError("fxRate")
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalAlignment = Alignment.Top,
                    ) {
                        OutlinedTextField(
                            value = fxRateText,
                            onValueChange = {
                                fxRateText = it.filter { c -> c.isDigit() }
                                fxNotice = null
                                fieldErrors = fieldErrors - "fxRate"
                            },
                            label = { Text(stringResource(R.string.devadd_fx_rate, currency)) },
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                            isError = rateError != null,
                            supportingText = {
                                Column {
                                    rateError?.let {
                                        Text(it, color = MaterialTheme.colorScheme.error)
                                    }
                                    if (fxRateText.isBlank()) {
                                        Text(stringResource(R.string.devadd_fx_required_hint))
                                    }
                                    // What the server will actually store. Shown
                                    // only once a rate parses; never added to a
                                    // total — it is a pre-save preview.
                                    equivalent?.let {
                                        Text(
                                            stringResource(
                                                R.string.devadd_fx_equivalent,
                                                formatVnd(it),
                                            ),
                                        )
                                    }
                                    fxNotice?.let { notice ->
                                        Text(
                                            notice.text,
                                            color = if (notice.isError) {
                                                MaterialTheme.colorScheme.error
                                            } else {
                                                WVAccent.current.warning
                                            },
                                        )
                                    }
                                }
                            },
                            modifier = Modifier.weight(1f),
                        )
                        OutlinedButton(
                            onClick = { fetchFxRate() },
                            enabled = !fxLoading,
                            modifier = Modifier.padding(top = 4.dp),
                        ) {
                            if (fxLoading) {
                                CircularProgressIndicator(
                                    modifier = Modifier.width(18.dp).height(18.dp),
                                    strokeWidth = 2.dp,
                                )
                            } else {
                                Icon(Icons.Outlined.CurrencyExchange, contentDescription = null)
                            }
                            Spacer(Modifier.width(6.dp))
                            Text(
                                if (fxLoading) {
                                    stringResource(R.string.devadd_fx_fetching)
                                } else {
                                    stringResource(R.string.devadd_fetch_rate)
                                },
                            )
                        }
                    }
                }
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

            // Warranty activation and the extended-cover deadline — the three
            // fields the Vietnamese retail reality needs and a plain "purchase
            // date" form cannot express. Its own small group inside the warranty
            // part of the form, not a new step: the date field appears with the
            // switch, or whenever a date already exists (a pre-activated device
            // keeps its date visible even if the switch is off).
            SheetGroup {
                Text(
                    stringResource(R.string.devadd_warranty_activation),
                    fontSize = 13.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        stringResource(R.string.devadd_activation_required),
                        fontSize = 14.sp,
                        modifier = Modifier.weight(1f),
                    )
                    Switch(
                        checked = activationRequired,
                        onCheckedChange = {
                            activationRequired = it
                            fieldErrors = fieldErrors - "activationRequired"
                        },
                    )
                }
                if (showsActivationDate(activationRequired, activatedAt)) {
                    OutlinedTextField(
                        value = activatedAt,
                        onValueChange = {
                            activatedAt = it
                            fieldErrors = fieldErrors - "activatedAt"
                        },
                        label = { Text(stringResource(R.string.devadd_activated_on_yyyy_mm_dd)) },
                        isError = firstFieldError("activatedAt") != null,
                        supportingText = firstFieldError("activatedAt")?.let {
                            { Text(it, color = MaterialTheme.colorScheme.error) }
                        },
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
                OutlinedTextField(
                    value = extendedCoverBuyBy,
                    onValueChange = {
                        extendedCoverBuyBy = it
                        fieldErrors = fieldErrors - "extendedCoverBuyBy"
                    },
                    label = {
                        Text(stringResource(R.string.devadd_extended_cover_buy_by_yyyy_mm_dd))
                    },
                    isError = firstFieldError("extendedCoverBuyBy") != null,
                    supportingText = firstFieldError("extendedCoverBuyBy")?.let {
                        { Text(it, color = MaterialTheme.colorScheme.error) }
                    },
                    modifier = Modifier.fillMaxWidth(),
                )
                Text(
                    stringResource(R.string.devadd_warranty_activation_hint),
                    fontSize = 12.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            // Brand warranty lookup. Its own group because it is a different
            // source of dates from the plan above: the manufacturer's system,
            // not the invoice. The block only updates form state — the save
            // button sends the five fields with the rest of the device.
            SheetGroup {
                BrandWarrantyFormBlock(
                    api = api,
                    brandName = brand,
                    brands = brandOptions,
                    draft = brandWarrantyDraft,
                    onDraftChange = { brandWarrantyDraft = it },
                )
            }

            // Reminder lead time. Its own group because it applies to every
            // warranty on the device, not to the purchase fields above; the
            // picker matches the sheet's other rows (label + controls + hint).
            SheetGroup {
                LeadDaysPicker(
                    days = leadDays,
                    onDaysChange = {
                        leadDays = it
                        fieldErrors = fieldErrors - "leadDays"
                    },
                    error = firstFieldError("leadDays"),
                )
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
                    label = {
                        // Sale price is in the same native currency as the
                        // purchase price, not always dong.
                        Text(stringResource(R.string.devadd_sale_price_currency, currency))
                    },
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
                            // Currency + the rate locked now. For VND the rate
                            // is null (and `explicitNulls = false` drops the key);
                            // the Save button refuses a foreign currency without
                            // one, so the server's 400 is unreachable from here.
                            currency = normalizeCurrency(currency),
                            fxRate = fxRateForRequest(currency, fxRateText),
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
                            // Activation + extended cover. A blank date drops the
                            // key, which the update contract reads as "unchanged";
                            // `activationRequired` is always encoded so turning
                            // the switch off really sends `false`.
                            activationRequired = activationRequired,
                            activatedAt = activatedAtRequest(activatedAt),
                            extendedCoverBuyBy = extendedCoverBuyByRequest(extendedCoverBuyBy),
                            // Already normalised by the picker; `leadDaysForRequest`
                            // drops the key only if the list is empty (which the
                            // disabled Save button prevents).
                            leadDays = leadDaysForRequest(leadDays),
                            // The brand's own answer, recorded from its lookup
                            // page. Loaded from `existing` and sent straight back
                            // — omitting it would erase a record on every edit.
                            // The record sheet enforces the API's status/date/URL
                            // rules before it reaches this field set.
                            brandWarrantyStatus = brandWarrantyDraft.status,
                            brandWarrantyStart = brandWarrantyDraft.startDate,
                            brandWarrantyEnd = brandWarrantyDraft.endDate,
                            brandCheckedAt = brandWarrantyDraft.checkedAt,
                            brandLookupUrl = brandWarrantyDraft.lookupUrl,
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
                            // soldAt/soldPrice/leadDays are rendered under their own
                            // fields; every other server error still needs a visible place.
                            // `fxRate` only has a field while the SUBMITTED currency is
                            // non-VND — if the user flipped the picker while the request
                            // was in flight, fall back to the top-level error instead of
                            // hiding it under a field that is no longer on screen.
                            val inline = buildSet {
                                add("soldAt")
                                add("soldPrice")
                                add("leadDays")
                                add("activationRequired")
                                add("activatedAt")
                                add("extendedCoverBuyBy")
                                if (normalizeCurrency(input.currency) != DEFAULT_CURRENCY) {
                                    add("fxRate")
                                }
                            }
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
                // At least one lead day is required by the API (an empty array is a
                // 400), so an emptied schedule blocks Save instead of producing it.
                // A non-VND currency without a positive locked rate is the other
                // contract-required pair: block it here rather than learn it from
                // a 400 `fieldErrors.fxRate`.
                enabled = name.isNotBlank() && purchaseDate.isNotBlank() &&
                    leadDays.isNotEmpty() && !fxRateRequired(currency, fxRateText) &&
                    !submitting,
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

    // The scanner is a dialog ON TOP of this sheet, so the form and everything
    // already typed stays underneath. `onPicked` only seeds `serial`; the user
    // can still edit it and Save is still a separate tap.
    if (showSerialScanner) {
        SerialScannerDialog(
            onDismiss = { showSerialScanner = false },
            onPicked = { value ->
                serial = value
                // A value that replaced the previous serial invalidates the
                // warnings that were about the old one.
                scanWarnings = emptyList()
                showSerialScanner = false
            },
        )
    }

    // Permission refused. Two different situations, two different routes: a
    // retry while the OS will still show the dialog, otherwise the app's
    // settings page (the only way back after "don't ask again").
    cameraProblem?.let { problem ->
        AlertDialog(
            onDismissRequest = { cameraProblem = null },
            title = { Text(stringResource(R.string.scan_permission_title)) },
            text = {
                Text(
                    stringResource(
                        if (problem == CameraPermissionProblem.BLOCKED) {
                            R.string.scan_permission_blocked
                        } else {
                            R.string.scan_permission_ask_again
                        },
                    ),
                )
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        cameraProblem = null
                        if (problem == CameraPermissionProblem.BLOCKED) {
                            if (!openAppSettings(context)) {
                                Toast.makeText(
                                    context,
                                    R.string.scan_settings_unavailable,
                                    Toast.LENGTH_LONG,
                                ).show()
                            }
                        } else {
                            cameraPermission.launch(Manifest.permission.CAMERA)
                        }
                    },
                ) {
                    Text(
                        stringResource(
                            if (problem == CameraPermissionProblem.BLOCKED) {
                                R.string.scan_permission_settings
                            } else {
                                R.string.scan_permission_retry
                            },
                        ),
                    )
                }
            },
            dismissButton = {
                TextButton(onClick = { cameraProblem = null }) {
                    Text(stringResource(R.string.scan_permission_later))
                }
            },
        )
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
private fun CurrencyDropdown(
    selected: String,
    options: List<String>,
    onSelected: (String) -> Unit,
) {
    var expanded by remember { mutableStateOf(false) }
    ExposedDropdownMenuBox(
        expanded = expanded,
        onExpandedChange = { expanded = it },
        modifier = Modifier.width(116.dp),
    ) {
        OutlinedTextField(
            value = selected,
            onValueChange = {},
            readOnly = true,
            label = { Text(stringResource(R.string.devadd_currency)) },
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = expanded) },
            modifier = Modifier
                .fillMaxWidth()
                .menuAnchor(MenuAnchorType.PrimaryNotEditable),
        )
        ExposedDropdownMenu(
            expanded = expanded,
            onDismissRequest = { expanded = false },
        ) {
            options.forEach { code ->
                DropdownMenuItem(
                    text = { Text(code) },
                    onClick = {
                        onSelected(code)
                        expanded = false
                    },
                )
            }
        }
    }
}

/** A line under the rate field: an error (503, bad response) or a warning (stale). */
private data class FxNotice(val text: String, val isError: Boolean)

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
// document picker) and runs the two-call scan:
//
//   1. POST /api/v1/attachments with **no deviceId** — an inbox item. This is
//      the only way to give the OCR transcript an Attachment row to live on;
//      it also means the bytes are safely stored before the form is finished.
//   2. POST /api/v1/ai/extract-receipt `{"attachmentId": ...}` — the server
//      reads that stored file, returns the draft and persists the transcript.
//
// The multipart Content-Type is what the MAGIC BYTES say, not what the content
// provider claims: the handler compares the declared type against the received
// bytes (`files.DetectAndValidate`) and 400s on a mismatch, and providers do
// mislabel HEIC photos as `image/jpeg`. A PDF is sent byte-for-byte — it is a
// `document` block on the server side and must never be decoded as an image;
// only HEIC/GIF take the client-side JPEG transcode.
//
// If step 2 fails there is no draft, and the file uploaded in step 1 would be
// an unexplained inbox item. The compensating action is a best-effort DELETE:
// a scan that produced nothing leaves nothing behind. A failed DELETE cannot be
// retried here (the same network/token problem that failed the scan is the
// likely cause), so the outcome is reported to the sheet and the sentence says
// the file is still in the inbox. The user's original receipt is never deleted:
// re-scanning always creates a NEW attachment, so an older scan's stored text
// (and the API's deliberate "blank re-scan does not wipe it" rule) is untouched.
private suspend fun scanReceiptFromUri(
    context: android.content.Context,
    s: AppStrings,
    api: ApiService,
    uri: Uri,
): DraftDevice {
    val resolver = context.contentResolver
    val bytes = withContext(Dispatchers.IO) {
        resolver.openInputStream(uri)?.use { it.readBytes() }
    } ?: throw IllegalStateException(context.getString(R.string.devadd_could_not_read_file))

    val payload = when (val plan = ReceiptFiles.plan(bytes)) {
        is ReceiptPlan.SendAsIs -> ReceiptUpload(bytes, plan.mime, plan.fileName)
        ReceiptPlan.TranscodeToJpeg -> ReceiptUpload(
            transcodeReceiptToJpeg(s, bytes),
            "image/jpeg",
            "receipt.jpg",
        )
        ReceiptPlan.Unsupported -> throw IllegalStateException(
            context.getString(ReceiptFiles.UNSUPPORTED_MESSAGE),
        )
    }
    // The upload endpoint is now the one enforcing the 5 MB file cap. Check the
    // bytes we are about to send (after any transcode) so an oversized photo is
    // refused instantly instead of after a doomed upload.
    if (isAttachmentTooLarge(payload.bytes.size.toLong())) {
        throw IllegalStateException(context.getString(R.string.att_file_too_large))
    }

    // 1) Upload first, with NO deviceId: an inbox item.
    val uploaded = api.uploadAttachment(
        file = receiptPart(payload.bytes, payload.mime, payload.fileName),
    ).attachment

    // 2) Extract by id. This branch is what sets `extractedTextStored=true` and
    //    puts the transcript into the `attachments` search group. A missing
    //    id is treated inside the same try so the row is still cleaned up: an
    //    unusable upload must not remain as an unexplained inbox item.
    return try {
        val input = extractReceiptInput(uploaded.id)
            ?: throw IllegalStateException(context.getString(R.string.devadd_scan_upload_missing_id))
        api.extractReceipt(input).draft
    } catch (e: kotlinx.coroutines.CancellationException) {
        // The sheet is leaving the composition. Do not issue another request
        // from a coroutine that is being cancelled.
        throw e
    } catch (e: Exception) {
        val cleanup = try {
            api.deleteAttachment(uploaded.id)
            ReceiptCleanup.DELETED
        } catch (cancelled: kotlinx.coroutines.CancellationException) {
            // Cancellation is not a cleanup failure; let it propagate.
            throw cancelled
        } catch (_: Exception) {
            ReceiptCleanup.LEFT_IN_INBOX
        }
        throw ReceiptScanFailed(e, cleanup)
    }
}

/** The bytes and the type/name they must be uploaded under. */
private data class ReceiptUpload(
    val bytes: ByteArray,
    val mime: String,
    val fileName: String,
)

/**
 * Extraction failed after the upload succeeded. [failure] is the original
 * exception (its message is the user-facing detail) and [cleanup] says what
 * happened to the file the flow uploaded on the user's behalf.
 */
private class ReceiptScanFailed(
    val failure: Exception,
    val cleanup: ReceiptCleanup,
) : Exception(failure)

private fun receiptPart(bytes: ByteArray, mime: String, fileName: String): MultipartBody.Part {
    val body: RequestBody = bytes.toRequestBody(mime.toMediaTypeOrNull())
    return MultipartBody.Part.createFormData("file", fileName, body)
}
