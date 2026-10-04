import SwiftUI
import WarrantyVaultKit

// ============================================================
// AccountView — Hồ sơ (profile). Port of AccountScreen in screens-3.jsx.
// ============================================================

struct AccountView: View {
    let client: APIClient

    @EnvironmentObject private var auth: AuthStore
    @EnvironmentObject private var appLock: AppLockStore
    @State private var showChangePassword = false
    @State private var showChangeEmail = false
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
                WVSectionHeader(L.t("Thông tin"))
                WVGroup {
                    // Display name
                    HStack(spacing: 16) {
                        Text(L.t("Tên hiển thị"))
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

                // Password + email + app lock.
                //
                // Email change lives here rather than in "Thông tin" because it
                // is password-gated and revokes every session: it needs the
                // current password (a stolen bearer token must not be able to
                // move the account) and the old address keeps working until the
                // mailed token is confirmed.
                WVSectionHeader(L.t("Bảo mật"))
                WVGroup {
                    WVRow(icon: "key", iconColor: WVColor.orange,
                          title: L.t("Đổi mật khẩu"), chevron: true) {
                        showChangePassword = true
                    }
                    WVDivider(inset: 60)
                    WVRow(icon: "mail", iconColor: WVColor.blue,
                          title: L.t("Đổi email"),
                          subtitle: userEmail, chevron: true) {
                        showChangeEmail = true
                    }
                    WVDivider(inset: 60)
                    appLockRow
                }
                WVSectionFooter(L.t("Đổi email cần mật khẩu hiện tại và một mã xác nhận gửi tới địa chỉ MỚI. Địa chỉ cũ vẫn dùng được cho tới khi bạn xác nhận; sau đó mọi thiết bị phải đăng nhập lại."))
                WVSectionFooter(L.t("Khi bật, ứng dụng sẽ yêu cầu Face ID/Touch ID — hoặc mã mở khoá của thiết bị — mỗi lần quay lại ứng dụng. Nếu thiết bị không còn mã mở khoá, khoá sẽ tự tắt để bạn không bị khoá cứng."))

                // Linked accounts section
                WVSectionHeader(L.t("Liên kết"))
                WVGroup {
                    // Sign in with Apple is deliberately NOT implemented: it
                    // needs a paid Apple Developer account, server-side
                    // identity-token verification and changes to the Go auth
                    // flow. The row stays honest instead of offering a login
                    // that cannot work.
                    WVRow(icon: "mail", iconColor: WVColor.red,
                          title: "Apple ID", detail: L.t("Chưa khả dụng"))
                    WVDivider(inset: 60)
                    WVRow(icon: "users", iconColor: WVColor.blue,
                          title: "Google", detail: L.t("Chưa khả dụng"))
                }
                WVSectionFooter(L.t("Đăng nhập bằng Apple ID/Google chưa được hỗ trợ. Tài khoản WarrantyVault dùng email và mật khẩu — đổi mật khẩu hoặc email ở mục Bảo mật."))

                // Delete account
                Spacer().frame(height: 20)
                WVButton(isDeleting ? L.t("Đang xoá…") : L.t("Yêu cầu xoá tài khoản"),
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
        .sheet(isPresented: $showChangeEmail) {
            EmailChangeSheet(client: client)
        }
        .alert(L.t("Xoá tài khoản?"), isPresented: $showDeleteAlert) {
            SecureField(L.t("Mật khẩu hiện tại"), text: $deletePassword)
            Button(L.t("Huỷ"), role: .cancel) { deletePassword = "" }
            Button(L.t("Xoá vĩnh viễn"), role: .destructive) { performDelete() }
        } message: {
            Text(L.t("Nhập mật khẩu để xác nhận. Toàn bộ thiết bị, hoá đơn, ảnh BH và cài đặt sẽ bị xoá vĩnh viễn — không thể hoàn tác."))
        }
        .alert(L.t("Không xoá được"), isPresented: Binding(
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
            deleteError = L.t("Nhập mật khẩu để xác nhận.")
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
                    ?? L.t("Mật khẩu không đúng hoặc lỗi máy chủ.")
            } catch {
                deleteError = L.t("Không kết nối được máy chủ.")
            }
        }
    }

    // MARK: - App lock (Face ID & Touch ID)

    /// Toggle row for the biometric app lock.
    ///
    /// The switch is disabled when the device has no enrolled biometrics, so a
    /// user can never turn on a lock they'd be unable to satisfy. Both turning
    /// it on and off run one authentication first (`AppLockStore.setEnabled`).
    private var appLockRow: some View {
        HStack(spacing: 12) {
            WVLeadingIcon(icon: "lock", color: WVColor.purple)
            VStack(alignment: .leading, spacing: 1) {
                Text("Face ID & Touch ID")
                    .font(.system(size: 17))
                    .foregroundStyle(WVColor.label)
                Text(appLockDetail)
                    .font(.system(size: 13))
                    .foregroundStyle(WVColor.label3)
                    .lineLimit(2)
            }
            Spacer(minLength: 8)
            if appLock.isAuthenticating {
                ProgressView()
            } else {
                Toggle("", isOn: Binding(
                    get: { appLock.isEnabled },
                    set: { newValue in
                        appLock.acknowledgeAutoDisabledNotice()
                        Task { await appLock.setEnabled(newValue) }
                    }
                ))
                .labelsHidden()
                .disabled(!appLock.isEnabled && !appLock.availability.canEnableLock)
            }
        }
        .padding(.horizontal, 16)
        .frame(minHeight: 44)
        .padding(.vertical, 7)
    }

    private var appLockDetail: String {
        if let error = appLock.lastError { return error }
        if let notice = appLock.autoDisabledNotice { return notice }
        if appLock.isEnabled {
            return L.t("Đang bật — mở khoá bằng %@ hoặc mã mở khoá",
                        appLock.availability.biometry.label)
        }
        if let reason = appLock.availability.unavailableReason { return reason }
        return L.t("Đang tắt")
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
