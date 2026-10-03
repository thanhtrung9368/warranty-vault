import SwiftUI
import WarrantyVaultKit

// ============================================================
// SessionsView — "Thiết bị đăng nhập" (device sessions)
//
// Lists the caller's ACTIVE login sessions (`GET /api/v1/auth/sessions`) and
// lets them revoke one (`DELETE /api/v1/auth/sessions/{id}`).
//
// The two rules that shape this screen:
//
//   * `deviceLabel` is nullable — old clients never sent one — so a row must
//     fall back to the API's documented "Không rõ thiết bị" instead of
//     rendering an empty line (`SessionLabels.deviceLabel`).
//   * revoking the **current** session is allowed and is the honest answer to
//     "log this phone out". The server answers `current = true` and the stored
//     bearer token is already dead, so we clear the Keychain and drop to the
//     login screen — exactly what `EmailChangeSheet` does after an email change
//     revokes every session.
//
// Deliberately NOT the same thing as "Thiết bị nhận thông báo" (push targets):
// removing a push subscription only stops notifications; only this screen ends
// access to the data. The footer says so.
// ============================================================

struct SessionsView: View {
    let client: APIClient

    @EnvironmentObject private var auth: AuthStore

    @State private var sessions: [SessionSummary] = []
    @State private var isLoading = false
    @State private var errorMessage: String?

    /// Session awaiting the destructive confirmation.
    @State private var confirmTarget: SessionSummary?
    @State private var pendingRevokeId: String?

    @State private var toastMessage: String?
    @State private var toastIsError = false

    /// Set when the *current* session was revoked: the server has already killed
    /// our bearer, so the alert is the only way back to a working app.
    @State private var signedOutMessage: String?

    var body: some View {
        Group {
            if isLoading && sessions.isEmpty {
                ScrollView { sessionsSkeleton }
                    .wvScreen()
            } else if let errorMessage, sessions.isEmpty {
                ScrollView {
                    WVEmpty(icon: "alert", title: "Không tải được danh sách",
                            description: errorMessage) {
                        WVButton("Thử lại") { Task { await reload() } }
                            .padding(.horizontal, 32)
                    }
                }
                .wvScreen()
            } else if sessions.isEmpty {
                ScrollView {
                    WVEmpty(icon: "shieldX",
                            title: "Không có phiên nào đang hoạt động",
                            description: "Kể cả phiên của thiết bị này cũng không còn — hãy đăng nhập lại.")
                }
                .wvScreen()
            } else {
                list
            }
        }
        .task { await reload() }
        .refreshable { await reload() }
        .overlay(alignment: .top) { toastBanner }
        .confirmationDialog(
            confirmTitle,
            isPresented: Binding(
                get: { confirmTarget != nil },
                set: { if !$0 { confirmTarget = nil } }
            ),
            titleVisibility: .visible
        ) {
            Button(confirmButtonTitle, role: .destructive) {
                if let target = confirmTarget {
                    confirmTarget = nil
                    Task { await revoke(target) }
                }
            }
            Button("Huỷ", role: .cancel) { confirmTarget = nil }
        } message: {
            Text(confirmMessage)
        }
        .alert("Đã đăng xuất thiết bị này", isPresented: Binding(
            get: { signedOutMessage != nil },
            set: { if !$0 { signedOutMessage = nil } }
        )) {
            Button("Đăng nhập lại") {
                Task {
                    // The bearer the app holds is already dead (the server said
                    // so): clearing it is what sends RootView back to login.
                    signedOutMessage = nil
                    await auth.logout()
                }
            }
        } message: {
            Text(signedOutMessage ?? "")
        }
    }

    // MARK: - List

    private var list: some View {
        ScrollView {
            VStack(spacing: 0) {
                Spacer().frame(height: 8)

                WVSectionHeader("Phiên đang hoạt động")
                WVGroup {
                    ForEach(Array(sessions.enumerated()), id: \.element.id) { idx, session in
                        if idx > 0 { WVDivider(inset: 60) }
                        sessionRow(session)
                    }
                }

                WVSectionFooter("Thu hồi một phiên sẽ đăng xuất thiết bị đó ngay lập tức — lần mở app kế tiếp trên máy đó phải đăng nhập lại. Danh sách này khác “Thiết bị nhận thông báo”: xoá một đích nhận thông báo chỉ ngừng gửi push, không thu hồi quyền truy cập dữ liệu.")
                WVSectionFooter("Phiên tự hết hạn sau \(expiryNote). Mở app thường xuyên sẽ tự gia hạn thêm.")

                Spacer().frame(height: 24)
            }
        }
        .wvScreen()
    }

