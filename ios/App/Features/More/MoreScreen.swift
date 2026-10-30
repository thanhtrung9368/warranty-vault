import SwiftUI
import UniformTypeIdentifiers
import WarrlyKit

// ============================================================
// MoreScreen — landing tab for Nhắc nhở, Thống kê, Cài đặt,
// Hồ sơ, and other utilities. Matches `MoreScreen` in screens-3.jsx.
// ============================================================

struct MoreScreen: View {
    let client: APIClient

    @EnvironmentObject private var auth: AuthStore
    /// Owned by `MainTabView` so the tab badge and this row can never disagree.
    @EnvironmentObject private var inbox: InboxStore
    @StateObject private var remindersStore: RemindersStore

    // CSV export of the user's devices — built in WarrlyKit
    // (`DeviceCSVExport`) and written through the app's shared `.fileExporter`.
    @State private var exportDoc: ExportFileDocument?
    @State private var showExporter = false
    @State private var fileBusy = false
    @State private var fileMessage: String?
    // Trigger for the shared JSON-backup importer (see `BackupImportFlow`).
    @State private var showImporter = false

    init(client: APIClient) {
        self.client = client
        _remindersStore = StateObject(wrappedValue: RemindersStore(client: client))
    }

    // Count of active reminders (within 90 days, not in the past beyond 14 days)
    private var reminderBadge: Int {
        remindersStore.entries.filter { r in
            r.daysRemaining >= -14 && r.daysRemaining <= 90
        }.count
    }

