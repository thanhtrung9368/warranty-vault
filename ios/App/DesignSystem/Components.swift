import SwiftUI
import WarrlyKit

// ============================================================
// Warrly iOS — shared UI components
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
        "bike": "bicycle", "box": "shippingbox", "briefcase": "briefcase.fill", "calendar": "calendar",
        "camera": "camera.fill", "car": "car.fill", "chart": "chart.bar.fill",
        "check": "checkmark", "checkCircle": "checkmark.circle.fill",
        "checklist": "checklist", "circle": "circle",
        "clock": "clock.fill", "cloud": "cloud.fill", "coffee": "cup.and.saucer.fill",
        "creditCard": "creditcard.fill", "database": "externaldrive.fill",
        "def": "shippingbox.fill", "download": "arrow.down.circle.fill", "edit": "pencil",
        "ellipse": "ellipsis", "externalLink": "arrow.up.right.square",
        "eye": "eye", "eyeSlash": "eye.slash", "film": "film.fill", "filter": "line.3.horizontal.decrease",
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
        "shoppingBag": "bag.fill", "sim": "simcard", "smartphone": "iphone", "sparkles": "sparkles",
        "stickyNote": "note.text", "store": "building.2.fill", "sun": "sun.max.fill",
        "tag": "tag.fill", "trash": "trash.fill", "trendingDown": "arrow.down.right",
        "trendingUp": "arrow.up.right", "trophy": "trophy.fill", "tv": "tv.fill",
        "unlock": "lock.open.fill", "upload": "arrow.up.circle.fill", "user": "person.fill",
        "userPlus": "person.badge.plus", "users": "person.2.fill", "wallet": "wallet.pass.fill",
        "watch": "applewatch", "wrench": "wrench.and.screwdriver.fill", "x": "xmark", "zap": "bolt.fill",
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

/// The rounded-square icon badge used at the leading edge of rows.
///
/// Always neutral: a `fill3` tile with a `label2` glyph, in both schemes. The
/// `color:` parameter is retained only so existing call sites keep compiling —
/// colour encodes state, never identity (§5.1), and a row's category is not a
/// state. The tile is 28 pt with a 20 pt glyph in a content row; the radius is
/// the one control radius (8), not a size-derived value.
struct WVLeadingIcon: View {
    let icon: String
    var color: Color = WVColor.gray
    var size: CGFloat = 28

    /// 20 pt for the standard 28 pt tile; clamped so a smaller ad-hoc tile can
    /// never render a glyph larger than itself (and a large tile never grows
    /// its glyph past 20 — the same optical size at every row height).
    private var glyphSize: CGFloat { min(20, size * 0.72) }

    var body: some View {
        RoundedRectangle(cornerRadius: WVRadius.sm, style: .continuous)
            .fill(WVColor.fill3)
            .frame(width: size, height: size)
            .overlay {
                WVIcon(icon, size: glyphSize)
                    .foregroundStyle(WVColor.label2)
            }
    }
}

// MARK: - Screen background

extension View {
    /// Fills the safe area with the grouped background. Apply on each screen's
    /// root scroll view.
    ///
    /// Also reserves the tab shell's bottom clearance (`ScreenMetrics`), so a
    /// screen cannot end flush against the floating tab bar no matter whether
    /// it remembered to add a trailing spacer. This is the one place the inset
    /// is applied: every screen already calls this modifier, and it reaches
    /// pushed screens, which a `safeAreaInset` on the `NavigationStack` does
    /// not.
    func wvScreen() -> some View {
        self
            .padding(.bottom, ScreenMetrics.tabBarContentInset)
            .background(WVColor.bg.ignoresSafeArea())
    }
}

// MARK: - Screenshot QA

/// Screenshot-QA only: start a scroll view at its **bottom** instead of its top.
///
/// The simulator can be driven headlessly (`simctl io … screenshot`) but not
/// tapped, so a screen whose interesting edge is the bottom — the tab-bar
/// clearance under a detail screen — cannot be reached by hand. Launching with
/// `WV_QA_SCROLL_BOTTOM=1` in the environment puts the scroll view at its
/// bottom for that shot. DEBUG-only, like `WV_QA_TAB` and `WV_QA_TOKEN`.
struct WVQAScrollBottom: ViewModifier {
    func body(content: Content) -> some View {
#if DEBUG
        if ProcessInfo.processInfo.environment["WV_QA_SCROLL_BOTTOM"] == "1" {
            content.defaultScrollAnchor(.bottom)
        } else {
            content
        }
#else
        content
#endif
    }
}

extension View {
    func wvQAScrollBottom() -> some View { modifier(WVQAScrollBottom()) }
}

