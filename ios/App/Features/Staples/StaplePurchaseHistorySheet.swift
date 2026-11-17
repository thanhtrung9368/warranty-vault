import SwiftUI
import WarrlyKit

/// Every recorded purchase of one essential, newest first, with the price
/// summary the list row shows.
///
/// The server already returns the rows newest first; the sort here repeats that
/// on `purchasedAt` (then `createdAt`) so the order cannot depend on array
/// arrival. Price, day, store and note are all rendered for each row; the
/// summary at the top is last / lowest / average / count.
struct StaplePurchaseHistorySheet: View {
    @ObservedObject var store: StapleStore
    let item: Staple

    @Environment(\.dismiss) private var dismiss

    @State private var purchases: [StaplePurchase] = []
    @State private var loading = false
    @State private var errorMessage: String?

    private var sorted: [StaplePurchase] {
        purchases.sorted {
            if $0.purchasedAt != $1.purchasedAt {
                return $0.purchasedAt > $1.purchasedAt
            }
            return $0.createdAt > $1.createdAt
        }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 0) {
                    if item.hasPurchaseSummary {
                        WVSectionHeader(L.t("Tổng quan"))
                        summaryCard
                    }

                    WVSectionHeader(L.t("Các lần mua"))
                    content

                    Spacer().frame(height: WVSpacing.xl)
                }
            }
            .wvScreen()
            .navigationTitle(L.t("Lịch sử giá"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button(L.t("Xong")) { dismiss() }
                        .fontWeight(.semibold)
                }
            }
            .task { await load() }
            .refreshable { await load() }
        }
        .presentationDetents([.medium, .large])
    }

    // MARK: - Summary

    private var summaryCard: some View {
        WVCard {
            VStack(alignment: .leading, spacing: WVSpacing.sm) {
                HStack(alignment: .top, spacing: 0) {
                    stat(L.t("Lần cuối"), item.lastPrice)
                    statDivider
                    stat(L.t("Thấp nhất"), item.lowestPrice)
                    statDivider
                    stat(L.t("Giá trung bình"), item.averagePrice)
                }
                if let count = item.purchaseCount, count > 0 {
                    Text(L.p("%d lần mua", count))
                        .wvFont(.footnote)
                        .foregroundStyle(WVColor.label3)
                }
            }
        }
    }

    private func stat(_ label: String, _ value: Int?) -> some View {
        VStack(spacing: 3) {
            Text(label)
                .wvFont(.caption)
                .foregroundStyle(WVColor.label3)
                .lineLimit(1)
            Text(value.map(WVFormat.vnd) ?? "—")
                .wvFont(.footnoteEmphasis)
                .foregroundStyle(WVColor.label)
                .lineLimit(1)
                .minimumScaleFactor(0.65)
        }
        .frame(maxWidth: .infinity)
    }

    private var statDivider: some View {
        Rectangle()
            .fill(WVColor.sep)
            .frame(width: 0.5, height: 30)
    }

    // MARK: - Rows

    @ViewBuilder
    private var content: some View {
        if loading && purchases.isEmpty {
            ProgressView()
                .frame(maxWidth: .infinity)
                .padding(.vertical, WVSpacing.xxl)
        } else if let errorMessage, purchases.isEmpty {
            WVEmpty(
                icon: "alert",
                title: L.t("Không tải được lịch sử giá"),
                description: errorMessage
            ) {
                WVButton(L.t("Thử lại"), kind: .secondary) {
                    Task { await load() }
                }
            }
        } else if sorted.isEmpty {
            WVEmpty(
                icon: "shoppingBag",
                title: L.t("Chưa có lần mua nào"),
                description: L.t("Ghi lần mua đầu tiên để bắt đầu theo dõi giá.")
            )
        } else {
            WVGroup {
                ForEach(Array(sorted.enumerated()), id: \.element.id) { idx, purchase in
                    if idx > 0 { WVDivider() }
                    WVRow(
                        icon: "receipt",
                        iconColor: WVColor.brand,
                        title: WVFormat.date(purchase.purchasedAt),
                        subtitle: detailLine(purchase),
                        subtitleLineLimit: 2,
                        detail: WVFormat.vnd(purchase.price)
                    )
                }
            }
        }
    }

    /// Store and note are free text and both belong to the row; one joined line
    /// keeps every purchase the same height without hiding either of them.
    private func detailLine(_ purchase: StaplePurchase) -> String? {
        let parts = [purchase.store, purchase.note]
            .compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    // MARK: - Data

    private func load() async {
        loading = true
        errorMessage = nil
        defer { loading = false }
        do {
            purchases = try await store.purchases(id: item.id)
        } catch let APIError.server(_, envelope) {
            errorMessage = envelope.message ?? L.t("Kiểm tra kết nối rồi thử lại.")
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
