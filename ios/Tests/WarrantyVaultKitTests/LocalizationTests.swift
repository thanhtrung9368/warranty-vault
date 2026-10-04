import Foundation
import XCTest
@testable import WarrantyVaultKit

// The guarantees this file exists to make, in order of how badly they fail:
//
//  1. **Every key the Swift sources ask for has BOTH languages.** A key that is
//     missing from the catalog renders its Vietnamese source text in an English
//     UI; a key with only one language silently falls back to the other. Both
//     are "the string was not translated" — the exact failure this whole
//     exercise exists to prevent — and neither shows up as a crash, a warning or
//     a failed build. So it is pinned here, by scanning the sources.
//  2. The catalog actually ships. A resource that is not declared in
//     `Package.swift` is silently absent from `Bundle.module`, which leaves
//     every lookup falling back to Vietnamese with no error anywhere.
//  3. Plurals are real plurals. `3 ngày` / `1 ngày` must become `3 days` /
//     `1 day`, not `1 days`.
//
// Language is always pinned explicitly (`L.withLanguage`), never inherited from
// the machine: docs/I18N_PLAN.md §4 rule 3.

final class LocalizationTests: XCTestCase {

    // MARK: - Language resolution

    func testParseAcceptsRegionTagsAndRejectsUnknownLanguages() {
        XCTAssertEqual(AppLanguage.parse("vi"), .vi)
        XCTAssertEqual(AppLanguage.parse("vi-VN"), .vi)
        XCTAssertEqual(AppLanguage.parse("vi_VN"), .vi)
        XCTAssertEqual(AppLanguage.parse("EN"), .en)
        XCTAssertEqual(AppLanguage.parse("en-US"), .en)
        XCTAssertEqual(AppLanguage.parse("  en  "), .en)
        // Unsupported tags fall through to the next rule in the chain rather
        // than erroring — the server takes the same line with Accept-Language.
        XCTAssertNil(AppLanguage.parse("fr"))
        XCTAssertNil(AppLanguage.parse(""))
        XCTAssertNil(AppLanguage.parse(nil))
    }

    func testNoSelectionRendersTheSourceLanguage() {
        // `nil` means "nothing has chosen yet", and the answer is the SOURCE
        // text (Vietnamese) — never an identifier, never a blank label.
        L.withLanguage(nil) {
            XCTAssertNil(L.language)
            XCTAssertEqual(L.effectiveLanguage, .vi)
        }
    }

    func testWithLanguageRestoresThePreviousSelection() {
        L.language = .en
        defer { L.language = nil }

        L.withLanguage(.vi) { XCTAssertEqual(L.language, .vi) }
        XCTAssertEqual(L.language, .en)
    }

    // MARK: - Catalog shipping

    func testCatalogIsBundledAndNonEmpty() throws {
        // Catches the classic SwiftPM failure: a resource that is not declared
        // under `resources:` in Package.swift is not copied into Bundle.module,
        // so the catalog parses to zero entries and every string silently falls
        // back to Vietnamese.
        XCTAssertFalse(L.allKeys.isEmpty, "Localizable.xcstrings is not in Bundle.module")
        XCTAssertGreaterThan(L.allKeys.count, 5)
    }

    func testKnownKeysRenderInBothLanguages() {
        L.withLanguage(.en) {
            XCTAssertEqual(L.t("Ngôn ngữ"), "Language")
        }
        L.withLanguage(.vi) {
            XCTAssertEqual(L.t("Ngôn ngữ"), "Ngôn ngữ")
        }
    }

    func testUnknownKeyFallsBackToTheKeyItself() {
        // A wrong key degrades to the sentence the app showed before i18n —
        // never to "" and never to an identifier.
        let unknown = "Khoá này không tồn tại trong catalog"
        L.withLanguage(.en) { XCTAssertEqual(L.t(unknown), unknown) }
        L.withLanguage(.vi) { XCTAssertEqual(L.t(unknown), unknown) }
    }

    func testInterpolationOnlyRunsWhenArgumentsArePassed() {
        // A literal `%` in static copy must not be read as a verb.
        let key = "Giảm 50% khi mua kèm"
        L.withLanguage(nil) { XCTAssertEqual(L.t(key), key) }
    }

    // MARK: - Key parity (the headline guarantee)

    func testEveryEntryCarriesBothLanguages() {
        var missing: [String] = []
        for key in L.allKeys {
            for language in AppLanguage.allCases {
                guard let value = L.raw(key, in: language) else {
                    missing.append("\(language.rawValue): \(key)")
                    continue
                }
                let texts: [String]
                switch value {
                case let .text(text): texts = [text]
                case let .plural(cases): texts = Array(cases.values)
                }
                if texts.contains(where: { $0.trimmingCharacters(in: .whitespaces).isEmpty }) {
                    missing.append("\(language.rawValue) (empty): \(key)")
                }
            }
        }
        XCTAssertEqual(missing, [], "catalog entries missing a language")
    }

