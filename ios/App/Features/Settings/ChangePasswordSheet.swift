import SwiftUI
import WarrantyVaultKit

// ============================================================
// ChangePasswordSheet — Đổi mật khẩu bottom sheet.
// Restyled to use WVGroup / WVButton from the new design system.
// Data wiring is preserved from the previous version.
// ============================================================

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
            ScrollView {
                VStack(spacing: 0) {
                    Spacer().frame(height: 12)

                    // Current password
                    WVSectionHeader(L.t("Mật khẩu hiện tại"))
                    WVGroup {
                        CPSecureRow(L.t("Mật khẩu hiện tại"), text: $currentPassword)
                    }
                    if let msg = fieldErrors["currentPassword"]?.first {
                        WVSectionFooter(msg)
                            .foregroundStyle(WVColor.red)
                    }

                    // New password
                    WVSectionHeader(L.t("Mật khẩu mới"))
                    WVGroup {
                        CPSecureRow(L.t("Mật khẩu mới (≥8 ký tự)"), text: $newPassword)
                        WVDivider(inset: 16)
                        CPSecureRow(L.t("Xác nhận mật khẩu mới"), text: $confirmPassword)
                    }
                    if let msg = fieldErrors["newPassword"]?.first {
                        WVSectionFooter(msg)
                            .foregroundStyle(WVColor.red)
                    }
                    if let msg = fieldErrors["confirmPassword"]?.first {
                        WVSectionFooter(msg)
                            .foregroundStyle(WVColor.red)
                    }

                    // Error / success banner
                    if let topError {
                        HStack(spacing: 8) {
                            WVIcon("alert", size: 14)
                            Text(topError)
                                .font(.system(size: 13))
                        }
                        .foregroundStyle(WVColor.red)
                        .padding(.horizontal, WVSpacing.gutter)
                        .padding(.top, 12)
                    }
                    if let successMessage {
                        HStack(spacing: 8) {
                            WVIcon("checkCircle", size: 14)
                            Text(successMessage)
                                .font(.system(size: 13))
                        }
                        .foregroundStyle(WVColor.green)
                        .padding(.horizontal, WVSpacing.gutter)
                        .padding(.top, 12)
                    }

                    Spacer().frame(height: 20)

                    WVButton(
                        isSubmitting ? L.t("Đang lưu…") : L.t("Lưu mật khẩu"),
                        icon: isSubmitting ? nil : "save",
                        kind: .primary
                    ) {
                        Task { await submit() }
                    }
                    .padding(.horizontal, WVSpacing.gutter)
                    .disabled(isSubmitting || !canSubmit)

                    Spacer().frame(height: 24)
                }
            }
            .wvScreen()
            .navigationTitle(L.t("Đổi mật khẩu"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button(L.t("Huỷ")) { dismiss() }
                        .foregroundStyle(WVColor.tint)
                }
            }
        }
    }

    // MARK: - Logic

    private var canSubmit: Bool {
        !currentPassword.isEmpty && newPassword.count >= 8 && !confirmPassword.isEmpty
    }

    private func submit() async {
        topError = nil
        fieldErrors = [:]
        successMessage = nil
        isSubmitting = true
        defer { isSubmitting = false }

        if newPassword != confirmPassword {
            fieldErrors["confirmPassword"] = [L.t("Xác nhận mật khẩu không khớp")]
            return
        }

        do {
            let input = ChangePasswordInput(
                currentPassword: currentPassword,
                newPassword: newPassword,
                confirmPassword: confirmPassword
            )
            let result = try await client.changePassword(input)
            successMessage = result.message ?? L.t("Đã đổi mật khẩu thành công")
            try? await Task.sleep(nanoseconds: 800_000_000)
            dismiss()
        } catch let err as APIError {
            fieldErrors = err.fieldErrors
            if fieldErrors.isEmpty {
                topError = err.localizedDescription
            }
        } catch {
            topError = error.localizedDescription
        }
    }
}

// MARK: - Private helper row

private struct CPSecureRow: View {
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
