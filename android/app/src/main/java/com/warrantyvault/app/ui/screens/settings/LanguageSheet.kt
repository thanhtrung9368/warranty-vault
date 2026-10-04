package com.warrantyvault.app.ui.screens.settings

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
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
import com.warrantyvault.app.R
import com.warrantyvault.app.auth.AuthStore
import com.warrantyvault.app.i18n.AppLanguage
import com.warrantyvault.app.i18n.LanguageStore
import com.warrantyvault.app.network.ApiClient
import com.warrantyvault.app.network.toUserMessage
import kotlinx.coroutines.launch

/**
 * The language switcher — phase 2 of `docs/I18N_PLAN.md`.
 *
 * ## Why a server round trip sits in front of a local preference
 *
 * The screens render from [LanguageStore] (local `SharedPreferences`): that is
 * what `MainActivity.attachBaseContext` reads, and it has to work before
 * `GET /api/v1/auth/me` answers and with no network at all. But the cron push
 * fan-out and the transactional emails run in Go with **no request context**, so
 * the only language they can honour is `User.locale` (§2.3). Saving one without
 * the other is the bug this sheet exists to prevent: an account receiving
 * Vietnamese push notifications inside an English app, or the reverse.
 *
 * So the order is: PATCH first, and only on success write the local value. A
 * failure keeps the sheet open with the server's own message (translated, since
 * `Accept-Language` travels on this very request), which is honest — the user
 * knows the choice did not stick anywhere. Writing locally first and letting the
 * PATCH fail quietly would look like it worked while the push notifications kept
 * arriving in the other language.
 *
 * Writing the local value flips the `StateFlow` in [LanguageStore];
 * `MainActivity` observes it and recreates itself, which is what re-runs
 * `attachBaseContext` with the new locale. This sheet therefore disappears by
 * design on success, and the whole UI has already switched when it does.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LanguageSheet(
    auth: AuthStore,
    languageStore: LanguageStore,
    onDismiss: () -> Unit,
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val current by languageStore.language.collectAsState()

    var saving by remember { mutableStateOf<AppLanguage?>(null) }
    var error by remember { mutableStateOf<String?>(null) }

    fun choose(language: AppLanguage) {
        if (saving != null || language == current) return
        saving = language
        error = null
        scope.launch {
            try {
                auth.updateLocale(language)
                // Triggers MainActivity.recreate() through the StateFlow.
                languageStore.set(language)
            } catch (e: Exception) {
                error = e.toUserMessage(ApiClient.json, context)
            } finally {
                saving = null
            }
        }
    }

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheetState) {
        Column(
            Modifier.padding(horizontal = 20.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Text(
                stringResource(R.string.settings_lang_sheet_title),
                fontSize = 18.sp, fontWeight = FontWeight.SemiBold,
            )
            Spacer(Modifier.height(4.dp))

            LanguageRow(
                label = stringResource(R.string.settings_lang_vietnamese),
                selected = current == AppLanguage.Vi,
                busy = saving == AppLanguage.Vi,
                enabled = saving == null,
                onClick = { choose(AppLanguage.Vi) },
            )
            LanguageRow(
                label = stringResource(R.string.settings_lang_english),
                selected = current == AppLanguage.En,
                busy = saving == AppLanguage.En,
                enabled = saving == null,
                onClick = { choose(AppLanguage.En) },
            )

            error?.let {
                Spacer(Modifier.height(4.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Outlined.WarningAmber, null,
                        tint = MaterialTheme.colorScheme.error)
                    Spacer(Modifier.width(6.dp))
                    Text(it, color = MaterialTheme.colorScheme.error, fontSize = 13.sp)
                }
            }

            Spacer(Modifier.height(8.dp))
            Text(
                stringResource(R.string.settings_lang_footer),
                fontSize = 12.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.height(20.dp))
        }
    }
}

@Composable
private fun LanguageRow(
    label: String,
    selected: Boolean,
    busy: Boolean,
    enabled: Boolean,
    onClick: () -> Unit,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .clickable(enabled = enabled, onClick = onClick)
            .padding(vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            label,
            style = MaterialTheme.typography.bodyLarge,
            fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
            modifier = Modifier.weight(1f),
        )
        if (busy) {
            CircularProgressIndicator(strokeWidth = 2.dp, modifier = Modifier.height(18.dp))
            Spacer(Modifier.width(8.dp))
            Text(
                stringResource(R.string.settings_lang_saving),
                fontSize = 12.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        } else {
            RadioButton(selected = selected, onClick = onClick, enabled = enabled)
        }
    }
}
