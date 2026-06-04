import SwiftUI

// ============================================================
// WarrantyVault iOS — shared UI components
//
// SwiftUI port of the Claude Design handoff prototype
// (project/ios/js/ios-ui.jsx). Screens compose these; the visual
// contract — radii, fills, type scale — matches styles.css.
// ============================================================

// MARK: - Icon

/// Maps the prototype's semantic icon names (icons.jsx) onto SF Symbols so
/// screens can keep using the same names the design refers to.
enum WVIconMap {
    static let table: [String: String] = [
        "alert": "exclamationmark.triangle.fill", "arrowDown": "arrow.down",
        "arrowLeft": "arrow.left", "arrowRight": "arrow.right", "arrowUp": "arrow.up",
        "bar": "chart.bar.fill", "bell": "bell.fill", "bellOff": "bell.slash.fill",
        "bike": "bicycle", "briefcase": "briefcase.fill", "calendar": "calendar",
        "camera": "camera.fill", "car": "car.fill", "chart": "chart.bar.fill",
        "check": "checkmark", "checkCircle": "checkmark.circle.fill", "circle": "circle",
        "clock": "clock.fill", "cloud": "cloud.fill", "coffee": "cup.and.saucer.fill",
        "creditCard": "creditcard.fill", "database": "externaldrive.fill",
        "def": "shippingbox.fill", "download": "arrow.down.circle.fill", "edit": "pencil",
        "ellipse": "ellipsis", "externalLink": "arrow.up.right.square",
        "film": "film.fill", "filter": "line.3.horizontal.decrease",
        "gamepad": "gamecontroller.fill", "globe": "globe", "hash": "number",
        "headphones": "headphones", "heart": "heart.fill", "home": "house.fill",
        "http": "globe", "info": "info.circle.fill", "key": "key.fill",
        "laptop": "laptopcomputer", "layout": "square.grid.2x2.fill",
        "line": "chart.xyaxis.line", "link": "link", "lock": "lock.fill",
        "logIn": "arrow.right.to.line", "logOut": "rectangle.portrait.and.arrow.right",
        "mail": "envelope.fill", "mapPin": "mappin.circle.fill", "menu": "line.3.horizontal",
        "minus": "minus", "monitor": "display", "more": "ellipsis",
        "moreH": "ellipsis", "moon": "moon.fill", "music": "music.note",
        "package": "shippingbox.fill", "paperclip": "paperclip", "phone": "phone.fill",
        "plus": "plus", "printer": "printer.fill", "receipt": "doc.text.fill",
        "refresh": "arrow.clockwise", "rotateCcw": "arrow.counterclockwise",
        "save": "square.and.arrow.down", "search": "magnifyingglass",
        "send": "paperplane.fill", "settings": "gearshape.fill", "shield": "shield.fill",
        "shieldCheck": "checkmark.shield.fill", "shieldX": "xmark.shield.fill",
        "shoppingBag": "bag.fill", "smartphone": "iphone", "sparkles": "sparkles",
        "stickyNote": "note.text", "store": "building.2.fill", "sun": "sun.max.fill",
        "tag": "tag.fill", "trash": "trash.fill", "trendingDown": "arrow.down.right",
        "trendingUp": "arrow.up.right", "trophy": "trophy.fill", "tv": "tv.fill",
        "unlock": "lock.open.fill", "upload": "arrow.up.circle.fill", "user": "person.fill",
        "userPlus": "person.badge.plus", "users": "person.2.fill", "wallet": "wallet.pass.fill",
        "watch": "applewatch", "x": "xmark", "zap": "bolt.fill",
    ]

    static func symbol(_ name: String) -> String { table[name] ?? "questionmark" }
}

/// A design-system icon. `name` is a prototype icon name (see `WVIconMap`).
struct WVIcon: View {
    let name: String
    var size: CGFloat = 17
    var weight: Font.Weight = .semibold

    init(_ name: String, size: CGFloat = 17, weight: Font.Weight = .semibold) {
        self.name = name; self.size = size; self.weight = weight
    }

