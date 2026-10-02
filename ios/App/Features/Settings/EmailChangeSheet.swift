import SwiftUI
import WarrantyVaultKit

// ============================================================
// EmailChangeSheet — đổi email tài khoản (2 bước)
//
// Step 1 (`POST /api/v1/auth/change-email`) mails a single-use, 30-minute token
// to the NEW address — receiving it there is what proves the address belongs to
// the user. `User.email` does not change until step 2, which is why the sheet
// says so explicitly instead of implying the move already happened.
//
// Step 2 (`POST /api/v1/auth/confirm-email-change`) takes the raw token. The
// mailed link is `<APP_URL>/confirm-email/<token>` — a **web** page this app
// cannot open as a session — so the email also prints the token as text and the
// user pastes it here (`EmailChangeRules.token(fromPasted:)` also accepts the
// whole link, since that is the bigger tap target on a phone).
//
// Two things this screen deliberately does NOT do:
//   * it never hints that the new address might already belong to someone else.
//     The API answers the same neutral message either way (no email is sent in
//     that case) so accounts cannot be enumerated; a client that "detected" it
//     would undo that.
//   * it never claims the mail was delivered. The server only knows it handed
//     the message to the mail provider — with no `RESEND_API_KEY` it just logs
//     the link — and nothing in the response tells the client which happened.
//
// Both steps live on one screen because the token arrives out-of-band: the user
// may come back to this screen later, or asked for the change on another device.
// ============================================================

struct EmailChangeSheet: View {
    let client: APIClient

    @EnvironmentObject private var auth: AuthStore
    @Environment(\.dismiss) private var dismiss

    // Step 1
    @State private var newEmail = ""
    @State private var currentPassword = ""

    // Step 2
    @State private var token = ""

    @State private var isRequesting = false
    @State private var isConfirming = false
    @State private var stepOneErrors: [String: [String]] = [:]
    @State private var stepTwoError: String?
    @State private var topError: String?

    /// Set after step 1 succeeds: the address a token was requested for, used in
    /// the "check the new inbox" state and in the final copy.
    @State private var requestedEmail: String?
    /// The server's neutral message, shown verbatim — it is the one piece of
    /// copy that says exactly as much as the API is willing to say.
    @State private var neutralMessage: String?

    @State private var showConfirmedAlert = false

    private var currentEmail: String {
        if case let .authenticated(user) = auth.status { return user.email }
        return ""
    }

    // MARK: - Body

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    Spacer().frame(height: 12)

                    intro

                    if let topError {
                        HStack(spacing: 8) {
                            WVIcon("alert", size: 14)
                            Text(topError).font(.system(size: 13))
                        }
                        .foregroundStyle(WVColor.red)
                        .padding(.horizontal, WVSpacing.gutter)
                        .padding(.top, 12)
                    }

                    // ---- Bước 1 ----
                    WVSectionHeader("Bước 1 — Gửi mã tới địa chỉ mới")
                    WVGroup {
                        EmailField("Địa chỉ email mới", text: $newEmail)
                        WVDivider(inset: 16)
                        ECPSecureRow("Mật khẩu hiện tại", text: $currentPassword)
                    }
                    inlineError(stepOneErrors["newEmail"]?.first)
                    inlineError(stepOneErrors["currentPassword"]?.first)

                    WVButton(
                        isRequesting ? "Đang gửi…" : "Gửi mã xác nhận",
                        icon: isRequesting ? nil : "mail",
                        kind: .primary
                    ) {
                        Task { await requestChange() }
                    }
                    .padding(.horizontal, WVSpacing.gutter)
                    .padding(.top, 12)
                    .disabled(isRequesting || !canRequest)

                    if requestedEmail != nil { checkInboxState }

                    // ---- Bước 2 ----
                    WVSectionHeader("Bước 2 — Nhập mã xác nhận")
                    WVGroup {
                        ECPTokenRow("Mã xác nhận trong email", text: $token)
                    }
                    inlineError(stepTwoError)

                    WVButton(
                        isConfirming ? "Đang xác nhận…" : "Xác nhận đổi email",
                        icon: isConfirming ? nil : "checkCircle",
                        kind: .primary
                    ) {
                        Task { await confirmChange() }
                    }
                    .padding(.horizontal, WVSpacing.gutter)
                    .padding(.top, 12)
                    .disabled(isConfirming || EmailChangeRules.token(fromPasted: token).isEmpty)

                    WVSectionFooter("Ứng dụng không mở được link trong email (đó là trang web), nên hãy dán mã — hoặc dán cả link — vào ô trên. Mã dùng một lần và hết hạn sau \(EmailChangeRules.tokenTTLMinutes) phút.")

