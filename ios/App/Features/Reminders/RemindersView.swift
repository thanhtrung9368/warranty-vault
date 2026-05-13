import SwiftUI
import WarrantyVaultKit

struct RemindersView: View {
    @EnvironmentObject var auth: AuthStore
    @StateObject private var store: RemindersStore
    @State private var pendingDismiss: String?
    @State private var actionError: String?

    init(client: APIClient) {
        _store = StateObject(wrappedValue: RemindersStore(client: client))
    }

    var body: some View {
        NavigationStack {
            content
                .navigationTitle("Nhắc")
                .background(WV.Tokens.bg)
        }
        .task { await store.load() }
        .refreshable { await store.load() }
    }

    @ViewBuilder
    private var content: some View {
        switch store.state {
        case .idle:
            ScrollView { WVSkeletonList(count: 3) }
        case .loading where store.entries.isEmpty:
            ScrollView { WVSkeletonList(count: 3) }
        case .error(let msg) where store.entries.isEmpty:
            errorState(msg)
        case .loaded where store.entries.isEmpty:
            emptyState
        default:
            list
        }
    }

    private var list: some View {
        List {
            if let actionError {
                Section {
                    Label(actionError, systemImage: "exclamationmark.triangle.fill")
                        .foregroundStyle(WV.Tokens.destructive)
                        .font(.system(size: 13))
                }
                .listRowBackground(Color.clear)
                .listRowSeparator(.hidden)
            }
            Section {
                ForEach(store.entries) { entry in
                    reminderCard(entry)
                        .listRowBackground(Color.clear)
                        .listRowSeparator(.hidden)
                        .listRowInsets(EdgeInsets(
                            top: WV.Spacing.xs,
                            leading: WV.Spacing.lg,
                            bottom: WV.Spacing.xs,
                            trailing: WV.Spacing.lg
                        ))
                        .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                            Button {
                                Task { await dismiss(entry.id) }
                            } label: {
                                Label("Đã xem", systemImage: "eye.slash")
                            }
                            .tint(WV.Tokens.primary)
                        }
                }
            }
            .listRowBackground(Color.clear)
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
    }

    private func reminderCard(_ entry: UpcomingReminder) -> some View {
        let warnTint = remainingTint(days: entry.daysRemaining)
        return WVCard {
            VStack(alignment: .leading, spacing: WV.Spacing.sm) {
                HStack(alignment: .top, spacing: WV.Spacing.md) {
                    ZStack {
                        RoundedRectangle(cornerRadius: WV.Radius.md)
                            .fill(warnTint.opacity(0.15))
                        Image(systemName: iconForCategory(entry.device.category))
                            .font(.system(size: 22, weight: .semibold))
                            .foregroundStyle(warnTint)
                    }
                    .frame(width: 48, height: 48)
                    VStack(alignment: .leading, spacing: 6) {
                        Text(entry.device.name)
                            .font(.system(size: 16, weight: .semibold))
                        WVStatusPill(entry.type.label, kind: kind(for: entry.type))
                    }
                    Spacer()
                    Text(remainingLabel(days: entry.daysRemaining))
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(warnTint)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(Capsule().fill(warnTint.opacity(0.14)))
                }

                HStack(spacing: WV.Spacing.lg) {
                    metaRow(label: "Hết hạn", value: formatDate(entry.endDate))
                    if let provider = entry.provider, !provider.isEmpty {
                        metaRow(label: "Đơn vị", value: provider)
                    }
                }

                Divider()

                HStack {
                    Spacer()
                    Button {
                        Task { await dismiss(entry.id) }
                    } label: {
                        if pendingDismiss == entry.id {
                            ProgressView()
                        } else {
                            Label("Đã xem", systemImage: "eye.slash")
                                .font(.system(size: 12, weight: .medium))
                        }
                    }
                    .disabled(pendingDismiss != nil)
                    .foregroundStyle(WV.Tokens.primary)
                }
            }
        }
    }

    private var emptyState: some View {
        WVEmptyState(
            icon: "checkmark.seal.fill",
            tint: WV.Tokens.success,
            title: "Không có gì cần nhắc",
            message: "Mọi thiết bị đều ổn. Bảo hành nào sắp hết trong 30 ngày sẽ tự xuất hiện ở đây.",
            ctaTitle: nil,
            action: nil
        )
    }

    private func errorState(_ msg: String) -> some View {
        WVEmptyState(
            icon: "exclamationmark.triangle.fill",
            tint: WV.Tokens.warning,
            title: "Không tải được nhắc",
            message: msg,
            ctaTitle: "Thử lại",
            action: { Task { await store.load() } }
        )
    }

    // MARK: - Helpers

    private func metaRow(label: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.system(size: 11)).foregroundStyle(WV.Tokens.mutedFg)
            Text(value).font(.system(size: 13, weight: .medium))
        }
    }

    private func tint(for type: WarrantyType) -> Color {
        switch type {
        case .STANDARD:    return WV.Tokens.mutedFg
        case .EXTENDED:    return WV.Tokens.primary
        case .THIRD_PARTY: return WV.Tokens.success
        }
    }

    private func kind(for type: WarrantyType) -> WVStatusKind {
        switch type {
        case .STANDARD:    return .neutral
        case .EXTENDED:    return .accent
        case .THIRD_PARTY: return .success
        }
    }

    private func remainingLabel(days: Int) -> String {
        if days < 0 { return "Đã hết \(-days) ngày" }
        if days == 0 { return "Hết hôm nay" }
        return "Còn \(days) ngày"
    }

    private func remainingTint(days: Int) -> Color {
        if days < 0 { return WV.Tokens.destructive }
        if days <= 7 { return WV.Tokens.destructive }
        if days <= 30 { return WV.Tokens.warning }
        return WV.Tokens.success
    }

    private func dismiss(_ id: String) async {
        actionError = nil
        pendingDismiss = id
        defer { pendingDismiss = nil }
        do {
            try await store.dismiss(warrantyId: id)
        } catch {
            actionError = (error as? APIError)?.localizedDescription ?? error.localizedDescription
        }
    }
}