    var body: some View {
        Image(systemName: WVIconMap.symbol(name))
            .font(.system(size: size, weight: weight))
    }
}

/// The rounded-square colored icon badge used at the leading edge of rows.
struct WVLeadingIcon: View {
    let icon: String
    var color: Color = WVColor.gray
    var size: CGFloat = 30

    var body: some View {
        RoundedRectangle(cornerRadius: size * 0.23, style: .continuous)
            .fill(color)
            .frame(width: size, height: size)
            .overlay(WVIcon(icon, size: size * 0.56).foregroundStyle(.white))
    }
}

// MARK: - Screen background

extension View {
    /// Fills the safe area with the grouped background. Apply on each screen's
    /// root scroll view.
    func wvScreen() -> some View {
        self.background(WVColor.bg.ignoresSafeArea())
    }
}

// MARK: - Section header / footer

struct WVSectionHeader: View {
    let text: String
    init(_ text: String) { self.text = text }
    var body: some View {
        Text(text.uppercased())
            .font(.system(size: 13))
            .foregroundStyle(WVColor.label3)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 32)
            .padding(.top, 20)
            .padding(.bottom, 6)
    }
}

struct WVSectionFooter: View {
    let text: String
    init(_ text: String) { self.text = text }
    var body: some View {
        Text(text)
            .font(.system(size: 13))
            .foregroundStyle(WVColor.label3)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 32)
            .padding(.top, 7)
    }
}

// MARK: - Grouped container + rows

/// Inset rounded container (`.ios-group`). Place `WVRow`s / custom rows inside,
/// separating with `WVDivider` where the design shows hairlines.
struct WVGroup<Content: View>: View {
    @ViewBuilder var content: Content
    var body: some View {
        VStack(spacing: 0) { content }
            .background(WVColor.bg2)
            .clipShape(RoundedRectangle(cornerRadius: WVRadius.list, style: .continuous))
            .padding(.horizontal, WVSpacing.gutter)
    }
}

/// Inset hairline divider used between rows inside a `WVGroup`.
struct WVDivider: View {
    /// Leading inset — 60 when the rows carry leading icons, 16 otherwise.
    var inset: CGFloat = 16
    var body: some View {
        Rectangle()
            .fill(WVColor.sep)
            .frame(height: 0.5)
            .padding(.leading, inset)
    }
}

enum WVRowRole { case normal, destructive, tint, centered }

/// Standard grouped-list row: leading icon, title/subtitle, trailing detail +
/// chevron. For fully custom content use `WVRowContainer`.
struct WVRow: View {
    var icon: String?
    var iconColor: Color = WVColor.gray
    var iconLarge: Bool = false
    var title: String
    var subtitle: String?
    var detail: String?
    var chevron: Bool = false
    var role: WVRowRole = .normal
    var action: (() -> Void)?

    private var titleColor: Color {
        switch role {
        case .destructive: return WVColor.red
        case .tint, .centered: return WVColor.tint
        case .normal: return WVColor.label
        }
    }

    var body: some View {
        Button {
            action?()
        } label: {
            HStack(spacing: 12) {
                if role == .centered { Spacer(minLength: 0) }
                if let icon {
                    WVLeadingIcon(icon: icon, color: iconColor, size: iconLarge ? 36 : 30)
                }
                VStack(alignment: .leading, spacing: 1) {
                    Text(title)
                        .font(.system(size: 17))
                        .foregroundStyle(titleColor)
                        .lineLimit(1)
                    if let subtitle {
                        Text(subtitle)
                            .font(.system(size: 13))
                            .foregroundStyle(WVColor.label3)
                            .lineLimit(1)
                    }
                }
                if role != .centered { Spacer(minLength: 8) }
                if let detail {
                    Text(detail)
                        .font(.system(size: 17))
                        .foregroundStyle(WVColor.label3)
                        .lineLimit(1)
                }
                if chevron {
                    WVIcon("arrowRight", size: 13, weight: .semibold)
                        .foregroundStyle(WVColor.label4)
                }
                if role == .centered { Spacer(minLength: 0) }
            }
            .padding(.horizontal, 16)
            .frame(minHeight: 44)
            .padding(.vertical, 7)
            .contentShape(Rectangle())
        }
        .buttonStyle(WVRowButtonStyle())
        .disabled(action == nil)
    }
}

