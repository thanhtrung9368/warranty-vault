import Foundation

// MARK: - Insurance PDF pack (`GET /api/v1/insurance-pack`)
//
// Frozen contract:
//
//   GET /api/v1/insurance-pack[?deviceIds=<id>,<id>][&includeSold=true]
//   authenticated, `Content-Type: application/pdf`
//
// The PDF is **always Vietnamese**. That is a property of the artifact, not a
// missing translation: the reader is a Vietnamese insurer / loss adjuster, and
// they did not choose a language in this app. The surrounding UI still follows
// the user's language setting, and `InsurancePackSheet` says the PDF is
// Vietnamese on purpose so it does not read as a bug.
//
// Everything here is pure — no networking, no UI — so the query and the
// share-sheet filename are testable without a simulator or a running server.
// `APIClient.insurancePack(deviceIds:includeSold:)` uses `path` + `queryItems`,
// then the app writes the bytes to a temp file and hands it to the system share
// sheet.
public enum InsurancePackRules {

    /// The route, relative to `APIClient.baseURL` (which already ends in `/api`).
    public static let path = "/api/v1/insurance-pack"

    /// What the server promises. Sent as `Accept` so this is a binary fetch,
    /// not a JSON one.
    public static let contentType = "application/pdf"

    // MARK: - Query

    /// The contract treats `deviceIds` as a set: trim each id, drop blanks and
    /// keep the **first** occurrence of each value. Order is preserved so the
    /// request is deterministic and diffable in tests.
    public static func normalizedDeviceIds(_ ids: [String]) -> [String] {
        var seen = Set<String>()
        var out: [String] = []
        for raw in ids {
            let id = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !id.isEmpty, seen.insert(id).inserted else { continue }
            out.append(id)
        }
        return out
    }

    /// The optional query string of `GET /api/v1/insurance-pack`.
    ///
    /// * `deviceIds` is **omitted** when empty because the server reads that as
    ///   "every device", not "no devices". Never send a bare `deviceIds=`.
    /// * `includeSold` is sent only when `true`: `false` is the server default,
    ///   so an absent parameter keeps the request identical to the pre-flag
    ///   contract.
    ///
    /// IDs are joined with commas as the contract's `<id>,<id>` example shows;
    /// `URLComponents` percent-encodes anything else that needs it.
    public static func queryItems(
        deviceIds: [String] = [],
        includeSold: Bool = false
    ) -> [URLQueryItem] {
        var items: [URLQueryItem] = []
        let ids = normalizedDeviceIds(deviceIds)
        if !ids.isEmpty {
            items.append(URLQueryItem(name: "deviceIds", value: ids.joined(separator: ",")))
        }
        if includeSold {
            items.append(URLQueryItem(name: "includeSold", value: "true"))
        }
        return items
    }

    // MARK: - Filename

    /// The filename shown by the share sheet and used by the receiving app:
    /// `warrly-insurance-pack-20260301-1430.pdf`.
    ///
    /// ASCII only, and built from an explicit Gregorian calendar so a device set
    /// to a non-Gregorian calendar still produces a normal year. The wall-clock
    /// time is the caller's time zone, matching the website's date-fns fallback;
    /// tests pin the zone so the result never depends on the machine.
    ///
    /// The app cannot read the server's `Content-Disposition` (the binary helper
    /// exposes bytes, not headers), so this is the name the recipient sees.
    public static func filename(
        on date: Date = Date(),
        timeZone: TimeZone = .current
    ) -> String {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        let parts = calendar.dateComponents(
            [.year, .month, .day, .hour, .minute],
            from: date
        )
        return String(
            format: "warrly-insurance-pack-%04d%02d%02d-%02d%02d.pdf",
            parts.year ?? 0,
            parts.month ?? 0,
            parts.day ?? 0,
            parts.hour ?? 0,
            parts.minute ?? 0
        )
    }

    // MARK: - Response validation

    /// `true` when the bytes start with the PDF magic header `%PDF-`.
    ///
    /// `rawDataRequest` does not expose the response headers, so this is the
    /// client-side guard against a `200` carrying an HTML error page or an empty
    /// body. `InsurancePackSheet` turns `false` into a visible error instead of
    /// sharing a file named `.pdf` that no insurer can open.
    public static func hasPDFHeader(_ data: Data) -> Bool {
        let magic: [UInt8] = [0x25, 0x50, 0x44, 0x46, 0x2D] // "%PDF-"
        guard data.count >= magic.count else { return false }
        return Array(data.prefix(magic.count)) == magic
    }
}
