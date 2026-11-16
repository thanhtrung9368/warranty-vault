import SwiftUI
import WarrlyKit

// ============================================================
// AccountView — Hồ sơ (profile). Port of AccountScreen in screens-3.jsx.
// ============================================================

struct AccountView: View {
    let client: APIClient

    @EnvironmentObject private var auth: AuthStore
    @EnvironmentObject private var appLock: AppLockStore
    @State private var showChangePassword = false
    @State private var showDisplayName = false
    @State private var showDeleteAlert = false
    @State private var isDeleting = false
    @State private var deletePassword = ""
    @State private var deleteError: String?

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                // Avatar + name header
                avatarHeader
                    .padding(.top, WVSpacing.sm)

                // Info section. The display name is editable (PATCH /auth/me);
                // the email stays read-only here because changing it is a
                // separate password-gated two-step flow, which 1.0.0 does not
                // offer (see the note above the Bảo mật group).
                WVSectionHeader(L.t("Thông tin"))
                WVGroup {
                    // Display name
                    WVRow(title: L.t("Tên hiển thị"),
                          detail: displayName ?? L.t("Chưa đặt"),
                          chevron: true) {
                        showDisplayName = true
                    }

                    // No leading icon on this pair, so the hairline aligns to
                    // the text edge, not to the 56 pt icon-track inset (§3).
                    WVDivider(inset: WVSpacing.gutter)

                    // Email
                    HStack(spacing: WVSpacing.gutter) {
                        Text("Email")
                            .wvFont(.body)
                            .foregroundStyle(WVColor.label)
                        Spacer(minLength: WVSpacing.sm)
                        Text(userEmail)
                            .wvFont(.body)
                            .foregroundStyle(WVColor.label3)
                            .lineLimit(1)
                            .truncationMode(.middle)
                    }
                    .padding(.horizontal, WVSpacing.gutter)
                    .frame(minHeight: 44)
                    .padding(.vertical, WVSpacing.sm)
                }

                // Receipts by email. `GET /auth/me` returns the account's own
                // forwarding address (migration 0020) and openapi says the
                // client must show it in Settings for copy/forward. The section
                // renders only when the server sent one: the key is `omitempty`,
                // so a deployment without a mail provider answers without it and
                // a row here would be a dead address to copy.
                if let inboxAddress {
                    WVSectionHeader(L.t("Hoá đơn qua email"))
                    WVGroup {
                        InboxAddressRow(address: inboxAddress)
                    }
                    WVSectionFooter(L.t("Địa chỉ này chỉ nhận thư. Ai biết địa chỉ cũng chỉ gửi được email vào hộp thư đến — không đọc, tải hay xoá được gì."))
                    WVSectionFooter(L.t("Chuyển tiếp email hoá đơn (PDF hoặc ảnh đính kèm) tới địa chỉ này — tệp sẽ nằm trong Hộp thư đến để gán vào thiết bị."))
                }

                // Password + app lock.
                //
                // Account email changes are deliberately not offered in 1.0.0.
                // The flow works end to end and `EmailChangeSheet` stays in the
                // codebase (unreachable), because hiding it is a product
                // decision for the first release, not a broken feature: it is
                // password-gated, revokes every session, and keeps the old
                // address live until the mailed token is confirmed. Restoring
                // the row is the whole change.
                WVSectionHeader(L.t("Bảo mật"))
                WVGroup {
                    WVRow(icon: "key",
                          title: L.t("Đổi mật khẩu"), chevron: true) {
                        showChangePassword = true
                    }
                    WVDivider()
                    appLockRow
                }
                WVSectionFooter(L.t("Khi bật, ứng dụng sẽ yêu cầu Face ID/Touch ID — hoặc mã mở khoá của thiết bị — mỗi lần quay lại ứng dụng. Nếu thiết bị không còn mã mở khoá, khoá sẽ tự tắt để bạn không bị khoá cứng."))

                // Linked accounts section
                WVSectionHeader(L.t("Liên kết"))
                WVGroup {
                    // Sign in with Apple is deliberately NOT implemented: it
                    // needs a paid Apple Developer account, server-side
                    // identity-token verification and changes to the Go auth
                    // flow. The row stays honest instead of offering a login
                    // that cannot work.
                    LinkedAccountRow(
                        title: "Apple ID",
                        icon: .sfSymbol("apple.logo")
                    )
                    WVDivider()
                    LinkedAccountRow(
                        title: "Google",
                        icon: .letter("G")
                    )
                }
                // The footer used to add "or email" here. The email-change row
                // is hidden in 1.0.0, so that half of the sentence pointed at a
                // control this screen no longer has.
                WVSectionFooter(L.t("Đăng nhập bằng Apple ID/Google chưa được hỗ trợ. Tài khoản Warrly dùng email và mật khẩu — đổi mật khẩu ở mục Bảo mật."))

                // Delete account
                Spacer().frame(height: WVSpacing.gutter)
                WVButton(isDeleting ? L.t("Đang xoá…") : L.t("Yêu cầu xoá tài khoản"),
                         kind: .destructiveGhost) {
                    deletePassword = ""
                    showDeleteAlert = true
                }
                .disabled(isDeleting)
                .padding(.horizontal, WVSpacing.gutter)

