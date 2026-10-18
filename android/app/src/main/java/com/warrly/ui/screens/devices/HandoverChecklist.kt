package com.warrly.ui.screens.devices

import androidx.annotation.StringRes
import com.warrly.R
import com.warrly.i18n.AppStrings
import com.warrly.network.Device
import com.warrly.ui.components.parseIsoDate
import com.warrly.ui.screens.vietnamDate
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

/**
 * "Chuẩn bị trước khi đi bảo hành" — the pre-service handover checklist on the
 * device detail screen.
 *
 * ## Why this exists
 *
 * Vietnamese retailers publish their intake rules, and the two that lose people a
 * trip are consistent across FPT Shop and CellphoneS: **a device that is still
 * locked is refused**, and **the shop may wipe data during service**. A user who
 * arrives with a PIN, no backup and no invoice does not get a repair — they get
 * sent home. The app already stores the serial, the warranty end date and the
 * accessories-adjacent facts; this list turns them into the sequence of things to
 * do before leaving the house.
 *
 * ## The content is the feature
 *
 * Every row is an action the user takes, and every row carries a `why` because a
 * generic "check your device" list is something people scroll past. The seven
 * rows the product spec names are here (accounts, screen lock, backup,
 * invoice + matching IMEI, condition photos, accessories, warranty end date), and
 * five more were added because the retailer rules imply them — the activation
 * lock (which survives signing out), the SIM card, recording the IMEI on the box,
 * the intake slip and the data-wipe conversation. The test `HandoverChecklistTest`
 * pins the order and the coverage so a later edit cannot quietly drop one.
 *
 * ## Per device, not generic
 *
 * Two rows carry a value read off *this* device: the saved IMEI/serial (to check
 * against the box) and the warranty end date (to know whether the repair should
 * be free). When the app does not have one, the row says so — it never prints a
 * placeholder or an invented date.
 *
 * ## Session-only, on purpose
 *
 * Ticks live in [HandoverChecklistSession], a process-scoped in-memory store, and
 * deliberately **not** in `SharedPreferences`, the API, or the backup: the list is
 * a one-trip errand, and persisting "packed the charger" across weeks would turn a
 * checklist into stale noise. The card says so in its own footer
 * (`handover_session_note`) so the behaviour is not a surprise.
 */
enum class HandoverChecklistKey(
    @StringRes val titleRes: Int,
    @StringRes val whyRes: Int,
) {
    // ---- at home, before leaving ----
    ACCOUNTS(R.string.handover_accounts_title, R.string.handover_accounts_why),
    ACTIVATION_LOCK(R.string.handover_activation_title, R.string.handover_activation_why),
    SCREEN_LOCK(R.string.handover_screen_lock_title, R.string.handover_screen_lock_why),
    BACKUP(R.string.handover_backup_title, R.string.handover_backup_why),

    /** Added: SIM/memory card are the user's data and many shops ask for them out. */
    SIM_AND_CARD(R.string.handover_sim_title, R.string.handover_sim_why),

    CONDITION_PHOTOS(R.string.handover_photos_title, R.string.handover_photos_why),

    /** Added: the number you need while the device is out of your hands. */
    RECORD_SERIAL(R.string.handover_serial_title, R.string.handover_serial_why),

    // ---- what to bring ----
    INVOICE_AND_BOX(R.string.handover_invoice_title, R.string.handover_invoice_why),
    ACCESSORIES(R.string.handover_accessories_title, R.string.handover_accessories_why),
    WARRANTY_END(R.string.handover_warranty_title, R.string.handover_warranty_why),

    // ---- at the counter ----
    /** Added: the only paper proving what condition the device was in. */
    INTAKE_SLIP(R.string.handover_slip_title, R.string.handover_slip_why),

    /** Added: the "may wipe data" rule, turned into an explicit question. */
    WIPE_CONSENT(R.string.handover_wipe_title, R.string.handover_wipe_why),
}

/**
 * One row. [note] is the per-device line (saved IMEI, warranty end date) and wins
 * over [whyRes] in the UI when present, so a row never shows two competing
 * supporting lines.
 */
data class HandoverChecklistItem(
    val key: HandoverChecklistKey,
    @StringRes val titleRes: Int,
    @StringRes val whyRes: Int,
    val note: String? = null,
)

