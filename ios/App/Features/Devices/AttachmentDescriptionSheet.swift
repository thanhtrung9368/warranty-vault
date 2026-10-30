import SwiftUI
import WarrlyKit

// ============================================================
// AttachmentDescriptionSheet — set or clear one attachment's description.
//
// `PATCH /api/v1/attachments/{id}` accepts only `description`; the file bytes
// themselves cannot be edited (delete + re-upload instead). A description
// written on Android or the web was previously decoded into
// `AttachmentMeta.description` and displayed nowhere, which is the half of this
// feature iOS was missing.
//
// Blank clears it: the request body carries an explicit `null`
// (`AttachmentDescriptionInput`), not an absent key — the contract requires the
// field and treats an absent key as a 400.
// ============================================================

struct AttachmentDescriptionSheet: View {
    let client: APIClient
    let attachment: AttachmentMeta
    let onSaved: (AttachmentMeta) -> Void

    @Environment(\.dismiss) private var dismiss

    @State private var text: String
    @State private var isSaving = false
    @State private var topError: String?
    @State private var fieldError: String?

    init(client: APIClient,
         attachment: AttachmentMeta,
         onSaved: @escaping (AttachmentMeta) -> Void) {
        self.client = client
        self.attachment = attachment
        self.onSaved = onSaved
        _text = State(initialValue: attachment.description ?? "")
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    Spacer().frame(height: 8)

                    Text(attachment.fileName)
                        .wvFont(.footnote)
                        .foregroundStyle(WVColor.label3)
                        .lineLimit(2)
                        .padding(.horizontal, 32)
                        .padding(.bottom, 6)

                    WVGroup {
                        TextField(L.t("Mô tả"), text: $text, axis: .vertical)
                            .wvFont(.body)
                            .foregroundStyle(WVColor.label)
                            .lineLimit(2...5)
                            .disabled(isSaving)
                            .accessibilityLabel(L.t("Mô tả"))
                            .padding(.horizontal, 16)
                            .frame(minHeight: 44)
                            .padding(.vertical, 10)

                        if let fieldError {
                            WVDivider()
                            Text(fieldError)
                                .wvFont(.caption)
                                .foregroundStyle(WVColor.red)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(.horizontal, 16)
                                .padding(.vertical, 8)
                        }
                    }

                    WVSectionFooter(L.t("Để trống để xoá mô tả."))

                    if let topError {
                        Text(topError)
                            .wvFont(.footnote)
                            .foregroundStyle(WVColor.red)
                            .padding(.horizontal, 32)
                            .padding(.top, 8)
                    }

                    Spacer().frame(height: 24)
                }
            }
            .wvScreen()
            .navigationTitle(L.t("Sửa mô tả"))
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
                            .wvFont(.bodyEmphasis)
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
        fieldError = nil
        isSaving = true
        defer { isSaving = false }

        // The server trims and maps blank → NULL; mirroring that here only
        // decides between a value and an explicit null.
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        do {
            let updated = try await client.updateAttachmentDescription(
                id: attachment.id,
                description: trimmed.isEmpty ? nil : trimmed
            )
            onSaved(updated)
            dismiss()
        } catch let err as APIError {
            fieldError = err.fieldErrors["description"]?.first
            if fieldError == nil {
                topError = err.localizedDescription
            }
        } catch {
            topError = L.t("Không kết nối được máy chủ.")
        }
    }
}
