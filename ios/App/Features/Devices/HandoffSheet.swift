import SwiftUI
import UIKit
import WarrlyKit

// ============================================================
// HandoffSheet — "Chuyển chủ thiết bị" (Warrly 2.0 resale handoff)
//
// The seller's side of the handoff contract. It creates a 6-character code that
// is the only thing standing between the buyer and a copy of this device's
// record, then shows that code exactly once.
//
// ## The one-time rule, inherited from the share certificate
//
// `POST /devices/{id}/handoff` is the **only** response that carries `code` and
// `claimPath`; Go stores just the sha256. `GET /devices/{id}/handoff` explains
// the row's status but cannot reproduce the credential. So the surface that
// shows it:
//
//   1. says the stakes in its title, before the body is read;
//   2. puts the warning above the code, in the same view;
//   3. puts copy/share **before** the only dismiss control;
//   4. refuses swipe-dismiss and keeps "Đóng" disabled until the code was copied
//      or acknowledged, with the reason printed next to the disabled control;
//   5. holds the code in `@State` only — never Keychain, a file or a log.
//
// If the seller does close without saving, the remedy is stated plainly: the
// code cannot be re-read, so cancel the row (device-scoped `DELETE`) and mint a
// new one, subject to the 1-per-30-days rule.
//
// ## What this screen must not imply
//
// The handoff moves DATA. It is not a title document, not an escrow and not a
// payment. `HandoffCopy.disclaimer` is rendered on the sheet itself, and the
// same sentence is on the buyer's preview and on the device row afterwards.
// ============================================================

struct HandoffSheet: View {
    let client: APIClient
    let device: Device
    /// Called after a cancel (or a successful create) so the device screen can
    /// re-read its row — the seller's device becomes SOLD only when the buyer
    /// claims, not here, but a cancel changes the status card.
    var onChanged: () -> Void = {}

    @Environment(\.dismiss) private var dismiss

    /// The device's receipts. Selection is explicit and starts EMPTY: the
    /// contract says the seller selects what travels, and a receipt can show a
    /// price, so nothing is opted in on the seller's behalf.
    @StateObject private var attachmentsModel: DeviceAttachmentsModel

    @State private var phase: Phase = .loading
    @State private var selectedAttachmentIds: Set<String> = []
    @State private var nextAllowedAt: Date?
    @State private var creating = false
    @State private var cancelling = false
    @State private var errorMessage: String?
    @State private var showCancelConfirm = false
    @State private var copiedCode = false
    @State private var copiedLink = false
    @State private var acknowledged = false
    /// One instant for the whole sheet so the countdown and the status card
    /// cannot disagree about "today".
    @State private var now = Date()

    init(client: APIClient, device: Device, onChanged: @escaping () -> Void = {}) {
        self.client = client
        self.device = device
        self.onChanged = onChanged
        _attachmentsModel = StateObject(
            wrappedValue: DeviceAttachmentsModel(client: client, deviceId: device.id)
        )
    }

    /// `loading` → `ready` (latest row, no credential) → `created` (the one
    /// reveal). `failed` keeps the retry on screen instead of pretending there
    /// is nothing to hand off.
    private enum Phase {
        case loading
        case ready(DeviceHandoff?)
        case created(DeviceHandoff, URL?)
        case failed(String)
    }

    private var created: (handoff: DeviceHandoff, url: URL?)? {
        if case let .created(handoff, url) = phase { return (handoff, url) }
        return nil
    }

    private var isCreated: Bool { created != nil }
    private var canCloseCreated: Bool { copiedCode || copiedLink || acknowledged }

    private var orderedSelectionIds: [String] {
        attachmentsModel.attachments
            .filter { selectedAttachmentIds.contains($0.id) }
            .map(\.id)
    }

    // MARK: - Body

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    Spacer().frame(height: WVSpacing.sm)

