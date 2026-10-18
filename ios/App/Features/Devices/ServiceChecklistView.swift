import SwiftUI
import WarrlyKit

// ============================================================
// ServiceChecklistSheet — pre-service handover checklist
//
// The content and order live in `WarrlyKit/ServiceChecklist.swift`; this file
// only draws it and keeps the tick state.
//
// ## Session-only state
//
// `ServiceChecklistSession` is an in-memory `ObservableObject` keyed by device
// id. It is deliberately not `UserDefaults`, not a file and not an API write:
// the checklist is not a persisted feature yet, and claiming otherwise would be
// worse than losing the ticks on force-quit. Leaving this sheet and coming back
// within the same app session keeps them, which is what the screen's own copy
// promises.
//
// ## Read-only
//
// There is no add/edit/delete control for an item. The only interaction is
// ticking a fixed line and resetting the ticks. The list is advice, not a
// server-backed record.
// ============================================================

/// Per-device tick storage for the checklist, alive only as long as the process.
final class ServiceChecklistSession: ObservableObject {
    static let shared = ServiceChecklistSession()

    @Published private var progressByDevice: [String: ServiceChecklistProgress] = [:]

    init() {}

    func progress(for deviceID: String) -> ServiceChecklistProgress {
        progressByDevice[deviceID] ?? ServiceChecklistProgress()
    }

    func isChecked(_ itemID: String, deviceID: String) -> Bool {
        progress(for: deviceID).isChecked(itemID)
    }

    func toggle(_ itemID: String, deviceID: String) {
        var progress = progress(for: deviceID)
        progress.toggle(itemID)
        progressByDevice[deviceID] = progress
    }

    func reset(deviceID: String) {
        progressByDevice[deviceID] = ServiceChecklistProgress()
    }
}

struct ServiceChecklistSheet: View {
    let device: ServiceChecklistDevice
    let deviceID: String
    @ObservedObject var session: ServiceChecklistSession

    @Environment(\.dismiss) private var dismiss

    private var sections: [ServiceChecklistSection] {
        ServiceChecklist.sections(for: device)
    }

    private var allItemIDs: [String] {
        sections.flatMap(\.items).map(\.id)
    }

    private var total: Int { allItemIDs.count }

    private var completed: Int {
        session.progress(for: deviceID).completedCount(in: allItemIDs)
    }

    private var progressValue: Double {
        total == 0 ? 0 : Double(completed) / Double(total)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    headerCard
                        .padding(.top, 16)

                    WVSectionFooter(L.t("Máy còn khoá, chưa sao lưu hoặc thiếu hoá đơn có thể bị từ chối tiếp nhận. Tick từng bước khi bạn đã làm xong."))

                    progressCard
                        .padding(.top, 4)

                    ForEach(sections) { section in
                        WVSectionHeader(section.title)
                        WVGroup {
                            ForEach(Array(section.items.enumerated()), id: \.element.id) { index, item in
                                if index > 0 { WVDivider() }
                                itemRow(item)
                            }
                        }
                    }

                    WVSectionFooter(L.t("Danh sách chỉ được tick trong phiên này. Đóng ứng dụng là mất các tick; không có gì được lưu lên máy chủ."))

                    if completed > 0 {
                        WVButton(L.t("Bỏ chọn tất cả"), icon: "rotateCcw", kind: .secondary) {
                            session.reset(deviceID: deviceID)
                        }
                        .padding(.horizontal, WVSpacing.gutter)
                        .padding(.top, 8)
                    }

                    Spacer().frame(height: 24)
                }
            }
            .wvScreen()
            .navigationTitle(L.t("Trước khi đi bảo hành"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button(L.t("Xong")) { dismiss() }
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundStyle(WVColor.tint)
                }
            }
        }
    }

    // MARK: - Header

    private var headerCard: some View {
        WVCard(padding: 16) {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 10) {
                    WVLeadingIcon(icon: "checklist", color: WVColor.orange, size: 32)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(device.name)
                            .font(.system(size: 17, weight: .semibold))
                            .foregroundStyle(WVColor.label)
                            .lineLimit(2)
                        Text(L.t("Chuẩn bị trước khi giao máy cho trung tâm bảo hành"))
                            .font(.system(size: 12))
                            .foregroundStyle(WVColor.label3)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    Spacer(minLength: 0)
                }

                if let serial = clean(device.serialNumber) {
                    Text(L.t("Serial/IMEI: %@", serial))
                        .font(.system(size: 13))
                        .foregroundStyle(WVColor.label2)
                        .textSelection(.enabled)
                }
                if let end = clean(device.warrantyEndText) {
                    Text(L.t("Hạn bảo hành: %@", end))
                        .font(.system(size: 13))
                        .foregroundStyle(WVColor.label2)
                }
            }
        }
    }

    // MARK: - Progress

    private var progressCard: some View {
        WVCard(padding: 16) {
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 8) {
                    Text(L.t("Đã chuẩn bị %d/%d bước", completed, total))
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(WVColor.label)
                    Spacer(minLength: 0)
                    if completed == total && total > 0 {
                        WVIcon("checkCircle", size: 14)
                            .foregroundStyle(WVColor.green)
                    }
                }
                WVProgressBar(value: progressValue,
                              tone: completed == total && total > 0 ? WVColor.green : WVColor.tint)
            }
        }
    }

    // MARK: - Rows

    private func itemRow(_ item: ServiceChecklistItem) -> some View {
        let checked = session.isChecked(item.id, deviceID: deviceID)
        return Button {
            session.toggle(item.id, deviceID: deviceID)
        } label: {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: checked ? "checkmark.square.fill" : "square")
                    .font(.system(size: 21, weight: .regular))
                    .foregroundStyle(checked ? WVColor.green : WVColor.label3)
                    .padding(.top, 2)

                VStack(alignment: .leading, spacing: 3) {
                    HStack(alignment: .firstTextBaseline, spacing: 7) {
                        WVIcon(item.icon, size: 13)
                            .foregroundStyle(checked ? WVColor.label3 : WVColor.tint)
                        Text(item.title)
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundStyle(checked ? WVColor.label3 : WVColor.label)
                            .strikethrough(checked, color: WVColor.label3)
                            .fixedSize(horizontal: false, vertical: true)
                            .multilineTextAlignment(.leading)
                    }
                    Text(item.detail)
                        .font(.system(size: 12))
                        .foregroundStyle(WVColor.label3)
                        .fixedSize(horizontal: false, vertical: true)
                        .multilineTextAlignment(.leading)
                }

                Spacer(minLength: 0)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityValue(checked ? L.t("Đã làm") : L.t("Chưa làm"))
    }

    // MARK: - Helpers

    private func clean(_ value: String?) -> String? {
        guard let value = value?.trimmingCharacters(in: .whitespacesAndNewlines),
              !value.isEmpty else { return nil }
        return value
    }
}
