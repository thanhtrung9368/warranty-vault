import SwiftUI

// Reusable UI primitives. Match web's button/card/input semantics but with
// iOS-native ergonomics (haptics, large tap targets, SF Symbols).

// MARK: - Buttons

public struct PrimaryButtonStyle: ButtonStyle {
    var fullWidth: Bool = true
    public init(fullWidth: Bool = true) { self.fullWidth = fullWidth }
    public func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 16, weight: .semibold))
            .foregroundStyle(WV.Tokens.primaryFg)
            .frame(maxWidth: fullWidth ? .infinity : nil, minHeight: 50)
            .padding(.horizontal, WV.Spacing.lg)
            .background(
                RoundedRectangle(cornerRadius: WV.Radius.md)
                    .fill(WV.Tokens.primary.opacity(configuration.isPressed ? 0.85 : 1.0))
            )
            .scaleEffect(configuration.isPressed ? 0.97 : 1.0)
            .animation(.spring(response: 0.25, dampingFraction: 0.8), value: configuration.isPressed)
    }
}

public struct SecondaryButtonStyle: ButtonStyle {
    var fullWidth: Bool = true
    public init(fullWidth: Bool = true) { self.fullWidth = fullWidth }
    public func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 16, weight: .medium))
            .foregroundStyle(WV.Tokens.fg)
            .frame(maxWidth: fullWidth ? .infinity : nil, minHeight: 50)
            .padding(.horizontal, WV.Spacing.lg)
            .background(
                RoundedRectangle(cornerRadius: WV.Radius.md)
                    .fill(WV.Tokens.muted.opacity(configuration.isPressed ? 0.7 : 1.0))
            )
            .scaleEffect(configuration.isPressed ? 0.97 : 1.0)
            .animation(.spring(response: 0.25, dampingFraction: 0.8), value: configuration.isPressed)
    }
}

/// Hero CTA — capsule-shaped, used in login / empty states.
public struct HeroPrimaryButtonStyle: ButtonStyle {
    var fullWidth: Bool = false
    public init(fullWidth: Bool = false) { self.fullWidth = fullWidth }
    public func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 16, weight: .semibold))
            .foregroundStyle(WV.Tokens.primaryFg)
            .frame(maxWidth: fullWidth ? .infinity : nil, minHeight: 52)
            .padding(.horizontal, WV.Spacing.xl)
            .background(
                Capsule()
                    .fill(WV.Tokens.primary.opacity(configuration.isPressed ? 0.85 : 1.0))
                    .shadow(color: WV.Tokens.primary.opacity(0.25), radius: 12, y: 6)
            )
            .scaleEffect(configuration.isPressed ? 0.97 : 1.0)
            .animation(.spring(response: 0.25, dampingFraction: 0.8), value: configuration.isPressed)
    }
}

// MARK: - Card

public struct WVCard<Content: View>: View {
    let content: Content
    var padding: CGFloat = WV.Spacing.lg
    public init(padding: CGFloat = WV.Spacing.lg, @ViewBuilder _ content: () -> Content) {
        self.padding = padding
        self.content = content()
    }
    public var body: some View {
        content
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(WV.Tokens.card)
            .clipShape(RoundedRectangle(cornerRadius: WV.Radius.lg))
            .overlay(
                RoundedRectangle(cornerRadius: WV.Radius.lg)
                    .stroke(WV.Tokens.border.opacity(0.6), lineWidth: 1)
            )
            .shadow(color: Color.black.opacity(0.05), radius: 12, y: 4)
    }
}

// MARK: - Stat Card

/// Big-number tile used on Stats / dashboard.
public struct WVStatCard: View {
    public let icon: String
    public let value: String
    public let label: String
    public let descriptor: String?
    public let tint: Color

    public init(icon: String, value: String, label: String,
                descriptor: String? = nil, tint: Color) {
        self.icon = icon
        self.value = value
        self.label = label
        self.descriptor = descriptor
        self.tint = tint
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: WV.Spacing.md) {
            HStack(alignment: .center, spacing: WV.Spacing.md) {
                ZStack {
                    Circle()
                        .fill(tint.opacity(0.16))
                    Image(systemName: icon)
                        .font(.system(size: 20, weight: .semibold))
                        .foregroundStyle(tint)
                }
                .frame(width: 48, height: 48)
                Spacer()
            }
            VStack(alignment: .leading, spacing: 4) {
                Text(value)
                    .font(.system(size: 30, weight: .bold))
                    .foregroundStyle(WV.Tokens.fg)
                    .tracking(-0.5)
                Text(label)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(WV.Tokens.fg)
                if let descriptor {
                    Text(descriptor)
                        .font(.system(size: 12))
                        .foregroundStyle(WV.Tokens.mutedFg)
                }
            }
        }
        .padding(WV.Spacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            ZStack {
                tint.opacity(0.08)
                LinearGradient(
                    colors: [tint.opacity(0.10), tint.opacity(0.02)],
                    startPoint: .topLeading, endPoint: .bottomTrailing
                )
            }
        )
        .clipShape(RoundedRectangle(cornerRadius: WV.Radius.xl))
        .overlay(
            RoundedRectangle(cornerRadius: WV.Radius.xl)
                .stroke(tint.opacity(0.18), lineWidth: 1)
        )
        .shadow(color: tint.opacity(0.10), radius: 14, y: 6)
    }
}

