import SwiftUI
import WarrantyVaultKit

/// Đăng ký tài khoản mới. Mirrors LoginView styling (gradient backdrop, WVCard,
/// WVTextField, HeroPrimaryButtonStyle) and the web form at /register
/// (`src/components/auth-form.tsx`) — fields: tên hiển thị, email, mật khẩu.
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
                    colors: [WV.Tokens.primary.opacity(0.15), WV.Tokens.bg],
                    startPoint: .topLeading, endPoint: .bottomTrailing
                ).ignoresSafeArea()

                ScrollView {
                    VStack(spacing: WV.Spacing.xl) {
                        Spacer().frame(height: 24)
                        header
                        formCard
                    }
                    .padding(WV.Spacing.lg)
                    .frame(maxWidth: 480)
                }
            }
            .scrollDismissesKeyboard(.interactively)
            .navigationTitle("Đăng ký")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Đóng") { dismiss() }
                }
            }
        }
    }

    private var header: some View {
        VStack(spacing: WV.Spacing.md) {
            ZStack {
                Circle()
                    .fill(WV.Tokens.primary.opacity(0.14))
                    .frame(width: 88, height: 88)
                Image(systemName: "person.crop.circle.badge.plus")
                    .font(.system(size: 40, weight: .semibold))
                    .foregroundStyle(WV.Tokens.primary)
            }
            .shadow(color: WV.Tokens.primary.opacity(0.18), radius: 18, y: 8)

            VStack(spacing: 6) {
                Text("Tạo tài khoản miễn phí")
                    .font(.title2.bold())
                    .tracking(-0.5)
                    .foregroundStyle(WV.Tokens.fg)
                    .multilineTextAlignment(.center)
                Text("Đăng ký mất 30 giây. Không thẻ tín dụng, không quảng cáo.")
                    .font(.system(size: 13))
                    .foregroundStyle(WV.Tokens.mutedFg)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, WV.Spacing.md)
            }
        }
    }

    private var formCard: some View {
        WVCard {
            VStack(spacing: WV.Spacing.md) {
                WVTextField(
                    "Tên hiển thị", placeholder: "vd: Trung",
                    text: $name,
                    contentType: .name,
                    error: fieldErrors["name"]?.first
                )
                WVTextField(
                    "Email", placeholder: "ban@example.com",
                    text: $email,
                    keyboardType: .emailAddress, contentType: .emailAddress,
                    error: fieldErrors["email"]?.first
                )
                WVTextField(
                    "Mật khẩu",
                    placeholder: "Tối thiểu 8 ký tự",
                    text: $password,
                    contentType: .newPassword,
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
                        Text("Tạo tài khoản")
                    }
                }
                .buttonStyle(HeroPrimaryButtonStyle(fullWidth: true))
                .disabled(isSubmitting || !canSubmit)
                .padding(.top, WV.Spacing.sm)

                Button(action: { dismiss() }) {
                    Text("Đã có tài khoản? Đăng nhập")
                }
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(WV.Tokens.primary)
                .padding(.top, 2)
            }
        }
    }

    private var canSubmit: Bool {
        !email.isEmpty && password.count >= 8
    }

    private func submit() async {
        topError = nil; fieldErrors = [:]
        isSubmitting = true
        defer { isSubmitting = false }
        do {
            try await auth.register(
                email: email, password: password,
                name: name.isEmpty ? nil : name
            )
            // Đăng ký thành công — AuthStore chuyển sang .authenticated,
            // root view sẽ tự thay LoginView; không cần dismiss thủ công.
        } catch let err as APIError {
            topError = err.localizedDescription
            fieldErrors = err.fieldErrors
        } catch {
            topError = error.localizedDescription
        }
    }
}
