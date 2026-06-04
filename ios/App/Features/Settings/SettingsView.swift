import SwiftUI
import WarrantyVaultKit

// ============================================================
// SettingsView — App preferences, notifications, theme.
// Port of SettingsScreen in screens-3.jsx.
// ============================================================

struct SettingsView: View {
    let client: APIClient

    @EnvironmentObject private var auth: AuthStore
    @EnvironmentObject private var push: PushRegistrar
    @EnvironmentObject private var theme: ThemeStore

    @State private var showChangePassword = false
    @State private var showReminderSheet = false
    @State private var showPushDevices = false
    @State private var reminderDays: Int = 30

    // AI receipt-scan opt-in.
    @State private var aiOptIn = false
    @State private var aiBusy = false

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                Spacer().frame(height: 8)

                // Appearance
                WVSectionHeader("Giao diện")
                appearanceSection

                // Theme accent (simplified — just dark / light toggle + system)
                WVSectionHeader("Chế độ")
                themeSection

                // Notifications
                WVSectionHeader("Nhắc nhở")
                WVSectionFooter("Khi gói bảo hành sắp hết, ứng dụng sẽ đẩy thông báo về máy.")
                notificationsSection

                // AI receipt scan
                WVSectionHeader("Quét hoá đơn (AI)")
                WVSectionFooter("Khi bật, ảnh hoá đơn sẽ được gửi (đã giải mã) tới dịch vụ AI bên thứ ba để tự điền thông tin. Bạn luôn kiểm tra lại trước khi lưu. Mặc định tắt.")
                aiSection

                // Data
                WVSectionHeader("Dữ liệu")
                dataSection

                // Info
                WVSectionHeader("Thông tin")
                infoSection

