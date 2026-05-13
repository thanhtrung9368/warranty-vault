import SwiftUI
import WarrantyVaultKit

struct SubscriptionEditorSheet: View {
    @ObservedObject var store: SubscriptionsStore
    let subscription: Subscription?

    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var catalog: CatalogStore

    @State private var name: String
    @State private var category: String
    @State private var brand: String
    @State private var plan: String
    @State private var billingCycle: BillingCycle
    @State private var intervalDays: String
    @State private var price: String
    @State private var startedAt: Date
    @State private var renewalDate: Date
    @State private var hasRenewalDate: Bool
    @State private var autoRenew: Bool
    @State private var status: SubscriptionStatus
    @State private var accountEmail: String
    @State private var paymentMethod: String
    @State private var manageUrl: String
    @State private var cancelUrl: String
    @State private var notes: String

    @State private var isSubmitting = false
    @State private var topError: String?
    @State private var fieldErrors: [String: [String]] = [:]

    init(store: SubscriptionsStore, subscription: Subscription?) {
        self.store = store
        self.subscription = subscription
        _name = State(initialValue: subscription?.name ?? "")
        _category = State(initialValue: subscription?.category ?? "")
        _brand = State(initialValue: subscription?.brand ?? "")
        _plan = State(initialValue: subscription?.plan ?? "")
        _billingCycle = State(initialValue: subscription?.billingCycle ?? .MONTHLY)
        _intervalDays = State(initialValue: subscription?.intervalDays.map { String($0) } ?? "")
        _price = State(initialValue: subscription.map { String($0.price) } ?? "")
        _startedAt = State(initialValue: subscription?.startedAt ?? Date())
        _renewalDate = State(initialValue: subscription?.renewalDate ?? Date())
        _hasRenewalDate = State(initialValue: subscription != nil)
        _autoRenew = State(initialValue: subscription?.autoRenew ?? true)
        _status = State(initialValue: subscription?.status ?? .ACTIVE)
        _accountEmail = State(initialValue: subscription?.accountEmail ?? "")
        _paymentMethod = State(initialValue: subscription?.paymentMethod ?? "")
        _manageUrl = State(initialValue: subscription?.manageUrl ?? "")
        _cancelUrl = State(initialValue: subscription?.cancelUrl ?? "")
        _notes = State(initialValue: subscription?.notes ?? "")
    }

    private var isEditing: Bool { subscription != nil }