    private var userEmail: String {
        if case let .authenticated(u) = auth.status { return u.email }
        return ""
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                Spacer().frame(height: 8)

                // MARK: Main actions — Tìm kiếm / Hộp thư đến / Nhắc nhở / Thống kê
                moreActionsSection

                WVSectionHeader(L.t("Tài khoản"))
                accountSection

                WVSectionHeader(L.t("Ứng dụng"))
                appSection

                Spacer().frame(height: 16)

                // Logout button
                WVGroup {
                    WVRow(title: L.t("Đăng xuất"), role: .tint) {
                        Task { await auth.logout() }
                    }
                }

                Spacer().frame(height: 8)
                Text("Warrly iOS · v1.0.0")
                    .wvFont(.caption)
                    .foregroundStyle(WVColor.label3)
                    .padding(.vertical, 20)
            }
        }
        .wvScreen()
        .navigationTitle(L.t("Thêm"))
        .navigationBarTitleDisplayMode(.large)
        .task {
            // Refresh both badges on every visit: a receipt filed from another
            // client must not leave a stale number sitting on this row.
            await remindersStore.load()
            await inbox.load()
        }
        .backupImportFlow(
            client: client,
            isPresented: $showImporter,
            isBusy: $fileBusy,
            message: $fileMessage
        )
        .fileExporter(
            isPresented: $showExporter,
            document: exportDoc,
            contentType: .commaSeparatedText,
            defaultFilename: "warrly-thiet-bi"
        ) { result in
            if case .failure = result { fileMessage = L.t("Không lưu được file CSV.") }
        }
        .alert(L.t("Dữ liệu"), isPresented: Binding(
            get: { fileMessage != nil },
            set: { if !$0 { fileMessage = nil } }
        )) {
            Button("OK", role: .cancel) { fileMessage = nil }
        } message: {
            Text(fileMessage ?? "")
        }
    }

    // MARK: - CSV export

    /// Reads the device list and hands it to the pure CSV builder, then opens
    /// the system save sheet. Nothing is uploaded; the file is written wherever
    /// the user picks (Files / iCloud Drive / AirDrop).
    private func exportDevicesCSV() {
        fileBusy = true
        Task {
            defer { fileBusy = false }
            do {
                let devices = try await client.listDevices()
                exportDoc = ExportFileDocument(data: DeviceCSVExport.data(for: devices))
                showExporter = true
            } catch {
                fileMessage = L.t("Không xuất được dữ liệu. Kiểm tra kết nối và thử lại.")
            }
        }
    }

    // MARK: - Sections

    private var moreActionsSection: some View {
        VStack(spacing: 0) {
            WVGroup {
                // Cross-entity search. Same screen as the magnifier in the
                // Tổng quan toolbar; this row is the way in from the "Thêm" tab.
                NavigationLink {
                    SearchScreen(client: client)
                } label: {
                    HStack(spacing: 12) {
                        WVLeadingIcon(icon: "search", color: WVColor.indigo)
                        Text(L.t("Tìm kiếm"))
                            .wvFont(.body)
                            .foregroundStyle(WVColor.label)
                        Spacer(minLength: 8)
                        WVIcon("arrowRight", size: 13, weight: .semibold)
                            .foregroundStyle(WVColor.label4)
                    }
                    .padding(.horizontal, 16)
                    .frame(minHeight: 44)
                    .padding(.vertical, 7)
                    .contentShape(Rectangle())
                }
                .buttonStyle(WVRowButtonStyle())

                WVDivider(inset: 60)

                // Capture-first inbox. Placed in the same actions group as
                // Nhắc nhở because this is the existing "row + count badge"
                // navigation pattern — the badge is the number of receipts
                // waiting to be filed, not a device's attachment count.
                NavigationLink {
                    InboxScreen(client: client)
                } label: {
                    HStack(spacing: 12) {
                        WVLeadingIcon(icon: "receipt", color: WVColor.orange)
                        Text(L.t("Hộp thư đến"))
                            .wvFont(.body)
                            .foregroundStyle(WVColor.label)
                        Spacer(minLength: 8)
                        if let badgeText = inbox.badgeText {
                            MoreBadge(text: badgeText)
                        }
                        WVIcon("arrowRight", size: 13, weight: .semibold)
                            .foregroundStyle(WVColor.label4)
                    }
                    .padding(.horizontal, 16)
                    .frame(minHeight: 44)
                    .padding(.vertical, 7)
                    .contentShape(Rectangle())
                }
                .buttonStyle(WVRowButtonStyle())

                WVDivider(inset: 60)

                NavigationLink {
                    RemindersView(client: client)
                        .navigationTitle(L.t("Nhắc nhở"))
                        .navigationBarTitleDisplayMode(.inline)
                } label: {
                    HStack(spacing: 12) {
                        WVLeadingIcon(icon: "bell", color: WVColor.red)
                        Text(L.t("Nhắc nhở"))
                            .wvFont(.body)
                            .foregroundStyle(WVColor.label)
                        Spacer(minLength: 8)
                        if reminderBadge > 0 {
                            MoreBadge(count: reminderBadge)
                        }
                        WVIcon("arrowRight", size: 13, weight: .semibold)
                            .foregroundStyle(WVColor.label4)
                    }
                    .padding(.horizontal, 16)
                    .frame(minHeight: 44)
                    .padding(.vertical, 7)
                    .contentShape(Rectangle())
                }
                .buttonStyle(WVRowButtonStyle())

                WVDivider(inset: 60)

                NavigationLink {
                    StatsView(client: client)
                        .navigationTitle(L.t("Thống kê"))
                        .navigationBarTitleDisplayMode(.inline)
                } label: {
                    HStack(spacing: 12) {
                        WVLeadingIcon(icon: "chart", color: WVColor.indigo)
                        Text(L.t("Thống kê"))
                            .wvFont(.body)
                            .foregroundStyle(WVColor.label)
                        Spacer(minLength: 8)
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
    }

    private var accountSection: some View {
        WVGroup {
            NavigationLink {
                AccountView(client: client)
                    .navigationTitle(L.t("Hồ sơ"))
                    .navigationBarTitleDisplayMode(.inline)
            } label: {
                HStack(spacing: 12) {
                    WVLeadingIcon(icon: "user", color: WVColor.blue)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(L.t("Hồ sơ"))
                            .wvFont(.body)
                            .foregroundStyle(WVColor.label)
                        if !userEmail.isEmpty {
                            Text(userEmail)
                                .wvFont(.footnote)
                                .foregroundStyle(WVColor.label3)
                        }
                    }
                    Spacer(minLength: 8)
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

    private var appSection: some View {
        WVGroup {
            NavigationLink {
                SettingsView(client: client)
                    .navigationTitle(L.t("Cài đặt"))
                    .navigationBarTitleDisplayMode(.inline)
            } label: {
                HStack(spacing: 12) {
                    WVLeadingIcon(icon: "settings", color: WVColor.gray)
                    Text(L.t("Cài đặt"))
                        .wvFont(.body)
                        .foregroundStyle(WVColor.label)
                    Spacer(minLength: 8)
                    WVIcon("arrowRight", size: 13, weight: .semibold)
                        .foregroundStyle(WVColor.label4)
                }
                .padding(.horizontal, 16)
                .frame(minHeight: 44)
                .padding(.vertical, 7)
                .contentShape(Rectangle())
            }
            .buttonStyle(WVRowButtonStyle())

            WVDivider(inset: 60)

            WVRow(icon: "download", iconColor: WVColor.green,
                  title: fileBusy ? L.t("Đang xử lý…") : L.t("Xuất dữ liệu CSV"), chevron: true) {
                guard !fileBusy else { return }
                exportDevicesCSV()
            }

            WVDivider(inset: 60)

            // Same importer as Cài đặt → "Khôi phục từ sao lưu"; this row is a
            // shortcut into that one flow, not a second implementation.
            WVRow(icon: "upload", iconColor: WVColor.orange,
                  title: fileBusy ? L.t("Đang xử lý…") : L.t("Import từ file"), chevron: true) {
                guard !fileBusy else { return }
                showImporter = true
            }
        }
    }
}

// MARK: - Badge component

private struct MoreBadge: View {
    let text: String

    init(text: String) { self.text = text }
    init(count: Int) { self.text = "\(count)" }

    var body: some View {
        Text(text)
            .wvFont(.captionEmphasis)
            .foregroundStyle(.white)
            .padding(.horizontal, 8)
            .frame(height: 22)
            .background(WVColor.red)
            .clipShape(Capsule())
    }
}
