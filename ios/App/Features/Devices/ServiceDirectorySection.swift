import SwiftUI
import UIKit
import WarrantyVaultKit

// ============================================================
// ServiceDirectorySection — "Đi bảo hành ở đâu" (FEATURE_IDEAS #15)
//
// `GET /api/v1/devices/{id}/service-directory` answers one question, and the whole
// feature is an honesty problem rather than a layout one. Every branch here is
// decided by `WarrantyVaultKit/ServiceDirectoryInfo.swift` (where the copy and the
// rules are unit-tested); this file only draws the result:
//
//   * `brand: null` is EXPLAINED — no seeded row, or an ambiguous match — and never
//     an empty box. The app invents no URL to fill the gap.
//   * `phoneSource` is rendered: `user` means the user typed the number (the only
//     case that gets a `tel:` action), `none` means there is nothing, and a source
//     this client cannot attribute is shown flagged rather than promoted.
//   * the server's own `disclaimer` is printed verbatim, at the end, unedited.
// ============================================================

struct ServiceDirectorySection: View {
    let client: APIClient
    let deviceId: String

    @State private var directory: ServiceDirectory?
    @State private var loading = true
    @State private var unavailable = false

    // MARK: - Body

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            WVSectionHeader(L.t("Đi bảo hành ở đâu"))
            WVSectionFooter(DirectoryCopy.sectionHint)

