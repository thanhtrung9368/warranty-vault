package com.warrantyvault.app.ui.screens.settings

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
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
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
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.warrantyvault.app.R
import com.warrantyvault.app.network.ApiClient
import com.warrantyvault.app.network.ApiService
import com.warrantyvault.app.network.ChangePasswordRequest
import com.warrantyvault.app.network.fieldErrors
import com.warrantyvault.app.network.toUserMessage
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChangePasswordSheet(
    api: ApiService,
    onDismiss: () -> Unit,
    onSuccess: () -> Unit,
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val scope = rememberCoroutineScope()
    // Used where a string has to be resolved OUTSIDE a composable scope (inside
    // `scope.launch { }`, which is a coroutine, not a composable lambda).
    val context = LocalContext.current

    var currentPassword by remember { mutableStateOf("") }
    var newPassword by remember { mutableStateOf("") }
    var confirmPassword by remember { mutableStateOf("") }

    var showCurrent by remember { mutableStateOf(false) }
    var showNew by remember { mutableStateOf(false) }
    var showConfirm by remember { mutableStateOf(false) }

    var submitting by remember { mutableStateOf(false) }
    var generalError by remember { mutableStateOf<String?>(null) }
    var fieldErrors by remember { mutableStateOf<Map<String, List<String>>>(emptyMap()) }
    var successMessage by remember { mutableStateOf<String?>(null) }

    fun firstFieldError(name: String): String? = fieldErrors[name]?.firstOrNull()

    val canSubmit = currentPassword.isNotBlank() &&
        newPassword.length >= 8 &&
        confirmPassword.isNotBlank() &&
        !submitting

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheetState) {
        Column(
            Modifier
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(
                stringResource(R.string.pwd_change_password),
                fontSize = 18.sp, fontWeight = FontWeight.SemiBold,
            )

            PasswordField(
                value = currentPassword,
                onValueChange = {
                    currentPassword = it
                    fieldErrors = fieldErrors - "currentPassword"
                },
                label = stringResource(R.string.pwd_current_password),
                visible = showCurrent,
                onToggleVisible = { showCurrent = !showCurrent },
                error = firstFieldError("currentPassword"),
            )

            PasswordField(
                value = newPassword,
                onValueChange = {
                    newPassword = it
                    fieldErrors = fieldErrors - "newPassword"
                },
                label = stringResource(R.string.pwd_new_password_8_characters),
                visible = showNew,
                onToggleVisible = { showNew = !showNew },
                error = firstFieldError("newPassword"),
            )

            PasswordField(
                value = confirmPassword,
                onValueChange = {
                    confirmPassword = it
                    fieldErrors = fieldErrors - "confirmPassword"
                },
                label = stringResource(R.string.pwd_confirm_the_new_password),
                visible = showConfirm,
                onToggleVisible = { showConfirm = !showConfirm },
                error = firstFieldError("confirmPassword"),
            )

            successMessage?.let {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Outlined.CheckCircle, null,
                        tint = MaterialTheme.colorScheme.primary)
                    Spacer(Modifier.width(6.dp))
                    Text(it,
                        color = MaterialTheme.colorScheme.primary,
                        fontSize = 13.sp)
                }
            }

            generalError?.let {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Outlined.WarningAmber, null,
                        tint = MaterialTheme.colorScheme.error)
                    Spacer(Modifier.width(6.dp))
                    Text(it,
                        color = MaterialTheme.colorScheme.error,
                        fontSize = 13.sp)
                }
            }

            Button(
                onClick = {
                    scope.launch {
                        submitting = true
                        generalError = null
                        successMessage = null
                        fieldErrors = emptyMap()
                        try {
                            val res = api.changePassword(
                                ChangePasswordRequest(
                                    currentPassword = currentPassword,
                                    newPassword = newPassword,
                                    confirmPassword = confirmPassword,
                                )
                            )
                            // Non-composable scope (a coroutine): resolve through the Context.
                            successMessage = res.message
                                ?: context.getString(R.string.pwd_password_changed_successfully)
                            currentPassword = ""
                            newPassword = ""
                            confirmPassword = ""
                            onSuccess()
                        } catch (e: Exception) {
                            val fe = e.fieldErrors(ApiClient.json)
                            if (fe.isNotEmpty()) {
                                fieldErrors = fe
                            } else {
                                generalError = e.toUserMessage(ApiClient.json)
                            }
                        } finally {
                            submitting = false
                        }
                    }
                },
                enabled = canSubmit,
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
                        stringResource(R.string.pwd_update_password),
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
private fun PasswordField(
    value: String,
    onValueChange: (String) -> Unit,
    label: String,
    visible: Boolean,
    onToggleVisible: () -> Unit,
    error: String?,
) {
    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        label = { Text(label) },
        singleLine = true,
        isError = error != null,
        supportingText = error?.let { { Text(it, color = MaterialTheme.colorScheme.error) } },
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
        visualTransformation =
            if (visible) VisualTransformation.None else PasswordVisualTransformation(),
        trailingIcon = {
            IconButton(onClick = onToggleVisible) {
                Icon(
                    if (visible) Icons.Filled.VisibilityOff else Icons.Filled.Visibility,
                    contentDescription = if (visible) stringResource(R.string.pwd_hide_password) else stringResource(R.string.pwd_show_password),
                )
            }
        },
        modifier = Modifier.fillMaxWidth(),
    )
}