// MARK: - Form Field

public struct WVTextField: View {
    let title: String
    let placeholder: String
    @Binding var text: String
    var keyboardType: UIKeyboardType = .default
    var contentType: UITextContentType? = nil
    var isSecure: Bool = false
    var error: String? = nil

    public init(_ title: String,
                placeholder: String = "",
                text: Binding<String>,
                keyboardType: UIKeyboardType = .default,
                contentType: UITextContentType? = nil,
                isSecure: Bool = false,
                error: String? = nil) {
        self.title = title; self.placeholder = placeholder; self._text = text
        self.keyboardType = keyboardType; self.contentType = contentType
        self.isSecure = isSecure; self.error = error
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(WV.Tokens.fg)
            Group {
                if isSecure {
                    SecureField(placeholder, text: $text)
                } else {
                    TextField(placeholder, text: $text)
                        .keyboardType(keyboardType)
                        .textContentType(contentType)
                        .autocorrectionDisabled(keyboardType == .emailAddress)
                        .textInputAutocapitalization(keyboardType == .emailAddress ? .never : .sentences)
                }
            }
            .font(.system(size: 16))
            .padding(.horizontal, WV.Spacing.md)
            .frame(height: 46)
            .background(WV.Tokens.muted.opacity(0.4))
            .overlay(
                RoundedRectangle(cornerRadius: WV.Radius.md)
                    .stroke(error == nil ? WV.Tokens.border : WV.Tokens.destructive, lineWidth: 1)
            )
            .clipShape(RoundedRectangle(cornerRadius: WV.Radius.md))
            if let error {
                Text(error)
                    .font(.system(size: 12))
                    .foregroundStyle(WV.Tokens.destructive)
            }
        }
    }
}

// MARK: - Status pill (modern replacement for StatusBadge)

public enum WVStatusKind {
    case success, warning, danger, neutral, info, accent

    public var tint: Color {
        switch self {
        case .success: return WV.Tokens.success
        case .warning: return WV.Tokens.warning
        case .danger:  return WV.Tokens.destructive
        case .neutral: return WV.Tokens.mutedFg
        case .info:    return WV.Tokens.info
        case .accent:  return WV.Tokens.primary
        }
    }
}

public struct WVStatusPill: View {
    public let label: String
    public let kind: WVStatusKind
    public let systemImage: String?

    public init(_ label: String, kind: WVStatusKind, systemImage: String? = nil) {
        self.label = label
        self.kind = kind
        self.systemImage = systemImage
    }

    public var body: some View {
        HStack(spacing: 4) {
            if let systemImage {
                Image(systemName: systemImage)
                    .font(.system(size: 10, weight: .bold))
            }
            Text(label)
                .font(.system(size: 11, weight: .semibold))
        }
        .padding(.horizontal, 9)
        .padding(.vertical, 4)
        .foregroundStyle(kind.tint)
        .background(
            Capsule().fill(kind.tint.opacity(0.14))
        )
        .overlay(
            Capsule().stroke(kind.tint.opacity(0.22), lineWidth: 0.5)
        )
    }
}

// MARK: - Status badge (legacy — kept for backward compat)

public struct StatusBadge: View {
    public let label: String
    public let tint: Color
    public init(_ label: String, tint: Color) { self.label = label; self.tint = tint }
    public var body: some View {
        Text(label)
            .font(.system(size: 11, weight: .semibold))
            .padding(.horizontal, 9)
            .padding(.vertical, 4)
            .background(tint.opacity(0.15))
            .foregroundStyle(tint)
            .clipShape(Capsule())
    }
}

// MARK: - Empty state

public struct WVEmptyState: View {
    public let icon: String
    public let tint: Color
    public let title: String
    public let message: String
    public let ctaTitle: String?
    public let action: (() -> Void)?

