package com.warrly.share

/**
 * Share target: two destinations behind one `ACTION_SEND` intent filter.
 *
 *  1. **`text/plain` → Wishlist** (FEATURE_IDEAS #10). "Chia sẻ" a product page
 *     in Shopee / Lazada / Chrome, pick Warrly, and the link lands in the
 *     wishlist create form prefilled instead of being copied by hand.
 *  2. **image wildcard or `application/pdf` → Inbox** (capture-first receipts). The
 *     file arrives from Gmail / Gallery / Files and is copied out of its
 *     content URI while the intent is still live; the Inbox screen then offers
 *     to save it as a device-less attachment. See [FileShare] /
 *     [Delivery.CapturedFile].
 *
 * The two paths must stay disjoint: a link is never a receipt, and a receipt is
 * never a wishlist product. [deliver] decides purely on the MIME type, and the
 * `text/plain` branch below is the old one on purpose — it is a working feature
 * and widening the filter must not drag it into the file path.
 *
 * This file is **plain Kotlin**: no `android.*` type ever reaches it, so every
 * rule below is unit-tested as ordinary JVM code (no Robolectric). The Activity
 * does exactly three things around it:
 *
 *  1. flattens the `Intent` into a [Payload] (`ACTION_SEND` + `EXTRA_TEXT` /
 *     `EXTRA_SUBJECT` / `EXTRA_STREAM`),
 *  2. asks [deliver] what to do,
 *  3. holds a [Delivery.Captured] in [ShareIntake], reads the bytes of a
 *     [Delivery.CapturedFile] through the shared 5 MB reader, or shows the
 *     localized message of a [Delivery.Rejected] — a rejected share is never
 *     silent.
 *
 * **No page is fetched.** The link is stored as text; reading the product page
 * to get a price or a title was rejected for ToS/legal reasons
 * (`docs/FEATURE_IDEAS.md` §5), and this feature does not reopen that.
 */
object ShareTarget {

    /** `android.content.Intent.ACTION_SEND`, mirrored so this file stays pure. */
    const val ACTION_SEND = "android.intent.action.SEND"

    /**
     * `android.content.Intent.ACTION_SEND_MULTIPLE`.
     *
     * Declared for the duplicate-guard test, **not supported**: the manifest
     * advertises `ACTION_SEND` only, and [deliver] ignores this action. A
     * multi-select share is a different flow (N streams, N × 5 MB in memory)
     * and shipping the filter without that flow would be a promise the code
     * does not keep.
     */
    const val ACTION_SEND_MULTIPLE = "android.intent.action.SEND_MULTIPLE"

    /** The MIME type whose share goes to the wishlist form. */
    const val MIME_TYPE = "text/plain"

    /** `application/pdf`, the only non-image file this feature stores. */
    const val MIME_TYPE_PDF = "application/pdf"

    /** The manifest's wildcard for the image half of the filter. */
    const val MIME_TYPE_IMAGE_WILDCARD = "image/*"

    /**
     * The pieces of a share `Intent` this feature reads. `EXTRA_TEXT` is a
     * `CharSequence` on Android; the Activity flattens it to a String first, so
     * a `SpannableString` from some senders is handled the same way.
     *
     * [stream] is the `content://` URI from `EXTRA_STREAM` (or the single URI of
     * `ClipData`), flattened to a string so this file stays Android-free.
     * [streamCount] lets the rules tell "no attachment" from "several
     * attachments": this app supports exactly one.
     */
    data class Payload(
        val action: String?,
        val type: String?,
        val text: String?,
        val subject: String?,
        val stream: String? = null,
        val streamCount: Int = 0,
    )

    /**
     * A link captured from a share.
     *
     * [name] is **only ever text the sender actually wrote** next to the link
     * (or the share subject) — never a host name, never a guess. When the
     * sender wrote nothing but the link this is `null` and the form opens with
     * the name box empty, which is honest: the server requires a name, and the
     * user has to type a real one anyway.
     */
    data class Product(val buyUrl: String, val name: String?)

    /**
     * A file shared into Warrly, identified by the content URI it arrived as.
     *
     * Only the URI is captured here — the bytes are copied by the Activity in
     * `MainActivity.readSharedFile` **before** this leaves the share callback.
     * A content URI's read grant is tied to the receiving activity, so it is
     * not something a later screen or worker may legally read.
     */
    data class FileShare(val uri: String, val mimeType: String)

    sealed interface Delivery {
        /**
         * Nothing to do: not a supported share, or the very same `Intent` being
         * redelivered to a recreated activity (see [deliver]).
         */
        data object Ignored : Delivery

        /** A usable product link — hold it until a form can show it. */
        data class Captured(val product: Product) : Delivery

        /**
         * A photo or PDF to copy into the inbox flow. The URI is still live
         * when this is returned; the Activity reads it immediately.
         */
        data class CapturedFile(val file: FileShare) : Delivery

        /** The user shared something, but we cannot use it. The Activity shows
         * the localized message for [message] — never silence, never a
         * success-looking empty screen. */
        data class Rejected(val reason: Reason) : Delivery
    }