/// Wrap arbitrary content so it picks up the row's tap highlight + min height.
struct WVRowContainer<Content: View>: View {
    var action: (() -> Void)?
    @ViewBuilder var content: Content
    var body: some View {
        Button { action?() } label: {
            content
                .padding(.horizontal, 16)
                .frame(minHeight: 44)
                .padding(.vertical, 7)
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
        }
        .buttonStyle(WVRowButtonStyle())
        .disabled(action == nil)
    }
}

/// Tap highlight matching `.ios-row:active` (fill-4 wash).
struct WVRowButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background(configuration.isPressed ? WVColor.fill4 : Color.clear)
    }
}

// MARK: - Buttons

enum WVButtonKind { case primary, secondary, ghost, destructive, destructiveGhost }
enum WVButtonSize { case regular, small }

/// Large action button (`.ios-btn`). Full width by default.
struct WVButton: View {
    let title: String
    var icon: String?
    var kind: WVButtonKind = .primary
    var size: WVButtonSize = .regular
    var fullWidth: Bool = true
    let action: () -> Void

    init(_ title: String, icon: String? = nil, kind: WVButtonKind = .primary,
         size: WVButtonSize = .regular, fullWidth: Bool = true,
         action: @escaping () -> Void) {
        self.title = title; self.icon = icon; self.kind = kind
        self.size = size; self.fullWidth = fullWidth; self.action = action
    }

    private var bg: Color {
        switch kind {
        case .primary: return WVColor.tint
        case .secondary, .destructiveGhost: return WVColor.fill2
        case .ghost: return .clear
        case .destructive: return WVColor.red
        }
    }
    private var fg: Color {
        switch kind {
        case .primary, .destructive: return .white
        case .secondary, .ghost: return WVColor.tint
        case .destructiveGhost: return WVColor.red
        }
    }
    private var height: CGFloat { size == .small ? 34 : (kind == .ghost ? 44 : 50) }
    private var radius: CGFloat { size == .small ? 10 : 14 }
    private var fontSize: CGFloat { size == .small ? 15 : 17 }

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                if let icon { WVIcon(icon, size: 18) }
                Text(title)
            }
            .font(.system(size: fontSize, weight: .semibold))
            .foregroundStyle(fg)
            .frame(maxWidth: fullWidth ? .infinity : nil)
            .frame(height: height)
            .padding(.horizontal, size == .small ? 14 : 18)
            .background(bg)
            .clipShape(RoundedRectangle(cornerRadius: radius, style: .continuous))
        }
        .buttonStyle(WVPressableStyle())
    }
}

/// Generic press-dim used by buttons (`:active { opacity: .72 }`).
struct WVPressableStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.opacity(configuration.isPressed ? 0.72 : 1)
    }
}

// MARK: - Chip / Tag

enum WVChipTone {
    case gray, brand, green, orange, red, blue, purple, teal, indigo

    var fg: Color {
        switch self {
        case .gray: return WVColor.label3
        case .brand: return WVColor.brand
        case .green: return WVColor.green
        case .orange: return WVColor.orange
        case .red: return WVColor.red
        case .blue: return WVColor.blue
        case .purple: return WVColor.purple
        case .teal: return WVColor.teal
        case .indigo: return WVColor.indigo
        }
    }
    var bg: Color {
        switch self {
        case .gray: return WVColor.fill3
        case .brand: return WVColor.brandSoft
        default: return fg.opacity(0.18)
        }
    }
}

/// Pill-shaped status chip (`.ios-chip`).
struct WVChip: View {
    let text: String
    var tone: WVChipTone = .gray
    var icon: String?

