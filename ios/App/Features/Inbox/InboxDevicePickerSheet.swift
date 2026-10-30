import SwiftUI
import WarrlyKit

// ============================================================
// InboxDevicePickerSheet — "Gán vào thiết bị".
//
// The picker stays open after a failed filing on purpose. A 409 means the
// **chosen** device is full, not that the file is unfilable: the row is still in
// the inbox and another device can take it. Closing the sheet on that error
// would hide the two ways out stated in the alert — pick another device, or
// delete the file.
// ============================================================

struct InboxDevicePickerSheet: View {
    @ObservedObject var inbox: InboxStore
    @ObservedObject var devicesStore: DevicesStore
    let attachment: AttachmentMeta

    @Environment(\.dismiss) private var dismiss

    @State private var filingDeviceId: String?
    /// One failure state feeds one alert. Two `.alert` modifiers on the same
    /// view is the same presentation race as two sheets, and only one of these
    /// can be on screen anyway.
    @State private var failure: InboxFileFailure?
    @State private var deleteError: String?

    private var devices: [Device] { devicesStore.devices }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    Spacer().frame(height: 8)

                    Text(attachment.fileName)
                        .wvFont(.footnote)
                        .foregroundStyle(WVColor.label3)
                        .lineLimit(2)
                        .padding(.horizontal, 32)
                        .padding(.bottom, 6)

                    deviceList

                    if let deleteError {
                        Text(deleteError)
                            .wvFont(.footnote)
                            .foregroundStyle(WVColor.red)
                            .padding(.horizontal, 32)
                            .padding(.top, 8)
                    }

                    Spacer().frame(height: 24)
                }
            }
            .wvScreen()
            .navigationTitle(L.t("Gán vào thiết bị"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button(L.t("Huỷ")) { dismiss() }
                        .foregroundStyle(WVColor.tint)
                        .disabled(filingDeviceId != nil)
                }
            }
            .task { await devicesStore.load() }
        }
        // The 409 path. "Chọn thiết bị khác" only clears the alert: the picker
        // stays up with the other devices. "Xoá tệp" is the second way out.
        .alert(
            failure?.title ?? L.t("Không gán được tệp"),
            isPresented: Binding(
                get: { failure != nil },
                set: { if !$0 { failure = nil } }
            ),
            presenting: failure
        ) { failure in
            if failure.isDeviceFull {
                Button(L.t("Chọn thiết bị khác"), role: .cancel) {}
                Button(L.t("Xoá tệp"), role: .destructive) {
                    Task { await deleteAttachment() }
                }
            } else {
                Button("OK", role: .cancel) {}
            }
        } message: { failure in
            Text(failure.message)
        }
    }

    // MARK: - List

    @ViewBuilder
    private var deviceList: some View {
        if case let .error(message) = devicesStore.state, devices.isEmpty {
            WVEmpty(
                icon: "alert",
                title: L.t("Không tải được danh sách"),
                description: message
            ) {
                WVButton(L.t("Thử lại"), kind: .secondary) {
                    Task { await devicesStore.load() }
                }
            }
        } else if devices.isEmpty {
            if case .loading = devicesStore.state {
                ProgressView()
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 40)
            } else if case .idle = devicesStore.state {
                // The `.task` has not run yet; showing "No devices yet" for a
                // frame would be a lie on an account that has plenty.
                ProgressView()
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 40)
            } else {
                WVEmpty(
                    icon: "package",
                    title: L.t("Chưa có thiết bị nào"),
                    description: L.t("Chưa có thiết bị nào. Tạo thiết bị trước rồi quay lại gán tệp.")
                )
            }
        } else {
            WVSectionHeader(L.t("Chọn thiết bị"))
            WVGroup {
                ForEach(Array(devices.enumerated()), id: \.element.id) { index, device in
                    if index > 0 { WVDivider(inset: 60) }
                    deviceRow(device)
                }
            }
            WVSectionFooter(L.t("Tệp sẽ được gán cho thiết bị bạn chọn."))
        }
    }

    private func deviceRow(_ device: Device) -> some View {
        let isFiling = filingDeviceId == device.id
        let isFull = (device.attachmentCount ?? 0) >= 5

        return Button {
            Task { await file(to: device) }
        } label: {
            HStack(spacing: 12) {
                WVLeadingIcon(
                    icon: WVCategory.icon(for: device.category),
                    color: WVCategory.accent(for: device.category)
                )
                VStack(alignment: .leading, spacing: 1) {
                    Text(device.name)
                        .wvFont(.body)
                        .foregroundStyle(WVColor.label)
                        .lineLimit(1)
                    Text(deviceSubtitle(device))
                        .wvFont(.footnote)
                        .foregroundStyle(WVColor.label3)
                        .lineLimit(1)
                }
                Spacer(minLength: 8)
                if isFiling {
                    ProgressView()
                } else {
                    // The count is advisory: the server still enforces the
                    // limit, and the 409 alert is the authority. Showing it
                    // here stops most doomed picks before the round trip.
                    if isFull {
                        Text("5/5")
                            .wvFont(.captionEmphasis)
                            .foregroundStyle(WVColor.red)
                    }
                    WVIcon("arrowRight", size: 13, weight: .semibold)
                        .foregroundStyle(WVColor.label4)
                }
            }
            .padding(.horizontal, 16)
            .frame(minHeight: 44)
            .padding(.vertical, 7)
            .contentShape(Rectangle())
        }
        .buttonStyle(WVRowButtonStyle())
        .disabled(filingDeviceId != nil)
    }

    private func deviceSubtitle(_ device: Device) -> String {
        let category = CategoryLabels.label(for: device.category)
        let model = [device.brand, device.model]
            .compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
            .joined(separator: " · ")
        return model.isEmpty ? category : "\(category) · \(model)"
    }

    // MARK: - Actions

    private func file(to device: Device) async {
        guard filingDeviceId == nil else { return }
        deleteError = nil
        filingDeviceId = device.id
        defer { filingDeviceId = nil }
        do {
            try await inbox.file(attachment, to: device.id)
            // Refresh the advisory "5/5" counts for the next pick.
            await devicesStore.load()
            dismiss()
        } catch {
            let failure = InboxRules.fileFailure(error)
            if failure.isAttachmentNotFound {
                // Gone elsewhere: there is nothing left to pick a device for.
                // Drop the stale row locally and leave; showing an alert on a
                // sheet that is about to disappear would never be read.
                inbox.removeLocally(attachment)
                dismiss()
            } else {
                // `deviceFull` keeps the picker open; "Chọn thiết bị khác"
                // simply dismisses this alert and the list is still there.
                self.failure = failure
            }
        }
    }

    private func deleteAttachment() async {
        deleteError = nil
        do {
            try await inbox.delete(attachment)
            dismiss()
        } catch {
            deleteError = (error as? APIError)?.localizedDescription
                ?? error.localizedDescription
        }
    }
}
