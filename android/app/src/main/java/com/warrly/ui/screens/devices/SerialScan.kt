package com.warrly.ui.screens.devices

import java.util.Locale

/**
 * The pure half of the serial / IMEI scanner behind the device form
 * (`AddDeviceSheet` → `SerialScannerDialog`).
 *
 * ## The problem this feature exists for
 *
 * The serial is the first thing a service centre asks for and the key every
 * brand lookup uses, and it is exactly the value users mistype: the printed
 * label mixes `0`/`O`, `1`/`I`, `5`/`S`, and nobody photographs the box before
 * they need it. OCR of a **receipt** does not help here (the serial is on the
 * box or under the device, not on the invoice), which is why this is a camera
 * scan rather than an extension of the receipt flow.
 *
 * ## Why the parsing lives here and not in the dialog
 *
 * The camera cannot run in a JVM unit test, but everything between "the camera
 * handed me bytes/text" and "the user has a value to tap" is ordinary string
 * work, and it is where the mistakes are: a barcode value can carry a control
 * character or an AIM symbology prefix, an IMEI can arrive with spaces, and OCR
 * returns every word on the box. So the dialog owns only the camera and ML Kit;
 * [SerialScan] owns normalisation, IMEI validation, ranking and de-duplication,
 * and `SerialScanTest` pins all of it.
 *
 * ## Nothing here saves anything
 *
 * A candidate is a **draft**: the dialog hands the chosen string to the form's
 * `serialNumber` state, the user can edit it, and `POST/PATCH /devices` happens
 * only when they tap Save. That is also why the ranking below is a *suggestion*
 * order, never a filter — a value that ranks badly is still offered, because the
 * app cannot know a serial's shape and the user can.
 */
object SerialScan {

    /**
     * How many candidates the scanner keeps at once. A box label can carry an
     * EAN-13, a Code128 IMEI and a DataMatrix S/N; six is enough to cover that
     * plus OCR noise without turning the bottom sheet into a scroll of noise.
     */
    const val MAX_CANDIDATES = 6

    // ---- barcode values --------------------------------------------------

    /**
     * Cleans one barcode `rawValue` into something a human would type.
     *
     * ML Kit returns the decoded string verbatim, which means it can contain:
     *
     *  * an **AIM symbology identifier** (`]C1` in front of a Code128 payload,
     *    `]Q1` for QR) — scanner-wire metadata, never part of the serial;
     *  * control characters — FNC1/GS is `0x1D` on GS1 Code128, and some
     *    encoders emit a trailing `\r`;
     *  * zero-width characters and non-breaking spaces (a label printed from a
     *    web tool), and newlines inside a QR payload.
     *
     * All of those are stripped/collapsed, and a value that is really an IMEI
     * separated by spaces or dashes (`490 154 203 237 518`) is compacted to the
     * 15 digits **only when the Luhn check digit agrees** — that is the one case
     * where rewriting the value is right rather than a guess.
     *
     * Returns `null` for a value that is empty after cleaning: a blank scanner
     * result must not become a blank candidate row.
     */
    fun normalizeBarcodeValue(raw: String?): String? {
        if (raw == null) return null
        var value = raw
        // ]C1 / ]Q1 / ]d2 … — "] + letter + digit" is an AIM symbology identifier.
        if (value.length >= 3 && value[0] == ']' && value[1].isLetter() && value[2].isDigit()) {
            value = value.substring(3)
        }
        val cleaned = StringBuilder(value.length)
        for (ch in value) {
            when {
                // FNC1/GS, CR, LF and friends are separators, not content.
                ch.code < 0x20 || ch.code == 0x7F -> cleaned.append(' ')
                ch == '\u00A0' -> cleaned.append(' ')
                ch == '\u200B' || ch == '\uFEFF' -> Unit
                else -> cleaned.append(ch)
            }
        }
        val collapsed = cleaned.toString().trim().replace(WHITESPACE, " ")
        if (collapsed.isEmpty()) return null
        val digits = digitsOf(collapsed)
        if (digits.length == 15 &&
            collapsed.all { it.isDigit() || it == ' ' || it == '-' } &&
            luhnValid(digits)
        ) {
            return digits
        }
        return collapsed
    }

    /**
     * Ranks and de-duplicates one camera frame's barcode values.
     *
     * Ordering is by [barcodeScore] and is stable within a score, so the value
     * the user is most likely to want (a checksum-valid IMEI) is the first row.
     * De-duplication is case-insensitive: two scans of the same label differing
     * only in case are one candidate, not two.
     */
    fun barcodeCandidates(values: List<String>): List<String> {
        val best = LinkedHashMap<String, Scored>()
        for (raw in values) {
            val value = normalizeBarcodeValue(raw) ?: continue
            val key = value.uppercase(Locale.ROOT)
            val score = barcodeScore(value)
            val previous = best[key]
            if (previous == null || score < previous.score) best[key] = Scored(value, score)
        }
        return best.values.sortedBy { it.score }.map { it.value }.take(MAX_CANDIDATES)
    }