// MARK: - Section header / footer

struct WVSectionHeader: View {
    let text: String
    init(_ text: String) { self.text = text }
    var body: some View {
        Text(text.uppercased())
            .wvFont(.footnoteEmphasis)
            .tracking(0.5)
            .foregroundStyle(WVColor.label3)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, WVSpacing.gutter)
            .padding(.top, WVSpacing.xl)
            .padding(.bottom, WVSpacing.sm)
    }
}

struct WVSectionFooter: View {
    let text: String
    init(_ text: String) { self.text = text }
    var body: some View {
        Text(text)
            .wvFont(.footnote)
            .foregroundStyle(WVColor.label3)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, WVSpacing.gutter)
            .padding(.top, WVSpacing.sm)
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
    /// The one inset for every list: `16 + 28 + 12 = 56`, so the hairline
    /// aligns to the title after the icon tile and its gap (§3). Pass `0` for
    /// a full-bleed rule; there is no second icon-independent value.
    static let rowInset: CGFloat = 56
    var inset: CGFloat = WVDivider.rowInset
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
///
/// A row is only a `Button` when it has an `action`. It used to render a
/// disabled button otherwise, which still looked tappable and did nothing — that
/// is how "Bảo mật & quyền riêng tư", "Đồng bộ iCloud", "Hướng dẫn", "Liên hệ
/// hỗ trợ" and "Đánh giá Warrly" survived as dead rows. Now a row without an
/// action renders as plain static content (no tap highlight, no button
/// accessibility trait), so a row that cannot go anywhere cannot pretend it can.
struct WVRow: View {
    var icon: String?
    var iconColor: Color = WVColor.gray
    var iconLarge: Bool = false
    var title: String
    var subtitle: String?
    /// Maximum lines the subtitle may use.
    ///
    /// One by default, so every existing row keeps its exact height. A row
    /// whose subtitle *explains an action* rather than naming a value (e.g.
    /// "what does this privacy row do?") can raise it, instead of shipping
    /// mid-sentence ellipsis. Accessibility sizes keep their existing
    /// three-line floor and show more when this is raised.
    var subtitleLineLimit: Int = 1
    var detail: String?
    var chevron: Bool = false
    var role: WVRowRole = .normal
    var action: (() -> Void)?

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    private var titleColor: Color {
        switch role {
        case .destructive: return WVColor.red
        case .tint, .centered: return WVColor.tint
        case .normal: return WVColor.label
        }
    }

    var body: some View {
        if let action {
            Button(action: action) { content }
                .buttonStyle(WVRowButtonStyle())
        } else {
            content
        }
    }

    private var content: some View {
        Group {
            if dynamicTypeSize.isAccessibilitySize && role != .centered {
                accessibleContent
            } else {
                regularContent
            }
        }
        .padding(.horizontal, WVSpacing.gutter)
        .frame(minHeight: 44)
        .padding(.vertical, WVSpacing.sm)
        .contentShape(Rectangle())
    }

