package com.warrantyvault.app.ui.screens.subscriptions

import androidx.annotation.StringRes
import com.warrantyvault.app.R
import com.warrantyvault.app.i18n.AppStrings
import com.warrantyvault.app.i18n.money
import com.warrantyvault.app.network.ActionCounts
import com.warrantyvault.app.network.SubscriptionAudit
import com.warrantyvault.app.network.SubscriptionAuditFinding
import com.warrantyvault.app.network.SubscriptionAuditThresholds
import com.warrantyvault.app.ui.screens.actions.ActionSeverity
import com.warrantyvault.app.ui.screens.actions.actionDateLabel
import com.warrantyvault.app.ui.screens.actions.actionSeverityOf

/**
 * "Soát gói đăng ký" — the pure half of `GET /api/v1/subscriptions/audit`.
 *
 * ## The line this file exists to hold
 *
 * **The app cannot know whether a subscription is used.** There is no usage
 * telemetry and no consumer bank-transaction API, and the schema stores nothing
 * that means "this service was opened". The backend therefore reports on
 * *recording*: "lâu rồi không thấy ghi nhận gì". So:
 *
 *  * `title` and `detail` are the server's sentences and are rendered **verbatim**
 *    — no local copy rewrites them, because every one of them names the numbers
 *    that produced it;
 *  * nothing here ever produces the words "không dùng" / "bỏ quên" about a
 *    service, and no "huỷ gói" affordance exists to build (the endpoint has no
 *    write path at all);
 *  * `material = false` is rendered as **minor**, never as an alert;
 *  * "ngày ghi nhận gần nhất" is labelled as a RECORDING date, because the
 *    openapi is explicit that it is not the last-used date.
 *
 * The rule that produced a verdict is explainable because the payload carries
 * `thresholds`; these helpers turn those numbers into one Vietnamese sentence per
 * finding. If the server sends no thresholds, the rule line is omitted rather
 * than guessed at.
 */

/** Severity uses the queue's enum: the two payloads share the same codes. */
internal fun auditSeverityOf(raw: String): ActionSeverity = actionSeverityOf(raw)

/**
 * The audit's own words for a severity. The queue's labels ("Cần xử lý ngay") are
 * phrased for work items; here nothing is being asked of the user, so the pill
 * only grades how much a finding deserves a look.
 */
internal fun auditSeverityLabel(s: AppStrings, severity: ActionSeverity): String = when (severity) {
    ActionSeverity.HIGH -> s.get(R.string.audit_severity_high)
    ActionSeverity.MEDIUM -> s.get(R.string.audit_severity_medium)
    ActionSeverity.LOW -> s.get(R.string.audit_severity_low)
    ActionSeverity.UNKNOWN -> s.get(R.string.audit_severity_unknown)
}

/**
 * The rule behind one finding, in Vietnamese, built from `thresholds` and the
 * finding's own `reason`.
 *
 * Returns `null` when the payload does not carry enough to state the rule
 * honestly (no thresholds for a threshold-based rule, or a kind this build does
 * not know). The UI then shows only the server's own `detail` — a missing
 * explanation is better than a fabricated one.
 */
internal fun auditRuleLabel(
    s: AppStrings,
    finding: SubscriptionAuditFinding,
    thresholds: SubscriptionAuditThresholds?,
): String? = when (finding.kind.trim().uppercase()) {
    KIND_QUIET -> thresholds?.takeIf { it.quietMinAutoCharges > 0 && it.quietMinMonths > 0 }?.let {
        s.get(R.string.audit_rule_quiet, it.quietMinAutoCharges, it.quietMinMonths)
    }

    KIND_PRICE -> thresholds?.takeIf { it.priceRiseMinPercent > 0 }?.let {
        s.get(R.string.audit_rule_price, it.priceRiseMinPercent)
    }

    KIND_DUPLICATE -> when (finding.reason?.trim()?.uppercase()) {
        REASON_SAME_BRAND -> s.get(R.string.audit_rule_duplicate_same_brand)
        REASON_SAME_NAME -> if (thresholds?.duplicateNormalized == true) {
            s.get(R.string.audit_rule_duplicate_same_name_normalized)
        } else {
            s.get(R.string.audit_rule_duplicate_same_name)
        }
        else -> null
    }

    else -> null
}

