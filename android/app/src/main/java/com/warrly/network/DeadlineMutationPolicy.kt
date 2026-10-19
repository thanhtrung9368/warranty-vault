package com.warrly.network

/**
 * Which successful writes can change what the home-screen widget shows.
 *
 * The widget's snapshot is refreshed after a mutation, not on every request:
 * `GET` is the read path, and a write that cannot move a warranty end date
 * (uploading a receipt, creating a share link, snoozing an action item, …) would
 * only cause a pointless second round trip. Keeping the rule here, as a pure
 * function of method + path, makes it testable without OkHttp, and keeps the
 * interceptor itself to five lines.
 *
 * ## Why path shapes rather than the API's operation ids
 *
 * Retrofit hides the resolved URL from callers, but OkHttp sees it. These are
 * the only endpoint families that can add, edit or remove a `Device` /
 * `Warranty` / reminder that `GET /api/v1/reminders` projects:
 *
 *  * `/api/v1/devices[/{id}]` — create, edit (including warranty fields),
 *    delete, and `POST /devices/bulk`;
 *  * `/api/v1/devices/{id}/warranties` — add a plan;
 *  * `/api/v1/warranties/{id}` — edit/delete a plan;
 *  * `/api/v1/warranties/{id}/reminder` — dismiss/restore, which changes
 *    whether the row appears in the default (non-dismissed) feed at all;
 *  * `/api/v1/backup/import` — import can create devices and plans in bulk;
 *  * `PATCH /api/v1/wishlist/{id}` — marking a wishlist item PURCHASED creates
 *    a Device in the same transaction (see `services/wishlist.go`).
 *
 * Deliberately **not** included: attachments, share links, service-directory
 * reads, subscriptions, wishlist price logs, and auth. None of them can change a
 * warranty end date, and each would otherwise cost a network call the widget
 * cannot use yet.
 *
 * The `GET` guard is first and absolute: reads never invalidate the cache they
 * populate, including the widget's own `GET /api/v1/reminders` refresh.
 */
fun affectsDeadlineSnapshot(method: String, path: String): Boolean {
    if (method.uppercase() !in WRITE_METHODS) return false
    val normalized = path.trimEnd('/')
    return DEVICE_COLLECTION.matches(normalized) ||
        DEVICE_ITEM.matches(normalized) ||
        DEVICE_BULK.matches(normalized) ||
        DEVICE_WARRANTIES.matches(normalized) ||
        WARRANTY_ITEM.matches(normalized) ||
        WARRANTY_REMINDER.matches(normalized) ||
        BACKUP_IMPORT.matches(normalized) ||
        WISHLIST_ITEM.matches(normalized)
}

private val WRITE_METHODS = setOf("POST", "PUT", "PATCH", "DELETE")

private val DEVICE_COLLECTION = Regex("^/api/v1/devices$")
private val DEVICE_ITEM = Regex("^/api/v1/devices/[^/]+$")
private val DEVICE_BULK = Regex("^/api/v1/devices/bulk$")
private val DEVICE_WARRANTIES = Regex("^/api/v1/devices/[^/]+/warranties$")
private val WARRANTY_ITEM = Regex("^/api/v1/warranties/[^/]+$")
private val WARRANTY_REMINDER = Regex("^/api/v1/warranties/[^/]+/reminder$")
private val BACKUP_IMPORT = Regex("^/api/v1/backup/import$")
private val WISHLIST_ITEM = Regex("^/api/v1/wishlist/[^/]+$")
