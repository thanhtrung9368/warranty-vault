import Foundation

// "Soát gói đăng ký" — `GET /api/v1/subscriptions/audit` (openapi
// `SubscriptionAudit`).
//
// ## The line this file exists to hold
//
// **The app cannot know whether a subscription is used.** There is no usage
// telemetry and no consumer bank-transaction API, and nothing in the schema means
// "this service was opened". The Go service therefore reports on *recording*:
// "lâu rồi không thấy ghi nhận gì". So:
//
//  * `title` and `detail` are the server's sentences and are rendered
//    **verbatim** — no local copy rewrites them, because each names the numbers
//    that produced it;
//  * nothing here ever produces the words "không dùng" / "bỏ quên" about a
//    service, and there is no "huỷ gói" affordance to build — the endpoint has no
//    write path at all;
//  * `material = false` is rendered as **minor**, never as an alert;
//  * "khoản ghi nhận gần nhất" is labelled as a RECORDING date, because openapi
//    is explicit that it is not the last-used date.
//
// Everything this file adds is a factual label derived from a machine code
// (`kind`, `reason`, `material`) or from the payload's own `thresholds`. If the
// server sends no thresholds, the rule line is omitted rather than guessed at.
//
// Money is `Int64` end to end: the wire is int64 and a narrower type would drop
// a four-billion-đồng value.

// MARK: - Wire shapes

/// The rule constants echoed by the server, so a client can show the rule it
/// applied instead of presenting a finding as an unexplained verdict.
///
/// Every key decodes defensively: a server that sends no thresholds must leave
/// the rule lines out, never invent them.
public struct SubscriptionAuditThresholds: Decodable, Sendable, Hashable {
    public let quietMinAutoCharges: Int
    public let quietMinMonths: Int
    public let upcomingRenewalDays: Int
    public let priceRiseMinPercent: Int
    public let duplicateNormalized: Bool

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        quietMinAutoCharges = try c.decodeIfPresent(Int.self, forKey: .quietMinAutoCharges) ?? 0
        quietMinMonths = try c.decodeIfPresent(Int.self, forKey: .quietMinMonths) ?? 0
        upcomingRenewalDays = try c.decodeIfPresent(Int.self, forKey: .upcomingRenewalDays) ?? 0
        priceRiseMinPercent = try c.decodeIfPresent(Int.self, forKey: .priceRiseMinPercent) ?? 0
        duplicateNormalized = try c.decodeIfPresent(Bool.self, forKey: .duplicateNormalized) ?? false
    }

    private enum CodingKeys: String, CodingKey {
        case quietMinAutoCharges, quietMinMonths, upcomingRenewalDays
        case priceRiseMinPercent, duplicateNormalized
    }
}

/// One advisory conclusion.
public struct SubscriptionAuditFinding: Decodable, Sendable, Hashable, Identifiable {
    /// `<LOẠI_PHÁT_HIỆN>:<id hoặc cặp id>` — stable between reads.
    public let findingKey: String
    /// `QUIET_AUTO_RENEW | PRICE_INCREASED | DUPLICATE` (raw code on purpose).
    public let kind: String
    /// `HIGH | MEDIUM | LOW`.
    public let severity: String
    /// Server-written Vietnamese, rendered as-is.
    public let title: String
    /// Server-written Vietnamese stating the figures behind the conclusion,
    /// rendered as-is.
    public let detail: String

    /// One id for the two single-subscription rules, two for `DUPLICATE`.
    public let subscriptionIds: [String]
    /// Parallel to `subscriptionIds`.
    public let names: [String]

    /// Combined monthly equivalent of the subscriptions involved. `0` for
    /// `LIFETIME`.
    public let monthlyVnd: Int64
    /// What the MACHINE charged automatically (not every payment).
    public let chargedTotalVnd: Int64
    public let chargeCount: Int64

    /// Newest **recorded payment** — explicitly not the last-used date.
    public let lastRecordedAt: String?
    public let nextRenewalAt: String?
    public let daysUntilRenewal: Int?

