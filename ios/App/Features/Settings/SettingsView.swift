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
                L.t("Khôi phục từ sao lưu"),
                isPresented: $isPresented,
                titleVisibility: .visible
            ) {
                Button(L.t("Gộp (merge)")) { mode = "merge"; showImporter = true }
                Button(L.t("Thay thế — xoá hết (replace)"), role: .destructive) {
                    mode = "replace"; showImporter = true
                }
                Button(L.t("Huỷ"), role: .cancel) {}
            } message: {
                Text(L.t("“Gộp” thêm dữ liệu từ file vào dữ liệu hiện có. “Thay thế” XOÁ TOÀN BỘ dữ liệu hiện tại trước khi nạp — không thể hoàn tác."))
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
            if case .failure = result { message = L.t("Không mở được file.") }
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
                // Composed from per-count fragments rather than one sentence
                // carrying three numbers: English inflects each noun separately
                // ("1 device" / "2 devices") and a single `%d` template cannot
                // express that. The Vietnamese output is exactly what it was.
                let parts = [
                    L.p("%d thiết bị", res.imported),
                    L.p("%d gói", res.subImported),
                    L.p("%d mục yêu thích", res.wishlistImported),
                ]
                let skipped = res.skipped + res.subSkipped + res.wishlistSkipped
                message = L.t("Đã nhập %@.", parts.joined(separator: ", "))
                    + (skipped > 0 ? " " + L.p("Bỏ qua %d bản ghi trùng.", skipped) : "")
            } catch let APIError.server(_, envelope) {
                message = envelope.message ?? L.t("File backup không hợp lệ.")
            } catch {
                message = L.t("Nhập thất bại — kiểm tra lại file.")
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
    @EnvironmentObject private var localization: LocalizationStore

    @State private var showChangePassword = false
    @State private var showPushDevices = false
    @State private var showSessions = false

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
                WVSectionHeader(L.t("Giao diện"))
                appearanceSection

                // Theme accent (simplified — just dark / light toggle + system)
                WVSectionHeader(L.t("Chế độ"))
                themeSection

                // Language. Stored on the ACCOUNT, not just on this device:
                // the server renders push notifications and email long after the
                // app is gone, so it has to know which language to use.
                WVSectionHeader(L.t("Ngôn ngữ"))
                languageSection
                WVSectionFooter(L.t("Ngôn ngữ áp dụng cho cả ứng dụng, thông báo đẩy và email."))

                // Notifications
                WVSectionHeader(L.t("Nhắc nhở"))
                WVSectionFooter(L.t("Khi gói bảo hành sắp hết, hệ thống đẩy thông báo tự động trước 7 ngày và 30 ngày. Mốc nhắc do máy chủ quy định — ứng dụng chưa hỗ trợ tuỳ chỉnh."))
                notificationsSection

                // Sign-in sessions (who can reach the data)
                WVSectionHeader(L.t("Bảo mật"))
                sessionsSection
                WVSectionFooter(L.t("“Thiết bị đăng nhập” là các phiên còn quyền truy cập dữ liệu của bạn. Khác với “Thiết bị nhận thông báo” ở trên — xoá một đích push chỉ ngừng gửi thông báo, không thu hồi quyền truy cập."))

                // AI receipt scan
                WVSectionHeader(L.t("Quét hoá đơn (AI)"))
                WVSectionFooter(L.t("Khi bật, ảnh hoá đơn sẽ được gửi (đã giải mã) tới dịch vụ AI bên thứ ba để tự điền thông tin. Bạn luôn kiểm tra lại trước khi lưu. Mặc định tắt."))
                aiSection

                // Data
                WVSectionHeader(L.t("Dữ liệu"))
                WVSectionFooter(L.t("File backup chứa dữ liệu nhạy cảm (số seri, giá mua, trung tâm BH). Lưu ở nơi an toàn."))
                dataSection

                // Info
                WVSectionHeader(L.t("Thông tin"))
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
                .navigationTitle(L.t("Thiết bị nhận thông báo"))
                .navigationBarTitleDisplayMode(.inline)
        }
        .navigationDestination(isPresented: $showSessions) {
            SessionsView(client: client)
                .navigationTitle(L.t("Thiết bị đăng nhập"))
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
            if case .failure = result { backupMessage = L.t("Không lưu được file backup.") }
        }
        .alert(L.t("Sao lưu"), isPresented: Binding(
            get: { backupMessage != nil },
            set: { if !$0 { backupMessage = nil } }
        )) {
            Button("OK", role: .cancel) { backupMessage = nil }
        } message: {
            Text(backupMessage ?? "")
        }
        .alert(L.t("Không lưu được ngôn ngữ."), isPresented: Binding(
            get: { localization.saveError != nil },
            set: { if !$0 { localization.saveError = nil } }
        )) {
            Button("OK", role: .cancel) { localization.saveError = nil }
        } message: {
            Text(localization.saveError ?? "")
        }
    }

    // MARK: - Language section

    /// The three states the contract has, not two: `.device` is the absent
    /// `locale` (the server decides per request), and it is the only way back
    /// after a deliberate choice.
    private var languageSection: some View {
        WVGroup {
            ForEach(Array(LanguageChoice.allCases.enumerated()), id: \.element.id) { idx, option in
                if idx > 0 { WVDivider(inset: 60) }
                Button {
                    Task { await localization.select(option.language) }
                } label: {
                    HStack(spacing: 12) {
                        WVLeadingIcon(icon: "globe", color: WVColor.blue)
                        Text(option.label)
                            .font(.system(size: 17))
                            .foregroundStyle(WVColor.label)
                        Spacer(minLength: 8)
                        if localization.isSaving && selectedChoice == option {
                            ProgressView().scaleEffect(0.8)
                        } else if selectedChoice == option {
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
                .disabled(localization.isSaving)
            }
        }
    }

    /// Which row is ticked. Derived from the STORED choice, so "device" shows
    /// as ticked only when the account really has no language saved — even if
    /// the device-derived language happens to equal one of the two.
    private var selectedChoice: LanguageChoice {
        switch localization.storedChoice {
        case .none: return .device
        case .vi:   return .vietnamese
        case .en:   return .english
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
                backupMessage = L.t("Không xuất được dữ liệu.")
            }
        }
    }

    // MARK: - AI section

    private var aiSection: some View {
        WVGroup {
            HStack(spacing: 12) {
                WVLeadingIcon(icon: "receipt", color: WVColor.tint)
                Text(L.t("Quét hoá đơn bằng AI"))
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

    // MARK: - Sessions section

    private var sessionsSection: some View {
        WVGroup {
            WVRow(icon: "shieldCheck", iconColor: WVColor.green,
                  title: L.t("Thiết bị đăng nhập"),
                  subtitle: L.t("Xem và thu hồi các phiên đang hoạt động"),
                  chevron: true) {
                showSessions = true
            }
        }
    }

    // MARK: - Appearance

    private var appearanceSection: some View {
        WVGroup {
            WVRow(
                icon: "moon",
                iconColor: WVColor.gray,
                title: L.t("Giao diện tối"),
                detail: theme.preference == .dark ? L.t("Bật") : nil
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
                Text(L.t("Bật thông báo"))
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
                  title: L.t("Thiết bị nhận thông báo"), chevron: true) {
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
                  title: L.t("Nhắc trước"),
                  subtitle: L.t("Hệ thống tự gửi, chưa tuỳ chỉnh được"),
                  detail: L.t("7 & 30 ngày"))
        }
    }

    // MARK: - Data section

    private var dataSection: some View {
        WVGroup {
            WVRow(icon: "download", iconColor: WVColor.green,
                  title: backupBusy ? L.t("Đang xử lý…") : L.t("Sao lưu (xuất JSON)"),
                  chevron: true) {
                guard !backupBusy else { return }
                exportBackup()
            }
            WVDivider(inset: 60)
            WVRow(icon: "upload", iconColor: WVColor.orange,
                  title: L.t("Khôi phục từ sao lưu"), chevron: true) {
                guard !backupBusy else { return }
                showImporter = true
            }
        }
    }

    // MARK: - Info section

    private var infoSection: some View {
        WVGroup {
            WVRow(icon: "info", iconColor: WVColor.blue,
                  title: L.t("Phiên bản"), detail: appVersion)
            WVDivider(inset: 60)
            WVRow(icon: "shield", iconColor: WVColor.green,
                  title: L.t("Chính sách bảo mật"), chevron: true)
            WVDivider(inset: 60)
            WVRow(icon: "receipt", iconColor: WVColor.gray,
                  title: L.t("Điều khoản sử dụng"), chevron: true)
        }
    }

    // MARK: - Push helpers

    @ViewBuilder
    private var pushStatusBadge: some View {
        switch push.status {
        case .registered:
            WVChip(L.t("Đã bật"), tone: .green)
        case .registering, .requesting:
            ProgressView().scaleEffect(0.8)
        case .denied:
            WVChip(L.t("Đã tắt"), tone: .red)
        case .failed:
            WVChip(L.t("Lỗi"), tone: .orange)
        case .unknown:
            WVChip(L.t("Chưa bật"), tone: .gray)
        }
    }

    private var pushButtonLabel: String {
        switch push.status {
        case .registered:       return L.t("Đăng ký lại token")
        case .denied:           return L.t("Mở Cài đặt iOS để bật")
        case .failed(let m):    return L.t("Thử lại — %@", m)
        case .registering:      return L.t("Đang đăng ký…")
        case .requesting:       return L.t("Đang xin quyền…")
        case .unknown:          return L.t("Bật thông báo")
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
