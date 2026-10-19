package com.warrly.network

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The widget's refresh trigger, pinned without OkHttp or Android.
 *
 * `DeadlineMutationInterceptor` is five lines around this predicate; the useful
 * part to test is exactly which writes count. Both directions matter:
 *
 *  * a missed write means the home screen keeps showing a warranty the user
 *    just deleted — the failure the feature exists to prevent;
 *  * an over-broad match means every attachment upload or share-link creation
 *    costs a pointless authenticated `GET /api/v1/reminders`.
 */
class DeadlineMutationPolicyTest {

    @Test
    fun readsNeverInvalidateTheSnapshotTheyPopulate() {
        listOf(
            "/api/v1/devices",
            "/api/v1/devices/dev-1",
            "/api/v1/reminders",
            "/api/v1/warranties/w-1",
            "/api/v1/backup/import",
        ).forEach { path ->
            assertFalse("GET $path must not trigger a refresh", affectsDeadlineSnapshot("GET", path))
            assertFalse("HEAD $path must not trigger a refresh", affectsDeadlineSnapshot("HEAD", path))
        }
    }

    @Test
    fun deviceWritesInvalidate() {
        assertTrue(affectsDeadlineSnapshot("POST", "/api/v1/devices"))
        assertTrue(affectsDeadlineSnapshot("PATCH", "/api/v1/devices/dev-1"))
        assertTrue(affectsDeadlineSnapshot("DELETE", "/api/v1/devices/dev-1"))
        assertTrue(affectsDeadlineSnapshot("POST", "/api/v1/devices/bulk"))
        // A trailing slash is what a hand-built URL might carry.
        assertTrue(affectsDeadlineSnapshot("PATCH", "/api/v1/devices/dev-1/"))
    }

    @Test
    fun warrantyWritesInvalidate() {
        assertTrue(affectsDeadlineSnapshot("POST", "/api/v1/devices/dev-1/warranties"))
        assertTrue(affectsDeadlineSnapshot("PATCH", "/api/v1/warranties/w-1"))
        assertTrue(affectsDeadlineSnapshot("DELETE", "/api/v1/warranties/w-1"))
        assertTrue(affectsDeadlineSnapshot("POST", "/api/v1/warranties/w-1/reminder"))
        assertTrue(affectsDeadlineSnapshot("DELETE", "/api/v1/warranties/w-1/reminder"))
    }

    @Test
    fun backupImportAndWishlistPurchaseInvalidate() {
        assertTrue(affectsDeadlineSnapshot("POST", "/api/v1/backup/import"))
        assertTrue(affectsDeadlineSnapshot("PATCH", "/api/v1/wishlist/item-1"))
    }

    @Test
    fun irrelevantWritesDoNotInvalidate() {
        listOf(
            "POST" to "/api/v1/devices/dev-1/attachments",
            "DELETE" to "/api/v1/attachments/att-1",
            "POST" to "/api/v1/devices/dev-1/shares",
            "DELETE" to "/api/v1/shares/share-1",
            "POST" to "/api/v1/subscriptions",
            "PATCH" to "/api/v1/subscriptions/sub-1",
            "POST" to "/api/v1/push/register",
            "POST" to "/api/v1/actions/some:key/snooze",
            "PATCH" to "/api/v1/auth/me",
            "POST" to "/api/v1/ai/extract-receipt",
            "POST" to "/api/v1/wishlist/item-1/price",
        ).forEach { (method, path) ->
            assertFalse("$method $path cannot move a warranty end date", affectsDeadlineSnapshot(method, path))
        }
    }

    @Test
    fun methodMatchingIsCaseInsensitive() {
        assertTrue(affectsDeadlineSnapshot("patch", "/api/v1/devices/dev-1"))
        assertFalse(affectsDeadlineSnapshot("get", "/api/v1/devices"))
    }
}
