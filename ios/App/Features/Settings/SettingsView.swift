import SwiftUI
import UIKit
import UniformTypeIdentifiers
import WarrlyKit

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

    @State private var showChangePassword = false
    @State private var showPushDevices = false
    @State private var showSessions = false

    // AI receipt-scan opt-in.
    @State private var aiOptIn = false
    @State private var aiBusy = false
    /// Server copy for a refused opt-in change. The switch used to flip back
    /// with no explanation at all; Android shows the server's message in a
    /// snackbar, and this is the same thing through the alert pattern used
    /// below for backups and the language.
    @State private var aiError: String?

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

                // Chế độ — the only appearance control.
                //
                // The old first group held a single dark-mode toggle row with
                // no switch glyph, directly above this three-way picker: two
                // controls for one value, one of them reading as a dead row
                // (§8.7, §1.12). The group and its header are gone with the
                // row; their two catalog keys are now unreferenced and belong
                // in the shared catalog cleanup (reported, not edited here —
                // `Localizable.xcstrings` is outside this screen's ownership).
                WVSectionHeader(L.t("Chế độ"))
                themeSection

                // Language. Stored on the ACCOUNT, not just on this device:
                // the server renders push notifications and email long after the
                // app is gone, so it has to know which language to use.
                WVSectionHeader(L.t("Ngôn ngữ"))
                languageSection
                WVSectionFooter(L.t("Ngôn ngữ áp dụng cho cả ứng dụng, thông báo đẩy và email."))

                // Notifications. The explanation sits below the rows it
                // explains (§8.7): one rule for every group on this screen.
                WVSectionHeader(L.t("Nhắc nhở"))
                notificationsSection
                WVSectionFooter(L.t("Mốc nhắc được đặt riêng cho từng thiết bị và gói đăng ký — mở chi tiết để chỉnh. Mặc định là 30 và 7 ngày."))

                // Sign-in sessions (who can reach the data)
                WVSectionHeader(L.t("Bảo mật"))
                sessionsSection
                WVSectionFooter(L.t("“Thiết bị đăng nhập” là các phiên còn quyền truy cập dữ liệu của bạn. Khác với “Thiết bị nhận thông báo” ở trên — xoá một đích push chỉ ngừng gửi thông báo, không thu hồi quyền truy cập."))

                // Shared AI opt-in. There is deliberately ONE switch (and one
                // `PUT /api/v1/ai/opt-in`) for both receipt scanning and claim
                // assessment: the flag is a privacy decision about sending data
                // to a third-party model, and a second toggle would let the two
                // features disagree about it. The assessment sheet points here.
                WVSectionHeader(L.t("Trợ lý AI"))
                aiSection
                WVSectionFooter(L.t("Khi bật, ảnh hoá đơn (đã giải mã) và thông tin lần sửa chữa sẽ được gửi tới dịch vụ AI bên thứ ba để tự điền thông tin hoặc đánh giá bảo hành. Bạn luôn kiểm tra lại trước khi lưu. Mặc định tắt."))

                // Data
                WVSectionHeader(L.t("Dữ liệu"))
                dataSection
                WVSectionFooter(L.t("File backup chứa dữ liệu nhạy cảm (số seri, giá mua, trung tâm BH). Lưu ở nơi an toàn."))

                // Privacy options. Deliberately conditional INCLUDING the
                // header: when UMP does not require a privacy options form
                // there must be nothing here at all — not a disabled row and
                // not an error. The pure rule (pinned by swift test) is
                // `AdsConsentOrdering.showsPrivacyOptionsEntry`.
                if AdsConsentOrdering.showsPrivacyOptionsEntry(ads.privacyOptionsRequirement) {
                    WVSectionHeader(L.t("Quyền riêng tư"))
                    privacySection
                }

                // Info
                WVSectionHeader(L.t("Thông tin"))
                infoSection

                Spacer().frame(height: WVSpacing.xl)
            }
        }
        .wvScreen()
        .sheet(isPresented: $showChangePassword) {
            ChangePasswordSheet(client: client)
        }
        .sheet(isPresented: $showInsurancePack) {
            InsurancePackSheet(client: client)
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
            // UMP's requirement can change after launch (the privacy options
            // form itself, a region/console change). Re-read it on entry so
            // the row is never left stale in either direction.
            ads.refreshPrivacyOptionsRequirement()
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
                        WVLeadingIcon(icon: "globe")
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
                WVLeadingIcon(icon: "sparkles")
                Text(L.t("Quét hoá đơn & đánh giá bảo hành"))
                    .wvFont(.body)
                    .foregroundStyle(WVColor.label)
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

    // MARK: - Sessions section

    private var sessionsSection: some View {
        WVGroup {
            WVRow(icon: "shieldCheck",
                  title: L.t("Thiết bị đăng nhập"),
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
                            icon: option == .dark ? "moon" : option == .light ? "sun" : "settings"
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
                WVLeadingIcon(icon: "bell")
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

            // Enable / re-register
            WVRow(icon: "refresh",
                  title: pushButtonLabel, chevron: true) {
                Task { await push.requestAndRegister() }
            }
            .disabled(pushButtonDisabled)

            WVDivider()

            // Devices list
            WVRow(icon: "smartphone",
                  title: L.t("Thiết bị nhận thông báo"), chevron: true) {
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
                  title: L.t("Nhắc trước"),
                  subtitle: L.t("Theo từng thiết bị / gói"),
                  detail: L.t("Tuỳ chỉnh"))
        }
    }

    // MARK: - Data section

    private var dataSection: some View {
        WVGroup {
            WVRow(icon: "download",
                  title: backupBusy ? L.t("Đang xử lý…") : L.t("Sao lưu (xuất JSON)"),
                  chevron: true) {
                guard !backupBusy else { return }
                exportBackup()
            }
            WVDivider()
            WVRow(icon: "upload",
                  title: L.t("Khôi phục từ sao lưu"), chevron: true) {
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
                  title: L.t("Phiên bản"), detail: appVersion)
            WVDivider()
            WVRow(icon: "shield",
                  title: L.t("Chính sách bảo mật"), chevron: true) {
                open(.privacy)
            }
            WVDivider()
            WVRow(icon: "receipt",
                  title: L.t("Điều khoản sử dụng"), chevron: true) {
                open(.terms)
            }
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
                WVLeadingIcon(icon: "shieldCheck")
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
