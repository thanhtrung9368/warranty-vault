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
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.warrantyvault.app.auth.AuthStore
import com.warrantyvault.app.network.ApiClient
import com.warrantyvault.app.network.fieldErrors
import com.warrantyvault.app.network.toUserMessage
import kotlinx.coroutines.launch

/**
 * `PATCH /api/v1/auth/me` — edit the display name (the only editable profile
 * field; email change is not supported by the contract at all).
 *
 * Serverside rules this sheet deliberately does NOT re-implement:
 *  - the 80 **byte** UTF-8 cap (~26 Vietnamese characters) — no client-side
 *    character count, the 400 `fieldErrors.displayName` copy is displayed
 *    verbatim under the field instead of a guessed local limit,
 *  - blank / whitespace clears the name — the raw text is sent and the server
 *    maps it to NULL (`""` because `explicitNulls = false` would drop a null key).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProfileEditSheet(
    auth: AuthStore,
    initialName: String,
    onDismiss: () -> Unit,
    onSuccess: (String) -> Unit,
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val scope = rememberCoroutineScope()

    var displayName by remember { mutableStateOf(initialName) }
    var submitting by remember { mutableStateOf(false) }
    var generalError by remember { mutableStateOf<String?>(null) }
    var fieldErrors by remember { mutableStateOf<Map<String, List<String>>>(emptyMap()) }

    val nameError = fieldErrors["displayName"]?.firstOrNull()

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheetState) {
        Column(
            Modifier
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(
                "Sửa hồ sơ",
                fontSize = 18.sp, fontWeight = FontWeight.SemiBold,
            )

            OutlinedTextField(
                value = displayName,
                onValueChange = {
                    displayName = it
                    fieldErrors = fieldErrors - "displayName"
                },
                label = { Text("Tên hiển thị") },
                singleLine = true,
                enabled = !submitting,
                isError = nameError != null,
                supportingText = {
                    Text(
                        nameError
                            ?: "Để trống để xoá tên. Tối đa 80 byte (~26 ký tự tiếng Việt).",
                        color = if (nameError != null) {
                            MaterialTheme.colorScheme.error
                        } else {
                            MaterialTheme.colorScheme.onSurfaceVariant
                        },
                    )
                },
                modifier = Modifier.fillMaxWidth(),
            )

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
                        fieldErrors = emptyMap()
                        try {
                            // "" clears; the server trims and maps blank → NULL.
                            val res = auth.updateDisplayName(displayName)
                            onSuccess(res.message ?: "Đã cập nhật hồ sơ")
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
                    Text("Lưu", fontWeight = FontWeight.SemiBold)
                }
            }

            Spacer(Modifier.height(20.dp))
        }
    }
}
