import Foundation

// MARK: - Reminder lead times (`leadDays`)
//
// A device and a subscription each carry **their own** reminder schedule: the
// number of days before expiry (warranty end / renewal date) that a push should
// fire. The old fixed 7-and-30-day cron is gone; a 14-day exchange window, a
// 3-month accessory warranty and a 10-year appliance no longer share a schedule.
//
// The frozen server contract:
//
//  * `leadDays` is an array of integers on **both** Device and Subscription,
//    accepted on create and update and returned on every read;
//  * **1…5** entries, each **0…365**, no duplicates;
//  * the server sorts descending and defaults to `[30, 7]` when the key is
//    absent on create;
//  * an **empty array is a 400** (`fieldErrors.leadDays`) — a user who wants
//    fewer reminders picks fewer days, but zero is not a schedule;
//  * on update, an absent/`null` value leaves the stored schedule unchanged.
//
// Everything here is pure: no networking, no `Date`, no UI. That is deliberate
// — the clamp/dedupe/sort/cap pipeline is the part that must not differ between
// the two forms, the detail screens and the tests, and it must be verifiable
// without a simulator (`LeadDaysRulesTests`).
//
// ## Why an empty selection stays empty
//
// `normalize([])` returns `[]`, not the default `[30, 7]`. The picker has to be
// able to *show* "chưa chọn mốc nào" and disable Save; silently inventing a
// schedule would make it impossible to tell the user that at least one day is
// required. Enforcing the wire minimum is `isValid` / `wireValue`, not
// `normalize` — and the UI checks those before it builds a request.
public enum LeadDaysRules {

    // MARK: - Limits from the contract

    /// At least one day must be chosen — an empty array is a 400.
    public static let minimumCount = 1

    /// At most five days per entity.
    public static let maximumCount = 5

    /// Every entry is clamped into this range.
    public static let validRange = 0...365

    /// What the server stores when `leadDays` is absent on create. The forms
    /// start from this so a first save sends an explicit, already-normalised
    /// schedule instead of relying on the server default.
    /// Server default for a device: the old warranty cron fired at 7 and 30 days.
    public static let defaults = [30, 7]
    /// Server default for a subscription: the old renewal cron fired at 3, 1 and
    /// 0 days. Kept different on purpose — one default cannot preserve both.
    public static let subscriptionDefaults = [3, 1, 0]

    /// The one-tap presets offered above the custom field, in the order they are
    /// drawn. `0` is a real choice: remind on the expiry day itself.
    public static let presets = [60, 30, 14, 7, 1, 0]

    // MARK: - Normalisation

    /// Clamps one candidate day into `0...365`.
    public static func clamp(_ day: Int) -> Int {
        min(max(day, validRange.lowerBound), validRange.upperBound)
    }

    /// The canonical form of a candidate list:
    /// clamp every entry, drop duplicates, sort **descending**, keep at most
    /// five. An empty input stays empty (see the note above).
    ///
    /// Sorting before the cap means a too-long list keeps its five *largest*
    /// lead times — the earlier reminder is the one a user cannot compensate for
    /// by acting late. The UI never lets the list exceed five in the first
    /// place; this is the defensive path for decoded/legacy payloads.
    public static func normalize(_ candidate: [Int]) -> [Int] {
        var seen = Set<Int>()
        var unique: [Int] = []
        for raw in candidate {
            let day = clamp(raw)
            if seen.insert(day).inserted { unique.append(day) }
        }
        return Array(unique.sorted(by: >).prefix(maximumCount))
    }

    /// Whether the **wire** would accept this list exactly as given: 1…5
    /// entries, each in `0...365`, no duplicates.
    ///
    /// `normalize` makes a list canonical; this decides whether a canonical list
    /// may be sent at all. They are separate on purpose: a picker with no chips
    /// selected is a normalised (and visibly empty) state, not a valid schedule.
    public static func isValid(_ days: [Int]) -> Bool {
        guard (minimumCount...maximumCount).contains(days.count) else { return false }
        guard Set(days).count == days.count else { return false }
        return days.allSatisfy(validRange.contains)
    }

    /// The value to put on the wire, or `nil` when the selection cannot be sent.
    /// Callers use this as the last gate before building a request, so an empty
    /// or over-long list never reaches the server's 400.
    public static func wireValue(_ days: [Int]) -> [Int]? {
        let normalized = normalize(days)
        return isValid(normalized) ? normalized : nil
    }

    /// Adds `day` when it is not selected, removes it when it is. The result is
    /// normalised, so the chips stay sorted descending and the five-entry cap is
    /// respected even when the caller is a tapped preset chip.
    ///
    /// At the cap, tapping an unselected day is a no-op rather than evicting a
    /// day the user already chose.
    public static func toggling(_ days: [Int], day: Int) -> [Int] {
        let normalized = normalize(days)
        let target = clamp(day)
        if normalized.contains(target) {
            return normalized.filter { $0 != target }
        }
        guard normalized.count < maximumCount else { return normalized }
        return normalize(normalized + [target])
    }

    // MARK: - Display

    /// The schedule as the trailing value of a detail row, e.g.
    /// `"30 và 7 ngày"` / `"30 and 7 days"`. Empty in → empty out (the caller
    /// hides the row).
    public static func dayListText(_ days: [Int]) -> String {
        let normalized = normalize(days)
        guard let last = normalized.last else { return "" }
        if normalized.count == 1 { return L.p("%d ngày", last) }
        return L.t("%@ ngày", joinedNumbers(normalized))
    }

    /// The full detail sentence, e.g.
    /// `"Nhắc trước 30 và 7 ngày"` / `"Reminds you 30 and 7 days before"`.
    /// `nil` when no lead day is recorded, so a detail screen can omit the row
    /// instead of claiming a schedule it does not know.
    public static func summary(_ days: [Int]) -> String? {
        let normalized = normalize(days)
        guard let last = normalized.last else { return nil }
        if normalized.count == 1 { return L.p("Nhắc trước %d ngày", last) }
        return L.t("Nhắc trước %@ ngày", joinedNumbers(normalized))
    }

    /// `"60, 30 và 14"` / `"60, 30 and 14"` — numbers only; the unit lives in
    /// the caller's sentence so English can inflect it once (`"days"`).
    static func joinedNumbers(_ days: [Int]) -> String {
        guard let last = days.last else { return "" }
        guard days.count > 1 else { return String(last) }
        let head = days.dropLast().map(String.init).joined(separator: ", ")
        return L.t("%@ và %@", head, String(last))
    }
}
