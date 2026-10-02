import SwiftUI
import UIKit
import WarrantyVaultKit

// MARK: - SubscriptionDetailView

struct SubscriptionDetailView: View {
    let client: APIClient
    @ObservedObject var store: SubscriptionsStore
    let subscriptionId: String

    @EnvironmentObject private var toast: WVToastCenter

    @State private var subscription: Subscription?
    @State private var payments: [Payment]      = []
    @State private var isLoading                = false
    @State private var errorMsg: String?
    @State private var showLogPayment           = false
    @State private var showMore                 = false
    @State private var showDelete               = false
    @State private var status: SubscriptionStatus = .ACTIVE
    @State private var pushEdit                 = false

    // MARK: Body

    var body: some View {
        Group {
            if let sub = subscription {
                mainContent(sub)
            } else if isLoading {
                ProgressView()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                WVEmpty(icon: "alert", title: "Không tìm thấy")
            }
        }
        .navigationTitle(subscription?.name ?? "")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    showMore = true
                } label: {
                    Image(systemName: "ellipsis.circle")
                        .font(.system(size: 17))
                        .foregroundStyle(WVColor.tint)
                }
            }
        }
        .task { await reload() }
        .refreshable { await reload() }
        .sheet(isPresented: $showLogPayment) {
            if let sub = subscription {
                SubLogPaymentSheet(
                    client: client,
                    subscriptionId: sub.id,
                    defaultAmount: sub.price
                ) {
                    Task { await reload() }
                }
            }
        }
        .confirmationDialog("", isPresented: $showMore, titleVisibility: .hidden) {
            Button("Sửa") { pushEdit = true }
            Button("Ghi nhận thanh toán") { showLogPayment = true }
            if subscription?.billingCycle != .LIFETIME {
                Button("Gia hạn ngay") { Task { await renewNow() } }
            }
            Button("Xoá", role: .destructive) { showDelete = true }
            Button("Huỷ", role: .cancel) {}
        }
        .alert("Xoá gói đăng ký?", isPresented: $showDelete) {
            Button("Huỷ", role: .cancel) {}
            Button("Xoá", role: .destructive) { Task { await deleteSub() } }
        } message: {
            Text("\"\(subscription?.name ?? "")\" và lịch sử thanh toán sẽ bị xoá.")
        }
        .navigationDestination(isPresented: $pushEdit) {
            if let sub = subscription {
                SubscriptionFormView(client: client, store: store, subscription: sub)
            }
        }
    }

    // MARK: - Main content

    private func mainContent(_ sub: Subscription) -> some View {
        ScrollView {
            VStack(spacing: 0) {
                heroSection(sub)
                costCard(sub)        .padding(.top, WVSpacing.sm)
                quickActions(sub)
                statusSegmented(sub)
                if payments.count > 1 { paymentChart }
                accountSection(sub)
                linksSection(sub)
                paymentsSection
                if let notes = sub.notes, !notes.isEmpty { noteSection(notes) }
                deleteSection
                Spacer().frame(height: WVSpacing.xl)
            }
        }
        .wvScreen()
    }

    // MARK: - Hero

    private func heroSection(_ sub: Subscription) -> some View {
        VStack(spacing: 12) {
            WVLeadingIcon(
                icon: WVCategory.icon(for: sub.category),
                color: WVCategory.accent(for: sub.category),
                size: 64
            )
            Text(sub.name)
                .font(.system(size: 22, weight: .bold))
                .tracking(-0.4)
                .foregroundStyle(WVColor.label)

            let meta = [sub.brand, sub.plan, sub.category]
                .compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")
            if !meta.isEmpty {
                Text(meta)
                    .font(.system(size: 14))
                    .foregroundStyle(WVColor.label3)
            }

            HStack(spacing: 6) {
                WVChip(sub.status.chipLabel, tone: sub.status.chipTone)
                let days = WVFormat.daysUntil(sub.renewalDate)
                if days < 0 && sub.status == .ACTIVE {
                    WVChip("Quá hạn \(abs(days))d", tone: .red, icon: "alert")
                }
            }
        }
        .padding(.horizontal, WVSpacing.titleGutter)
        .padding(.top, WVSpacing.xs)
        .padding(.bottom, WVSpacing.md)
    }

    // MARK: - Cost card

    private func costCard(_ sub: Subscription) -> some View {
        WVCard {
            VStack(alignment: .leading, spacing: 0) {
                HStack(alignment: .lastTextBaseline, spacing: 8) {
                    Text(WVFormat.vnd(sub.price))
                        .font(.system(size: 26, weight: .bold))
                        .foregroundStyle(WVColor.label)
                    Text(sub.billingCycle.shortLabel)
                        .font(.system(size: 13))
                        .foregroundStyle(WVColor.label3)
                }
                if sub.billingCycle != .LIFETIME {
                    let monthly = subMonthlyEquivalent(sub)
                    let total   = payments.reduce(0) { $0 + $1.amount }
                    Text("~ \(WVFormat.vnd(Int(monthly.rounded()))) / tháng · Đã chi tổng \(WVFormat.vnd(total))")
                        .font(.system(size: 13))
                        .foregroundStyle(WVColor.label3)
                        .padding(.top, 2)
                }

                Rectangle().fill(WVColor.sep).frame(height: 0.5)
                    .padding(.vertical, WVSpacing.md)

                HStack(alignment: .bottom) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(sub.billingCycle == .LIFETIME ? "LIFETIME" : "GIA HẠN TỚI")
                            .font(.system(size: 12, weight: .semibold))
                            .tracking(0.5)
                            .foregroundStyle(WVColor.label3)
                        if sub.billingCycle == .LIFETIME {
                            Text("∞")
                                .font(.system(size: 20, weight: .semibold))
                                .foregroundStyle(WVColor.label)
                        } else {
                            let days = WVFormat.daysUntil(sub.renewalDate)
                            Text(WVFormat.date(sub.renewalDate))
                                .font(.system(size: 17, weight: .semibold))
                                .foregroundStyle(days < 0 ? WVColor.red : WVColor.label)
                        }
                    }
                    Spacer(minLength: 0)
                    if sub.billingCycle != .LIFETIME {
                        WVButton("Gia hạn", icon: "refresh", kind: .secondary, size: .small,
                                 fullWidth: false) {
                            Task { await renewNow() }
                        }
                    }
                }
            }
        }
    }

    // MARK: - Quick actions

    private func quickActions(_ sub: Subscription) -> some View {
        HStack(spacing: WVSpacing.sm) {
            WVButton("Ghi nhận thanh toán", icon: "wallet", kind: .secondary, size: .small,
                     fullWidth: true) { showLogPayment = true }

            if let urlStr = sub.manageUrl, !urlStr.isEmpty, let url = URL(string: urlStr) {
                Link(destination: url) {
                    HStack(spacing: 6) {
                        WVIcon("externalLink", size: 14)
                        Text("Quản lý").font(.system(size: 15, weight: .semibold))
                    }
                    .foregroundStyle(WVColor.tint)
                    .frame(maxWidth: .infinity, minHeight: 34)
                    .background(WVColor.fill2)
                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                }
            }
        }
        .padding(.horizontal, WVSpacing.gutter)
        .padding(.top, WVSpacing.md)
    }

    // MARK: - Status segmented

    private func statusSegmented(_ sub: Subscription) -> some View {
        WVSegmented(
            options: [
                (.ACTIVE,   "Đang dùng"),
                (.PAUSED,   "Tạm dừng"),
                (.CANCELED, "Đã huỷ"),
            ],
            selection: $status
        )
        .padding(.horizontal, WVSpacing.gutter)
        .padding(.top, WVSpacing.sm)
        .onChange(of: status) { _, newVal in
            Task { await changeStatus(newVal, sub: sub) }
        }
    }

    // MARK: - Payment chart

    private var paymentChart: some View {
        VStack(alignment: .leading, spacing: 0) {
            WVSectionHeader("Biểu đồ thanh toán")
            WVCard {
                let pts = payments.reversed().map { p in
                    WVChartPoint(
                        label: String(WVFormat.date(p.paidAt).prefix(5)),
                        value: Double(p.amount)
                    )
                }
                WVLineChart(data: pts, height: 160, color: WVColor.indigo) { v in
                    "\(Int(v / 1_000))k"
                }
            }
        }
        .padding(.top, WVSpacing.sm)
    }

    // MARK: - Account section

    private func accountSection(_ sub: Subscription) -> some View {
        // Build the rows imperatively before the @ViewBuilder body.
        var rows: [(icon: String, color: Color, title: String, detail: String)] = []
        if let e = sub.accountEmail, !e.isEmpty { rows.append(("mail", WVColor.blue, "Email", e)) }
        if let pm = sub.paymentMethod, !pm.isEmpty { rows.append(("creditCard", WVColor.purple, "Thanh toán", pm)) }
        rows.append(("refresh", WVColor.green, "Tự gia hạn", sub.autoRenew ? "Bật" : "Tắt"))
        rows.append(("calendar", WVColor.orange, "Bắt đầu", WVFormat.date(sub.startedAt)))

        return VStack(spacing: 0) {
            WVSectionHeader("Tài khoản")
            WVGroup {
                ForEach(Array(rows.enumerated()), id: \.offset) { idx, row in
                    if idx > 0 { WVDivider(inset: 60) }
                    WVRow(icon: row.icon, iconColor: row.color,
                          title: row.title, detail: row.detail)
                }
            }
        }
        .padding(.top, WVSpacing.sm)
    }

    // MARK: - Links section

    @ViewBuilder
    private func linksSection(_ sub: Subscription) -> some View {
        let manageValid = sub.manageUrl.map { !$0.isEmpty && URL(string: $0) != nil } ?? false
        let cancelValid = sub.cancelUrl.map { !$0.isEmpty && URL(string: $0) != nil } ?? false
        if manageValid || cancelValid {
            VStack(spacing: 0) {
                WVSectionHeader("Liên kết")
                WVGroup {
                    if manageValid, let url = URL(string: sub.manageUrl ?? "") {
                        WVRow(icon: "externalLink", iconColor: WVColor.blue,
                              title: "Quản lý gói", chevron: true, role: .tint) {
                            UIApplication.shared.open(url)
                        }
                        if cancelValid { WVDivider(inset: 60) }
                    }
                    if cancelValid, let url = URL(string: sub.cancelUrl ?? "") {
                        WVRow(icon: "x", iconColor: WVColor.red,
                              title: "Huỷ gói", chevron: true, role: .destructive) {
                            UIApplication.shared.open(url)
                        }
                    }
                }
            }
            .padding(.top, WVSpacing.sm)
        }
    }

    // MARK: - Payment history

    private var paymentsSection: some View {
        VStack(spacing: 0) {
            WVSectionHeader("Lịch sử thanh toán (\(payments.count))")
            WVGroup {
                if payments.isEmpty {
                    WVRowContainer {
                        Text("Chưa có thanh toán nào")
                            .font(.system(size: 15))
                            .foregroundStyle(WVColor.label3)
                            .frame(maxWidth: .infinity, alignment: .center)
                            .padding(.vertical, WVSpacing.sm)
                    }
                } else {
                    ForEach(Array(payments.prefix(8).enumerated()), id: \.element.id) { idx, p in
                        if idx > 0 { WVDivider(inset: 60) }
                        WVRow(
                            icon: "wallet", iconColor: WVColor.green,
                            title: WVFormat.date(p.paidAt),
                            subtitle: p.note,
                            detail: WVFormat.vnd(p.amount)
                        )
                    }
                }
            }
        }
        .padding(.top, WVSpacing.sm)
    }

    // MARK: - Note

    private func noteSection(_ text: String) -> some View {
        VStack(spacing: 0) {
            WVSectionHeader("Ghi chú")
            WVGroup {
                WVRowContainer {
                    Text(text)
                        .font(.system(size: 15))
                        .foregroundStyle(WVColor.label)
                        .lineSpacing(4)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.vertical, WVSpacing.xs)
                }
            }
        }
        .padding(.top, WVSpacing.sm)
    }

    // MARK: - Delete row

    private var deleteSection: some View {
        VStack(spacing: 0) {
            Spacer().frame(height: WVSpacing.md)
            WVGroup {
                WVRow(icon: "trash", iconColor: WVColor.red,
                      title: "Xoá gói đăng ký", role: .destructive) {
                    showDelete = true
                }
            }
        }
    }

    // MARK: - Data

    private func reload() async {
        // Optimistically show data from the list store
        if subscription == nil {
            subscription = store.subscriptions.first(where: { $0.id == subscriptionId })
            if let s = subscription { status = s.status }
        }
        isLoading = true
        defer { isLoading = false }
        do {
            let (sub, ps) = try await client.getSubscription(id: subscriptionId)
            subscription = sub
            payments = ps.sorted { $0.paidAt > $1.paidAt }
            status = sub.status
            errorMsg = nil
        } catch {
            errorMsg = (error as? APIError)?.localizedDescription ?? error.localizedDescription
        }
    }

    private func renewNow() async {
        do {
            try await store.renewNow(id: subscriptionId)
            await reload()
            toast.show("Đã gia hạn gói 🔁")
        } catch {
            toast.show((error as? APIError)?.localizedDescription ?? error.localizedDescription)
        }
    }

    private func changeStatus(_ newStatus: SubscriptionStatus, sub: Subscription) async {
        do {
            try await store.setStatus(id: sub.id, status: newStatus)
            toast.show("Đổi sang \(newStatus.chipLabel)")
        } catch {
            status = sub.status   // revert optimistic update
            toast.show((error as? APIError)?.localizedDescription ?? error.localizedDescription)
        }
    }

    private func deleteSub() async {
        do {
            try await store.delete(id: subscriptionId)
        } catch {
            toast.show((error as? APIError)?.localizedDescription ?? error.localizedDescription)
        }
    }
}