                Spacer().frame(height: 24)
            }
        }
        .wvScreen()
        .sheet(isPresented: $showChangePassword) {
            ChangePasswordSheet(client: client)
        }
        .sheet(isPresented: $showReminderSheet) {
            reminderPickerSheet
        }
        .navigationDestination(isPresented: $showPushDevices) {
            PushDevicesView(client: client)
                .navigationTitle("Thiết bị nhận thông báo")
                .navigationBarTitleDisplayMode(.inline)
        }
        .task {
            if let v = try? await client.getAIOptIn() { aiOptIn = v }
        }
    }

    // MARK: - AI section

    private var aiSection: some View {
        WVGroup {
            HStack(spacing: 12) {
                WVLeadingIcon(icon: "receipt", color: WVColor.tint)
                Text("Quét hoá đơn bằng AI")
                    .font(.system(size: 17))
                    .foregroundStyle(WVColor.label)
                Spacer(minLength: 8)
                if aiBusy {
                    ProgressView()
                } else {
                    Toggle("", isOn: Binding(
                        get: { aiOptIn },
                        set: { newValue in setAIOptIn(newValue) }
                    ))
                    .labelsHidden()
                }
            }
            .padding(.horizontal, 16)
            .frame(minHeight: 44)
            .padding(.vertical, 7)
        }
    }

    private func setAIOptIn(_ enabled: Bool) {
        aiBusy = true
        Task {
            defer { aiBusy = false }
            do {
                let v = try await client.setAIOptIn(enabled)
                aiOptIn = v
            } catch {
                // Revert the toggle on failure.
                aiOptIn = !enabled
            }
        }
    }

    // MARK: - Appearance

    private var appearanceSection: some View {
        WVGroup {
            WVRow(
                icon: "moon",
                iconColor: WVColor.gray,
                title: "Giao diện tối",
                detail: theme.preference == .dark ? "Bật" : nil
            ) {
                theme.preference = theme.preference == .dark ? .light : .dark
            }
        }
    }

    // MARK: - Theme (3-way picker)

    private var themeSection: some View {
        WVGroup {
            ForEach(Array(ThemePreference.allCases.enumerated()), id: \.element.id) { idx, option in
                if idx > 0 { WVDivider(inset: 60) }
                Button {
                    theme.preference = option
                } label: {
                    HStack(spacing: 12) {
                        WVLeadingIcon(
                            icon: option == .dark ? "moon" : option == .light ? "sun" : "settings",
                            color: WVColor.gray
                        )
                        Text(option.label)
                            .font(.system(size: 17))
                            .foregroundStyle(WVColor.label)
                        Spacer(minLength: 8)
                        if theme.preference == option {
                            Image(systemName: "checkmark")
                                .font(.system(size: 14, weight: .semibold))
                                .foregroundStyle(WVColor.tint)
                        }
                    }
                    .padding(.horizontal, 16)
                    .frame(minHeight: 44)
                    .padding(.vertical, 7)
                    .contentShape(Rectangle())
                }
                .buttonStyle(WVRowButtonStyle())
            }
        }
    }

    // MARK: - Notifications

    private var notificationsSection: some View {
        WVGroup {
            // Push status row
            HStack(spacing: 12) {
                WVLeadingIcon(icon: "bell", color: WVColor.red)
                Text("Bật thông báo")
                    .font(.system(size: 17))
                    .foregroundStyle(WVColor.label)
                Spacer(minLength: 8)
                pushStatusBadge
            }
            .padding(.horizontal, 16)
            .frame(minHeight: 44)
            .padding(.vertical, 7)

            WVDivider(inset: 60)

            // Enable / re-register
            WVRow(icon: "refresh", iconColor: WVColor.orange,
                  title: pushButtonLabel, chevron: true) {
                Task { await push.requestAndRegister() }
            }
            .disabled(pushButtonDisabled)

            WVDivider(inset: 60)

            // Devices list
            WVRow(icon: "smartphone", iconColor: WVColor.blue,
                  title: "Thiết bị nhận thông báo", chevron: true) {
                showPushDevices = true
            }

            WVDivider(inset: 60)

            // Reminder lead time
            Button {
                showReminderSheet = true
            } label: {
                HStack(spacing: 12) {
                    WVLeadingIcon(icon: "clock", color: WVColor.purple)
                    Text("Nhắc trước")
                        .font(.system(size: 17))
                        .foregroundStyle(WVColor.label)
                    Spacer(minLength: 8)
                    Text("\(reminderDays) ngày")
                        .font(.system(size: 17))
                        .foregroundStyle(WVColor.label3)
                    WVIcon("arrowRight", size: 13, weight: .semibold)
                        .foregroundStyle(WVColor.label4)
                }
                .padding(.horizontal, 16)
                .frame(minHeight: 44)
                .padding(.vertical, 7)
                .contentShape(Rectangle())
            }
            .buttonStyle(WVRowButtonStyle())
        }
    }

    // MARK: - Data section

    private var dataSection: some View {
        WVGroup {
            WVRow(icon: "cloud", iconColor: WVColor.teal,
                  title: "iCloud Sync", detail: "Bật", chevron: true)
            WVDivider(inset: 60)
            WVRow(icon: "download", iconColor: WVColor.green,
                  title: "Sao lưu", detail: "Hôm qua", chevron: true)
            WVDivider(inset: 60)
            WVRow(icon: "upload", iconColor: WVColor.orange,
                  title: "Khôi phục từ sao lưu", chevron: true)
            WVDivider(inset: 60)
            WVRow(icon: "trash", iconColor: WVColor.red,
                  title: "Xoá toàn bộ dữ liệu", role: .destructive)
        }
    }

    // MARK: - Info section

    private var infoSection: some View {
        WVGroup {
            WVRow(icon: "info", iconColor: WVColor.blue,
                  title: "Phiên bản", detail: appVersion)
            WVDivider(inset: 60)
            WVRow(icon: "shield", iconColor: WVColor.green,
                  title: "Chính sách bảo mật", chevron: true)
            WVDivider(inset: 60)
            WVRow(icon: "receipt", iconColor: WVColor.gray,
                  title: "Điều khoản sử dụng", chevron: true)
        }
    }

    // MARK: - Reminder picker sheet

    private var reminderPickerSheet: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 0) {
                    Spacer().frame(height: 12)
                    WVGroup {
                        ForEach(Array([7, 14, 30, 60, 90].enumerated()), id: \.element) { idx, n in
                            if idx > 0 { WVDivider(inset: 16) }
                            Button {
                                reminderDays = n
                                showReminderSheet = false
                            } label: {
                                HStack {
                                    Text("\(n) ngày trước hết hạn")
                                        .font(.system(size: 17))
                                        .foregroundStyle(WVColor.label)
                                    Spacer()
                                    if reminderDays == n {
                                        Image(systemName: "checkmark")
                                            .font(.system(size: 14, weight: .semibold))
                                            .foregroundStyle(WVColor.tint)
                                    }
                                }
                                .padding(.horizontal, 16)
                                .frame(minHeight: 44)
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(WVRowButtonStyle())
                        }
                    }
                    Spacer().frame(height: 20)
                }
            }
            .wvScreen()
            .navigationTitle("Nhắc trước")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Xong") { showReminderSheet = false }
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundStyle(WVColor.tint)
                }
            }
        }
    }

    // MARK: - Push helpers

    @ViewBuilder
    private var pushStatusBadge: some View {
        switch push.status {
        case .registered:
            WVChip("Đã bật", tone: .green)
        case .registering, .requesting:
            ProgressView().scaleEffect(0.8)
        case .denied:
            WVChip("Đã tắt", tone: .red)
        case .failed:
            WVChip("Lỗi", tone: .orange)
        case .unknown:
            WVChip("Chưa bật", tone: .gray)
        }
    }

    private var pushButtonLabel: String {
        switch push.status {
        case .registered:       return "Đăng ký lại token"
        case .denied:           return "Mở Cài đặt iOS để bật"
        case .failed(let m):    return "Thử lại — \(m)"
        case .registering:      return "Đang đăng ký…"
        case .requesting:       return "Đang xin quyền…"
        case .unknown:          return "Bật thông báo"
        }
    }

    private var pushButtonDisabled: Bool {
        switch push.status {
        case .registering, .requesting: return true
        default: return false
        }
    }

    private var appVersion: String {
        let v = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0.0"
        let b = Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? ""
        return b.isEmpty ? v : "\(v) (\(b))"
    }
}
