import SwiftUI
import WarrantyVaultKit

struct ChangePasswordSheet: View {
    let client: APIClient

    @Environment(\.dismiss) private var dismiss

    @State private var currentPassword = ""
    @State private var newPassword = ""
    @State private var confirmPassword = ""

    @State private var isSubmitting = false
    @State private var topError: String?
    @State private var fieldErrors: [String: [String]] = [:]
    @State private var successMessage: String?

    var body: some View {
        NavigationStack {
            Form {
                Section(header: sectionHeader("Mật khẩu hiện tại")) {
                    secureField("Mật khẩu hiện tại", text: $currentPassword)
                    if let msg = fieldErrors["currentPassword"]?.first {
                        Text(msg)
                            .font(.system(size: 12))
                            .foregroundStyle(WV.Tokens.destructive)
                    }
                }

                Section(header: sectionHeader("Mật khẩu mới")) {
                    secureField("Mật khẩu mới (≥8 ký tự)", text: $newPassword)
                    if let msg = fieldErrors["newPassword"]?.first {
                        Text(msg)
                            .font(.system(size: 12))
                            .foregroundStyle(WV.Tokens.destructive)
                    }
                    secureField("Xác nhận mật khẩu mới", text: $confirmPassword)
                    if let msg = fieldErrors["confirmPassword"]?.first {
                        Text(msg)
                            .font(.system(size: 12))
                            .foregroundStyle(WV.Tokens.destructive)
                    }
                }

                if let topError {
                    Section {
                        Label(topError, systemImage: "exclamationmark.triangle.fill")
                            .foregroundStyle(WV.Tokens.destructive)
                            .font(.system(size: 13))
                    }
                }

                if let successMessage {
                    Section {
                        Label(successMessage, systemImage: "checkmark.circle.fill")
                            .foregroundStyle(WV.Tokens.success)
                            .font(.system(size: 13))
                    }
                }
            }
            .navigationTitle("Đổi mật khẩu")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Huỷ") { dismiss() }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button { Task { await submit() } } label: {
                        if isSubmitting { ProgressView() } else { Text("Lưu").bold() }
                    }
                    .disabled(isSubmitting || !canSubmit)
                }
            }
        }
    }

    private var canSubmit: Bool {
        !currentPassword.isEmpty && newPassword.count >= 8 && !confirmPassword.isEmpty
    }

    private func secureField(_ placeholder: String, text: Binding<String>) -> some View {
        SecureField(placeholder, text: text)
            .textContentType(.password)
            .autocorrectionDisabled()
            .textInputAutocapitalization(.never)
    }

    private func submit() async {
        topError = nil
        fieldErrors = [:]
        successMessage = nil
        isSubmitting = true
        defer { isSubmitting = false }

        // Client-side guard mirrors the server schema so we surface the right
        // field message instantly without a round-trip.
        if newPassword != confirmPassword {
            fieldErrors["confirmPassword"] = ["Xác nhận mật khẩu không khớp"]
            return
        }

        do {
            let input = ChangePasswordInput(
                currentPassword: currentPassword,
                newPassword: newPassword,
                confirmPassword: confirmPassword
            )
            let result = try await client.changePassword(input)
            successMessage = result.message ?? "Đã đổi mật khẩu thành công"
            try? await Task.sleep(nanoseconds: 800_000_000)
            dismiss()
        } catch let err as APIError {
            fieldErrors = err.fieldErrors
            // If a field error exists we don't need a top banner — but if the
            // server only sent a top-level message (e.g. 429 rate-limit) keep it.
            if fieldErrors.isEmpty {
                topError = err.localizedDescription
            }
        } catch {
            topError = error.localizedDescription
        }
    }
}