    init(_ text: String, tone: WVChipTone = .gray, icon: String? = nil) {
        self.text = text; self.tone = tone; self.icon = icon
    }

    var body: some View {
        HStack(spacing: 4) {
            if let icon { WVIcon(icon, size: 10, weight: .bold) }
            Text(text)
        }
        .font(.system(size: 12, weight: .semibold))
        .foregroundStyle(tone.fg)
        .padding(.horizontal, 8)
        .frame(height: 22)
        .background(tone.bg)
        .clipShape(Capsule())
    }
}

/// Compact inline tag (`.ios-tag`) — smaller than a chip, square corners.
struct WVTag: View {
    let text: String
    var brand: Bool = false
    init(_ text: String, brand: Bool = false) { self.text = text; self.brand = brand }
    var body: some View {
        Text(text)
            .font(.system(size: 11, weight: .semibold))
            .foregroundStyle(brand ? WVColor.brand : WVColor.label2)
            .padding(.horizontal, 6)
            .padding(.vertical, 1)
            .background(brand ? WVColor.brandSoft : WVColor.fill3)
            .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
    }
}

// MARK: - Warranty pill

/// Days-left status pill (`WarrantyPill` in ios-ui.jsx).
struct WarrantyPill: View {
    let daysLeft: Int?

    private enum Status { case safe, warn, danger, expired }
    private var status: Status {
        guard let d = daysLeft else { return .expired }
        if d < 0 { return .expired }
        if d <= 30 { return .danger }
        if d <= 90 { return .warn }
        return .safe
    }
    private var label: String {
        guard let d = daysLeft else { return "—" }
        if d < 0 { return "Hết \(abs(d))d" }
        if d == 0 { return "Hết hôm nay" }
        if d <= 90 { return "Còn \(d)d" }
        if d <= 365 { return "Còn ~\(Int((Double(d) / 30).rounded()))th" }
        return "Còn \(String(format: "%.1f", Double(d) / 365)) năm"
    }
    private var color: Color {
        switch status {
        case .safe: return WVColor.green
        case .warn: return WVColor.orange
        case .danger: return WVColor.red
        case .expired: return WVColor.label3
        }
    }

    var body: some View {
        HStack(spacing: 4) {
            if daysLeft != nil {
                Circle().frame(width: 6, height: 6)
            }
            Text(label)
        }
        .font(.system(size: 12, weight: .semibold))
        .foregroundStyle(color)
        .padding(.horizontal, 8)
        .padding(.vertical, 2)
        .background(status == .expired ? WVColor.fill3 : color.opacity(0.18))
        .clipShape(Capsule())
    }
}

// MARK: - Segmented control

/// Full-width segmented control (`.ios-segmented`). Generic over the value.
struct WVSegmented<T: Hashable>: View {
    let options: [(value: T, label: String)]
    @Binding var selection: T

    var body: some View {
        HStack(spacing: 2) {
            ForEach(options, id: \.value) { opt in
                let active = opt.value == selection
                Button {
                    withAnimation(.easeOut(duration: 0.15)) { selection = opt.value }
                } label: {
                    Text(opt.label)
                        .font(.system(size: 13, weight: active ? .semibold : .medium))
                        .foregroundStyle(WVColor.label)
                        .lineLimit(1)
                        .frame(maxWidth: .infinity)
                        .frame(height: 28)
                        .background {
                            if active {
                                RoundedRectangle(cornerRadius: 7, style: .continuous)
                                    .fill(WVColor.bg2)
                                    .shadow(color: .black.opacity(0.08), radius: 3, y: 2)
                            }
                        }
                }
                .buttonStyle(.plain)
            }
        }
        .padding(2)
        .background(WVColor.fill3)
        .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
    }
}

// MARK: - Empty state

struct WVEmpty<Action: View>: View {
    var icon: String = "package"
    var title: String
    var description: String?
    @ViewBuilder var action: Action

