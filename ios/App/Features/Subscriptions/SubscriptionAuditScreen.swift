import SwiftUI
import WarrantyVaultKit

// ============================================================
// SubscriptionAuditScreen — "Soát gói đăng ký"
//
// Its own screen rather than a section above the subscription list: the payload
// carries an explanatory `note` and the `thresholds` that produced every verdict,
// and neither belongs above a list the user is reading.
//
// The honesty requirement is the point of this feature, so it is worth stating
// here as well as in `SubscriptionAuditRules`:
//
//   * there is **no usage telemetry** — a finding is never "bạn không dùng gói
//     này", so the server's `title`/`detail`/`note` are rendered verbatim and the
//     only local strings are factual labels derived from machine codes;
//   * the recorded date is labelled as a **payment-record** date, never "last
//     used";
//   * `material: false` reads as a minor change, not an alert;
//   * the rule lines come from the payload's own `thresholds`;
//   * there is no cancel, no disable-auto-renew, no "dọn gói này" — links navigate
//     into the subscription and stop. The endpoint has no write path at all.
// ============================================================

/// A link from a finding into one of its subscriptions.
struct AuditSubscriptionNav: Hashable {
    let subscriptionId: String
}

struct SubscriptionAuditScreen: View {
    let client: APIClient
    @ObservedObject var subsStore: SubscriptionsStore
    @StateObject private var store: SubscriptionAuditStore

    init(client: APIClient, subsStore: SubscriptionsStore) {
        self.client = client
        self.subsStore = subsStore
        _store = StateObject(wrappedValue: SubscriptionAuditStore(client: client))
    }

