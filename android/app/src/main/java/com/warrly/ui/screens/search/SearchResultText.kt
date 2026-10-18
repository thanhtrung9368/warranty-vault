package com.warrly.ui.screens.search

import androidx.annotation.StringRes
import com.warrly.R
import com.warrly.i18n.AppStrings
import com.warrly.network.Attachment
import com.warrly.network.Device
import com.warrly.network.Subscription
import com.warrly.network.WishlistItem
import com.warrly.ui.components.CategoryLabels
import com.warrly.ui.screens.inbox.inboxUploadedLabel
import com.warrly.ui.screens.inbox.isUnfiled

/**
 * Group headings of the search results, one per entity kind.
 *
 * The copy is deliberately identical to the tab / page headers the rows lead
 * to ("Thiết bị", "Gói dịch vụ", "Wishlist") — a user tapping a result should
 * land on a screen that calls itself the same thing.
 */
object SearchGroups {
    /**
     * One key per group, and the first two REUSE the destination screen's own
     * title (`nav_devices`, `subs_subscriptions`) rather than declaring a second
     * sentence with the same meaning — two keys for one sentence is how the two
     * translations drift apart. "Wishlist" is identical in both languages, so it
     * is a plain constant, exactly like the web's facet labels.
     */
    @StringRes
    val DEVICES = R.string.nav_devices

    @StringRes
    val SUBSCRIPTIONS = R.string.subs_subscriptions

    const val WISHLIST = "Wishlist"

    /**
     * The OCR `attachments` group. Reuses the attachment section's own label
     * (`dev_attachments`) instead of a fourth copy of "Tệp đính kèm"; the rows
     * are the same public `Attachment` shape the device detail and the inbox
     * render, so the same word is the honest heading.
     */
    @StringRes
    val ATTACHMENTS = R.string.dev_attachments

    /** `"Thiết bị (3)"` — the section header text. */
    fun header(label: String, count: Int): String = "$label ($count)"
}

/**
 * The one-line summary under a device result's name.
 *
 * The category name comes from the shared [CategoryLabels] table (never a
 * private map — `api/internal/services/category_seed_test.go` pins that table
 * against the web, iOS and migration copies), then brand, then model — so
 * "samsung" → "Điện thoại • Samsung • Galaxy S24" reads as where the match came
 * from. Blanks are dropped instead of rendering " •  • ".
 */
fun deviceSubtitle(device: Device): String =
    listOfNotNull(CategoryLabels.label(device.category), device.brand, device.model)
        .map { it.trim() }
        .filter { it.isNotEmpty() }
        .joinToString(" • ")

/**
 * Brand + plan for a subscription result ("Samsung • Cloud 200GB"). A
 * subscription with neither falls back to its billing cycle, which is always
 * set (the enum is non-nullable), so the line is never empty. The cycle name is
 * a resource on the enum, hence the [AppStrings] parameter — same seam every
 * other pure formatter in this app takes.
 */
fun subscriptionSubtitle(s: AppStrings, sub: Subscription): String {
    val parts = listOfNotNull(sub.brand, sub.plan)
        .map { it.trim() }
        .filter { it.isNotEmpty() }
    return if (parts.isEmpty()) s.get(sub.billingCycle.labelRes) else parts.joinToString(" • ")
}

/**
 * Brand for a wishlist result, falling back to the (shared-table) category
 * name and then to nothing — the row already shows both status and priority
 * pills, so the subtitle only has to say *what* the item is.
 */
fun wishlistSubtitle(item: WishlistItem): String {
    val brand = item.brand?.trim()
    if (!brand.isNullOrEmpty()) return brand
    val category = item.category?.trim()
    return if (category.isNullOrEmpty()) "" else CategoryLabels.label(category)
}

// ---- The `attachments` group (OCR text, roadmap #13) ----------------------

/**
 * Where a search hit's file lives: **filed on a device**, or waiting in the
 * capture-first inbox.
 *
 * This is the same rule the inbox itself is built on — [isUnfiled] is imported
 * rather than re-derived, so "deviceId missing/blank means inbox" has exactly
 * one definition in the app. A hit carries `deviceId` explicitly, and `null`
 * there is the contract's "still in the inbox", not a decoding accident.
 */
enum class AttachmentFiling {
    /** `deviceId` is a real id: the file belongs to that device. */
    FILED,

    /** `deviceId` is null/blank: the file is in the inbox, not on a device. */
    INBOX,
}

/** Filed-vs-inbox decision for one search hit. */
fun attachmentFiling(attachment: Attachment): AttachmentFiling =
    if (isUnfiled(attachment)) AttachmentFiling.INBOX else AttachmentFiling.FILED

/**
 * A row of the `attachments` group, already mapped out of the wire shape.
 *
 * The screen must not do this mapping itself: it is the part with rules (which
 * half of `Attachment` is the title, whether the timestamp is displayable, what
 * the two placement words are), and a JVM test can pin all of it in both
 * languages without a device.
 */
data class AttachmentResultRow(
    /** The original hit, kept for opening the file (`openAttachment`). */
    val attachment: Attachment,
    /** `"Uploaded 02/01/2025"`, or empty when the server sent no usable time. */
    val uploadedLabel: String,
    val filing: AttachmentFiling,
    /** `"Filed"` / `"In the inbox"` in the UI language. */
    val filingLabel: String,
)

/**
 * Maps ONE `attachments` hit to its render row.
 *
 * The filename (already on [Attachment]) is deliberately not copied here —
 * truncation is a layout concern, and the screen passes `fileName` straight to
 * `ResultCard`. The upload line goes through [inboxUploadedLabel], the app's one
 * `dd/MM/yyyy` + "uploaded" convention, so a search hit and an inbox row cannot
 * disagree about a timestamp; a missing/malformed time yields an empty line
 * rather than a made-up date.
 */
fun attachmentResultRow(s: AppStrings, attachment: Attachment): AttachmentResultRow {
    val filing = attachmentFiling(attachment)
    return AttachmentResultRow(
        attachment = attachment,
        uploadedLabel = inboxUploadedLabel(s, attachment.uploadedAt).orEmpty(),
        filing = filing,
        filingLabel = s.get(
            when (filing) {
                AttachmentFiling.FILED -> R.string.search_attachment_filed
                AttachmentFiling.INBOX -> R.string.search_attachment_inbox
            },
        ),
    )
}

/** Maps the whole group, preserving the server's `uploadedAt DESC` order. */
fun attachmentResultRows(s: AppStrings, attachments: List<Attachment>): List<AttachmentResultRow> =
    attachments.map { attachmentResultRow(s, it) }
