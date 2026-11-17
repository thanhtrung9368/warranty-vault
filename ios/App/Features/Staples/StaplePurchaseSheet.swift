import SwiftUI
import WarrlyKit

/// Records one purchase of an essential: price (required), the day, and an
/// optional store and note.
///
/// This replaces the old no-price "Đã mua lại" quick action. A restock that
/// wrote only `lastBoughtAt` would leave the price summary describing a history
/// that never recorded the purchase, so every "bought it again" now goes through
/// this sheet and `POST /api/v1/staples/{id}/purchases`. The server inserts the
/// row, moves `lastBoughtAt` forward and sets `state = ENOUGH` in one
/// transaction; `StapleStore.addPurchase` reloads the list afterwards.
struct StaplePurchaseSheet: View {
    @ObservedObject var store: StapleStore
    let item: Staple

    @Environment(\.dismiss) private var dismiss

    @State private var price: Int?
    @State private var purchasedAt = Date()
    @State private var storeName = ""
    @State private var note = ""
    @State private var busy = false
    @State private var errorMessage: String?

    /// `price` is the one required field. Zero is legal (a free item), so the
    /// gate is "entered", not "greater than zero" — `WVMoneyField` reads an
    /// empty field as `nil`.
    private var canSave: Bool { price != nil && !busy }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 0) {
                    Spacer().frame(height: WVSpacing.sm)

                    WVGroup {
                        fieldRow(L.t("Giá")) {
                            WVMoneyField(value: $price)
                                .frame(width: 150)
                        }
                        WVDivider()
                        fieldRow(L.t("Ngày mua")) {
                            DatePicker(
                                "",
                                selection: $purchasedAt,
                                displayedComponents: .date
                            )
                            .labelsHidden()
                        }
                        WVDivider()
                        fieldRow(L.t("Cửa hàng")) {
                            TextField(L.t("vd: Vinmart, Shopee..."), text: $storeName)
                                .wvFont(.body)
                                .multilineTextAlignment(.trailing)
                        }
                        WVDivider()
                        fieldRow(L.t("Ghi chú")) {
                            TextField(L.t("Ghi chú thêm..."), text: $note)
                                .wvFont(.body)
                                .multilineTextAlignment(.trailing)
                        }
                    }
                    WVSectionFooter(L.t("Lưu lần mua sẽ đặt món về “Đủ dùng” và cập nhật ngày mua gần nhất."))

                    Spacer().frame(height: WVSpacing.xl)
                }
            }
            .wvScreen()
            .navigationTitle(L.t("Thêm lần mua"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button(L.t("Huỷ")) { dismiss() }
                        .disabled(busy)
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button(L.t("Lưu")) { Task { await submit() } }
                        .fontWeight(.semibold)
                        .disabled(!canSave)
                }
            }
        }
        .presentationDetents([.medium, .large])
        .alert(L.t("Không lưu được"), isPresented: Binding(
            get: { errorMessage != nil },
            set: { if !$0 { errorMessage = nil } }
        )) {
            Button("OK", role: .cancel) { errorMessage = nil }
        } message: {
            Text(errorMessage ?? "")
        }
    }

    // MARK: - Helpers

    private func fieldRow<Content: View>(
        _ title: String,
        @ViewBuilder content: () -> Content
    ) -> some View {
        HStack(spacing: WVSpacing.md) {
            Text(title)
                .wvFont(.body)
                .foregroundStyle(WVColor.label)
            Spacer(minLength: WVSpacing.sm)
            content()
        }
        .padding(.horizontal, WVSpacing.gutter)
        .frame(minHeight: 44)
        .padding(.vertical, WVSpacing.xs)
    }

    private func cleaned(_ s: String) -> String? {
        let t = s.trimmingCharacters(in: .whitespacesAndNewlines)
        return t.isEmpty ? nil : t
    }

    private func submit() async {
        guard let price, canSave else { return }
        busy = true
        errorMessage = nil
        defer { busy = false }

        let input = StaplePurchaseInput(
            price: price,
            purchasedAt: WireDay.string(from: purchasedAt),
            store: cleaned(storeName),
            note: cleaned(note)
        )

        do {
            try await store.addPurchase(id: item.id, input)
            dismiss()
        } catch let APIError.server(_, envelope) {
            errorMessage = envelope.message ?? L.t("Không lưu được.")
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
