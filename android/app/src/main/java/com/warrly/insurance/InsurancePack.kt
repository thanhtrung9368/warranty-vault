package com.warrly.insurance

import java.time.LocalDateTime
import java.time.format.DateTimeFormatter

/**
 * Pure rules for the insurance PDF pack — the part of the feature that can be
 * (and is) tested as ordinary JVM code.
 *
 * `GET /api/v1/insurance-pack` is rendered by the Go service, so there is no
 * client-side document builder here. What the client owns is the **request**: a
 * frozen optional `deviceIds` list and an optional `includeSold` flag, plus the
 * **name of the file** it writes before handing the document to an insurer.
 * Both are easy to get subtly wrong and impossible to check without a live API
 * and an emulator, so they live here rather than inline in the Settings screen.
 *
 * The PDF itself is ALWAYS Vietnamese — the Go renderer ignores
 * `Accept-Language`, because its reader is a Vietnamese insurer, not the person
 * holding the phone. That is why [insurancePackFileName] uses an ASCII
 * Vietnamese slug (safe through mail/cloud round-trips) even when the app is
 * showing English.
 */

/** MIME type of the pack. Frozen by the contract: `application/pdf`. */
const val INSURANCE_PACK_MIME: String = "application/pdf"

/**
 * Cache sub-directory the PDF is written to before sharing. It is declared as a
 * `cache-path` in `res/xml/file_paths.xml`, so the existing
 * `androidx.core.content.FileProvider` can hand out a URI for it.
 */
const val INSURANCE_PACK_CACHE_DIR: String = "insurance-pack"

/**
 * The two optional query parameters of `GET /api/v1/insurance-pack`, already in
 * the shape the Retrofit method wants:
 *
 *  * [deviceIds] is the comma-joined list, or `null` to omit the parameter
 *    (the contract's "all devices").
 *  * [includeSold] is `true` only when the user explicitly asks for sold
 *    devices. `false` becomes `null` so the request omits the parameter and
 *    stays identical to the server's default; it is never sent as
 *    `includeSold=false`.
 *
 * Both are nullable for exactly that reason: a null `@Query` is omitted by
 * Retrofit, while an empty string would send `?deviceIds=` and ask the server a
 * different question.
 */
data class InsurancePackRequest(
    val deviceIds: String?,
    val includeSold: Boolean?,
) {
    /**
     * The query string this request describes, e.g.
     * `?deviceIds=dev-1,dev-2&includeSold=true`, or `""` for the bare
     * `GET /api/v1/insurance-pack`.
     *
     * The ids are server-issued opaque keys (UUID-shaped today) and are NOT
     * percent-encoded here: Retrofit encodes the single `deviceIds` value when
     * it writes the URL, so an id containing a reserved character is escaped
     * there and encoding again would double-encode it. In particular Retrofit
     * writes the comma as `%2C`; Go's query parser decodes that back to `,`, so
     * the server still receives the contract's comma-separated list. This
     * method is therefore the readable representation used by tests and logs,
     * not a byte-for-byte URL dump.
     */
    fun toQueryString(): String {
        val parts = buildList {
            deviceIds?.let { add("deviceIds=$it") }
            includeSold?.let { add("includeSold=$it") }
        }
        return if (parts.isEmpty()) "" else parts.joinToString(separator = "&", prefix = "?")
    }
}

/**
 * Build the request for the Settings → Data action.
 *
 * [deviceIds] is `null` by default, which means **all devices** — the settings
 * screen has no per-device picker. A non-null list is trimmed, blank entries are
 * dropped, duplicates are removed while preserving order, and an empty result
 * falls back to "omit the parameter" rather than sending `deviceIds=`: the
 * contract has no way to express "an empty selection", so the only honest
 * request is the all-devices default.
 *
 * [includeSold] defaults to `false`, the contract's default. It is exposed as a
 * checkbox in the confirmation dialog so the parameter is not dead weight.
 */
fun insurancePackRequest(
    deviceIds: Collection<String>? = null,
    includeSold: Boolean = false,
): InsurancePackRequest {
    val joined = deviceIds
        ?.map { it.trim() }
        ?.filter { it.isNotEmpty() }
        ?.distinct()
        ?.joinToString(",")
        ?.takeIf { it.isNotEmpty() }

    return InsurancePackRequest(
        deviceIds = joined,
        includeSold = true.takeIf { includeSold },
    )
}

/**
 * File name of the downloaded pack, e.g.
 * `warrly-bang-ke-bao-hiem-20251019-0839.pdf`.
 *
 * ASCII-only on purpose: the document is Vietnamese, but the file name travels
 * through mail attachments, Zalo and cloud storage, and Vietnamese diacritics in
 * a file name get mangled by some of those round-trips. [now] is injectable so
 * the name is deterministic under test.
 */
fun insurancePackFileName(now: LocalDateTime = LocalDateTime.now()): String =
    "warrly-bang-ke-bao-hiem-${now.format(DateTimeFormatter.ofPattern("yyyyMMdd-HHmm"))}.pdf"