                    Spacer().frame(height: 24)
                }
            }
            .wvScreen()
            .navigationTitle("Đổi email")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Huỷ") { dismiss() }
                        .foregroundStyle(WVColor.tint)
                }
            }
            .alert("Đã đổi email", isPresented: $showConfirmedAlert) {
                Button("Đăng nhập lại") {
                    Task {
                        // The server revoked every session in the same
                        // transaction, so the local token is already dead:
                        // drop it and let RootView show the login screen.
                        dismiss()
                        await auth.logout()
                    }
                }
            } message: {
                Text(confirmSuccessMessage)
            }
        }
    }

    // MARK: - Sections

    private var intro: some View {
        WVSectionFooter("Email đăng nhập hiện tại: \(currentEmail.isEmpty ? "—" : currentEmail). Sau khi xác nhận, mọi thiết bị sẽ bị đăng xuất và bạn phải đăng nhập lại bằng địa chỉ mới.")
    }

    /// The "check the new inbox" state. Never says the mail *arrived* — only
    /// what the server was asked to do.
    private var checkInboxState: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                WVIcon("checkCircle", size: 14)
                Text("Đã ghi nhận yêu cầu")
                    .font(.system(size: 13, weight: .semibold))
            }
            .foregroundStyle(WVColor.green)

            if let neutralMessage {
                Text(neutralMessage)
                    .font(.system(size: 13))
                    .foregroundStyle(WVColor.label2)
            }
            Text("Mở hộp thư của địa chỉ MỚI\(requestedEmail.map { " (\($0))" } ?? "") — kể cả mục Spam/Quảng cáo — rồi dán mã xác nhận vào Bước 2.")
                .font(.system(size: 13))
                .foregroundStyle(WVColor.label3)
            Text("Địa chỉ cũ vẫn dùng được cho tới khi xác nhận xong.")
                .font(.system(size: 13))
                .foregroundStyle(WVColor.label3)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, WVSpacing.titleGutter)
        .padding(.top, 12)
    }

    @ViewBuilder
    private func inlineError(_ message: String?) -> some View {
        if let message {
            Text(message)
                .font(.system(size: 13))
                .foregroundStyle(WVColor.red)
                .padding(.horizontal, WVSpacing.titleGutter)
                .padding(.top, 6)
        }
    }

    // MARK: - Logic

    private var canRequest: Bool {
        !EmailChangeRules.normalizedEmail(newEmail).isEmpty && !currentPassword.isEmpty
    }

    private var confirmSuccessMessage: String {
        let address = requestedEmail.map { " sang \($0)" } ?? ""
        return "Email đăng nhập đã được đổi\(address). Mọi thiết bị — kể cả thiết bị này — đã bị đăng xuất. Hãy đăng nhập lại bằng địa chỉ mới."
    }

    private func requestChange() async {
        topError = nil
        stepOneErrors = [:]
        isRequesting = true
        defer { isRequesting = false }

        let email = EmailChangeRules.normalizedEmail(newEmail)
        do {
            let result = try await client.requestEmailChange(
                EmailChangeInput(newEmail: email, currentPassword: currentPassword)
            )
            // Neutral by contract: this same path is what runs when the address
            // already belongs to another account. Don't try to tell them apart.
            requestedEmail = email
            neutralMessage = result.message
            currentPassword = ""
        } catch let error as APIError {
            stepOneErrors = error.fieldErrors
            if stepOneErrors.isEmpty { topError = error.localizedDescription }
        } catch {
            topError = "Không kết nối được máy chủ."
        }
    }

    private func confirmChange() async {
        topError = nil
        stepTwoError = nil
        isConfirming = true
        defer { isConfirming = false }

        // Accepts the bare token or the whole confirm-email link.
        let raw = EmailChangeRules.token(fromPasted: token)
        guard !raw.isEmpty else {
            stepTwoError = "Nhập mã xác nhận trong email."
            return
        }

        do {
            _ = try await client.confirmEmailChange(token: raw)
            showConfirmedAlert = true
        } catch let error as APIError {
            stepTwoError = error.localizedDescription
        } catch {
            topError = "Không kết nối được máy chủ."
        }
    }
}

// MARK: - Private rows

private struct EmailField: View {
    let placeholder: String
    @Binding var text: String

    init(_ placeholder: String, text: Binding<String>) {
        self.placeholder = placeholder
        self._text = text
    }

    var body: some View {
        TextField(placeholder, text: $text)
            .keyboardType(.emailAddress)
            .textContentType(.emailAddress)
            .autocorrectionDisabled()
            .textInputAutocapitalization(.never)
            .font(.system(size: 17))
            .padding(.horizontal, 16)
            .frame(minHeight: 44)
    }
}

private struct ECPSecureRow: View {
    let placeholder: String
    @Binding var text: String

    init(_ placeholder: String, text: Binding<String>) {
        self.placeholder = placeholder
        self._text = text
    }

    var body: some View {
        SecureField(placeholder, text: $text)
            .textContentType(.password)
            .autocorrectionDisabled()
            .textInputAutocapitalization(.never)
            .font(.system(size: 17))
            .padding(.horizontal, 16)
            .frame(minHeight: 44)
    }
}

private struct ECPTokenRow: View {
    let placeholder: String
    @Binding var text: String

    init(_ placeholder: String, text: Binding<String>) {
        self.placeholder = placeholder
        self._text = text
    }

    var body: some View {
        TextField(placeholder, text: $text)
            .autocorrectionDisabled()
            .textInputAutocapitalization(.never)
            .font(.system(size: 15, design: .monospaced))
            .lineLimit(2)
            .padding(.horizontal, 16)
            .frame(minHeight: 44)
    }
}
