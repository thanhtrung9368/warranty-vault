import SwiftUI
import WarrlyKit

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
                            .wvFont(.footnote)
                    }
                    .foregroundStyle(WVColor.red)
                    .padding(.horizontal, WVSpacing.gutter)
                    .padding(.top, 12)
                }

                if let dismissed = recentlyDismissed {
                    HStack(spacing: 8) {
                        WVIcon("checkCircle", size: 14)
                        Text(L.t("Đã ẩn “%@”", dismissed.device.name))
                            .wvFont(.footnote)
                            .lineLimit(1)
                        Spacer(minLength: 8)
                        Button {
                            Task { await restore(dismissed.id, clearUndo: true) }
                        } label: {
                            if pendingRestore == dismissed.id {
                                ProgressView().scaleEffect(0.7)
                            } else {
                                Text(L.t("Hoàn tác"))
                                    .wvFont(.footnoteEmphasis)
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

                // The dates and day counts on every row below are the legal
                // ones when the device has closed repairs; say so once, here,
                // rather than mutating the server's data or hiding the note in
                // a row the user may scroll past.
                if store.hasRepairExtension {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(L.t("Ngày hết hạn bên dưới đã cộng thời gian sửa chữa đã đóng."))
                            .wvFont(.footnoteEmphasis)
                            .foregroundStyle(WVColor.label2)
                        Text(WarrantyRepairAdjustment.legalNote)
                            .wvFont(.footnote)
                            .foregroundStyle(WVColor.label3)
                    }
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 32)
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
                                .wvFont(.footnoteEmphasis)
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
        // Display-only legal extension: a device with closed repairs ends
        // later than the server's stored date. The pill, the date and the
        // bucket above all read this one value.
        let repairDays = store.repairDays(forDeviceId: entry.deviceId)
        let endDate = store.adjustedEnd(entry.endDate, deviceId: entry.deviceId)
        let daysLeft = CalendarDay.days(from: Date(), to: endDate)

        return WVRowContainer {
            HStack(spacing: 12) {
                WVLeadingIcon(
                    icon: WVCategory.icon(for: entry.device.category),
                    color: WVCategory.accent(for: entry.device.category),
                    size: 36
                )

                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 8) {
                        Text(entry.device.name)
                            .wvFont(.calloutEmphasis)
                            .foregroundStyle(WVColor.label)
                            .lineLimit(1)
                        Spacer(minLength: 4)
                        WarrantyPill(daysLeft: daysLeft)
                    }

                    HStack(spacing: 8) {
                        WVChip(entry.type.label, tone: chipTone(for: entry.type))
                        if repairDays > 0 {
                            WVChip(L.p("+%d ngày sửa", repairDays), tone: .blue)
                        }
                        Text("\(entry.provider ?? "–") · \(WVFormat.date(endDate))")
                            .wvFont(.footnote)
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
                        .wvFont(.captionEmphasis)
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
                .wvFont(.footnoteEmphasis)
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
                        .wvFont(.subheadline)
                        .foregroundStyle(WVColor.label3)
                }
            } else if store.dismissed.isEmpty {
                WVRowContainer {
                    Text(L.t("Chưa ẩn gói bảo hành nào. Gói nào bạn bấm “Đã xem, ẩn đi” sẽ nằm ở đây để khôi phục lại."))
                        .wvFont(.subheadline)
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
        let repairDays = store.repairDays(forDeviceId: item.deviceId)
        let endDate = store.adjustedEnd(item.endDate, deviceId: item.deviceId)
        let daysLeft = CalendarDay.days(from: Date(), to: endDate)

        return WVRowContainer {
            HStack(spacing: 12) {
                WVLeadingIcon(
                    icon: WVCategory.icon(for: item.deviceCategory),
                    color: WVCategory.accent(for: item.deviceCategory),
                    size: 36
                )

                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 8) {
                        Text(item.deviceName)
                            .wvFont(.calloutEmphasis)
                            .foregroundStyle(WVColor.label)
                            .lineLimit(1)
                        Spacer(minLength: 4)
                        WarrantyPill(daysLeft: daysLeft)
                    }

                    HStack(spacing: 8) {
                        WVChip(item.warrantyTypeLabel,
                               tone: chipTone(for: item.warrantyType))
                        if item.deviceStatus != .ACTIVE {
                            WVChip(item.deviceStatus.label, tone: .gray)
                        }
                        if repairDays > 0 {
                            WVChip(L.p("+%d ngày sửa", repairDays), tone: .blue)
                        }
                        Text("\(item.warrantyProvider ?? "–") · \(WVFormat.date(endDate))")
                            .wvFont(.footnote)
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
                        .wvFont(.captionEmphasis)
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

    /// Whole days until the **legal** end: the server's `endDate` plus this
    /// device's closed-repair days. Bucketing on the raw date would put a
    /// device with a 10-day repair in the 30-day bucket while its row printed a
    /// date 10 days later — the header and the row must use one number.
    private func adjustedDays(_ entry: UpcomingReminder, now: Date) -> Int {
        CalendarDay.days(from: now,
                         to: store.adjustedEnd(entry.endDate, deviceId: entry.deviceId))
    }

    private var buckets: [Bucket] {
        let now = Date()
        return [
            Bucket(label: L.t("Sắp hết trong 30 ngày"), color: WVColor.red) {
                adjustedDays($0, now: now) <= 30
            },
            Bucket(label: L.t("Sắp hết trong 60 ngày"), color: WVColor.orange) {
                let days = adjustedDays($0, now: now)
                return days > 30 && days <= 60
            },
            Bucket(label: L.t("Sắp hết trong 90 ngày"), color: WVColor.green) {
                let days = adjustedDays($0, now: now)
                return days > 60 && days <= 90
            },
            // The feed is queried on the server's raw end (≤ 90 days), but a
            // closed repair can push the legal end past 90. Without this
            // catch-all those rows would fall out of every filter and vanish
            // from the screen — the opposite of the entitlement being shown.
            Bucket(label: L.t("Sau 90 ngày"), color: WVColor.label3) {
                adjustedDays($0, now: now) > 90
            },
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
            // No "Đang tải…" header: the redacted bars are the loading state,
            // and a label printed on top of a skeleton is the senseless state
            // the owner called out. `DevicesListSkeleton` follows the same rule.
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