                    switch phase {
                    case .loading:
                        ProgressView()
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, WVSpacing.xl)
                    case .failed(let message):
                        failureState(message)
                    case .ready(nil):
                        introCard
                        receiptsCard
                        rulesCard
                        createCard
                    case .ready(.some(let handoff)):
                        existingCard(handoff)
                        // An OPEN row cannot be replaced from here: the
                        // credential is gone and the server answers 409. The
                        // seller cancels first, then the create path returns.
                        if !handoff.status.isOpen {
                            introCard
                                .padding(.top, WVSpacing.md)
                            receiptsCard
                            rulesCard
                            createCard
                        }
                    case .created(let handoff, let url):
                        createdCard(handoff: handoff, url: url)
                    }

                    if let errorMessage, !isCreated {
                        WVNotice(tone: .error, message: errorMessage)
                            .padding(.horizontal, WVSpacing.gutter)
                            .padding(.top, WVSpacing.sm)
                    }

                    Spacer().frame(height: 24)
                }
            }
            .wvScreen()
            .navigationTitle(HandoffCopy.sheetTitle)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if !isCreated {
                    ToolbarItem(placement: .topBarLeading) {
                        // "Đóng", not "Huỷ": this control closes the sheet, while
                        // "Huỷ mã chuyển chủ" revokes the code. Two destructive
                        // meanings under one word is how the wrong one gets tapped.
                        Button(HandoffCopy.closeAction) { dismiss() }
                            .foregroundStyle(WVColor.tint)
                    }
                }
            }
        }
        // The created phase IS the credential. Swipe-to-dismiss there would
        // destroy it as surely as a close button would.
        .interactiveDismissDisabled(isCreated)
        .task {
            // Sequential on purpose: the receipts read is small, and running two
            // unstructured child tasks from a sheet's `.task` buys nothing here.
            await loadHandoff()
            await attachmentsModel.loadIfNeeded()
        }
        .alert(HandoffCopy.cancelTitle, isPresented: $showCancelConfirm) {
            Button(HandoffCopy.cancelAction, role: .cancel) {}
            Button(HandoffCopy.cancelOpen, role: .destructive) {
                Task { await cancelExisting() }
            }
        } message: {
            Text(HandoffCopy.cancelConfirm)
        }
    }

    // MARK: - Intro + rules

    private var introCard: some View {
        WVCard(padding: 16) {
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 10) {
                    WVLeadingIcon(icon: "send", color: WVColor.blue, size: 34)
                    Text(HandoffCopy.sheetTitle)
                        .wvFont(.bodyEmphasis)
                        .foregroundStyle(WVColor.label)
                    Spacer(minLength: 0)
                }
                Text(HandoffCopy.intro)
                    .wvFont(.subheadline)
                    .foregroundStyle(WVColor.label2)
                    .fixedSize(horizontal: false, vertical: true)

                bulletList(title: HandoffCopy.travelsTitle,
                           lines: HandoffCopy.travels,
                           icon: "check", color: WVColor.green)
                bulletList(title: HandoffCopy.neverTitle,
                           lines: HandoffCopy.never,
                           icon: "shieldX", color: WVColor.label3)

                // The sentence that keeps this from reading as a title transfer
                // or a payment. It is not fine print: it sits in the intro card.
                WVNotice(tone: .info, message: HandoffCopy.disclaimer)
            }
        }
    }

    private var rulesCard: some View {
        VStack(alignment: .leading, spacing: 0) {
            WVSectionHeader(HandoffCopy.rulesTitle)
            WVCard(padding: 16) {
                bulletList(title: nil,
                           lines: HandoffCopy.rules,
                           icon: "check", color: WVColor.label3)
            }
            .padding(.top, 8)
        }
    }

    private func bulletList(title: String?, lines: [String], icon: String, color: Color) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            if let title {
                Text(title)
                    .wvFont(.footnoteEmphasis)
                    .foregroundStyle(WVColor.label)
            }
            ForEach(lines, id: \.self) { line in
                HStack(alignment: .top, spacing: 6) {
                    WVIcon(icon, size: 11, weight: .bold)
                        .foregroundStyle(color)
                        .padding(.top, 3)
                    Text(line)
                        .wvFont(.caption)
                        .foregroundStyle(WVColor.label2)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }

    // MARK: - Receipts

    private var receiptsCard: some View {
        VStack(alignment: .leading, spacing: 0) {
            WVSectionHeader(HandoffCopy.receiptsTitle)
            WVSectionFooter(HandoffCopy.receiptsHint)

            if attachmentsModel.isLoading && attachmentsModel.attachments.isEmpty {
                HStack(spacing: 8) {
                    ProgressView()
                    Text(HandoffCopy.receiptsLoading)
                        .wvFont(.footnote)
                        .foregroundStyle(WVColor.label3)
                }
                .padding(.horizontal, WVSpacing.gutter)
                .padding(.vertical, WVSpacing.lg)
            } else if attachmentsModel.attachments.isEmpty {
                WVSectionFooter(HandoffCopy.receiptsEmpty)
            } else {
                WVGroup {
                    ForEach(Array(attachmentsModel.attachments.enumerated()), id: \.element.id) { index, attachment in
                        if index > 0 { WVDivider(inset: 16) }
                        Toggle(isOn: binding(for: attachment.id)) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(attachment.fileName)
                                    .wvFont(.subheadline)
                                    .foregroundStyle(WVColor.label)
                                    .lineLimit(2)
                                if let description = attachment.description, !description.isEmpty {
                                    Text(description)
                                        .wvFont(.caption)
                                        .foregroundStyle(WVColor.label3)
                                        .lineLimit(2)
                                } else {
                                    Text(HandoffCopy.documentMeta(attachment.fileType, attachment.fileSize))
                                        .wvFont(.caption)
                                        .foregroundStyle(WVColor.label3)
                                }
                            }
                        }
                        .tint(WVColor.tint)
                        .padding(.horizontal, WVSpacing.gutter)
                        .padding(.vertical, WVSpacing.sm)
                        .frame(minHeight: 44)
                    }
                }
                .padding(.top, 8)

                HStack(spacing: WVSpacing.md) {
                    Button(selectedAttachmentIds.isEmpty ? L.t("Chọn tất cả") : L.t("Bỏ chọn tất cả")) {
                        if selectedAttachmentIds.isEmpty {
                            selectedAttachmentIds = Set(attachmentsModel.attachments.map(\.id))
                        } else {
                            selectedAttachmentIds.removeAll()
                        }
                    }
                    .wvFont(.footnoteEmphasis)
                    .foregroundStyle(WVColor.tint)

                    Spacer(minLength: 0)

                    Text(L.t("%d/%d hoá đơn sẽ đi theo",
                             selectedAttachmentIds.count,
                             attachmentsModel.attachments.count))
                        .wvFont(.caption)
                        .foregroundStyle(selectedAttachmentIds.isEmpty ? WVColor.label3 : WVColor.label2)
                }
                .padding(.horizontal, WVSpacing.gutter)
                .padding(.top, WVSpacing.sm)

                if let message = attachmentsModel.errorMessage {
                    Text(message)
                        .wvFont(.footnote)
                        .foregroundStyle(WVColor.red)
                        .padding(.horizontal, WVSpacing.gutter)
                        .padding(.top, WVSpacing.sm)
                }
            }
        }
        .padding(.top, 8)
    }

    private func binding(for id: String) -> Binding<Bool> {
        Binding(
            get: { selectedAttachmentIds.contains(id) },
            set: { isOn in
                if isOn { selectedAttachmentIds.insert(id) }
                else { selectedAttachmentIds.remove(id) }
            }
        )
    }

    // MARK: - Latest row / actions

    private func existingCard(_ handoff: DeviceHandoff) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            WVSectionHeader(HandoffCopy.handoffSectionTitle)
            WVGroup {
                HStack(alignment: .top, spacing: 12) {
                    WVLeadingIcon(icon: handoff.status == .pending ? "clock" : "shieldCheck",
                                  color: WVColor.gray, size: 30)
                    VStack(alignment: .leading, spacing: 3) {
                        WVChip(handoff.status.label,
                               tone: tone(for: handoff.status))
                        Text(L.t("Tạo ngày %@", WVFormat.date(handoff.createdAt)))
                            .wvFont(.subheadlineEmphasis)
                            .foregroundStyle(WVColor.label)
                        Text(HandoffCopy.expiryLine(WVFormat.date(handoff.expiresAt))
                             + remainingSuffix(handoff))
                            .wvFont(.caption)
                            .foregroundStyle(WVColor.label3)
                            .fixedSize(horizontal: false, vertical: true)
                        if let claimedAt = handoff.claimedAt {
                            Text(L.t("Người nhận đã nhận %@", WVFormat.date(claimedAt)))
                                .wvFont(.caption)
                                .foregroundStyle(WVColor.label3)
                        }
                    }
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, WVSpacing.gutter)
                .padding(.vertical, WVSpacing.sm)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(.top, 8)

            WVSectionFooter(existingExplanation(handoff))

            if handoff.status.isOpen {
                WVButton(HandoffCopy.cancelOpen, icon: "x", kind: .secondary) {
                    showCancelConfirm = true
                }
                .padding(.top, 8)
                .disabled(cancelling || creating)
            }
        }
        .padding(.top, 8)
    }

    private func existingExplanation(_ handoff: DeviceHandoff) -> String {
        switch handoff.status {
        case .pending:   return HandoffCopy.existingOpen
        case .claimed:   return HandoffCopy.existingClaimed
        case .expired:   return HandoffCopy.existingExpired
        case .cancelled: return HandoffCopy.existingCancelled
        case .unknown:   return HandoffCopy.existingOpen
        }
    }

    private func tone(for status: HandoffStatus) -> WVChipTone {
        switch status {
        case .pending:   return .orange
        case .claimed:   return .green
        case .expired:   return .gray
        case .cancelled: return .red
        case .unknown:   return .gray
        }
    }

    private func remainingSuffix(_ handoff: DeviceHandoff) -> String {
        guard handoff.status.isOpen,
              let remaining = HandoffRules.remainingLabel(expiresAt: handoff.expiresAt, now: now)
        else { return "" }
        return " (\(remaining))"
    }

    private var createCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let nextAllowedAt, nextAllowedAt > now {
                WVSectionFooter(L.t("Có thể tạo mã mới từ %@.", WVFormat.date(nextAllowedAt)))
            }

            WVButton(creating ? HandoffCopy.creatingAction : HandoffCopy.createAction,
                     icon: "send",
                     kind: .primary,
                     fullWidth: true) {
                Task { await create() }
            }
            .disabled(creating || cancelling || isCreated || !canOfferNow)
            .padding(.horizontal, WVSpacing.gutter)

            WVSectionFooter(HandoffCopy.disclaimerShort)
        }
        .padding(.top, WVSpacing.md)
    }

    /// The 30-day rule is the server's, but the sheet must not offer a button
    /// that is guaranteed to fail. `nextAllowedAt` (when returned) is the exact
    /// instant; the row's status is enough otherwise.
    private var canOfferNow: Bool {
        guard HandoffRules.canOfferHandoff(device) else { return false }
        if let nextAllowedAt, nextAllowedAt > now { return false }
        if case let .ready(handoff?) = phase, handoff.status.isOpen { return false }
        return true
    }

    // MARK: - The one-time reveal

    private func createdCard(handoff: DeviceHandoff, url: URL?) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            // 1. The stakes, as the title.
            HStack(spacing: 8) {
                WVIcon("alert", size: 22)
                    .foregroundStyle(WVColor.red)
                Text(HandoffCopy.oneTimeTitle)
                    .wvFont(.title2Emphasis)
                    .foregroundStyle(WVColor.red)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .accessibilityAddTraits(.isHeader)
            .padding(.horizontal, WVSpacing.gutter)

            // 2. Why it cannot be re-read.
            WVNotice(tone: .warning, message: HandoffCopy.oneTimeWarning)
                .padding(.horizontal, WVSpacing.gutter)

            // 3. The credential itself.
            WVCard(padding: 16) {
                VStack(alignment: .leading, spacing: 10) {
                    Text(HandoffCopy.codeLabel)
                        .wvFont(.footnoteEmphasis)
                        .foregroundStyle(WVColor.label2)
                    Text(handoff.code ?? "")
                        .font(.system(size: 36, weight: .bold, design: .monospaced))
                        .tracking(8)
                        .lineLimit(1)
                        .minimumScaleFactor(0.55)
                        .foregroundStyle(WVColor.label)
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .center)
                        .padding(.vertical, 10)
                        .background(WVColor.fill3)
                        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                        // `label` alone replaced the code with "Mã chuyển
                        // chủ", so VoiceOver never read the one credential the
                        // screen exists to deliver. The value carries it.
                        .accessibilityLabel(HandoffCopy.codeLabel)
                        .accessibilityValue(handoff.code ?? "")

                    if let url {
                        Text(HandoffCopy.linkLabel)
                            .wvFont(.footnoteEmphasis)
                            .foregroundStyle(WVColor.label2)
                        Text(url.absoluteString)
                            .wvFont(.footnote, design: .monospaced)
                            .foregroundStyle(WVColor.label)
                            .textSelection(.enabled)
                            .padding(10)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(WVColor.fill3)
                            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                    } else {
                        Text(HandoffCopy.missingLink)
                            .wvFont(.footnote)
                            .foregroundStyle(WVColor.label2)
                            .fixedSize(horizontal: false, vertical: true)
                    }

                    Text(HandoffCopy.expiryLine(WVFormat.date(handoff.expiresAt))
                         + remainingSuffix(handoff))
                        .wvFont(.caption)
                        .foregroundStyle(WVColor.label3)
                }
            }

            // 4. Copy + share, above every way out.
            VStack(spacing: 10) {
                HStack(spacing: 10) {
                    WVButton(copiedCode ? HandoffCopy.copiedAction : HandoffCopy.copyCodeAction,
                             icon: "check",
                             kind: copiedCode ? .secondary : .primary,
                             fullWidth: true) {
                        UIPasteboard.general.string = handoff.code
                        copiedCode = true
                    }
                    .disabled(handoff.code?.isEmpty ?? true)

                    if let url {
                        WVButton(copiedLink ? HandoffCopy.copiedAction : HandoffCopy.copyLinkAction,
                                 icon: "check",
                                 kind: copiedLink ? .secondary : .primary,
                                 fullWidth: true) {
                            UIPasteboard.general.string = url.absoluteString
                            copiedLink = true
                        }
                    }
                }

                if let url {
                    ShareLink(item: url,
                              subject: Text(HandoffCopy.shareSubject(deviceName: device.name)),
                              message: Text(HandoffCopy.shareMessage(
                                  code: handoff.code ?? "", link: url))) {
                        shareLabel
                    }
                } else {
                    ShareLink(item: HandoffCopy.shareMessage(
                        code: handoff.code ?? "", link: nil)) {
                        shareLabel
                    }
                }

                if let url {
                    Button {
                        UIApplication.shared.open(url)
                    } label: {
                        HStack(spacing: 6) {
                            WVIcon("externalLink", size: 14)
                            Text(L.t("Mở link (xem trước)"))
                        }
                        .wvFont(.subheadlineEmphasis)
                        .foregroundStyle(WVColor.tint)
                    }
                    .buttonStyle(WVPressableStyle())
                }
            }
            .padding(.horizontal, WVSpacing.gutter)

            if copiedCode || copiedLink {
                HStack(alignment: .top, spacing: 6) {
                    WVIcon("checkCircle", size: 13)
                        .foregroundStyle(WVColor.green)
                    Text(L.t("Đã sao chép. Gửi cho người nhận trước khi đóng."))
                        .wvFont(.caption)
                        .foregroundStyle(WVColor.label2)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(.horizontal, WVSpacing.gutter)
            }

            Divider()
                .padding(.horizontal, WVSpacing.gutter)

            // 5. A second way to unlock closing, for a seller who wrote it down.
            Button {
                acknowledged.toggle()
            } label: {
                HStack(alignment: .top, spacing: 10) {
                    Image(systemName: acknowledged ? "checkmark.square.fill" : "square")
                        .font(.system(size: 20))
                        .foregroundStyle(acknowledged ? WVColor.green : WVColor.label3)
                    Text(HandoffCopy.ackLabel)
                        .wvFont(.subheadline)
                        .foregroundStyle(WVColor.label2)
                        .multilineTextAlignment(.leading)
                        .fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 0)
                }
            }
            .buttonStyle(.plain)
            .padding(.horizontal, WVSpacing.gutter)
            .accessibilityElement(children: .combine)
            .accessibilityValue(acknowledged ? L.t("Đã đồng ý") : L.t("Chưa đồng ý"))
            .accessibilityAddTraits(acknowledged ? .isSelected : [])

            // 6. Why "Đóng" is refused, printed before it is reached.
            if !canCloseCreated {
                Text(HandoffCopy.closeBlockedHint)
                    .wvFont(.footnoteEmphasis)
                    .foregroundStyle(WVColor.red)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, WVSpacing.gutter)
            }

            // 7. The only dismiss control, and it is gated.
            WVButton(HandoffCopy.closeAction,
                     kind: canCloseCreated ? .primary : .secondary,
                     fullWidth: true) {
                dismiss()
            }
            .disabled(!canCloseCreated)
            .padding(.horizontal, WVSpacing.gutter)
            .padding(.bottom, 8)
        }
    }

    private var shareLabel: some View {
        HStack(spacing: 6) {
            Image(systemName: "square.and.arrow.up")
            Text(HandoffCopy.shareAction)
        }
        .wvFont(.bodyEmphasis)
        .foregroundStyle(WVColor.tint)
        .frame(maxWidth: .infinity)
        .frame(height: 50)
        .background(WVColor.fill2)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    private func failureState(_ message: String) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            WVNotice(tone: .error, message: message)
                .padding(.horizontal, WVSpacing.gutter)
            WVButton(HandoffCopy.retryAction, icon: "refresh", kind: .secondary) {
                Task { await loadHandoff() }
            }
            .padding(.horizontal, WVSpacing.gutter)
        }
        .padding(.top, WVSpacing.md)
    }

    // MARK: - Networking

    private func loadHandoff() async {
        now = Date()
        do {
            let response = try await client.currentHandoff(deviceId: device.id)
            nextAllowedAt = response.nextAllowedAt
            phase = .ready(response.handoff)
            errorMessage = nil
        } catch {
            let (status, _, message) = apiFailure(error)
            if status == 404 {
                phase = .ready(nil)
                return
            }
            phase = .failed(message ?? HandoffCopy.loadFailed)
        }
    }

    private func create() async {
        creating = true
        errorMessage = nil
        defer { creating = false }
        do {
            let handoff = try await client.createHandoff(deviceId: device.id,
                                                         attachmentIds: orderedSelectionIds)
            now = Date()
            // `claimPath` is always sent, but the web route is predictable from
            // the code, so a server that omits it still leaves the seller with a
            // usable link instead of a dead end.
            let url = HandoffRules.claimURL(claimPath: handoff.claimPath)
                ?? HandoffRules.claimURL(code: handoff.code ?? "")
            phase = .created(handoff, url)
            copiedCode = false
            copiedLink = false
            acknowledged = false
            onChanged()
        } catch {
            let (status, _, message) = apiFailure(error)
            errorMessage = HandoffRules.createFailureMessage(status: status,
                                                             serverMessage: message,
                                                             fallback: HandoffCopy.createFailed)
            // A 409 may mean "you already have a PENDING code": re-read the row
            // so the card above the button tells the truth instead of leaving
            // the seller looking at an empty state.
            if status == 409 { await loadHandoff() }
        }
    }

    private func cancelExisting() async {
        cancelling = true
        errorMessage = nil
        defer { cancelling = false }
        do {
            try await client.cancelHandoff(deviceId: device.id)
            await loadHandoff()
            onChanged()
        } catch {
            let (status, _, message) = apiFailure(error)
            errorMessage = HandoffRules.cancelFailureMessage(status: status,
                                                             serverMessage: message,
                                                             fallback: HandoffCopy.cancelFailed)
        }
    }

    private func apiFailure(_ error: Error) -> (Int?, String?, String?) {
        if let api = error as? APIError, case let .server(status, envelope) = api {
            return (status, envelope.error, envelope.message)
        }
        return (nil, nil, (error as? APIError)?.localizedDescription)
    }
}