    public let previousAmountVnd: Int64?
    public let amountVnd: Int64?
    public let increaseVnd: Int64?
    public let increasePercent: Int?
    /// `false` when the rise is below `priceRiseMinPercent`. The finding is still
    /// reported; only its prominence is the client's decision.
    public let material: Bool?
    /// `DUPLICATE` only: `SAME_NAME | SAME_BRAND_CATEGORY`.
    public let reason: String?

    public var id: String { findingKey }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        findingKey = try c.decode(String.self, forKey: .findingKey)
        kind = try c.decode(String.self, forKey: .kind)
        severity = try c.decode(String.self, forKey: .severity)
        title = try c.decode(String.self, forKey: .title)
        detail = try c.decode(String.self, forKey: .detail)
        subscriptionIds = try c.decodeIfPresent([String].self, forKey: .subscriptionIds) ?? []
        names = try c.decodeIfPresent([String].self, forKey: .names) ?? []
        monthlyVnd = try c.decodeIfPresent(Int64.self, forKey: .monthlyVnd) ?? 0
        chargedTotalVnd = try c.decodeIfPresent(Int64.self, forKey: .chargedTotalVnd) ?? 0
        chargeCount = try c.decodeIfPresent(Int64.self, forKey: .chargeCount) ?? 0
        lastRecordedAt = try c.decodeIfPresent(String.self, forKey: .lastRecordedAt)
        nextRenewalAt = try c.decodeIfPresent(String.self, forKey: .nextRenewalAt)
        daysUntilRenewal = try c.decodeIfPresent(Int.self, forKey: .daysUntilRenewal)
        previousAmountVnd = try c.decodeIfPresent(Int64.self, forKey: .previousAmountVnd)
        amountVnd = try c.decodeIfPresent(Int64.self, forKey: .amountVnd)
        increaseVnd = try c.decodeIfPresent(Int64.self, forKey: .increaseVnd)
        increasePercent = try c.decodeIfPresent(Int.self, forKey: .increasePercent)
        material = try c.decodeIfPresent(Bool.self, forKey: .material)
        reason = try c.decodeIfPresent(String.self, forKey: .reason)
    }

    private enum CodingKeys: String, CodingKey {
        case findingKey, kind, severity, title, detail
        case subscriptionIds, names, monthlyVnd, chargedTotalVnd, chargeCount
        case lastRecordedAt, nextRenewalAt, daysUntilRenewal
        case previousAmountVnd, amountVnd, increaseVnd, increasePercent
        case material, reason
    }
}

/// `GET /api/v1/subscriptions/audit` response.
public struct SubscriptionAudit: Decodable, Sendable {
    public let generatedAt: String
    /// Already sorted by the server (severity, then biggest monthly drain, then
    /// key); the client re-sorts so its own sectioning stays consistent.
    public let findings: [SubscriptionAuditFinding]
    /// The server's own tally of every finding — never `findings.count` of a
    /// filtered array.
    public let counts: ActionCounts
    /// Always `true` in this build. Present so the screen only promises "no
    /// automatic changes" when the server actually said so.
    public let advisory: Bool
    /// The rule constants the server applied. Absent → the rule card is hidden.
    public let thresholds: SubscriptionAuditThresholds?
    /// The server's own sentence about the limits of the analysis, rendered
    /// verbatim.
    public let note: String

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        generatedAt = try c.decodeIfPresent(String.self, forKey: .generatedAt) ?? ""
        findings = try c.decodeIfPresent([SubscriptionAuditFinding].self, forKey: .findings) ?? []
        counts = try c.decode(ActionCounts.self, forKey: .counts)
        advisory = try c.decodeIfPresent(Bool.self, forKey: .advisory) ?? false
        thresholds = try c.decodeIfPresent(SubscriptionAuditThresholds.self, forKey: .thresholds)
        note = try c.decodeIfPresent(String.self, forKey: .note) ?? ""
    }

    private enum CodingKeys: String, CodingKey {
        case generatedAt, findings, counts, advisory, thresholds, note
    }
}