    var body: some View {
        VStack(spacing: 10) {
            Circle()
                .fill(WVColor.fill3)
                .frame(width: 80, height: 80)
                .overlay(WVIcon(icon, size: 32, weight: .regular).foregroundStyle(WVColor.label3))
            Text(title)
                .font(.system(size: 22, weight: .bold))
                .foregroundStyle(WVColor.label)
            if let description {
                Text(description)
                    .font(.system(size: 15))
                    .foregroundStyle(WVColor.label3)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: 280)
            }
            action.padding(.top, 2)
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 32)
        .padding(.vertical, 60)
    }
}

extension WVEmpty where Action == EmptyView {
    init(icon: String = "package", title: String, description: String? = nil) {
        self.init(icon: icon, title: title, description: description) { EmptyView() }
    }
}

// MARK: - Cards

/// Plain rounded card (`.ios-card` / `.section-card`).
struct WVCard<Content: View>: View {
    var padding: CGFloat = 16
    @ViewBuilder var content: Content
    var body: some View {
        content
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(WVColor.bg2)
            .clipShape(RoundedRectangle(cornerRadius: WVRadius.card, style: .continuous))
            .padding(.horizontal, WVSpacing.gutter)
    }
}

/// Card with an uppercase section title (`.section-card` with `h4`).
struct WVSectionCard<Content: View>: View {
    var title: String?
    @ViewBuilder var content: Content
    var body: some View {
        WVCard(padding: 16) {
            VStack(alignment: .leading, spacing: 10) {
                if let title {
                    Text(title.uppercased())
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(WVColor.label3)
                }
                content
            }
        }
    }
}

// MARK: - Dashboard widgets

/// Tappable stat widget for the dashboard grid (`.widget`).
struct WVWidget: View {
    var eyebrow: String
    var value: String
    var sub: String?
    var icon: String?
    var brand: Bool = false
    var action: (() -> Void)?

    var body: some View {
        Button { action?() } label: {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 6) {
                    if let icon { WVIcon(icon, size: 12, weight: .bold) }
                    Text(eyebrow.uppercased())
                        .font(.system(size: 11, weight: .semibold))
                        .lineLimit(1)
                }
                .foregroundStyle(brand ? Color.white.opacity(0.85) : WVColor.label3)
                Text(value)
                    .font(.system(size: 26, weight: .bold))
                    .foregroundStyle(brand ? Color.white : WVColor.label)
                    .lineLimit(1)
                if let sub {
                    Text(sub)
                        .font(.system(size: 12))
                        .foregroundStyle(brand ? Color.white.opacity(0.85) : WVColor.label3)
                        .lineLimit(1)
                }
            }
            .frame(maxWidth: .infinity, minHeight: 92, alignment: .topLeading)
            .padding(14)
            .background {
                if brand {
                    LinearGradient(colors: [WVColor.brand, WVColor.brand2],
                                   startPoint: .topLeading, endPoint: .bottomTrailing)
                } else {
                    WVColor.bg2
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: WVRadius.widget, style: .continuous))
        }
        .buttonStyle(WVPressableStyle())
        .disabled(action == nil)
    }
}

/// Smaller stat card (`.ios-stat-card`).
struct WVStatCard: View {
    var eyebrow: String
    var value: String
    var sub: String?
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(eyebrow.uppercased())
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(WVColor.label3)
            Text(value)
                .font(.system(size: 22, weight: .bold))
                .foregroundStyle(WVColor.label)
                .lineLimit(1)
            if let sub {
                Text(sub).font(.system(size: 12)).foregroundStyle(WVColor.label3)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(WVColor.bg2)
        .clipShape(RoundedRectangle(cornerRadius: WVRadius.card, style: .continuous))
    }
}

