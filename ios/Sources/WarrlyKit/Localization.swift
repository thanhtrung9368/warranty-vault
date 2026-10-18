import Foundation

// MARK: - AppLanguage

/// The two languages the app speaks.
///
/// **Vietnamese is the SOURCE language** (docs/I18N_PLAN.md §2.4): every string
/// that used to be hard-coded in this app IS the Vietnamese original, and the
/// English column is the translation that was added on top. That is why the
/// catalog's `sourceLanguage` is `vi` and why the key of every entry is the
/// Vietnamese sentence itself — the same convention the Go catalog uses
/// (`api/internal/i18n/catalog.go`), so the two can be diffed side by side.
///
/// English is the language a NEW user gets when nothing else decides: it is the
/// product default (docs/I18N_PLAN.md §2.4), not the source text.
public enum AppLanguage: String, CaseIterable, Codable, Sendable, Identifiable {
    case vi
    case en

    public var id: String { rawValue }

    /// What a brand-new user gets when neither a stored preference nor the
    /// device's own language can decide.
    public static let productDefault: AppLanguage = .en

    /// The language the catalog is written in. Strings with no entry at all
    /// render as this text — never as an identifier.
    public static let source: AppLanguage = .vi

    /// Parses a BCP-47 tag leniently: `"vi"`, `"vi-VN"`, `"vi_VN"` and `"VI"` all
    /// resolve to `.vi`; anything unrecognised (e.g. `"fr"`) resolves to `nil`
    /// so the caller can fall through to the next rule in the chain.
    ///
    /// Mirrors the server's behaviour of accepting a region-tagged tag and
    /// storing only the two-letter code (`openapi.yaml`, `PATCH /auth/me`).
    public static func parse(_ raw: String?) -> AppLanguage? {
        guard let raw else { return nil }
        let base = raw
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .split(whereSeparator: { $0 == "-" || $0 == "_" })
            .first
            .map(String.init)?
            .lowercased()
        guard let base, !base.isEmpty else { return nil }
        return AppLanguage(rawValue: base)
    }

    /// Name of the language in that language. Deliberately NOT translated: an
    /// endonym is what a user who cannot read the current UI language needs to
    /// see (`Tiếng Việt` must not become `Vietnamese` just because the UI is in
    /// English — then a Vietnamese speaker could not find it).
    public var endonym: String {
        switch self {
        case .vi: return "Tiếng Việt"
        case .en: return "English"
        }
    }
}

// MARK: - L

/// String lookup for the whole app.
///
/// Named `L` rather than something longer because it appears at ~1000 call
/// sites and every one of them is a mechanical wrap of a literal that was
/// already there: `Text("Thiết bị")` → `Text(L.t("Thiết bị"))`. The short name
/// keeps that diff reviewable.
///
/// ## Runtime language
///
/// `L.language` is the single switch the whole app reads. It is `nil` until
/// something resolves a language, and `nil` means **the source language**
/// (Vietnamese) — exactly how `NSLocalizedString` behaves with no localization
/// selected. In the app that `nil` window is empty: `LocalizationStore`
/// resolves the language before the first frame (stored preference → device
/// language → English). In the library's own tests it is what keeps the
/// existing Vietnamese assertions meaningful without pinning anything.
///
/// ## Failure mode
///
/// A key with no catalog entry returns **the key**, i.e. the Vietnamese
/// sentence the app showed before this work. It never returns an identifier and
/// never returns an empty string — the same rule as the Go `i18n.Text`. A
/// translated-but-emptied entry falls back to the other language rather than to
/// `""`, so a half-filled catalog degrades to "this one string is not
/// translated" instead of a blank label.
public enum L {

    // MARK: Selection

    private static let lock = NSLock()
    nonisolated(unsafe) private static var _language: AppLanguage?

    /// The language every `L.t` / `L.p` call renders in.
    ///
    /// `nil` = nothing has chosen yet → `AppLanguage.source` (Vietnamese). The
    /// app sets this once at launch; tests set it to pin a language explicitly.
    public static var language: AppLanguage? {
        get {
            lock.lock(); defer { lock.unlock() }
            return _language
        }
        set {
            lock.lock(); _language = newValue; lock.unlock()
        }
    }

