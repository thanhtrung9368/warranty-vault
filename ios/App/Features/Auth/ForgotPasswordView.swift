import SwiftUI
import WarrantyVaultKit

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
            .navigationTitle("Quên mật khẩu")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Đóng") { dismiss() }
                }
            }
        }
    }

    private var header: some View {
        VStack(spacing: 8) {
            Image(systemName: "key.horizontal.fill")
                .font(.system(size: 44, weight: .light))
                .foregroundStyle(WV.Tokens.primary)
            Text("Đặt lại mật khẩu")
                .font(.system(size: 22, weight: .bold))
                .foregroundStyle(WV.Tokens.fg)
            Text("Nhập email đã đăng ký để nhận link đặt lại.")
                .font(.system(size: 13))
                .foregroundStyle(WV.Tokens.mutedFg)
                .multilineTextAlignment(.center)
        }
    }

    private var formCard: some View {
        WVCard {
            VStack(spacing: WV.Spacing.md) {
                if didSend {
                    Label(
                        "Nếu email đã đăng ký, link đặt lại mật khẩu đã được gửi. Hãy kiểm tra hộp thư.",
                        systemImage: "envelope.badge"
                    )
                    .font(.system(size: 14))
                    .foregroundStyle(WV.Tokens.fg)
                    .frame(maxWidth: .infinity, alignment: .leading)

                    Button(action: { dismiss() }) {
                        Text("Quay lại đăng nhập")
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    .padding(.top, WV.Spacing.sm)
                } else {
                    WVTextField(
                        "Email", placeholder: "you@example.com",
                        text: $email,
                        keyboardType: .emailAddress, contentType: .emailAddress
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
                            Text("Gửi")
                        }
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(isSubmitting || email.isEmpty)
                    .padding(.top, WV.Spacing.sm)

                    Button(action: { dismiss() }) {
                        Text("Quay lại đăng nhập")
                    }
                    .buttonStyle(SecondaryButtonStyle())
                }
            }
        }
    }

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
