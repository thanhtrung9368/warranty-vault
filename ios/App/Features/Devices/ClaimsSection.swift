import SwiftUI
import WarrlyKit

// ============================================================
// ClaimsSection — "Sửa chữa & bảo hành" on the device detail
//
// A claim belongs to a device: it starts from `Device.status == .BROKEN`, and
// the device detail is where the warranty plans, the shop's contact details and
// the pre-service checklist already live. So this is the anchor.
//
// There is deliberately **no standalone claims screen** in this pass. A claim
// is not meaningful without its device — every row would need the device name
// and a tap-through to this very screen — and the one-open-per-device rule
// means the cross-device question ("what is in repair right now?") is already
// answered by the BROKEN badge on the device list plus this section. The
// `GET /api/v1/claims?status=` filter is implemented and tested so a future
// cross-device view costs one read, not a model change.
//
// Three things this section owns:
//
//   1. **The list**, from `WarrantiesStore.claims` (the detail read carries
//      `claims`; the store falls back to `GET /api/v1/claims?deviceId=`).
//   2. **The BROKEN nudge** — an inline card, never an alert, shown only when
//      the device is marked broken and no claim is open.
//   3. **The form**, as a sheet. A 409 from "create" re-opens the *open* claim
//      in edit mode after the sheet dismisses, which is the "way to it" the
//      error copy promises.
//   4. **The AI assessment**, as a sheet launched from a claim. The action sits
//      on the claim row because the endpoint needs a `claimId` and the user is
//      already looking at the repair they are about to discuss. The row keeps
//      its tap-to-edit behaviour; the assessment is a second, explicitly
//      labelled button, not a swipe action, so it is discoverable at a counter.
// ============================================================

struct ClaimsSection: View {
    @ObservedObject var store: WarrantiesStore
    /// The live device (status changes are reflected here immediately).
    let device: Device
    /// Only the read-only AI assessment needs the client; every claim write
    /// still goes through `store`.
    let client: APIClient

    @State private var route: ClaimFormRoute?
    /// Set when the form's 409 alert asked to open the claim that is already
    /// open. The sheet's `onDismiss` turns it into an edit sheet, which is why
    /// this is separate from `route`: a sheet cannot reliably swap its item
    /// while it is being dismissed.
    @State private var openAfterDismiss: Claim?

    private var claims: [Claim] { ClaimRules.sortedForDisplay(store.claims) }

    private var loaded: Bool {
        if case .loaded = store.state { return true }
        return false
    }

    /// The dead end this feature exists to close: broken, and nobody wrote down
    /// what happened next. Only after the read settles — a loading (or failed)
    /// detail must not claim the device has no repair.
    private var needsNudge: Bool {
        loaded && ClaimRules.needsRepairNudge(status: device.status, claims: store.claims)
    }

    // MARK: - Body

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            WVSectionHeader(L.t("Sửa chữa & bảo hành"))

            if needsNudge {
                nudgeCard
                    .padding(.top, 2)
                    .padding(.bottom, 10)
            }

            list

            if loaded && store.claims.isEmpty && !needsNudge {
                // The nudge already says there is no repair; printing "no
                // repairs yet" under it would just repeat the card.
                WVSectionFooter(L.t("Chưa có lần sửa chữa nào."))
            }
            WVSectionFooter(L.t("Mỗi thiết bị chỉ có một lần sửa chữa đang mở tại một thời điểm."))
        }
        .sheet(item: $route, onDismiss: reopenConflict) { route in
            if case let .assess(claim) = route {
                ClaimAssessmentView(client: client, claim: claim)
            } else {
                ClaimFormView(
                    store: store,
                    device: device,
                    claim: route.claim,
                    onOpenExisting: { existing in
                        // The form dismisses itself right after this; `reopenConflict`
                        // then presents the claim that is actually open.
                        openAfterDismiss = existing
                    }
                )
            }
        }
    }

    // MARK: - The list

    @ViewBuilder
    private var list: some View {
        if store.state == .loading && store.claims.isEmpty {
            ProgressView()
                .frame(maxWidth: .infinity)
                .padding(.vertical, WVSpacing.lg)
        } else {
            WVGroup {
                ForEach(Array(claims.enumerated()), id: \.element.id) { index, claim in
                    if index > 0 { WVDivider(inset: 16) }
                    claimCell(claim)
                }

                if !claims.isEmpty { WVDivider(inset: 16) }

                // Always offered, even while another claim is open: the user may
                // be recording a *past* repair. The form warns before an open
                // status is chosen and maps the server's 409 if it still happens.
                WVRow(icon: "plus", iconColor: WVColor.tint,
                      title: L.t("Thêm lần sửa chữa"), role: .tint) {
                    route = .create
                }
            }
            .padding(.top, 2)
        }
    }

    /// One claim cell.
    ///
    /// The row keeps its old tap-to-edit behaviour; the assessment is a second,
    /// explicitly labelled action under it. Two sibling buttons rather than a
    /// nested control: on iOS a whole-row button swallows the inner tap, and a
    /// swipe action would hide the one thing a user at a counter needs to find.
    private func claimCell(_ claim: Claim) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Button {
                route = .edit(claim)
            } label: {
                ClaimRow(claim: claim, warranty: warranty(for: claim))
            }
            .buttonStyle(WVRowButtonStyle())

            Button {
                route = .assess(claim)
            } label: {
                HStack(spacing: 6) {
                    WVIcon("sparkles", size: 13)
                    Text(L.t("Đánh giá bảo hành"))
                        .wvFont(.footnoteEmphasis)
                    Spacer(minLength: 0)
                }
                .foregroundStyle(WVColor.tint)
                .padding(.horizontal, 16)
                .padding(.bottom, 9)
                .contentShape(Rectangle())
            }
            .buttonStyle(WVPressableStyle())
        }
    }

    private func warranty(for claim: Claim) -> Warranty? {
        guard let id = claim.warrantyId else { return nil }
        return store.warranties.first { $0.id == id }
    }

    // MARK: - The nudge

    /// Inline, amber, one action. The device is already on the screen, so this
    /// is the cheapest possible way out of the BROKEN dead end — no alert, no
    /// modal, no navigation.
    private var nudgeCard: some View {
        WVCard(padding: 16) {
            VStack(alignment: .leading, spacing: 10) {
                HStack(alignment: .top, spacing: 8) {
                    WVIcon("alert", size: 16)
                        .foregroundStyle(WVColor.orange)
                        .padding(.top, 1)
                    Text(L.t("Thiết bị đang Hỏng nhưng chưa có lần sửa chữa nào đang mở"))
                        .wvFont(.subheadlineEmphasis)
                        .foregroundStyle(WVColor.label)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Text(L.t("Ghi lại nơi sửa, số phiếu và ngày dự kiến trả để lần đi bảo hành này không bị quên."))
                    .wvFont(.footnote)
                    .foregroundStyle(WVColor.label2)
                    .fixedSize(horizontal: false, vertical: true)
                WVButton(L.t("Bắt đầu sửa chữa"), icon: "plus", size: .small) {
                    route = .create
                }
            }
        }
    }

    // MARK: - 409 → the claim that is already open

    private func reopenConflict() {
        guard let existing = openAfterDismiss else { return }
        openAfterDismiss = nil
        route = .edit(existing)
    }
}

