import SwiftUI
import WarrantyVaultKit

/// Lists every PushSubscription tied to the current user (web, APNs, FCM)
/// and lets them unregister one or fire a test notification.
///
/// Backed by `GET /api/v1/push`, `DELETE /api/v1/push/{id}` and
/// `POST /api/v1/push/test`. Mirrors the equivalent settings panel on the web.
struct PushDevicesView: View {
    let client: APIClient

    @State private var subscriptions: [PushSubscriptionMeta] = []
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var pendingDeleteId: String?
    @State private var isSendingTest = false
    @State private var toast: ToastKind?

    enum ToastKind {
        case success(String)
        case warning(String)
        case error(String)

        var message: String {
            switch self {
            case .success(let m), .warning(let m), .error(let m): return m
            }
        }
        var icon: String {
            switch self {
            case .success: return "checkmark.circle.fill"
            case .warning: return "exclamationmark.triangle.fill"
            case .error:   return "xmark.octagon.fill"
            }
        }
        var tint: Color {
            switch self {
            case .success: return WV.Tokens.success
            case .warning: return WV.Tokens.warning
            case .error:   return WV.Tokens.destructive
            }
        }
    }

    var body: some View {
        content
            .navigationTitle("Thiết bị nhận thông báo")
            .navigationBarTitleDisplayMode(.inline)
            .background(WV.Tokens.bg)
            .task { await reload() }
            .refreshable { await reload() }
            .overlay(alignment: .top) { toastBanner }
    }

    @ViewBuilder
    private var content: some View {
        if isLoading && subscriptions.isEmpty {
            ScrollView { WVSkeletonList(count: 3) }
        } else if let errorMessage, subscriptions.isEmpty {
            WVEmptyState(
                icon: "exclamationmark.triangle.fill",
                tint: WV.Tokens.warning,
                title: "Không tải được danh sách",
                message: errorMessage,
                ctaTitle: "Thử lại",
                action: { Task { await reload() } }
            )
        } else if subscriptions.isEmpty {
            WVEmptyState(
                icon: "bell.slash.fill",
                tint: WV.Tokens.mutedFg,
                title: "Chưa có thiết bị nào đăng ký",
                message: "Bật thông báo ở Cài đặt để nhận nhắc bảo hành, gia hạn và wishlist."
            )
        } else {
            ScrollView {
                LazyVStack(spacing: WV.Spacing.md) {
                    testCard
                    ForEach(subscriptions) { sub in
                        subscriptionCard(sub)
                    }
                }
                .padding(WV.Spacing.lg)
                .animation(.spring(response: 0.35, dampingFraction: 0.85),
                           value: subscriptions.count)
            }
        }
    }

    // MARK: - Test card

