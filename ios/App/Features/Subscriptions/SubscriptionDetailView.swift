import SwiftUI
import WarrantyVaultKit

struct SubscriptionDetailView: View {
    @ObservedObject var listStore: SubscriptionsStore
    let subscriptionId: String
    let initialSubscription: Subscription

    @State private var subscription: Subscription
    @State private var payments: [Payment] = []
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var showEditor = false
    @State private var showLogPayment = false
    @State private var showRenewConfirm = false
    @State private var pendingRenew = false

    private let client: APIClient

    init(client: APIClient, listStore: SubscriptionsStore, subscription: Subscription) {
        self.client = client
        self.listStore = listStore
        self.subscriptionId = subscription.id
        self.initialSubscription = subscription
        _subscription = State(initialValue: subscription)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: WV.Spacing.lg) {
                headerCard
                actionsRow
                paymentsSection
                if let errorMessage {
                    Label(errorMessage, systemImage: "exclamationmark.triangle.fill")
                        .foregroundStyle(WV.Tokens.destructive)
                        .font(.system(size: 13))
                        .padding(.horizontal, WV.Spacing.lg)
                }
            }
            .padding(.vertical, WV.Spacing.lg)
        }
        .background(WV.Tokens.bg)
        .navigationTitle(subscription.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("Sửa") { showEditor = true }
            }
        }
        .task { await reload() }
        .refreshable { await reload() }
        .sheet(isPresented: $showEditor, onDismiss: {
            Task { await reload() }
        }) {
            SubscriptionEditorSheet(store: listStore, subscription: subscription)
        }
        .sheet(isPresented: $showLogPayment) {
            LogPaymentSheet(
                client: client,
                subscriptionId: subscriptionId,
                defaultAmount: subscription.price
            ) {
                Task { await reload() }
            }
        }
        .confirmationDialog(
            "Gia hạn ngay?",
            isPresented: $showRenewConfirm,
            titleVisibility: .visible
        ) {
            Button("Gia hạn") { Task { await renewNow() } }
            Button("Huỷ", role: .cancel) {}
        } message: {
            Text("Sẽ ghi nhận thanh toán cho chu kỳ hiện tại và đẩy ngày gia hạn sang chu kỳ kế tiếp.")
        }
    }

    // MARK: - Sections

    private var headerCard: some View {
        WVCard {
            VStack(alignment: .leading, spacing: WV.Spacing.sm) {
                HStack(alignment: .top, spacing: WV.Spacing.md) {
                    Image(systemName: "creditcard")
                        .font(.system(size: 24))
                        .foregroundStyle(WV.Tokens.primary)
                        .frame(width: 48, height: 48)
                        .background(WV.Tokens.primary.opacity(0.12))
                        .clipShape(RoundedRectangle(cornerRadius: WV.Radius.md))
                    VStack(alignment: .leading, spacing: 4) {
                        Text(subscription.name)
                            .font(.system(size: 18, weight: .semibold))
                        if let plan = subscription.plan, !plan.isEmpty {
                            Text(plan)
                                .font(.system(size: 13))
                                .foregroundStyle(WV.Tokens.mutedFg)
                        }
                        WVStatusPill(subscription.status.label,
                                     kind: kind(for: subscription.status))
                    }
                    Spacer()
                }

                Divider()

                HStack {
                    metaRow(label: "Giá", value: formatVND(subscription.price))
                    Spacer()
                    metaRow(label: "Chu kỳ", value: subscription.billingCycle.label)
                }

                HStack {
                    metaRow(label: "Bắt đầu", value: formatDate(subscription.startedAt))
                    Spacer()
                    if subscription.billingCycle != .LIFETIME {
                        metaRow(label: "Gia hạn", value: formatDate(subscription.renewalDate))
                    }
                }

                if subscription.billingCycle == .CUSTOM, let n = subscription.intervalDays {
                    metaRow(label: "Khoảng cách", value: "\(n) ngày")
                }

                metaRow(label: "Tự động gia hạn", value: subscription.autoRenew ? "Có" : "Không")

                if let email = subscription.accountEmail, !email.isEmpty {
                    metaRow(label: "Email tài khoản", value: email)
                }
                if let pm = subscription.paymentMethod, !pm.isEmpty {
                    metaRow(label: "Thanh toán", value: pm)
                }
                if let manage = subscription.manageUrl, !manage.isEmpty,
                   let url = URL(string: manage) {
                    Link(destination: url) {
                        Label("Mở trang quản lý", systemImage: "arrow.up.right.square")
                            .font(.system(size: 13))
                    }
                }
                if let cancel = subscription.cancelUrl, !cancel.isEmpty,
                   let url = URL(string: cancel) {
                    Link(destination: url) {
                        Label("Mở trang huỷ", systemImage: "xmark.square")
                            .font(.system(size: 13))
                    }
                }
                if let notes = subscription.notes, !notes.isEmpty {
                    Divider()
                    Text(notes)
                        .font(.system(size: 13))
                        .foregroundStyle(WV.Tokens.fg)
                }
            }
        }
        .padding(.horizontal, WV.Spacing.lg)
    }

    private var actionsRow: some View {
        HStack(spacing: WV.Spacing.md) {
            Button {
                showLogPayment = true
            } label: {
                Label("Ghi nhận thanh toán", systemImage: "plus.circle")
            }
            .buttonStyle(PrimaryButtonStyle(fullWidth: true))

            if subscription.billingCycle != .LIFETIME {
                Button {
                    showRenewConfirm = true
                } label: {
                    if pendingRenew {
                        ProgressView()
                    } else {
                        Label("Gia hạn ngay", systemImage: "arrow.clockwise")
                    }
                }
                .buttonStyle(SecondaryButtonStyle(fullWidth: true))
                .disabled(pendingRenew)
            }
        }
        .padding(.horizontal, WV.Spacing.lg)
    }

    private var paymentsSection: some View {
        VStack(alignment: .leading, spacing: WV.Spacing.md) {
            HStack {
                Text("Lịch sử thanh toán")
                    .font(.system(size: 17, weight: .semibold))
                Spacer()
                Text("\(payments.count) lần")
                    .font(.system(size: 12))
                    .foregroundStyle(WV.Tokens.mutedFg)
            }
            .padding(.horizontal, WV.Spacing.lg)

            if isLoading && payments.isEmpty {
                ProgressView()
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, WV.Spacing.xl)
            } else if payments.isEmpty {
                emptyPayments
            } else {
                VStack(spacing: WV.Spacing.sm) {
                    ForEach(payments) { p in
                        paymentCard(p)
                    }
                }
                .padding(.horizontal, WV.Spacing.lg)
            }
        }
    }

    private var emptyPayments: some View {
        VStack(spacing: WV.Spacing.sm) {
            Image(systemName: "tray")
                .font(.system(size: 32, weight: .light))
                .foregroundStyle(WV.Tokens.mutedFg)
            Text("Chưa có lượt thanh toán nào")
                .font(.system(size: 13))
                .foregroundStyle(WV.Tokens.mutedFg)
        }
        .padding(WV.Spacing.lg)
        .frame(maxWidth: .infinity)
    }

    private func paymentCard(_ p: Payment) -> some View {
        WVCard {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text(formatDate(p.paidAt))
                        .font(.system(size: 14, weight: .medium))
                    if let note = p.note, !note.isEmpty {
                        Text(note)
                            .font(.system(size: 12))
                            .foregroundStyle(WV.Tokens.mutedFg)
                    }
                }
                Spacer()
                Text(formatVND(p.amount))
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(WV.Tokens.primary)
            }
        }
    }

    // MARK: - Helpers

    private func metaRow(label: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.system(size: 11)).foregroundStyle(WV.Tokens.mutedFg)
            Text(value).font(.system(size: 14, weight: .medium))
        }
    }

    private func kind(for status: SubscriptionStatus) -> WVStatusKind {
        switch status {
        case .ACTIVE:   return .success
        case .PAUSED:   return .warning
        case .CANCELED: return .neutral
        case .EXPIRED:  return .danger
        }
    }

    // MARK: - Actions

    private func reload() async {
        isLoading = true
        defer { isLoading = false }
        do {
            let (sub, ps) = try await client.getSubscription(id: subscriptionId)
            subscription = sub
            payments = ps.sorted { $0.paidAt > $1.paidAt }
            errorMessage = nil
        } catch {
            errorMessage = (error as? APIError)?.localizedDescription ?? error.localizedDescription
        }
    }

    private func renewNow() async {
        pendingRenew = true
        defer { pendingRenew = false }
        do {
            try await client.renewSubscription(id: subscriptionId)
            await reload()
            // Also refresh the list so the renewalDate / status reflect server state.
            await listStore.load()
        } catch {
            errorMessage = (error as? APIError)?.localizedDescription ?? error.localizedDescription
        }
    }
}

