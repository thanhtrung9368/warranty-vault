import SwiftUI
import WarrlyKit

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
//
// Layout at thirty subscriptions: the findings are **grouped by kind**, each
// group's heading carries its count before any card is read, and a group longer
// than `SubscriptionAuditRules.collapsedFindingLimit` shows its first five with
// an explicit "Xem tất cả N phát hiện" row — never a silent truncation. Within a
// group the order is the server's (most money at stake first), and the monthly
// drain is printed on the card so that order is legible instead of inferred.
// ============================================================

/// A link from a finding into one of its subscriptions.
struct AuditSubscriptionNav: Hashable {
    let subscriptionId: String
}

struct SubscriptionAuditScreen: View {
    let client: APIClient
    @ObservedObject var subsStore: SubscriptionsStore
    @StateObject private var store: SubscriptionAuditStore

    /// Group ids whose full finding list is on screen. A collapsed group shows
    /// `collapsedFindingLimit` cards and a row that names the rest.
    @State private var expandedSections: Set<String> = []

    init(client: APIClient, subsStore: SubscriptionsStore) {
        self.client = client
        self.subsStore = subsStore
        _store = StateObject(wrappedValue: SubscriptionAuditStore(client: client))
    }

    private var audit: SubscriptionAudit? { store.audit }
    private var sections: [SubscriptionAuditSection] {
        SubscriptionAuditRules.sections(audit?.findings ?? [])
    }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    Spacer().frame(height: 8)