    /// The default row: icon, title/subtitle, trailing detail, chevron.
    private var regularContent: some View {
        HStack(spacing: 12) {
            if role == .centered { Spacer(minLength: 0) }
            if let icon {
                WVLeadingIcon(icon: icon, color: iconColor, size: iconLarge ? 36 : 28)
            }
            VStack(alignment: .leading, spacing: 1) {
                Text(title)
                    .wvFont(.body)
                    .foregroundStyle(titleColor)
                    .lineLimit(1)
                    .fixedSize(horizontal: false, vertical: true)
                if let subtitle {
                    Text(subtitle)
                        .wvFont(.footnote)
                        .foregroundStyle(WVColor.label3)
                        .lineLimit(subtitleLineLimit)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .layoutPriority(1)
            if role != .centered { Spacer(minLength: 8) }
            if let detail {
                // A detail is usually a value, not prose (`15.900.000 ₫`,
                // `30 and 7 days`). It keeps one line and gets layout priority
                // over the title, so the title wraps instead of the number
                // splitting mid-digits.
                Text(detail)
                    .wvFont(.body)
                    .foregroundStyle(WVColor.label3)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                    .layoutPriority(2)
            }
            if chevron {
                WVIcon("arrowRight", size: 13, weight: .semibold)
                    .foregroundStyle(WVColor.label4)
            }
            if role == .centered { Spacer(minLength: 0) }
        }
    }

    /// At Accessibility sizes the trailing detail steals the width the title
    /// needs, so it moves onto its own line under the title. Same information
    /// and same order — only the axis changes.
    private var accessibleContent: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .top, spacing: 12) {
                if let icon {
                    WVLeadingIcon(icon: icon, color: iconColor, size: iconLarge ? 36 : 28)
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .wvFont(.body)
                        .foregroundStyle(titleColor)
                        .lineLimit(3)
                        .fixedSize(horizontal: false, vertical: true)
                    if let subtitle {
                        Text(subtitle)
                            .wvFont(.footnote)
                            .foregroundStyle(WVColor.label3)
                            .lineLimit(max(subtitleLineLimit, 3))
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .layoutPriority(1)
                if chevron {
                    WVIcon("arrowRight", size: 13, weight: .semibold)
                        .foregroundStyle(WVColor.label4)
                }
            }
            if let detail {
                Text(detail)
                    .wvFont(.body)
                    .foregroundStyle(WVColor.label3)
                    .lineLimit(3)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.leading, icon == nil ? 0 : (iconLarge ? 48 : 42))
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// Wrap arbitrary content so it picks up the row's tap highlight + min height.
///
/// Same rule as `WVRow`: no `action`, no button.
struct WVRowContainer<Content: View>: View {
    var action: (() -> Void)?
    @ViewBuilder var content: Content
    var body: some View {
        if let action {
            Button(action: action) { padded }
                .buttonStyle(WVRowButtonStyle())
        } else {
            padded
        }
    }

    private var padded: some View {
        content
            .padding(.horizontal, WVSpacing.gutter)
            .frame(minHeight: 44)
            .padding(.vertical, WVSpacing.sm)
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
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
    /// Overrides the regular button's 66 pt total height. Used by the login
    /// screen's 52 pt CTA; `nil` keeps every existing call site's geometry.
    ///
    /// The override is a **minimum**: the label keeps its vertical padding, so
    /// at Accessibility sizes the button grows with its 17 pt title instead of
    /// clipping it the way a fixed `height` would.
    var minHeight: CGFloat?

    /// The one shared definition of "disabled": a filled control loses its
    /// coral/red and becomes the neutral `fill3` surface with `label3` copy.
    /// SwiftUI's automatic dimming does not reach a custom `ButtonStyle`, so
    /// before this every disabled `WVButton` in the app rendered as a live one.
    @Environment(\.isEnabled) private var isEnabled

    let action: () -> Void

    init(_ title: String, icon: String? = nil, kind: WVButtonKind = .primary,
         size: WVButtonSize = .regular, fullWidth: Bool = true,
         minHeight: CGFloat? = nil,
         action: @escaping () -> Void) {
        self.title = title; self.icon = icon; self.kind = kind
        self.size = size; self.fullWidth = fullWidth; self.minHeight = minHeight
        self.action = action
    }

    private var bg: Color {
        guard isEnabled else { return kind == .ghost ? .clear : WVColor.fill3 }
        switch kind {
        case .primary: return WVColor.tint
        case .secondary, .destructiveGhost: return WVColor.fill2
        case .ghost: return .clear
        case .destructive: return WVColor.red
        }
    }
    private var fg: Color {
        guard isEnabled else { return WVColor.label3 }
        switch kind {
        case .primary, .destructive: return .white
        case .secondary, .ghost: return WVColor.tint
        case .destructiveGhost: return WVColor.red
        }
    }
    private var height: CGFloat { size == .small ? 34 : (kind == .ghost ? 44 : 50) }
    private var radius: CGFloat { size == .small ? WVRadius.sm : WVRadius.list }
    private var titleFont: WVFont { size == .small ? .subheadline : .body }

    private var label: some View {
        HStack(spacing: 6) {
            if let icon { WVIcon(icon, size: 18) }
            Text(title)
        }
        .wvFont(titleFont, weight: .semibold)
        .foregroundStyle(fg)
        .multilineTextAlignment(.center)
        .lineLimit(2)
        .frame(maxWidth: fullWidth ? .infinity : nil)
    }

    var body: some View {
        Button(action: action) {
            Group {
                if let minHeight {
                    // Padding goes inside the minimum so 52 is the floor, not
                    // the total: the label can still grow at AX sizes.
                    label
                        .padding(.vertical, WVSpacing.md)
                        .frame(minHeight: minHeight)
                } else {
                    label
                        .frame(minHeight: height)
                        .padding(.vertical, WVSpacing.sm)
                }
            }
            .padding(.horizontal, WVSpacing.gutter)
            .background(bg)
            .clipShape(RoundedRectangle(cornerRadius: radius, style: .continuous))
        }
        .buttonStyle(WVPressableStyle())
    }
}

/// Generic press-dim used by buttons (`:active { opacity: .72 }`).
///
/// `isEnabled` is read here as well: a disabled control must never answer a
/// touch with the press wash. `WVButton` resolves the disabled *colours*
/// (`fill3` + `label3`) because only it knows its kind; this style is the
/// shared floor for every other `Button` that uses it.
struct WVPressableStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .opacity(configuration.isPressed && isEnabled ? 0.72 : 1)
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

/// Status chip (`.ios-chip`). No longer a capsule: every chip is the 8 pt
/// control radius, 13 pt semibold. Status is moving to plain text in content
/// (§5.2); the filled form survives for the one warning chip and for OS-shaped
/// settings rows.
struct WVChip: View {
    let text: String
    var tone: WVChipTone = .gray
    var icon: String?

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    init(_ text: String, tone: WVChipTone = .gray, icon: String? = nil) {
        self.text = text; self.tone = tone; self.icon = icon
    }

    var body: some View {
        // The default chip is a fixed 22 pt tall. At Accessibility sizes it
        // becomes a minimum so the label can grow and wrap inside the chip
        // instead of being clipped by the height.
        chip
            .frame(minHeight: dynamicTypeSize.isAccessibilitySize ? 22 : nil)
            .frame(height: dynamicTypeSize.isAccessibilitySize ? nil : 22)
    }

    private var chip: some View {
        HStack(spacing: WVSpacing.xs) {
            if let icon { WVIcon(icon, size: 10, weight: .bold) }
            Text(text)
        }
        .wvFont(.footnoteEmphasis)
        .foregroundStyle(tone.fg)
        .lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : 1)
        .padding(.horizontal, WVSpacing.sm)
        // 3 keeps the fixed 22 pt height: the 13 pt line plus 2 × 3 pt is 22.
        // The 4 pt step would need a taller chip, which §10.1 does not ask for.
        .padding(.vertical, 3)
        .background(tone.bg)
        .clipShape(RoundedRectangle(cornerRadius: WVRadius.sm, style: .continuous))
    }
}

/// Compact inline tag (`.ios-tag`). The 8 pt control radius; 13 pt keeps it
/// above the text-size floor (only icon glyphs may go below 13).
struct WVTag: View {
    let text: String
    var brand: Bool = false
    init(_ text: String, brand: Bool = false) { self.text = text; self.brand = brand }
    var body: some View {
        Text(text)
            .wvFont(.footnoteEmphasis)
            .foregroundStyle(brand ? WVColor.brand : WVColor.label2)
            .padding(.horizontal, WVSpacing.sm)
            .padding(.vertical, 1)
            .background(brand ? WVColor.brandSoft : WVColor.fill3)
            .clipShape(RoundedRectangle(cornerRadius: WVRadius.sm, style: .continuous))
    }
}

// MARK: - Warranty pill

/// The trailing deadline value of a row (§6 of the visual direction).
///
/// Despite the name it is no longer a pill: there is no fill, no capsule and no
/// leading dot. It is one line of `rowValue` text (17 pt medium), coloured only
/// when the date is the thing to act on.
///
/// The state thresholds still live in the Kit (`WarrantyPillCopy.status`) and
/// are unit-tested; the *wording* no longer uses that type's abbreviation
/// strings ("Còn ~11th", "2 năm"). The grammar is §6's:
///
/// * more than 90 days → the absolute date in `label3` (when `endDate` is
///   known), so the row answers "when exactly?" instead of counting months;
/// * 31…90 days → `còn N ngày` in amber;
/// * 0…30 days → `còn N ngày` (today: `hết hạn hôm nay`) in red;
/// * past → `đã hết hạn` in `label3` — no alarm about something already gone;
/// * no date → `chưa ghi hạn` in `label4`.
struct WarrantyPill: View {
    let daysLeft: Int?
    /// Absolute end date, printed once the deadline is more than 90 days away.
    /// Optional so every existing `WarrantyPill(daysLeft:)` call site still
    /// compiles; without it the view falls back to a precise day count.
    var endDate: Date?

    init(daysLeft: Int?, endDate: Date? = nil) {
        self.daysLeft = daysLeft
        self.endDate = endDate
    }

    private var color: Color {
        // `nil` is "no date", not "expired". Everything else goes through the
        // Kit's threshold rule so the view can never drift from the tested one;
        // only the *drawing* changes (§5.2: green is for a verdict, not a date).
        guard let days = daysLeft else { return WVColor.label4 }
        switch WarrantyPillCopy.status(daysLeft: days) {
        case .safe:    return WVColor.label3
        case .warn:    return WVColor.orange
        case .danger:  return WVColor.red
        case .expired: return WVColor.label3
        }
    }

    private var label: String {
        guard let days = daysLeft else { return L.t("Chưa ghi hạn") }
        switch WarrantyPillCopy.status(daysLeft: days) {
        case .expired:
            return L.t("Đã hết hạn")
        case .danger:
            return days == 0 ? L.t("Hết hạn hôm nay") : L.p("còn %d ngày", days)
        case .warn:
            return L.p("còn %d ngày", days)
        case .safe:
            // > 90 days: the absolute date is the actionable fact. Without one
            // (an old call site), a precise day count beats the old month/year
            // abbreviation and still fits on one line.
            if let endDate { return WVFormat.date(endDate) }
            return L.p("còn %d ngày", days)
        }
    }

    var body: some View {
        Text(label)
            .wvFont(.body, weight: .medium)
            .foregroundStyle(color)
            .lineLimit(1)
            .minimumScaleFactor(0.8)
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
                        .wvFont(.footnote, weight: active ? .semibold : .medium)
                        .foregroundStyle(WVColor.label)
                        .lineLimit(2)
                        .multilineTextAlignment(.center)
                        .padding(.vertical, WVSpacing.xs)
                        .frame(maxWidth: .infinity)
                        .frame(minHeight: 28)
                        .background {
                            if active {
                                RoundedRectangle(cornerRadius: WVRadius.sm, style: .continuous)
                                    .fill(WVColor.bg2)
                                    .shadow(color: .black.opacity(0.08), radius: 3, y: 2)
                            }
                        }
                }
                .buttonStyle(.plain)
            }
        }
        // 2 pt is the documented segmented inset (§8.2/§8.5), not a layout step.
        .padding(2)
        .background(WVColor.fill3)
        .clipShape(RoundedRectangle(cornerRadius: WVRadius.sm, style: .continuous))
    }
}

// MARK: - Empty state

struct WVEmpty<Action: View>: View {
    var icon: String = "package"
    var title: String
    var description: String?
    @ViewBuilder var action: Action

