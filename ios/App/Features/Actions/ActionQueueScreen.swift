import SwiftUI
import WarrantyVaultKit

// ============================================================
// ActionQueueScreen — "Việc cần xử lý"
//
// A full screen pushed from the dashboard, not a section of it: the queue is a
// detour you come back from (tapping an item opens the entity and Back returns
// here), and the payload carries its own `note` explaining what the list is and
// is not.
//
// Three rules, all pinned in `ActionQueueTests`:
//   * the badge reads `counts.total`, never the rows on screen — a `?snoozed=true`
//     read ADDS rows, so counting them would overstate the workload;
//   * the server's `title`/`detail` are rendered verbatim; the client only adds
//     what the payload does not say (destination, day count, snooze deadline);
//   * a row with no entity id is a plain card, never a dead link.
// ============================================================

/// Where a queue row can be tapped through to. All ten kinds today name one
/// entity; a partial or future payload may name none, and such a row is rendered
/// non-tappable instead.
enum ActionQueueNav: Hashable {
    case device(String)
    case subscription(String)
    case wishlistItem(String)
}

struct ActionQueueScreen: View {
    @ObservedObject var store: ActionQueueStore

    @EnvironmentObject private var toast: WVToastCenter

    /// Which half of the payload is on screen. Both come from the same read; the
    /// snoozed half only exists after the `?snoozed=true` opt-in.
    private enum Mode: Hashable { case active, snoozed }

    @State private var mode: Mode = .active
    /// The itemKey currently being written, so one row can spin without freezing
    /// the screen.
    @State private var pendingKey: String?
    @State private var actionError: String?

    private var items: [ActionItem] { store.queue?.items ?? [] }
    private var actionable: [ActionItem] { ActionQueueRules.actionable(items) }
    private var snoozed: [ActionItem] { ActionQueueRules.snoozed(items) }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                Spacer().frame(height: 8)

                // The server's own sentence about what this queue is and is NOT.
                // Rendered verbatim; hidden when blank rather than replaced with
                // copy of our own.
                if let note = store.queue?.note, !note.isEmpty {
                    noteCard(note)
                }
                // Badge + split. The number is `counts.total` on both sides.
                header

                if let actionError {
                    Text(actionError)
                        .font(.system(size: 13))
                        .foregroundStyle(WVColor.red)
                        .padding(.horizontal, WVSpacing.titleGutter)
                        .padding(.top, 8)
                }

                content

