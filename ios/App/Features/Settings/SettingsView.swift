import SwiftUI
import UIKit
import UniformTypeIdentifiers
import WarrlyKit

// ============================================================
// SettingsView — App preferences, notifications, theme.
// Port of SettingsScreen in screens-3.jsx.
// ============================================================

/// The AI opt-in switch — re-enabled for 1.2 (FEATURE_RESEARCH_2026-11 §6.3).
///
/// It was hidden in 1.0.0/1.1 while `NSCameraUsageDescription` claimed images
/// never leave the device, which was false: the OCR and claim-assessment paths
/// already sent decrypted data to Anthropic. Re-enabling it is only acceptable
/// together with the two truthful disclosures that ship in this same change:
///
///  1. the Settings footer below states WHAT leaves (decrypted receipt/warranty-
///     card photos, PDFs and, for claim assessment, repair details + contract
///     terms), WHERE it goes (Anthropic, a US service outside Vietnam) and HOW
///     LONG it is kept (Anthropic deletes API inputs/outputs within 30 days
///     unless required otherwise; Warrly keeps only the searchable transcript
///     until the file is deleted); and
///  2. `NSCameraUsageDescription` no longer says images stay on the device.
///
/// Those claims are not marketing copy. The retention/training wording comes
/// from Anthropic's own commercial-data pages
/// (privacy.claude.com/en/articles/7996866 and .../7996868, read 2026-11). If
/// either fact stops being true, this constant goes back to `false` — the scan
/// entry points in `DeviceFormView` and `WarrantyFormView` key off it, so one
/// line removes every surface that promises the feature.
///
/// The constant stays (rather than deleting it) so the pairing between the
/// switch and the scan buttons is still enforced in one place.
enum AIOptInSurface {
    static let isVisible = true
}

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

    /// Non-fatal caveats returned by the import, in the language the API
    /// rendered them in. Kept OUT of `message`: the counts are a success alert,
    /// while a provenance warning is neither a success nor a failure and must
    /// stay readable after the alert is dismissed. Empty on an ordinary import,
    /// in which case the inset below adds no height at all.
    @State private var warnings: [String] = []

    func body(content: Content) -> some View {
        content
            // A persistent inset (not a toast) because the caveat is about the
            // data now in the account, not about the tap that imported it. Uses
            // the same inline-notice card as the "partial stats" and "open
            // claim" warnings, with "restored" in the title so the orange card
            // cannot be mistaken for a failed import.
            .safeAreaInset(edge: .top, spacing: 0) {
                if !warnings.isEmpty {
                    WVNotice(
                        title: L.t("Đã khôi phục dữ liệu — có lưu ý"),
                        messages: warnings
                    )
                    .padding(.horizontal, WVSpacing.gutter)
                    .padding(.vertical, WVSpacing.sm)
                    .frame(maxWidth: .infinity)
                    .background(WVColor.bg)
                }
            }
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
        // A warning describes THIS import. Never let the previous one survive a
        // new attempt — including one whose file picker is cancelled or whose
        // response has none.
        warnings = []
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
                // A backup can replace every device row in one request. The
                // widget and Spotlight must follow it immediately, not at the
                // next launch.
                DeadlineSurface.refreshSoon(client: client)
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
                // The API already rendered these in the request's language
                // (`Accept-Language` is attached by `APIClient`). The app shows
                // that sentence verbatim: warnings have no machine-readable
                // code, only prose, so a local copy could neither identify the
                // right sentence nor stay in sync with the server's meaning.
                warnings = res.warningsOrEmpty
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
    /// Owns the UMP privacy options form and the requirement that decides
    /// whether its Settings row exists at all.
    @EnvironmentObject private var ads: AdsController
    /// The server-verified Premium entitlement and the StoreKit products.
    @EnvironmentObject private var premium: PremiumStore

    /// Used to re-read the notification answer when the user comes back from
    /// iOS Settings: the change happens outside the app, so nothing else would
    /// tell the row to update.
    @Environment(\.scenePhase) private var scenePhase

    @State private var showChangePassword = false
    @State private var showPushDevices = false
    @State private var showSessions = false
    @State private var showPremium = false

    // AI receipt-scan opt-in.
    @State private var aiOptIn = false
    @State private var aiBusy = false
    /// Server copy for a refused opt-in change. The switch used to flip back
    /// with no explanation at all; Android shows the server's message in a
    /// snackbar, and this is the same thing through the alert pattern used
    /// below for backups and the language.
    @State private var aiError: String?

    // Reminder email fallback (#8). Off by default; the switch reads the value
    // the ACCOUNT holds (via `auth.status`) and a failed PATCH reverts to it.
    @State private var reminderEmailFallbackBusy = false
    @State private var reminderEmailFallbackError: String?

    // Backup export / import.
    @State private var backupBusy = false
    @State private var exportDoc: ExportFileDocument?
    @State private var showExporter = false
    @State private var showImporter = false
    @State private var backupMessage: String?

    // Insurance PDF pack (account-wide, always Vietnamese).
    @State private var showInsurancePack = false

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                Spacer().frame(height: WVSpacing.sm)

                // Four groups, by what the person came here to do. The old
                // eight headers each needed a footer to say how they differed
                // from their neighbour.

                // Giao diện — theme and language. Language is stored on the
                // ACCOUNT, not just on this device: the server renders push
                // notifications and email long after the app is gone.
                WVSectionHeader(L.t("Giao diện"))
                themeSection
                Spacer().frame(height: WVSpacing.md)
                languageSection
                WVSectionFooter(L.t("Ngôn ngữ áp dụng cho cả ứng dụng, thông báo đẩy và email."))
                // The switch rebuilds the view tree (`.id(localization.language)`
                // in `WarrlyApp`), so every visible label is re-rendered on the
                // spot. There is no restart step, and a footer claiming one
                // would send users looking for a problem that does not exist.
                WVSectionFooter(L.t("Đổi ngôn ngữ áp dụng ngay — không cần khởi động lại ứng dụng."))

                // Warrly Premium. The row is the entry point the App Review
                // reviewer and a returning buyer both need; the paywall owns
                // price/trial/restore/legal. Ad gating and the server quota
                // read the same store.
                WVSectionHeader(L.t("Warrly Premium"))
                premiumSection
                WVSectionFooter(L.t("Premium bỏ quảng cáo và nâng giới hạn cho toàn bộ tài khoản. Gói tự động gia hạn; quản lý hoặc huỷ trong phần đăng ký của Apple."))

                // Thông báo. The explanation sits below the rows it explains
                // (§8.7): one rule for every group on this screen.
                WVSectionHeader(L.t("Thông báo"))
                notificationsSection
                WVSectionFooter(L.t("Mốc nhắc được đặt riêng cho từng thiết bị và gói đăng ký — mở chi tiết để chỉnh. Mặc định là 30 và 7 ngày."))
                // Consent copy for the email fallback, not a feature blurb. It
                // names the trigger (push unavailable or failed), the ceiling
                // (one email per reminder), the recipient (this account's own
                // address, interpolated — there is no "send to" field) and that
                // the mail is transactional. Those four facts are why the
                // switch may exist at all; do not soften them.
                WVSectionFooter(L.t("Chỉ dùng khi thông báo đẩy không khả dụng hoặc gửi lỗi. Mỗi mốc nhắc gửi tối đa một email tới địa chỉ %@ của tài khoản — email giao dịch, không phải quảng cáo. Mặc định tắt.", accountEmail))

                // Bảo mật & dữ liệu — who can reach the data, what leaves the
                // box, and the backup.
                WVSectionHeader(L.t("Bảo mật & dữ liệu"))
                sessionsSection
                WVSectionFooter(L.t("“Phiên đăng nhập” là các thiết bị còn quyền truy cập dữ liệu của bạn. Khác với “Nơi nhận thông báo” ở trên — xoá một nơi nhận chỉ ngừng gửi thông báo, không thu hồi quyền truy cập."))

                // Shared AI opt-in. Deliberately hidden in 1.0.0 — see
                // `AIOptInSurface`. The switch and its explanation are gated
                // together so the disclosure cannot outlive the row it explains.
                // Session revocation above and the backup warning below stay.
                if AIOptInSurface.isVisible {
                    aiSection
                    // Consent copy, not a feature description. Split into a
                    // lead, the three things the assistant does and three short
                    // paragraphs (1.0.3, matching the web's `ai-settings.tsx`):
                    // as one 600-character footer it was a wall nobody read.
                    // It names the recipient (Anthropic), where it is (the US,
                    // outside Vietnam), the retention (30 days, with the
                    // documented exceptions) and what Warrly itself keeps. Every
                    // claim is sourced — see `AIOptInSurface` above; do not
                    // soften or extend it without a source.
                    AIConsentFooter()
                }

                dataSection
                WVSectionFooter(L.t("File backup chứa dữ liệu nhạy cảm (số seri, giá mua, trung tâm BH). Lưu ở nơi an toàn."))

                // Privacy options. Deliberately conditional: when UMP does not
                // require a privacy options form there must be nothing here at
                // all. The pure rule (pinned by swift test) is
                // `AdsConsentOrdering.showsPrivacyOptionsEntry`.
                if AdsConsentOrdering.showsPrivacyOptionsEntry(ads.privacyOptionsRequirement) {
                    Spacer().frame(height: WVSpacing.md)
                    privacySection
                }

                // Về Warrly
                WVSectionHeader(L.t("Về Warrly"))
                infoSection

                Spacer().frame(height: WVSpacing.xl)
            }
        }
        .wvScreen()
        .sheet(isPresented: $showChangePassword) {
            ChangePasswordSheet(client: client)
        }
        .sheet(isPresented: $showPremium) {
            PremiumPaywallView()
        }
        .sheet(isPresented: $showInsurancePack) {
            InsurancePackSheet(client: client)
        }
        .navigationDestination(isPresented: $showPushDevices) {
            PushDevicesView(client: client)
                .navigationTitle(L.t("Nơi nhận thông báo"))
                .navigationBarTitleDisplayMode(.inline)
        }
        .navigationDestination(isPresented: $showSessions) {
            SessionsView(client: client)
                .navigationTitle(L.t("Phiên đăng nhập"))
                .navigationBarTitleDisplayMode(.inline)
        }
        .task {
            if AIOptInSurface.isVisible,
               let v = try? await client.getAIOptIn() { aiOptIn = v }
            // UMP's requirement can change after launch (the privacy options
            // form itself, a region/console change). Re-read it on entry so
            // the row is never left stale in either direction.
            ads.refreshPrivacyOptionsRequirement()
            // The answer may have changed in iOS Settings since launch. Read it
            // without prompting; this is what makes the row tell the truth on
            // entry rather than at the next cold start.
            await push.refreshPermission()
        }
        // Returning from iOS Settings is the case this screen exists for: the
        // decision was changed outside the app, and only a re-read can replace
        // the stale "Đã tắt" with the truth.
        .onChange(of: scenePhase) { _, phase in
            guard phase == .active else { return }
            Task { await push.refreshPermission() }
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
            defaultFilename: "warrly-backup"
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
        .alert(L.t("Không lưu được lựa chọn"), isPresented: Binding(
            get: { aiError != nil },
            set: { if !$0 { aiError = nil } }
        )) {
            Button("OK", role: .cancel) { aiError = nil }
        } message: {
            Text(aiError ?? "")
        }
        .alert(L.t("Không lưu được lựa chọn"), isPresented: Binding(
            get: { reminderEmailFallbackError != nil },
            set: { if !$0 { reminderEmailFallbackError = nil } }
        )) {
            Button("OK", role: .cancel) { reminderEmailFallbackError = nil }
        } message: {
            Text(reminderEmailFallbackError ?? "")
        }
    }

    // MARK: - Premium section

    /// One row: upgrade on a free account, status + management on a paid one.
    /// The banner is already hidden by `WarrlyApp`'s `onChange`; this row is
    /// the human-readable state, not the source of truth.
    private var premiumSection: some View {
        WVGroup {
            WVRow(
                icon: "sparkles",
                iconColor: WVColor.orange,
                tintedIcon: true,
                title: premium.isPremium
                    ? L.t("Premium đang hoạt động")
                    : L.t("Nâng cấp Warrly Premium"),
                subtitle: premium.isPremium
                    ? L.t("Không quảng cáo · giới hạn cao hơn")
                    : L.t("Bỏ quảng cáo · tới 200 thiết bị"),
                chevron: true
            ) {
                showPremium = true
            }
        }
    }

    // MARK: - Language section

    /// The three states the contract has, not two: `.device` is the absent
    /// `locale` (the server decides per request), and it is the only way back
    /// after a deliberate choice.
    private var languageSection: some View {
        WVGroup {
            ForEach(Array(LanguageChoice.allCases.enumerated()), id: \.element.id) { idx, option in
                if idx > 0 { WVDivider() }
                Button {
                    Task { await localization.select(option.language) }
                } label: {
                    HStack(spacing: WVSpacing.md) {
                        WVLeadingIcon(icon: "globe", color: WVColor.blue, tinted: true)
                        Text(option.label)
                            .wvFont(.body)
                            .foregroundStyle(WVColor.label)
                        Spacer(minLength: WVSpacing.sm)
                        if localization.isSaving && selectedChoice == option {
                            ProgressView().scaleEffect(0.8)
                        } else if selectedChoice == option {
                            // Position already says "selected"; the tick is
                            // label, not coral (§5.1).
                            WVIcon("check", size: 14, weight: .semibold)
                                .foregroundStyle(WVColor.label)
                        }
                    }
                    .padding(.horizontal, WVSpacing.gutter)
                    .frame(minHeight: 44)
                    .padding(.vertical, WVSpacing.sm)
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
            HStack(spacing: WVSpacing.md) {
                WVLeadingIcon(icon: "sparkles", color: WVColor.purple, tinted: true)
                VStack(alignment: .leading, spacing: 1) {
                    Text(L.t("Quét hoá đơn, thẻ bảo hành & đánh giá bảo hành"))
                        .wvFont(.body)
                        .foregroundStyle(WVColor.label)
                    Text(aiOptIn
                         ? L.t("Đang bật — ảnh/PDF được gửi tới Anthropic (dịch vụ AI ở Mỹ)")
                         : L.t("Đang tắt — không gửi gì tới dịch vụ AI"))
                        .wvFont(.footnote)
                        .foregroundStyle(WVColor.label3)
                }
                Spacer(minLength: WVSpacing.sm)
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
            .padding(.horizontal, WVSpacing.gutter)
            .frame(minHeight: 44)
            .padding(.vertical, WVSpacing.sm)
        }
    }

    private func setAIOptIn(_ enabled: Bool) {
        // The switch reads `aiOptIn` through a computed binding, so the old
        // value is still the state here. Capturing it is what makes the
        // rollback correct even if this is ever called with a non-toggle value.
        let previous = aiOptIn
        aiBusy = true
        Task {
            defer { aiBusy = false }
            do {
                let v = try await client.setAIOptIn(enabled)
                aiOptIn = v
            } catch let APIError.server(_, envelope) {
                // Revert and SAY SO. A toggle that silently springs back is
                // indistinguishable from a broken switch.
                aiOptIn = previous
                aiError = envelope.message
                    ?? envelope.fieldErrors?.values.first?.first
                    ?? L.t("Không kết nối được máy chủ.")
            } catch {
                aiOptIn = previous
                aiError = L.t("Không kết nối được máy chủ.")
            }
        }
    }

    // MARK: - Reminder email fallback

    /// The account's stored opt-in. A missing key (older server) and a
    /// signed-out state both read as OFF: permission to email is never
    /// inferred from absence.
    private var reminderEmailFallbackOn: Bool {
        if case let .authenticated(u) = auth.status {
            return u.reminderEmailFallback ?? false
        }
        return false
    }

    /// The address the fallback would mail. It is the account email, which the
    /// user cannot change from this screen, so printing it in the footer is the
    /// whole recipient disclosure.
    private var accountEmail: String {
        if case let .authenticated(u) = auth.status { return u.email }
        return ""
    }

    /// Persists the reminder email fallback opt-in (#8).
    ///
    /// Deliberately no optimistic local value: the switch's binding reads the
    /// ACCOUNT's flag and `AuthStore` adopts the user returned by the PATCH, so
    /// only a successful save moves it. A failure (network, 401, a server that
    /// predates the field) leaves the switch on the value the account really
    /// holds and raises the server's message — never a silent spring-back.
    private func setReminderEmailFallback(_ enabled: Bool) {
        guard !reminderEmailFallbackBusy else { return }
        reminderEmailFallbackBusy = true
        Task {
            defer { reminderEmailFallbackBusy = false }
            do {
                try await auth.updateReminderEmailFallback(enabled)
            } catch let APIError.server(_, envelope) {
                reminderEmailFallbackError = envelope.message
                    ?? envelope.fieldErrors?.values.first?.first
                    ?? L.t("Không kết nối được máy chủ.")
            } catch {
                reminderEmailFallbackError = L.t("Không kết nối được máy chủ.")
            }
        }
    }

    // MARK: - Sessions section

    private var sessionsSection: some View {
        WVGroup {
            WVRow(icon: "shieldCheck",
                  iconColor: WVColor.green,
                  tintedIcon: true,
                  title: L.t("Phiên đăng nhập"),
                  subtitle: L.t("Xem và thu hồi các phiên đang hoạt động"),
                  chevron: true) {
                showSessions = true
            }
        }
    }

    // MARK: - Theme (3-way picker)

    private var themeSection: some View {
        WVGroup {
            ForEach(Array(ThemePreference.allCases.enumerated()), id: \.element.id) { idx, option in
                if idx > 0 { WVDivider() }
                Button {
                    theme.preference = option
                } label: {
                    HStack(spacing: WVSpacing.md) {
                        WVLeadingIcon(
                            icon: option == .dark ? "moon" : option == .light ? "sun" : "settings",
                            color: option == .dark ? WVColor.indigo : option == .light ? WVColor.orange : WVColor.gray,
                            tinted: true
                        )
                        Text(option.label)
                            .wvFont(.body)
                            .foregroundStyle(WVColor.label)
                        Spacer(minLength: WVSpacing.sm)
                        if theme.preference == option {
                            WVIcon("check", size: 14, weight: .semibold)
                                .foregroundStyle(WVColor.label)
                        }
                    }
                    .padding(.horizontal, WVSpacing.gutter)
                    .frame(minHeight: 44)
                    .padding(.vertical, WVSpacing.sm)
                    .contentShape(Rectangle())
                }
                .buttonStyle(WVRowButtonStyle())
            }
        }
    }

    // MARK: - Notifications

    private var notificationsSection: some View {
        WVGroup {
            // Push status row. The label names the SUBJECT; the trailing chip
            // carries the state ("Chưa bật"), so the row reads "Thông báo:
            // chưa bật" in the label-value grammar every other row on this
            // screen uses. It used to be titled with the action verb ("Bật
            // thông báo"), identical to the row directly below it, so the
            // status line and the one control that enables notifications
            // looked the same and only one of them did anything. A row with a
            // verb is a row that acts; this one does not.
            HStack(spacing: WVSpacing.md) {
                WVLeadingIcon(icon: "bell", color: WVColor.red, tinted: true)
                Text(L.t("Thông báo"))
                    .wvFont(.body)
                    .foregroundStyle(WVColor.label)
                Spacer(minLength: WVSpacing.sm)
                pushStatusBadge
            }
            .padding(.horizontal, WVSpacing.gutter)
            .frame(minHeight: 44)
            .padding(.vertical, WVSpacing.sm)

            WVDivider()

            // The recovery control. Its title and subtitle are derived from the
            // system's answer, not from the registration lifecycle: authorised,
            // denied and not-determined each say what is true and what this tap
            // will do. Only `.denied` leaves the app for iOS Settings, because
            // only that state cannot be fixed from here — the system prompt is
            // never shown twice. The row used to say "Mở Cài đặt iOS để bật" in
            // every state and call `requestAndRegister`, which returns
            // immediately when denied: the one advertised way back did nothing.
            WVRow(icon: pushRowIcon,
                  iconColor: push.permission == .denied ? WVColor.orange : WVColor.red,
                  tintedIcon: true,
                  title: pushRowTitle,
                  subtitle: pushRowSubtitle,
                  subtitleLineLimit: 4,
                  chevron: true) {
                switch push.permission {
                case .denied:
                    push.openSystemSettings()
                default:
                    Task { await push.requestAndRegister() }
                }
            }
            .disabled(pushButtonDisabled)

            WVDivider()

            // Devices list
            WVRow(icon: "smartphone",
                  iconColor: WVColor.teal,
                  tintedIcon: true,
                  title: L.t("Nơi nhận thông báo"),
                  subtitle: L.t("Xem máy nào đang nhận thông báo"),
                  chevron: true) {
                showPushDevices = true
            }

            WVDivider()

            // Reminder lead time.
            //
            // This row used to say the schedule was fixed server-side at 7 and
            // 30 days because the API had no field to customise. It does now:
            // `leadDays` lives on each Device and Subscription, so the schedule
            // is edited in that item's form, not globally. The row therefore
            // points at the per-item editor instead of stating a fixed
            // schedule; it stays non-interactive (no chevron, no action)
            // because there is no global value to change here.
            WVRow(icon: "clock",
                  iconColor: WVColor.orange,
                  tintedIcon: true,
                  title: L.t("Nhắc trước"),
                  subtitle: L.t("Theo từng thiết bị / gói"),
                  detail: L.t("Tuỳ chỉnh"))

            WVDivider()

            // Reminder email fallback (#8) — the fallback for exactly the case
            // the rows above cannot fix: a push subscription that was
            // registered once and now dies silently (APNs 410, FCM error, a
            // revoked browser permission), so the deadline passes unseen.
            //
            // The switch is off until the account opts in. Its copy is in the
            // section footer below the group, together with the address the
            // mail would go to; this row carries only the state so the
            // disclosure is not truncated to two lines on a small phone.
            HStack(spacing: WVSpacing.md) {
                WVLeadingIcon(icon: "mail", color: WVColor.blue, tinted: true)
                VStack(alignment: .leading, spacing: 1) {
                    Text(L.t("Email nhắc hạn"))
                        .wvFont(.body)
                        .foregroundStyle(WVColor.label)
                    Text(reminderEmailFallbackOn ? L.t("Đang bật") : L.t("Đang tắt"))
                        .wvFont(.footnote)
                        .foregroundStyle(WVColor.label3)
                }
                Spacer(minLength: WVSpacing.sm)
                if reminderEmailFallbackBusy {
                    ProgressView()
                } else {
                    Toggle("", isOn: Binding(
                        get: { reminderEmailFallbackOn },
                        set: { newValue in setReminderEmailFallback(newValue) }
                    ))
                    .labelsHidden()
                }
            }
            .padding(.horizontal, WVSpacing.gutter)
            .frame(minHeight: 44)
            .padding(.vertical, WVSpacing.sm)
        }
    }

    // MARK: - Data section

    private var dataSection: some View {
        WVGroup {
            WVRow(icon: "download",
                  iconColor: WVColor.blue,
                  tintedIcon: true,
                  title: backupBusy ? L.t("Đang xử lý…") : L.t("Sao lưu (xuất JSON)"),
                  subtitle: L.t("Tải toàn bộ dữ liệu về file JSON"),
                  chevron: true) {
                guard !backupBusy else { return }
                exportBackup()
            }
            WVDivider()
            WVRow(icon: "upload",
                  iconColor: WVColor.blue,
                  tintedIcon: true,
                  title: L.t("Khôi phục từ sao lưu"),
                  subtitle: L.t("Nạp lại dữ liệu từ file sao lưu"),
                  chevron: true) {
                guard !backupBusy else { return }
                showImporter = true
            }
            WVDivider()

            // An account-wide document, not a per-device screen: the insurer
            // asks for the household's schedule, and this is where the other
            // "take my data out" controls live. The title names the language
            // and the subtitle says why, so the Vietnamese PDF does not read
            // as a localization bug.
            //
            // Two-line title: `WVRow` keeps every title to one line, and the
            // trailing chevron then cut this one to "(tiếng V…" (§8.7). The
            // row is local because the fix (a title that may wrap) is not a
            // parameter `WVRow` exposes, and shared components are off limits
            // during step 1 (§10.2).
            InsurancePackRow {
                showInsurancePack = true
            }
        }
    }

    // MARK: - Privacy options

    /// The one way back into UMP's privacy options form after the consent form
    /// has been answered. Lives next to the data/info sections because it is
    /// about what leaves the device (ad personalisation), not about appearance.
    ///
    /// The row is only ever built when
    /// `privacyOptionsRequirement == .required` (see the conditional in
    /// `body`); the button also re-checks it live, so a stale view cannot
    /// present a form Google says does not exist.
    private var privacySection: some View {
        WVGroup {
            WVRow(icon: "lock",
                  iconColor: WVColor.indigo,
                  tintedIcon: true,
                  title: L.t("Tuỳ chọn quyền riêng tư"),
                  subtitle: L.t("Đổi cách quảng cáo được cá nhân hoá hoặc rút lại sự đồng ý."),
                  subtitleLineLimit: 4,
                  chevron: true) {
                ads.presentPrivacyOptionsForm()
            }
        }
    }

    // MARK: - Info section

    /// The legal pages on the production site. These are the exact paths the
    /// Next.js app serves under `website/src/app/(public)/` — `privacy` and
    /// `terms` — so the rows open the same documents the web footer links to
    /// instead of being dead rows.
    private enum PublicPage: String {
        case privacy
        case terms

        var url: URL? { URL(string: "https://warrly.com/\(rawValue)") }
    }

    private func open(_ page: PublicPage) {
        guard let url = page.url else { return }
        UIApplication.shared.open(url)
    }

    private var infoSection: some View {
        WVGroup {
            WVRow(icon: "info",
                  iconColor: WVColor.gray,
                  tintedIcon: true,
                  title: L.t("Phiên bản"), detail: appVersion)
            WVDivider()
            WVRow(icon: "shield",
                  iconColor: WVColor.green,
                  tintedIcon: true,
                  title: L.t("Chính sách bảo mật"), chevron: true) {
                open(.privacy)
            }
            WVDivider()
            WVRow(icon: "receipt",
                  iconColor: WVColor.gray,
                  tintedIcon: true,
                  title: L.t("Điều khoản sử dụng"), chevron: true) {
                open(.terms)
            }
        }
    }

    // MARK: - Push helpers

    @ViewBuilder
    private var pushStatusBadge: some View {
        // The system answer wins over the registration state: a device that was
        // registered and later denied in iOS Settings is "off" now, whatever
        // the last upload did.
        if push.permission == .denied {
            WVChip(L.t("Đã tắt"), tone: .red)
        } else {
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
    }

    /// The three answers, in the order the user meets them.
    ///
    /// - authorised: reminders are on; the row can only re-register.
    /// - denied: only iOS Settings can change it — the row says so and goes
    ///   there.
    /// - not determined: the prompt has never been answered, so the row can
    ///   still ask.
    private var pushRowTitle: String {
        // Transient states win: a request or registration is what the row is
        // doing right now, whatever the last read said.
        switch push.status {
        case .registering:      return L.t("Đang đăng ký…")
        case .requesting:       return L.t("Đang xin quyền…")
        case .failed(let m):    return L.t("Thử lại — %@", m)
        default:                break
        }
        // The system answer decides the recovery affordance. Only `.denied`
        // leaves the app, because only that state cannot be fixed from here.
        if push.permission == .denied { return L.t("Mở Cài đặt iOS") }
        if push.permission == .notDetermined { return L.t("Bật thông báo") }
        // Authorised: the only action left is to register again. `.denied` here
        // would mean the status is stale before the first read; the button's
        // action still re-registers rather than leaving the app, so the label
        // must not promise Settings.
        if push.status == .unknown { return L.t("Bật thông báo") }
        return L.t("Đăng ký lại token")
    }

    /// One honest line per answer. The subtitle is the sentence that was
    /// missing: "denied" now says reminders cannot arrive, and "authorised"
    /// says what the app will actually do rather than only that a permission
    /// exists.
    private var pushRowSubtitle: String? {
        switch push.permission {
        case .denied:
            return L.t("Thông báo đang tắt — Warrly không thể nhắc bạn cho tới khi bạn bật lại trong Cài đặt iOS.")
        case .authorized:
            switch push.status {
            case .registered:
                return L.t("Đã bật — Warrly sẽ nhắc bạn trước khi hết hạn.")
            case .failed:
                return L.t("Đã bật nhưng chưa đăng ký được thiết bị nhận thông báo. Chạm để thử lại.")
            default:
                return nil
            }
        case .notDetermined:
            return L.t("Chưa bật — chạm để nhận nhắc trước khi hết hạn.")
        case .none:
            return nil
        }
    }

    private var pushRowIcon: String {
        switch push.permission {
        case .denied:        return "settings"
        case .notDetermined: return "bell"
        case .authorized:    return "refresh"
        case .none:          return "refresh"
        }
    }

    private var pushButtonDisabled: Bool {
        switch push.status {
        case .registering, .requesting: return true
        default: return false
        }
    }

    private var appVersion: String {
        let v = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "—"
        let b = Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? ""
        return b.isEmpty ? v : "\(v) (\(b))"
    }
}

// MARK: - AI consent disclosure

/// The AI opt-in disclosure: a lead sentence, the three things the assistant
/// does, then the retention and privacy paragraphs.
///
/// It used to be a single `WVSectionFooter` of ~600 characters — one block that
/// hid the three facts the consent actually turns on (what is sent, where it
/// goes, what it does). The split matches the web
/// (`website/src/components/ai-settings.tsx`) so both clients state the same
/// claims in the same order. This is a privacy statement: do not shorten or
/// soften it on one client alone.
private struct AIConsentFooter: View {
    var body: some View {
        VStack(alignment: .leading, spacing: WVSpacing.sm) {
            Text(L.t("Khi bật, trợ lý AI làm ba việc:"))

            // `HStack` keeps the number in its own column, so a wrapped item
            // stays aligned under the sentence instead of under the number
            // (the web renders the same list as an `<ol>`).
            numberedItem(1, L.t("Đọc ảnh/PDF hoá đơn hoặc thẻ bảo hành để tự điền thông tin. File đã giải mã được gửi tới Anthropic, dịch vụ AI ở Mỹ (ngoài Việt Nam)."))
            numberedItem(2, L.t("Đọc chín điều khoản hợp đồng từ thẻ bảo hành."))
            numberedItem(3, L.t("Đánh giá một lần sửa chữa có thuộc diện bảo hành không và soạn đơn gửi trung tâm. Nội dung phiếu sửa chữa, thông tin thiết bị và điều khoản hợp đồng cũng được gửi tới Anthropic."))

            Text(L.t("Anthropic tự động xoá đầu vào/đầu ra trong vòng 30 ngày (trừ khi pháp luật hoặc chính sách của họ yêu cầu giữ lâu hơn) và mặc định không dùng dữ liệu API để huấn luyện."))
            Text(L.t("Phía Warrly, ảnh/PDF vẫn được mã hoá; chỉ văn bản đọc được lưu dạng plaintext trong cơ sở dữ liệu để tìm kiếm."))
            Text(L.t("Mọi kết quả chỉ là gợi ý hoặc bản nháp để bạn kiểm tra lại, không phải quyết định. Mặc định tắt."))
        }
        // Same type role and colour as every other `WVSectionFooter`, so the
        // disclosure still reads as an explanation of the row above it.
        .wvFont(.footnote)
        .foregroundStyle(WVColor.label3)
        .fixedSize(horizontal: false, vertical: true)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, WVSpacing.gutter)
        .padding(.top, WVSpacing.sm)
    }

    private func numberedItem(_ number: Int, _ text: String) -> some View {
        HStack(alignment: .top, spacing: WVSpacing.sm) {
            Text("\(number).")
                .monospacedDigit()
            Text(text)
                .fixedSize(horizontal: false, vertical: true)
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Insurance-pack row

/// "Bảng kê cho bảo hiểm (tiếng Việt)" — the one row on Cài đặt whose title is
/// too long for the shared one-line OS row.
///
/// `WVRow` hard-codes `lineLimit(1)` on its title and gives the trailing
/// chevron the remaining width, so this title rendered as
/// `Bảng kê cho bảo hiểm (tiếng V…` plus a truncated subtitle (§8.7). The title
/// is the thing a row must never lose, so this row allows it two lines and
/// keeps the subtitle at the one-line `meta` it already was. `WVRowContainer`
/// supplies the exact row padding, minimum height and tap highlight of
/// `WVRow`; nothing else about the row changes — same icon, same typography,
/// same action.
///
/// A shared `WVRow.titleLineLimit` would be the durable fix, but shared
/// components are frozen during step 1 (§10.2); this row is reported instead.
private struct InsurancePackRow: View {
    let action: () -> Void

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        WVRowContainer(action: action) {
            HStack(spacing: WVSpacing.md) {
                WVLeadingIcon(icon: "shieldCheck", color: WVColor.teal, tinted: true)
                VStack(alignment: .leading, spacing: 1) {
                    Text(L.t("Bảng kê cho bảo hiểm (tiếng Việt)"))
                        .wvFont(.body)
                        .foregroundStyle(WVColor.label)
                        // Two lines at the default size; unlimited at
                        // Accessibility sizes so the title never clips (§10.3).
                        .lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : 2)
                        .fixedSize(horizontal: false, vertical: true)
                    Text(L.t("PDF · luôn ở tiếng Việt cho công ty bảo hiểm"))
                        .wvFont(.footnote)
                        .foregroundStyle(WVColor.label3)
                        .lineLimit(dynamicTypeSize.isAccessibilitySize ? 3 : 1)
                }
                .layoutPriority(1)
                Spacer(minLength: WVSpacing.sm)
                WVIcon("arrowRight", size: 13, weight: .semibold)
                    .foregroundStyle(WVColor.label4)
            }
        }
    }
}
