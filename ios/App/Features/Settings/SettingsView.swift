import SwiftUI
import UniformTypeIdentifiers
import WarrantyVaultKit

// ============================================================
// SettingsView — App preferences, notifications, theme.
// Port of SettingsScreen in screens-3.jsx.
// ============================================================

/// Single-file wrapper for `.fileExporter`: the one export mechanism in the
/// app. Used by the JSON backup ("Sao lưu (xuất JSON)") and by the device CSV
/// export in Thêm ("Xuất dữ liệu CSV").
struct ExportFileDocument: FileDocument {
    static var readableContentTypes: [UTType] { [.json, .commaSeparatedText] }
    var data: Data
    init(data: Data) { self.data = data }
    init(configuration: ReadConfiguration) throws {
        data = configuration.file.regularFileContents ?? Data()
    }
    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper {
        FileWrapper(regularFileWithContents: data)
    }
}

/// The app's single JSON-backup importer: mode picker → file picker → result.
///
/// Extracted from `SettingsView` so that "Cài đặt → Khôi phục từ sao lưu" and
/// "Thêm → Import từ file" drive *the same* flow instead of two copies of a
/// destructive ("replace") operation.
///
/// - Parameters:
///   - isPresented: set to `true` to show the merge/replace confirmation.
///   - isBusy: `true` while the picked file is being uploaded.
///   - message: result / failure copy, written for the host screen's alert.
struct BackupImportFlow: ViewModifier {
    let client: APIClient
    @Binding var isPresented: Bool
    @Binding var isBusy: Bool
    @Binding var message: String?

    @State private var showImporter = false
    @State private var mode = "merge"

    func body(content: Content) -> some View {
        content
            .confirmationDialog(
                "Khôi phục từ sao lưu",
                isPresented: $isPresented,
                titleVisibility: .visible
            ) {
                Button("Gộp (merge)") { mode = "merge"; showImporter = true }
                Button("Thay thế — xoá hết (replace)", role: .destructive) {
                    mode = "replace"; showImporter = true
                }
                Button("Huỷ", role: .cancel) {}
            } message: {
                Text("“Gộp” thêm dữ liệu từ file vào dữ liệu hiện có. “Thay thế” XOÁ TOÀN BỘ dữ liệu hiện tại trước khi nạp — không thể hoàn tác.")
            }
            .fileImporter(
                isPresented: $showImporter,
                allowedContentTypes: [.json],
                allowsMultipleSelection: false
            ) { result in
                handleSelection(result)
            }
    }

    private func handleSelection(_ result: Result<[URL], Error>) {
        guard case let .success(urls) = result, let url = urls.first else {
            if case .failure = result { message = "Không mở được file." }
            return
        }
        isBusy = true
        Task {
            defer { isBusy = false }
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            do {
                let data = try Data(contentsOf: url)
                let res = try await client.importBackup(data, mode: mode)
                message = "Đã nhập \(res.imported) thiết bị, \(res.subImported) gói, "
                    + "\(res.wishlistImported) mục yêu thích."
                    + ((res.skipped + res.subSkipped + res.wishlistSkipped) > 0
                        ? " Bỏ qua \(res.skipped + res.subSkipped + res.wishlistSkipped) bản ghi trùng."
                        : "")
            } catch let APIError.server(_, envelope) {
                message = envelope.message ?? "File backup không hợp lệ."
            } catch {
                message = "Nhập thất bại — kiểm tra lại file."
            }
        }
    }
}

extension View {
    /// Attaches the shared backup-import flow to a screen.
    func backupImportFlow(client: APIClient,
                          isPresented: Binding<Bool>,
                          isBusy: Binding<Bool>,
                          message: Binding<String?>) -> some View {
        modifier(BackupImportFlow(client: client,
                                  isPresented: isPresented,
                                  isBusy: isBusy,
                                  message: message))
    }
}

struct SettingsView: View {
    let client: APIClient

    @EnvironmentObject private var auth: AuthStore
    @EnvironmentObject private var push: PushRegistrar
    @EnvironmentObject private var theme: ThemeStore