                Spacer().frame(height: 24)
            }
        }
        .wvScreen()
        .navigationTitle(L.t("Việc cần xử lý"))
        .navigationBarTitleDisplayMode(.inline)
        .task { await store.load() }
        .refreshable { await store.load() }
        // The push destinations themselves are registered on the dashboard, which
        // owns the NavigationStack this screen is pushed onto and the stores the
        // entity screens need.
    }

    // MARK: - Header

    private var header: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Text(subtitle)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(WVColor.label2)
                Spacer(minLength: 8)
            }
            .padding(.horizontal, WVSpacing.titleGutter)

            WVSegmented(
                options: [
                    (Mode.active, L.t("Cần xử lý")),
                    (Mode.snoozed, snoozeTabLabel),
                ],
                selection: $mode
            )
            .padding(.horizontal, WVSpacing.gutter)
            .onChange(of: mode) { _, newMode in
                // The snoozed rows are only in the payload after the opt-in read.
                // `snoozed=true` only ever adds rows, so nothing already on screen
                // can disappear because of this.
                guard newMode == .snoozed, !store.loadedSnoozed else { return }
                Task { await store.load(snoozed: true) }
            }
        }
        .padding(.bottom, 12)
    }

    /// Built from `counts` — the server's tally of the actionable set — never from
    /// the rows on screen.
    private var subtitle: String {
        guard let counts = store.queue?.counts else { return L.t("Đang tải…") }
        return ActionQueueRules.subtitle(counts: counts.total, snoozed: store.queue?.snoozedCount ?? 0)
    }

    private var snoozeTabLabel: String {
        let count = store.queue?.snoozedCount ?? 0
        return count > 0 ? L.t("Đang hoãn (%d)", count) : L.t("Đang hoãn")
    }

    // MARK: - Content

    @ViewBuilder
    private var content: some View {
        if store.queue == nil {
            // Nothing has loaded yet. A failed read is stated as such — an empty
            // queue would read as "no work to do", which is a claim this screen
            // cannot support.
            if case let .error(message) = store.state {
                WVEmpty(icon: "alert", title: L.t("Không tải được việc cần xử lý"),
                        description: message) {
                    WVButton(L.t("Thử lại")) { Task { await store.load() } }
                        .padding(.horizontal, WVSpacing.gutter)
                }
            } else {
                ProgressView()
                    .frame(maxWidth: .infinity)
                    .padding(.top, 40)
            }
        } else if mode == .active {
            activeList
        } else {
            snoozedList
        }
    }

    @ViewBuilder
    private var activeList: some View {
        if actionable.isEmpty {
            WVEmpty(icon: "checkCircle", title: L.t("Không còn việc nào"),
                    description: L.t("App không suy ra được việc nào cần bạn quyết định từ dữ liệu hiện có."))
        } else {
            ForEach(Array(ActionQueueRules.sections(actionable).enumerated()), id: \.offset) { _, section in
                WVSectionHeader(section.severity.sectionLabel)
                WVGroup {
                    ForEach(Array(section.items.enumerated()), id: \.element.id) { idx, item in
                        if idx > 0 { WVDivider(inset: 60) }
                        row(item, isSnoozedRow: false)
                    }
                }
            }
        }
    }

    @ViewBuilder
    private var snoozedList: some View {
        if snoozed.isEmpty {
            WVEmpty(icon: "clock", title: L.t("Không có việc nào đang hoãn"),
                    description: L.t("Hoãn một việc để nó tạm rời hàng đợi — việc vẫn còn nguyên và hiện lại khi tới hạn."))
        } else {
            WVSectionHeader(L.t("Đang hoãn"))
            WVSectionFooter(L.t("Việc bị hoãn không được tính vào số việc cần xử lý."))
            WVGroup {
                ForEach(Array(ActionQueueRules.sorted(snoozed).enumerated()), id: \.element.id) { idx, item in
                    if idx > 0 { WVDivider(inset: 60) }
                    row(item, isSnoozedRow: true)
                }
            }
        }
    }

    // MARK: - Row

    /// A row is a tappable door into its entity when the payload names one, and a
    /// plain card when it does not. The snooze control is a **sibling** of the
    /// link, never nested inside it, so neither swallows the other's tap.
    @ViewBuilder
    private func row(_ item: ActionItem, isSnoozedRow: Bool) -> some View {
        HStack(spacing: 0) {
            if let nav = navTarget(item) {
                NavigationLink(value: nav) {
                    rowBody(item, isSnoozedRow: isSnoozedRow, tappable: true)
                }
                .buttonStyle(WVRowButtonStyle())
            } else {
                rowBody(item, isSnoozedRow: isSnoozedRow, tappable: false)
            }

            snoozeControl(item, isSnoozedRow: isSnoozedRow)
        }
    }

    private func navTarget(_ item: ActionItem) -> ActionQueueNav? {
        switch ActionQueueRules.target(item) {
        case .device(let id): return .device(id)
        case .subscription(let id): return .subscription(id)
        case .wishlistItem(let id): return .wishlistItem(id)
        case nil: return nil
        }
    }

    private func rowBody(_ item: ActionItem, isSnoozedRow: Bool, tappable: Bool) -> some View {
        HStack(spacing: 12) {
            WVLeadingIcon(icon: icon(for: item.kind),
                          color: iconColor(for: item.severity),
                          size: 34)

            VStack(alignment: .leading, spacing: 4) {
                // Server copy, verbatim.
                Text(item.title)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(WVColor.label)
                    .multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)

                Text(item.detail)
                    .font(.system(size: 13))
                    .foregroundStyle(WVColor.label2)
                    .multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)

                HStack(spacing: 6) {
                    if let due = ActionQueueRules.dueNote(item.dueDate) {
                        WVChip(due.label, tone: dueTone(due.urgency))
                    }
                    if let amount = item.amountVnd {
                        Text(VndFormat.string(amount))
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(WVColor.label2)
                    }
                    if isSnoozedRow, let until = ActionQueueRules.dateLabel(item.snoozedUntil) {
                        Text(L.t("Hiện lại %@", until))
                            .font(.system(size: 12))
                            .foregroundStyle(WVColor.label3)
                    }
                }
                .padding(.top, 1)
            }

            Spacer(minLength: 8)

            if tappable {
                WVIcon("arrowRight", size: 13, weight: .semibold)
                    .foregroundStyle(WVColor.label4)
            }
        }
        .padding(.horizontal, 16)
        .frame(minHeight: 44)
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
    }

    /// Snooze (a menu of Vietnamese durations) or un-snooze, for one row.
    @ViewBuilder
    private func snoozeControl(_ item: ActionItem, isSnoozedRow: Bool) -> some View {
        Group {
            if isSnoozedRow {
                Button {
                    Task { await unsnooze(item) }
                } label: {
                    snoozeLabel(icon: "rotateCcw", text: L.t("Bỏ hoãn"), busy: pendingKey == item.itemKey)
                }
                .buttonStyle(.plain)
                .disabled(pendingKey != nil)
            } else {
                Menu {
                    Section(L.t("Hoãn việc này trong")) {
                        ForEach(ActionQueueRules.snoozeChoices) { choice in
                            Button(choice.label) {
                                Task { await snooze(item, days: choice.days) }
                            }
                        }
                    }
                } label: {
                    snoozeLabel(icon: "clock", text: L.t("Hoãn"), busy: pendingKey == item.itemKey)
                }
                .disabled(pendingKey != nil)
            }
        }
        .padding(.trailing, 12)
    }

    private func snoozeLabel(icon: String, text: String, busy: Bool) -> some View {
        HStack(spacing: 4) {
            if busy {
                ProgressView().scaleEffect(0.7)
            } else {
                WVIcon(icon, size: 11, weight: .bold)
                Text(text)
            }
        }
        .font(.system(size: 12, weight: .semibold))
        .foregroundStyle(WVColor.tint)
        .padding(.horizontal, 10)
        .frame(height: 26)
        .background(WVColor.fill3)
        .clipShape(Capsule())
        .contentShape(Rectangle())
    }

    // MARK: - Actions

    private func snooze(_ item: ActionItem, days: Int) async {
        actionError = nil
        pendingKey = item.itemKey
        defer { pendingKey = nil }
        do {
            let result = try await store.snooze(item.itemKey, days: days)
            // The server's own `days` is echoed, so the confirmation can never
            // claim a different duration than the queue will show.
            toast.show(ActionQueueRules.snoozeConfirmation(result))
        } catch let err as APIError {
            actionError = err.localizedDescription
        } catch {
            actionError = error.localizedDescription
        }
    }

    private func unsnooze(_ item: ActionItem) async {
        actionError = nil
        pendingKey = item.itemKey
        defer { pendingKey = nil }
        do {
            try await store.unsnooze(item.itemKey)
            toast.show(L.t("Đã bỏ hoãn — việc này quay lại hàng đợi."))
        } catch let err as APIError {
            // 404 = another device already un-snoozed it. The server's message
            // says so; showing it is more useful than a silent success.
            actionError = err.localizedDescription
            await store.load()
        } catch {
            actionError = error.localizedDescription
        }
    }

    // MARK: - Presentation helpers

    private func noteCard(_ note: String) -> some View {
        HStack(alignment: .top, spacing: 10) {
            WVIcon("info", size: 14)
                .foregroundStyle(WVColor.label3)
                .padding(.top, 1)
            Text(note)
                .font(.system(size: 13))
                .foregroundStyle(WVColor.label2)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(WVColor.fill3)
        .clipShape(RoundedRectangle(cornerRadius: WVRadius.card, style: .continuous))
        .padding(.horizontal, WVSpacing.gutter)
        .padding(.bottom, 12)
    }

    private func icon(for kind: String) -> String {
        switch kind {
        case "WARRANTY_EXPIRED":                       return "shieldX"
        case "DEVICE_NO_WARRANTY":                     return "shield"
        case "DEVICE_STATUS_STALE":                    return "refresh"
        case "DEVICE_MISSING_SERIAL":                  return "hash"
        case "DEVICE_MISSING_RECEIPT":                 return "receipt"
        case "RETURN_WINDOW_CLOSING":                  return "clock"
        case "RETURN_WINDOW_UNKNOWN":                  return "calendar"
        case "SUBSCRIPTION_RENEWING_NO_CANCEL_URL":    return "creditCard"
        case "SUBSCRIPTION_PAID_NOT_ADVANCED":         return "trendingUp"
        case "WISHLIST_TARGET_PASSED":                 return "heart"
        default:                                       return "alert"
        }
    }

    private func iconColor(for severity: String) -> Color {
        switch ActionSeverity.of(severity) {
        case .HIGH:    return WVColor.red
        case .MEDIUM:  return WVColor.orange
        case .LOW:     return WVColor.blue
        case .UNKNOWN: return WVColor.gray
        }
    }

    private func dueTone(_ urgency: ActionDueNote.Urgency) -> WVChipTone {
        switch urgency {
        case .overdue, .today: return .red
        case .soon:            return .orange
        case .later:           return .gray
        }
    }
}

// MARK: - Device destination

/// A queue row names a device id, but `DeviceDetailView` draws from a loaded
/// `Device`. Resolve it from the store, loading once when the dashboard's copy is
/// stale or absent — never a dead end.
struct ActionDeviceDestination: View {
    let client: APIClient
    @ObservedObject var store: DevicesStore
    let deviceId: String

    var body: some View {
        if let device = store.devices.first(where: { $0.id == deviceId }) {
            DeviceDetailView(client: client, devicesStore: store, device: device)
        } else {
            ProgressView(L.t("Đang tải…"))
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .task { await store.load() }
        }
    }
}
