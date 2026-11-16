import SwiftUI
import WarrlyKit

// ============================================================
// HandoffClaimSheet — the buyer's side ("Nhận thiết bị chuyển chủ")
//
// Reached three ways, all deliberately requiring an authenticated session:
//
//   * the paste-code entry in Devices → "+" (the canonical in-app path);
//   * `warrly://handoff/<code>`, held by `AppRouter` until the user is signed in
//     and this screen exists (the sheet lives inside the authenticated tab);
//   * the web claim page, which is the canonical link the seller sends
//     (`https://warrly.com/handoff/<code>`). The repo has no Universal Link
//     entitlement, so the web page is where a link lands; the app accepts the
//     same code pasted in.
//
// ## No one-tap claim
//
// Tapping the link never adds anything. The buyer must (1) load the preview,
// (2) read what travels — device facts, remaining warranty, selected documents,
// repair history — and (3) confirm. That is two explicit actions after opening
// the link, and the confirmation names the single-use rule.
//
// The preview is the server's safe projection; this screen never derives extra
// facts from it and never claims ownership. `HandoffCopy.disclaimer` travels on
// the preview, exactly as it does on the seller's sheet.
// ============================================================

struct HandoffClaimSheet: View {
    let client: APIClient
    /// The parent dismisses this sheet and routes to the returned device. Kept
    /// as a callback so the sheet does not have to know which navigation stack
    /// it was presented from.
    let onClaimed: (Device) -> Void

    @Environment(\.dismiss) private var dismiss

    @State private var input: String
    @State private var preview: HandoffPreview?
    @State private var busy = false
    @State private var errorMessage: String?
    @State private var showConfirm = false
    @State private var now = Date()

    init(client: APIClient, initialCode: String? = nil,
         onClaimed: @escaping (Device) -> Void) {
        self.client = client
        self.onClaimed = onClaimed
        _input = State(initialValue: initialCode ?? "")
    }

    private var typedCode: String? { HandoffRules.code(fromPasted: input) }
    private var previewExpired: Bool {
        guard let preview else { return false }
        return preview.expiresAt <= now
    }

    // MARK: - Body

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    Spacer().frame(height: WVSpacing.sm)

                    if let preview {
                        previewContent(preview)
                    } else {
                        entryContent
                    }

                    if let errorMessage {
                        WVNotice(tone: .error, message: errorMessage)
                            .padding(.horizontal, WVSpacing.gutter)
                            .padding(.top, WVSpacing.sm)
                    }