    /**
     * Lower is better. `http(s)://…` is a QR that happens to be in front of the
     * camera (a product page, an e-label) and goes last; a 13-digit EAN is a
     * product code, not this device's serial, but it is still offered because a
     * box's only code sometimes is that one.
     */
    private fun barcodeScore(value: String): Int = when {
        imeiOf(value) != null -> 0
        looksLikeImei(value) -> 1
        value.startsWith("http://", ignoreCase = true) ||
            value.startsWith("https://", ignoreCase = true) -> 9
        value.length >= 6 && value.any { it.isDigit() } && value.any { it.isLetter() } -> 2
        value.length >= 6 -> 3
        else -> 4
    }

    // ---- printed text (OCR) ---------------------------------------------

    /**
     * Pulls serial-like values out of ML Kit's text-recognition output.
     *
     * This exists because the serial is frequently **printed** rather than
     * encoded: laptop boxes carry `S/N: …` in text, and a phone's IMEI is under
     * the battery or in Settings. The OCR block is the whole label, so the job is
     * to keep the candidates and drop the prose:
     *
     *  1. anything after an `IMEI` / `IMEI1` / `IMEI2` / `IMEISV` label;
     *  2. anything after an `S/N`, `SN`, `Serial`, `Serial No`, `Serial #` label;
     *  3. a bare 14–17 digit number on a line (an IMEI whose label OCR lost);
     *  4. a bare alphanumeric token that mixes letters and digits (`SM-G991B`,
     *     `PF2ABCDE`) — model/serial shaped, offered but ranked last.
     *
     * Pure-digit tokens outside 14–17 digits, price-looking numbers and plain
     * words are dropped: they are dates, prices, voltages or the brand name, and
     * offering them would train the user to ignore the list. The result is
     * capped at [MAX_CANDIDATES] and ordered by score.
     */
    fun textCandidates(text: String?): List<String> {
        if (text.isNullOrBlank()) return emptyList()
        val best = LinkedHashMap<String, Scored>()

        fun add(value: String?, score: Int, requireDigit: Boolean = true) {
            val clean = value?.trim()?.trim('-', '/', '.', '"', '\'') ?: return
            if (clean.length < 4) return
            // An unlabelled word is prose; a *labelled* S/N with no digits is
            // still a serial the user asked us to read, so it is allowed through.
            if (requireDigit && clean.none { it.isDigit() }) return
            val key = clean.uppercase(Locale.ROOT)
            val previous = best[key]
            if (previous == null || score < previous.score) best[key] = Scored(clean, score)
        }

        for (rawLine in text.lines()) {
            val line = normalizeBarcodeValue(rawLine) ?: continue
            for (match in IMEI_LABEL.findAll(line)) {
                val digits = digitsOf(match.groupValues[1])
                if (digits.length in 14..17) {
                    add(digits, if (digits.length == 15 && luhnValid(digits)) 0 else 1)
                }
            }
            for (match in SERIAL_LABEL.findAll(line)) {
                add(match.groupValues[1], 2, requireDigit = false)
            }
            for (token in line.split(TOKEN_SPLIT)) {
                val clean = token.trim('-', '/', '.', '"', '\'', ':', '#')
                if (clean.length < 4) continue
                // The label itself is not a serial: "IMEI1" mixes letters and a
                // digit and would otherwise be offered as a candidate.
                if (LABEL_WORDS.matches(clean)) continue
                when {
                    clean.all { it.isDigit() } && clean.length in 14..17 -> add(clean, 3)
                    // A pure-digit token that is not IMEI-shaped is a price, a
                    // date or a model year. Never a serial.
                    clean.all { it.isDigit() } -> Unit
                    clean.any { it.isDigit() } && clean.any { it.isLetter() } &&
                        clean.length in 5..24 -> add(clean, 4)
                }
            }
        }
        return best.values.sortedBy { it.score }.map { it.value }.take(MAX_CANDIDATES)
    }

    // ---- the list the user sees -----------------------------------------

    /**
     * Appends a new frame's candidates to the ones already on screen.
     *
     * Deliberately **append-only**: the camera produces a result several times a
     * second, and re-ranking the whole list on every frame would move the row the
     * user is about to tap. New values join in rank order, duplicates (ignoring
     * case) are dropped, and the list stops growing at [limit].
     */
    fun mergeCandidates(
        existing: List<String>,
        incoming: List<String>,
        limit: Int = MAX_CANDIDATES,
    ): List<String> {
        if (limit <= 0) return emptyList()
        val out = existing.take(limit).toMutableList()
        val seen = out.mapTo(mutableSetOf()) { it.uppercase(Locale.ROOT) }
        for (value in incoming) {
            if (out.size >= limit) break
            val key = value.uppercase(Locale.ROOT)
            if (key in seen) continue
            out += value
            seen += key
        }
        return out
    }

    // ---- IMEI ------------------------------------------------------------