    func testEveryEntryHasItsVietnameseSourceTextAsTheKey() {
        // The key IS the source sentence (the same design the Go catalog uses),
        // so `L.raw(key, in: .vi)` must return the key itself for plain entries.
        // Plural entries are the exception: the count is a verb there.
        var mismatched: [String] = []
        for key in L.allKeys {
            guard case let .text(vi)? = L.raw(key, in: .vi) else { continue }
            if vi != key { mismatched.append("\(key) → \(vi)") }
        }
        XCTAssertEqual(mismatched, [], "Vietnamese text drifted from its key")
    }

    func testFormatVerbsMatchAcrossLanguages() {
        // `%d` in English and `%@` in Vietnamese is a runtime
        // `%!d(string=...)` in the user's face, and nothing else catches it.
        var mismatched: [String] = []
        for key in L.allKeys {
            guard let vi = L.raw(key, in: .vi), let en = L.raw(key, in: .en) else { continue }
            guard case let .text(viText) = vi else { continue }
            let enTexts: [String]
            switch en {
            case let .text(text): enTexts = [text]
            case let .plural(cases): enTexts = Array(cases.values)
            }
            for enText in enTexts where verbs(viText) != verbs(enText) {
                mismatched.append("\(key): \(verbs(viText)) vs \(enText) → \(verbs(enText))")
            }
        }
        XCTAssertEqual(mismatched, [], "format verbs differ between languages")
    }

    func testPluralEntriesCoverBothCategoriesInEnglish() {
        // English inflects, so a plural entry must supply `one` AND `other`.
        // A missing `one` is the `1 days` bug.
        var incomplete: [String] = []
        for key in L.allKeys {
            guard case let .plural(cases)? = L.raw(key, in: .en) else { continue }
            if cases["one"] == nil || cases["other"] == nil {
                incomplete.append("\(key): \(cases.keys.sorted())")
            }
        }
        XCTAssertEqual(incomplete, [], "English plural entries missing one/other")
    }

