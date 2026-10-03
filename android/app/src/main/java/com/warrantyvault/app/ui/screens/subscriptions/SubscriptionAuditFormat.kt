package com.warrantyvault.app.ui.screens.subscriptions

import com.warrantyvault.app.network.ActionCounts
import com.warrantyvault.app.network.SubscriptionAudit
import com.warrantyvault.app.network.SubscriptionAuditFinding
import com.warrantyvault.app.network.SubscriptionAuditThresholds
import com.warrantyvault.app.ui.screens.actions.ActionSeverity
import com.warrantyvault.app.ui.screens.actions.actionDateLabel
import com.warrantyvault.app.ui.screens.actions.actionSeverityOf
import java.text.NumberFormat
import java.util.Locale

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
internal fun auditSeverityLabel(severity: ActionSeverity): String = when (severity) {
    ActionSeverity.HIGH -> "Đáng chú ý"
    ActionSeverity.MEDIUM -> "Nên xem lại"
    ActionSeverity.LOW -> "Nhắc nhẹ"
    ActionSeverity.UNKNOWN -> "Khác"
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
    finding: SubscriptionAuditFinding,
    thresholds: SubscriptionAuditThresholds?,
): String? = when (finding.kind.trim().uppercase()) {
    KIND_QUIET -> thresholds?.takeIf { it.quietMinAutoCharges > 0 && it.quietMinMonths > 0 }?.let {
        "Luật: gói đang hoạt động, không có khoản nào do bạn tự ghi, " +
            "máy đã tự trừ ít nhất ${it.quietMinAutoCharges} lần " +
            "và khoản tự trừ đầu tiên cách đây ít nhất ${it.quietMinMonths} tháng."
    }

    KIND_PRICE -> thresholds?.takeIf { it.priceRiseMinPercent > 0 }?.let {
        "Luật: so hai kỳ thanh toán liền kề; mọi mức tăng đều được báo, " +
            "từ ${it.priceRiseMinPercent}% trở lên mới coi là đáng kể."
    }

    KIND_DUPLICATE -> when (finding.reason?.trim()?.uppercase()) {
        REASON_SAME_BRAND -> "Luật: hai gói đang hoạt động cùng hãng và cùng loại."
        REASON_SAME_NAME -> if (thresholds?.duplicateNormalized == true) {
            "Luật: hai gói đang hoạt động trùng tên sau khi bỏ dấu và không phân biệt hoa/thường."
        } else {
            "Luật: hai gói đang hoạt động trùng tên."
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
    finding: SubscriptionAuditFinding,
    thresholds: SubscriptionAuditThresholds?,
): String? {
    if (finding.material != false) return null
    val percent = thresholds?.priceRiseMinPercent ?: 0
    return if (percent > 0) {
        "Mức tăng này dưới $percent% nên chỉ là thay đổi nhỏ — không phải cảnh báo."
    } else {
        "Mức tăng này được đánh giá là nhỏ — không phải cảnh báo."
    }
}

/** Short pill text for a finding whose rise the server judged immaterial. */
internal fun auditMinorPillLabel(finding: SubscriptionAuditFinding): String? =
    if (finding.material == false) "Thay đổi nhỏ" else null

/**
 * The money line for one finding, straight from the payload's own figures:
 *
 *  * `QUIET_AUTO_RENEW` — what the MACHINE charged in total and how many times
 *    (never "total spent": user-logged payments are deliberately excluded);
 *  * `PRICE_INCREASED` — the absolute rise plus the percentage when it is
 *    computable (a previous period of 0đ cannot be a percentage, and the server
 *    says so by sending `increasePercent = null`);
 *  * `DUPLICATE` — the combined monthly equivalent of both plans.
 */
internal fun auditMoneyLine(finding: SubscriptionAuditFinding): String? =
    when (finding.kind.trim().uppercase()) {
        KIND_QUIET -> {
            if (finding.chargeCount <= 0) {
                null
            } else {
                "Máy đã tự trừ: ${formatVndLong(finding.chargedTotalVnd)} · " +
                    "${finding.chargeCount} lần"
            }
        }

        KIND_PRICE -> finding.increaseVnd?.let { rise ->
            val percent = finding.increasePercent
            if (percent != null) {
                "Tăng ${formatVndLong(rise)} (+$percent%)"
            } else {
                "Tăng ${formatVndLong(rise)} (kỳ trước 0đ nên không tính được %)"
            }
        }

        KIND_DUPLICATE -> if (finding.monthlyVnd > 0) {
            "Quy đổi tháng của cả hai: ~${formatVndLong(finding.monthlyVnd)}"
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
internal fun auditTimelineNote(finding: SubscriptionAuditFinding): String? {
    val parts = mutableListOf<String>()
    actionDateLabel(finding.lastRecordedAt)?.let { parts += "Khoản ghi nhận gần nhất: $it" }
    actionDateLabel(finding.nextRenewalAt)?.let { date ->
        val days = finding.daysUntilRenewal
        parts += if (days != null) "Kỳ gia hạn tới: $date (còn $days ngày)" else "Kỳ gia hạn tới: $date"
    }
    return parts.takeIf { it.isNotEmpty() }?.joinToString(" · ")
}

/**
 * The reassurance text, only when the server actually asserted `advisory`. A
 * payload without it must not be described as harmless — that is a claim about
 * the server's behaviour, not a decoration.
 */
internal fun auditAdvisoryNote(advisory: Boolean): String? =
    if (advisory) "Chỉ tư vấn: không có gì bị sửa, bị huỷ hay bị tắt tự động." else null

/**
 * The "Luật đang áp dụng" card: one line per rule, built from the payload's
 * thresholds. Empty when the server sent none — the card is then hidden instead
 * of showing an empty box.
 */
internal fun auditThresholdLines(thresholds: SubscriptionAuditThresholds?): List<String> {
    if (thresholds == null) return emptyList()
    val lines = mutableListOf<String>()
    if (thresholds.quietMinAutoCharges > 0 && thresholds.quietMinMonths > 0) {
        lines += "Tự trừ lâu không ghi nhận: ≥ ${thresholds.quietMinAutoCharges} khoản máy tự trừ " +
            "và khoản đầu cách đây ≥ ${thresholds.quietMinMonths} tháng."
    }
    if (thresholds.priceRiseMinPercent > 0) {
        lines += "Tăng giá: mọi mức tăng đều được báo; " +
            "từ ${thresholds.priceRiseMinPercent}% trở lên là đáng kể."
    }
    if (thresholds.upcomingRenewalDays > 0) {
        lines += "Còn kịp xử lý trước khi bị trừ tiền: ${thresholds.upcomingRenewalDays} ngày."
    }
    if (thresholds.duplicateNormalized) {
        lines += "Trùng nhau: so tên có bỏ dấu, không phân biệt hoa/thường, chỉ giữa các gói đang hoạt động."
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
internal fun auditSubtitle(counts: ActionCounts): String = when {
    counts.total == 0 -> "Không có gì đáng lưu ý"
    counts.total == 1 -> "1 phát hiện cần xem lại"
    else -> "${counts.total} phát hiện cần xem lại"
}

/** `GET /api/v1/subscriptions/audit` — short Vietnamese label for the entry row. */
internal const val AUDIT_ENTRY_TITLE = "Soát gói đăng ký"

/** One honest sentence about what the entry row opens. No verdict, no numbers. */
internal const val AUDIT_ENTRY_SUBTITLE =
    "Đọc lịch sử thanh toán để tìm gói tự trừ lâu không thấy ghi nhận, gói tăng giá và gói trùng nhau."

/**
 * Money for the audit screen. `Long`, because every amount on the wire is int64:
 * an `Int` would throw inside kotlinx.serialization on a large value and blank
 * the whole screen — a trap this app has already been caught by.
 */
internal fun formatVndLong(amount: Long): String {
    val nf = NumberFormat.getNumberInstance(Locale("vi", "VN"))
    return nf.format(amount) + "đ"
}

/** Finding kinds, as raw codes (a kind this build has not seen degrades). */
internal const val KIND_QUIET = "QUIET_AUTO_RENEW"
internal const val KIND_PRICE = "PRICE_INCREASED"
internal const val KIND_DUPLICATE = "DUPLICATE"

/** Duplicate signals. */
internal const val REASON_SAME_NAME = "SAME_NAME"
internal const val REASON_SAME_BRAND = "SAME_BRAND_CATEGORY"

/** `true` when the audit found nothing at all. */
internal fun auditIsEmpty(audit: SubscriptionAudit): Boolean = audit.findings.isEmpty()
