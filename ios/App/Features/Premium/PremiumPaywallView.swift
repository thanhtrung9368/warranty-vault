import StoreKit
import SwiftUI
import WarrlyKit

/// Warrly Premium paywall. Presented from Settings; it is also the screen an
/// App Review reviewer will see when checking the subscription, so it must
/// state price, renewal, trial, restore and the two legal links without
/// requiring another tap.
struct PremiumPaywallView: View {
    @EnvironmentObject private var premium: PremiumStore
    @Environment(\.dismiss) private var dismiss

    @State private var selectedID = PremiumProductID.yearly

    private var selectedProduct: Product? {
        premium.products.first(where: { $0.id == selectedID })
            ?? premium.products.first
    }

    /// The free trial the SELECTED plan is really offering to THIS account, or
    /// `nil` when there is none.
    ///
    /// `isEligibleForIntroOffer` is a per-subscriber entitlement, not a property
    /// of the product definition: the same two SKUs show a trial CTA to a new
    /// subscriber and a plain "Subscribe" to someone who already used the trial
    /// on another plan. Reading it from the selected product — together with the
    /// offer's actual period — also keeps the two plans from borrowing each
    /// other's trial copy.
    @State private var trialOffer: TrialOffer?

    private struct TrialOffer {
        let period: Product.SubscriptionPeriod
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: WVSpacing.lg) {
                    header

                    if premium.isPremium {
                        activeCard
                    } else {
                        benefits
                        productPicker
                        purchaseButton
                        restoreButton
                        legal
                    }
                }
                .padding(.horizontal, WVSpacing.gutter)
                .padding(.vertical, WVSpacing.lg)
            }
            .background(WVColor.bg.ignoresSafeArea())
            .navigationTitle(L.t("Warrly Premium"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button(L.t("Đóng")) { dismiss() }
                        .foregroundStyle(WVColor.tint)
                }
            }
            .task {
                await premium.loadProducts()
                // Resolve the trial before the slower entitlement round-trip:
                // the CTA must not sit on "Subscribe" for an eligible account
                // while the backend is being asked who the user is.
                await refreshTrialOffer()
                await premium.syncEntitlement()
            }
            .onChange(of: selectedID) { _, _ in
                Task { await refreshTrialOffer() }
            }
            .alert(L.t("Warrly Premium"), isPresented: Binding(
                get: { premium.errorMessage != nil },
                set: { if !$0 { premium.errorMessage = nil } }
            )) {
                Button("OK", role: .cancel) { premium.errorMessage = nil }
            } message: {
                Text(premium.errorMessage ?? "")
            }
        }
    }

    // MARK: - Header

    private var header: some View {
        VStack(alignment: .leading, spacing: WVSpacing.sm) {
            WVLeadingIcon(icon: "sparkles", color: WVColor.orange, tinted: true)
                .scaleEffect(1.3)
                .padding(.bottom, WVSpacing.xs)
            Text(L.t("Warrly Premium"))
                .font(.system(size: 30, weight: .bold))
                .foregroundStyle(WVColor.label)
            Text(L.t("Bỏ quảng cáo và mở rộng giới hạn — một lần nâng cấp cho cả tài khoản."))
                .font(.system(size: 15))
                .foregroundStyle(WVColor.label2)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    // MARK: - Active state

    private var activeCard: some View {
        VStack(alignment: .leading, spacing: WVSpacing.md) {
            HStack(spacing: WVSpacing.sm) {
                WVIcon("check", size: 16, weight: .semibold)
                    .foregroundStyle(WVColor.green)
                Text(L.t("Premium đang hoạt động"))
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(WVColor.label)
            }
            Text(L.t("Bạn không còn thấy quảng cáo và đang dùng giới hạn cao hơn."))
                .font(.system(size: 14))
                .foregroundStyle(WVColor.label2)
            if let url = premium.manageSubscriptionURL {
                Link(destination: url) {
                    Text(L.t("Quản lý đăng ký trong App Store"))
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(WVColor.tint)
                }
            }
        }
        .padding(WVSpacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(WVColor.bg2)
        .clipShape(RoundedRectangle(cornerRadius: WVRadius.card, style: .continuous))
    }

    // MARK: - Benefits

    private var benefits: some View {
        VStack(alignment: .leading, spacing: WVSpacing.sm) {
            benefit(L.t("Không còn quảng cáo"))
            benefit(L.t("Tới 200 thiết bị đang theo dõi"))
            benefit(L.t("500 gói đăng ký và 1.000 mục wishlist"))
            benefit(L.t("Áp dụng trên mọi thiết bị đăng nhập cùng tài khoản"))
        }
        .padding(WVSpacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(WVColor.bg2)
        .clipShape(RoundedRectangle(cornerRadius: WVRadius.card, style: .continuous))
    }

    private func benefit(_ text: String) -> some View {
        HStack(alignment: .top, spacing: WVSpacing.sm) {
            WVIcon("check", size: 13, weight: .semibold)
                .foregroundStyle(WVColor.green)
                .padding(.top, 2)
            Text(text)
                .font(.system(size: 15))
                .foregroundStyle(WVColor.label)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    // MARK: - Products

    @ViewBuilder
    private var productPicker: some View {
        if premium.isLoadingProducts && premium.products.isEmpty {
            HStack(spacing: WVSpacing.sm) {
                ProgressView()
                Text(L.t("Đang tải gói…"))
                    .font(.system(size: 15))
                    .foregroundStyle(WVColor.label2)
            }
            .frame(maxWidth: .infinity, minHeight: 92)
        } else if premium.products.isEmpty {
            VStack(alignment: .leading, spacing: WVSpacing.sm) {
                Text(L.t("Chưa tải được gói Premium."))
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(WVColor.label)
                Text(L.t("Kiểm tra kết nối mạng rồi thử lại. Nếu vẫn lỗi, gói có thể chưa sẵn sàng trong App Store."))
                    .font(.system(size: 13))
                    .foregroundStyle(WVColor.label3)
                    .fixedSize(horizontal: false, vertical: true)
                WVButton(L.t("Thử lại"), kind: .secondary) {
                    Task {
                        await premium.loadProducts()
                        await refreshTrialOffer()
                    }
                }
            }
            .padding(WVSpacing.lg)
            .background(WVColor.bg2)
            .clipShape(RoundedRectangle(cornerRadius: WVRadius.card, style: .continuous))
        } else {
            VStack(spacing: WVSpacing.sm) {
                ForEach(premium.products, id: \.id) { product in
                    productRow(product)
                }
            }
        }
    }

    private func productRow(_ product: Product) -> some View {
        let selected = selectedProduct?.id == product.id
        return Button {
            selectedID = product.id
        } label: {
            HStack(spacing: WVSpacing.md) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(PremiumProductID.title(for: product.id))
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundStyle(WVColor.label)
                    Text(priceLine(product))
                        .font(.system(size: 13))
                        .foregroundStyle(WVColor.label3)
                }
                Spacer(minLength: WVSpacing.sm)
                Text(product.displayPrice)
                    .font(.system(size: 17, weight: .bold))
                    .foregroundStyle(WVColor.label)
                Image(systemName: selected ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 20))
                    .foregroundStyle(selected ? WVColor.tint : WVColor.label4)
            }
            .padding(.horizontal, WVSpacing.lg)
            .frame(minHeight: 64)
            .background(selected ? WVColor.tint.opacity(0.08) : WVColor.bg2)
            .overlay(
                RoundedRectangle(cornerRadius: WVRadius.card, style: .continuous)
                    .stroke(selected ? WVColor.tint : WVColor.sepThin, lineWidth: selected ? 1.5 : 1)
            )
            .clipShape(RoundedRectangle(cornerRadius: WVRadius.card, style: .continuous))
        }
        .buttonStyle(.plain)
    }

    private func priceLine(_ product: Product) -> String {
        if let sub = product.subscription {
            let period = sub.subscriptionPeriod
            switch period.unit {
            case .year: return L.t("mỗi năm")
            case .month: return L.t("mỗi tháng")
            case .week: return L.t("mỗi tuần")
            case .day: return L.t("mỗi ngày")
            @unknown default: return ""
            }
        }
        return ""
    }

    // MARK: - CTA

    private var purchaseButton: some View {
        VStack(spacing: WVSpacing.sm) {
            WVButton(purchaseTitle, icon: "sparkles", kind: .primary) {
                guard let product = selectedProduct else { return }
                Task { await premium.purchase(product) }
            }
            .disabled(selectedProduct == nil || premium.isPurchasing)

            if premium.isPurchasing {
                ProgressView()
            } else {
                Text(purchaseTerms)
                    .font(.system(size: 12))
                    .foregroundStyle(WVColor.label3)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    /// The trial label only when StoreKit says this account is eligible for the
    /// selected plan's offer; otherwise the plain purchase verb.
    private var purchaseTitle: String {
        guard let offer = trialOffer else { return L.t("Đăng ký Premium") }
        return L.t("Dùng thử %@", periodText(offer.period))
    }

    /// The trial line carries the offer's own length, not a hardcoded week.
    /// Without an eligible trial the ordinary renewal line is shown instead: the
    /// paywall must not promise a free period the App Store will not honour.
    private var purchaseTerms: String {
        guard let offer = trialOffer else {
            return L.t("Tự động gia hạn cho tới khi bạn huỷ. Huỷ bất cứ lúc nào trong phần quản lý đăng ký của Apple.")
        }
        return L.t("%@ miễn phí, sau đó tự động gia hạn. Huỷ bất cứ lúc nào trong phần quản lý đăng ký của Apple.",
                   periodText(offer.period))
    }

    /// StoreKit hands the offer over as a value + unit; the app renders it with
    /// its own plural entries so the copy follows the in-app language (the
    /// system formatter would follow the device locale instead).
    private func periodText(_ period: Product.SubscriptionPeriod) -> String {
        switch period.unit {
        case .day:   return L.p("%d ngày", period.value)
        case .week:  return L.p("%d tuần", period.value)
        case .month: return L.p("%d tháng", period.value)
        case .year:  return L.p("%d năm", period.value)
        @unknown default: return L.p("%d ngày", period.value)
        }
    }

    /// Resolve the trial for the selected plan. Async because eligibility comes
    /// from the App Store for this account, not from the product definition.
    private func refreshTrialOffer() async {
        guard let product = selectedProduct,
              let subscription = product.subscription,
              let offer = subscription.introductoryOffer,
              offer.paymentMode == .freeTrial else {
            trialOffer = nil
            return
        }
        let eligible = await subscription.isEligibleForIntroOffer
        // A plan switch can land while the answer is in flight; a stale answer
        // must not put one plan's trial under another plan's price.
        guard selectedProduct?.id == product.id else { return }
        trialOffer = eligible ? TrialOffer(period: offer.period) : nil
    }

    private var restoreButton: some View {
        WVButton(L.t("Khôi phục mua hàng"), kind: .secondary) {
            Task { await premium.restore() }
        }
        .disabled(premium.isRestoring)
    }

    private var legal: some View {
        VStack(alignment: .leading, spacing: WVSpacing.sm) {
            Text(L.t("Gói tự động gia hạn cho tới khi bạn huỷ. Giá hiển thị do App Store cung cấp; thời hạn và ưu đãi dùng thử áp dụng theo gói bạn chọn."))
                .font(.system(size: 12))
                .foregroundStyle(WVColor.label3)
                .fixedSize(horizontal: false, vertical: true)
            HStack(spacing: 6) {
                Link(L.t("Điều khoản"), destination: URL(string: "https://warrly.com/terms")!)
                Text("·").foregroundStyle(WVColor.label3)
                Link(L.t("Quyền riêng tư"), destination: URL(string: "https://warrly.com/privacy")!)
            }
            .font(.system(size: 12, weight: .semibold))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