            if loading && directory == nil {
                ProgressView()
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, WVSpacing.lg)
            } else if unavailable || directory == nil {
                // "Không tải được" is not "không có thông tin": they are different
                // answers and must not look the same.
                WVSectionFooter(DirectoryCopy.unavailableState)
            } else if let directory {
                brandCard(directory)

                WVSectionHeader(ServiceDirectoryInfo.centreCountLabel(directory.centres))
                WVSectionFooter(ServiceDirectoryInfo.contactSummary(directory).line)

                if !directory.centres.isEmpty {
                    WVGroup {
                        ForEach(Array(directory.centres.enumerated()), id: \.element.id) { index, centre in
                            if index > 0 { WVDivider(inset: 16) }
                            CentreRowView(centre: centre)
                        }
                    }
                }

                // The honesty line for every phone number that is (or is not)
                // above, plus the server's own explanation, verbatim.
                WVSectionFooter(DirectoryCopy.phoneHonesty)
                if let disclaimer = ServiceDirectoryInfo.disclaimer(directory) {
                    WVSectionFooter(disclaimer)
                }
            }
        }
        .task { await load() }
    }

    // MARK: - Brand tier

    @ViewBuilder
    private func brandCard(_ directory: ServiceDirectory) -> some View {
        WVCard(padding: 16) {
            VStack(alignment: .leading, spacing: 8) {
                switch ServiceDirectoryInfo.brandState(directory) {
                case .entry(let brand):
                    HStack(spacing: 8) {
                        WVIcon("store", size: 16)
                            .foregroundStyle(WVColor.tint)
                        Text(brand.name)
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundStyle(WVColor.label)
                    }
                    Text(ServiceDirectoryInfo.hasVerifiedLink(brand)
                         ? DirectoryCopy.verifiedLinkNote
                         : DirectoryCopy.noVerifiedLink)
                        .font(.system(size: 12))
                        .foregroundStyle(WVColor.label3)
                        .fixedSize(horizontal: false, vertical: true)

                    ForEach(ServiceDirectoryInfo.brandLinks(brand), id: \.url) { link in
                        Button {
                            UIApplication.shared.open(link.url)
                        } label: {
                            HStack(spacing: 6) {
                                WVIcon("externalLink", size: 13)
                                Text(link.label)
                                Spacer(minLength: 0)
                            }
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(WVColor.tint)
                            .frame(minHeight: 32)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(WVPressableStyle())
                    }

                    if let note = ServiceDirectoryInfo.brandNote(brand) {
                        Text(note)
                            .font(.system(size: 12))
                            .foregroundStyle(WVColor.label3)
                            .fixedSize(horizontal: false, vertical: true)
                    }

                case .noEntry(let title, let detail, let brandInput):
                    // Both honest causes are named in `detail`; the user's own
                    // text is quoted back so they can see what was looked up.
                    Text(title)
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(WVColor.orange)
                        .fixedSize(horizontal: false, vertical: true)
                    Text(L.t("Hãng bạn ghi trên thiết bị: “%@”", brandInput))
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(WVColor.label)
                        .fixedSize(horizontal: false, vertical: true)
                    Text(detail)
                        .font(.system(size: 12))
                        .foregroundStyle(WVColor.label3)
                        .fixedSize(horizontal: false, vertical: true)

                case .noInput(let title, let detail):
                    Text(title)
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(WVColor.label2)
                        .fixedSize(horizontal: false, vertical: true)
                    Text(detail)
                        .font(.system(size: 12))
                        .foregroundStyle(WVColor.label3)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }

    // MARK: - Load

    private func load() async {
        loading = true
        defer { loading = false }
        do {
            directory = try await client.serviceDirectory(deviceId: deviceId)
            unavailable = false
        } catch {
            directory = nil
            unavailable = true
        }
    }
}

// MARK: - One warranty's contact row

private struct CentreRowView: View {
    let centre: WarrantyCentre

    private var provider: ServiceDirectoryInfo.ProviderState {
        ServiceDirectoryInfo.providerState(centre)
    }
    private var status: ServiceDirectoryInfo.CentreStatus {
        ServiceDirectoryInfo.centreStatus(centre)
    }
    private var phone: ServiceDirectoryInfo.PhoneDisclosure {
        ServiceDirectoryInfo.phoneDisclosure(centre)
    }

    private var statusTone: WVChipTone {
        switch status {
        case .active:  return .green
        case .expired: return .gray
        case .undated: return .gray
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                WVChip(ServiceDirectoryInfo.warrantyTypeLabel(centre.warrantyType), tone: .blue)
                WVChip(status.label, tone: statusTone)
            }

            // `providerInput` is always shown next to a matched provider: the match
            // is fuzzy, so the user's own words are what they can check.
            VStack(alignment: .leading, spacing: 2) {
                Text(provider.line)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(WVColor.label)
                    .fixedSize(horizontal: false, vertical: true)
                if case .unmatched(_, let input, let note) = provider {
                    Text(L.t("Bạn ghi: “%@”", input))
                        .font(.system(size: 12))
                        .foregroundStyle(WVColor.label3)
                    Text(note)
                        .font(.system(size: 12))
                        .foregroundStyle(WVColor.label3)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }

            // Address: the user's, or an explicit "chưa ghi".
            HStack(alignment: .top, spacing: 6) {
                WVIcon("mapPin", size: 12)
                    .foregroundStyle(WVColor.red)
                    .padding(.top, 3)
                VStack(alignment: .leading, spacing: 1) {
                    Text(ServiceDirectoryInfo.centreAddress(centre) ?? DirectoryCopy.addressNone)
                        .font(.system(size: 14))
                        .foregroundStyle(WVColor.label2)
                        .fixedSize(horizontal: false, vertical: true)
                    if ServiceDirectoryInfo.centreAddress(centre) != nil {
                        Text(DirectoryCopy.addressUserLabel)
                            .font(.system(size: 11))
                            .foregroundStyle(WVColor.label3)
                    }
                }
            }

            phoneRow
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// The phone row, in the three states `phoneSource` can produce. Only `user`
    /// is tappable, and only `user` is described as the user's own number.
    @ViewBuilder
    private var phoneRow: some View {
        switch phone {
        case .user(let number, let label, let hint):
            Button {
                if let url = phone.dialURL { UIApplication.shared.open(url) }
            } label: {
                phoneLine(icon: "phone",
                          tint: WVColor.green,
                          number: number,
                          label: label,
                          hint: hint,
                          showChevron: phone.dialURL != nil)
            }
            .buttonStyle(WVPressableStyle())
            .disabled(phone.dialURL == nil)

        case .none(let label, let hint):
            phoneLine(icon: "phone",
                      tint: WVColor.label4,
                      number: label,
                      label: nil,
                      hint: hint,
                      showChevron: false)

        case .unverified(let number, let label, let hint):
            phoneLine(icon: "alert",
                      tint: WVColor.orange,
                      number: number,
                      label: label,
                      hint: hint,
                      showChevron: false)
        }
    }

    private func phoneLine(icon: String, tint: Color, number: String, label: String?,
                           hint: String, showChevron: Bool) -> some View {
        HStack(alignment: .top, spacing: 6) {
            WVIcon(icon, size: 12)
                .foregroundStyle(tint)
                .padding(.top, 3)
            VStack(alignment: .leading, spacing: 1) {
                HStack(spacing: 6) {
                    Text(number)
                        .font(.system(size: 14, weight: label == nil ? .regular : .semibold))
                        .foregroundStyle(label == nil ? WVColor.label2 : WVColor.label)
                    if let label {
                        Text(label)
                            .font(.system(size: 11))
                            .foregroundStyle(WVColor.label3)
                    }
                }
                Text(hint)
                    .font(.system(size: 11))
                    .foregroundStyle(WVColor.label3)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
            if showChevron {
                WVIcon("arrowRight", size: 12)
                    .foregroundStyle(WVColor.label4)
                    .padding(.top, 3)
            }
        }
    }
}
