package com.warrantyvault.app.ui.screens.devices

import com.warrantyvault.app.network.Device
import com.warrantyvault.app.ui.screens.vietnamDate

/**
 * Exchange / return window ("1 đổi 1") — openapi `Device.returnWindowDays` /
 * `Device.receivedAt` / `Device.returnDeadline` (migration 0010).
 *
 * ## Why this file exists at all
 *
 * `PATCH /api/v1/devices/{id}` **replaces the whole device**. A client that sends
 * the editable fields and nothing else does not "leave the window alone" — it
 * **erases** it, exactly the way a half-filled payload used to wipe
 * `soldAt`/`soldPrice`. The device form therefore loads whatever is stored and
 * sends it straight back, and these helpers are the pure, testable form of that
 * round trip:
 *
 * ```
 * Device.returnWindowDays ──returnWindowDaysInput──▶ form string
 *                        ◀──returnWindowDaysRequest── (never touched by the UI)
 * ```
 *
 * There is deliberately **no input, picker or setting** for the window in this
 * pass: migration 0010 ships to three clients at once, and only together may any
 * of them expose a UI that *sets* one. Until then the job here is narrower and
 * absolute — an edit made on Android must not silently destroy a window recorded
 * on the web or on iOS.
 *
 * ## The three states, which are not two
 *
 *  * `null` = **chưa biết** — the API has no default and never infers one;
 *  * `0` = a real value: "cửa hàng không cho đổi trả";
 *  * `> 0` = that many days from `receivedAt` (or `purchaseDate` when that is
 *    unrecorded).
 *
 * So `0` must survive the round trip as `0` and never collapse into "absent" —
 * the same distinction `soldPrice`'s `0đ` give-away relies on.
 *
 * ## Wire format
 *
 * `receivedAt` comes back in the exact shape of `purchaseDate`/`soldAt`: a
 * **naive UTC** timestamp (`"2026-03-02T00:00:00"`, no `Z`, no offset). Only the
 * date half is ever used (`take(10)`), and the request sends that date back —
 * `DeviceInput.receivedAt` accepts `YYYY-MM-DD`. Sending the date half is not a
 * lossy edit: the field is a calendar date, and the server stores midnight of it.
 */

/**
 * Wire → form (`30` → `"30"`, `null` → `""`).
 *
 * `0` becomes `"0"`, not `""`: "cửa hàng không cho đổi trả" is a recorded answer
 * and must be sent back as one.
 */
internal fun returnWindowDaysInput(wire: Int?): String = wire?.toString().orEmpty()

/**
 * Form → request. A blank string is `null` ("chưa biết", key dropped from the
 * JSON, which Go decodes as nil exactly like an explicit null); `"0"` is `0`.
 * A non-numeric value degrades to `null` rather than throwing.
 */
internal fun returnWindowDaysRequest(raw: String): Int? =
    raw.trim().ifBlank { null }?.toIntOrNull()

/**
 * Wire → form. `"2026-03-02T00:00:00"` → `"2026-03-02"`; missing/blank → `""`.
 *
 * Never parsed as an instant: this is a naive UTC wall clock, so an
 * offset-aware parse would move the calendar day by the device's UTC offset
 * (23:30Z → the 3rd in Vietnam).
 */
internal fun receivedAtInput(wire: String?): String = wire?.trim()?.take(10).orEmpty()

/** Form → request. Blank means "chưa ghi" and drops the key. */
internal fun receivedAtRequest(raw: String): String? = raw.trim().ifBlank { null }

/**
 * The server-computed deadline as `dd/mm/yyyy`, or `null` when there is nothing
 * to show. Read-only by design — the client never derives this date itself, it
 * only formats what `DeviceListItem.returnDeadline` / `DeviceDetail.returnDeadline`
 * already decided.
 *
 * Delegates to [com.warrantyvault.app.ui.screens.vietnamDate]; the name is kept
 * because it is what the detail card and its tests call.
 */
internal fun returnDeadlineLabel(wire: String?): String? = vietnamDate(wire)

/**
 * `true` when a window length was ever recorded, including the meaningful `0`.
 * Used only to decide whether the read-only row is worth showing.
 */
internal fun hasReturnWindow(days: Int?): Boolean = days != null

/**
 * The `returnDeadline` to keep after a successful write.
 *
 * A POST/PATCH answers with a bare device row, so a **write response never
 * carries the derived deadline** — it is not a column. The temptation is to carry
 * the previous value over unconditionally (the way `effectiveWarrantyEnd` is
 * carried). That would be wrong here: the deadline is
 * `COALESCE(receivedAt, purchaseDate) + returnWindowDays` and an edit can change
 * `purchaseDate` or the window itself, so an unconditional carry-over can leave a
 * date on screen that the stored data no longer supports — precisely the kind of
 * quiet lie this feature exists to prevent.
 *
 * So the previous value is kept only while its inputs are **demonstrably
 * unchanged**: all three inputs travel in the write response, so if they are
 * identical the derived date cannot have moved. Otherwise the deadline is dropped
 * and reappears on the next read (`GET /devices/{id}`), which costs a pull to
 * refresh and never shows a number the server would not compute.
 *
 * A deadline that the response DOES carry always wins: a field present in the
 * payload is the server's own answer, not something to second-guess.
 */
internal fun keptReturnDeadline(previous: Device, written: Device): String? {
    written.returnDeadline?.let { return it }
    val days = written.returnWindowDays
    if (days == null || days <= 0) return null
    if (days != previous.returnWindowDays) return null
    if (written.receivedAt != previous.receivedAt) return null
    if (written.purchaseDate != previous.purchaseDate) return null
    return previous.returnDeadline
}