    private var testCard: some View {
        WVCard {
            VStack(alignment: .leading, spacing: WV.Spacing.sm) {
                HStack(spacing: WV.Spacing.md) {
                    ZStack {
                        RoundedRectangle(cornerRadius: WV.Radius.md)
                            .fill(WV.Tokens.primary.opacity(0.14))
                        Image(systemName: "paperplane.fill")
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundStyle(WV.Tokens.primary)
                    }
                    .frame(width: 36, height: 36)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Gửi thông báo thử")
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(WV.Tokens.fg)
                        Text("Bắn 1 push đến tất cả \(subscriptions.count) thiết bị bên dưới.")
                            .font(.system(size: 12))
                            .foregroundStyle(WV.Tokens.mutedFg)
                    }
                    Spacer()
                }
                Button {
                    Task { await sendTest() }
                } label: {
                    HStack {
                        if isSendingTest {
                            ProgressView().tint(WV.Tokens.primaryFg)
                        }
                        Text(isSendingTest ? "Đang gửi…" : "Gửi thử")
                    }
                }
                .buttonStyle(PrimaryButtonStyle(fullWidth: true))
                .disabled(isSendingTest)
            }
        }
    }

    // MARK: - Subscription card

    private func subscriptionCard(_ sub: PushSubscriptionMeta) -> some View {
        WVCard {
            HStack(spacing: WV.Spacing.md) {
                ZStack {
                    RoundedRectangle(cornerRadius: WV.Radius.md)
                        .fill(tint(for: sub.platform).opacity(0.14))
                    Image(systemName: icon(for: sub.platform))
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundStyle(tint(for: sub.platform))
                }
                .frame(width: 44, height: 44)

                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Text(platformLabel(sub.platform))
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(WV.Tokens.fg)
                        Spacer()
                        WVStatusPill(platformBadge(sub.platform),
                                     kind: pillKind(for: sub.platform))
                    }
                    if let ua = sub.userAgent, !ua.isEmpty {
                        Text(ua)
                            .font(.system(size: 12))
                            .foregroundStyle(WV.Tokens.mutedFg)
                            .lineLimit(1)
                            .truncationMode(.tail)
                    }
                    Text("Đăng ký lúc \(formatDate(sub.createdAt))")
                        .font(.system(size: 11))
                        .foregroundStyle(WV.Tokens.mutedFg)
                }

                if pendingDeleteId == sub.id {
                    ProgressView()
                } else {
                    Button(role: .destructive) {
                        Task { await delete(sub) }
                    } label: {
                        Image(systemName: "trash")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(WV.Tokens.destructive)
                            .padding(8)
                            .background(
                                Circle().fill(WV.Tokens.destructive.opacity(0.12))
                            )
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        // Swipe-to-delete on the row itself for parity with iOS list UX.
        .swipeActions(edge: .trailing, allowsFullSwipe: true) {
            Button(role: .destructive) {
                Task { await delete(sub) }
            } label: {
                Label("Xoá", systemImage: "trash")
            }
        }
    }

    @ViewBuilder
    private var toastBanner: some View {
        if let toast {
            HStack(spacing: WV.Spacing.sm) {
                Image(systemName: toast.icon)
                    .foregroundStyle(toast.tint)
                Text(toast.message)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(WV.Tokens.fg)
            }
            .padding(.horizontal, WV.Spacing.md)
            .padding(.vertical, WV.Spacing.sm)
            .background(
                RoundedRectangle(cornerRadius: WV.Radius.md)
                    .fill(WV.Tokens.card)
                    .shadow(color: .black.opacity(0.08), radius: 8, y: 2)
            )
            .padding(.top, WV.Spacing.md)
            .transition(.move(edge: .top).combined(with: .opacity))
        }
    }

    // MARK: - Labels

    private func platformLabel(_ p: PushPlatform) -> String {
        switch p {
        case .apns: return "iPhone / iPad"
        case .fcm:  return "Android"
        case .web:  return "Trình duyệt web"
        }
    }

    private func platformBadge(_ p: PushPlatform) -> String {
        switch p {
        case .apns: return "APNs"
        case .fcm:  return "FCM"
        case .web:  return "Web Push"
        }
    }

    private func icon(for p: PushPlatform) -> String {
        switch p {
        case .apns: return "applelogo"
        case .fcm:  return "candybarphone"
        case .web:  return "globe"
        }
    }

    private func tint(for p: PushPlatform) -> Color {
        switch p {
        case .apns: return WV.Tokens.primary
        case .fcm:  return WV.Tokens.success
        case .web:  return WV.Tokens.info
        }
    }

    private func pillKind(for p: PushPlatform) -> WVStatusKind {
        switch p {
        case .apns: return .info
        case .fcm:  return .success
        case .web:  return .neutral
        }
    }

    // MARK: - Actions

    private func reload() async {
        isLoading = true
        defer { isLoading = false }
        do {
            let subs = try await client.listPushSubscriptions()
            subscriptions = subs.sorted { $0.createdAt > $1.createdAt }
            errorMessage = nil
        } catch {
            errorMessage = (error as? APIError)?.localizedDescription
                ?? error.localizedDescription
        }
    }

    private func delete(_ sub: PushSubscriptionMeta) async {
        guard pendingDeleteId == nil else { return }
        pendingDeleteId = sub.id
        defer { pendingDeleteId = nil }
        do {
            try await client.unregisterPush(id: sub.id)
            subscriptions.removeAll { $0.id == sub.id }
            showToast(.success("Đã gỡ thiết bị"))
        } catch let err as APIError {
            showToast(.error(err.localizedDescription))
        } catch {
            showToast(.error(error.localizedDescription))
        }
    }

    private func sendTest() async {
        guard !isSendingTest else { return }
        isSendingTest = true
        defer { isSendingTest = false }
        do {
            let r = try await client.sendTestPush()
            if r.failed == 0 {
                showToast(.success("Đã gửi \(r.sent) thông báo"))
            } else if r.sent == 0 {
                showToast(.error("Tất cả \(r.failed) thiết bị gửi thất bại"))
            } else {
                showToast(.warning("Gửi \(r.sent), lỗi \(r.failed)"))
            }
            // Some subscriptions may have been pruned by the server (gone) so
            // refresh the list to stay in sync.
            await reload()
        } catch let err as APIError {
            showToast(.error(err.localizedDescription))
        } catch {
            showToast(.error(error.localizedDescription))
        }
    }

    private func showToast(_ kind: ToastKind) {
        withAnimation { toast = kind }
        Task {
            try? await Task.sleep(nanoseconds: 2_500_000_000)
            withAnimation { toast = nil }
        }
    }
}
