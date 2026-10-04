package com.warrantyvault.app.ui.screens.login

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.VerifiedUser
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.warrantyvault.app.R
import com.warrantyvault.app.auth.AuthStore
import com.warrantyvault.app.network.ApiClient
import com.warrantyvault.app.network.fieldErrors
import com.warrantyvault.app.network.toUserMessage
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LoginScreen(auth: AuthStore) {
    val scope = rememberCoroutineScope()
    var mode by remember { mutableStateOf(0) } // 0 = login, 1 = register
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var name by remember { mutableStateOf("") }
    var submitting by remember { mutableStateOf(false) }
    var topError by remember { mutableStateOf<String?>(null) }
    var fieldErrors by remember { mutableStateOf(emptyMap<String, List<String>>()) }
    var showForgot by remember { mutableStateOf(false) }

    if (showForgot) {
        ForgotPasswordScreen(auth = auth, onBack = { showForgot = false })
        return
    }

    val cs = MaterialTheme.colorScheme

    Box(
        Modifier
            .fillMaxSize()
            .background(
                Brush.verticalGradient(
                    listOf(
                        cs.primaryContainer.copy(alpha = 0.45f),
                        cs.background,
                        cs.background,
                    )
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
            Spacer(Modifier.height(48.dp))

            // Hero icon — circular tinted background
            Box(
                Modifier
                    .size(96.dp)
                    .clip(CircleShape)
                    .background(cs.primary.copy(alpha = 0.14f)),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    Icons.Filled.VerifiedUser, null,
                    tint = cs.primary,
                    modifier = Modifier.size(48.dp),
                )
            }
            Spacer(Modifier.height(20.dp))
            Text(
                if (mode == 0) stringResource(R.string.login_welcome_back) else stringResource(R.string.login_create_a_new_account),
                style = MaterialTheme.typography.headlineMedium,
                fontWeight = FontWeight.Bold,
                color = cs.onBackground,
                textAlign = TextAlign.Center,
                letterSpacing = (-0.5).sp,
            )
            Spacer(Modifier.height(6.dp))
            Text(
                if (mode == 0) stringResource(R.string.login_sign_in_to_keep_tracking_your)
                else stringResource(R.string.login_sign_up_to_start_keeping_your),
                style = MaterialTheme.typography.bodyMedium,
                color = cs.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )

            Spacer(Modifier.height(28.dp))

            TabRow(
                selectedTabIndex = mode,
                modifier = Modifier
                    .widthIn(max = 480.dp)
                    .clip(RoundedCornerShape(12.dp)),
                containerColor = cs.surfaceContainerHighest,
                contentColor = cs.primary,
            ) {
                Tab(selected = mode == 0, onClick = {
                    mode = 0; topError = null; fieldErrors = emptyMap()
                }, text = {
                    Text(stringResource(R.string.login_sign_in),
                        fontWeight = if (mode == 0) FontWeight.SemiBold else FontWeight.Normal)
                })
                Tab(selected = mode == 1, onClick = {
                    mode = 1; topError = null; fieldErrors = emptyMap()
                }, text = {
                    Text(stringResource(R.string.login_register),
                        fontWeight = if (mode == 1) FontWeight.SemiBold else FontWeight.Normal)
                })
            }

            Spacer(Modifier.height(20.dp))

            Card(
                modifier = Modifier.widthIn(max = 480.dp).fillMaxWidth(),
                colors = CardDefaults.cardColors(containerColor = cs.surface),
                elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
                shape = RoundedCornerShape(20.dp),
            ) {
                Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    if (mode == 1) {
                        OutlinedTextField(
                            value = name, onValueChange = { name = it },
                            label = { Text(stringResource(R.string.login_name)) },
                            placeholder = { Text(stringResource(R.string.login_jane_doe)) },
                            isError = fieldErrors.containsKey("name"),
                            supportingText = { fieldErrors["name"]?.firstOrNull()?.let { Text(it, color = cs.error) } },
                            shape = RoundedCornerShape(14.dp),
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }

                    OutlinedTextField(
                        value = email, onValueChange = { email = it },
                        label = { Text("Email") },
                        placeholder = { Text("you@example.com") },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
                        isError = fieldErrors.containsKey("email"),
                        supportingText = { fieldErrors["email"]?.firstOrNull()?.let { Text(it, color = cs.error) } },
                        shape = RoundedCornerShape(14.dp),
                        modifier = Modifier.fillMaxWidth(),
                    )

                    OutlinedTextField(
                        value = password, onValueChange = { password = it },
                        label = { Text(stringResource(R.string.login_password)) },
                        placeholder = { Text(if (mode == 1) stringResource(R.string.login_at_least_8_characters) else "•••••") },
                        visualTransformation = PasswordVisualTransformation(),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                        isError = fieldErrors.containsKey("password"),
                        supportingText = { fieldErrors["password"]?.firstOrNull()?.let { Text(it, color = cs.error) } },
                        shape = RoundedCornerShape(14.dp),
                        modifier = Modifier.fillMaxWidth(),
                    )

                    AnimatedVisibility(
                        visible = topError != null,
                        enter = fadeIn() + expandVertically(),
                        exit = fadeOut() + shrinkVertically(),
                    ) {
                        topError?.let {
                            Row(
                                Modifier
                                    .fillMaxWidth()
                                    .clip(RoundedCornerShape(12.dp))
                                    .background(cs.errorContainer)
                                    .padding(12.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Icon(Icons.Outlined.WarningAmber, null, tint = cs.onErrorContainer)
                                Spacer(Modifier.width(8.dp))
                                Text(
                                    it,
                                    color = cs.onErrorContainer,
                                    style = MaterialTheme.typography.bodySmall,
                                )
                            }
                        }
                    }

                    val canSubmit = email.isNotBlank() && password.isNotBlank() &&
                            (mode == 0 || password.length >= 8)

                    Spacer(Modifier.height(4.dp))
                    Button(
                        onClick = {
                            scope.launch {
                                submitting = true; topError = null; fieldErrors = emptyMap()
                                try {
                                    if (mode == 0) auth.login(email, password)
                                    else auth.register(email, password, name.ifBlank { null })
                                } catch (e: Exception) {
                                    topError = e.toUserMessage(ApiClient.json)
                                    fieldErrors = e.fieldErrors(ApiClient.json)
                                } finally {
                                    submitting = false
                                }
                            }
                        },
                        enabled = canSubmit && !submitting,
                        shape = CircleShape,
                        modifier = Modifier.fillMaxWidth().height(52.dp),
                    ) {
                        if (submitting) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(22.dp),
                                strokeWidth = 2.5.dp,
                                color = cs.onPrimary,
                            )
                        } else {
                            Text(
                                if (mode == 0) stringResource(R.string.login_sign_in) else stringResource(R.string.login_create_account),
                                style = MaterialTheme.typography.labelLarge,
                                fontWeight = FontWeight.SemiBold,
                            )
                        }
                    }

                    if (mode == 0) {
                        TextButton(
                            onClick = { showForgot = true },
                            modifier = Modifier.fillMaxWidth(),
                        ) { Text(stringResource(R.string.login_forgot_password)) }
                    }
                }
            }
            Spacer(Modifier.height(24.dp))
        }
    }
}