    private func sessionRow(_ session: SessionSummary) -> some View {
        HStack(spacing: 12) {
            WVLeadingIcon(icon: platformIcon(session), color: platformColor(session), size: 36)

            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    // `deviceLabel` is nullable: never render an empty row.
                    Text(SessionLabels.deviceLabel(session))
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(WVColor.label)
                        .lineLimit(1)
                    if session.current {
                        WVChip(SessionLabels.thisDevice, tone: .brand)
                    }
                }

                Text(SessionLabels.platformLabel(session))
                    .font(.system(size: 12))
                    .foregroundStyle(WVColor.label3)

                Text("Hoạt động \(WVFormat.date(session.lastSeenAt)) · Đăng nhập \(WVFormat.date(session.createdAt))")
                    .font(.system(size: 11))
                    .foregroundStyle(WVColor.label3)
                    .lineLimit(1)

                Text("Hết hạn \(WVFormat.date(session.expiresAt))")
                    .font(.system(size: 11))
                    .foregroundStyle(WVColor.label4)
            }

            Spacer(minLength: 0)

            if pendingRevokeId == session.id {
                ProgressView().scaleEffect(0.8)
            } else {
                Button(role: .destructive) {
                    confirmTarget = session
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
                .accessibilityLabel(session.current
                                    ? "Đăng xuất thiết bị này"
                                    : "Thu hồi phiên \(SessionLabels.deviceLabel(session))")
            }
        }
        .padding(.horizontal, 16)
        .frame(minHeight: 56)
        .padding(.vertical, 8)
    }

    // MARK: - Skeleton

    private var sessionsSkeleton: some View {
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
                                .frame(width: 140, height: 10)
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

    // MARK: - Confirmation copy

    private var confirmTitle: String {
        guard let target = confirmTarget else { return "Thu hồi phiên đăng nhập?" }
        return target.current
            ? "Đăng xuất thiết bị này?"
            : "Thu hồi phiên của “\(SessionLabels.deviceLabel(target))”?"
    }

    private var confirmButtonTitle: String {
        (confirmTarget?.current ?? false) ? "Đăng xuất ngay" : "Thu hồi phiên"
    }

    private var confirmMessage: String {
        guard let target = confirmTarget else { return "" }
        if target.current {
            return "Đây chính là thiết bị bạn đang cầm. Thu hồi xong bạn sẽ bị đăng xuất ngay và phải đăng nhập lại bằng email + mật khẩu."
        }
        return "Thiết bị đó sẽ bị đăng xuất ngay lập tức. Các phiên khác — kể cả thiết bị này — giữ nguyên."
    }

    // MARK: - Toast

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
    //
    // `platform` is `web | ios | android | null` (the API normalises everything
    // else to null) — `apns`/`fcm` belong to the push-subscription entity, so
    // there is no branch for them. The Vietnamese label comes from
    // `SessionLabels.platformLabel`; these two only pick an icon and a colour.

    private func platformIcon(_ session: SessionSummary) -> String {
        switch (session.platform ?? "").lowercased() {
        case "web":     return "globe"
        case "ios":     return "smartphone"
        case "android": return "smartphone"
        default:        return "lock"
        }
    }

    private func platformColor(_ session: SessionSummary) -> Color {
        switch (session.platform ?? "").lowercased() {
        case "web":     return WVColor.blue
        case "ios":     return WVColor.brand
        case "android": return WVColor.green
        default:        return WVColor.gray
        }
    }

    /// The sliding TTL is a server constant (30 days); the screen states it as a
    /// fact rather than pretending it is configurable.
    private var expiryNote: String { "30 ngày kể từ lần dùng cuối" }

    // MARK: - Actions

    private func reload() async {
        isLoading = true
        defer { isLoading = false }
        do {
            // The API already sorts newest-activity-first and always answers
            // `[]`; we keep the server order rather than re-sorting.
            sessions = try await client.listSessions()
            errorMessage = nil
        } catch {
            errorMessage = (error as? APIError)?.localizedDescription ?? error.localizedDescription
        }
    }

    private func revoke(_ session: SessionSummary) async {
        guard pendingRevokeId == nil else { return }
        pendingRevokeId = session.id
        defer { pendingRevokeId = nil }

        do {
            let result = try await client.revokeSession(id: session.id)

            // `alreadyRevoked` is a success: the row is gone either way, so it
            // leaves the list without an error.
            sessions.removeAll { $0.id == session.id }

            switch SessionRevokeOutcome.of(result) {
            case .signedOutLocally:
                // The server just killed the token we are holding.
                signedOutMessage = SessionLabels.message(for: result)
            case .revoked, .alreadyRevoked:
                showToast(SessionLabels.message(for: result), error: false)
            }
        } catch let err as APIError {
            // A session can disappear between the read and the tap (expiry, or a
            // revoke from another device). 404 is "not yours / not there", so the
            // honest response is to refresh the list instead of pretending the
            // revoke worked.
            if case .server(let status, _) = err, status == 404 {
                sessions.removeAll { $0.id == session.id }
                showToast("Phiên này không còn trong danh sách.", error: false)
                await reload()
            } else {
                showToast(err.localizedDescription, error: true)
            }
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
