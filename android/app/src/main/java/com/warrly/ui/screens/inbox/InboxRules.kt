package com.warrly.ui.screens.inbox

import com.warrly.R
import com.warrly.i18n.AppStrings
import com.warrly.network.ApiErrorEnvelope
import com.warrly.network.Attachment
import com.warrly.network.Device
import com.warrly.ui.screens.vietnamDate
import kotlinx.serialization.json.Json
import retrofit2.HttpException

/**
 * The capture-first inbox — the pure half.
 *
 * The inbox is not a new entity: it is **the attachments whose `deviceId` is
 * null**. That is the whole model, and it is why these rules are three small
 * predicates rather than a second data layer:
 *
 *  1. [isUnfiled] — is this row still waiting, or already on a device?
 *  2. [inboxBadgeCount] / [inboxBadgeLabel] — the number on the nav entry. It
 *     counts *unfiled* rows and draws nothing at zero.
 *  3. [inboxFileFailure] / [inboxFileError] / [inboxFileFailureMessage] — the one
 *     409 the contract names (`LIMIT_REACHED`: the target device already holds
 *     5), turned into a sentence that also says the way out.
 *
 * Everything here takes plain values and returns plain values, so the JVM tests
 * can pin both languages through `ResCatalog` without Robolectric — the same
 * seam `devices/WarrantyTerms.kt` and `actions/ActionQueueFormat.kt` use.
 */

/**
 * `MAX_ATTACHMENTS_PER_DEVICE` in `api/internal/services/attachments.go`.
 *
 * An **inbox** item does not count toward any device's five; the limit only
 * applies to the target of a file call. Kept here so the picker's `n/5` and the
 * 409 copy cannot disagree with the server.
 */
const val MAX_ATTACHMENTS_PER_DEVICE: Int = 5

/**
 * The machine-readable error the file endpoint answers with when the target
 * device is full. The frozen contract spells it **409 `LIMIT_REACHED`**; the
 * wire carries it lowercased (see [inboxFileFailure]).
 */
const val LIMIT_REACHED: String = "LIMIT_REACHED"

/** Badge labels are capped rather than allowed to grow the bubble off-screen. */
const val MAX_BADGE_COUNT: Int = 99

/**
 * `true` when [attachment] has **no device yet** — i.e. it is in the inbox.
 *
 * A blank `deviceId` also counts as unfiled: an id is never blank, so a blank
 * value is missing data rather than a real device, and treating it as filed
 * would hide the row from the one screen that can fix it.
 *
 * The value is only ever read, never inferred from another field: an attachment
 * on device `dev-1` is filed even if the caller's inbox request happens to
 * include it.
 */
fun isUnfiled(attachment: Attachment): Boolean = attachment.deviceId.isNullOrBlank()

/**
 * The number the Inbox nav badge should draw, or **`null` when it should draw
 * nothing at all**.
 *
 * `null` is not the same as `0` here: the shell uses the null to leave the
 * bubble off entirely, while a "0" bubble would read as a task ("0 việc") — the
 * same distinction the Dashboard's action-queue badge makes.
 *
 * Only [isUnfiled] rows are counted. `GET /api/v1/inbox` already returns exactly
 * those, but filtering here keeps a stale or over-eager payload from inflating
 * the badge, and it makes the definition of the count literally the definition of
 * the inbox.
 */
fun inboxBadgeCount(attachments: List<Attachment>): Int? =
    attachments.count(::isUnfiled).takeIf { it > 0 }

/**
 * The badge's text: the exact count up to [MAX_BADGE_COUNT], then `99+`.
 *
 * A four-digit bubble would be wider than the icon it sits on; the cap is a
 * display rule only and never feeds back into [inboxBadgeCount].
 */
fun inboxBadgeLabel(count: Int): String =
    if (count > MAX_BADGE_COUNT) "$MAX_BADGE_COUNT+" else count.coerceAtLeast(0).toString()

/**
 * `true` when [device] is already at the per-device cap.
 *
 * This is the **hint** the picker shows (`5/5` in the error colour); it is
 * deliberately not a hard client-side block. `Device.attachmentCount` is a list
 * projection that can be stale or absent (it defaults to `0`), so the only
 * authority on "this device is full" is the server's 409 — and the screen has a
 * real answer for that. A greyed-out row would hide the way out instead.
 */
fun inboxDeviceIsFull(device: Device): Boolean =
    device.attachmentCount >= MAX_ATTACHMENTS_PER_DEVICE

