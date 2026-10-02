import SwiftUI
import UniformTypeIdentifiers
import WarrantyVaultKit

// ============================================================
// MoreScreen — landing tab for Nhắc nhở, Thống kê, Cài đặt,
// Hồ sơ, and other utilities. Matches `MoreScreen` in screens-3.jsx.
// ============================================================

struct MoreScreen: View {
    let client: APIClient

    @EnvironmentObject private var auth: AuthStore
    @StateObject private var remindersStore: RemindersStore

    // CSV export of the user's devices — built in WarrantyVaultKit
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

                // MARK: Main actions — Nhắc nhở / Thống kê / Báo cáo
                moreActionsSection

                WVSectionHeader("Tài khoản")
                accountSection

                WVSectionHeader("Ứng dụng")
                appSection

                WVSectionHeader("Trợ giúp")
                helpSection

                Spacer().frame(height: 16)

                // Logout button
                WVGroup {
                    WVRow(title: "Đăng xuất", role: .tint) {
                        Task { await auth.logout() }
                    }
                }

                Spacer().frame(height: 8)
                Text("WarrantyVault iOS · v1.0.0")
                    .font(.system(size: 12))
                    .foregroundStyle(WVColor.label3)
                    .padding(.vertical, 20)
            }
        }
        .wvScreen()
        .navigationTitle("Thêm")
        .navigationBarTitleDisplayMode(.large)
        .task { await remindersStore.load() }
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
            defaultFilename: "warrantyvault-thiet-bi"
        ) { result in
            if case .failure = result { fileMessage = "Không lưu được file CSV." }
        }
        .alert("Dữ liệu", isPresented: Binding(
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
                fileMessage = "Không xuất được dữ liệu. Kiểm tra kết nối và thử lại."
            }
        }
    }

    // MARK: - Sections

    private var moreActionsSection: some View {
        VStack(spacing: 0) {
            WVGroup {
                NavigationLink {
                    RemindersView(client: client)
                        .navigationTitle("Nhắc nhở")
                        .navigationBarTitleDisplayMode(.inline)
                } label: {
                    HStack(spacing: 12) {
                        WVLeadingIcon(icon: "bell", color: WVColor.red)
                        Text("Nhắc nhở")
                            .font(.system(size: 17))
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
                        .navigationTitle("Thống kê")
                        .navigationBarTitleDisplayMode(.inline)
                } label: {
                    HStack(spacing: 12) {
                        WVLeadingIcon(icon: "chart", color: WVColor.indigo)
                        Text("Thống kê")
                            .font(.system(size: 17))
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

                NavigationLink {
                    StatsView(client: client)
                        .navigationTitle("Báo cáo chi phí")
                        .navigationBarTitleDisplayMode(.inline)
                } label: {
                    HStack(spacing: 12) {
                        WVLeadingIcon(icon: "bar", color: WVColor.purple)
                        Text("Báo cáo chi phí")
                            .font(.system(size: 17))
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
                    .navigationTitle("Hồ sơ")
                    .navigationBarTitleDisplayMode(.inline)
            } label: {
                HStack(spacing: 12) {
                    WVLeadingIcon(icon: "user", color: WVColor.blue)
                    VStack(alignment: .leading, spacing: 1) {
                        Text("Hồ sơ")
                            .font(.system(size: 17))
                            .foregroundStyle(WVColor.label)
                        if !userEmail.isEmpty {
                            Text(userEmail)
                                .font(.system(size: 13))
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

            WVDivider(inset: 60)

            WVRow(icon: "lock", iconColor: WVColor.gray, title: "Bảo mật & quyền riêng tư", chevron: true)

            WVDivider(inset: 60)

            WVRow(icon: "cloud", iconColor: WVColor.teal, title: "Đồng bộ iCloud", detail: "Bật", chevron: true)
        }
    }

    private var appSection: some View {
        WVGroup {
            NavigationLink {
                SettingsView(client: client)
                    .navigationTitle("Cài đặt")
                    .navigationBarTitleDisplayMode(.inline)
            } label: {
                HStack(spacing: 12) {
                    WVLeadingIcon(icon: "settings", color: WVColor.gray)
                    Text("Cài đặt")
                        .font(.system(size: 17))
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
                  title: fileBusy ? "Đang xử lý…" : "Xuất dữ liệu CSV", chevron: true) {
                guard !fileBusy else { return }
                exportDevicesCSV()
            }

            WVDivider(inset: 60)

            // Same importer as Cài đặt → "Khôi phục từ sao lưu"; this row is a
            // shortcut into that one flow, not a second implementation.
            WVRow(icon: "upload", iconColor: WVColor.orange,
                  title: fileBusy ? "Đang xử lý…" : "Import từ file", chevron: true) {
                guard !fileBusy else { return }
                showImporter = true
            }
        }
    }

    private var helpSection: some View {
        WVGroup {
            WVRow(icon: "info", iconColor: WVColor.blue, title: "Hướng dẫn", chevron: true)

            WVDivider(inset: 60)

            WVRow(icon: "mail", iconColor: WVColor.green, title: "Liên hệ hỗ trợ", chevron: true)

            WVDivider(inset: 60)

            WVRow(icon: "heart", iconColor: WVColor.pink, title: "Đánh giá WarrantyVault ⭐️", chevron: true)
        }
    }
}

// MARK: - Badge component

private struct MoreBadge: View {
    let count: Int
    var body: some View {
        Text("\(count)")
            .font(.system(size: 12, weight: .semibold))
            .foregroundStyle(.white)
            .padding(.horizontal, 8)
            .frame(height: 22)
            .background(WVColor.red)
            .clipShape(Capsule())
    }
}