/**
 * The "mức tăng nhỏ" line for a `PRICE_INCREASED` finding whose rise the server
 * judged immaterial, or `null` when there is nothing to soften.
 *
 * This is the honesty requirement in its smallest form: `material = false` must
 * read as a minor change, not as an alert. A `material` the server never sent
 * (`null`) produces no claim either way.
 */
internal fun auditMaterialNote(
    s: AppStrings,
    finding: SubscriptionAuditFinding,
    thresholds: SubscriptionAuditThresholds?,
): String? {
    if (finding.material != false) return null
    val percent = thresholds?.priceRiseMinPercent ?: 0
    return if (percent > 0) {
        s.get(R.string.audit_material_note_small_below, percent)
    } else {
        s.get(R.string.audit_material_note_small)
    }
}

/** Short pill text for a finding whose rise the server judged immaterial. */
internal fun auditMinorPillLabel(s: AppStrings, finding: SubscriptionAuditFinding): String? =
    if (finding.material == false) s.get(R.string.audit_minor_pill) else null

/**
 * The money line for one finding, straight from the payload's own figures:
 *
 *  * `QUIET_AUTO_RENEW` — what the MACHINE charged in total and how many times
 *    (never "total spent": user-logged payments are deliberately excluded);
 *  * `PRICE_INCREASED` — the absolute rise plus the percentage when it is
 *    computable (a previous period of 0 ₫ cannot be a percentage, and the server
 *    says so by sending `increasePercent = null`);
 *  * `DUPLICATE` — the combined monthly equivalent of both plans.
 */
internal fun auditMoneyLine(s: AppStrings, finding: SubscriptionAuditFinding): String? =
    when (finding.kind.trim().uppercase()) {
        KIND_QUIET -> {
            if (finding.chargeCount <= 0) {
                null
            } else {
                s.quantity(
                    R.plurals.audit_money_autocharged,
                    // `chargeCount` is int64 on the wire. Only the plural *bucket*
                    // is narrowed — anything but 1 selects `other`, and Vietnamese
                    // has no `one` form at all — while the rendered number stays a
                    // Long, so a count past Int.MAX_VALUE still prints in full.
                    finding.chargeCount.toInt(),
                    s.money(finding.chargedTotalVnd),
                    finding.chargeCount,
                )
            }
        }

        KIND_PRICE -> finding.increaseVnd?.let { rise ->
            val percent = finding.increasePercent
            if (percent != null) {
                s.get(R.string.audit_money_rise_percent, s.money(rise), percent)
            } else {
                s.get(R.string.audit_money_rise_no_percent, s.money(rise))
            }
        }

        KIND_DUPLICATE -> if (finding.monthlyVnd > 0) {
            s.get(R.string.audit_money_monthly_both, s.money(finding.monthlyVnd))
        } else {
            null
        }

        else -> null
    }

/**
 * Dates that help act on a finding, labelled so they cannot be mistaken for
 * usage:
 *
 *  * "Khoản ghi nhận gần nhất" is a **recording** date. The openapi is explicit
 *    that this is not the last-used date — the app has no way to know that — so
 *    the label must never say "dùng lần cuối".
 *  * "Kỳ gia hạn tới" plus the server's own day count, which is the window in
 *    which the finding is still actionable.
 */
internal fun auditTimelineNote(s: AppStrings, finding: SubscriptionAuditFinding): String? {
    val parts = mutableListOf<String>()
    actionDateLabel(finding.lastRecordedAt)?.let {
        parts += s.get(R.string.audit_timeline_last_recorded, it)
    }
    actionDateLabel(finding.nextRenewalAt)?.let { date ->
        val days = finding.daysUntilRenewal
        parts += if (days != null) {
            s.quantity(R.plurals.audit_timeline_renewal_with_days, days, date, days)
        } else {
            s.get(R.string.audit_timeline_renewal, date)
        }
    }
    return parts.takeIf { it.isNotEmpty() }?.joinToString(" · ")
}

