import SwiftUI
import WarrantyVaultKit

// ============================================================
// RemindersView — warranty expiry reminders bucketed by urgency,
// plus the "Đã ẩn" list where a hidden reminder can be restored.
// Port of RemindersScreen in screens-3.jsx + the web's restore path.
// ============================================================

struct RemindersView: View {
    @EnvironmentObject private var auth: AuthStore
    @StateObject private var store: RemindersStore

    @State private var pendingDismiss: String?
    @State private var pendingRestore: String?
    @State private var actionError: String?
    @State private var recentlyDismissed: UpcomingReminder?

    init(client: APIClient) {
        _store = StateObject(wrappedValue: RemindersStore(client: client))
    }

    var body: some View {
        Group {
            if store.entries.isEmpty, case .error(let msg) = store.state {
                ScrollView {
                    WVEmpty(icon: "alert", title: L.t("Không tải được nhắc"), description: msg) {
                        WVButton(L.t("Thử lại")) { Task { await store.load() } }
                            .padding(.horizontal, 32)
                    }
                }
                .wvScreen()
            } else if store.entries.isEmpty,
                      store.state == .idle || store.state == .loading {
                ScrollView {
                    RemindersSkeleton()
                }
                .wvScreen()
            } else {
                mainList
            }
        }
        .task { await store.load() }
        .refreshable { await store.load() }
    }

    // MARK: - Main list

    private var mainList: some View {
        ScrollView {
            VStack(spacing: 0) {
                if let actionError {
                    HStack(spacing: 8) {
                        WVIcon("alert", size: 14)
                        Text(actionError)
                            .font(.system(size: 13))
                    }
                    .foregroundStyle(WVColor.red)
                    .padding(.horizontal, WVSpacing.gutter)
                    .padding(.top, 12)
                }

                if let dismissed = recentlyDismissed {
                    HStack(spacing: 8) {
                        WVIcon("checkCircle", size: 14)
                        Text(L.t("Đã ẩn “%@”", dismissed.device.name))
                            .font(.system(size: 13))
                            .lineLimit(1)
                        Spacer(minLength: 8)
                        Button {
                            Task { await restore(dismissed.id, clearUndo: true) }
                        } label: {
                            if pendingRestore == dismissed.id {
                                ProgressView().scaleEffect(0.7)
                            } else {
                                Text(L.t("Hoàn tác"))
                                    .font(.system(size: 13, weight: .semibold))
                            }
                        }
                        .buttonStyle(.plain)
                        .foregroundStyle(WVColor.tint)
                        .disabled(pendingRestore != nil)
                    }
                    .foregroundStyle(WVColor.label2)
                    .padding(.horizontal, WVSpacing.gutter)
                    .padding(.top, 12)
                }

                if store.entries.isEmpty {
                    WVEmpty(icon: "checkCircle",
                            title: L.t("Không có nhắc nào, ngon!"),
                            description: L.t("Tất cả gói bảo hành đều an toàn."))
                        .padding(.top, 24)
                }

                ForEach(buckets, id: \.label) { bucket in
                    let items = store.entries.filter(bucket.filter)
                    if !items.isEmpty {
                        // Colored section header
                        HStack {
                            Text("\(bucket.label) · \(items.count)")
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundStyle(bucket.color)
                            Spacer()
                        }
                        .padding(.horizontal, 32)
                        .padding(.top, 20)
                        .padding(.bottom, 6)

                        WVGroup {
                            ForEach(Array(items.enumerated()), id: \.element.id) { idx, entry in
                                if idx > 0 { WVDivider(inset: 60) }
                                reminderRow(entry)
                            }
                        }
                    }
                }

                dismissedSection

                Spacer().frame(height: 24)
            }
        }
        .wvScreen()
    }

    // MARK: - Reminder row

