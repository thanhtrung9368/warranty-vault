import SwiftUI
import WarrantyVaultKit

// ============================================================
// LoginView — authentication entry point.
// Shown by RootView when auth.status == .unauthenticated.
// Coral brand, grouped fields, WVButton — matches the prototype
// design language applied to an iOS-native auth form.
// ============================================================

struct LoginView: View {
    @EnvironmentObject var auth: AuthStore

    @State private var email = ""
    @State private var password = ""
    @State private var isSubmitting = false
    @State private var topError: String?
    @State private var fieldErrors: [String: [String]] = [:]
    @State private var showForgot = false
    @State private var showRegister = false

    init() {}

    var body: some View {
        NavigationStack {
            ZStack {
                // Coral gradient backdrop
                LinearGradient(
                    colors: [WVColor.brand.opacity(0.18), WVColor.bg],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
                .ignoresSafeArea()

                ScrollView {
                    VStack(spacing: 0) {
                        Spacer().frame(height: 52)
                        logoHeader
                        Spacer().frame(height: 32)
                        formSection
                        Spacer().frame(height: 24)
                        registerLink
                        Spacer().frame(height: 32)
                    }
                    .padding(.horizontal, WVSpacing.gutter)
                    .frame(maxWidth: 480)
                    .frame(maxWidth: .infinity)
                }
            }
            .scrollDismissesKeyboard(.interactively)
            .navigationBarHidden(true)
        }
        .sheet(isPresented: $showForgot) {
            ForgotPasswordView(client: auth.client)
        }
        .sheet(isPresented: $showRegister) {
            RegisterView()
                .environmentObject(auth)
        }
    }

    // MARK: - Logo + title

    private var logoHeader: some View {
        VStack(spacing: 14) {
            ZStack {
                Circle()
                    .fill(WVColor.brandSoft)
                    .frame(width: 96, height: 96)
                Image(systemName: "shield.checkered")
                    .font(.system(size: 46, weight: .semibold))
                    .foregroundStyle(WVColor.brand)
            }
            .shadow(color: WVColor.brand.opacity(0.22), radius: 20, y: 8)

            VStack(spacing: 6) {
                Text(L.t("Chào mừng quay lại"))
                    .font(.system(size: 28, weight: .bold))
                    .foregroundStyle(WVColor.label)
                    .multilineTextAlignment(.center)
                Text(L.t("Đăng nhập để xem bảo hành, đăng ký và wishlist của mày."))
                    .font(.system(size: 14))
                    .foregroundStyle(WVColor.label3)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 16)
            }
        }
    }

    // MARK: - Form

    private var formSection: some View {
        VStack(spacing: 0) {
            // Fields
            WVGroup {
                AuthTextField(
                    label: "Email",
                    placeholder: "you@example.com",
                    text: $email,
                    keyboardType: .emailAddress,
                    contentType: .emailAddress,
                    isSecure: false,
                    error: fieldErrors["email"]?.first
                )
                WVDivider(inset: 16)
                AuthTextField(
                    label: L.t("Mật khẩu"),
                    placeholder: "•••••",
                    text: $password,
                    keyboardType: .default,
                    contentType: .password,
                    isSecure: true,
                    error: fieldErrors["password"]?.first
                )
            }

            // Inline error
            if let topError {
                HStack(spacing: 6) {
                    WVIcon("alert", size: 13)
                    Text(topError)
                        .font(.system(size: 13))
                }
                .foregroundStyle(WVColor.red)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, WVSpacing.gutter)
                .padding(.top, 10)
            }

            Spacer().frame(height: 16)

            // Primary button
            WVButton(
                isSubmitting ? L.t("Đang đăng nhập…") : L.t("Đăng nhập"),
                kind: .primary
            ) {
                Task { await submit() }
            }
            .disabled(isSubmitting || !canSubmit)

            // Forgot password
            Button {
                showForgot = true
            } label: {
                Text(L.t("Quên mật khẩu?"))
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(WVColor.tint)
            }
            .padding(.top, 12)
        }
    }

    // MARK: - Register link

    private var registerLink: some View {
        VStack(spacing: 8) {
            Divider()
                .padding(.horizontal, WVSpacing.gutter)
            Button {
                showRegister = true
            } label: {
                Text(L.t("Chưa có tài khoản? ")) +
                Text(L.t("Đăng ký")).foregroundColor(WVColor.tint).bold()
            }
            .font(.system(size: 14))
            .foregroundStyle(WVColor.label3)
            .padding(.top, 4)
        }
    }

    // MARK: - Logic

    private var canSubmit: Bool { !email.isEmpty && !password.isEmpty }

    private func submit() async {
        topError = nil; fieldErrors = [:]
        isSubmitting = true
        defer { isSubmitting = false }
        do {
            try await auth.login(email: email, password: password)
        } catch let err as APIError {
            topError = err.localizedDescription
            fieldErrors = err.fieldErrors
        } catch {
            topError = error.localizedDescription
        }
    }
}

// MARK: - Shared auth text field

/// Grouped-list style text/secure field with inline error label.
struct AuthTextField: View {
    let label: String
    let placeholder: String
    @Binding var text: String
    var keyboardType: UIKeyboardType = .default
    var contentType: UITextContentType? = nil
    var isSecure: Bool = false
    var error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 12) {
                Text(label)
                    .font(.system(size: 17))
                    .foregroundStyle(WVColor.label)
                    .frame(width: 100, alignment: .leading)

                if isSecure {
                    SecureField(placeholder, text: $text)
                        .keyboardType(keyboardType)
                        .textContentType(contentType)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.never)
                        .font(.system(size: 17))
                        .foregroundStyle(WVColor.label)
                        .multilineTextAlignment(.trailing)
                } else {
                    TextField(placeholder, text: $text)
                        .keyboardType(keyboardType)
                        .textContentType(contentType)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.never)
                        .font(.system(size: 17))
                        .foregroundStyle(WVColor.label)
                        .multilineTextAlignment(.trailing)
                }
            }
            .padding(.horizontal, 16)
            .frame(minHeight: 44)

            if let error {
                Text(error)
                    .font(.system(size: 12))
                    .foregroundStyle(WVColor.red)
                    .padding(.horizontal, 16)
                    .padding(.bottom, 8)
            }
        }
    }
}