    var body: some View {
        VStack(spacing: WVSpacing.md) {
            Circle()
                .fill(WVColor.fill3)
                .frame(width: 80, height: 80)
                .overlay(WVIcon(icon, size: 40, weight: .regular).foregroundStyle(WVColor.label3))
            Text(title)
                .wvFont(.title3Emphasis)
                .foregroundStyle(WVColor.label)
            if let description {
                Text(description)
                    .wvFont(.footnote)
                    .foregroundStyle(WVColor.label3)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: 280)
            }
            action.padding(.top, WVSpacing.xs)
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, WVSpacing.gutter)
        .padding(.vertical, WVSpacing.xxl)
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
            VStack(alignment: .leading, spacing: WVSpacing.md) {
                if let title {
                    Text(title.uppercased())
                        .wvFont(.footnoteEmphasis)
                        .foregroundStyle(WVColor.label3)
                }
                content
            }
        }
    }
}

// MARK: - Inline notices

/// Semantics of an inline notice. `warning` is the "this is not a failure, but
/// you need to know" tone the app already used ad hoc for incomplete stats and
/// for an open warranty claim — it is deliberately orange, not red.
enum WVNoticeTone {
    case warning
    case info
    case error

    var color: Color {
        switch self {
        case .warning: return WVColor.orange
        case .info:    return WVColor.blue
        case .error:   return WVColor.red
        }
    }

