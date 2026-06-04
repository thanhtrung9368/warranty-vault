import SwiftUI
import WarrantyVaultKit

// ============================================================
// RemindersView — warranty expiry reminders bucketed by urgency.
// Port of RemindersScreen in screens-3.jsx.
// ============================================================

struct RemindersView: View {
    @EnvironmentObject private var auth: AuthStore
    @StateObject private var store: RemindersStore

    @State private var pendingDismiss: String?
    @State private var actionError: String?

    init(client: APIClient) {
        _store = StateObject(wrappedValue: RemindersStore(client: client))
    }

    var body: some View {
        Group {
            switch store.state {
            case .idle, .loading where store.entries.isEmpty:
                ScrollView {
                    RemindersSkeleton()
                }
                .wvScreen()
            case .error(let msg) where store.entries.isEmpty:
                ScrollView {
                    WVEmpty(icon: "alert", title: "Không tải được nhắc", description: msg) {
                        WVButton("Thử lại") { Task { await store.load() } }
                            .padding(.horizontal, 32)
                    }
                }
                .wvScreen()
            case .loaded where store.entries.isEmpty:
                ScrollView {
                    WVEmpty(icon: "checkCircle",
                            title: "Không có nhắc nào, ngon!",
                            description: "Tất cả gói bảo hành đều an toàn.")
                }
                .wvScreen()
            default:
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
                        Task { await dismiss(entry.id) }
                    } label: {
                        HStack(spacing: 4) {
                            if pendingDismiss == entry.id {
                                ProgressView().scaleEffect(0.7)
                            } else {
                                WVIcon("x", size: 10, weight: .bold)
                                Text("Đã xem, ẩn đi")
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

    // MARK: - Helpers

    private struct Bucket {
        let label: String
        let color: Color
        let filter: (UpcomingReminder) -> Bool
    }

    private var buckets: [Bucket] {
        [
            Bucket(label: "Sắp hết trong 30 ngày", color: WVColor.red)   { $0.daysRemaining <= 30 },
            Bucket(label: "Sắp hết trong 60 ngày", color: WVColor.orange) { $0.daysRemaining > 30 && $0.daysRemaining <= 60 },
            Bucket(label: "Sắp hết trong 90 ngày", color: WVColor.green)  { $0.daysRemaining > 60 && $0.daysRemaining <= 90 },
        ]
    }

    private func chipTone(for type: WarrantyType) -> WVChipTone {
        switch type {
        case .STANDARD:    return .gray
        case .EXTENDED:    return .brand
        case .THIRD_PARTY: return .green
        }
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

// MARK: - Skeleton

private struct RemindersSkeleton: View {
    var body: some View {
        VStack(spacing: 0) {
            WVSectionHeader("Đang tải…")
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