    /**
     * The 15 digits of a well-formed IMEI, or `null`.
     *
     * The input must be *only* digits, spaces and dashes: `"IMEI 490154203237518"`
     * is a labelled OCR line handled by [textCandidates], not an IMEI value, and
     * silently pulling the digits out of arbitrary text is how a random number on
     * the box becomes a device's serial.
     *
     * The check digit is the point: IMEI uses Luhn, the server already warns on
     * `IMEI_CHECKSUM` (see `DeviceWarning`), and a scan that fails it is far more
     * likely to be a misread than a device with a broken IMEI — so the value is
     * still offered (as an IMEI-*shaped* candidate), just not ranked first.
     */
    fun imeiOf(raw: String?): String? {
        val trimmed = raw?.trim() ?: return null
        if (trimmed.isEmpty()) return null
        if (trimmed.any { !(it.isDigit() || it == ' ' || it == '-') }) return null
        val digits = digitsOf(trimmed)
        if (digits.length != 15) return null
        return digits.takeIf { luhnValid(it) }
    }

    /** 15 digits once spaces/dashes are removed — checksum ignored. */
    fun looksLikeImei(raw: String?): Boolean {
        val trimmed = raw?.trim() ?: return false
        if (trimmed.isEmpty()) return false
        if (trimmed.any { !(it.isDigit() || it == ' ' || it == '-') }) return false
        return digitsOf(trimmed).length == 15
    }

    /**
     * The Luhn check digit, standard form (doubling every second digit from the
     * right, with 9's complement above 9). `490154203237518` is the canonical
     * valid IMEI test vector; `490154203237519` differs only in the check digit.
     */
    fun luhnValid(digits: String): Boolean {
        if (digits.length < 2) return false
        if (digits.any { !it.isDigit() }) return false
        var sum = 0
        var double = false
        for (i in digits.lastIndex downTo 0) {
            var value = digits[i] - '0'
            if (double) {
                value *= 2
                if (value > 9) value -= 9
            }
            sum += value
            double = !double
        }
        return sum % 10 == 0
    }

    private fun digitsOf(raw: String): String = raw.filter { it.isDigit() }

    private data class Scored(val value: String, val score: Int)

    private val WHITESPACE = Regex("""\s+""")

    /**
     * `IMEI`, `IMEI1`, `IMEI2`, `IMEISV`, then up to 8 non-digits (a colon, a
     * dash, spaces), then 13–25 digits/spaces/dashes ending in a digit. The
     * trailing `[0-9]` is what stops the match one character early when a label
     * is directly followed by the next word.
     */
    private val IMEI_LABEL = Regex(
        """(?i)\bIMEI(?:\s?(?:1|2|SV))?\b[^0-9]{0,8}([0-9][0-9\s\-]{12,24}[0-9])""",
    )

    /**
     * `S/N`, `SN`, `Serial`, `Serial No`, `Serial Number`, `Serial #`, `SER.` —
     * the forms actually printed on a warranty label — then a token that starts
     * and ends alphanumeric (so trailing punctuation is not swallowed).
     */
    private val SERIAL_LABEL = Regex(
        """(?i)\b(?:S/?N|SN|SER(?:IAL)?(?:\s*(?:NO|NUMBER|#))?)\b\s*[:#.\-]?\s*([A-Z0-9][A-Z0-9\-/]{3,24}[A-Z0-9])""",
    )

    /**
     * Word separators on a printed label: whitespace, the punctuation between a
     * label and its value, and the brackets a box label uses for grouping. A
     * single regex rather than a char array keeps `split` unambiguous.
     */
    private val TOKEN_SPLIT = Regex("""[\s:;#,.()\[\]{}"'|=*]+""")

    /**
     * The label words the two regexes above consume. A bare token that is one of
     * these is the label, not a value — without this `IMEI1` (letters *and* a
     * digit) would be offered as a serial-shaped candidate.
     */
    private val LABEL_WORDS = Regex(
        """(?i)^(?:IMEI(?:\s?(?:1|2|SV))?|S/?N|SN|SER|SERIAL|MODEL|SVC)$""",
    )
}

/**
 * Why the camera permission was refused, as far as the app can tell.
 *
 * `ASK_AGAIN` covers the ordinary "not now" denial: the OS will still show the
 * request dialog, so the UI offers a retry. `BLOCKED` is the "don't ask again"
 * case (and Android 11+'s second denial): the OS will never show the dialog
 * again, and a retry button would be a dead end — the only route back is the
 * app's settings screen.
 */
enum class CameraPermissionProblem { ASK_AGAIN, BLOCKED }

/**
 * Maps the result of a runtime request to what the UI should offer.
 *
 * `canAskAgain` is `ActivityCompat.shouldShowRequestPermissionRationale` read
 * **after** the denial — it is also `false` *before* the first request, which is
 * why this must never be consulted until the OS has answered once.
 */
fun cameraPermissionProblem(granted: Boolean, canAskAgain: Boolean): CameraPermissionProblem? =
    when {
        granted -> null
        canAskAgain -> CameraPermissionProblem.ASK_AGAIN
        else -> CameraPermissionProblem.BLOCKED
    }
