import SwiftUI
import WarrlyKit

// ============================================================
// DisplayNameSheet — edit the account's display name.
//
// One field, one `PATCH /api/v1/auth/me`. The account EMAIL is not here on
// purpose: changing it is its own password-gated two-step flow
// (`EmailChangeSheet`), and `PATCH /auth/me` accepts only `displayName` and
// `locale` — a body carrying an email is a 400.
//
// The server owns the rules this sheet deliberately does not re-implement:
//  - the 80-**byte** UTF-8 cap (~26 Vietnamese characters) is not checked
//    locally; an over-long name comes back as `fieldErrors.displayName` and is
//    shown verbatim under the field, so the limit cannot drift from the server;
//  - blank / whitespace-only clears the name — "Để trống để xoá tên".
// ============================================================

struct DisplayNameSheet: View {
    @ObservedObject var auth: AuthStore
    let currentName: String

    @Environment(\.dismiss) private var dismiss

    @State private var name: String
    @State private var isSaving = false
    @State private var topError: String?
    @State private var nameError: String?

    init(auth: AuthStore, currentName: String) {
        self.auth = auth
        self.currentName = currentName
        _name = State(initialValue: currentName)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 0) {
                    Spacer().frame(height: 8)

                    WVGroup {
                        TextField(L.t("Tên hiển thị"), text: $name)
                            .font(.system(size: 17))
                            .foregroundStyle(WVColor.label)
                            .textInputAutocapitalization(.words)
                            .autocorrectionDisabled()
                            .submitLabel(.done)
                            .onSubmit { Task { await save() } }
                            .disabled(isSaving)
                            .accessibilityLabel(L.t("Tên hiển thị"))
                            .padding(.horizontal, 16)
                            .frame(minHeight: 44)
                            .padding(.vertical, 7)

                        if let nameError {
                            WVDivider()
                            Text(nameError)
                                .font(.system(size: 12))
                                .foregroundStyle(WVColor.red)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(.horizontal, 16)
                                .padding(.vertical, 8)
                        }
                    }

                    WVSectionFooter(L.t("Để trống để xoá tên. Tối đa 80 byte (~26 ký tự tiếng Việt)."))

                    if let topError {
                        Text(topError)
                            .font(.system(size: 13))
                            .foregroundStyle(WVColor.red)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, 32)
                            .padding(.top, 8)
                    }

                    Spacer().frame(height: 24)
                }
            }
            .wvScreen()
            .navigationTitle(L.t("Tên hiển thị"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button(L.t("Huỷ")) { dismiss() }
                        .foregroundStyle(WVColor.tint)
                        .disabled(isSaving)
                }
                ToolbarItem(placement: .topBarTrailing) {
                    if isSaving {
                        ProgressView()
                    } else {
                        Button(L.t("Lưu")) { Task { await save() } }
                            .font(.system(size: 17, weight: .semibold))
                            .foregroundStyle(WVColor.tint)
                    }
                }
            }
        }
        .presentationDetents([.medium])
    }

    private func save() async {
        guard !isSaving else { return }
        topError = nil
        nameError = nil
        isSaving = true
        defer { isSaving = false }
        do {
            try await auth.updateDisplayName(name)
            dismiss()
        } catch let err as APIError {
            // Field-level copy wins: the server explains the 80-byte cap in
            // Vietnamese and the message belongs under the field it is about.
            nameError = err.fieldErrors["displayName"]?.first
            if nameError == nil {
                topError = err.localizedDescription
            }
        } catch {
            topError = L.t("Không kết nối được máy chủ.")
        }
    }
}