/// A finding's link to one of the subscriptions involved.
public struct AuditLink: Equatable, Sendable, Identifiable {
    public let subscriptionId: String
    public let name: String?
    public var id: String { subscriptionId }
}

// MARK: - Pure presentation rules

public enum SubscriptionAuditRules {

    // MARK: Kind / reason codes

    public static let kindQuietAutoRenew = "QUIET_AUTO_RENEW"
    public static let kindPriceIncreased = "PRICE_INCREASED"
    public static let kindDuplicate = "DUPLICATE"

    public static let reasonSameName = "SAME_NAME"
    public static let reasonSameBrandCategory = "SAME_BRAND_CATEGORY"

    /// Severity uses the queue's own mapping: the two payloads share the codes.
    public static func severity(_ raw: String) -> ActionSeverity { ActionSeverity.of(raw) }

    /// The audit's own words for a severity. The queue's labels ("Cần xử lý ngay")
    /// are phrased for work items; here nothing is being asked of the user, so the
    /// pill only grades how much a finding deserves a look.
    public static func severityLabel(_ raw: String) -> String {
        switch severity(raw) {
        case .HIGH: return "Đáng chú ý"
        case .MEDIUM: return "Nên xem lại"
        case .LOW: return "Nhắc nhẹ"
        case .UNKNOWN: return "Khác"
        }
    }

    /// `true` when the server judged a price rise immaterial. Such a finding must
    /// read as a minor change, never as an alert — but it is still listed.
    public static func isMinorPriceRise(_ finding: SubscriptionAuditFinding) -> Bool {
        normalizedKind(finding) == kindPriceIncreased && finding.material == false
    }

    /// Short pill for a finding whose rise the server judged immaterial.
    public static func minorPillLabel(_ finding: SubscriptionAuditFinding) -> String? {
        isMinorPriceRise(finding) ? "Thay đổi nhỏ" : nil
    }

    /// The "mức tăng nhỏ" line, or `nil` when there is nothing to soften.
    ///
    /// A `material` the server never sent (`nil`) produces no claim either way.
    public static func materialNote(_ finding: SubscriptionAuditFinding,
                                    thresholds: SubscriptionAuditThresholds?) -> String? {
        guard finding.material == false else { return nil }
        let percent = thresholds?.priceRiseMinPercent ?? 0
        if percent > 0 {
            return "Mức tăng này dưới \(percent)% nên chỉ là thay đổi nhỏ — không phải cảnh báo."
        }
        return "Mức tăng này được đánh giá là nhỏ — không phải cảnh báo."
    }

    // MARK: The rule behind a verdict

    /// One Vietnamese sentence naming the rule that produced this finding, built
    /// from the payload's own `thresholds`.
    ///
    /// `nil` when the payload does not carry enough to state the rule honestly (no
    /// thresholds for a threshold-based rule, or a kind this build does not know).
    /// The UI then shows only the server's own `detail` — a missing explanation
    /// beats a fabricated one.
    public static func ruleLabel(_ finding: SubscriptionAuditFinding,
                                 thresholds: SubscriptionAuditThresholds?) -> String? {
        switch normalizedKind(finding) {
        case kindQuietAutoRenew:
            guard let t = thresholds, t.quietMinAutoCharges > 0, t.quietMinMonths > 0 else { return nil }
            return "Luật: gói đang hoạt động, không có khoản nào do bạn tự ghi, "
                + "máy đã tự trừ ít nhất \(t.quietMinAutoCharges) lần "
                + "và khoản tự trừ đầu tiên cách đây ít nhất \(t.quietMinMonths) tháng."

        case kindPriceIncreased:
            guard let t = thresholds, t.priceRiseMinPercent > 0 else { return nil }
            return "Luật: so hai kỳ thanh toán liền kề; mọi mức tăng đều được báo, "
                + "từ \(t.priceRiseMinPercent)% trở lên mới coi là đáng kể."

        case kindDuplicate:
            switch finding.reason?.trimmingCharacters(in: .whitespaces).uppercased() {
            case reasonSameBrandCategory:
                return "Luật: hai gói đang hoạt động cùng hãng và cùng loại."
            case reasonSameName:
                return thresholds?.duplicateNormalized == true
                    ? "Luật: hai gói đang hoạt động trùng tên sau khi bỏ dấu và không phân biệt hoa/thường."
                    : "Luật: hai gói đang hoạt động trùng tên."
            default:
                return nil
            }

        default:
            return nil
        }
    }

