import SwiftUI
import WarrantyVaultKit

struct DevicesListView: View {
    @EnvironmentObject var auth: AuthStore
    @StateObject var store: DevicesStore
    @State private var showAdd = false

    init(client: APIClient) {
        _store = StateObject(wrappedValue: DevicesStore(client: client))
    }

    var body: some View {
        NavigationStack {
            content
                .navigationTitle("Thiết bị")
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button { showAdd = true } label: {
                            Image(systemName: "plus.circle.fill")
                                .font(.system(size: 22))
                                .foregroundStyle(WV.Tokens.primary)
                        }
                    }
                }
        }
        .task { await store.load() }
        .refreshable { await store.load() }
        .sheet(isPresented: $showAdd) {
            AddDeviceSheet(store: store, client: auth.client)
        }
        .background(WV.Tokens.bg)
    }

    @ViewBuilder
    private var content: some View {
        switch store.state {
        case .idle:
            ScrollView { WVSkeletonList(count: 4) }
        case .loading where store.devices.isEmpty:
            ScrollView { WVSkeletonList(count: 4) }
        case .error(let msg) where store.devices.isEmpty:
            errorState(msg)
        case .loaded where store.devices.isEmpty:
            emptyState
        default:
            list
        }
    }

    private var list: some View {
        ScrollView {
            VStack(spacing: 0) {
                WVPageIntro(subtitle: subtitle)
                LazyVStack(spacing: WV.Spacing.md) {
                    ForEach(store.devices) { device in
                        NavigationLink(value: device) {
                            DeviceCard(device: device)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(WV.Spacing.lg)
                .animation(.spring(response: 0.35, dampingFraction: 0.85), value: store.devices.count)
            }
        }
        .navigationDestination(for: Device.self) { device in
            DeviceDetailView(device: device, client: auth.client, devicesStore: store)
        }
    }

    private var subtitle: String {
        let n = store.devices.count
        if n == 0 { return "Chưa có gì cả." }
        return "Mày đang theo dõi \(n) thiết bị."
    }

    private var emptyState: some View {
        WVEmptyState(
            icon: "square.stack.3d.up.fill",
            tint: WV.Tokens.primary,
            title: "Chưa có thiết bị nào, mày",
            message: "Thêm thiết bị đầu tiên để bắt đầu theo dõi bảo hành cho gọn.",
            ctaTitle: "Thêm thiết bị đầu tiên",
            action: { showAdd = true }
        )
    }

    private func errorState(_ msg: String) -> some View {
        WVEmptyState(
            icon: "exclamationmark.triangle.fill",
            tint: WV.Tokens.warning,
            title: "Không tải được dữ liệu",
            message: msg,
            ctaTitle: "Thử lại",
            action: { Task { await store.load() } }
        )
    }
}

private struct DeviceCard: View {
    let device: Device

    var body: some View {
        WVCard {
            HStack(alignment: .top, spacing: WV.Spacing.md) {
                ZStack {
                    RoundedRectangle(cornerRadius: WV.Radius.md)
                        .fill(WV.Tokens.primary.opacity(0.12))
                    Image(systemName: iconForCategory(device.category))
                        .font(.system(size: 22, weight: .semibold))
                        .foregroundStyle(WV.Tokens.primary)
                }
                .frame(width: 48, height: 48)

                VStack(alignment: .leading, spacing: 6) {
                    HStack {
                        Text(device.name)
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundStyle(WV.Tokens.fg)
                        Spacer()
                        WVStatusPill(device.status.label, kind: kind(for: device.status))
                    }
                    if let brand = device.brand {
                        Text(brand + (device.model.map { " • \($0)" } ?? ""))
                            .font(.system(size: 13))
                            .foregroundStyle(WV.Tokens.mutedFg)
                    }
                    HStack(spacing: WV.Spacing.sm) {
                        Label(formatVND(device.purchasePrice), systemImage: "tag")
                            .font(.system(size: 12))
                        Spacer()
                        Label(formatDate(device.purchaseDate), systemImage: "calendar")
                            .font(.system(size: 12))
                    }
                    .foregroundStyle(WV.Tokens.mutedFg)
                }
            }
        }
    }

    private func kind(for status: DeviceStatus) -> WVStatusKind {
        switch status {
        case .ACTIVE:  return .success
        case .EXPIRED: return .neutral
        case .SOLD:    return .accent
        case .BROKEN:  return .danger
        case .LOST:    return .warning
        }
    }
}

func iconForCategory(_ code: String) -> String {
    switch code {
    case "PHONE":          return "iphone"
    case "LAPTOP":         return "laptopcomputer"
    case "TABLET":         return "ipad"
    case "SMARTWATCH":     return "applewatch"
    case "HEADPHONE":      return "headphones"
    case "SPEAKER":        return "hifispeaker"
    case "CAMERA":         return "camera"
    case "TV":             return "tv"
    case "MONITOR":        return "display"
    case "KEYBOARD":       return "keyboard"
    case "MOUSE":          return "computermouse"
    case "GAMING_CONSOLE": return "gamecontroller"
    case "AC":             return "wind"
    case "FRIDGE":         return "refrigerator"
    case "WASHING":        return "washer"
    case "KITCHEN":        return "fork.knife"
    case "APPLIANCE":      return "house"
    case "ELECTRONICS":    return "bolt"
    case "FURNITURE":      return "sofa"
    default:               return "cube.box"
    }
}

func formatVND(_ amount: Int) -> String {
    let f = NumberFormatter()
    f.numberStyle = .decimal
    f.groupingSeparator = "."
    return (f.string(from: NSNumber(value: amount)) ?? "\(amount)") + "đ"
}

func formatDate(_ date: Date) -> String {
    let f = DateFormatter()
    f.dateFormat = "dd/MM/yyyy"
    return f.string(from: date)
}