    var icon: String {
        switch self {
        case .warning: return "alert"
        case .info:    return "info"
        case .error:   return "alert"
        }
    }
}

/// Inline notice. This is the shared form of the pattern already used by
/// `StatsView` (partial stats) and `ClaimFormView` (an open claim): a tinted
/// rounded block with one semantic icon, an optional bold title and one or more
/// body sentences. Everything stays in the normal foreground so the row reads as
/// information, not as an error dialog.
///
/// A notice is a row-card, not a screen-level card: 12 pt (`WVRadius.list`),
/// not 16 (§4).
struct WVNotice: View {
    var tone: WVNoticeTone = .warning
    var title: String?
    var messages: [String]

    init(tone: WVNoticeTone = .warning, title: String? = nil, message: String) {
        self.tone = tone
        self.title = title
        self.messages = [message]
    }

    init(tone: WVNoticeTone = .warning, title: String? = nil, messages: [String]) {
        self.tone = tone
        self.title = title
        self.messages = messages
    }

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            WVIcon(tone.icon, size: 14)
                .foregroundStyle(tone.color)
                .padding(.top, 2)
            VStack(alignment: .leading, spacing: 4) {
                if let title, !title.isEmpty {
                    Text(title)
                        .wvFont(.footnoteEmphasis)
                        .foregroundStyle(WVColor.label)
                }
                ForEach(Array(messages.enumerated()), id: \.offset) { _, message in
                    Text(message)
                        .wvFont(.footnote)
                        .foregroundStyle(WVColor.label2)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(WVSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(tone.color.opacity(0.12))
        .clipShape(RoundedRectangle(cornerRadius: WVRadius.list, style: .continuous))
        .accessibilityElement(children: .combine)
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
                        .wvFont(.caption2Emphasis)
                        .lineLimit(2)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .foregroundStyle(brand ? Color.white.opacity(0.85) : WVColor.label3)
                Text(value)
                    .wvFont(.statValue)
                    .foregroundStyle(brand ? Color.white : WVColor.label)
                    .lineLimit(1)
                    .minimumScaleFactor(0.5)
                if let sub {
                    Text(sub)
                        .wvFont(.caption)
                        .foregroundStyle(brand ? Color.white.opacity(0.85) : WVColor.label3)
                        .lineLimit(2)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .frame(maxWidth: .infinity, minHeight: 92, alignment: .topLeading)
            .padding(WVSpacing.gutter)
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
                .wvFont(.caption2Emphasis)
                .foregroundStyle(WVColor.label3)
            Text(value)
                .wvFont(.title2Emphasis)
                .foregroundStyle(WVColor.label)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
            if let sub {
                Text(sub).wvFont(.caption).foregroundStyle(WVColor.label3)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(WVSpacing.gutter)
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
                        .wvFont(.title3, weight: .bold)
                        .foregroundStyle(.white)
                        .lineLimit(1)
                        .minimumScaleFactor(0.5)
                )
            VStack(alignment: .leading, spacing: 1) {
                Text(subtitle).wvFont(.footnote).foregroundStyle(WVColor.label3)
                Text(name).wvFont(.title3, weight: .bold).foregroundStyle(WVColor.label)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, WVSpacing.titleGutter)
        .padding(.top, WVSpacing.sm)
        .padding(.bottom, WVSpacing.gutter)
    }
}

/// Section heading with an optional trailing action (`.dash-section-head`).
///
/// The dashboard's content heading — sentence case, 20 pt semibold — is not the
/// OS-shaped `WVSectionHeader` (13 pt uppercase, used by Cài đặt/Hồ sơ/Thêm).
/// The two must not be swapped: §8.3's "WVSectionHeader at 20 semibold" refers
/// to this component.
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
                .wvFont(.title3Emphasis)
                .foregroundStyle(WVColor.label)
            Spacer(minLength: 12)
            if let actionLabel, let action {
                Button(actionLabel, action: action)
                    .wvFont(.subheadline)
                    .foregroundStyle(WVColor.tint)
            }
        }
        .padding(.horizontal, WVSpacing.gutter)
        .padding(.top, WVSpacing.xl)
        .padding(.bottom, WVSpacing.sm)
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

/// Numeric money input that renders grouped digits while editing.
///
/// `groupingSeparator` follows the currency: `.` for VND (`25.000.000`) and `,`
/// for a foreign amount (`1,299`). Both are display-only — the binding remains
/// a plain `Int`.
struct WVMoneyField: View {
    @Binding var value: Int?
    var placeholder: String = "0 ₫"
    var groupingSeparator: String = "."

    private var text: Binding<String> {
        Binding(
            get: {
                guard let v = value else { return "" }
                return Self.formatted(v, separator: groupingSeparator)
            },
            set: { raw in
                let digits = raw.filter(\.isNumber)
                value = digits.isEmpty ? nil : Int(digits)
            }
        )
    }

    private static func formatted(_ value: Int, separator: String) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = true
        formatter.groupingSeparator = separator
        formatter.locale = Locale(identifier: "en_US_POSIX")
        return formatter.string(from: NSNumber(value: value)) ?? "\(value)"
    }

    var body: some View {
        TextField(placeholder, text: text)
            .keyboardType(.numberPad)
            .multilineTextAlignment(.trailing)
            .wvFont(.body)
    }
}

// MARK: - Brand mark

/// The Warrly mark — "W in the tag" — drawn from the same 32-unit geometry the
/// web (`website/src/lib/brand.ts`) and the app icon (`Tools/appicon.py`) use.
///
/// A vector view, not `icon-1024.png` scaled down: that PNG carries its own
/// cream app-icon ground and rounded tile, which would read as a pasted-on icon
/// rather than a mark floating on the screen.
///
/// The W is a real knockout (`destinationOut`), not a stroke painted in `bg`,
/// so whatever surface sits behind the mark shows through the letter. The plate
/// takes `WVColor.brand`.
///
/// Both drawn cuts are encoded exactly as the web encodes them (full at 24 pt
/// and above, small below). They are separate drawings, not one scaled into the
/// other — at small sizes the three teeth and the thin W turn to mush.
struct WarrlyMark: View {
    /// Width of the mark's ink box. The height follows the cut's aspect ratio.
    var width: CGFloat = 64

