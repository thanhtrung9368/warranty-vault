import SwiftUI
import WarrantyVaultKit

// ============================================================
// PushDevicesView — list of registered push subscriptions.
// Restyled to use WVGroup / WVRow / WVChip from the new design
// system. Data wiring is preserved from the previous version.
// ============================================================

struct PushDevicesView: View {
    let client: APIClient

    @State private var subscriptions: [PushSubscriptionMeta] = []
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var pendingDeleteId: String?
    @State private var isSendingTest = false
    @State private var toastMessage: String?
    @State private var toastIsError = false

    var body: some View {
        Group {
            if isLoading && subscriptions.isEmpty {
                ScrollView { pushSkeleton }
                    .wvScreen()
            } else if let errorMessage, subscriptions.isEmpty {
                ScrollView {
                    WVEmpty(icon: "alert", title: "Không tải được danh sách",
                            description: errorMessage) {
                        WVButton("Thử lại") { Task { await reload() } }
                            .padding(.horizontal, 32)
                    }
                }
                .wvScreen()
            } else if subscriptions.isEmpty {
                ScrollView {
                    WVEmpty(icon: "bellOff",
                            title: "Chưa có thiết bị nào đăng ký",
                            description: "Bật thông báo ở Cài đặt để nhận nhắc bảo hành, gia hạn và wishlist.")
                }
                .wvScreen()
            } else {
                ScrollView {
                    VStack(spacing: 0) {
                        Spacer().frame(height: 8)
                        testCard
                        WVSectionHeader("Đã đăng ký")
                        deviceList
                        Spacer().frame(height: 24)
                    }
                }
                .wvScreen()
            }
        }
        .task { await reload() }
        .refreshable { await reload() }
        .overlay(alignment: .top) { toastBanner }
    }

    // MARK: - Test card