    func testEveryLiteralKeyUsedInTheSourcesIsInTheCatalog() throws {
        // The strongest of these checks, and the one that catches the failure
        // mode nobody sees: a call site whose key was never added. The string
        // then renders as its Vietnamese source in the English UI — visible only
        // to a user, never to a compiler.
        //
        // The scan is deliberately static (a regex over the checked-in sources,
        // the same technique `api/internal/services/category_seed_test.go` uses
        // to keep the three clients' label sets honest) — it must not depend on
        // the app being built.
        let root = URL(fileURLWithPath: #filePath)          // ios/Tests/WarrantyVaultKitTests/
            .deletingLastPathComponent()                     // ios/Tests/
            .deletingLastPathComponent()                     // ios/
            .deletingLastPathComponent()                     // ios/Tests/WarrantyVaultKitTests → ios/
        var problems: [String] = []
        var scanned = 0

        for directory in ["Sources", "App"] {
            let base = root.appendingPathComponent(directory)
            guard let enumerator = FileManager.default.enumerator(
                at: base, includingPropertiesForKeys: nil
            ) else { continue }
            for case let url as URL in enumerator {
                guard url.pathExtension == "swift" else { continue }
                let source = try String(contentsOf: url, encoding: .utf8)
                let relative = url.path.replacingOccurrences(of: root.path + "/", with: "")
                for (lineNumber, line) in source.split(separator: "\n", omittingEmptySubsequences: false).enumerated() {
                    let trimmed = line.trimmingCharacters(in: .whitespaces)
                    if trimmed.hasPrefix("//") { continue }
                    for call in Self.callSites(in: String(line)) {
                        scanned += 1
                        let where_ = "\(relative):\(lineNumber + 1)"
                        if call.hasInterpolation {
                            problems.append("\(where_) interpolated key \(call.key.debugDescription) — pass the value as an argument instead")
                            continue
                        }
                        guard let en = L.raw(call.key, in: .en) else {
                            problems.append("\(where_) no catalog entry for \(call.key.debugDescription)")
                            continue
                        }
                        switch (call.isPlural, en) {
                        case (true, .text):
                            problems.append("\(where_) L.p(\(call.key.debugDescription)) but English has no plural forms")
                        case (false, .plural):
                            problems.append("\(where_) L.t(\(call.key.debugDescription)) but English has plural forms — use L.p")
                        default:
                            break
                        }
                    }
                }
            }
        }

        XCTAssertGreaterThan(scanned, 0, "the source scan found no L.t/L.p call sites at all")
        XCTAssertEqual(problems, [], "call sites whose key is missing from the catalog")
    }

    // MARK: - Dynamic keys

    func testCategoryLabelsFollowTheSelectedLanguage() {
        // `CategoryLabels.label(for:)` is the one place that looks a key up with
        // a value rather than a literal: the Vietnamese label from the static
        // table (which the Go test `category_seed_test.go` parses, so its shape
        // is frozen) is passed straight to `L.t`. That indirection is invisible
        // to the source scan above, so it gets its own test — otherwise the
        // table could stay Vietnamese in an English UI with nothing failing.
        L.withLanguage(.vi) {
            XCTAssertEqual(CategoryLabels.label(for: "PHONE"), "Điện thoại")
            XCTAssertEqual(CategoryLabels.label(for: "phONE"), "Điện thoại")
            XCTAssertEqual(CategoryLabels.label(for: nil), "Khác")
            XCTAssertEqual(CategoryLabels.label(for: "NOT_A_CATEGORY"), "NOT_A_CATEGORY")
        }
        L.withLanguage(.en) {
            XCTAssertEqual(CategoryLabels.label(for: "PHONE"), "Phone")
            XCTAssertEqual(CategoryLabels.label(for: "WASHING"), "Washer / Dryer")
            XCTAssertEqual(CategoryLabels.label(for: nil), "Other")
            // An unknown code is not a key — it renders as itself, in either
            // language, so a newly seeded category never disappears.
            XCTAssertEqual(CategoryLabels.label(for: "NOT_A_CATEGORY"), "NOT_A_CATEGORY")
        }
    }

    // MARK: - Plurals

    func testPluralPicksTheEnglishCategoryFromTheCount() {
        L.withLanguage(.en) {
            XCTAssertEqual(L.p("%d ngày", 1), "1 day")
            XCTAssertEqual(L.p("%d ngày", 3), "3 days")
            XCTAssertEqual(L.p("%d ngày", 0), "0 days")
        }
        // Vietnamese does not inflect: one entry, used for every count.
        L.withLanguage(.vi) {
            XCTAssertEqual(L.p("%d ngày", 1), "1 ngày")
            XCTAssertEqual(L.p("%d ngày", 3), "3 ngày")
        }
    }

    func testPluralForwardsExtraArgumentsAfterTheCount() {
        L.withLanguage(.en) {
            XCTAssertEqual(L.p("%d/%d thiết bị", 2, 5), "2 of 5 devices")
        }
    }

    // MARK: - Helpers

    struct CallSite {
        let key: String
        let isPlural: Bool
        /// `L.t("Còn \(days) ngày")` — the catalog would be keyed on the
        /// TEMPLATE while the runtime looks up the rendered string, so the
        /// lookup always misses and English silently never appears. Interpolation
        /// belongs in the arguments, not in the key.
        var hasInterpolation: Bool = false
    }

    /// Finds `L.t("…")` / `L.p("…")` with a literal first argument.
    static func callSites(in line: String) -> [CallSite] {
        var found: [CallSite] = []
        let chars = Array(line)
        var index = 0
        while index < chars.count {
            defer { index += 1 }
            guard chars[index] == "L", index + 2 < chars.count,
                  chars[index + 1] == ".", chars[index + 2] == "t" || chars[index + 2] == "p"
            else { continue }
            let isPlural = chars[index + 2] == "p"
            var cursor = index + 3
            while cursor < chars.count, chars[cursor] == " " { cursor += 1 }
            guard cursor < chars.count, chars[cursor] == "(" else { continue }
            cursor += 1
            while cursor < chars.count, chars[cursor] == " " { cursor += 1 }
            guard cursor < chars.count, chars[cursor] == "\"" else { continue }
            var key = ""
            var interpolated = false
            cursor += 1
            while cursor < chars.count, chars[cursor] != "\"" {
                if chars[cursor] == "\\", cursor + 1 < chars.count {
                    // Undo the Swift escapes so the scanned key matches the one
                    // the compiler and the JSON catalog both see.
                    let next = chars[cursor + 1]
                    switch next {
                    case "(": interpolated = true; key.append("\\(")
                    case "n": key.append("\n")
                    case "t": key.append("\t")
                    case "\"": key.append("\"")
                    case "\\": key.append("\\")
                    default: key.append("\\"); key.append(next)
                    }
                    cursor += 2
                    continue
                }
                key.append(chars[cursor]); cursor += 1
            }
            found.append(CallSite(key: key, isPlural: isPlural, hasInterpolation: interpolated))
            index = cursor
        }
        return found
    }

    /// Sprintf conversion letters in a template, so `%d` vs `%s` drift between
    /// the two languages is caught here instead of in a user's face.
    static func verbs(_ text: String) -> [String] {
        var out: [String] = []
        let chars = Array(text)
        var index = 0
        while index < chars.count {
            defer { index += 1 }
            guard chars[index] == "%" else { continue }
            index += 1
            guard index < chars.count else { break }
            if chars[index] == "%" { continue }          // escaped percent
            if chars[index] == "@" { out.append("%@"); continue }
            if chars[index] == "d" || chars[index] == "i" { out.append("%d"); continue }
            if chars[index] == "s" { out.append("%s"); continue }
            // Skip a length/flag modifier and take the conversion letter.
            while index < chars.count, !"@dsifguxXeEo".contains(chars[index]) { index += 1 }
            if index < chars.count { out.append("%\(chars[index])") }
        }
        return out
    }

    func verbs(_ text: String) -> [String] { Self.verbs(text) }
}
