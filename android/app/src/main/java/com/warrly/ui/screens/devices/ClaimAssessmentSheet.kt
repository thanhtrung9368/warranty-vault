package com.warrly.ui.screens.devices

import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.util.Log
import android.widget.Toast
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.HelpOutline
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Share
import androidx.compose.material.icons.outlined.CloudOff
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.warrly.R
import com.warrly.i18n.appStrings
import com.warrly.network.ApiClient
import com.warrly.network.ApiService
import com.warrly.network.AssessClaimInput
import com.warrly.network.Claim
import com.warrly.network.ClaimAssessment
import com.warrly.network.ClaimCoverage
import com.warrly.ui.components.PillKind
import com.warrly.ui.components.StatusPill
import kotlinx.coroutines.CancellationException

/**
 * "Đánh giá bảo hành" — the AI claim assessment, opened from one claim card.
 *
 * ## Why a bottom sheet
 *
 * The action belongs to a **specific claim** (`claimId` is the whole request
 * body), and the claim is already on the device detail. A full-screen route
 * would have to carry the claim across a navigation boundary and come back to
 * the same card; a sheet keeps the ticket, the device and the service directory
 * underneath, so the advice is read in the context it applies to. It is also
 * transient — nothing is saved, and closing it loses nothing but the model's
 * prose (the claim is untouched).
 *
 * ## The most important rule: this is not a verdict
 *
 * `LIKELY_COVERED` is **not** "approved". A user who reads it as one stops
 * asking questions, walks to the counter, and discovers the opposite. So the
 * sheet:
 *
 *  * opens with [R.string.claim_assess_disclaimer_title] and the sentence that
 *    the service centre decides, before the estimate is read;
 *  * renders the estimate as an advisory pill and a confidence pill, with
 *    colour buckets that are never success-green or danger-red
 *    ([coveragePillKind]);
 *  * repeats the "service centre decides" line after the letter.
 *
 * The "why" (reasoning) and the questions come from the server in the user's
 * language. The draft letter is **always Vietnamese** and is shown unmodified:
 * the label is not a claim that the app translated it, it is the reason it did
 * not.
 *
 * ## The gates
 *
 * The same `aiOptIn` switch that gates receipt OCR gates this endpoint — the app
 * deliberately does not add a second toggle. Off means "Open Settings" (the
 * existing switch lives there); no API key (503 `feature_disabled`) means a calm
 * "not available right now", not an error: there is nothing the user can fix.
 * The server remains the authority on both; the preflight read only avoids a
 * pointless call.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ClaimAssessmentSheet(
    api: ApiService,
    /** The ticket being assessed. It is read-only here; this feature writes nothing. */
    claim: Claim,
    onDismiss: () -> Unit,
    /** Takes the user to the existing AI opt-in toggle in Settings. */
    onOpenSettings: () -> Unit,
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val context = LocalContext.current

    // `attempt` is the retry trigger for an OTHER failure. It is not exposed for
    // the gated states: retrying a "feature disabled" or "opt-in required"
    // answer cannot change it, and the user should not be invited to try.
    var attempt by remember(claim.id) { mutableIntStateOf(0) }
    var state by remember(claim.id) {
        mutableStateOf<ClaimAssessUiState>(ClaimAssessUiState.Loading)
    }

    LaunchedEffect(claim.id, attempt) {
        state = ClaimAssessUiState.Loading

        // Preflight the shared opt-in. A failure here is NOT treated as "off":
        // the server owns both gates, and asking it is better than blocking a
        // user whose settings read happened to fail.
        val optIn = try {
            api.getAIOptIn().aiOptIn
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
            null
        }

        val gate = claimAssessGate(optIn)
        if (gate != ClaimAssessGate.READY) {
            state = ClaimAssessUiState.Gate(gate)
            return@LaunchedEffect
        }

        try {
            state = ClaimAssessUiState.Result(
                api.assessClaim(AssessClaimInput(claim.id)),
            )
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            val parsed = claimAssessError(e, ApiClient.json)
            state = when (parsed.failure) {
                ClaimAssessFailure.OPT_IN_REQUIRED ->
                    ClaimAssessUiState.Gate(claimAssessGate(aiOptIn = false))
                ClaimAssessFailure.FEATURE_DISABLED ->
                    ClaimAssessUiState.Gate(
                        claimAssessGate(aiOptIn = optIn, featureDisabled = true),
                    )
                ClaimAssessFailure.OTHER ->
                    ClaimAssessUiState.Error(parsed.serverMessage)
            }
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
                stringResource(R.string.claim_assess_title),
                fontSize = 18.sp,
                fontWeight = FontWeight.SemiBold,
            )
            // The ticket's own words, so an assessment opened from a list of
            // tickets is unmistakably about this one.
            if (claim.issue.isNotBlank()) {
                Text(
                    claim.issue,
                    fontSize = 13.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            Text(
                stringResource(R.string.claim_assess_subtitle),
                fontSize = 12.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

            when (val current = state) {
                ClaimAssessUiState.Loading -> AssessmentLoading()
                is ClaimAssessUiState.Gate -> AssessmentGate(
                    gate = current.gate,
                    onClose = onDismiss,
                    onOpenSettings = {
                        onDismiss()
                        onOpenSettings()
                    },
                )
                is ClaimAssessUiState.Result -> AssessmentResult(
                    assessment = current.assessment,
                    onCopyLetter = { letter ->
                        copyLetterToClipboard(context, letter)
                        Toast.makeText(
                            context,
                            context.getString(R.string.claim_assess_letter_copied),
                            Toast.LENGTH_SHORT,
                        ).show()
                    },
                    onShareLetter = { letter -> shareLetter(context, letter) },
                )
                is ClaimAssessUiState.Error -> AssessmentError(
                    serverMessage = current.serverMessage,
                    onRetry = { attempt += 1 },
                    onClose = onDismiss,
                )
            }

            if (state is ClaimAssessUiState.Result) {
                TextButton(onClick = onDismiss, modifier = Modifier.fillMaxWidth()) {
                    Text(stringResource(R.string.action_close))
                }
            }
            Spacer(Modifier.height(8.dp))
        }
    }
}

/** The sheet's own state. The gates are not errors, so they are not [Error]. */
private sealed interface ClaimAssessUiState {
    data object Loading : ClaimAssessUiState
    data class Gate(val gate: ClaimAssessGate) : ClaimAssessUiState
    data class Result(val assessment: ClaimAssessment) : ClaimAssessUiState
    data class Error(val serverMessage: String?) : ClaimAssessUiState
}

@Composable
private fun AssessmentLoading() {
    Row(verticalAlignment = Alignment.CenterVertically) {
        CircularProgressIndicator(strokeWidth = 2.dp, modifier = Modifier.size(20.dp))
        Spacer(Modifier.width(10.dp))
        Text(
            stringResource(R.string.claim_assess_loading),
            fontSize = 13.sp,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

/**
 * The two calm "not now" states. Both use a neutral surface and an outline icon:
 * the opt-in is a choice, and a missing server key is not a claim failure. No
 * error colour, no "failed" wording.
 */
@Composable
private fun AssessmentGate(
    gate: ClaimAssessGate,
    onClose: () -> Unit,
    onOpenSettings: () -> Unit,
) {
    when (gate) {
        ClaimAssessGate.OPT_IN_REQUIRED -> NoticeCard(
            icon = Icons.Outlined.Info,
            title = stringResource(R.string.claim_assess_gate_optin_title),
            body = stringResource(R.string.claim_assess_gate_optin_body),
            actionLabel = stringResource(R.string.claim_assess_gate_optin_action),
            onAction = onOpenSettings,
            onClose = onClose,
        )
        ClaimAssessGate.FEATURE_DISABLED -> NoticeCard(
            icon = Icons.Outlined.CloudOff,
            title = stringResource(R.string.claim_assess_gate_disabled_title),
            body = stringResource(R.string.claim_assess_gate_disabled_body),
            actionLabel = null,
            onAction = null,
            onClose = onClose,
        )
        // The sheet never opens in READY without asking; keep the branch honest
        // rather than drawing a "ready" card that is not a UI state.
        ClaimAssessGate.READY -> Unit
    }
}

@Composable
private fun NoticeCard(
    icon: ImageVector,
    title: String,
    body: String,
    actionLabel: String?,
    onAction: (() -> Unit)?,
    onClose: () -> Unit,
) {
    val cs = MaterialTheme.colorScheme
    Card(
        colors = CardDefaults.cardColors(containerColor = cs.surfaceContainerHighest),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
        shape = RoundedCornerShape(16.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(
            Modifier.padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Row(verticalAlignment = Alignment.Top) {
                Icon(icon, null, tint = cs.primary, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(8.dp))
                Text(
                    title,
                    fontSize = 14.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = cs.onSurface,
                )
            }
            Text(body, fontSize = 12.sp, color = cs.onSurfaceVariant)
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.End,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                if (actionLabel != null && onAction != null) {
                    Button(onClick = onAction) { Text(actionLabel) }
                    Spacer(Modifier.width(8.dp))
                }
                TextButton(onClick = onClose) {
                    Text(stringResource(R.string.action_close))
                }
            }
        }
    }
}

@Composable
private fun AssessmentError(
    serverMessage: String?,
    onRetry: () -> Unit,
    onClose: () -> Unit,
) {
    val cs = MaterialTheme.colorScheme
    Card(
        colors = CardDefaults.cardColors(containerColor = cs.errorContainer),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
        shape = RoundedCornerShape(16.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(
            Modifier.padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Row(verticalAlignment = Alignment.Top) {
                Icon(
                    Icons.Outlined.WarningAmber, null,
                    tint = cs.onErrorContainer,
                    modifier = Modifier.size(18.dp),
                )
                Spacer(Modifier.width(8.dp))
                Text(
                    stringResource(R.string.claim_assess_error_title),
                    fontSize = 14.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = cs.onErrorContainer,
                )
            }
            // The server's translated sentence wins when it sent a usable one; the
            // app's fallback only covers a socket/server failure with no message.
            Text(
                serverMessage?.takeIf { it.isNotBlank() }
                    ?: stringResource(R.string.claim_assess_error_body),
                fontSize = 12.sp,
                color = cs.onErrorContainer,
            )
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.End,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                TextButton(onClick = onRetry) { Text(stringResource(R.string.action_retry)) }
                TextButton(onClick = onClose) { Text(stringResource(R.string.action_close)) }
            }
        }
    }
}

/**
 * The result. Order is the design:
 *
 *  1. the permanent "advice, not a decision" banner,
 *  2. the estimate + confidence, with no success/danger colour,
 *  3. the advice sentence (and, for `UNCLEAR`, the reminder that the questions
 *     are the useful output),
 *  4. the reasoning and questions,
 *  5. the Vietnamese letter, explicitly labelled and never translated,
 *  6. the closing "the service centre decides" line plus provenance.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun AssessmentResult(
    assessment: ClaimAssessment,
    onCopyLetter: (String) -> Unit,
    onShareLetter: (String) -> Unit,
) {
    val s = appStrings()
    val cs = MaterialTheme.colorScheme
    val questions = assessmentQuestions(assessment)
    val letter = draftLetterText(assessment)

    AdviceNotVerdictBanner()

    FlowRow(
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        StatusPill(
            label = coverageLabel(s, assessment.coverage),
            kind = coveragePillKind(assessment.coverage),
            // The colour bucket is the rule (`ClaimAssessmentRules.kt`); the icon
            // only stops the generic warning clock from reading as "waiting".
            icon = when (assessment.coverage) {
                ClaimCoverage.LIKELY_COVERED -> Icons.Outlined.Info
                ClaimCoverage.UNCLEAR -> Icons.AutoMirrored.Outlined.HelpOutline
                ClaimCoverage.LIKELY_NOT_COVERED -> Icons.Outlined.WarningAmber
            },
        )
        // The confidence is attached to the estimate at the same visual weight,
        // in neutral grey: it qualifies the estimate, it does not upgrade it to a
        // decision.
        StatusPill(
            label = confidenceLabel(s, assessment.confidence),
            kind = PillKind.Neutral,
        )
    }

    Text(
        coverageAdvice(s, assessment.coverage),
        fontSize = 14.sp,
        color = cs.onSurface,
    )

    SectionHeading(stringResource(R.string.claim_assess_reasoning_title))
    Text(assessment.reasoning, fontSize = 13.sp, color = cs.onSurface)

    // `UNCLEAR` is not a dead end: the questions ARE the answer, so they get a
    // heading that says so instead of an error or an empty state.
    SectionHeading(assessmentQuestionsTitle(s, assessment.coverage))
    if (questions.isEmpty()) {
        Text(
            stringResource(R.string.claim_assess_questions_none),
            fontSize = 13.sp,
            color = cs.onSurfaceVariant,
        )
    } else {
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            questions.forEachIndexed { index, question ->
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
                    Text(
                        "${index + 1}.",
                        fontSize = 13.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = cs.primary,
                        modifier = Modifier.width(22.dp),
                    )
                    Text(question, fontSize = 13.sp, color = cs.onSurface)
                }
            }
        }
    }

    if (letter.isNotEmpty()) {
        DraftLetterBlock(
            letter = letter,
            onCopy = { onCopyLetter(letter) },
            onShare = { onShareLetter(letter) },
        )
    }

    Text(
        stringResource(R.string.claim_assess_footer),
        fontSize = 11.sp,
        color = cs.onSurfaceVariant,
    )
    assessmentProvenance(s, assessment)?.let {
        Text(it, fontSize = 11.sp, color = cs.onSurfaceVariant)
    }
}

/**
 * The banner the result opens with. It is a neutral surface (not a success or
 * warning colour) because it is a framing statement, not an outcome.
 */
@Composable
private fun AdviceNotVerdictBanner() {
    val cs = MaterialTheme.colorScheme
    Card(
        colors = CardDefaults.cardColors(containerColor = cs.surfaceContainerHighest),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
        shape = RoundedCornerShape(16.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(Modifier.padding(14.dp), verticalAlignment = Alignment.Top) {
            Icon(
                Icons.Outlined.Info, null,
                tint = cs.primary,
                modifier = Modifier.size(18.dp),
            )
            Spacer(Modifier.width(8.dp))
            Column {
                Text(
                    stringResource(R.string.claim_assess_disclaimer_title),
                    fontSize = 14.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = cs.onSurface,
                )
                Spacer(Modifier.height(2.dp))
                Text(
                    stringResource(R.string.claim_assess_disclaimer_body),
                    fontSize = 12.sp,
                    color = cs.onSurfaceVariant,
                )
            }
        }
    }
}

/**
 * The Vietnamese letter.
 *
 * The language badge and the note are the point: the letter is Vietnamese **on
 * purpose**, so a user reading the rest of the screen in English is not looking
 * at a bug or a half-translated screen. `SelectableText` is wrapped in
 * [SelectionContainer] as a second path to the clipboard, alongside the explicit
 * copy button.
 */
@Composable
private fun DraftLetterBlock(
    letter: String,
    onCopy: () -> Unit,
    onShare: () -> Unit,
) {
    val cs = MaterialTheme.colorScheme
    Card(
        colors = CardDefaults.cardColors(containerColor = cs.surfaceContainerHighest),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
        shape = RoundedCornerShape(16.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(
            Modifier.padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    stringResource(R.string.claim_assess_letter_title),
                    fontSize = 14.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = cs.onSurface,
                    modifier = Modifier.weight(1f),
                )
                Spacer(Modifier.width(8.dp))
                StatusPill(
                    label = stringResource(R.string.claim_assess_letter_language_badge),
                    kind = PillKind.Neutral,
                )
            }
            Text(
                stringResource(R.string.claim_assess_letter_language_note),
                fontSize = 11.sp,
                color = cs.onSurfaceVariant,
            )
            SelectionContainer {
                Text(letter, fontSize = 13.sp, color = cs.onSurface)
            }
            Text(
                stringResource(R.string.claim_assess_letter_draft_note),
                fontSize = 11.sp,
                color = cs.onSurfaceVariant,
            )
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                OutlinedButton(onClick = onCopy, modifier = Modifier.weight(1f)) {
                    Icon(Icons.Filled.ContentCopy, null, modifier = Modifier.size(16.dp))
                    Spacer(Modifier.width(6.dp))
                    Text(stringResource(R.string.claim_assess_letter_copy))
                }
                OutlinedButton(onClick = onShare, modifier = Modifier.weight(1f)) {
                    Icon(Icons.Filled.Share, null, modifier = Modifier.size(16.dp))
                    Spacer(Modifier.width(6.dp))
                    Text(stringResource(R.string.claim_assess_letter_share))
                }
            }
        }
    }
}

@Composable
private fun SectionHeading(text: String) {
    Text(
        text,
        fontSize = 13.sp,
        fontWeight = FontWeight.SemiBold,
        color = MaterialTheme.colorScheme.onSurface,
    )
}

// ---- Android side effects (the only part of this file that is not testable) ----

private fun copyLetterToClipboard(context: Context, letter: String) {
    val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
    clipboard.setPrimaryClip(
        ClipData.newPlainText(
            context.getString(R.string.claim_assess_letter_clip_label),
            letter,
        ),
    )
}

/**
 * Opens the system share sheet for the Vietnamese letter.
 *
 * The self-target is excluded for the same reason the handover certificate does
 * it (`ShareLinks.kt`): the app is itself an `ACTION_SEND` / `text/plain` target,
 * and picking that row would re-enter the incoming-share handler with a letter
 * instead of a product link. Excluding by package keeps every other app in the
 * sheet. No target at all is reported rather than swallowed; copy still works.
 */
private fun shareLetter(context: Context, letter: String) {
    val outgoing = outgoingShare(letter)
    val send = Intent(outgoing.action).apply {
        type = outgoing.mimeType
        putExtra(Intent.EXTRA_TEXT, outgoing.message)
    }
    val resolved = context.packageManager
        .queryIntentActivities(send, 0)
        .map { info ->
            ResolvedTarget(
                component = "${info.activityInfo.packageName}/${info.activityInfo.name}",
                isSelfTarget = info.activityInfo.packageName == context.packageName,
            )
        }
    val excluded = excludedShareTargets(resolved)

    val chooser = Intent.createChooser(
        send,
        context.getString(R.string.claim_assess_letter_chooser),
    ).apply {
        if (excluded.isNotEmpty()) {
            putExtra(Intent.EXTRA_EXCLUDE_COMPONENTS, excluded.toTypedArray())
        }
    }
    try {
        context.startActivity(chooser)
    } catch (e: ActivityNotFoundException) {
        Log.w("ClaimAssessment", "no share target", e)
        Toast.makeText(
            context,
            context.getString(R.string.claim_assess_letter_no_target),
            Toast.LENGTH_LONG,
        ).show()
    }
}