/// Dashboard greeting header (`.hero-greeting`).
struct WVHeroGreeting: View {
    var name: String
    var subtitle: String
    private var initials: String {
        let parts = name.split(separator: " ")
        let chars = parts.prefix(2).compactMap { $0.first }
        return String(chars).uppercased()
    }
    var body: some View {
        HStack(spacing: 12) {
            Circle()
                .fill(WVColor.brand)
                .frame(width: 44, height: 44)
                .overlay(
                    Text(initials.isEmpty ? "?" : initials)
                        .font(.system(size: 18, weight: .bold))
                        .foregroundStyle(.white)
                )
            VStack(alignment: .leading, spacing: 1) {
                Text(subtitle).font(.system(size: 13)).foregroundStyle(WVColor.label3)
                Text(name).font(.system(size: 20, weight: .bold)).foregroundStyle(WVColor.label)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, WVSpacing.titleGutter)
        .padding(.top, 6)
        .padding(.bottom, 14)
    }
}

/// Section heading with an optional trailing action (`.dash-section-head`).
struct WVDashSectionHead: View {
    let title: String
    var actionLabel: String?
    var action: (() -> Void)?
    init(_ title: String, actionLabel: String? = nil, action: (() -> Void)? = nil) {
        self.title = title; self.actionLabel = actionLabel; self.action = action
    }
    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(title)
                .font(.system(size: 22, weight: .bold))
                .foregroundStyle(WVColor.label)
            Spacer(minLength: 12)
            if let actionLabel, let action {
                Button(actionLabel, action: action)
                    .font(.system(size: 15))
                    .foregroundStyle(WVColor.tint)
            }
        }
        .padding(.horizontal, WVSpacing.titleGutter)
        .padding(.top, 24)
        .padding(.bottom, 8)
    }
}

// MARK: - Progress bar

struct WVProgressBar: View {
    var value: Double           // 0...1
    var tone: Color = WVColor.blue
    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(WVColor.fill3)
                Capsule().fill(tone)
                    .frame(width: max(0, min(1, value)) * geo.size.width)
            }
        }
        .frame(height: 4)
    }
}

// MARK: - Money field

/// Numeric VND input that renders grouped digits while editing.
struct WVMoneyField: View {
    @Binding var value: Int?
    var placeholder: String = "0 ₫"

    private var text: Binding<String> {
        Binding(
            get: {
                guard let v = value else { return "" }
                return Self.formatter.string(from: NSNumber(value: v)) ?? "\(v)"
            },
            set: { raw in
                let digits = raw.filter(\.isNumber)
                value = digits.isEmpty ? nil : Int(digits)
            }
        )
    }
    private static let formatter: NumberFormatter = {
        let f = NumberFormatter()
        f.numberStyle = .decimal
        f.groupingSeparator = "."
        return f
    }()

    var body: some View {
        TextField(placeholder, text: text)
            .keyboardType(.numberPad)
            .multilineTextAlignment(.trailing)
            .font(.system(size: 17))
    }
}

// MARK: - Toast

/// App-wide toast queue. Inject as an `@EnvironmentObject` and call `show`.
@MainActor
final class WVToastCenter: ObservableObject {
    struct Toast: Identifiable { let id = UUID(); let message: String }
    @Published var toasts: [Toast] = []

    func show(_ message: String) {
        let toast = Toast(message: message)
        toasts.append(toast)
        Task {
            try? await Task.sleep(nanoseconds: 2_400_000_000)
            toasts.removeAll { $0.id == toast.id }
        }
    }
}

extension View {
    /// Hosts the toast stack as a top overlay. Apply once, near the app root.
    func wvToastHost(_ center: WVToastCenter) -> some View {
        overlay(alignment: .top) {
            VStack(spacing: 8) {
                ForEach(center.toasts) { toast in
                    HStack(spacing: 8) {
                        WVIcon("checkCircle", size: 16)
                        Text(toast.message).font(.system(size: 14))
                    }
                    .foregroundStyle(.white)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .background(Color(hex: "282828").opacity(0.92))
                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                    .shadow(color: .black.opacity(0.18), radius: 12, y: 8)
                    .transition(.move(edge: .top).combined(with: .opacity))
                }
            }
            .padding(.horizontal, 12)
            .padding(.top, 8)
            .animation(.spring(response: 0.32, dampingFraction: 0.8), value: center.toasts.count)
        }
    }
}
