package com.warrly.ui.screens.devices

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The attachment size gate in front of the upload.
 *
 * Android used to send the whole file and let Go reject it (`services/attachments.go`
 * → 400 "File vượt quá 5MB."). This pins the local rule that mirrors it, because
 * the boundary is the kind of thing that silently drifts: an off-by-one or a
 * `5_000_000` would let a file through that the server then refuses, which is
 * exactly the wasted upload the check exists to prevent.
 */
class AttachmentLimitsTest {

    @Test
    fun limitIsTheServersFiveMebibytes() {
        // `api/internal/services/attachments.go`: MAX_ATTACHMENT_BYTES = 5 << 20.
        assertEquals(5L * 1024 * 1024, MAX_ATTACHMENT_BYTES)
        assertEquals(5_242_880L, MAX_ATTACHMENT_BYTES)
    }

    @Test
    fun exactlyTheLimitIsAllowed() {
        assertFalse(isAttachmentTooLarge(MAX_ATTACHMENT_BYTES))
        assertFalse(isAttachmentTooLarge(0))
        assertFalse(isAttachmentTooLarge(1))
    }

    @Test
    fun oneByteOverTheLimitIsRefused() {
        assertTrue(isAttachmentTooLarge(MAX_ATTACHMENT_BYTES + 1))
        assertTrue(isAttachmentTooLarge(50L * 1024 * 1024))
    }
}
