package com.warrantyvault.app.ui.screens.login

import androidx.compose.foundation.BorderStroke
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
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.MailOutline
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.warrantyvault.app.R
import com.warrantyvault.app.auth.AuthStore
import com.warrantyvault.app.network.ApiClient
import com.warrantyvault.app.network.fieldErrors
import com.warrantyvault.app.network.toUserMessage
import kotlinx.coroutines.launch

@Composable
fun ForgotPasswordScreen(auth: AuthStore, onBack: () -> Unit) {
    val scope = rememberCoroutineScope()
    val cs = MaterialTheme.colorScheme

    var email by remember { mutableStateOf("") }
    var submitting by remember { mutableStateOf(false) }
    var done by remember { mutableStateOf(false) }
    var topError by remember { mutableStateOf<String?>(null) }
    var fieldErrors by remember { mutableStateOf(emptyMap<String, List<String>>()) }

    Box(
        Modifier
            .fillMaxSize()
            .background(
                Brush.linearGradient(
                    listOf(cs.primary.copy(alpha = 0.15f), cs.background)
                )
            )
    ) {
        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(20.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Spacer(Modifier.height(40.dp))

            Icon(Icons.Filled.MailOutline, null, tint = cs.primary, modifier = Modifier.size(64.dp))
            Spacer(Modifier.height(8.dp))
            Text(
                stringResource(R.string.forgot_forgot_password),
                fontSize = 26.sp, fontWeight = FontWeight.Bold, color = cs.onBackground,
            )
            Text(
                stringResource(R.string.forgot_enter_your_email_to_get_a),
                fontSize = 13.sp, color = cs.onSurfaceVariant,
            )

            Spacer(Modifier.height(24.dp))

            Card(
                modifier = Modifier.widthIn(max = 480.dp).fillMaxWidth(),
                colors = CardDefaults.cardColors(containerColor = cs.surface),
                border = BorderStroke(1.dp, cs.outline),
                shape = RoundedCornerShape(12.dp),
            ) {
                Column(
                    Modifier.padding(20.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    if (done) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(
                                Icons.Outlined.CheckCircle, null,
                                tint = cs.primary,
                                modifier = Modifier.size(28.dp),
                            )
                            Spacer(Modifier.width(8.dp))
                            Text(
                                stringResource(R.string.forgot_request_sent),
                                fontSize = 16.sp, fontWeight = FontWeight.SemiBold,
                                color = cs.onSurface,
                            )
                        }
                        Text(
                            stringResource(R.string.forgot_if_that_email_is_registered_a),
                            fontSize = 13.sp, color = cs.onSurfaceVariant,
                        )
                        Button(
                            onClick = onBack,
                            shape = RoundedCornerShape(8.dp),
                            modifier = Modifier.fillMaxWidth().height(50.dp),
                        ) { Text(stringResource(R.string.forgot_back_to_sign_in)) }
                    } else {
                        OutlinedTextField(
                            value = email,
                            onValueChange = { email = it },
                            label = { Text("Email") },
                            placeholder = { Text("you@example.com") },
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
                            isError = fieldErrors.containsKey("email"),
                            supportingText = {
                                fieldErrors["email"]?.firstOrNull()
                                    ?.let { Text(it, color = cs.error) }
                            },
                            modifier = Modifier.fillMaxWidth(),
                        )

                        topError?.let {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Icon(Icons.Outlined.WarningAmber, null, tint = cs.error)
                                Spacer(Modifier.width(6.dp))
                                Text(it, color = cs.error, fontSize = 13.sp)
                            }
                        }

                        Button(
                            onClick = {
                                scope.launch {
                                    submitting = true
                                    topError = null
                                    fieldErrors = emptyMap()
                                    try {
                                        auth.forgotPassword(email.trim())
                                        done = true
                                    } catch (e: Exception) {
                                        topError = e.toUserMessage(ApiClient.json)
                                        fieldErrors = e.fieldErrors(ApiClient.json)
                                    } finally {
                                        submitting = false
                                    }
                                }
                            },
                            enabled = email.isNotBlank() && !submitting,
                            shape = RoundedCornerShape(8.dp),
                            modifier = Modifier.fillMaxWidth().height(50.dp),
                        ) {
                            if (submitting) {
                                CircularProgressIndicator(
                                    modifier = Modifier.size(20.dp),
                                    strokeWidth = 2.dp,
                                    color = cs.onPrimary,
                                )
                            } else {
                                Text(stringResource(R.string.forgot_send))
                            }
                        }

                        TextButton(
                            onClick = onBack,
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Icon(Icons.AutoMirrored.Filled.ArrowBack, null)
                            Spacer(Modifier.width(6.dp))
                            Text(stringResource(R.string.forgot_back_to_sign_in))
                        }
                    }
                }
            }
        }
    }
}