    var body: some View {
        let cut = WarrlyMarkCut.forWidth(width)
        let scale = width / cut.ink.width
        ZStack {
            cut.platePath(scale: scale)
                .fill(WVColor.brand)
            cut.letterPath(scale: scale)
                .stroke(style: StrokeStyle(
                    lineWidth: cut.letterWidth * scale,
                    lineCap: .round,
                    lineJoin: .round
                ))
                .foregroundStyle(.black)
                .blendMode(.destinationOut)
        }
        .compositingGroup()
        .frame(width: width, height: cut.ink.height * scale)
        .accessibilityHidden(true)
    }
}

/// The two drawn cuts of the mark. Coordinates are the web's 32-unit grid.
private enum WarrlyMarkCut {
    case full
    case small

    /// The same threshold the web uses: `>= 24` is the full cut.
    static func forWidth(_ width: CGFloat) -> WarrlyMarkCut {
        width >= 24 ? .full : .small
    }

    var letterWidth: CGFloat {
        switch self {
        case .full: return 2.8
        case .small: return 3.4
        }
    }

    /// The visible silhouette in grid units — what the view scales and centres.
    var ink: CGRect {
        switch self {
        case .full: return CGRect(x: 5, y: 7, width: 22, height: 18.4)
        case .small: return CGRect(x: 4.6, y: 6.4, width: 22.8, height: 19.2)
        }
    }