    private func reminderRow(_ entry: UpcomingReminder) -> some View {
        WVRowContainer {
            HStack(spacing: 12) {
                WVLeadingIcon(
                    icon: WVCategory.icon(for: entry.device.category),
                    color: WVCategory.accent(for: entry.device.category),
                    size: 36
                )

                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 8) {
                        Text(entry.device.name)
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundStyle(WVColor.label)
                            .lineLimit(1)
                        Spacer(minLength: 4)
                        WarrantyPill(daysLeft: entry.daysRemaining)
                    }

                    HStack(spacing: 8) {
                        WVChip(entry.type.label, tone: chipTone(for: entry.type))
                        Text("\(entry.provider ?? "–") · \(WVFormat.date(entry.endDate))")
                            .font(.system(size: 13))
                            .foregroundStyle(WVColor.label3)
                            .lineLimit(1)
                    }

                    // Dismiss button
                    Button {
                        Task { await dismiss(entry) }
                    } label: {
                        HStack(spacing: 4) {
                            if pendingDismiss == entry.id {
                                ProgressView().scaleEffect(0.7)
                            } else {
                                WVIcon("x", size: 10, weight: .bold)
                                Text(L.t("Đã xem, ẩn đi"))
                            }
                        }
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(WVColor.label3)
                        .padding(.horizontal, 8)
                        .frame(height: 22)
                        .background(WVColor.fill3)
                        .clipShape(Capsule())
                    }
                    .buttonStyle(.plain)
                    .disabled(pendingDismiss != nil)
                    .padding(.top, 2)
                }

                WVIcon("arrowRight", size: 13, weight: .semibold)
                    .foregroundStyle(WVColor.label4)
            }
        }
    }

    // MARK: - Đã ẩn (dismissed + restore)

    /// Every hidden warranty, read from the reminders feed with
    /// `includeDismissed=true` (the plain feed excludes dismissed rows).
    /// Mirrors the web reminders page's "Đã ẩn"
    /// section: a dismissed reminder always stays visible *and* restorable,
    /// not just during the few seconds the undo banner is on screen.
    @ViewBuilder
    private var dismissedSection: some View {
        let count = store.dismissedUnavailable ? "?" : "\(store.dismissed.count)"

        HStack {
            Text(L.t("Đã ẩn · %d", count))
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(WVColor.label3)
            Spacer()
        }
        .padding(.horizontal, 32)
        .padding(.top, 20)
        .padding(.bottom, 6)

        WVGroup {
            if store.dismissedUnavailable {
                WVRowContainer {
                    Text(L.t("Không tải được danh sách nhắc nhở đã ẩn — kéo xuống để tải lại nhé."))
                        .font(.system(size: 14))
                        .foregroundStyle(WVColor.label3)
                }
            } else if store.dismissed.isEmpty {
                WVRowContainer {
                    Text(L.t("Chưa ẩn gói bảo hành nào. Gói nào bạn bấm “Đã xem, ẩn đi” sẽ nằm ở đây để khôi phục lại."))
                        .font(.system(size: 14))
                        .foregroundStyle(WVColor.label3)
                        .fixedSize(horizontal: false, vertical: true)
                }
            } else {
                ForEach(Array(store.dismissed.enumerated()), id: \.element.id) { idx, item in
                    if idx > 0 { WVDivider(inset: 60) }
                    dismissedRow(item)
                }
            }
        }
    }

    private func dismissedRow(_ item: DismissedReminder) -> some View {
        WVRowContainer {
            HStack(spacing: 12) {
                WVLeadingIcon(
                    icon: WVCategory.icon(for: item.deviceCategory),
                    color: WVCategory.accent(for: item.deviceCategory),
                    size: 36
                )

                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 8) {
                        Text(item.deviceName)
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundStyle(WVColor.label)
                            .lineLimit(1)
                        Spacer(minLength: 4)
                        WarrantyPill(daysLeft: item.daysRemaining())
                    }

                    HStack(spacing: 8) {
                        WVChip(item.warrantyTypeLabel,
                               tone: chipTone(for: item.warrantyType))
                        if item.deviceStatus != .ACTIVE {
                            WVChip(item.deviceStatus.label, tone: .gray)
                        }
                        Text("\(item.warrantyProvider ?? "–") · \(WVFormat.date(item.endDate))")
                            .font(.system(size: 13))
                            .foregroundStyle(WVColor.label3)
                            .lineLimit(1)
                    }

                    Button {
                        Task { await restore(item.warrantyId, clearUndo: false) }
                    } label: {
                        HStack(spacing: 4) {
                            if pendingRestore == item.warrantyId {
                                ProgressView().scaleEffect(0.7)
                            } else {
                                WVIcon("rotateCcw", size: 10, weight: .bold)
                                Text(L.t("Khôi phục"))
                            }
                        }
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(WVColor.tint)
                        .padding(.horizontal, 8)
                        .frame(height: 22)
                        .background(WVColor.tint.opacity(0.14))
                        .clipShape(Capsule())
                    }
                    .buttonStyle(.plain)
                    .disabled(pendingRestore != nil)
                    .padding(.top, 2)
                }

                WVIcon("arrowRight", size: 13, weight: .semibold)
                    .foregroundStyle(WVColor.label4)
            }
        }
    }

    // MARK: - Helpers

    private struct Bucket {
        let label: String
        let color: Color
        let filter: (UpcomingReminder) -> Bool
    }

    private var buckets: [Bucket] {
        [
            Bucket(label: L.t("Sắp hết trong 30 ngày"), color: WVColor.red)   { $0.daysRemaining <= 30 },
            Bucket(label: L.t("Sắp hết trong 60 ngày"), color: WVColor.orange) { $0.daysRemaining > 30 && $0.daysRemaining <= 60 },
            Bucket(label: L.t("Sắp hết trong 90 ngày"), color: WVColor.green)  { $0.daysRemaining > 60 && $0.daysRemaining <= 90 },
        ]
    }

    private func chipTone(for type: WarrantyType) -> WVChipTone {
        switch type {
        case .STANDARD:    return .gray
        case .EXTENDED:    return .brand
        case .THIRD_PARTY: return .green
        }
    }

    private func dismiss(_ entry: UpcomingReminder) async {
        actionError = nil
        pendingDismiss = entry.id
        defer { pendingDismiss = nil }
        do {
            try await store.dismiss(entry)
            withAnimation { recentlyDismissed = entry }
        } catch {
            actionError = (error as? APIError)?.localizedDescription ?? error.localizedDescription
        }
    }

    private func restore(_ warrantyId: String, clearUndo: Bool) async {
        actionError = nil
        pendingRestore = warrantyId
        defer { pendingRestore = nil }
        do {
            try await store.restore(warrantyId: warrantyId)
            if clearUndo {
                withAnimation { recentlyDismissed = nil }
            }
        } catch {
            actionError = (error as? APIError)?.localizedDescription ?? error.localizedDescription
        }
    }
}

// MARK: - Skeleton

private struct RemindersSkeleton: View {
    var body: some View {
        VStack(spacing: 0) {
            WVSectionHeader(L.t("Đang tải…"))
            WVGroup {
                ForEach(0..<3) { i in
                    if i > 0 { WVDivider(inset: 60) }
                    HStack(spacing: 12) {
                        RoundedRectangle(cornerRadius: 8, style: .continuous)
                            .fill(WVColor.fill3)
                            .frame(width: 36, height: 36)
                        VStack(alignment: .leading, spacing: 6) {
                            RoundedRectangle(cornerRadius: 4, style: .continuous)
                                .fill(WVColor.fill3)
                                .frame(height: 14)
                            RoundedRectangle(cornerRadius: 4, style: .continuous)
                                .fill(WVColor.fill3)
                                .frame(width: 140, height: 12)
                        }
                        Spacer()
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 14)
                    .redacted(reason: .placeholder)
                }
            }
        }
        .padding(.top, 8)
    }
}