    @State private var showChangePassword = false
    @State private var showPushDevices = false

    // AI receipt-scan opt-in.
    @State private var aiOptIn = false
    @State private var aiBusy = false

    // Backup export / import.
    @State private var backupBusy = false
    @State private var exportDoc: ExportFileDocument?
    @State private var showExporter = false
    @State private var showImporter = false
    @State private var backupMessage: String?

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
                WVSectionFooter("Khi gói bảo hành sắp hết, hệ thống đẩy thông báo tự động trước 7 ngày và 30 ngày. Mốc nhắc do máy chủ quy định — ứng dụng chưa hỗ trợ tuỳ chỉnh.")
                notificationsSection

                // AI receipt scan
                WVSectionHeader("Quét hoá đơn (AI)")
                WVSectionFooter("Khi bật, ảnh hoá đơn sẽ được gửi (đã giải mã) tới dịch vụ AI bên thứ ba để tự điền thông tin. Bạn luôn kiểm tra lại trước khi lưu. Mặc định tắt.")
                aiSection

                // Data
                WVSectionHeader("Dữ liệu")
                WVSectionFooter("File backup chứa dữ liệu nhạy cảm (số seri, giá mua, trung tâm BH). Lưu ở nơi an toàn.")
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
        .navigationDestination(isPresented: $showPushDevices) {
            PushDevicesView(client: client)
                .navigationTitle("Thiết bị nhận thông báo")
                .navigationBarTitleDisplayMode(.inline)
        }
        .task {
            if let v = try? await client.getAIOptIn() { aiOptIn = v }
        }
        .backupImportFlow(
            client: client,
            isPresented: $showImporter,
            isBusy: $backupBusy,
            message: $backupMessage
        )
        .fileExporter(
            isPresented: $showExporter,
            document: exportDoc,
            contentType: .json,
            defaultFilename: "warrantyvault-backup"
        ) { result in
            if case .failure = result { backupMessage = "Không lưu được file backup." }
        }
        .alert("Sao lưu", isPresented: Binding(
            get: { backupMessage != nil },
            set: { if !$0 { backupMessage = nil } }
        )) {
            Button("OK", role: .cancel) { backupMessage = nil }
        } message: {
            Text(backupMessage ?? "")
        }
    }

    // MARK: - Backup actions

    private func exportBackup() {
        backupBusy = true
        Task {
            defer { backupBusy = false }
            do {
                let data = try await client.exportBackup()
                exportDoc = ExportFileDocument(data: data)
                showExporter = true
            } catch {
                backupMessage = "Không xuất được dữ liệu."
            }
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

            // Reminder lead time.
            //
            // This used to be a picker writing to `@State` only: nothing was
            // saved, nothing was sent, and the value reset on every launch. The
            // push fanout is a server-side cron job on a *fixed* schedule
            // (`api/internal/cron/run.go` fires at 7 and 30 days before expiry)
            // and the API has no per-user lead-time field, so a PATCH-able
            // value does not exist. Rather than keep a control that pretends to
            // work, the row now states the real schedule — and stays a
            // non-interactive row (no chevron, no action).
            WVRow(icon: "clock", iconColor: WVColor.purple,
                  title: "Nhắc trước",
                  subtitle: "Hệ thống tự gửi, chưa tuỳ chỉnh được",
                  detail: "7 & 30 ngày")
        }
    }

    // MARK: - Data section

    private var dataSection: some View {
        WVGroup {
            WVRow(icon: "download", iconColor: WVColor.green,
                  title: backupBusy ? "Đang xử lý…" : "Sao lưu (xuất JSON)",
                  chevron: true) {
                guard !backupBusy else { return }
                exportBackup()
            }
            WVDivider(inset: 60)
            WVRow(icon: "upload", iconColor: WVColor.orange,
                  title: "Khôi phục từ sao lưu", chevron: true) {
                guard !backupBusy else { return }
                showImporter = true
            }
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
