package com.warrly.ui.screens.settings

import androidx.annotation.StringRes
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
import com.warrly.R
import com.warrly.auth.AuthStore
import com.warrly.i18n.AppLanguage
import com.warrly.i18n.LanguageStore
import com.warrly.network.ApiClient
import com.warrly.network.toUserMessage
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
 * So the order is: PATCH first; [AuthStore.updateLocale] writes the local value
 * (and the device-mode mirror marker) only after the server answers. A failure
 * keeps the sheet open with the server's own message (translated, since
 * `Accept-Language` travels on this very request), which is honest — the user
 * knows the choice did not stick anywhere, and the UI keeps the language the
 * account actually holds. Writing locally first and letting the PATCH fail
 * quietly would look like it worked while the push notifications kept arriving
 * in the other language.
 *
 * Writing the local value flips the `StateFlow` in [LanguageStore];
 * `MainActivity` observes it and recreates itself, which is what re-runs
 * `attachBaseContext` with the new locale. This sheet therefore disappears by
 * design on success, and the whole UI has already switched when it does.
 *
 * ## Three rows, not two
 *
 * The contract's `locale` is **tri-state** (`openapi.yaml`, `UpdateProfileInput`):
 * absent means "leave the stored value alone", `null` clears it, a value sets
 * it. The sheet exposes all three STATES, but only two VALUES ever reach the
 * wire: "Theo thiết bị" does not send the clearing `null`, because an account
 * with a NULL `locale` leaves the push/email path in the Vietnamese artifact
 * fallback. It sends the language the phone resolves to instead, and
 * [LanguageStore] remembers that value as a mirror. The tick is derived from
 * the STORED choice ([LanguageStore.stored]), so "Theo thiết bị" shows as
 * selected even when the device language happens to be Vietnamese.
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
    val stored by languageStore.stored.collectAsState()

    var saving by remember { mutableStateOf<LanguageChoice?>(null) }
    var error by remember { mutableStateOf<String?>(null) }

    fun choose(choice: LanguageChoice) {
        if (saving != null || choice.language == stored) return
        saving = choice
        error = null
        scope.launch {
            try {
                // PATCH first. `null` is "Theo thiết bị": AuthStore resolves it
                // to the phone's language and stores that — never
                // `{"locale": null}`, which would leave push and email in the
                // Vietnamese artifact fallback. The local state (and the mirror
                // marker) moves inside the same call, only after the server
                // answers.
                auth.updateLocale(choice.language)
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

            // "Theo thiết bị" first: it is the default state, and the only way
            // back once a language has been chosen.
            LanguageRow(
                label = stringResource(R.string.settings_lang_device),
                selected = stored == null,
                busy = saving == LanguageChoice.Device,
                enabled = saving == null,
                onClick = { choose(LanguageChoice.Device) },
            )
            LanguageRow(
                label = stringResource(R.string.settings_lang_vietnamese),
                selected = stored == AppLanguage.Vi,
                busy = saving == LanguageChoice.Vietnamese,
                enabled = saving == null,
                onClick = { choose(LanguageChoice.Vietnamese) },
            )
            LanguageRow(
                label = stringResource(R.string.settings_lang_english),
                selected = stored == AppLanguage.En,
                busy = saving == LanguageChoice.English,
                enabled = saving == null,
                onClick = { choose(LanguageChoice.English) },
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

/**
 * The three rows the sheet shows, not two.
 *
 * `Device` is "no explicit choice": the app keeps following the phone's own
 * language, and the account stores the language the phone resolved to as a
 * mirror so push and email have an answer. Mirror of iOS `LanguageChoice`
 * (`ios/App/State/LocalizationStore.swift`).
 */
private enum class LanguageChoice(
    @StringRes val labelRes: Int,
    val language: AppLanguage?,
) {
    Device(R.string.settings_lang_device, null),
    Vietnamese(R.string.settings_lang_vietnamese, AppLanguage.Vi),
    English(R.string.settings_lang_english, AppLanguage.En),
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