    private var audit: SubscriptionAudit? { store.audit }
    private var findings: [SubscriptionAuditFinding] {
        SubscriptionAuditRules.sorted(audit?.findings ?? [])
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                Spacer().frame(height: 8)

                if let audit {
                    summaryCard(audit)

                    if findings.isEmpty {
                        emptyCard
                    } else {
                        WVSectionHeader(L.t("Phát hiện"))
                        VStack(spacing: 8) {
                            ForEach(findings) { finding in
                                findingCard(finding, thresholds: audit.thresholds)
                            }
                        }
                        .padding(.horizontal, WVSpacing.gutter)
                    }

                    rulesCard(audit)
                } else if case let .error(message) = store.state {
                    WVEmpty(icon: "alert", title: L.t("Không tải được phần soát gói"),
                            description: message) {
                        WVButton(L.t("Thử lại")) { Task { await store.load() } }
                            .padding(.horizontal, WVSpacing.gutter)
                    }
                } else {
                    ProgressView()
                        .frame(maxWidth: .infinity)
                        .padding(.top, 40)
                }

                Spacer().frame(height: 24)
            }
        }
        .wvScreen()
        .navigationTitle(L.t("Soát gói đăng ký"))
        .navigationBarTitleDisplayMode(.inline)
        .task { await store.load() }
        .refreshable { await store.load() }
        .navigationDestination(for: AuditSubscriptionNav.self) { nav in
            SubscriptionDetailView(client: client, store: subsStore,
                                   subscriptionId: nav.subscriptionId)
        }
    }

    // MARK: - Summary

    private func summaryCard(_ audit: SubscriptionAudit) -> some View {
        WVCard(padding: 16) {
            VStack(alignment: .leading, spacing: 10) {
                // `advisory` is a payload field, not an assumption: the screen only
                // promises "no automatic changes" when the server says so.
                if let advisory = SubscriptionAuditRules.advisoryNote(audit.advisory) {
                    HStack(spacing: 8) {
                        WVIcon("shieldCheck", size: 14)
                        Text(advisory)
                            .font(.system(size: 13, weight: .semibold))
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .foregroundStyle(WVColor.green)
                }

                // The server's own limits, verbatim — it names what the analysis
                // cannot know (bank transactions, whether a package is in use).
                if !audit.note.isEmpty {
                    Text(audit.note)
                        .font(.system(size: 13))
                        .foregroundStyle(WVColor.label2)
                        .fixedSize(horizontal: false, vertical: true)
                }

                Text(L.t("Soát từ lịch sử thanh toán bạn đã ghi, tính tới %@.", generatedAtLabel(audit)))
                    .font(.system(size: 12))
                    .foregroundStyle(WVColor.label3)

                // From `counts` — the server's own tally, never `findings.count`.
                Text(SubscriptionAuditRules.subtitle(audit.counts))
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(WVColor.label)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func generatedAtLabel(_ audit: SubscriptionAudit) -> String {
        if let day = ActionQueueRules.dateLabel(audit.generatedAt) { return day }
        return audit.generatedAt
    }

    private var emptyCard: some View {
        WVGroup {
            Text(L.t("Không có phát hiện nào từ dữ liệu bạn đã ghi. Các luật bên dưới vẫn được chạy lại mỗi lần bạn mở màn hình này."))
                .font(.system(size: 14))
                .foregroundStyle(WVColor.label2)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.horizontal, 16)
                .padding(.vertical, 14)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.top, 12)
    }

    // MARK: - One finding

    private func findingCard(_ finding: SubscriptionAuditFinding,
                             thresholds: SubscriptionAuditThresholds?) -> some View {
        let tone = tone(finding)
        let minor = SubscriptionAuditRules.minorPillLabel(finding)

        return VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                WVChip(SubscriptionAuditRules.severityLabel(finding.severity), tone: tone)
                if let minor {
                    WVChip(minor, tone: .gray)
                }
                Spacer(minLength: 0)
            }

            // The server's own sentences, verbatim.
            Text(finding.title)
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(WVColor.label)
                .fixedSize(horizontal: false, vertical: true)
            Text(finding.detail)
                .font(.system(size: 13))
                .foregroundStyle(WVColor.label2)
                .fixedSize(horizontal: false, vertical: true)

            // A small rise must read as minor, not as an alert.
            if let material = SubscriptionAuditRules.materialNote(finding, thresholds: thresholds) {
                Text(material)
                    .font(.system(size: 12))
                    .foregroundStyle(WVColor.label3)
                    .fixedSize(horizontal: false, vertical: true)
            }

            if let money = SubscriptionAuditRules.moneyLine(finding) {
                Text(money)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(WVColor.label)
            }

            if let timeline = SubscriptionAuditRules.timelineNote(finding) {
                Text(timeline)
                    .font(.system(size: 12))
                    .foregroundStyle(WVColor.label3)
                    .fixedSize(horizontal: false, vertical: true)
            }

            // Why the verdict exists, from the payload's own thresholds.
            if let rule = SubscriptionAuditRules.ruleLabel(finding, thresholds: thresholds) {
                Text(rule)
                    .font(.system(size: 12))
                    .foregroundStyle(WVColor.label3)
                    .fixedSize(horizontal: false, vertical: true)
            }

            let links = SubscriptionAuditRules.links(finding)
            if !links.isEmpty {
                // Navigation only. There is deliberately no action button here.
                HStack(spacing: 6) {
                    ForEach(links) { link in
                        NavigationLink(value: AuditSubscriptionNav(subscriptionId: link.subscriptionId)) {
                            HStack(spacing: 4) {
                                Text(link.name ?? L.t("Gói đăng ký"))
                                    .font(.system(size: 12, weight: .semibold))
                                    .lineLimit(1)
                                WVIcon("arrowRight", size: 10, weight: .bold)
                            }
                            .foregroundStyle(WVColor.tint)
                            .padding(.horizontal, 10)
                            .frame(height: 26)
                            .background(WVColor.tint.opacity(0.10))
                            .clipShape(Capsule())
                        }
                        .buttonStyle(.plain)
                    }
                    Spacer(minLength: 0)
                }
                .padding(.top, 2)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(WVColor.bg2)
        .clipShape(RoundedRectangle(cornerRadius: WVRadius.card, style: .continuous))
    }

    /// `material: false` downgrades a price rise to a neutral tone: the finding is
    /// still listed, but it must not look like an alert.
    private func tone(_ finding: SubscriptionAuditFinding) -> WVChipTone {
        if SubscriptionAuditRules.isMinorPriceRise(finding) { return .gray }
        switch SubscriptionAuditRules.severity(finding.severity) {
        case .HIGH:    return .red
        case .MEDIUM:  return .orange
        case .LOW:     return .blue
        case .UNKNOWN: return .gray
        }
    }

    // MARK: - The rules that were applied

    @ViewBuilder
    private func rulesCard(_ audit: SubscriptionAudit) -> some View {
        let lines = SubscriptionAuditRules.thresholdLines(audit.thresholds)
        if !lines.isEmpty {
            WVSectionHeader(L.t("Luật đang áp dụng"))
            WVGroup {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(Array(lines.enumerated()), id: \.offset) { _, line in
                        HStack(alignment: .top, spacing: 8) {
                            Text("•")
                            Text(line)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        .font(.system(size: 12))
                        .foregroundStyle(WVColor.label3)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 14)
            }
            WVSectionFooter(L.t("Các luật này chạy lại mỗi lần bạn mở màn hình, từ chính dữ liệu bạn đã ghi."))
        }
    }
}
