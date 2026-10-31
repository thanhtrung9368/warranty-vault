import SwiftUI
import WarrlyKit

// ============================================================
// LoginView — Direction 1, "Tờ giấy" (The Ledger).
//
// A page of the app, not a poster: flat `bg`, the mark at 28 pt centred on its
// own line, one 34 pt left-aligned title at the 16 pt gutter, labels above the
// fields, one coral 52 pt action, and the register link next to it — no
// gradient, no hero, no card around the fields. Started from
// docs/handoff/WARRLY-login-redesign.md §6 with three research-driven changes
// (centred pictogram, footer under the CTA, a title that does not repeat the
// button label).
// ============================================================

struct LoginView: View {
    @EnvironmentObject var auth: AuthStore

    /// Two booleans rather than one enum: `AuthTextField` and
    /// `WVPasswordField` each take a `FocusState<Bool>.Binding`, which is the
    /// chip that lets Return on the email field move the caret to the password.
    @FocusState private var emailFocused: Bool
    @FocusState private var passwordFocused: Bool

    /// The last account that signed in on this device, read once at init.
    /// Never the password — see `RememberedEmail`.
    @State private var email = RememberedEmail.load()
    @State private var password = ""
    @State private var isSubmitting = false
    @State private var topError: String?
    @State private var fieldErrors: [String: [String]] = [:]
    @State private var showForgot = false
    @State private var showRegister = false

    var body: some View {
        NavigationStack {
            GeometryReader { proxy in
                ScrollView {
                    VStack(alignment: .leading, spacing: 0) {
                        WarrlyMark(width: 28)
                            .frame(maxWidth: .infinity, alignment: .center)
                            .padding(.top, WVSpacing.xxl)

                        Spacer().frame(height: WVSpacing.xxl)

                        Text(L.t("Đăng nhập Warrly"))
                            .wvFont(.display)
                            .tracking(-0.4)
                            .foregroundStyle(WVColor.label)
                            .multilineTextAlignment(.leading)
                            .frame(maxWidth: .infinity, alignment: .leading)

                        Spacer().frame(height: WVSpacing.xl)

                        AuthTextField(
                            label: "Email",
                            placeholder: "you@example.com",
                            text: $email,
                            keyboardType: .emailAddress,
                            contentType: .username,
                            isSecure: false,
                            presentation: .page,
                            submitLabel: .next,
                            focus: $emailFocused,
                            onSubmit: { passwordFocused = true },
                            error: fieldErrors["email"]?.first
                        )

                        Spacer().frame(height: WVSpacing.md)

                        AuthTextField(
                            label: L.t("Mật khẩu"),
                            placeholder: "•••••",
                            text: $password,
                            keyboardType: .default,
                            contentType: .password,
                            isSecure: true,
                            presentation: .page,
                            submitLabel: .go,
                            focus: $passwordFocused,
                            onSubmit: {
                                guard canSubmit else { return }
                                Task { await submit() }
                            },
                            error: fieldErrors["password"]?.first,
                            labelAccessory: AnyView(forgotButton)
                        )

                        if let topError {
                            HStack(spacing: 6) {
                                WVIcon("alert", size: 13)
                                Text(topError)
                                    .wvFont(.footnote)
                            }
                            .foregroundStyle(WVColor.red)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.top, WVSpacing.sm)
                        }

                        Spacer().frame(height: topError == nil ? WVSpacing.xl : WVSpacing.sm)

                        WVButton(
                            isSubmitting ? L.t("Đang đăng nhập…") : L.t("Đăng nhập"),
                            kind: .primary,
                            minHeight: 52
                        ) {
                            Task { await submit() }
                        }
                        .disabled(isSubmitting || !canSubmit)

                        // Directly under the action, the way every sample app
                        // with a register link places it. Pinning it to the
                        // bottom edge put a 327 pt void between the two things
                        // a person actually uses.
                        Spacer().frame(height: WVSpacing.xl)

                        footer

                        Spacer(minLength: 0)
                    }
                    .padding(.horizontal, WVSpacing.gutter)
                    .frame(maxWidth: 480, alignment: .leading)
                    .frame(minHeight: proxy.size.height, alignment: .top)
                    .frame(maxWidth: .infinity)
                }
                .scrollDismissesKeyboard(.interactively)
            }
            .background(WVColor.bg.ignoresSafeArea())
            .navigationBarHidden(true)
        }
        .sheet(isPresented: $showForgot) {
            ForgotPasswordView(client: auth.client)
        }
        .sheet(isPresented: $showRegister) {
            RegisterView()
                .environmentObject(auth)
        }
    }

    // MARK: - Inline actions

    /// `Quên mật khẩu?` sits on the password label's line, where the problem
    /// is — not below the CTA where it competed with the action.
    private var forgotButton: some View {
        Button {
            showForgot = true
        } label: {
            Text(L.t("Quên mật khẩu?"))
                .wvFont(.footnote, weight: .medium)
                .foregroundStyle(WVColor.label2)
        }
        .buttonStyle(.plain)
    }

    /// Sits directly under the primary action, 24 pt below it. The link is
    /// `label` semibold, not coral: coral stays the action's alone.
    private var footer: some View {
        Button {
            showRegister = true
        } label: {
            (
                Text(L.t("Chưa có tài khoản? "))
                    .foregroundColor(WVColor.label3)
                + Text(L.t("Tạo tài khoản"))
                    .foregroundColor(WVColor.label)
                    .fontWeight(.semibold)
            )
            .wvFont(.subheadline)
            .multilineTextAlignment(.leading)
        }
        .buttonStyle(.plain)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: - Logic

    private var canSubmit: Bool { !email.isEmpty && !password.isEmpty }

    private func submit() async {
        topError = nil; fieldErrors = [:]
        isSubmitting = true
        defer { isSubmitting = false }
        do {
            try await auth.login(email: email, password: password)
        } catch let err as APIError {
            topError = err.localizedDescription
            fieldErrors = err.fieldErrors
        } catch {
            topError = error.localizedDescription
        }
    }
}