    // MARK: Figures

    /// The money line for one finding, straight from the payload's own figures:
    ///
    ///  * `QUIET_AUTO_RENEW` — what the MACHINE charged in total and how many
    ///    times (never "total spent": hand-logged payments are excluded);
    ///  * `PRICE_INCREASED` — the absolute rise plus the percentage when it is
    ///    computable (a previous period of 0đ cannot be a percentage, and the
    ///    server says so by sending `increasePercent = null`);
    ///  * `DUPLICATE` — the combined monthly equivalent of both plans.
    public static func moneyLine(_ finding: SubscriptionAuditFinding) -> String? {
        switch normalizedKind(finding) {
        case kindQuietAutoRenew:
            guard finding.chargeCount > 0 else { return nil }
            return "Máy đã tự trừ: \(formatVnd(finding.chargedTotalVnd)) · \(finding.chargeCount) lần"

        case kindPriceIncreased:
            guard let rise = finding.increaseVnd else { return nil }
            if let percent = finding.increasePercent {
                return "Tăng \(formatVnd(rise)) (+\(percent)%)"
            }
            return "Tăng \(formatVnd(rise)) (kỳ trước 0đ nên không tính được %)"

        case kindDuplicate:
            return finding.monthlyVnd > 0
                ? "Quy đổi tháng của cả hai: ~\(formatVnd(finding.monthlyVnd))"
                : nil

        default:
            return nil
        }
    }

