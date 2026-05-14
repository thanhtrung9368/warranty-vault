import SwiftUI
import WarrantyVaultKit

struct SettingsView: View {
    @EnvironmentObject var auth: AuthStore
    @EnvironmentObject var push: PushRegistrar
    @EnvironmentObject var theme: ThemeStore

    let client: APIClient
    @State private var showChangePassword = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: WV.Spacing.lg) {
                    WVPageIntro(
                        title: "Cài đặt",
                        subtitle: "Tùy chỉnh app theo ý mày"
                    )

                    accountCard
                    appearanceCard
                    notificationsCard
                    securityCard
                    systemCard
                    logoutCard
                }
                .padding(.horizontal, WV.Spacing.lg)
                .padding(.bottom, WV.Spacing.xl)
            }
            .background(WV.Tokens.bg)
            .navigationBarTitleDisplayMode(.inline)
            .sheet(isPresented: $showChangePassword) {
                ChangePasswordSheet(client: client)
            }
        }
    }

    // MARK: - Cards

    private var accountCard: some View {
        sectionCard(title: "Tài khoản") {
            if case let .authenticated(user) = auth.status {
                row(icon: "person.crop.circle.fill", iconTint: WV.Tokens.primary) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(user.name ?? user.email)
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(WV.Tokens.fg)
                        Text(user.email)
                            .font(.system(size: 12))
                            .foregroundStyle(WV.Tokens.mutedFg)
                    }
                }
                Divider()
            }
            Button {
                showChangePassword = true
            } label: {
                row(icon: "key.fill", iconTint: WV.Tokens.primary,
                    chevron: true) {
                    Text("Đổi mật khẩu")
                        .font(.system(size: 15))
                        .foregroundStyle(WV.Tokens.fg)
                }
            }
            .buttonStyle(.plain)
        }
    }

    private var appearanceCard: some View {
        sectionCard(title: "Giao diện") {
            ForEach(Array(ThemePreference.allCases.enumerated()), id: \.element.id) { idx, option in
                Button {
                    theme.preference = option
                } label: {
                    row(icon: option.icon, iconTint: WV.Tokens.primary) {
                        HStack {
                            Text(option.label)
                                .font(.system(size: 15))
                                .foregroundStyle(WV.Tokens.fg)
                            Spacer()
                            if theme.preference == option {
                                Image(systemName: "checkmark")
                                    .font(.system(size: 13, weight: .semibold))
                                    .foregroundStyle(WV.Tokens.primary)
                            }
                        }
                    }
                }
                .buttonStyle(.plain)
                if idx < ThemePreference.allCases.count - 1 { Divider() }
            }
        }
    }

    private var notificationsCard: some View {
        sectionCard(title: "Thông báo") {
            row(icon: "bell.badge.fill", iconTint: WV.Tokens.primary) {
                HStack {
                    Text("Thông báo bảo hành")
                        .font(.system(size: 15))
                        .foregroundStyle(WV.Tokens.fg)
                    Spacer()
                    pushBadge
                }
            }
            Divider()
            Button {
                Task { await push.requestAndRegister() }
            } label: {
                row(icon: "arrow.triangle.2.circlepath", iconTint: WV.Tokens.primary,
                    chevron: true) {
                    Text(pushButtonLabel)
                        .font(.system(size: 15))
                        .foregroundStyle(WV.Tokens.fg)
                }
            }
            .buttonStyle(.plain)
            .disabled(pushButtonDisabled)
            Divider()
            NavigationLink {
                PushDevicesView(client: client)
            } label: {
                row(icon: "iphone.gen3", iconTint: WV.Tokens.info,
                    chevron: true) {
                    Text("Thiết bị nhận thông báo")
                        .font(.system(size: 15))
                        .foregroundStyle(WV.Tokens.fg)
                }
            }
            .buttonStyle(.plain)
            Text(pushHint)
                .font(.system(size: 12))
                .foregroundStyle(WV.Tokens.mutedFg)
                .padding(.top, WV.Spacing.xs)
        }
    }

    private var securityCard: some View {
        sectionCard(title: "Bảo mật") {
            row(icon: "lock.shield.fill", iconTint: WV.Tokens.success) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Phiên đăng nhập")
                        .font(.system(size: 15))
                        .foregroundStyle(WV.Tokens.fg)
                    Text("Bearer token được lưu trong Keychain.")
                        .font(.system(size: 12))
                        .foregroundStyle(WV.Tokens.mutedFg)
                }
            }
        }
    }

    private var systemCard: some View {
        sectionCard(title: "Hệ thống") {
            row(icon: "server.rack", iconTint: WV.Tokens.mutedFg) {
                HStack {
                    Text("Backend")
                        .font(.system(size: 15))
                        .foregroundStyle(WV.Tokens.fg)
                    Spacer()
                    Text(auth.baseURL.absoluteString)
                        .font(.system(size: 12))
                        .foregroundStyle(WV.Tokens.mutedFg)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
            }
            Divider()
            row(icon: "info.circle.fill", iconTint: WV.Tokens.mutedFg) {
                HStack {
                    Text("Phiên bản")
                        .font(.system(size: 15))
                        .foregroundStyle(WV.Tokens.fg)
                    Spacer()
                    Text(appVersion)
                        .font(.system(size: 12))
                        .foregroundStyle(WV.Tokens.mutedFg)
                }
            }
        }
    }

    private var logoutCard: some View {
        WVCard {
            Button {
                Task { await auth.logout() }
            } label: {
                HStack(spacing: WV.Spacing.md) {
                    iconChip("rectangle.portrait.and.arrow.right",
                             tint: WV.Tokens.destructive)
                    Text("Đăng xuất")
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(WV.Tokens.destructive)
                    Spacer()
                }
                .padding(.vertical, 4)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
    }

    // MARK: - Building blocks

    @ViewBuilder
    private func sectionCard<Content: View>(
        title: String,
        @ViewBuilder _ content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: WV.Spacing.sm) {
            Text(title)
                .font(.headline.weight(.semibold))
                .foregroundStyle(WV.Tokens.fg)
                .padding(.horizontal, WV.Spacing.xs)
            WVCard {
                VStack(alignment: .leading, spacing: WV.Spacing.sm) {
                    content()
                }
            }
        }
    }

    @ViewBuilder
    private func row<Content: View>(
        icon: String,
        iconTint: Color,
        chevron: Bool = false,
        @ViewBuilder _ content: () -> Content
    ) -> some View {
        HStack(spacing: WV.Spacing.md) {
            iconChip(icon, tint: iconTint)
            content()
                .frame(maxWidth: .infinity, alignment: .leading)
            if chevron {
                Image(systemName: "chevron.right")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(WV.Tokens.mutedFg)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
    }

    private func iconChip(_ name: String, tint: Color) -> some View {
        ZStack {
            RoundedRectangle(cornerRadius: WV.Radius.md)
                .fill(tint.opacity(0.14))
            Image(systemName: name)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(tint)
        }
        .frame(width: 36, height: 36)
    }

    @ViewBuilder
    private var pushBadge: some View {
        switch push.status {
        case .registered:
            WVStatusPill("Đã bật", kind: .success)
        case .registering, .requesting:
            ProgressView().scaleEffect(0.8)
        case .denied:
            WVStatusPill("Đã tắt", kind: .danger)
        case .failed:
            WVStatusPill("Lỗi", kind: .warning)
        case .unknown:
            WVStatusPill("Chưa bật", kind: .neutral)
        }
    }

    private var pushButtonLabel: String {
        switch push.status {
        case .registered:    return "Đăng ký lại token"
        case .denied:        return "Mở Cài đặt iOS để bật"
        case .failed(let m): return "Thử lại — \(m)"
        case .registering:   return "Đang đăng ký…"
        case .requesting:    return "Đang xin quyền…"
        case .unknown:       return "Bật thông báo"
        }
    }

    private var pushButtonDisabled: Bool {
        switch push.status {
        case .registering, .requesting: return true
        default: return false
        }
    }

    private var pushHint: String {
        switch push.status {
        case .denied:
            return "Bạn đã từ chối quyền thông báo. Vào Cài đặt iOS → WarrantyVault → Thông báo để bật lại."
        case .registered:
            return "Bạn sẽ nhận nhắc khi bảo hành sắp hết, gói dịch vụ tới hạn, hoặc món thèm tới ngày dự kiến."
        default:
            return "Đăng ký APNs để nhận nhắc bảo hành, đăng ký gói dịch vụ, và wishlist."
        }
    }

    private var appVersion: String {
        let v = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "—"
        let b = Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? ""
        return b.isEmpty ? v : "\(v) (\(b))"
    }
}