                Spacer().frame(height: WVSpacing.xl)
            }
        }
        .wvScreen()
        .sheet(isPresented: $showChangePassword) {
            ChangePasswordSheet(client: client)
        }
        .sheet(isPresented: $showDisplayName) {
            DisplayNameSheet(auth: auth, currentName: displayName ?? "")
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
        HStack(spacing: WVSpacing.md) {
            WVLeadingIcon(icon: "lock")
            VStack(alignment: .leading, spacing: 1) {
                Text("Face ID & Touch ID")
                    .wvFont(.body)
                    .foregroundStyle(WVColor.label)
                Text(appLockDetail)
                    .wvFont(.footnote)
                    .foregroundStyle(WVColor.label3)
                    .lineLimit(2)
            }
            Spacer(minLength: WVSpacing.sm)
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
        .padding(.horizontal, WVSpacing.gutter)
        .frame(minHeight: 44)
        .padding(.vertical, WVSpacing.sm)
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
        VStack(spacing: WVSpacing.md) {
            // Initials avatar. Neutral, not coral: a profile monogram is
            // identity, and coral means "the action" (§5.1). The dashboard's
            // coral greeting avatar goes for the same reason (§8.3).
            Circle()
                .fill(WVColor.fill3)
                .frame(width: 86, height: 86)
                .overlay(
                    Text(initials)
                        .wvFont(.display)
                        .foregroundStyle(WVColor.label)
                        .lineLimit(1)
                        .minimumScaleFactor(0.5)
                )

            // 20 semibold / 13 label3: the type scale has no 22 and no 15, and
            // the name is a content heading, not a second navigation title (§2).
            Text(userName)
                .wvFont(.title3Emphasis)
                .foregroundStyle(WVColor.label)

            Text(userEmail)
                .wvFont(.footnote)
                .foregroundStyle(WVColor.label3)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, WVSpacing.xl)
    }

    // MARK: - Helpers

    /// The stored display name, or `nil` when the account has never set one.
    ///
    /// Kept separate from `userName` on purpose: `userName` falls back to the
    /// email so the avatar header is never blank, but the "Tên hiển thị" row is
    /// an editor for the NAME — pre-filling it with the email would offer to
    /// save an email as a display name.
    private var displayName: String? {
        if case let .authenticated(u) = auth.status { return u.name }
        return nil
    }

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

    /// The account's inbound receipt address, or `nil` when this deployment has
    /// no mail provider (`inboxAddress` is omitted from `/auth/me` when
    /// `INBOX_EMAIL_DOMAIN` is unset). `nil` renders no section at all.
    private var inboxAddress: String? {
        guard case let .authenticated(u) = auth.status,
              let address = u.inboxAddress?.trimmingCharacters(in: .whitespacesAndNewlines),
              !address.isEmpty else { return nil }
        return address
    }

    private var initials: String {
        let name = userName
        let parts = name.split(separator: " ")
        let chars = parts.prefix(2).compactMap { $0.first }
        let s = String(chars).uppercased()
        return s.isEmpty ? "?" : s
    }
}

// MARK: - Linked-account rows

/// A leading tile for the linked-account rows.
///
/// `WVLeadingIcon` looks its glyph up in `WVIconMap`, which only knows the
/// prototype's icon names. The two providers need glyphs that map cannot
/// express: the Apple logo is an SF Symbol (`apple.logo`) and Google's mark is
/// the letter G, for which no SF Symbol exists. So the tile is drawn here at
/// the same metrics as `WVLeadingIcon` (28 pt tile, 20 pt glyph, `fill3` tile,
/// `label2` glyph) instead of falling back to `questionmark`.
private struct LinkedAccountLeadingIcon: View {
    enum Glyph {
        case sfSymbol(String)
        case letter(String)
    }

    let glyph: Glyph

    var body: some View {
        RoundedRectangle(cornerRadius: WVRadius.sm, style: .continuous)
            .fill(WVColor.fill3)
            .frame(width: 28, height: 28)
            .overlay {
                switch glyph {
                case .sfSymbol(let name):
                    Image(systemName: name)
                        // `.title3` is the 20 pt role — the same optical size
                        // as the `WVIcon` glyph every other row's tile draws.
                        .wvFont(.title3, weight: .semibold)
                case .letter(let text):
                    Text(text)
                        .wvFont(.title3, weight: .semibold)
                        .minimumScaleFactor(0.8)
                }
            }
            .foregroundStyle(WVColor.label2)
    }
}

/// A static (non-tappable) label-value row for a provider that is not wired up.
///
/// It mirrors `WVRow`'s geometry and typography — the shared row only accepts a
/// `WVIconMap` name for its leading glyph, and these two rows need the custom
/// tile above. Detail moves under the title at Accessibility sizes, exactly as
/// `WVRow` does, so the value is never squeezed off the row.
private struct LinkedAccountRow: View {
    let title: String
    let icon: LinkedAccountLeadingIcon.Glyph

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        WVRowContainer(action: nil) {
            if dynamicTypeSize.isAccessibilitySize {
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 12) {
                        LinkedAccountLeadingIcon(glyph: icon)
                        Text(title)
                            .wvFont(.body)
                            .foregroundStyle(WVColor.label)
                    }
                    Text(L.t("Chưa khả dụng"))
                        .wvFont(.body)
                        .foregroundStyle(WVColor.label3)
                }
            } else {
                HStack(spacing: 12) {
                    LinkedAccountLeadingIcon(glyph: icon)
                    Text(title)
                        .wvFont(.body)
                        .foregroundStyle(WVColor.label)
                        .lineLimit(1)
                    Spacer(minLength: 8)
                    Text(L.t("Chưa khả dụng"))
                        .wvFont(.body)
                        .foregroundStyle(WVColor.label3)
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                        .layoutPriority(2)
                }
            }
        }
    }
}