// MARK: - SubscriptionStatus display helpers

extension SubscriptionStatus {
    var chipLabel: String {
        switch self {
        case .ACTIVE:   return "Đang dùng"
        case .PAUSED:   return "Tạm dừng"
        case .CANCELED: return "Đã huỷ"
        case .EXPIRED:  return "Hết hạn"
        }
    }
    var chipTone: WVChipTone {
        switch self {
        case .ACTIVE:   return .green
        case .PAUSED:   return .orange
        case .CANCELED: return .red
        case .EXPIRED:  return .gray
        }
    }
}

// MARK: - monthlyEquivalent

private func subMonthlyEquivalent(_ sub: Subscription) -> Double {
    let p = Double(sub.price)
    switch sub.billingCycle {
    case .MONTHLY:   return p
    case .QUARTERLY: return p / 3
    case .YEARLY:    return p / 12
    case .LIFETIME:  return 0
    case .CUSTOM:
        let d = Double(sub.intervalDays ?? 30)
        return d > 0 ? p / d * 30 : 0
    }
}

// MARK: - Log Payment sheet

struct SubLogPaymentSheet: View {
    let client: APIClient
    let subscriptionId: String
    let defaultAmount: Int
    let onLogged: () -> Void

    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var toast: WVToastCenter

    @State private var amount: Int?
    @State private var paidAt   = Date()
    @State private var note     = ""
    @State private var isBusy   = false
    @State private var topError: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 0) {
                    Spacer().frame(height: WVSpacing.sm)
                    WVGroup {
                        WVRowContainer {
                            HStack {
                                Text("Số tiền")
                                    .font(.system(size: 17))
                                    .foregroundStyle(WVColor.label)
                                Spacer()
                                WVMoneyField(value: $amount)
                                    .frame(width: 140)
                            }
                        }
                        WVDivider()
                        WVRowContainer {
                            DatePicker("Ngày trả", selection: $paidAt,
                                       displayedComponents: .date)
                                .font(.system(size: 17))
                        }
                        WVDivider()
                        WVRowContainer {
                            HStack {
                                Text("Ghi chú")
                                    .font(.system(size: 17))
                                    .foregroundStyle(WVColor.label)
                                Spacer()
                                TextField("vd: Tháng 4/2026", text: $note)
                                    .multilineTextAlignment(.trailing)
                                    .font(.system(size: 17))
                                    .foregroundStyle(WVColor.label3)
                                    .frame(width: 160)
                            }
                        }
                    }
                    if let topError {
                        Text(topError)
                            .font(.system(size: 13))
                            .foregroundStyle(WVColor.red)
                            .padding(.horizontal, WVSpacing.gutter)
                            .padding(.top, WVSpacing.sm)
                    }
                    Spacer().frame(height: WVSpacing.xl)
                }
            }
            .wvScreen()
            .navigationTitle("Log thanh toán")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Huỷ") { dismiss() }
                        .foregroundStyle(WVColor.tint)
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Lưu") { Task { await submit() } }
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundStyle(WVColor.tint)
                        .disabled(isBusy || (amount ?? 0) <= 0)
                }
            }
        }
        .presentationDetents([.medium, .large])
        .onAppear {
            amount = defaultAmount > 0 ? defaultAmount : nil
            paidAt = Date()
            note   = ""
        }
    }

    private func submit() async {
        topError = nil; isBusy = true
        defer { isBusy = false }
        let input = PaymentInput(
            amount: amount ?? 0,
            paidAt: ISO8601DateFormatter.dayOnly.string(from: paidAt),
            note:   note.isEmpty ? nil : note
        )
        do {
            _ = try await client.logSubscriptionPayment(id: subscriptionId, input)
            onLogged()
            toast.show("Đã log payment 💸")
            dismiss()
        } catch {
            topError = (error as? APIError)?.localizedDescription ?? error.localizedDescription
        }
    }
}