// MARK: - Shared auth text field

/// Which surface an auth field sits on.
enum AuthFieldPresentation {
    /// Inside a `WVGroup`: the group already supplies the white surface, so
    /// only the label and a 44 pt row are drawn (Đăng ký, Quên mật khẩu).
    case grouped
    /// On the page: a 52 pt `bg2` box at the screen gutter (the login page).
    case page
}

/// Text/secure field with its label **above** the field and an inline error
/// label underneath.
///
/// The 100 pt label column is gone. It was a read-only Settings row applied to
/// an input: at AX3 it wrapped "Email" into "Ema / il" and "Password" into
/// "Pas / swo / rd" while the right-aligned value overlapped it. A label above
/// a left-aligned value is the layout that survives Dynamic Type — and it is
/// why the register sheet is fixed by the same component.
struct AuthTextField: View {
    let label: String
    let placeholder: String
    @Binding var text: String
    var keyboardType: UIKeyboardType = .default
    var contentType: UITextContentType? = nil
    var isSecure: Bool = false
    var presentation: AuthFieldPresentation = .grouped
    var submitLabel: SubmitLabel = .return
    var focus: FocusState<Bool>.Binding? = nil
    var onSubmit: (() -> Void)? = nil
    var error: String?
    /// Trailing content on the label line (the login page's
    /// `Quên mật khẩu?`). `AnyView` keeps the shared component from growing a
    /// second generic parameter for a two-call-site feature.
    var labelAccessory: AnyView? = nil

    @FocusState private var internalFocus: Bool

    private var isPage: Bool { presentation == .page }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            labelRow
                .padding(.horizontal, isPage ? 0 : WVSpacing.gutter)
                .padding(.bottom, WVSpacing.sm)

            fieldBody
                .padding(.vertical, isPage ? WVSpacing.xs : 0)
                .frame(minHeight: isPage ? 52 : 44, alignment: .leading)
                .background(isPage ? WVColor.bg2 : Color.clear)
                .clipShape(RoundedRectangle(cornerRadius: WVRadius.list, style: .continuous))

            if let error {
                Text(error)
                    .wvFont(.footnote)
                    .foregroundStyle(WVColor.red)
                    .padding(.top, WVSpacing.xs)
                    .padding(.horizontal, isPage ? 0 : WVSpacing.gutter)
            }
        }
    }

    /// Label left, accessory right. `ViewThatFits` falls back to a vertical
    /// stack instead of clipping when the two no longer share a line at large
    /// Dynamic Type sizes; the fixed-size candidates make that measurement
    /// meaningful, since a flexible `HStack` would always claim it fits and then
    /// wrap mid-word.
    private var labelRow: some View {
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .firstTextBaseline, spacing: WVSpacing.sm) {
                labelText
                    .fixedSize(horizontal: true, vertical: false)
                Spacer(minLength: WVSpacing.sm)
                if let labelAccessory {
                    labelAccessory
                        .fixedSize(horizontal: true, vertical: false)
                }
            }
            VStack(alignment: .leading, spacing: WVSpacing.xs) {
                labelText
                if let labelAccessory { labelAccessory }
            }
        }
    }

    private var labelText: some View {
        Text(label)
            .wvFont(.footnote)
            .foregroundStyle(WVColor.label3)
    }

    @ViewBuilder
    private var fieldBody: some View {
        if isSecure {
            WVPasswordField(
                placeholder: placeholder,
                text: $text,
                textContentType: contentType,
                keyboardType: keyboardType,
                submitLabel: submitLabel,
                focus: focus,
                onSubmit: onSubmit
            )
            .foregroundStyle(WVColor.label)
            .padding(.leading, WVSpacing.gutter)
            // Page: the 44 pt eye button ends flush with the field's trailing
            // edge, which puts the glyph where the mockup draws it. Grouped:
            // the row keeps the group's 16 pt inset on both sides.
            .padding(.trailing, isPage ? 0 : WVSpacing.gutter)
        } else {
            TextField(placeholder, text: $text)
                .keyboardType(keyboardType)
                .textContentType(contentType)
                .submitLabel(submitLabel)
                .focused(focus ?? $internalFocus)
                .onSubmit { onSubmit?() }
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
                .wvFont(.body)
                .foregroundStyle(WVColor.label)
                .multilineTextAlignment(.leading)
                .padding(.horizontal, WVSpacing.gutter)
        }
    }
}
