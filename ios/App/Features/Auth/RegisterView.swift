import SwiftUI
import WarrantyVaultKit

// ============================================================
// RegisterView — Tạo tài khoản mới.
// Presented as a sheet from LoginView. Same coral design language.
// ============================================================

struct RegisterView: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject var auth: AuthStore

    @State private var name = ""
    @State private var email = ""
    @State private var password = ""
    @State private var isSubmitting = false
    @State private var topError: String?
    @State private var fieldErrors: [String: [String]] = [:]

    var body: some View {
        NavigationStack {
            ZStack {
                LinearGradient(
                    colors: [WVColor.brand.opacity(0.15), WVColor.bg],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
                .ignoresSafeArea()

                ScrollView {
                    VStack(spacing: 0) {
                        Spacer().frame(height: 32)
                        registerHeader
                        Spacer().frame(height: 28)
                        formSection
                        Spacer().frame(height: 24)
                        loginLink
                        Spacer().frame(height: 32)
                    }
                    .padding(.horizontal, WVSpacing.gutter)
                    .frame(maxWidth: 480)
                    .frame(maxWidth: .infinity)
                }
            }
            .scrollDismissesKeyboard(.interactively)
            .navigationTitle(L.t("Đăng ký"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button(L.t("Đóng")) { dismiss() }
                        .foregroundStyle(WVColor.tint)
                }
            }
        }
    }

    // MARK: - Header

    private var registerHeader: some View {
        VStack(spacing: 14) {
            ZStack {
                Circle()
                    .fill(WVColor.brandSoft)
                    .frame(width: 88, height: 88)
                Image(systemName: "person.crop.circle.badge.plus")
                    .font(.system(size: 40, weight: .semibold))
                    .foregroundStyle(WVColor.brand)
            }
            .shadow(color: WVColor.brand.opacity(0.2), radius: 18, y: 8)

            VStack(spacing: 6) {
                Text(L.t("Tạo tài khoản miễn phí"))
                    .font(.system(size: 24, weight: .bold))
                    .foregroundStyle(WVColor.label)
                    .multilineTextAlignment(.center)
                Text(L.t("Đăng ký mất 30 giây. Không thẻ tín dụng, không quảng cáo."))
                    .font(.system(size: 13))
                    .foregroundStyle(WVColor.label3)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 16)
            }
        }
    }

    // MARK: - Form

    private var formSection: some View {
        VStack(spacing: 0) {
            WVGroup {
                AuthTextField(
                    label: L.t("Tên"),
                    placeholder: "vd: Trung",
                    text: $name,
                    contentType: .name,
                    error: fieldErrors["name"]?.first
                )
                WVDivider(inset: 16)
                AuthTextField(
                    label: "Email",
                    placeholder: "ban@example.com",
                    text: $email,
                    keyboardType: .emailAddress,
                    contentType: .emailAddress,
                    error: fieldErrors["email"]?.first
                )
                WVDivider(inset: 16)
                AuthTextField(
                    label: L.t("Mật khẩu"),
                    placeholder: L.t("Tối thiểu 8 ký tự"),
                    text: $password,
                    contentType: .newPassword,
                    isSecure: true,
                    error: fieldErrors["password"]?.first
                )
            }

            if let topError {
                HStack(spacing: 6) {
                    WVIcon("alert", size: 13)
                    Text(topError).font(.system(size: 13))
                }
                .foregroundStyle(WVColor.red)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, WVSpacing.gutter)
                .padding(.top, 10)
            }

            Spacer().frame(height: 16)

            WVButton(
                isSubmitting ? L.t("Đang tạo tài khoản…") : L.t("Tạo tài khoản"),
                kind: .primary
            ) {
                Task { await submit() }
            }
            .disabled(isSubmitting || !canSubmit)
        }
    }

    // MARK: - Login link

    private var loginLink: some View {
        Button {
            dismiss()
        } label: {
            (Text(L.t("Đã có tài khoản? ")) +
             Text(L.t("Đăng nhập")).foregroundColor(WVColor.tint).bold())
                .font(.system(size: 14))
                .foregroundStyle(WVColor.label3)
        }
    }

    // MARK: - Logic

    private var canSubmit: Bool { !email.isEmpty && password.count >= 8 }

    private func submit() async {
        topError = nil; fieldErrors = [:]
        isSubmitting = true
        defer { isSubmitting = false }
        do {
            try await auth.register(
                email: email,
                password: password,
                name: name.isEmpty ? nil : name
            )
            // AuthStore flips to .authenticated → RootView replaces LoginView automatically.
        } catch let err as APIError {
            topError = err.localizedDescription
            fieldErrors = err.fieldErrors
        } catch {
            topError = error.localizedDescription
        }
    }
}