    public init(icon: String,
                tint: Color = WV.Tokens.primary,
                title: String,
                message: String,
                ctaTitle: String? = nil,
                action: (() -> Void)? = nil) {
        self.icon = icon
        self.tint = tint
        self.title = title
        self.message = message
        self.ctaTitle = ctaTitle
        self.action = action
    }

    public var body: some View {
        VStack(spacing: WV.Spacing.md) {
            ZStack {
                Circle()
                    .fill(tint.opacity(0.14))
                Image(systemName: icon)
                    .font(.system(size: 40, weight: .light))
                    .foregroundStyle(tint)
            }
            .frame(width: 96, height: 96)
            .padding(.bottom, WV.Spacing.sm)
            Text(title)
                .font(.title3.weight(.semibold))
                .foregroundStyle(WV.Tokens.fg)
                .multilineTextAlignment(.center)
            Text(message)
                .font(.system(size: 14))
                .foregroundStyle(WV.Tokens.mutedFg)
                .multilineTextAlignment(.center)
                .padding(.horizontal, WV.Spacing.lg)
            if let ctaTitle, let action {
                Button(ctaTitle, action: action)
                    .buttonStyle(HeroPrimaryButtonStyle())
                    .padding(.top, WV.Spacing.sm)
            }
        }
        .padding(WV.Spacing.xl)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// MARK: - Skeleton row (shimmer)

public struct WVSkeletonRow: View {
    @State private var phase: CGFloat = -1

    public init() {}

    public var body: some View {
        HStack(alignment: .top, spacing: WV.Spacing.md) {
            RoundedRectangle(cornerRadius: WV.Radius.md)
                .fill(WV.Tokens.muted)
                .frame(width: 44, height: 44)
            VStack(alignment: .leading, spacing: 8) {
                RoundedRectangle(cornerRadius: 6)
                    .fill(WV.Tokens.muted)
                    .frame(height: 14)
                    .frame(maxWidth: .infinity)
                RoundedRectangle(cornerRadius: 6)
                    .fill(WV.Tokens.muted)
                    .frame(height: 12)
                    .frame(maxWidth: 200, alignment: .leading)
                    .frame(maxWidth: .infinity, alignment: .leading)
                RoundedRectangle(cornerRadius: 6)
                    .fill(WV.Tokens.muted)
                    .frame(height: 12)
                    .frame(maxWidth: 140, alignment: .leading)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .padding(WV.Spacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(WV.Tokens.card)
        .clipShape(RoundedRectangle(cornerRadius: WV.Radius.lg))
        .overlay(
            RoundedRectangle(cornerRadius: WV.Radius.lg)
                .stroke(WV.Tokens.border.opacity(0.6), lineWidth: 1)
        )
        .overlay(
            LinearGradient(
                colors: [
                    Color.white.opacity(0),
                    Color.white.opacity(0.35),
                    Color.white.opacity(0)
                ],
                startPoint: .leading, endPoint: .trailing
            )
            .blendMode(.plusLighter)
            .mask(RoundedRectangle(cornerRadius: WV.Radius.lg))
            .offset(x: phase * 350)
            .opacity(0.5)
        )
        .shadow(color: Color.black.opacity(0.04), radius: 8, y: 3)
        .onAppear {
            withAnimation(.linear(duration: 1.4).repeatForever(autoreverses: false)) {
                phase = 1
            }
        }
    }
}

public struct WVSkeletonList: View {
    public let count: Int
    public init(count: Int = 4) { self.count = count }
    public var body: some View {
        VStack(spacing: WV.Spacing.md) {
            ForEach(0..<count, id: \.self) { _ in
                WVSkeletonRow()
            }
        }
        .padding(WV.Spacing.lg)
    }
}

// MARK: - Form section header helper

/// Consistent semibold headline header for `Form { Section(header: ...) }` rows.
@ViewBuilder
public func sectionHeader(_ title: String) -> some View {
    Text(title)
        .font(.headline.weight(.semibold))
        .foregroundStyle(WV.Tokens.fg)
        .textCase(nil)
}

// MARK: - Page header

/// Optional friendly subtitle under a navigation title.
public struct WVPageIntro: View {
    public let title: String?
    public let subtitle: String

    public init(title: String? = nil, subtitle: String) {
        self.title = title
        self.subtitle = subtitle
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let title {
                Text(title)
                    .font(.largeTitle.bold())
                    .tracking(-0.5)
                    .foregroundStyle(WV.Tokens.fg)
            }
            Text(subtitle)
                .font(.system(size: 14))
                .foregroundStyle(WV.Tokens.mutedFg)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, WV.Spacing.lg)
        .padding(.top, WV.Spacing.xs)
        .padding(.bottom, WV.Spacing.sm)
    }
}
