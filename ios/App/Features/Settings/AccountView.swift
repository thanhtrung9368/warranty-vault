import SwiftUI
import WarrantyVaultKit

// ============================================================
// AccountView — Hồ sơ (profile). Port of AccountScreen in screens-3.jsx.
// ============================================================

struct AccountView: View {
    let client: APIClient

    @EnvironmentObject private var auth: AuthStore
    @State private var showChangePassword = false
    @State private var showDeleteAlert = false
    @State private var isDeleting = false
    @State private var deletePassword = ""
    @State private var deleteError: String?

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                // Avatar + name header
                avatarHeader
                    .padding(.top, 8)

                // Info section (read-only for now)
                WVSectionHeader("Thông tin")
                WVGroup {
                    // Display name
                    HStack(spacing: 16) {
                        Text("Tên hiển thị")
                            .font(.system(size: 17))
                            .foregroundStyle(WVColor.label)
                        Spacer()
                        Text(userName)
                            .font(.system(size: 17))
                            .foregroundStyle(WVColor.label3)
                            .lineLimit(1)
                    }
                    .padding(.horizontal, 16)
                    .frame(minHeight: 44)

                    WVDivider(inset: 16)

                    // Email
                    HStack(spacing: 16) {
                        Text("Email")
                            .font(.system(size: 17))
                            .foregroundStyle(WVColor.label)
                        Spacer()
                        Text(userEmail)
                            .font(.system(size: 17))
                            .foregroundStyle(WVColor.label3)
                            .lineLimit(1)
                            .truncationMode(.middle)
                    }
                    .padding(.horizontal, 16)
                    .frame(minHeight: 44)
                }

                // Password section
                WVSectionHeader("Mật khẩu")
                WVGroup {
                    WVRow(icon: "key", iconColor: WVColor.orange,
                          title: "Đổi mật khẩu", chevron: true) {
                        showChangePassword = true
                    }
                    WVDivider(inset: 60)
                    WVRow(icon: "lock", iconColor: WVColor.purple,
                          title: "Face ID & Touch ID", chevron: true)
                }

                // Linked accounts section
                WVSectionHeader("Liên kết")
                WVGroup {
                    WVRow(icon: "mail", iconColor: WVColor.red,
                          title: "Apple ID", detail: "Liên kết")
                    WVDivider(inset: 60)
                    WVRow(icon: "users", iconColor: WVColor.blue,
                          title: "Google", detail: "Chưa")
                }

                // Delete account
                Spacer().frame(height: 20)
                WVButton(isDeleting ? "Đang xoá…" : "Yêu cầu xoá tài khoản",
                         kind: .destructiveGhost) {
                    deletePassword = ""
                    showDeleteAlert = true
                }
                .disabled(isDeleting)
                .padding(.horizontal, WVSpacing.gutter)

                Spacer().frame(height: 24)
            }
        }
        .wvScreen()
        .sheet(isPresented: $showChangePassword) {
            ChangePasswordSheet(client: client)
        }
        .alert("Xoá tài khoản?", isPresented: $showDeleteAlert) {
            SecureField("Mật khẩu hiện tại", text: $deletePassword)
            Button("Huỷ", role: .cancel) { deletePassword = "" }
            Button("Xoá vĩnh viễn", role: .destructive) { performDelete() }
        } message: {
            Text("Nhập mật khẩu để xác nhận. Toàn bộ thiết bị, hoá đơn, ảnh BH và cài đặt sẽ bị xoá vĩnh viễn — không thể hoàn tác.")
        }
        .alert("Không xoá được", isPresented: Binding(
            get: { deleteError != nil },
            set: { if !$0 { deleteError = nil } }
        )) {
            Button("OK", role: .cancel) { deleteError = nil }
        } message: {
            Text(deleteError ?? "")
        }
    }

    private func performDelete() {
        let pw = deletePassword
        deletePassword = ""
        guard !pw.isEmpty else {
            deleteError = "Nhập mật khẩu để xác nhận."
            return
        }
        isDeleting = true
        Task {
            defer { isDeleting = false }
            do {
                // On success auth.status flips to .unauthenticated and RootView
                // swaps to the login screen automatically.
                try await auth.deleteAccount(password: pw)
            } catch let APIError.server(_, envelope) {
                deleteError = envelope.message
                    ?? envelope.fieldErrors?.values.first?.first
                    ?? "Mật khẩu không đúng hoặc lỗi máy chủ."
            } catch {
                deleteError = "Không kết nối được máy chủ."
            }
        }
    }

    // MARK: - Avatar header

    private var avatarHeader: some View {
        VStack(spacing: 10) {
            // Initials avatar
            Circle()
                .fill(WVColor.brand)
                .frame(width: 86, height: 86)
                .overlay(
                    Text(initials)
                        .font(.system(size: 36, weight: .bold))
                        .foregroundStyle(.white)
                )

            Text(userName)
                .font(.system(size: 22, weight: .bold))
                .foregroundStyle(WVColor.label)

            Text(userEmail)
                .font(.system(size: 14))
                .foregroundStyle(WVColor.label3)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 24)
    }

    // MARK: - Helpers

    private var userName: String {
        if case let .authenticated(u) = auth.status {
            return u.name ?? u.email
        }
        return "–"
    }

    private var userEmail: String {
        if case let .authenticated(u) = auth.status { return u.email }
        return "–"
    }

    private var initials: String {
        let name = userName
        let parts = name.split(separator: " ")
        let chars = parts.prefix(2).compactMap { $0.first }
        let s = String(chars).uppercased()
        return s.isEmpty ? "?" : s
    }
}
