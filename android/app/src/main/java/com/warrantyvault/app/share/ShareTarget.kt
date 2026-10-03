package com.warrantyvault.app.share

/**
 * Share target (FEATURE_IDEAS #10): "Chia sẻ" a product page in Shopee / Lazada /
 * Chrome and pick WarrantyVault — the link lands in the wishlist create form
 * prefilled instead of the user copying it, opening the app, opening the
 * Wishlist tab and typing the name by hand.
 *
 * This file is **plain Kotlin**: no `android.*` type ever reaches it, so every
 * rule below is unit-tested as ordinary JVM code (no Robolectric). The Activity
 * does exactly three things around it:
 *
 *  1. flattens the `Intent` into a [Payload] (`ACTION_SEND` + `EXTRA_TEXT` /
 *     `EXTRA_SUBJECT`),
 *  2. asks [deliver] what to do,
 *  3. holds a [Delivery.Captured] in [ShareIntake] or shows the Vietnamese
 *     message of a [Delivery.Rejected] — a rejected share is never silent.
 *
 * **No page is fetched.** The link is stored as text; reading the product page
 * to get a price or a title was rejected for ToS/legal reasons
 * (`docs/FEATURE_IDEAS.md` §5), and this feature does not reopen that.
 */
object ShareTarget {

    /** `android.content.Intent.ACTION_SEND`, mirrored so this file stays pure. */
    const val ACTION_SEND = "android.intent.action.SEND"

    /** The only MIME type the manifest filter accepts. */
    const val MIME_TYPE = "text/plain"

    /**
     * The pieces of a share `Intent` this feature reads. `EXTRA_TEXT` is a
     * `CharSequence` on Android; the Activity flattens it to a String first, so
     * a `SpannableString` from some senders is handled the same way.
     */
    data class Payload(
        val action: String?,
        val type: String?,
        val text: String?,
        val subject: String?,
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

    sealed interface Delivery {
        /**
         * Nothing to do: not a share, or the very same `Intent` being
         * redelivered to a recreated activity (see [deliver]).
         */
        data object Ignored : Delivery

        /** A usable product link — hold it until a form can show it. */
        data class Captured(val product: Product) : Delivery

        /** The user shared something, but there is no link we can use. The
         * Activity shows [message] — this case must never look like success. */
        data class Rejected(val reason: Reason) : Delivery
    }

    enum class Reason { NO_LINK, UNSUPPORTED_SCHEME }

    const val MESSAGE_NO_LINK: String =
        "Không thấy link sản phẩm trong nội dung bạn chia sẻ. Mở tab Thèm và dán link vào ô “URL mua hàng” nhé."

    const val MESSAGE_UNSUPPORTED_SCHEME: String =
        "Chỉ nhận link http/https. Link bạn chia sẻ dùng giao thức khác nên không mở được."

    fun message(reason: Reason): String = when (reason) {
        Reason.NO_LINK -> MESSAGE_NO_LINK
        Reason.UNSUPPORTED_SCHEME -> MESSAGE_UNSUPPORTED_SCHEME
    }

    /**
     * The whole decision, in one pure function.
     *
     * [fromSavedState] is the duplicate-intent guard and the reason this
     * function exists at all: `onCreate` runs again after every configuration
     * change (rotate, dark-mode switch, split screen) and after a process-death
     * restore, and Android hands it the **same** `Intent` it was launched with.
     * Acting on that redelivery would reopen the form — throwing away whatever
     * the user had typed in it — so a recreated activity ignores its launch
     * intent outright. A genuine fresh launch passes `false`, and `onNewIntent`
     * (a share arriving while the app is already up) is always a real share and
     * also passes `false`: there is no saved state to confuse it with.
     *
     * The Activity calls this with `savedInstanceState != null`, which is the
     * only signal Android offers for "this is a recreation, not a new launch".
     */
    fun deliver(payload: Payload?, fromSavedState: Boolean): Delivery {
        if (fromSavedState) return Delivery.Ignored
        if (payload == null) return Delivery.Ignored
        if (payload.action != ACTION_SEND) return Delivery.Ignored
        if (payload.type?.substringBefore(';')?.trim()?.lowercase() != MIME_TYPE) {
            return Delivery.Ignored
        }

        val url = firstUrl(payload.text) ?: firstUrl(payload.subject)
        if (url != null) return Delivery.Captured(Product(url, title(payload.text, payload.subject)))

        val schemeElsewhere = hasForeignScheme(payload.text) || hasForeignScheme(payload.subject)
        return Delivery.Rejected(
            if (schemeElsewhere) Reason.UNSUPPORTED_SCHEME else Reason.NO_LINK,
        )
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