    enum class Reason {
        NO_LINK,
        UNSUPPORTED_SCHEME,
        UNSUPPORTED_FILE_TYPE,
        FILE_WITHOUT_STREAM,
        MULTIPLE_FILES,
    }

    const val MESSAGE_NO_LINK: String =
        "Không thấy link sản phẩm trong nội dung bạn chia sẻ. Mở tab Thèm và dán link vào ô “URL mua hàng” nhé."

    const val MESSAGE_UNSUPPORTED_SCHEME: String =
        "Chỉ nhận link http/https. Link bạn chia sẻ dùng giao thức khác nên không mở được."

    const val MESSAGE_UNSUPPORTED_FILE_TYPE: String =
        "Warrly chỉ nhận ảnh (JPG/PNG/WEBP/GIF/HEIC) hoặc tệp PDF khi chia sẻ. Tệp bạn chọn chưa được hỗ trợ nên chưa được thêm vào hộp thư."

    const val MESSAGE_FILE_WITHOUT_STREAM: String =
        "Không thấy tệp đính kèm trong nội dung bạn chia sẻ. Hãy chọn một ảnh hoặc tệp PDF rồi thử lại."

    const val MESSAGE_MULTIPLE_FILES: String =
        "Mỗi lần chỉ chia sẻ được một ảnh hoặc một tệp PDF. Chưa có tệp nào được thêm vào hộp thư."

    fun message(reason: Reason): String = when (reason) {
        Reason.NO_LINK -> MESSAGE_NO_LINK
        Reason.UNSUPPORTED_SCHEME -> MESSAGE_UNSUPPORTED_SCHEME
        Reason.UNSUPPORTED_FILE_TYPE -> MESSAGE_UNSUPPORTED_FILE_TYPE
        Reason.FILE_WITHOUT_STREAM -> MESSAGE_FILE_WITHOUT_STREAM
        Reason.MULTIPLE_FILES -> MESSAGE_MULTIPLE_FILES
    }

    /**
     * The whole decision, in one pure function.
     *
     * [fromSavedState] is the duplicate-intent guard and the reason this
     * function exists at all: `onCreate` runs again after every configuration
     * change (rotate, dark-mode switch, split screen) and after a process-death
     * restore, and Android hands it the **same** `Intent` it was launched with.
     * Acting on that redelivery would reopen the form — or re-read a content
     * URI whose grant may already be gone — throwing away whatever the user had
     * typed, so a recreated activity ignores its launch intent outright. A
     * genuine fresh launch passes `false`, and `onNewIntent` (a share arriving
     * while the app is already up) is always a real share and also passes
     * `false`: there is no saved state to confuse it with.
     *
     * The Activity calls this with `savedInstanceState != null`, which is the
     * only signal Android offers for "this is a recreation, not a new launch".
     */
    fun deliver(payload: Payload?, fromSavedState: Boolean): Delivery {
        if (fromSavedState) return Delivery.Ignored
        if (payload == null) return Delivery.Ignored
        if (payload.action != ACTION_SEND) return Delivery.Ignored

        val mime = baseMime(payload.type)

        // The old feature, untouched. A product link is still a product link
        // even if the sender also attached a stream: the MIME type is what
        // decides the destination, and changing that would move a working
        // wishlist share into the receipt flow.
        if (mime == MIME_TYPE) {
            val url = firstUrl(payload.text) ?: firstUrl(payload.subject)
            if (url != null) {
                return Delivery.Captured(Product(url, title(payload.text, payload.subject)))
            }

            val schemeElsewhere = hasForeignScheme(payload.text) || hasForeignScheme(payload.subject)
            return Delivery.Rejected(
                if (schemeElsewhere) Reason.UNSUPPORTED_SCHEME else Reason.NO_LINK,
            )
        }

        // A photo / PDF goes to the inbox flow. The URI is NOT read here — this
        // file is pure; the Activity owns the ContentResolver and copies the
        // bytes while the grant is live.
        if (mime != null && isShareableFileMime(mime)) {
            if (payload.streamCount > 1) return Delivery.Rejected(Reason.MULTIPLE_FILES)
            val uri = payload.stream?.trim()?.takeIf { it.isNotEmpty() }
                ?: return Delivery.Rejected(Reason.FILE_WITHOUT_STREAM)
            return Delivery.CapturedFile(FileShare(uri = uri, mimeType = mime))
        }

        // Anything else (a .docx, a video, `*/*`, a null/absent type) is
        // refused with a sentence. This is the safety net for senders that
        // bypass the OS chooser filter; the chooser itself never offers Warrly
        // for those types because the manifest lists them explicitly.
        return Delivery.Rejected(Reason.UNSUPPORTED_FILE_TYPE)
    }

    /**
     * The MIME type without its parameters, lowercased: `text/plain;charset=utf-8`
     * → `text/plain`. Returns `null` for a blank/absent type.
     */
    fun baseMime(type: String?): String? =
        type?.substringBefore(';')?.trim()?.lowercase()?.takeIf { it.isNotEmpty() }