    private var testCard: some View {
        WVCard {
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 12) {
                    WVLeadingIcon(icon: "send", color: WVColor.brand)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Gửi thông báo thử")
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(WVColor.label)
                        Text("Bắn 1 push đến tất cả \(subscriptions.count) thiết bị bên dưới.")
                            .font(.system(size: 12))
                            .foregroundStyle(WVColor.label3)
                    }
                    Spacer()
                }
                WVButton(
                    isSendingTest ? "Đang gửi…" : "Gửi thử",
                    icon: "send",
                    kind: .primary
                ) {
                    Task { await sendTest() }
                }
                .disabled(isSendingTest)
            }
        }
    }

    // MARK: - Device list

    private var deviceList: some View {
        WVGroup {
            ForEach(Array(subscriptions.enumerated()), id: \.element.id) { idx, sub in
                if idx > 0 { WVDivider(inset: 60) }
                pushDeviceRow(sub)
            }
        }
    }

    private func pushDeviceRow(_ sub: PushSubscriptionMeta) -> some View {
        HStack(spacing: 12) {
            WVLeadingIcon(
                icon: platformIcon(sub.platform),
                color: platformColor(sub.platform),
                size: 36
            )

            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text(platformLabel(sub.platform))
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(WVColor.label)
                    Spacer(minLength: 4)
                    WVChip(platformBadge(sub.platform),
                           tone: platformChipTone(sub.platform))
                }
                if let ua = sub.userAgent, !ua.isEmpty {
                    Text(ua)
                        .font(.system(size: 12))
                        .foregroundStyle(WVColor.label3)
                        .lineLimit(1)
                        .truncationMode(.tail)
                }
                Text("Đăng ký lúc \(WVFormat.date(sub.createdAt))")
                    .font(.system(size: 11))
                    .foregroundStyle(WVColor.label3)
            }

            Spacer(minLength: 0)

            if pendingDeleteId == sub.id {
                ProgressView().scaleEffect(0.8)
            } else {
                Button(role: .destructive) {
                    Task { await delete(sub) }
                } label: {
                    Circle()
                        .fill(WVColor.red.opacity(0.12))
                        .frame(width: 32, height: 32)
                        .overlay(
                            WVIcon("trash", size: 14)
                                .foregroundStyle(WVColor.red)
                        )
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 16)
        .frame(minHeight: 56)
        .padding(.vertical, 8)
    }

    // MARK: - Skeleton

    private var pushSkeleton: some View {
        VStack(spacing: 0) {
            Spacer().frame(height: 8)
            WVGroup {
                ForEach(0..<3) { i in
                    if i > 0 { WVDivider(inset: 60) }
                    HStack(spacing: 12) {
                        RoundedRectangle(cornerRadius: 8, style: .continuous)
                            .fill(WVColor.fill3)
                            .frame(width: 36, height: 36)
                        VStack(alignment: .leading, spacing: 6) {
                            RoundedRectangle(cornerRadius: 4, style: .continuous)
                                .fill(WVColor.fill3)
                                .frame(height: 14)
                            RoundedRectangle(cornerRadius: 4, style: .continuous)
                                .fill(WVColor.fill3)
                                .frame(width: 100, height: 10)
                        }
                        Spacer()
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 14)
                    .redacted(reason: .placeholder)
                }
            }
        }
    }

    // MARK: - Toast overlay

    @ViewBuilder
    private var toastBanner: some View {
        if let toastMessage {
            HStack(spacing: 8) {
                WVIcon(toastIsError ? "alert" : "checkCircle", size: 15)
                Text(toastMessage)
                    .font(.system(size: 13, weight: .medium))
            }
            .foregroundStyle(.white)
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .background(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(Color(hex: "282828").opacity(0.92))
            )
            .padding(.top, 8)
            .transition(.move(edge: .top).combined(with: .opacity))
        }
    }

    // MARK: - Platform helpers

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

    private func platformIcon(_ p: PushPlatform) -> String {
        switch p {
        case .apns: return "smartphone"
        case .fcm:  return "smartphone"
        case .web:  return "globe"
        }
    }

    private func platformColor(_ p: PushPlatform) -> Color {
        switch p {
        case .apns: return WVColor.brand
        case .fcm:  return WVColor.green
        case .web:  return WVColor.blue
        }
    }

    private func platformChipTone(_ p: PushPlatform) -> WVChipTone {
        switch p {
        case .apns: return .brand
        case .fcm:  return .green
        case .web:  return .blue
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
            errorMessage = (error as? APIError)?.localizedDescription ?? error.localizedDescription
        }
    }

    private func delete(_ sub: PushSubscriptionMeta) async {
        guard pendingDeleteId == nil else { return }
        pendingDeleteId = sub.id
        defer { pendingDeleteId = nil }
        do {
            try await client.unregisterPush(id: sub.id)
            subscriptions.removeAll { $0.id == sub.id }
            showToast("Đã gỡ thiết bị", error: false)
        } catch let err as APIError {
            showToast(err.localizedDescription, error: true)
        } catch {
            showToast(error.localizedDescription, error: true)
        }
    }

    private func sendTest() async {
        guard !isSendingTest else { return }
        isSendingTest = true
        defer { isSendingTest = false }
        do {
            let r = try await client.sendTestPush()
            if r.failed == 0 {
                showToast("Đã gửi \(r.sent) thông báo", error: false)
            } else if r.sent == 0 {
                showToast("Tất cả \(r.failed) thiết bị gửi thất bại", error: true)
            } else {
                showToast("Gửi \(r.sent), lỗi \(r.failed)", error: true)
            }
            await reload()
        } catch let err as APIError {
            showToast(err.localizedDescription, error: true)
        } catch {
            showToast(error.localizedDescription, error: true)
        }
    }

    private func showToast(_ message: String, error: Bool) {
        withAnimation(.spring(response: 0.32, dampingFraction: 0.8)) {
            toastMessage = message
            toastIsError = error
        }
        Task {
            try? await Task.sleep(nanoseconds: 2_500_000_000)
            withAnimation { toastMessage = nil }
        }
    }
}
