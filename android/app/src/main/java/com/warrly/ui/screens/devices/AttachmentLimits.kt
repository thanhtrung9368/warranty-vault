package com.warrly.ui.screens.devices

/**
 * Per-file attachment cap, checked **before** the bytes are read and uploaded.
 *
 * Mirrors `MAX_ATTACHMENT_BYTES` in `api/internal/services/attachments.go`
 * (5 MB) and `AttachmentFileType.maxBytes` on iOS. Android used to upload the
 * whole file first and only then surface the server's 400 — on a phone that can
 * be minutes of cellular data spent just to be rejected. Reading the size off
 * the content provider first turns that into an instant local message.
 *
 * The limit is `5 * 1024 * 1024`, not `5_000_000`: that is the value the Go
 * service uses (`5 << 20`) and the one iOS uses, so the three clients agree on
 * the boundary byte.
 */
const val MAX_ATTACHMENT_BYTES: Long = 5L * 1024 * 1024

/**
 * Pure predicate so the boundary is pinned by a JVM test instead of by an
 * upload. Exactly [MAX_ATTACHMENT_BYTES] is allowed — the server's check is
 * `size > max`, and a file one byte over is refused.
 */
fun isAttachmentTooLarge(byteCount: Long): Boolean = byteCount > MAX_ATTACHMENT_BYTES
