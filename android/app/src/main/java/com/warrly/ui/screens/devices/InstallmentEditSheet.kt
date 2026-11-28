package com.warrly.ui.screens.devices

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.warrly.R
import com.warrly.network.ApiClient
import com.warrly.network.ApiService
import com.warrly.network.Device
import com.warrly.network.InstallmentInput
import com.warrly.network.fieldErrors
import com.warrly.network.toUserMessage
import com.warrly.ui.components.SheetGroup
import com.warrly.ui.screens.todayDayIso
import java.time.LocalDate
import kotlinx.coroutines.launch

/**
 * The editor for one device's installment plan ("trả góp",
 * FEATURE_RESEARCH_2026-11 §6.5, migration 0031).
 *
 * ## Why its own sheet, not the device form
 *
 * `PATCH /api/v1/devices/{id}` replaces the whole device and does not carry the
 * plan; the plan has its own `PUT` / `DELETE /api/v1/devices/{id}/installment`.
 * Keeping the editor separate means a device save can never erase the plan (the
 * reason the field is not in `DeviceInput`) and a plan validation error cannot
 * block a device edit. The same split as the web's `installment-card.tsx` and
 * iOS's `InstallmentSection.swift`.
 *
 * ## Validation
 *
 * The server is the authority and its 400 `fieldErrors` are rendered under the
 * field they belong to, already in the request's language — the pattern every
 * other write sheet follows. The checks here are the contract's numeric rules
 * that a client can catch before spending a round trip: `months` 1–60,
 * `monthlyAmount` > 0, `paidCount` 0…`months`, and a readable `firstDueAt`.
 * They are the same ranges the web form puts on its inputs (`min`/`max`) and
 * iOS clamps its stepper-free fields to.
 *
 * ## Money
 *
 * Every amount is in the DEVICE's currency (same unit as `purchasePrice`), so
 * the labels carry the currency code and never assume ₫. Blank down payment and
 * blank monthly amount mean `0` (the server then decides); blank FEE means
 * **"not recorded"** — it goes on the wire as `null`, which makes every total a
 * lower bound. That difference is deliberate and is explained in the sheet.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun InstallmentEditSheet(
    api: ApiService,
    device: Device,
    onDismiss: () -> Unit,
    /** The plan was saved; the host refreshes the device detail. */
    onSaved: () -> Unit,
    /**
     * The plan existed and the user asked to remove it. The host owns the
     * confirm dialog and the `DELETE`, so the sheet does not have to dismiss
     * itself in the middle of a write.
     */
    onDeleteRequest: () -> Unit,
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val scope = rememberCoroutineScope()
    val plan = device.installment
    val currency = normalizeCurrency(device.currency)

    // Seeded from the stored plan so an edit starts from what is on the device,
    // not from a blank form. A new plan starts at the same 12 months the web and
    // iOS forms default to, and the first due day is TODAY in the user's own
    // zone (a UTC day could be yesterday locally).
    var downPayment by remember { mutableStateOf(plan?.downPayment?.toString().orEmpty()) }
    var months by remember {
        mutableStateOf((plan?.months ?: DEFAULT_INSTALLMENT_MONTHS).toString())
    }
    var monthlyAmount by remember { mutableStateOf(plan?.monthlyAmount?.toString().orEmpty()) }
    var firstDueAt by remember {
        mutableStateOf(plan?.firstDueAt?.take(10) ?: todayDayIso())
    }
    var fileFee by remember { mutableStateOf(plan?.fileFee?.toString().orEmpty()) }
    var monthlyFee by remember { mutableStateOf(plan?.monthlyFee?.toString().orEmpty()) }
    var paidCount by remember { mutableStateOf((plan?.paidCount ?: 0).toString()) }
    var lender by remember { mutableStateOf(plan?.lender.orEmpty()) }

    var submitting by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var serverFieldErrors by remember { mutableStateOf<Map<String, List<String>>>(emptyMap()) }
    var localErrors by remember { mutableStateOf<Map<String, String>>(emptyMap()) }

    val monthsErrorText = stringResource(R.string.devdetail_installment_months_invalid)
    val monthlyAmountErrorText = stringResource(R.string.devdetail_installment_monthly_amount_invalid)
    val paidCountErrorText = stringResource(R.string.devdetail_installment_paid_count_invalid)
    val firstDueErrorText = stringResource(R.string.devdetail_installment_first_due_invalid)

    fun clearError(field: String) {
        if (localErrors.containsKey(field)) localErrors = localErrors - field
        if (serverFieldErrors.containsKey(field)) serverFieldErrors = serverFieldErrors - field
        if (error != null) error = null
    }

    fun fieldError(field: String): String? =
        localErrors[field] ?: serverFieldErrors[field]?.firstOrNull()

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheetState) {
        Column(
            Modifier
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(
                stringResource(R.string.devdetail_installment),
                fontSize = 18.sp,
                fontWeight = FontWeight.SemiBold,
            )

            SheetGroup {
                InstallmentField(
                    label = stringResource(R.string.devdetail_installment_down_payment, currency),
                    value = downPayment,
                    onValueChange = {
                        downPayment = it.filter { c -> c.isDigit() }
                        clearError("downPayment")
                    },
                    error = fieldError("downPayment"),
                    keyboardType = KeyboardType.Number,
                )
                InstallmentField(
                    label = stringResource(R.string.devdetail_installment_months),
                    value = months,
                    onValueChange = {
                        months = it.filter { c -> c.isDigit() }
                        clearError("months")
                    },
                    error = fieldError("months"),
                    keyboardType = KeyboardType.Number,
                )
                InstallmentField(
                    label = stringResource(R.string.devdetail_installment_monthly_amount, currency),
                    value = monthlyAmount,
                    onValueChange = {
                        monthlyAmount = it.filter { c -> c.isDigit() }
                        clearError("monthlyAmount")
                    },
                    error = fieldError("monthlyAmount"),
                    keyboardType = KeyboardType.Number,
                )
                InstallmentField(
                    label = stringResource(R.string.devdetail_installment_first_due),
                    value = firstDueAt,
                    onValueChange = {
                        firstDueAt = it
                        clearError("firstDueAt")
                    },
                    error = fieldError("firstDueAt"),
                )
                InstallmentField(
                    label = stringResource(R.string.devdetail_installment_file_fee, currency),
                    value = fileFee,
                    onValueChange = {
                        fileFee = it.filter { c -> c.isDigit() }
                        clearError("fileFee")
                    },
                    error = fieldError("fileFee"),
                    keyboardType = KeyboardType.Number,
                    placeholder = stringResource(R.string.devdetail_installment_fee_placeholder),
                )
                InstallmentField(
                    label = stringResource(R.string.devdetail_installment_monthly_fee, currency),
                    value = monthlyFee,
                    onValueChange = {
                        monthlyFee = it.filter { c -> c.isDigit() }
                        clearError("monthlyFee")
                    },
                    error = fieldError("monthlyFee"),
                    keyboardType = KeyboardType.Number,
                    placeholder = stringResource(R.string.devdetail_installment_fee_placeholder),
                )
                InstallmentField(
                    label = stringResource(R.string.devdetail_installment_paid_count),
                    value = paidCount,
                    onValueChange = {
                        paidCount = it.filter { c -> c.isDigit() }
                        clearError("paidCount")
                    },
                    error = fieldError("paidCount"),
                    keyboardType = KeyboardType.Number,
                )
                InstallmentField(
                    label = stringResource(R.string.devdetail_installment_lender),
                    value = lender,
                    onValueChange = {
                        // The contract caps the lender at 100 characters.
                        lender = it.take(100)
                        clearError("lender")
                    },
                    error = fieldError("lender"),
                )
            }

            Text(
                stringResource(R.string.devdetail_installment_fee_hint),
                fontSize = 12.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Text(
                stringResource(R.string.devdetail_installment_currency_note, currency),
                fontSize = 12.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

            error?.let {
                Text(it, color = MaterialTheme.colorScheme.error, fontSize = 13.sp)
            }

            Button(
                onClick = {
                    error = null
                    serverFieldErrors = emptyMap()

                    val monthsInt = months.toIntOrNull() ?: 0
                    val monthlyInt = monthlyAmount.toIntOrNull() ?: 0
                    val paidInt = paidCount.toIntOrNull() ?: 0
                    val downInt = downPayment.toIntOrNull() ?: 0
                    val day = firstDueAt.trim()

                    val nextErrors = buildMap {
                        if (monthsInt !in INSTALLMENT_MONTHS) {
                            put("months", monthsErrorText)
                        }
                        if (monthlyInt <= 0) {
                            put("monthlyAmount", monthlyAmountErrorText)
                        }
                        // Checked only once `months` itself is valid, mirroring
                        // the server: otherwise one mistake produces two
                        // messages.
                        if (monthsInt in INSTALLMENT_MONTHS && paidInt !in 0..monthsInt) {
                            put("paidCount", paidCountErrorText)
                        }
                        if (day.isEmpty() || isCalendarDay(day).not()) {
                            put("firstDueAt", firstDueErrorText)
                        }
                    }
                    localErrors = nextErrors

                    if (nextErrors.isEmpty()) {
                        submitting = true
                        scope.launch {
                            try {
                                api.saveInstallment(
                                    device.id,
                                    InstallmentInput(
                                        downPayment = downInt,
                                        months = monthsInt,
                                        monthlyAmount = monthlyInt,
                                        firstDueAt = day,
                                        // Blank fee stays null: "not recorded",
                                        // which is NOT zero — it makes the total
                                        // a lower bound.
                                        fileFee = fileFee.toIntOrNull(),
                                        monthlyFee = monthlyFee.toIntOrNull(),
                                        paidCount = paidInt,
                                        lender = lender.trim().ifBlank { null },
                                    ),
                                )
                                onSaved()
                            } catch (e: Exception) {
                                val fe = e.fieldErrors(ApiClient.json)
                                serverFieldErrors = fe
                                if (fe.isEmpty()) {
                                    error = e.toUserMessage(ApiClient.json)
                                }
                            } finally {
                                submitting = false
                            }
                        }
                    }
                },
                enabled = !submitting,
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
                    Text(stringResource(R.string.action_save), fontWeight = FontWeight.SemiBold)
                }
            }

            // Removing the plan is irreversible and changes the money basis, so
            // it goes through the host's AlertDialog confirm — the same pattern
            // as deleting a warranty, a claim or the device itself.
            if (plan != null) {
                TextButton(
                    onClick = onDeleteRequest,
                    enabled = !submitting,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(
                        stringResource(R.string.devdetail_installment_delete),
                        color = MaterialTheme.colorScheme.error,
                    )
                }
            }

            Spacer(Modifier.height(20.dp))
        }
    }
}

@Composable
private fun InstallmentField(
    label: String,
    value: String,
    onValueChange: (String) -> Unit,
    error: String?,
    keyboardType: KeyboardType = KeyboardType.Text,
    placeholder: String? = null,
) {
    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        label = { Text(label) },
        placeholder = placeholder?.let { text -> { Text(text) } },
        singleLine = true,
        isError = error != null,
        supportingText = error?.let { message ->
            {
                Text(
                    message,
                    color = MaterialTheme.colorScheme.error,
                    fontSize = 12.sp,
                )
            }
        },
        keyboardOptions = KeyboardOptions(keyboardType = keyboardType),
        modifier = Modifier.fillMaxWidth(),
    )
}

/** `YYYY-MM-DD` and a day that actually exists — the wire's calendar-day shape. */
private fun isCalendarDay(value: String): Boolean =
    runCatching { LocalDate.parse(value) }.isSuccess

/** Contract bounds for `months` (openapi `InstallmentInput`: 1–60). */
private val INSTALLMENT_MONTHS = 1..60

/** New-plan default — the same 12 months the web and iOS forms start at. */
private const val DEFAULT_INSTALLMENT_MONTHS = 12