                    if let audit {
                        summaryCard(audit)

                        if sections.isEmpty {
                            emptyCard
                        } else {
                            ForEach(sections) { section in
                                sectionBlock(section, thresholds: audit.thresholds)
                            }
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
            .task {
                await store.load()
#if DEBUG
                await qaScrollToRequestedSection(proxy)
#endif
            }
            .refreshable { await store.load() }
            .navigationDestination(for: AuditSubscriptionNav.self) { nav in
                SubscriptionDetailView(client: client, store: subsStore,
                                       subscriptionId: nav.subscriptionId)
            }
        }
    }

#if DEBUG
    /// Screenshot QA only. The simulator cannot tap or scroll, so a launch env
    /// opens the report on one named group:
    /// `WV_QA_AUDIT_SECTION=DUPLICATE|PRICE_INCREASED|QUIET_AUTO_RENEW` scrolls
    /// that group's heading to the top, and `WV_QA_AUDIT_EXPAND=1` also expands
    /// it so its "Xem tất cả" / "Thu gọn" row is photographed in place.
    /// Never compiled into Release.
    private func qaScrollToRequestedSection(_ proxy: ScrollViewProxy) async {
        let anchor = ProcessInfo.processInfo.environment["WV_QA_AUDIT_ANCHOR"]
        if anchor == "rules" {
            try? await Task.sleep(nanoseconds: 350_000_000)
            proxy.scrollTo("rules-card", anchor: .top)
            return
        }
        guard let raw = ProcessInfo.processInfo.environment["WV_QA_AUDIT_SECTION"],
              !raw.isEmpty else { return }
        let id: String?
        switch raw.uppercased() {
        case SubscriptionAuditRules.kindQuietAutoRenew:
            id = SubscriptionAuditSection.Kind.quietAutoRenew.rawValue
        case SubscriptionAuditRules.kindPriceIncreased:
            id = SubscriptionAuditSection.Kind.priceIncreased.rawValue
        case SubscriptionAuditRules.kindDuplicate:
            id = SubscriptionAuditSection.Kind.duplicate.rawValue
        default:
            id = nil
        }
        guard let id else { return }
        if ProcessInfo.processInfo.environment["WV_QA_AUDIT_EXPAND"] == "1" {
            expandedSections.insert(id)
        }
        // One runloop turn is not enough for the section to lay out after the
        // read returns; a short fixed wait is the screenshot-only trade.
        try? await Task.sleep(nanoseconds: 350_000_000)
        if anchor == "more" {
            proxy.scrollTo("\(id)-more", anchor: .center)
        } else {
            proxy.scrollTo(id, anchor: .top)
        }
    }
#endif

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
                            .wvFont(.footnoteEmphasis)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .foregroundStyle(WVColor.green)
                }

                // The server's own limits, verbatim — it names what the analysis
                // cannot know (bank transactions, whether a package is in use).
                if !audit.note.isEmpty {
                    Text(audit.note)
                        .wvFont(.footnote)
                        .foregroundStyle(WVColor.label2)
                        .fixedSize(horizontal: false, vertical: true)
                }

                Text(L.t("Soát từ lịch sử thanh toán bạn đã ghi, tính tới %@.", generatedAtLabel(audit)))
                    .wvFont(.caption)
                    .foregroundStyle(WVColor.label3)

                // From `counts` — the server's own tally, never `findings.count`.
                Text(SubscriptionAuditRules.subtitle(audit.counts))
                    .wvFont(.footnoteEmphasis)
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
                .wvFont(.subheadline)
                .foregroundStyle(WVColor.label2)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.horizontal, 16)
                .padding(.vertical, 14)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.top, 12)
    }

    // MARK: - One group

    /// A group of findings: a heading that states the count, then up to
    /// `collapsedFindingLimit` cards, then — when there are more — a row that
    /// says exactly how many and opens them. The count in the heading and in the
    /// row is the same number, so nothing is ever truncated silently.
    private func sectionBlock(_ section: SubscriptionAuditSection,
                              thresholds: SubscriptionAuditThresholds?) -> some View {
        let expanded = expandedSections.contains(section.id)
        let visible = SubscriptionAuditRules.visibleFindings(section, expanded: expanded)

        return VStack(alignment: .leading, spacing: 0) {
            WVSectionHeader(sectionHeading(section))
                .id(section.id)

            VStack(spacing: 8) {
                ForEach(visible) { finding in
                    findingCard(finding, thresholds: thresholds)
                }
                if SubscriptionAuditRules.hasHiddenFindings(section) {
                    expandRow(section, expanded: expanded)
                }
            }
            .padding(.horizontal, WVSpacing.gutter)
        }
    }

    /// "Tự trừ lâu, không ghi nhận · 7 phát hiện" — the number a reader needs
    /// before scrolling, not after.
    private func sectionHeading(_ section: SubscriptionAuditSection) -> String {
        section.title + " · " + L.p("%d phát hiện", section.count)
    }

    /// The explicit cap control. "Xem tất cả 20 phát hiện" always names the whole
    /// group's count; "Thu gọn" puts the first five back. Never a silent
    /// truncation, and never a second sorting rule — expansion only reveals more
    /// of the same money-ordered list.
    private func expandRow(_ section: SubscriptionAuditSection, expanded: Bool) -> some View {
        Button {
            withAnimation(.easeInOut(duration: 0.2)) {
                if expanded {
                    expandedSections.remove(section.id)
                } else {
                    expandedSections.insert(section.id)
                }
            }
        } label: {
            HStack(spacing: 6) {
                Text(expanded
                     ? L.t("Thu gọn")
                     : L.p("Xem tất cả %d phát hiện", section.count))
                    .wvFont(.footnoteEmphasis)
                    .foregroundStyle(WVColor.label2)
                WVIcon(expanded ? "arrowUp" : "arrowDown", size: 11, weight: .semibold)
                    .foregroundStyle(WVColor.label3)
                Spacer(minLength: 0)
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(WVColor.bg2)
            .clipShape(RoundedRectangle(cornerRadius: WVRadius.card, style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(WVRowButtonStyle())
        .id("\(section.id)-more")
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
                .wvFont(.calloutEmphasis)
                .foregroundStyle(WVColor.label)
                .fixedSize(horizontal: false, vertical: true)
            Text(finding.detail)
                .wvFont(.footnote)
                .foregroundStyle(WVColor.label2)
                .fixedSize(horizontal: false, vertical: true)

            // A small rise must read as minor, not as an alert.
            if let material = SubscriptionAuditRules.materialNote(finding, thresholds: thresholds) {
                Text(material)
                    .wvFont(.caption)
                    .foregroundStyle(WVColor.label3)
                    .fixedSize(horizontal: false, vertical: true)
            }

            if let money = SubscriptionAuditRules.moneyLine(finding) {
                Text(money)
                    .wvFont(.footnoteEmphasis)
                    .foregroundStyle(WVColor.label)
            }

            // The figure this group is ordered by. Printing it makes "which one
            // is the expensive one" readable instead of a hidden sort key (the
            // list screen's H6 mistake, not repeated here).
            if let monthly = SubscriptionAuditRules.monthlyLine(finding) {
                Text(monthly)
                    .wvFont(.footnote)
                    .foregroundStyle(WVColor.label2)
            }

            if let timeline = SubscriptionAuditRules.timelineNote(finding) {
                Text(timeline)
                    .wvFont(.caption)
                    .foregroundStyle(WVColor.label3)
                    .fixedSize(horizontal: false, vertical: true)
            }

            // Why the verdict exists, from the payload's own thresholds.
            if let rule = SubscriptionAuditRules.ruleLabel(finding, thresholds: thresholds) {
                Text(rule)
                    .wvFont(.caption)
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
                                    .wvFont(.captionEmphasis)
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
        .padding(16)
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
                .id("rules-card")
            WVGroup {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(Array(lines.enumerated()), id: \.offset) { _, line in
                        HStack(alignment: .top, spacing: 8) {
                            Text("•")
                            Text(line)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        .wvFont(.caption)
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