    var body: some View {
        NavigationStack {
            Form {
                Section(header: sectionHeader("Thông tin chính")) {
                    TextField("Tên gói", text: $name)
                    TextField("Loại / Danh mục", text: $category)
                    TextField("Hãng / Nhà cung cấp", text: $brand)
                    AutocompleteChips(
                        suggestions: brandSuggestions,
                        text: $brand
                    )
                    TextField("Plan (Pro, Family, ...)", text: $plan)
                }

                Section(header: sectionHeader("Chu kỳ & giá")) {
                    Picker("Chu kỳ", selection: $billingCycle) {
                        ForEach(BillingCycle.allCases, id: \.self) { c in
                            Text(c.label).tag(c)
                        }
                    }
                    if billingCycle == .CUSTOM {
                        TextField("Số ngày mỗi chu kỳ", text: $intervalDays)
                            .keyboardType(.numberPad)
                    }
                    TextField("Giá (VND)", text: $price)
                        .keyboardType(.numberPad)
                    if let errs = fieldErrors["price"], let msg = errs.first {
                        Text(msg).font(.system(size: 12)).foregroundStyle(WV.Tokens.destructive)
                    }
                }

                Section(header: sectionHeader("Mốc thời gian")) {
                    DatePicker("Ngày bắt đầu", selection: $startedAt, displayedComponents: .date)
                    Toggle("Có ngày gia hạn", isOn: $hasRenewalDate)
                    if hasRenewalDate {
                        DatePicker("Ngày gia hạn", selection: $renewalDate, displayedComponents: .date)
                    }
                    Toggle("Tự động gia hạn", isOn: $autoRenew)
                }

                Section(header: sectionHeader("Trạng thái")) {
                    Picker("Trạng thái", selection: $status) {
                        ForEach(SubscriptionStatus.allCases, id: \.self) { s in
                            Text(s.label).tag(s)
                        }
                    }
                }

                Section(header: sectionHeader("Tài khoản & thanh toán")) {
                    TextField("Email tài khoản", text: $accountEmail)
                        .keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never)
                    TextField("Phương thức thanh toán", text: $paymentMethod)
                    AutocompleteChips(
                        suggestions: storeSuggestions,
                        text: $paymentMethod
                    )
                    TextField("Link quản lý", text: $manageUrl)
                        .keyboardType(.URL)
                        .textInputAutocapitalization(.never)
                    TextField("Link huỷ", text: $cancelUrl)
                        .keyboardType(.URL)
                        .textInputAutocapitalization(.never)
                }

                Section(header: sectionHeader("Ghi chú")) {
                    TextField("Ghi chú (tuỳ chọn)", text: $notes, axis: .vertical)
                        .lineLimit(2...5)
                }

                if isEditing {
                    Section {
                        Button("Xoá đăng ký", role: .destructive) {
                            Task { await deleteAndDismiss() }
                        }
                    }
                }

                if let topError {
                    Section {
                        Label(topError, systemImage: "exclamationmark.triangle.fill")
                            .foregroundStyle(WV.Tokens.destructive)
                            .font(.system(size: 13))
                    }
                }
            }
            .navigationTitle(isEditing ? "Sửa đăng ký" : "Thêm đăng ký")
            .navigationBarTitleDisplayMode(.inline)
            .task { await catalog.loadIfNeeded() }
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Huỷ") { dismiss() }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button { Task { await submit() } } label: {
                        if isSubmitting { ProgressView() } else { Text("Lưu").bold() }
                    }
                    .disabled(isSubmitting || name.isEmpty || (Int(price) ?? -1) < 0)
                }
            }
        }
    }

    private var brandSuggestions: [String] {
        catalog.brands(matching: brand).prefix(8).map(\.name)
    }

    private var storeSuggestions: [String] {
        catalog.stores(matching: paymentMethod).prefix(8).map(\.name)
    }

    private func submit() async {
        topError = nil; fieldErrors = [:]
        isSubmitting = true
        defer { isSubmitting = false }

        var input = SubscriptionInput(
            name: name,
            billingCycle: billingCycle,
            price: Int(price) ?? 0,
            startedAt: ISO8601DateFormatter.dayOnly.string(from: startedAt)
        )
        input.category = category.isEmpty ? nil : category
        input.brand = brand.isEmpty ? nil : brand
        input.plan = plan.isEmpty ? nil : plan
        input.intervalDays = billingCycle == .CUSTOM ? Int(intervalDays) : nil
        input.renewalDate = hasRenewalDate
            ? ISO8601DateFormatter.dayOnly.string(from: renewalDate)
            : nil
        input.autoRenew = autoRenew
        input.status = status
        input.accountEmail = accountEmail.isEmpty ? nil : accountEmail
        input.paymentMethod = paymentMethod.isEmpty ? nil : paymentMethod
        input.manageUrl = manageUrl.isEmpty ? nil : manageUrl
        input.cancelUrl = cancelUrl.isEmpty ? nil : cancelUrl
        input.notes = notes.isEmpty ? nil : notes

        do {
            if let subscription {
                try await store.update(id: subscription.id, input)
            } else {
                _ = try await store.create(input)
            }
            dismiss()
        } catch let err as APIError {
            topError = err.localizedDescription
            fieldErrors = err.fieldErrors
        } catch {
            topError = error.localizedDescription
        }
    }

    private func deleteAndDismiss() async {
        guard let subscription else { return }
        do {
            try await store.delete(id: subscription.id)
            dismiss()
        } catch let err as APIError {
            topError = err.localizedDescription
        } catch {
            topError = error.localizedDescription
        }
    }
}