// MARK: - Row

/// One repair, drawn as a grouped-list row.
///
/// Status is the chip (the one thing that changes); the issue is the title
/// because that is what the user recognises; the dates and the ticket number are
/// the two facts they come back to look up. `serviceCenter` and `cost` ride on a
/// third line only when they exist, so a minimum row stays one glance tall.
private struct ClaimRow: View {
    let claim: Claim
    let warranty: Warranty?

    /// Ticket first: the number is the one thing the shop asks for when the
    /// user calls. Open claims show the promised return date; closed ones show
    /// when they were closed.
    private var dateLine: String {
        var parts: [String] = []
        if let ticket = filled(claim.ticketNumber) {
            parts.append(L.t("Phiếu %@", ticket))
        }
        if let opened = ClaimRules.dayLabel(claim.openedAt) {
            parts.append(L.t("Mở %@", opened))
        }
        if ClaimRules.isOpen(claim) {
            if let expected = ClaimRules.dayLabel(claim.expectedReturnAt) {
                parts.append(L.t("Dự kiến trả %@", expected))
            }
        } else if let closed = ClaimRules.dayLabel(claim.closedAt) {
            parts.append(L.t("Đóng %@", closed))
        }
        return parts.joined(separator: " · ")
    }

    private var metaLine: String {
        var parts: [String] = []
        if let center = filled(claim.serviceCenter) { parts.append(center) }
        if let cost = ClaimRules.costLabel(claim.cost) { parts.append(cost) }
        return parts.joined(separator: " · ")
    }

    /// The warranty plan invoked, when the section could resolve it. A claim
    /// whose plan was deleted keeps its row — only the reference is gone.
    private var warrantyLabel: String? {
        guard let warranty else { return nil }
        return warranty.provider ?? warranty.type.label
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(alignment: .center, spacing: 8) {
                Text(claim.issue)
                    .wvFont(.body)
                    .foregroundStyle(WVColor.label)
                    .lineLimit(1)
                Spacer(minLength: 8)
                WVChip(claim.status.label, tone: claim.status.chipTone)
                WVIcon("arrowRight", size: 13, weight: .semibold)
                    .foregroundStyle(WVColor.label4)
            }

            if !dateLine.isEmpty {
                Text(dateLine)
                    .wvFont(.footnote)
                    .foregroundStyle(WVColor.label3)
                    .lineLimit(1)
            }

            let meta = [metaLine, warrantyLabel ?? ""]
                .filter { !$0.isEmpty }
                .joined(separator: " · ")
            if !meta.isEmpty {
                Text(meta)
                    .wvFont(.caption)
                    .foregroundStyle(WVColor.label3)
                    .lineLimit(1)
            }
        }
        .padding(.horizontal, 16)
        .frame(minHeight: 44)
        .padding(.vertical, 9)
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
    }

    private func filled(_ value: String?) -> String? {
        guard let value else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}

// MARK: - Sheet route

/// The claim form's presentation item. `create` and one `edit` per claim, so
/// SwiftUI can tell them apart and re-present after a 409.
enum ClaimFormRoute: Identifiable {
    case create
    case edit(Claim)
    /// The read-only AI assessment for one claim. It shares the presentation
    /// item so only one sheet can ever be up, and dismisses back to the same
    /// section it came from.
    case assess(Claim)

    var id: String {
        switch self {
        case .create:              return "new"
        case .edit(let claim):     return claim.id
        case .assess(let claim):   return "assess-\(claim.id)"
        }
    }

    /// The claim the form edits. `nil` for `create` and for `assess` — the
    /// assessment sheet receives its claim through the case, not through this
    /// accessor, so it can never be opened with an editable form by mistake.
    var claim: Claim? {
        if case let .edit(claim) = self { return claim }
        return nil
    }
}
