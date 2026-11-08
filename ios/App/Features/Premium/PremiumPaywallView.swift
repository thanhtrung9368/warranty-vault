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

    private var hasTrial: Bool {
        premium.products.contains {
            $0.subscription?.introductoryOffer?.paymentMode == .freeTrial
        }
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
                await premium.syncEntitlement()
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
            WVLeadingIcon(icon: "sparkles", color: WVColor.orange)
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
            benefit("Không còn quảng cáo")
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
                    Task { await premium.loadProducts() }
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
            WVButton(
                hasTrial ? L.t("Dùng thử 7 ngày") : L.t("Đăng ký"),
                icon: "sparkles",
                kind: .primary
            ) {
                guard let product = selectedProduct else { return }
                Task { await premium.purchase(product) }
            }
            .disabled(selectedProduct == nil || premium.isPurchasing)

            if premium.isPurchasing {
                ProgressView()
            } else if hasTrial {
                Text(L.t("7 ngày miễn phí, sau đó tự động gia hạn. Huỷ bất cứ lúc nào trong phần quản lý đăng ký của Apple."))
                    .font(.system(size: 12))
                    .foregroundStyle(WVColor.label3)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
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