    /**
     * `true` when [mime] is a share this feature can read a stream for.
     *
     * This is deliberately wider than the upload whitelist: the intent often
     * declares the image wildcard (a sender that does not know the exact
     * subtype), while the ContentResolver knows the concrete type. The
     * concrete type is checked again by [isStorableFileMime] after the bytes
     * are read, before anything is uploaded.
     */
    fun isShareableFileMime(mime: String?): Boolean =
        mime == MIME_TYPE_PDF || mime == MIME_TYPE_IMAGE_WILDCARD || mime?.startsWith("image/") == true

    /**
     * The concrete types the upload pipeline can store — a mirror of
     * `api/internal/files/mime.go`'s `AllowedMIMEs` (plus the HEIF aliases the
     * Go side normalises to HEIC).
     *
     * Checked against the **resolver-reported** type after the stream is read,
     * so a BMP/SVG/TIFF that the filter's image wildcard let in is refused on the
     * device with the same clear sentence instead of a round trip. The server
     * remains the authority; this only saves a doomed upload.
     */
    fun isStorableFileMime(mime: String?): Boolean = when (mime) {
        "image/jpeg", "image/png", "image/webp", "image/gif",
        "image/heic", "image/heif", "image/heic-sequence", "image/heif-sequence",
        MIME_TYPE_PDF,
        -> true
        else -> false
    }

    /** The first usable `http(s)` URL in [raw], or `null`. */
    fun firstUrl(raw: String?): String? {
        if (raw.isNullOrBlank()) return null
        return HTTP_URL.findAll(raw)
            .map { trimTrailingJunk(it.value) }
            .firstOrNull { it.substringAfter("://").trim('/').isNotEmpty() }
    }

    /**
     * The name hint: what the sender wrote **around** the link — the share text
     * with every URL cut out, whitespace collapsed, and the punctuation the cut
     * left behind trimmed off. Falls back to the share subject (the shape
     * Chrome/YouTube use: subject = page title, text = bare URL).
     */
    fun title(text: String?, subject: String?): String? = nameHint(text) ?: nameHint(subject)

    private fun nameHint(raw: String?): String? {
        if (raw.isNullOrBlank()) return null
        val withoutUrls = HTTP_URL.replace(raw, " ")
        val collapsed = withoutUrls.replace(WHITESPACE, " ").trim()
        val trimmed = trimEdges(collapsed)
        return trimmed.takeIf { it.isNotEmpty() }
    }

    /**
     * Peels the junk the URL cut left at both ends, alternating with whitespace
     * so "<https://…>" — junk, then the space the cut left, then junk again —
     * ends up empty instead of naming the product ">".
     */
    private fun trimEdges(raw: String): String {
        var current = raw
        while (true) {
            val next = current.trim(*NAME_EDGE_JUNK).trim()
            if (next == current) return current
            current = next
        }
    }

    private fun hasForeignScheme(raw: String?): Boolean =
        !raw.isNullOrBlank() && FOREIGN_SCHEME.containsMatchIn(raw)

    /**
     * An `http`/`https` web link. `[^\s<>"']` stops at whitespace and at the
     * angle brackets / quotes some senders wrap a link in, and it keeps the
     * query string intact — Shopee/Lazada append `?sp_atk=…&utm_source=share`
     * and truncating at `?` would hand the server a different link than the one
     * the user copied.
     */
    private val HTTP_URL = Regex("""(?i)https?://[^\s<>"']+""")

    /**
     * A URL-ish token with some *other* scheme — `ftp://…`, `intent://…`,
     * `mailto:…` — so "we saw a link, it just isn't a web link" can be told
     * apart from "there is no link here". Deliberately narrow: prose like
     * "Ghi chú:" must not read as a scheme, so a scheme without `//` only
     * counts when it is followed immediately by non-space content.
     */
    private val FOREIGN_SCHEME = Regex(
        """(?i)\b[a-z][a-z0-9+.\-]{1,31}://|""" +
            """\b(?:mailto|tel|sms|smsto|market|geo|intent|content|file|javascript|data):\S""",
    )

    private val WHITESPACE = Regex("""\s+""")

    /**
     * Punctuation a sentence leaves glued to a pasted link: "…/product/1.",
     * "…/product/1!", "…/product/1»". Brackets are peeled separately and only
     * when unbalanced, so a real `…/wiki/Phone_(model)` URL keeps its `)`.
     */
    private const val TRAILING_JUNK = ".,;:!?…\"'”’»«*"

    /** Junk left in the name once the URL is cut out: "Xem này — <url>" → "Xem này". */
    private val NAME_EDGE_JUNK = "-–—:|,;.•·»«()[]<>\"'…".toCharArray()

    private fun trimTrailingJunk(raw: String): String {
        var url = raw.trim()
        while (url.isNotEmpty()) {
            val last = url.last()
            url = when {
                last in TRAILING_JUNK -> url.dropLast(1)
                last == ')' && url.count { it == '(' } < url.count { it == ')' } -> url.dropLast(1)
                last == ']' && url.count { it == '[' } < url.count { it == ']' } -> url.dropLast(1)
                last == '}' && url.count { it == '{' } < url.count { it == '}' } -> url.dropLast(1)
                else -> return url
            }
        }
        return url
    }
}
