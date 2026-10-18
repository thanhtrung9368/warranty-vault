import Foundation

// MARK: - Serial / IMEI scan text
//
// A camera scan never returns "just the serial". DataScanner hands back either a
// barcode payload (usually clean) or a whole line of recognised text — and the
// line on a box usually reads `IMEI: 356789012345678`, `S/N: ABC-123` or
// `Serial No. ABC 123`. Pasting that whole line into `Device.serialNumber` would
// store the label, which is exactly what the service centre would then read back
// from the app.
//
// This helper is deliberately conservative and pure, so it is testable without a
// camera:
//
//   1. trim whitespace, zero-width characters and wrapping quotes;
//   2. drop ONE leading label (`IMEI`, `S/N`, `Serial No.`, `Số sê-ri`, …) when
//      it is followed by a separator — never when the serial itself begins with
//      those letters (`SNABC123` must survive untouched);
//   3. drop trailing punctuation;
//   4. compact an all-digit value (with spaces or dashes) into one run, because
//      OCR routinely reads a 15-digit IMEI as `356 789 012 345 678`.
//
// It does not guess, upcase, validate a Luhn checksum or enforce a length. The
// scanner puts the result into an editable field and the user confirms it; a
// helper that silently "fixed" a serial would be worse than one that leaves the
// draft exactly as read.

public enum SerialScanText {

    /// Labels that appear in front of a serial on a box or a receipt.
    ///
    /// Sorted by length descending at use time, so `IMEI 1` is tested before
    /// `IMEI` — otherwise `IMEI 1: 356…` would strip only `IMEI` and keep `1:`.
    private static let labels: [String] = [
        "serial number", "serial no.", "serial no", "serial",
        "s/n", "sn",
        "imei 2", "imei2", "imei 1", "imei1", "imei",
        "số sê-ri", "số serial", "sê-ri",
    ]

    /// Strips camera/OCR decoration from `raw` and returns a draft serial, or
    /// `nil` when nothing usable is left.
    ///
    /// `nil` is not "the serial is invalid" — it means there is no draft at all
    /// (a blank line, punctuation only). The scan UI falls back to the raw line so
    /// the user can correct it; this helper never puts a value into the form.
    public static func normalize(_ raw: String) -> String? {
        var value = raw
            .replacingOccurrences(of: "\u{00A0}", with: " ")   // non-breaking space
            .replacingOccurrences(of: "\u{200B}", with: "")    // zero-width space
            .replacingOccurrences(of: "\u{FEFF}", with: "")    // BOM
            .trimmingCharacters(in: .whitespacesAndNewlines)

        value = strippingWrappingQuotes(value)
        guard let labeled = strippingLeadingLabel(value) else { return nil }
        value = labeled
        // Quotes and sentence punctuation nest (`“ABC”.`), so strip until the
        // value stops changing rather than assuming one pass is enough.
        for _ in 0 ..< 3 {
            let before = value
            value = strippingWrappingQuotes(value)
            value = strippingTrailingPunctuation(value)
            if value == before { break }
        }
        value = compactingDigits(value)
        value = value.split(whereSeparator: { $0.isWhitespace })
            .joined(separator: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines)

        guard !value.isEmpty,
              value.rangeOfCharacter(from: .alphanumerics) != nil else {
            return nil
        }
        return value
    }

    // MARK: - Pieces

    /// Removes matching wrapping quotes/backticks. Only the pair is removed: a
    /// quote in the middle of a serial is data, not decoration.
    private static func strippingWrappingQuotes(_ value: String) -> String {
        let pairs: [(Character, Character)] = [
            ("\"", "\""), ("'", "'"), ("`", "`"),
            ("“", "”"), ("‘", "’"), ("«", "»"),
        ]
        guard value.count >= 2, let first = value.first, let last = value.last else {
            return value
        }
        for (open, close) in pairs where first == open && last == close {
            return String(value.dropFirst().dropLast())
                .trimmingCharacters(in: .whitespacesAndNewlines)
        }
        return value
    }

    /// Drops a single leading label when it is separated from the value by
    /// whitespace or punctuation. `SNABC123` keeps its letters.
    ///
    /// `nil` means "a label was found but no value followed it" (`IMEI:`);
    /// returning the label itself would offer a non-serial as a draft.
    private static func strippingLeadingLabel(_ value: String) -> String? {
        for label in labels.sorted(by: { $0.count > $1.count }) {
            guard let range = value.range(of: label,
                                          options: [.caseInsensitive, .anchored]) else {
                continue
            }
            var rest = value[range.upperBound...]
            let hadWhitespace = rest.first?.isWhitespace == true
            rest = rest.drop(while: { $0.isWhitespace })

            if rest.isEmpty {
                // A label on its own (`S/N`) is not a serial.
                return nil
            }

            if let separator = rest.first, ":：#-.=·".contains(separator) {
                rest = rest.dropFirst().drop(while: { $0.isWhitespace })
            } else if !hadWhitespace {
                // `SNABC123`: the label is just the start of the serial.
                continue
            }

            let stripped = String(rest).trimmingCharacters(in: .whitespacesAndNewlines)
            return stripped.isEmpty ? nil : stripped
        }
        return value
    }

    /// Trailing sentence punctuation is OCR noise; a hyphen is not.
    private static func strippingTrailingPunctuation(_ value: String) -> String {
        var out = value
        let trailing: Set<Character> = [".", ",", ";", ":", "!", "?", "·"]
        while let last = out.last, trailing.contains(last) {
            out.removeLast()
        }
        return out
    }

    /// `356 789 012 345 678` → `356789012345678`. Only when the value contains
    /// nothing but digits/whitespace/dashes; an alphanumeric serial keeps its
    /// separators because they may be significant.
    private static func compactingDigits(_ value: String) -> String {
        let candidates = value.filter { !$0.isWhitespace && $0 != "-" }
        guard !candidates.isEmpty,
              candidates.allSatisfy({ $0.isNumber }) else {
            return value
        }
        return String(candidates)
    }
}