    /// The tag plate, one filled path. Top corners only; the bottom is torn.
    var plate: Path {
        var path = Path()
        switch self {
        case .full:
            // Plate x=5…27, y=7…25.4; 1.6 top corners; three 2.4-deep teeth.
            path.move(to: CGPoint(x: 6.6, y: 7))
            path.addLine(to: CGPoint(x: 25.4, y: 7))
            path.addCurve(to: CGPoint(x: 27, y: 8.6),
                          control1: CGPoint(x: 26.284, y: 7),
                          control2: CGPoint(x: 27, y: 7.716))
            path.addLine(to: CGPoint(x: 27, y: 25.4))
            path.addLine(to: CGPoint(x: 23.33, y: 23))
            path.addLine(to: CGPoint(x: 19.67, y: 25.4))
            path.addLine(to: CGPoint(x: 16, y: 23))
            path.addLine(to: CGPoint(x: 12.33, y: 25.4))
            path.addLine(to: CGPoint(x: 8.67, y: 23))
            path.addLine(to: CGPoint(x: 5, y: 25.4))
            path.addLine(to: CGPoint(x: 5, y: 8.6))
            path.addCurve(to: CGPoint(x: 6.6, y: 7),
                          control1: CGPoint(x: 5, y: 7.716),
                          control2: CGPoint(x: 5.716, y: 7))
        case .small:
            // Plate 22.8×19.2, two wide teeth, 1.4 top corners, heavier W.
            path.move(to: CGPoint(x: 6, y: 6.4))
            path.addLine(to: CGPoint(x: 26, y: 6.4))
            path.addCurve(to: CGPoint(x: 27.4, y: 7.8),
                          control1: CGPoint(x: 26.773, y: 6.4),
                          control2: CGPoint(x: 27.4, y: 7.027))
            path.addLine(to: CGPoint(x: 27.4, y: 25.6))
            path.addLine(to: CGPoint(x: 21.7, y: 22.6))
            path.addLine(to: CGPoint(x: 16, y: 25.6))
            path.addLine(to: CGPoint(x: 10.3, y: 22.6))
            path.addLine(to: CGPoint(x: 4.6, y: 25.6))
            path.addLine(to: CGPoint(x: 4.6, y: 7.8))
            path.addCurve(to: CGPoint(x: 6, y: 6.4),
                          control1: CGPoint(x: 4.6, y: 7.027),
                          control2: CGPoint(x: 5.227, y: 6.4))
        }
        path.closeSubpath()
        return path
    }

