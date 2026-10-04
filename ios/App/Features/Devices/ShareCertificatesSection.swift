import SwiftUI
import UIKit
import WarrantyVaultKit

// ============================================================
// ShareCertificatesSection — "Phiếu bàn giao & link chia sẻ"
//
// The iOS half of FEATURE_IDEAS #2 (openapi `shares`). Web and Android shipped
// this first; the rules live in `WarrantyVaultKit/ShareLinks.swift` and this file
// only renders them.
//
// ## The one thing this screen must not get wrong
//
// `POST /api/v1/devices/{id}/shares` returns the token **once**. The server keeps
// only its sha256, so no later call — and no later screen — can reproduce it.
// Everything about `OneTimeTokenSheet` below follows from that:
//
//   1. the stakes are the sheet's **title**, before any body text is read;
//   2. the warning sits above the link, in the same view, inside a red banner;
//   3. copy and the system share sheet come **before** the only dismiss control;
//   4. the sheet cannot be swiped away (`interactiveDismissDisabled`) and "Đóng"
//      stays disabled until the link was copied or explicitly acknowledged, with
//      the reason printed right there while it is disabled;
//   5. the token is never persisted — not in the Keychain, not in a file, not in
//      `UserDefaults`, not in `@SceneStorage`. It lives in one `@State` that is
//      cleared by the dismissal.
//
// A warning that can be tapped past is not a guard, so dismissal itself is the
// guard here, as it is on web (checkbox + blocked close) and Android (warning in
// the dialog title, dismiss control after copy).
// ============================================================

struct ShareCertificatesSection: View {
    let client: APIClient
    let deviceId: String
    let deviceName: String

    @State private var shares: [DeviceShare] = []
    @State private var loading = true
    @State private var unavailable = false
    @State private var errorMessage: String?
    @State private var creating = false
    @State private var expiryDays = ShareLinks.ttlDefaultDays
    @State private var includeSerial = false
    @State private var showProjection = false
    /// The one-time credential. Holds only the link this screen just created, and
    /// is cleared the moment the sheet closes — nothing else may read it.
    @State private var created: OneTimeLink?
    @State private var revoking: DeviceShare?

    /// One instant for the whole list: re-reading the clock per row could show one
    /// link as live and the next as expired for the same moment, and the header
    /// count could disagree with the rows beneath it. Refreshed on every load.
    @State private var now = Date()

    private var capacity: (live: Int, remaining: Int, full: Bool) {
        ShareLinks.capacity(shares, now: now)
    }
    private var split: (live: [DeviceShare], dead: [DeviceShare]) {
        ShareLinks.split(shares, now: now)
    }

    // MARK: - Body

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            WVSectionHeader(L.t("Phiếu bàn giao & link chia sẻ"))
            WVSectionFooter(ShareCopy.sectionHint)

            createCard
                .padding(.top, 10)

            if let errorMessage {
                Text(errorMessage)
                    .font(.system(size: 13))
                    .foregroundStyle(WVColor.red)
                    .padding(.horizontal, 32)
                    .padding(.top, 8)
                    .fixedSize(horizontal: false, vertical: true)
            }