    /// The language actually used to render right now (`language ?? .source`).
    public static var effectiveLanguage: AppLanguage { language ?? AppLanguage.source }

    /// Runs `body` with `language` pinned, then restores the previous value.
    ///
    /// This is the "pin the language" primitive the tests use: a suite that
    /// asserts Vietnamese copy says so out loud instead of depending on the
    /// machine's locale (docs/I18N_PLAN.md §4 rule 3).
    @discardableResult
    public static func withLanguage<T>(_ language: AppLanguage?, _ body: () throws -> T) rethrows -> T {
        let previous = L.language
        L.language = language
        defer { L.language = previous }
        return try body()
    }

    // MARK: Lookup

    /// Renders `key` in the selected language, filling `args` into `%s` / `%d` /
    /// `%@` verbs with the standard library's `String(format:)`.
    ///
    /// Interpolation only runs when arguments were passed, so a literal `%` in
    /// static copy can never be misread as a verb.
    public static func t(_ key: String, _ args: CVarArg...) -> String {
        render(key: key, language: effectiveLanguage, args: args, count: nil)
    }

    /// Plural-aware lookup for copy that counts something.
    ///
    /// `count` does double duty: it selects the plural category for the current
    /// language AND is passed as the first format argument, so
    /// `L.p("Còn %d ngày", days)` renders `"Còn 3 ngày"` in Vietnamese and
    /// `"3 days left"` in English, and `"1 day left"` when `days == 1`.
    ///
    /// Vietnamese has a single plural category (`other`), which is why the
    /// Vietnamese side of a plural entry has exactly one case: the language
    /// does not inflect for number, and inventing a `one` case for it would be
    /// fabricating grammar (docs/I18N_PLAN.md §4 rule 6).
    public static func p(_ key: String, _ count: Int, _ args: CVarArg...) -> String {
        render(key: key, language: effectiveLanguage, args: [count] + args, count: count)
    }

    /// Whether the catalog knows `key` at all. Used by the parity tests and by
    /// callers that must decide which of two keys to render before rendering it
    /// (the server's `Lookup` exists for the same reason).
    public static func hasKey(_ key: String) -> Bool {
        StringCatalog.shared.entry(for: key) != nil
    }

    /// Every key in the catalog. Read by the parity test.
    public static var allKeys: [String] { StringCatalog.shared.allKeys }

    /// The raw catalog text for `key` in `language`, before interpolation —
    /// `nil` when the entry or that language is missing.
    public static func raw(_ key: String, in language: AppLanguage) -> CatalogValue? {
        StringCatalog.shared.entry(for: key)?.byLanguage[language]
    }

    // MARK: Rendering

    private static func render(
        key: String,
        language: AppLanguage,
        args: [CVarArg],
        count: Int?
    ) -> String {
        guard let entry = StringCatalog.shared.entry(for: key) else {
            // Unknown key: the source text IS the best answer we have.
            return interpolate(key, args)
        }

        var value = entry.value(for: language, count: count)
        if value == nil {
            // Requested language has no translation (yet) — serve the other one
            // rather than an empty label.
            let other: AppLanguage = language == .en ? .vi : .en
            value = entry.value(for: other, count: count)
        }
        guard let value, !value.isEmpty else { return interpolate(key, args) }
        return interpolate(value, args)
    }
    /// Fills `args` into a template. Sprintf runs only when arguments were
    /// passed, so a static message is returned verbatim, `%` and all.
    static func interpolate(_ template: String, _ args: [CVarArg]) -> String {
        guard !args.isEmpty else { return template }
        return String(format: template, arguments: args)
    }
}

// MARK: - CatalogValue

/// One language's value for one catalog key.
public enum CatalogValue: Equatable, Sendable {
    /// A plain string (`stringUnit` in the String Catalog).
    case text(String)
    /// Plural variations, keyed by CLDR category (`one`, `other`, …).
    case plural([String: String])

    /// The text for `count`, or the plain text when this value is not a plural.
    func resolved(count: Int?) -> String? {
        switch self {
        case let .text(text):
            return text
        case let .plural(cases):
            guard let count else { return cases["other"] }
            // English inflects; Vietnamese does not. A one-line `== 1` is the
            // whole rule on purpose — the Go catalog made the same trade rather
            // than pulling CLDR in for a single comparison (I18N_PLAN.md §3.1).
            let category = (count == 1) ? "one" : "other"
            return cases[category] ?? cases["other"]
        }
    }