/**
 * The reassurance text, only when the server actually asserted `advisory`. A
 * payload without it must not be described as harmless — that is a claim about
 * the server's behaviour, not a decoration.
 */
internal fun auditAdvisoryNote(s: AppStrings, advisory: Boolean): String? =
    if (advisory) s.get(R.string.audit_advisory) else null

/**
 * The "Luật đang áp dụng" card: one line per rule, built from the payload's
 * thresholds. Empty when the server sent none — the card is then hidden instead
 * of showing an empty box.
 */
internal fun auditThresholdLines(
    s: AppStrings,
    thresholds: SubscriptionAuditThresholds?,
): List<String> {
    if (thresholds == null) return emptyList()
    val lines = mutableListOf<String>()
    if (thresholds.quietMinAutoCharges > 0 && thresholds.quietMinMonths > 0) {
        lines += s.get(
            R.string.audit_threshold_quiet,
            thresholds.quietMinAutoCharges,
            thresholds.quietMinMonths,
        )
    }
    if (thresholds.priceRiseMinPercent > 0) {
        lines += s.get(R.string.audit_threshold_price, thresholds.priceRiseMinPercent)
    }
    if (thresholds.upcomingRenewalDays > 0) {
        lines += s.get(R.string.audit_threshold_renewal, thresholds.upcomingRenewalDays)
    }
    if (thresholds.duplicateNormalized) {
        lines += s.get(R.string.audit_threshold_duplicate)
    }
    return lines
}

/** A finding's link to one of the subscriptions involved. */
internal data class AuditLink(val subscriptionId: String, val name: String?)

/**
 * The subscriptions a finding points at, in payload order, paired with their
 * names when the server sent them. A finding with ids but no names still yields
 * links — the id is enough to open the row, and dropping the link would hide the
 * only way to act on the finding.
 */
internal fun auditLinks(finding: SubscriptionAuditFinding): List<AuditLink> =
    finding.subscriptionIds
        .filter { it.isNotBlank() }
        .mapIndexed { index, id ->
            AuditLink(id, finding.names.getOrNull(index)?.takeIf { it.isNotBlank() })
        }

/**
 * Server order is severity, then biggest monthly drain first, then key. Re-sorted
 * client-side so the screen's own badge and sectioning stay consistent with it.
 */
internal fun auditSortFindings(
    findings: List<SubscriptionAuditFinding>,
): List<SubscriptionAuditFinding> =
    findings.sortedWith(
        compareBy(
            { auditSeverityOf(it.severity).rank },
            { -it.monthlyVnd },
            { it.findingKey },
        ),
    )

/**
 * The subtitle under the screen title, built from `counts` — the server's own
 * tally of every finding, not `findings.size`.
 */
internal fun auditSubtitle(s: AppStrings, counts: ActionCounts): String = when (counts.total) {
    0 -> s.get(R.string.audit_nothing_worth_flagging)
    else -> s.quantity(R.plurals.audit_findings, counts.total, counts.total)
}

/** `GET /api/v1/subscriptions/audit` — short label for the entry row. */
@StringRes
internal val AUDIT_ENTRY_TITLE = R.string.audit_entry_title

/** One honest sentence about what the entry row opens. No verdict, no numbers. */
@StringRes
internal val AUDIT_ENTRY_SUBTITLE = R.string.audit_entry_subtitle

/** Finding kinds, as raw codes (a kind this build has not seen degrades). */
internal const val KIND_QUIET = "QUIET_AUTO_RENEW"
internal const val KIND_PRICE = "PRICE_INCREASED"
internal const val KIND_DUPLICATE = "DUPLICATE"

/** Duplicate signals. */
internal const val REASON_SAME_NAME = "SAME_NAME"
internal const val REASON_SAME_BRAND = "SAME_BRAND_CATEGORY"

/** `true` when the audit found nothing at all. */
internal fun auditIsEmpty(audit: SubscriptionAudit): Boolean = audit.findings.isEmpty()