/** What a failed file call means for the user. */
enum class InboxFileFailure {
    /** 409 `LIMIT_REACHED`: the target device already has five attachments. */
    DEVICE_FULL,

    /**
     * Anything else (400, 404, 5xx, a dead socket). The app does not invent a
     * sentence for these: the server's translated `message` is shown instead.
     */
    OTHER,
}

/**
 * Maps the two wire facts that identify a full device to [InboxFileFailure].
 *
 * Both the status **and** the code are required: a 409 with another code is a
 * different conflict, and a `LIMIT_REACHED` code on a non-409 response is not
 * the documented contract.
 *
 * The comparison is **case-insensitive on purpose**. The contract names the code
 * `LIMIT_REACHED`, but the Go envelope writer lowercases every domain-service
 * code (`handlers.writeServiceError` does `strings.ToLower`), so the byte on the
 * wire is `"limit_reached"` — and the handler test asserts exactly that. Matching
 * only the contract's spelling would silently demote the real 409 to "some other
 * conflict" and lose the "pick another device or delete" dialog. Accepting both
 * spellings costs nothing and survives either convention.
 */
fun inboxFileFailure(status: Int?, errorCode: String?): InboxFileFailure =
    if (status == 409 && errorCode?.equals(LIMIT_REACHED, ignoreCase = true) == true) {
        InboxFileFailure.DEVICE_FULL
    } else {
        InboxFileFailure.OTHER
    }

/**
 * A parsed file-call failure: what it means **and** the server's own translated
 * sentence, read from the same error body in one pass.
 *
 * The message has to be captured here rather than re-read later because
 * `ResponseBody.string()` consumes the one-shot error body: an adapter that only
 * looked at the code would leave `toUserMessage` with an empty body view, and
 * every 409 that is *not* a full device would then show "Lỗi máy chủ (409)"
 * instead of the server's explanation. `InboxViewModelTest` pins that.
 */
data class InboxFileError(
    val failure: InboxFileFailure,
    /** The envelope's `message` (already in the UI language), or `null`. */
    val serverMessage: String?,
)

/**
 * [inboxFileFailure] over the `HttpException` Retrofit throws, reading both the
 * machine code and the message from the standard `{error, message}` envelope.
 *
 * Kept separate from [inboxFileFailure] so the status/code rule is testable
 * without building an HTTP response, and this adapter is testable without the
 * screen.
 */
fun inboxFileError(error: Throwable, json: Json): InboxFileError {
    if (error !is HttpException) return InboxFileError(InboxFileFailure.OTHER, null)
    val envelope: ApiErrorEnvelope? = runCatching {
        json.decodeFromString(
            ApiErrorEnvelope.serializer(),
            error.response()?.errorBody()?.string().orEmpty(),
        )
    }.getOrNull()
    return InboxFileError(
        failure = inboxFileFailure(error.code(), envelope?.error),
        serverMessage = envelope?.message,
    )
}

/**
 * The sentence for a filing failure, or `null` when the app has nothing better
 * to say than the server already did (see [InboxFileFailure.OTHER]).
 *
 * `DEVICE_FULL` names the device, the five-file limit and **both ways out**
 * ("pick another device, or delete the receipt"). That is the copy the contract
 * asks for; the server's own 409 `message` explains the conflict but not what to
 * do next, which is the part a user at a counter needs.
 */
fun inboxFileFailureMessage(
    s: AppStrings,
    failure: InboxFileFailure,
    deviceName: String,
): String? = when (failure) {
    InboxFileFailure.DEVICE_FULL -> s.quantity(
        R.plurals.inbox_device_full_body,
        // The count decides "file" vs "files"; today it is always the cap (5),
        // but the sentence must not assume that.
        MAX_ATTACHMENTS_PER_DEVICE,
        deviceName,
        MAX_ATTACHMENTS_PER_DEVICE,
    )
    InboxFileFailure.OTHER -> null
}

/**
 * "Uploaded 02/01/2025", or `null` when the server sent no usable timestamp —
 * a missing line is honest, and a fabricated date is not.
 *
 * Uses [vietnamDate], the app's one date convention (`dd/MM/yyyy`, date half
 * only). `uploadedAt` is RFC3339/naive-UTC on the wire; both parse the same way
 * because only the calendar date the server wrote is used.
 */
fun inboxUploadedLabel(s: AppStrings, uploadedAt: String?): String? =
    vietnamDate(uploadedAt)?.let { s.get(R.string.inbox_uploaded_at, it) }