    /// Plural case names present, for the parity test.
    var pluralCategories: Set<String> {
        switch self {
        case .text: return []
        case let .plural(cases): return Set(cases.keys)
        }
    }
}

// MARK: - CatalogEntry

/// One catalog key: the languages it has a value for.
struct CatalogEntry: Sendable {
    let byLanguage: [AppLanguage: CatalogValue]

    /// The text to render right now, or `nil` when this language has nothing
    /// (the caller then falls back to the other language, then to the key).
    func value(for language: AppLanguage, count: Int? = nil) -> String? {
        guard let value = byLanguage[language] else { return nil }
        guard let text = value.resolved(count: count), !text.isEmpty else { return nil }
        return text
    }
}

// MARK: - StringCatalog

/// The parsed `Localizable.xcstrings`.
///
/// The catalog stays a real **String Catalog** — the modern Xcode mechanism,
/// editable in Xcode's String Catalog editor, with plurals expressed the way
/// Xcode expresses them (`variations.plural.one` / `.other`). The app reads it
/// through this parser rather than through `NSLocalizedString` for one reason:
/// the language is a *runtime* choice persisted on the server, and
/// `NSLocalizedString` can only follow the bundle's `.lproj`, which would mean
/// an app restart on every switch. Reading the catalog directly keeps the
/// switcher instant and, more importantly, makes the tables inspectable by a
/// test — which is what the key-parity guarantee needs.
struct StringCatalog: Sendable {
    static let shared = StringCatalog()

    /// `key` → entry.
    private let entries: [String: CatalogEntry]

    var allKeys: [String] { Array(entries.keys) }

    func entry(for key: String) -> CatalogEntry? { entries[key] }

    /// Loads the bundled catalog. A missing or unreadable resource yields an
    /// empty catalog, which degrades to "every key renders as its Vietnamese
    /// source text" — the pre-i18n behaviour — rather than a crash.
    init() {
        self.init(data: Self.bundledData())
    }

    init(data: Data?) {
        guard let data,
              let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let strings = root["strings"] as? [String: Any]
        else {
            entries = [:]
            return
        }

        var parsed: [String: CatalogEntry] = [:]
        parsed.reserveCapacity(strings.count)
        for (key, rawEntry) in strings {
            guard let entry = rawEntry as? [String: Any],
                  let localizations = entry["localizations"] as? [String: Any]
            else { continue }
            var byLanguage: [AppLanguage: CatalogValue] = [:]
            for (code, rawLocalization) in localizations {
                guard let language = AppLanguage(rawValue: code),
                      let localization = rawLocalization as? [String: Any],
                      let value = Self.parseValue(localization)
                else { continue }
                byLanguage[language] = value
            }
            if !byLanguage.isEmpty { parsed[key] = CatalogEntry(byLanguage: byLanguage) }
        }
        entries = parsed
    }

    private static func parseValue(_ localization: [String: Any]) -> CatalogValue? {
        if let unit = localization["stringUnit"] as? [String: Any],
           let value = unit["value"] as? String {
            return .text(value)
        }
        if let variations = localization["variations"] as? [String: Any],
           let plural = variations["plural"] as? [String: Any] {
            var cases: [String: String] = [:]
            for (category, rawCase) in plural {
                guard let one = rawCase as? [String: Any],
                      let unit = one["stringUnit"] as? [String: Any],
                      let value = unit["value"] as? String
                else { continue }
                cases[category] = value
            }
            return cases.isEmpty ? nil : .plural(cases)
        }
        return nil
    }

    private static func bundledData() -> Data? {
        // SwiftPM puts package resources in `Bundle.module`. If the resource
        // declaration is missing next to this file the file is silently absent
        // from the bundle, which is why `LocalizationTests` asserts the catalog
        // is non-empty AND that a known key renders in English.
        #if SWIFT_PACKAGE
        guard let url = Bundle.module.url(forResource: "Localizable", withExtension: "xcstrings")
        else { return nil }
        return try? Data(contentsOf: url)
        #else
        return nil
        #endif
    }
}