/**
 * Builds this device's checklist. Pure on purpose: the content, the order and the
 * two device-derived lines are all assertable in a JVM test, and the detail screen
 * stays a renderer.
 */
fun handoverChecklist(s: AppStrings, device: Device): List<HandoverChecklistItem> =
    HandoverChecklistKey.entries.map { key ->
        HandoverChecklistItem(
            key = key,
            titleRes = key.titleRes,
            whyRes = key.whyRes,
            note = when (key) {
                HandoverChecklistKey.INVOICE_AND_BOX -> invoiceNote(s, device)
                HandoverChecklistKey.WARRANTY_END -> warrantyEndNote(s, device)
                else -> null
            },
        )
    }

/**
 * The saved serial/IMEI, or an honest "you have not recorded one" line.
 *
 * A missing serial is the normal state on a fresh device, and it is exactly the
 * value the box label has to match — so the row says that instead of skipping the
 * check silently.
 */
private fun invoiceNote(s: AppStrings, device: Device): String {
    val serial = device.serialNumber?.trim().orEmpty()
    return if (serial.isEmpty()) {
        s.get(R.string.handover_imei_missing)
    } else {
        s.get(R.string.handover_imei_note, serial)
    }
}

/** The warranty end date as `dd/MM/yyyy`, or the honest "not recorded" line. */
private fun warrantyEndNote(s: AppStrings, device: Device): String {
    val end = handoverWarrantyEnd(device)
    return if (end == null) {
        s.get(R.string.handover_warranty_end_missing)
    } else {
        s.get(R.string.handover_warranty_end_note, end)
    }
}

/**
 * The warranty end to show, `dd/MM/yyyy`, or `null`.
 *
 * Prefers the server's derived `effectiveWarrantyEnd` when the read carried it
 * (the list projection does). The detail read does not carry that field, but it
 * carries **every** warranty row, and `max(endDate)` is the server's own
 * definition of the value — so deriving it here can only reproduce the same date,
 * never invent one. A malformed date degrades to `null` (via [vietnamDate]) rather
 * than rendering half a string.
 */
fun handoverWarrantyEnd(device: Device): String? {
    vietnamDate(device.effectiveWarrantyEnd)?.let { return it }
    val latest = device.warranties
        .mapNotNull { parseIsoDate(it.endDate) }
        .maxOrNull()
    return latest?.let { vietnamDate(it.toString()) }
}

/**
 * How many rows are ticked. Counts only keys that are still in the list, so a
 * remembered tick left over from an older checklist shape can never make the
 * counter read `13/12`.
 */
fun handoverProgress(items: List<HandoverChecklistItem>, checkedKeys: Set<String>): Int =
    items.count { it.key.name in checkedKeys }

/**
 * In-memory tick state per device, for the life of the process.
 *
 * `MutableStateFlow` rather than Compose state so this class stays plain Kotlin
 * (no Compose runtime in its unit test) and the screen can `collectAsState()` it.
 * `update` is atomic, so two rows ticked in the same frame cannot lose one.
 *
 * There is deliberately no persistence: see the class-level note on
 * [HandoverChecklistKey].
 */
class HandoverChecklistStore {

    private val _checked = MutableStateFlow<Map<String, Set<String>>>(emptyMap())

    /** deviceId → ticked [HandoverChecklistKey.name]s. */
    val checked: StateFlow<Map<String, Set<String>>> = _checked.asStateFlow()

    fun checkedFor(deviceId: String): Set<String> = _checked.value[deviceId].orEmpty()

    /** Flips one row. Empty sets are dropped so the map does not grow forever. */
    fun toggle(deviceId: String, key: HandoverChecklistKey) {
        _checked.update { all ->
            val current = all[deviceId].orEmpty()
            val next = if (key.name in current) current - key.name else current + key.name
            if (next.isEmpty()) all - deviceId else all + (deviceId to next)
        }
    }

    /** "Bỏ đánh dấu tất cả" for one device; other devices are untouched. */
    fun reset(deviceId: String) {
        _checked.update { it - deviceId }
    }
}

/**
 * The app-wide instance. Process scope is the intended scope: the ticks survive
 * leaving the detail screen and coming back, and end when the app process does.
 */
object HandoverChecklistSession {
    val store: HandoverChecklistStore = HandoverChecklistStore()
}