            list
        }
        .task { await load() }
        .sheet(item: $created) { link in
            OneTimeTokenSheet(link: link, deviceName: deviceName) {
                created = nil
                Task { await load() }
            }
        }
        .alert(ShareCopy.revokeTitle,
               isPresented: Binding(get: { revoking != nil },
                                    set: { if !$0 { revoking = nil } }),
               // The share is handed to the closure rather than read back from
               // `revoking`: SwiftUI clears that binding as the alert dismisses, and
               // a revoke that silently did nothing is worse than no button.
               presenting: revoking) { share in
            Button(ShareCopy.cancelAction, role: .cancel) { revoking = nil }
            Button(ShareCopy.revokeAction, role: .destructive) {
                Task { await revoke(share) }
            }
        } message: { _ in
            Text(ShareCopy.revokeConfirm)
        }
    }

    // MARK: - Create

    private var createCard: some View {
        WVCard(padding: 16) {
            VStack(alignment: .leading, spacing: 14) {
                // Warning #1 — stated before the token exists, so creating a link
                // is never a surprise.
                WarningBox(title: ShareCopy.oneTimeTitle, message: ShareCopy.oneTimeWarning)

                VStack(alignment: .leading, spacing: 6) {
                    Text(ShareCopy.expiryLabel)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(WVColor.label2)
                    WVSegmented(
                        options: ShareLinks.expiryChoices.map { (value: $0.days, label: $0.label) },
                        selection: $expiryDays
                    )
                    Text(ShareCopy.expiryNote)
                        .font(.system(size: 12))
                        .foregroundStyle(WVColor.label3)
                        .fixedSize(horizontal: false, vertical: true)
                }

                // Serial opt-in. Off by default; the consequence of turning it on
                // is stated where the switch is.
                VStack(alignment: .leading, spacing: 4) {
                    Toggle(isOn: $includeSerial) {
                        Text(ShareCopy.serialLabel)
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(WVColor.label2)
                    }
                    .tint(WVColor.tint)
                    Text(includeSerial ? ShareCopy.serialOnNote : ShareCopy.serialOffNote)
                        .font(.system(size: 12))
                        .foregroundStyle(includeSerial ? WVColor.orange : WVColor.label3)
                        .fixedSize(horizontal: false, vertical: true)
                }

                // What the buyer reads, and — the reason a seller can send the
                // link at all — what never leaves the account.
                DisclosureGroup(isExpanded: $showProjection) {
                    VStack(alignment: .leading, spacing: 10) {
                        bulletList(title: ShareCopy.projectionTitle,
                                   lines: ShareCopy.certificateShows,
                                   icon: "check", color: WVColor.green)
                        bulletList(title: ShareCopy.neverShownTitle,
                                   lines: ShareCopy.certificateNeverShown,
                                   icon: "shieldX", color: WVColor.label3)
                    }
                    .padding(.top, 8)
                } label: {
                    Text(ShareCopy.projectionTitle)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(WVColor.label2)
                }
                .tint(WVColor.tint)

                VStack(alignment: .leading, spacing: 4) {
                    Text(ShareLinks.capacityLine(shares, now: now))
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(capacity.full ? WVColor.orange : WVColor.label3)
                    Text(ShareCopy.limitNote)
                        .font(.system(size: 12))
                        .foregroundStyle(WVColor.label3)
                        .fixedSize(horizontal: false, vertical: true)
                }

                if creating {
                    HStack(spacing: 8) {
                        ProgressView()
                        Text(L.t("Đang tạo link…"))
                            .font(.system(size: 13))
                            .foregroundStyle(WVColor.label3)
                    }
                    .frame(maxWidth: .infinity)
                } else {
                    WVButton(capacity.full ? ShareCopy.limitReachedShort : ShareCopy.createAction,
                             icon: "plus",
                             kind: capacity.full ? .secondary : .primary) {
                        Task { await create() }
                    }
                    .disabled(capacity.full)
                }
            }
        }
    }

    private func bulletList(title: String, lines: [String], icon: String, color: Color) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(WVColor.label)
            ForEach(lines, id: \.self) { line in
                HStack(alignment: .top, spacing: 6) {
                    WVIcon(icon, size: 11, weight: .bold)
                        .foregroundStyle(color)
                        .padding(.top, 3)
                    Text(line)
                        .font(.system(size: 12))
                        .foregroundStyle(WVColor.label2)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }

    // MARK: - The list

    @ViewBuilder
    private var list: some View {
        if loading && shares.isEmpty {
            ProgressView()
                .frame(maxWidth: .infinity)
                .padding(.vertical, WVSpacing.lg)
        } else if unavailable && shares.isEmpty {
            // Only when there is nothing to show: a refresh that failed keeps the
            // list the owner already had rather than blanking it.
            WVSectionFooter(ShareCopy.unavailableState)
        } else if shares.isEmpty {
            WVSectionFooter(ShareCopy.emptyState)
        } else {
            let parts = split
            if parts.live.isEmpty {
                WVSectionFooter(ShareCopy.noLiveLinks)
            } else {
                WVGroup {
                    ForEach(Array(parts.live.enumerated()), id: \.element.id) { index, share in
                        if index > 0 { WVDivider(inset: 60) }
                        ShareRowView(share: share, now: now, canRevoke: true) {
                            revoking = share
                        }
                    }
                }
                .padding(.top, 10)
            }

            if !parts.dead.isEmpty {
                WVSectionHeader(ShareCopy.deadGroupLabel(parts.dead.count))
                WVGroup {
                    ForEach(Array(parts.dead.enumerated()), id: \.element.id) { index, share in
                        if index > 0 { WVDivider(inset: 60) }
                        // Dead rows are still listed and still readable — they are
                        // the audit trail of who was handed what — but there is
                        // nothing left to revoke.
                        ShareRowView(share: share, now: now, canRevoke: false) {}
                    }
                }
            }
        }
    }

    // MARK: - Actions

    private func load() async {
        loading = true
        defer { loading = false }
        do {
            shares = try await client.listShares(deviceId: deviceId)
            unavailable = false
            errorMessage = nil
        } catch {
            // An empty list and a failed read must not look the same: the first
            // means "no links yet", the second means "we do not know". With rows
            // already on screen the last known list stays and the failure is stated
            // above it, rather than blanking what the owner already had.
            unavailable = true
            errorMessage = shares.isEmpty ? nil : ShareCopy.unavailableState
        }
        now = Date()
    }

    private func create() async {
        creating = true
        defer { creating = false }
        do {
            let created = try await client.createShare(
                deviceId: deviceId,
                CreateShareInput(expiresInDays: expiryDays, includeSerial: includeSerial)
            )
            // The credential goes straight into the one-time sheet and nowhere
            // else; the list is refreshed underneath it.
            self.created = OneTimeLink(
                created: created,
                url: ShareLinks.certificateURL(baseURL: client.baseURL, sharePath: created.sharePath)
            )
            errorMessage = nil
            await load()
        } catch {
            errorMessage = failureMessage(error, fallback: ShareCopy.createFailed)
        }
    }

    private func revoke(_ share: DeviceShare) async {
        revoking = nil
        do {
            try await client.revokeShare(id: share.id)
            errorMessage = nil
            await load()
        } catch {
            errorMessage = failureMessage(error, fallback: ShareCopy.revokeFailed)
        }
    }

    private func failureMessage(_ error: Error, fallback: String) -> String {
        if let apiError = error as? APIError, case let .server(status, envelope) = apiError {
            return ShareLinks.failureMessage(status: status, serverMessage: envelope.message,
                                             fallback: fallback)
        }
        return (error as? APIError)?.localizedDescription ?? fallback
    }
}

