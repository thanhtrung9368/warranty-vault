package com.warrly.share

/**
 * A photo/PDF shared into Warrly, **already copied out of its content URI**.
 *
 * The copy is the whole point. A URI that arrives in `ACTION_SEND` is readable
 * under a transient grant tied to the receiving activity, and an upload that
 * starts later (after login, after the user confirms on the Inbox screen, after
 * a retry) may no longer be allowed to open it. `MainActivity` therefore reads
 * the bytes through the shared 5 MB-checked reader at intent time and parks
 * them here; everything downstream works on [bytes], never on the URI.
 *
 * This type is plain Kotlin on purpose: the mailbox that holds it
 * ([ShareIntake]) is unit-tested as ordinary JVM code.
 *
 * ### The cost, stated plainly
 *
 * The bytes live **in process memory** until the user saves or discards them.
 * If Android kills the process first, the share is gone — the URI grant is gone
 * with it, so this is not a trade the app can avoid by persisting a reference
 * instead. The file is at most 5 MB (the reader refuses anything larger) and
 * the mailbox holds at most one, which is why this is acceptable for a share
 * hand-off that is normally resolved in seconds.
 */
data class SharedFile(
    /** The provider-reported display name, or the reader's `file` fallback. */
    val fileName: String,
    /** The provider-reported concrete MIME type (what the multipart part sends). */
    val mimeType: String,
    /** The bytes, already checked against the 5 MB attachment cap. */
    val bytes: ByteArray,
) {
    val sizeBytes: Long get() = bytes.size.toLong()
}