    /// The stroked W, cut out of the plate by the caller.
    var letter: Path {
        var path = Path()
        switch self {
        case .full:
            path.move(to: CGPoint(x: 10.6, y: 11.4))
            path.addLine(to: CGPoint(x: 13.3, y: 18.8))
            path.addLine(to: CGPoint(x: 16, y: 13.4))
            path.addLine(to: CGPoint(x: 18.7, y: 18.8))
            path.addLine(to: CGPoint(x: 21.4, y: 11.4))
        case .small:
            path.move(to: CGPoint(x: 10, y: 11))
            path.addLine(to: CGPoint(x: 13.2, y: 19))
            path.addLine(to: CGPoint(x: 16, y: 12.6))
            path.addLine(to: CGPoint(x: 18.8, y: 19))
            path.addLine(to: CGPoint(x: 22, y: 11))
        }
        return path
    }

    /// Map the grid onto a view whose ink box is `scale`-times larger.
    private func scaled(_ path: Path, scale: CGFloat) -> Path {
        let transform = CGAffineTransform(scaleX: scale, y: scale)
            .concatenating(CGAffineTransform(
                translationX: -ink.minX * scale,
                y: -ink.minY * scale
            ))
        return path.applying(transform)
    }

    func platePath(scale: CGFloat) -> Path { scaled(plate, scale: scale) }

    func letterPath(scale: CGFloat) -> Path { scaled(letter, scale: scale) }
}

// MARK: - Password field

/// A secure text field with a reveal toggle **inside** the field's trailing
/// edge — showing the password belongs to this field, not to a second action on
/// the form.
///
/// Toggling swaps `SecureField` for `TextField`, which re-creates the view. The
/// typed value persists in the caller's binding, and focus is put back on the
/// next run-loop so the user can keep typing without tapping the field again.
/// Hidden is the default on every appearance and whenever the app leaves the
/// foreground: a password must not stay readable after backgrounding.
struct WVPasswordField: View {
    let placeholder: String
    @Binding var text: String
    var textContentType: UITextContentType? = .password
    var keyboardType: UIKeyboardType = .default
    var alignment: TextAlignment = .leading
    var submitLabel: SubmitLabel = .return
    /// Forms that chain the keyboard (Return in the email field focuses this
    /// one) pass their own boolean focus binding. `nil` keeps the field's
    /// private state, which is what the settings sheets use.
    var focus: FocusState<Bool>.Binding? = nil
    var onSubmit: (() -> Void)? = nil

    @State private var isRevealed = false
    @State private var shouldRestoreFocus = false
    @FocusState private var isFocused: Bool
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        HStack(spacing: 8) {
            field

            Button {
                shouldRestoreFocus = focused
                isRevealed.toggle()
            } label: {
                WVIcon(isRevealed ? "eyeSlash" : "eye", size: 18, weight: .regular)
                    .foregroundStyle(WVColor.label3)
                    .frame(width: 44, height: 44)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(isRevealed ? L.t("Ẩn mật khẩu") : L.t("Hiện mật khẩu"))
        }
        .onAppear { isRevealed = false }
        .onChange(of: isRevealed) { _, _ in
            guard shouldRestoreFocus else { return }
            shouldRestoreFocus = false
            // The revealed field is a new view; put the caret back on the next
            // run-loop, whichever binding owns focus.
            DispatchQueue.main.async {
                if let focus { focus.wrappedValue = true } else { isFocused = true }
            }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase != .active { isRevealed = false }
        }
    }

    private var focused: Bool {
        if let focus { return focus.wrappedValue }
        return isFocused
    }

    /// Both fields share one binding and one focus state, so the reveal swap
    /// cannot lose the typed text and the caret can be put back.
    @ViewBuilder
    private var field: some View {
        Group {
            if isRevealed {
                TextField(placeholder, text: $text)
            } else {
                SecureField(placeholder, text: $text)
            }
        }
        .keyboardType(keyboardType)
        .textContentType(textContentType)
        .autocorrectionDisabled()
        .textInputAutocapitalization(.never)
        .multilineTextAlignment(alignment)
        .wvFont(.body)
        .focused(focus ?? $isFocused)
        .submitLabel(submitLabel)
        .onSubmit { onSubmit?() }
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
                        Text(toast.message).wvFont(.subheadline)
                    }
                    .foregroundStyle(.white)
                    .padding(.horizontal, WVSpacing.gutter)
                    .padding(.vertical, WVSpacing.md)
                    .background(Color(hex: "282828").opacity(0.92))
                    .clipShape(RoundedRectangle(cornerRadius: WVRadius.card, style: .continuous))
                    .shadow(color: .black.opacity(0.18), radius: 12, y: 8)
                    .transition(.move(edge: .top).combined(with: .opacity))
                }
            }
            .padding(.horizontal, WVSpacing.md)
            .padding(.top, WVSpacing.sm)
            .animation(.spring(response: 0.32, dampingFraction: 0.8), value: center.toasts.count)
        }
    }
}