// MARK: - Log Payment sheet

struct LogPaymentSheet: View {
    let client: APIClient
    let subscriptionId: String
    let defaultAmount: Int
    let onLogged: () -> Void

    @Environment(\.dismiss) private var dismiss

    @State private var amount: String
    @State private var paidAt: Date = Date()
    @State private var note: String = ""
    @State private var isSubmitting = false
    @State private var topError: String?

    init(client: APIClient, subscriptionId: String, defaultAmount: Int,
         onLogged: @escaping () -> Void) {
        self.client = client
        self.subscriptionId = subscriptionId
        self.defaultAmount = defaultAmount
        self.onLogged = onLogged
        _amount = State(initialValue: defaultAmount > 0 ? String(defaultAmount) : "")
    }

    var body: some View {
        NavigationStack {
            Form {
                Section(header: sectionHeader("Số tiền")) {
                    TextField("Số tiền (VND)", text: $amount)
                        .keyboardType(.numberPad)
                }
                Section(header: sectionHeader("Ngày")) {
                    DatePicker("Ngày thanh toán", selection: $paidAt, displayedComponents: .date)
                }
                Section(header: sectionHeader("Ghi chú")) {
                    TextField("Ghi chú (tuỳ chọn)", text: $note, axis: .vertical)
                        .lineLimit(2...5)
                }
                if let topError {
                    Section {
                        Label(topError, systemImage: "exclamationmark.triangle.fill")
                            .foregroundStyle(WV.Tokens.destructive)
                            .font(.system(size: 13))
                    }
                }
            }
            .navigationTitle("Ghi nhận thanh toán")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Huỷ") { dismiss() }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button { Task { await submit() } } label: {
                        if isSubmitting { ProgressView() } else { Text("Lưu").bold() }
                    }
                    .disabled(isSubmitting || (Int(amount) ?? 0) <= 0)
                }
            }
        }
    }

    private func submit() async {
        topError = nil
        isSubmitting = true
        defer { isSubmitting = false }
        let input = PaymentInput(
            amount: Int(amount) ?? 0,
            paidAt: ISO8601DateFormatter.dayOnly.string(from: paidAt),
            note: note.isEmpty ? nil : note
        )
        do {
            _ = try await client.logSubscriptionPayment(id: subscriptionId, input)
            onLogged()
            dismiss()
        } catch let err as APIError {
            topError = err.localizedDescription
        } catch {
            topError = error.localizedDescription
        }
    }
}