// MARK: - One row of the list

private struct ShareRowView: View {
    let share: DeviceShare
    let now: Date
    let canRevoke: Bool
    let onRevoke: () -> Void

    private var status: ShareLinks.Status { ShareLinks.status(share, now: now) }

    private var tone: WVChipTone {
        switch status {
        case .live:    return .green
        case .revoked: return .red
        case .expired: return .gray
        }
    }

    private var termsLine: String {
        var parts = [L.t("Hết hạn %@", WVFormat.date(share.expiresAt))]
        if let remaining = ShareLinks.remainingLabel(share, now: now) { parts.append("(\(remaining))") }
        parts.append(ShareLinks.viewLabel(share.viewCount))
        parts.append(ShareLinks.serialExposureLabel(share.includeSerial))
        return parts.joined(separator: " • ")
    }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            WVLeadingIcon(icon: "link",
                          color: status == .live ? WVColor.green : WVColor.gray,
                          size: 30)
            VStack(alignment: .leading, spacing: 3) {
                WVChip(status.label, tone: tone)
                Text(L.t("Tạo ngày %@", WVFormat.date(share.createdAt)))
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(WVColor.label)
                Text(termsLine)
                    .font(.system(size: 12))
                    .foregroundStyle(WVColor.label3)
                    .fixedSize(horizontal: false, vertical: true)
                if let lastViewed = share.lastViewedAt {
                    Text(L.t("Mở lần cuối %@", WVFormat.date(lastViewed)))
                        .font(.system(size: 12))
                        .foregroundStyle(WVColor.label3)
                }
            }
            Spacer(minLength: 8)
            if canRevoke {
                Button(action: onRevoke) {
                    Text(ShareCopy.revokeAction)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(WVColor.red)
                        .padding(.horizontal, 10)
                        .frame(height: 30)
                        .background(WVColor.red.opacity(0.12))
                        .clipShape(Capsule())
                }
                .buttonStyle(WVPressableStyle())
                .accessibilityLabel(L.t("%@ link tạo ngày %@", ShareCopy.revokeAction, WVFormat.date(share.createdAt)))
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - The one-time reveal

/// The created link, plus the URL this client resolved for it. `url` is `nil`
/// when `sharePath` could not be turned into an absolute URL — the sheet then says
/// so and offers no copy/share, rather than handing the buyer a broken link.
private struct OneTimeLink: Identifiable {
    let created: CreatedDeviceShare
    let url: URL?
    var id: String { created.share.id }
}

/// The create result — **the only surface in the app that ever shows a token**.
///
/// The layout order is the design, not decoration: title (the stakes) → red
/// warning → the link → copy/share → acknowledgement → the one dismiss control,
/// disabled until the link was copied or acknowledged. There is deliberately no
/// toolbar close button: the only way out is below the link.
private struct OneTimeTokenSheet: View {
    let link: OneTimeLink
    let deviceName: String
    let onClose: () -> Void

    @State private var copied = false
    @State private var acknowledged = false

    private var canClose: Bool { copied || acknowledged }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                // 1. The stakes, as the title.
                HStack(spacing: 8) {
                    WVIcon("alert", size: 22)
                        .foregroundStyle(WVColor.red)
                    Text(ShareCopy.oneTimeTitle)
                        .font(.system(size: 22, weight: .bold))
                        .foregroundStyle(WVColor.red)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .accessibilityAddTraits(.isHeader)

                // 2. Why this screen cannot be skipped.
                WarningBox(title: ShareCopy.oneTimeHeading, message: ShareCopy.oneTimeWarning)

                // 3. The credential itself.
                if let url = link.url {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(ShareCopy.linkLabel)
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(WVColor.label2)
                        Text(url.absoluteString)
                            .font(.system(size: 13, design: .monospaced))
                            .foregroundStyle(WVColor.label)
                            .textSelection(.enabled)
                            .padding(10)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(WVColor.fill3)
                            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                        Text(ShareCopy.previewNote)
                            .font(.system(size: 12))
                            .foregroundStyle(WVColor.label3)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                } else {
                    Text(ShareCopy.missingPath)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(WVColor.red)
                        .fixedSize(horizontal: false, vertical: true)
                }

                // 4. What the link is, in the owner's own terms.
                Text(L.t("Hạn %@ • %@", WVFormat.date(link.created.share.expiresAt),
                                     ShareLinks.serialExposureLabel(link.created.share.includeSerial)))
                    .font(.system(size: 12))
                    .foregroundStyle(WVColor.label3)

                // 5. Copy + share, above every way out of this screen.
                if let url = link.url {
                    HStack(spacing: 10) {
                        WVButton(copied ? ShareCopy.copiedAction : ShareCopy.copyAction,
                                 icon: "check",
                                 kind: copied ? .secondary : .primary,
                                 fullWidth: true) {
                            UIPasteboard.general.string = url.absoluteString
                            copied = true
                        }
                        ShareLink(item: url,
                                  subject: Text(ShareCopy.shareSubject(deviceName: deviceName)),
                                  message: Text(ShareCopy.shareMessage)) {
                            HStack(spacing: 6) {
                                Image(systemName: "square.and.arrow.up")
                                Text(ShareCopy.shareAction)
                            }
                            .font(.system(size: 17, weight: .semibold))
                            .foregroundStyle(WVColor.tint)
                            .frame(maxWidth: .infinity)
                            .frame(height: 50)
                            .background(WVColor.fill2)
                            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                        }
                    }

                    Button {
                        UIApplication.shared.open(url)
                    } label: {
                        HStack(spacing: 6) {
                            WVIcon("externalLink", size: 14)
                            Text(L.t("Mở phiếu (xem trước)"))
                        }
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(WVColor.tint)
                    }
                    .buttonStyle(WVPressableStyle())
                }

                // 6. The rule surviving the sheet: said again on the copy action,
                //    not only in the banner.
                if copied {
                    HStack(alignment: .top, spacing: 6) {
                        WVIcon("checkCircle", size: 13)
                            .foregroundStyle(WVColor.green)
                        Text(ShareCopy.copiedToast)
                            .font(.system(size: 12))
                            .foregroundStyle(WVColor.label2)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }

                Divider()

                // 7. A second, independent way to unlock closing.
                Button {
                    acknowledged.toggle()
                } label: {
                    HStack(alignment: .top, spacing: 10) {
                        Image(systemName: acknowledged ? "checkmark.square.fill" : "square")
                            .font(.system(size: 20))
                            .foregroundStyle(acknowledged ? WVColor.green : WVColor.label3)
                        Text(ShareCopy.ackLabel)
                            .font(.system(size: 14))
                            .foregroundStyle(WVColor.label2)
                            .multilineTextAlignment(.leading)
                            .fixedSize(horizontal: false, vertical: true)
                        Spacer(minLength: 0)
                    }
                }
                .buttonStyle(.plain)

                // 8. Why "Đóng" is refused, printed before it is reached.
                if !canClose {
                    Text(ShareCopy.closeBlockedHint)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(WVColor.red)
                        .fixedSize(horizontal: false, vertical: true)
                }

                // 9. The only dismiss control, and it is gated.
                WVButton(ShareCopy.closeAction,
                         kind: canClose ? .primary : .secondary,
                         fullWidth: true,
                         action: onClose)
                    .disabled(!canClose)
                    .opacity(canClose ? 1 : 0.55)

                Spacer(minLength: 8)
            }
            .padding(WVSpacing.gutter)
        }
        .background(WVColor.bg)
        // Swipe-down is not an escape hatch here: closing is exactly the moment
        // the link becomes unrecoverable.
        .interactiveDismissDisabled(true)
    }
}

// MARK: - Shared bits

/// The red box the one-time rule is stated in, on both surfaces that mention it.
private struct WarningBox: View {
    let title: String
    /// Named `message`, not `body`: a stored `body: String` would collide with
    /// `View.body` and the type could not conform.
    let message: String

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                WVIcon("alert", size: 14)
                    .foregroundStyle(WVColor.red)
                Text(title)
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(WVColor.red)
            }
            Text(message)
                .font(.system(size: 13))
                .foregroundStyle(WVColor.label2)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(WVColor.red.opacity(0.10))
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(WVColor.red.opacity(0.35), lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
    }
}
