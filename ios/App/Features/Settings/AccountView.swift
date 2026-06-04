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
                WVButton("Yêu cầu xoá tài khoản",
                         kind: .destructiveGhost) {
                    showDeleteAlert = true
                }
                .padding(.horizontal, WVSpacing.gutter)

                Spacer().frame(height: 24)
            }
        }
        .wvScreen()
        .sheet(isPresented: $showChangePassword) {
            ChangePasswordSheet(client: client)
        }
        .alert("Xoá tài khoản?", isPresented: $showDeleteAlert) {
            Button("Huỷ", role: .cancel) {}
            Button("Xoá", role: .destructive) {
                // In a real implementation, call the API
            }
        } message: {
            Text("Toàn bộ dữ liệu sẽ bị xoá vĩnh viễn. Thao tác này không thể hoàn tác.")
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
