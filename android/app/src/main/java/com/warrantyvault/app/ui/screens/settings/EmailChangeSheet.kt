package com.warrantyvault.app.ui.screens.settings

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
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.warrantyvault.app.R
import com.warrantyvault.app.auth.AuthStore
import com.warrantyvault.app.network.ApiClient
import com.warrantyvault.app.network.fieldErrors
import com.warrantyvault.app.network.toUserMessage
import kotlinx.coroutines.launch

/**
 * Đổi email tài khoản — the two-step flow, mirroring
 * `ios/Sources/WarrantyVaultKit/EmailChangeSheet.swift`.
 *
 * Step 1 (`POST /api/v1/auth/change-email`) needs the CURRENT PASSWORD and mails
 * a single-use, 30-minute token to the NEW address; receiving it there is what
 * proves the address belongs to the user. `User.email` does not change until
 * step 2, which is why the sheet says so explicitly instead of implying the move
 * already happened.
 *
 * Step 2 (`POST /api/v1/auth/confirm-email-change`) takes the raw token. The
 * mailed link is `<APP_URL>/confirm-email/<token>` — a **web** page this app
 * cannot open as a session — so the email also prints the token as text and the
 * user pastes it here ([EmailChangeRules.tokenFromPasted] also accepts the whole
 * link, since that is the bigger tap target on a phone).
 *
 * Three things this screen deliberately does NOT do:
 *   * it never hints that the new address might already belong to someone else.
 *     The API answers the same neutral message either way (and sends no email in
 *     that case) so accounts cannot be enumerated; a client that "detected" it
 *     would undo that.
 *   * it never claims the mail was delivered. The server only knows it handed the
 *     message to the mail provider — with no `RESEND_API_KEY` it just logs the
 *     link — and nothing in the response tells the client which happened.
 *   * it never ends the session by itself. Confirming revokes EVERY session on
 *     the server, so the local bearer token is already dead; the confirmation
 *     dialog's single button is what drops it, exactly like iOS. If the user
 *     walks away before pressing it, the app self-heals on the next launch
 *     (`AuthStore.bootstrap` gets a 401, clears the token and shows login).
 *
 * Both steps live on one screen because the token arrives out-of-band: the user
 * may come back to this screen later, or asked for the change on another device.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun EmailChangeSheet(
    auth: AuthStore,
    currentEmail: String,
    onDismiss: () -> Unit,
    onConfirmed: () -> Unit,
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val scope = rememberCoroutineScope()
    val context = LocalContext.current

    // Step 1
    var newEmail by remember { mutableStateOf("") }
    var currentPassword by remember { mutableStateOf("") }

    // Step 2
    var token by remember { mutableStateOf("") }

    var requesting by remember { mutableStateOf(false) }
    var confirming by remember { mutableStateOf(false) }
    var stepOneErrors by remember { mutableStateOf<Map<String, List<String>>>(emptyMap()) }
    var topError by remember { mutableStateOf<String?>(null) }
    var tokenError by remember { mutableStateOf<String?>(null) }

    /** Set after step 1 succeeds: the address a token was requested for. */
    var requestedEmail by remember { mutableStateOf<String?>(null) }

    /** The server's neutral message, shown verbatim — it says exactly as much
     *  as the API is willing to say. */
    var neutralMessage by remember { mutableStateOf<String?>(null) }

    var done by remember { mutableStateOf(false) }

    val canRequest = EmailChangeRules.canRequest(newEmail, currentPassword) && !requesting
    val canConfirm = EmailChangeRules.canConfirm(token) && !confirming

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheetState) {
        Column(
            Modifier
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(
                stringResource(R.string.email_change_title),
                fontSize = 18.sp, fontWeight = FontWeight.SemiBold,
            )

            Text(
                stringResource(
                    R.string.email_change_intro,
                    currentEmail.ifBlank { stringResource(R.string.email_change_intro_empty) },
                ),
                fontSize = 13.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

            topError?.let { ErrorRow(it) }

            // ---- Bước 1 ----
            SectionLabel(stringResource(R.string.email_change_step1_header))

            OutlinedTextField(
                value = newEmail,
                onValueChange = {
                    newEmail = it
                    stepOneErrors = stepOneErrors - "newEmail"
                },
                label = { Text(stringResource(R.string.email_change_new_email)) },
                singleLine = true,
                enabled = !requesting,
                isError = stepOneErrors["newEmail"]?.firstOrNull() != null,
                supportingText = {
                    stepOneErrors["newEmail"]?.firstOrNull()?.let { Text(it) }
                },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
                modifier = Modifier.fillMaxWidth(),
            )

            OutlinedTextField(
                value = currentPassword,
                onValueChange = {
                    currentPassword = it
                    stepOneErrors = stepOneErrors - "currentPassword"
                },
                label = { Text(stringResource(R.string.email_change_current_password)) },
                singleLine = true,
                enabled = !requesting,
                isError = stepOneErrors["currentPassword"]?.firstOrNull() != null,
                supportingText = {
                    stepOneErrors["currentPassword"]?.firstOrNull()?.let { Text(it) }
                },
                visualTransformation = PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                modifier = Modifier.fillMaxWidth(),
            )

            PrimaryButton(
                label = if (requesting) {
                    stringResource(R.string.email_change_requesting)
                } else {
                    stringResource(R.string.email_change_request)
                },
                enabled = canRequest,
                busy = requesting,
                onClick = {
                    scope.launch {
                        requesting = true
                        topError = null
                        stepOneErrors = emptyMap()
                        val email = EmailChangeRules.normalizedEmail(newEmail)
                        try {
                            val res = auth.changeEmail(email, currentPassword)
                            // Neutral by contract: this is also the path taken
                            // when the address already belongs to someone else.
                            // Never try to tell the two apart.
                            requestedEmail = email
                            neutralMessage = res.message
                            currentPassword = ""
                        } catch (e: Exception) {
                            val fe = e.fieldErrors(ApiClient.json)
                            if (fe.isNotEmpty()) {
                                stepOneErrors = fe
                            } else {
                                topError = e.toUserMessage(ApiClient.json, context)
                            }
                        } finally {
                            requesting = false
                        }
                    }
                },
            )

            requestedEmail?.let { email ->
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(
                            Icons.Outlined.CheckCircle, null,
                            tint = MaterialTheme.colorScheme.primary,
                            modifier = Modifier.size(14.dp),
                        )
                        Spacer(Modifier.width(6.dp))
                        Text(
                            stringResource(R.string.email_change_requested),
                            fontSize = 13.sp, fontWeight = FontWeight.SemiBold,
                            color = MaterialTheme.colorScheme.primary,
                        )
                    }
                    neutralMessage?.let {
                        Text(it, fontSize = 13.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    Text(
                        stringResource(
                            R.string.email_change_check_inbox,
                            stringResource(R.string.email_change_check_inbox_address, email),
                        ),
                        fontSize = 13.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Text(
                        stringResource(R.string.email_change_old_address_note),
                        fontSize = 13.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }

            // ---- Bước 2 ----
            SectionLabel(stringResource(R.string.email_change_step2_header))

            OutlinedTextField(
                value = token,
                onValueChange = {
                    token = it
                    tokenError = null
                },
                label = { Text(stringResource(R.string.email_change_token)) },
                enabled = !confirming,
                isError = tokenError != null,
                supportingText = { tokenError?.let { Text(it) } },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )

            PrimaryButton(
                label = if (confirming) {
                    stringResource(R.string.email_change_confirming)
                } else {
                    stringResource(R.string.email_change_confirm)
                },
                enabled = canConfirm,
                busy = confirming,
                onClick = {
                    // Accepts the bare token or the whole confirm-email link.
                    val raw = EmailChangeRules.tokenFromPasted(token)
                    if (raw.isEmpty()) {
                        tokenError = context.getString(R.string.email_change_enter_token)
                        return@PrimaryButton
                    }
                    scope.launch {
                        confirming = true
                        topError = null
                        tokenError = null
                        try {
                            auth.confirmEmailChange(raw)
                            done = true
                        } catch (e: Exception) {
                            tokenError = e.toUserMessage(ApiClient.json, context)
                        } finally {
                            confirming = false
                        }
                    }
                },
            )

            Text(
                stringResource(R.string.email_change_footer, EmailChangeRules.TOKEN_TTL_MINUTES),
                fontSize = 12.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

            Spacer(Modifier.height(20.dp))
        }
    }

    if (done) {
        AlertDialog(
            // Not dismissible by tapping outside: the account address has already
            // changed and the server has revoked every session, so the one useful
            // action is the button. Same shape as the iOS alert.
            onDismissRequest = {},
            title = { Text(stringResource(R.string.email_change_done_title)) },
            text = {
                Text(
                    stringResource(
                        R.string.email_change_done_body,
                        requestedEmail?.let {
                            stringResource(R.string.email_change_done_body_address, it)
                        } ?: "",
                    ),
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    done = false
                    onConfirmed()
                }) { Text(stringResource(R.string.email_change_sign_in_again)) }
            },
        )
    }
}

@Composable
private fun SectionLabel(text: String) {
    Text(
        text,
        fontSize = 13.sp,
        fontWeight = FontWeight.SemiBold,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.padding(top = 4.dp),
    )
}

@Composable
private fun ErrorRow(message: String) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Icon(Icons.Outlined.WarningAmber, null, tint = MaterialTheme.colorScheme.error)
        Spacer(Modifier.width(6.dp))
        Text(message, color = MaterialTheme.colorScheme.error, fontSize = 13.sp)
    }
}

@Composable
private fun PrimaryButton(
    label: String,
    enabled: Boolean,
    busy: Boolean,
    onClick: () -> Unit,
) {
    Button(
        onClick = onClick,
        enabled = enabled,
        shape = CircleShape,
        colors = ButtonDefaults.buttonColors(
            containerColor = MaterialTheme.colorScheme.primary,
        ),
        modifier = Modifier.fillMaxWidth().height(52.dp),
    ) {
        if (busy) {
            CircularProgressIndicator(
                strokeWidth = 2.dp,
                modifier = Modifier.height(20.dp),
                color = MaterialTheme.colorScheme.onPrimary,
            )
        } else {
            Text(label, fontWeight = FontWeight.SemiBold)
        }
    }
}