                    Spacer().frame(height: 24)
                }
            }
            .wvScreen()
            .navigationTitle(HandoffCopy.claimTitle)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button(HandoffCopy.cancelAction) { dismiss() }
                        .foregroundStyle(WVColor.tint)
                }
            }
        }
        .alert(HandoffCopy.claimConfirmTitle, isPresented: $showConfirm) {
            Button(HandoffCopy.cancelAction, role: .cancel) {}
            Button(HandoffCopy.claimAction) { Task { await claim() } }
        } message: {
            Text(HandoffCopy.claimConfirmBody)
        }
        .task {
            // A code that arrived from a link is looked up once, automatically:
            // reading the preview is not claiming, and making the buyer tap
            // "Xem thiết bị" again after tapping the link would be busywork.
            guard preview == nil, let code = typedCode else { return }
            await loadPreview(code)
        }
    }

    // MARK: - Step 1: the code

    private var entryContent: some View {
        VStack(alignment: .leading, spacing: 14) {
            WVCard(padding: 16) {
                VStack(alignment: .leading, spacing: 12) {
                    HStack(spacing: 10) {
                        WVLeadingIcon(icon: "userPlus", color: WVColor.blue, size: 34)
                        Text(HandoffCopy.claimTitle)
                            .wvFont(.bodyEmphasis)
                            .foregroundStyle(WVColor.label)
                        Spacer(minLength: 0)
                    }
                    Text(HandoffCopy.pasteHint)
                        .wvFont(.subheadline)
                        .foregroundStyle(WVColor.label2)
                        .fixedSize(horizontal: false, vertical: true)

                    VStack(alignment: .leading, spacing: 6) {
                        Text(HandoffCopy.codeFieldLabel)
                            .wvFont(.footnoteEmphasis)
                            .foregroundStyle(WVColor.label2)
                        TextField(HandoffCopy.codeFieldPlaceholder, text: $input)
                            .font(.system(size: 24, weight: .bold, design: .monospaced))
                            .textInputAutocapitalization(.characters)
                            .autocorrectionDisabled()
                            .keyboardType(.asciiCapable)
                            .padding(12)
                            .background(WVColor.fill3)
                            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                            .onChange(of: input) { _, _ in
                                // A new code invalidates the error of the last one.
                                errorMessage = nil
                            }
                        if !input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                           typedCode == nil {
                            Text(HandoffCopy.invalidCode)
                                .wvFont(.caption)
                                .foregroundStyle(WVColor.red)
                        }
                    }

                    WVButton(busy ? HandoffCopy.previewingAction : HandoffCopy.previewAction,
                             icon: "search",
                             kind: .primary,
                             fullWidth: true) {
                        guard let code = typedCode else {
                            errorMessage = HandoffCopy.invalidCode
                            return
                        }
                        Task { await loadPreview(code) }
                    }
                    .disabled(busy || typedCode == nil)
                }
            }

            // The same sentence the seller's sheet carries. It is the buyer who
            // is most likely to read this feature as a transfer of title.
            WVNotice(tone: .info, message: HandoffCopy.disclaimer)
                .padding(.horizontal, WVSpacing.gutter)
        }
    }

    // MARK: - Step 2: the preview

    private func previewContent(_ loaded: HandoffPreview) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            WVCard(padding: 16) {
                VStack(alignment: .leading, spacing: 10) {
                    HStack(spacing: 10) {
                        WVLeadingIcon(icon: "box", color: WVColor.blue, size: 34)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(loaded.device.name)
                                .wvFont(.bodyEmphasis)
                                .foregroundStyle(WVColor.label)
                                .fixedSize(horizontal: false, vertical: true)
                            Text(deviceSubtitle(loaded.device))
                                .wvFont(.footnote)
                                .foregroundStyle(WVColor.label3)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        Spacer(minLength: 0)
                    }

                    if let seller = loaded.sellerName, !seller.isEmpty {
                        Text(HandoffCopy.sellerLine(seller))
                            .wvFont(.subheadline)
                            .foregroundStyle(WVColor.label2)
                    }

                    Text(HandoffCopy.expiresLine(WVFormat.date(loaded.expiresAt))
                         + remainingSuffix(loaded))
                        .wvFont(.caption)
                        .foregroundStyle(previewExpired ? WVColor.red : WVColor.label3)

                    WVNotice(tone: .info, message: HandoffCopy.disclaimer)
                }
            }

            WVSectionHeader(L.t("Thông tin thiết bị"))
            WVGroup {
                if let purchaseDate = wireDay(loaded.device.purchaseDate) {
                    DeviceFactRow(icon: "calendar",
                                  title: HandoffCopy.purchaseDateLabel,
                                  detail: purchaseDate)
                }
                if let serial = loaded.device.serialMasked, !serial.isEmpty {
                    if wireDay(loaded.device.purchaseDate) != nil { WVDivider() }
                    DeviceFactRow(icon: "hash",
                                  title: HandoffCopy.serialLabel,
                                  detail: serial)
                }
                if let category = loaded.device.category, !category.isEmpty {
                    if wireDay(loaded.device.purchaseDate) != nil || loaded.device.serialMasked != nil {
                        WVDivider()
                    }
                    DeviceFactRow(icon: "layout",
                                  title: L.t("Loại"),
                                  detail: CategoryLabels.label(for: category))
                }
            }

            // Remaining warranty
            WVSectionHeader(HandoffCopy.remainingWarrantyTitle)
            let warranties = loaded.warranties ?? []
            if warranties.isEmpty {
                WVSectionFooter(HandoffCopy.noWarranty)
            } else {
                WVGroup {
                    ForEach(Array(warranties.enumerated()), id: \.offset) { index, warranty in
                        if index > 0 { WVDivider() }
                        warrantyRow(warranty)
                    }
                }
            }

            // Selected documents
            let documents = loaded.attachments ?? []
            WVSectionHeader(HandoffCopy.documentsTitle(documents.count))
            if documents.isEmpty {
                WVSectionFooter(HandoffCopy.noDocuments)
            } else {
                WVGroup {
                    ForEach(Array(documents.enumerated()), id: \.offset) { index, document in
                        if index > 0 { WVDivider() }
                        HStack(spacing: WVSpacing.md) {
                            WVLeadingIcon(icon: "receipt", size: 28)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(document.fileName)
                                    .wvFont(.body)
                                    .foregroundStyle(WVColor.label)
                                    .lineLimit(2)
                                Text(HandoffCopy.documentMeta(document.mimeType,
                                                               document.sizeBytes))
                                    .wvFont(.caption)
                                    .foregroundStyle(WVColor.label3)
                            }
                            Spacer(minLength: 0)
                        }
                        .padding(.horizontal, WVSpacing.gutter)
                        .padding(.vertical, WVSpacing.sm)
                        .frame(minHeight: 44)
                    }
                }
            }

            // Repair history (the "condition / repair facts" that travel)
            let claims = loaded.claims ?? []
            WVSectionHeader(HandoffCopy.repairsTitle(claims.count))
            if claims.isEmpty {
                WVSectionFooter(HandoffCopy.noRepairs)
            } else {
                WVGroup {
                    ForEach(Array(claims.enumerated()), id: \.offset) { index, claim in
                        if index > 0 { WVDivider() }
                        repairRow(claim)
                    }
                }
            }

            // Claim action
            VStack(alignment: .leading, spacing: 8) {
                if previewExpired {
                    WVNotice(tone: .warning, message: HandoffCopy.deadCode)
                }
                WVButton(busy ? HandoffCopy.claimingAction : HandoffCopy.claimAction,
                         icon: "download",
                         kind: .primary,
                         fullWidth: true) {
                    showConfirm = true
                }
                .disabled(busy || previewExpired)

                Button(L.t("Đổi mã khác")) {
                    self.preview = nil
                    errorMessage = nil
                }
                .wvFont(.subheadlineEmphasis)
                .foregroundStyle(WVColor.tint)
                .frame(maxWidth: .infinity)
            }
            .padding(.horizontal, WVSpacing.gutter)
            .padding(.top, WVSpacing.lg)
        }
    }

    private func warrantyRow(_ warranty: HandoffPreviewWarranty) -> some View {
        HStack(spacing: WVSpacing.md) {
            WVLeadingIcon(icon: "shieldCheck", size: 28)
            VStack(alignment: .leading, spacing: 2) {
                Text(warranty.typeLabel)
                    .wvFont(.body)
                    .foregroundStyle(WVColor.label)
                Text(warrantyDates(warranty))
                    .wvFont(.caption)
                    .foregroundStyle(WVColor.label3)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
            if let status = warrantyStatusLabel(warranty.status) {
                Text(status)
                    .wvFont(.footnote)
                    .foregroundStyle(WVColor.label3)
            }
        }
        .padding(.horizontal, WVSpacing.gutter)
        .padding(.vertical, WVSpacing.sm)
        .frame(minHeight: 44)
    }

    private func repairRow(_ claim: HandoffPreviewClaim) -> some View {
        HStack(alignment: .top, spacing: WVSpacing.md) {
            WVLeadingIcon(icon: "wrench", size: 28)
            VStack(alignment: .leading, spacing: 2) {
                Text(claimStatusLabel(claim.status))
                    .wvFont(.body)
                    .foregroundStyle(WVColor.label)
                Text(repairDates(claim))
                    .wvFont(.caption)
                    .foregroundStyle(WVColor.label3)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
            if claim.coveredByWarranty == true {
                Text(L.t("Bảo hành chi trả"))
                    .wvFont(.footnote)
                    .foregroundStyle(WVColor.label3)
            }
        }
        .padding(.horizontal, WVSpacing.gutter)
        .padding(.vertical, WVSpacing.sm)
        .frame(minHeight: 44)
    }

    // MARK: - Networking

    private func loadPreview(_ code: String) async {
        busy = true
        errorMessage = nil
        defer { busy = false }
        do {
            let loaded = try await client.previewHandoff(code: code)
            now = Date()
            input = loaded.code
            preview = loaded
        } catch {
            let (status, _, message) = apiFailure(error)
            preview = nil
            errorMessage = HandoffRules.claimFailureMessage(status: status,
                                                            serverMessage: message,
                                                            fallback: HandoffCopy.previewFailed)
        }
    }

    private func claim() async {
        guard let preview else { return }
        busy = true
        errorMessage = nil
        defer { busy = false }
        do {
            let result = try await client.claimHandoff(code: preview.code)
            // The parent dismisses and pushes the new device; this sheet must
            // not also dismiss, or the two presentations race.
            onClaimed(result.device)
        } catch {
            let (status, _, message) = apiFailure(error)
            errorMessage = HandoffRules.claimFailureMessage(status: status,
                                                            serverMessage: message,
                                                            fallback: HandoffCopy.claimFailed)
        }
    }

    private func apiFailure(_ error: Error) -> (Int?, String?, String?) {
        if let api = error as? APIError, case let .server(status, envelope) = api {
            return (status, envelope.error, envelope.message)
        }
        return (nil, nil, (error as? APIError)?.localizedDescription)
    }

    // MARK: - Small formatting helpers

    private func deviceSubtitle(_ device: HandoffPreviewDevice) -> String {
        [device.brand, device.model]
            .compactMap { $0 }
            .filter { !$0.isEmpty }
            .joined(separator: " · ")
    }

    private func remainingSuffix(_ preview: HandoffPreview) -> String {
        guard let remaining = HandoffRules.remainingLabel(expiresAt: preview.expiresAt, now: now)
        else { return "" }
        return " (\(remaining))"
    }

    /// `YYYY-MM-DD` → `dd/MM/yyyy`, without ever parsing a wire instant.
    private func wireDay(_ wire: String?) -> String? {
        guard let day = DeviceReturnWindow.dayPrefix(wire) else { return nil }
        let parts = day.split(separator: "-")
        guard parts.count == 3 else { return nil }
        return "\(parts[2])/\(parts[1])/\(parts[0])"
    }

    private func warrantyDates(_ warranty: HandoffPreviewWarranty) -> String {
        let start = wireDay(warranty.startDate)
        let end = wireDay(warranty.endDate)
        switch (start, end) {
        case let (start?, end?): return L.t("%@ – %@", start, end)
        case let (_, end?):      return HandoffCopy.expiryLine(end)
        case let (start?, _):    return start
        default:                 return ""
        }
    }

    private func repairDates(_ claim: HandoffPreviewClaim) -> String {
        let opened = wireDay(claim.openedAt)
        let closed = wireDay(claim.closedAt)
        switch (opened, closed) {
        case let (opened?, closed?): return L.t("%@ – %@", opened, closed)
        case let (opened?, nil):     return L.t("Mở ngày %@", opened)
        case let (nil, closed?):     return L.t("Đóng ngày %@", closed)
        default:                     return ""
        }
    }

    private func claimStatusLabel(_ raw: String?) -> String {
        guard let raw, let status = ClaimStatus(rawValue: raw.uppercased()) else {
            return L.t("Sửa chữa")
        }
        return status.label
    }

    private func warrantyStatusLabel(_ raw: String?) -> String? {
        switch (raw ?? "").trimmingCharacters(in: .whitespacesAndNewlines).uppercased() {
        case "ACTIVE":   return L.t("Còn hiệu lực")
        case "EXPIRED":  return L.t("Đã hết hạn")
        case "":         return nil
        default:         return nil
        }
    }
}
