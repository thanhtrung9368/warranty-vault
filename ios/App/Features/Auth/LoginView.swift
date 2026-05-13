import SwiftUI
import WarrantyVaultKit

struct LoginView: View {
    @EnvironmentObject var auth: AuthStore

    enum Mode { case login, register }
    @State private var mode: Mode = .login

    @State private var email = ""
    @State private var password = ""
    @State private var name = ""

    @State private var isSubmitting = false
    @State private var topError: String?
    @State private var fieldErrors: [String: [String]] = [:]
    @State private var showForgot = false

    var body: some View {
        ZStack {
            // Gradient backdrop using primary tint at low opacity — distinct
            // from web's flat marketing page; feels app-native.
            LinearGradient(
                colors: [WV.Tokens.primary.opacity(0.15), WV.Tokens.bg],
                startPoint: .topLeading, endPoint: .bottomTrailing
            ).ignoresSafeArea()

            ScrollView {
                VStack(spacing: WV.Spacing.xl) {
                    Spacer().frame(height: 40)
                    header
                    modePicker
                    formCard
                }
                .padding(WV.Spacing.lg)
                .frame(maxWidth: 480)
            }
        }
        .scrollDismissesKeyboard(.interactively)
        .sheet(isPresented: $showForgot) {
            ForgotPasswordView(client: auth.client)
        }
    }

    private var header: some View {
        VStack(spacing: WV.Spacing.md) {
            ZStack {
                Circle()
                    .fill(WV.Tokens.primary.opacity(0.14))
                    .frame(width: 96, height: 96)
                Image(systemName: "shield.checkered")
                    .font(.system(size: 44, weight: .semibold))
                    .foregroundStyle(WV.Tokens.primary)
            }
            .shadow(color: WV.Tokens.primary.opacity(0.18), radius: 18, y: 8)

            VStack(spacing: 6) {
                Text(mode == .login ? "Chào mừng quay lại" : "Tạo tài khoản mới")
                    .font(.largeTitle.bold())
                    .tracking(-0.5)
                    .foregroundStyle(WV.Tokens.fg)
                    .multilineTextAlignment(.center)
                Text(mode == .login
                     ? "Đăng nhập để xem bảo hành, đăng ký và wishlist của mày."
                     : "Đăng ký để bắt đầu theo dõi mọi thứ trong tay.")
                    .font(.system(size: 14))
                    .foregroundStyle(WV.Tokens.mutedFg)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, WV.Spacing.md)
            }
        }
    }

    private var modePicker: some View {
        Picker("", selection: $mode) {
            Text("Đăng nhập").tag(Mode.login)
            Text("Đăng ký").tag(Mode.register)
        }
        .pickerStyle(.segmented)
        .onChange(of: mode) { _, _ in
            topError = nil; fieldErrors = [:]
        }
    }

    private var formCard: some View {
        WVCard {
            VStack(spacing: WV.Spacing.md) {
                if mode == .register {
                    WVTextField(
                        "Tên", placeholder: "Nguyễn Văn A",
                        text: $name,
                        contentType: .name,
                        error: fieldErrors["name"]?.first
                    )
                }
                WVTextField(
                    "Email", placeholder: "you@example.com",
                    text: $email,
                    keyboardType: .emailAddress, contentType: .emailAddress,
                    error: fieldErrors["email"]?.first
                )
                WVTextField(
                    "Mật khẩu",
                    placeholder: mode == .register ? "Tối thiểu 8 ký tự" : "•••••",
                    text: $password,
                    contentType: mode == .login ? .password : .newPassword,
                    isSecure: true,
                    error: fieldErrors["password"]?.first
                )

                if let topError {
                    Label(topError, systemImage: "exclamationmark.triangle.fill")
                        .font(.system(size: 13))
                        .foregroundStyle(WV.Tokens.destructive)
                        .padding(.top, 4)
                }

                Button(action: { Task { await submit() } }) {
                    HStack {
                        if isSubmitting { ProgressView().tint(WV.Tokens.primaryFg) }
                        Text(mode == .login ? "Đăng nhập" : "Tạo tài khoản")
                    }
                }
                .buttonStyle(HeroPrimaryButtonStyle(fullWidth: true))
                .disabled(isSubmitting || !canSubmit)
                .padding(.top, WV.Spacing.sm)

                if mode == .login {
                    Button("Quên mật khẩu?") { showForgot = true }
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(WV.Tokens.primary)
                        .padding(.top, 2)
                }
            }
        }
    }

    private var canSubmit: Bool {
        if email.isEmpty || password.isEmpty { return false }
        if mode == .register && password.count < 8 { return false }
        return true
    }

    private func submit() async {
        topError = nil; fieldErrors = [:]
        isSubmitting = true
        defer { isSubmitting = false }
        do {
            switch mode {
            case .login:
                try await auth.login(email: email, password: password)
            case .register:
                try await auth.register(
                    email: email, password: password,
                    name: name.isEmpty ? nil : name
                )
            }
        } catch let err as APIError {
            topError = err.localizedDescription
            fieldErrors = err.fieldErrors
        } catch {
            topError = error.localizedDescription
        }
    }
}
