import SwiftUI
import WarrantyVaultKit

// ============================================================
// ForgotPasswordView — Đặt lại mật khẩu.
// Presented as a sheet from LoginView.
// ============================================================

struct ForgotPasswordView: View {
    @Environment(\.dismiss) private var dismiss

    let client: APIClient

    @State private var email = ""
    @State private var isSubmitting = false
    @State private var topError: String?
    @State private var didSend = false

    var body: some View {
        NavigationStack {
            ZStack {
                LinearGradient(
                    colors: [WVColor.brand.opacity(0.12), WVColor.bg],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
                .ignoresSafeArea()

                ScrollView {
                    VStack(spacing: 0) {
                        Spacer().frame(height: 40)
                        forgotHeader
                        Spacer().frame(height: 28)
                        if didSend {
                            successSection
                        } else {
                            formSection
                        }
                        Spacer().frame(height: 32)
                    }
                    .padding(.horizontal, WVSpacing.gutter)
                    .frame(maxWidth: 480)
                    .frame(maxWidth: .infinity)
                }
            }
            .scrollDismissesKeyboard(.interactively)
            .navigationTitle(L.t("Quên mật khẩu"))
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

    private var forgotHeader: some View {
        VStack(spacing: 12) {
            ZStack {
                Circle()
                    .fill(WVColor.brandSoft)
                    .frame(width: 80, height: 80)
                Image(systemName: "key.horizontal.fill")
                    .font(.system(size: 36, weight: .regular))
                    .foregroundStyle(WVColor.brand)
            }
            Text(L.t("Đặt lại mật khẩu"))
                .font(.system(size: 22, weight: .bold))
                .foregroundStyle(WVColor.label)
            Text(L.t("Nhập email đã đăng ký để nhận link đặt lại."))
                .font(.system(size: 13))
                .foregroundStyle(WVColor.label3)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 16)
        }
    }

    // MARK: - Form

    private var formSection: some View {
        VStack(spacing: 0) {
            WVGroup {
                AuthTextField(
                    label: "Email",
                    placeholder: "you@example.com",
                    text: $email,
                    keyboardType: .emailAddress,
                    contentType: .emailAddress,
                    error: nil
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
                isSubmitting ? L.t("Đang gửi…") : L.t("Gửi"),
                kind: .primary
            ) {
                Task { await submit() }
            }
            .disabled(isSubmitting || email.isEmpty)

            Spacer().frame(height: 10)

            WVButton(L.t("Quay lại đăng nhập"), kind: .secondary) {
                dismiss()
            }
        }
    }

    // MARK: - Success

    private var successSection: some View {
        VStack(spacing: 16) {
            WVGroup {
                HStack(spacing: 12) {
                    WVLeadingIcon(icon: "mail", color: WVColor.green)
                    Text(L.t("Nếu email đã đăng ký, link đặt lại mật khẩu đã được gửi. Hãy kiểm tra hộp thư."))
                        .font(.system(size: 14))
                        .foregroundStyle(WVColor.label)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 14)
            }

            WVButton(L.t("Quay lại đăng nhập"), kind: .primary) {
                dismiss()
            }
        }
    }

    // MARK: - Logic

    private func submit() async {
        topError = nil
        isSubmitting = true
        defer { isSubmitting = false }
        do {
            try await client.forgotPassword(email: email)
            didSend = true
        } catch let err as APIError {
            topError = err.localizedDescription
        } catch {
            topError = error.localizedDescription
        }
    }
}