    /// Dates that help act on a finding, labelled so they cannot be mistaken for
    /// usage.
    ///
    /// "Khoản ghi nhận gần nhất" is a **recording** date: openapi is explicit that
    /// this is not the last-used date — the app has no way to know that — so the
    /// label must never say "dùng lần cuối".
    public static func timelineNote(_ finding: SubscriptionAuditFinding) -> String? {
        var parts: [String] = []
        if let recorded = ActionQueueRules.dateLabel(finding.lastRecordedAt) {
            parts.append("Khoản ghi nhận gần nhất: \(recorded)")
        }
        if let renewal = ActionQueueRules.dateLabel(finding.nextRenewalAt) {
            if let days = finding.daysUntilRenewal {
                parts.append("Kỳ gia hạn tới: \(renewal) (còn \(days) ngày)")
            } else {
                parts.append("Kỳ gia hạn tới: \(renewal)")
            }
        }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    /// The reassurance line, only when the server actually asserted `advisory`. A
    /// payload without it must not be described as harmless — that is a claim
    /// about the server's behaviour, not a decoration.
    public static func advisoryNote(_ advisory: Bool) -> String? {
        advisory ? "Chỉ tư vấn: không có gì bị sửa, bị huỷ hay bị tắt tự động." : nil
    }

    /// The "Luật đang áp dụng" lines: one per rule, built from the payload's
    /// thresholds. Empty when the server sent none — the card is then hidden
    /// instead of showing an empty box.
    public static func thresholdLines(_ thresholds: SubscriptionAuditThresholds?) -> [String] {
        guard let t = thresholds else { return [] }
        var lines: [String] = []
        if t.quietMinAutoCharges > 0 && t.quietMinMonths > 0 {
            lines.append("Tự trừ lâu không ghi nhận: ≥ \(t.quietMinAutoCharges) khoản máy tự trừ "
                + "và khoản đầu cách đây ≥ \(t.quietMinMonths) tháng.")
        }
        if t.priceRiseMinPercent > 0 {
            lines.append("Tăng giá: mọi mức tăng đều được báo; "
                + "từ \(t.priceRiseMinPercent)% trở lên là đáng kể.")
        }
        if t.upcomingRenewalDays > 0 {
            lines.append("Còn kịp xử lý trước khi bị trừ tiền: \(t.upcomingRenewalDays) ngày.")
        }
        if t.duplicateNormalized {
            lines.append("Trùng nhau: so tên có bỏ dấu, không phân biệt hoa/thường, chỉ giữa các gói đang hoạt động.")
        }
        return lines
    }

    // MARK: Links + counts

    /// The subscriptions a finding points at, in payload order, paired with their
    /// names when the server sent them. A finding with ids but no names still
    /// yields links — the id is enough to open the row, and dropping the link would
    /// hide the only way to act on the finding.
    ///
    /// Navigation only: there is no cancel, disable-auto-renew or edit affordance
    /// anywhere in this feature.
    public static func links(_ finding: SubscriptionAuditFinding) -> [AuditLink] {
        finding.subscriptionIds.enumerated().compactMap { index, id in
            let trimmed = id.trimmingCharacters(in: .whitespaces)
            guard !trimmed.isEmpty else { return nil }
            let name = finding.names.indices.contains(index) ? finding.names[index] : nil
            let cleanName = name?.trimmingCharacters(in: .whitespaces)
            return AuditLink(subscriptionId: trimmed,
                             name: (cleanName?.isEmpty == false) ? cleanName : nil)
        }
    }

    /// Server order is severity, then biggest monthly drain, then key. Re-sorted
    /// so the screen's own badge and sectioning stay consistent with it.
    public static func sorted(_ findings: [SubscriptionAuditFinding]) -> [SubscriptionAuditFinding] {
        findings.sorted { a, b in
            let ra = severity(a.severity).rank
            let rb = severity(b.severity).rank
            if ra != rb { return ra < rb }
            if a.monthlyVnd != b.monthlyVnd { return a.monthlyVnd > b.monthlyVnd }
            return a.findingKey < b.findingKey
        }
    }

    /// How many findings are announced. Comes straight from `counts`, which the
    /// server computed over the same list — never recomputed from a filtered array.
    public static func findingCount(_ audit: SubscriptionAudit?) -> Int {
        audit?.counts.total ?? 0
    }

    /// The subtitle under the screen title, built from `counts`.
    public static func subtitle(_ counts: ActionCounts) -> String {
        switch counts.total {
        case 0: return "Không có gì đáng lưu ý"
        case 1: return "1 phát hiện cần xem lại"
        default: return "\(counts.total) phát hiện cần xem lại"
        }
    }

    /// The entry row's title — `GET /api/v1/subscriptions/audit`.
    public static let entryTitle = "Soát gói đăng ký"

    /// One honest sentence about what the entry row opens. No verdict, no numbers:
    /// the screen itself is where the server's note and findings live.
    public static let entrySubtitle =
        "Đọc lịch sử thanh toán để tìm gói tự trừ lâu không thấy ghi nhận, gói tăng giá và gói trùng nhau."

    // MARK: Money

    /// VND with `.` thousands grouping and a trailing `₫` — the same shape
    /// `WVFormat.vnd` prints, kept on the pure side so the rules (and their tests)
    /// do not depend on the app target. `Int64`, because every amount on the wire
    /// is int64: a narrower type would silently drop a four-billion-đồng value.
    public static func formatVnd(_ amount: Int64) -> String {
        VndFormat.string(amount)
    }

    private static func normalizedKind(_ finding: SubscriptionAuditFinding) -> String {
        finding.kind.trimmingCharacters(in: .whitespaces).uppercased()
    }
}
