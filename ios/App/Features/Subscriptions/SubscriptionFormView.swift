import SwiftUI
import WarrlyKit

// MARK: - SubscriptionFormView

struct SubscriptionFormView: View {
    let client: APIClient
    @ObservedObject var store: SubscriptionsStore
    var subscription: Subscription?          // nil → create

    @EnvironmentObject private var catalog: CatalogStore
    @EnvironmentObject private var toast:   WVToastCenter
    @Environment(\.dismiss) private var dismiss

    // Form fields
    @State private var name:          String
    @State private var brand:         String
    @State private var plan:          String
    @State private var category:      String
    @State private var price:         Int?
    @State private var billingCycle:  BillingCycle
    @State private var intervalDays:  String
    @State private var startedAt:     Date
    @State private var renewalDate:   Date
    @State private var hasRenewal:    Bool
    @State private var autoRenew:     Bool
    @State private var accountEmail:  String
    @State private var paymentMethod: String
    @State private var manageUrl:     String
    @State private var cancelUrl:     String
    @State private var notes:         String
    @State private var subStatus:     SubscriptionStatus

    /// Reminder lead times before renewal, in days. Kept normalised descending
    /// by `LeadDaysRules`; a create form starts from the server's `[30, 7]`
    /// default. Empty is a visible invalid state — the API rejects `[]`.
    @State private var leadDays:     [Int]

    /// Trial ("Dùng thử", Feature B): whether a timed free period exists, when it
    /// ends, and the price charged after it.
    ///
    /// `hasTrial` is the "the date is set" control. Turning it off clears
    /// `convertsToPrice` immediately: the server rejects a price without a trial
    /// date (`fieldErrors.convertsToPrice`), and the price row is hidden whenever
    /// there is no date, so the form can never build that combination.
    @State private var hasTrial:          Bool
    @State private var trialEndsAt:       Date
    @State private var convertsToPrice:   Int?

    // UI state
    @State private var showCatPicker   = false
    @State private var showCyclePicker = false
    @State private var showDiscard     = false
    @State private var isBusy          = false
    @State private var topError: String?
    /// Verbatim `fieldErrors.leadDays` from the server, shown under the editor.
    @State private var leadDaysError: String?
    /// Verbatim `fieldErrors.convertsToPrice`, if the server still rejects one.
    @State private var trialError: String?

    private var isEditing: Bool { subscription != nil }
    private var isValid: Bool {
        !name.trimmingCharacters(in: .whitespaces).isEmpty
            && (price ?? 0) > 0
            && LeadDaysRules.isValid(LeadDaysRules.normalize(leadDays))
            // The pair rule, defensive: the price row is hidden and cleared when
            // there is no trial date, so this should always hold.
            && (hasTrial || convertsToPrice == nil)
    }

    // MARK: - Init

    init(client: APIClient, store: SubscriptionsStore, subscription: Subscription? = nil) {
        self.client       = client
        self.store        = store
        self.subscription = subscription

        let sub = subscription
        _name          = State(initialValue: sub?.name ?? "")
        _brand         = State(initialValue: sub?.brand ?? "")
        _plan          = State(initialValue: sub?.plan ?? "")
        _category      = State(initialValue: sub?.category ?? "ai")
        _price         = State(initialValue: sub?.price)
        _billingCycle  = State(initialValue: sub?.billingCycle ?? .MONTHLY)
        _intervalDays  = State(initialValue: sub?.intervalDays.map { String($0) } ?? "")
        _startedAt     = State(initialValue: sub?.startedAt ?? Date())
        _renewalDate   = State(initialValue: sub?.renewalDate ?? Date())
        _hasRenewal    = State(initialValue: sub != nil)
        _autoRenew     = State(initialValue: sub?.autoRenew ?? true)
        _accountEmail  = State(initialValue: sub?.accountEmail ?? "")
        _paymentMethod = State(initialValue: sub?.paymentMethod ?? "")
        _manageUrl     = State(initialValue: sub?.manageUrl ?? "")
        _cancelUrl     = State(initialValue: sub?.cancelUrl ?? "")
        _notes         = State(initialValue: sub?.notes ?? "")
        _subStatus     = State(initialValue: sub?.status ?? .ACTIVE)
        // Older payloads have no `leadDays`; the server's create default is
        // `[30, 7]`, and `normalize` makes any returned list canonical before
        // the first frame draws it.
        _leadDays      = State(initialValue: LeadDaysRules.normalize(
            sub?.leadDays ?? LeadDaysRules.defaults
        ))
        // Trial. `carried` reduces the wire day without parsing an instant and
        // drops a `convertsToPrice` that has no trial date (the pair the server
        // rejects). The picker starts on the stored day, else the renewal date —
        // never on a day the form invents into a trial.
        let trial = sub.map(SubscriptionTrial.carried(from:)) ?? .none
        _hasTrial = State(initialValue: trial.trialEndsAt != nil)
        _trialEndsAt = State(initialValue: WireDay.date(from: trial.trialEndsAt)
            ?? sub?.renewalDate ?? Date())
        _convertsToPrice = State(initialValue: trial.trialEndsAt != nil
            ? trial.convertsToPrice : nil)
    }

    // MARK: - Body

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                Spacer().frame(height: WVSpacing.sm)

                // Basic info
                WVGroup {
                    fieldRow(L.t("Tên")) {
                        TextField("Apple One, ChatGPT Plus...", text: $name)
                            .font(.system(size: 17))
                            .multilineTextAlignment(.trailing)
                    }
                    WVDivider()
                    fieldRow(L.t("Hãng")) {
                        TextField("Apple, OpenAI...", text: $brand)
                            .font(.system(size: 17))
                            .multilineTextAlignment(.trailing)
                    }
                    WVDivider()
                    fieldRow("Plan") {
                        TextField("Family, Plus...", text: $plan)
                            .font(.system(size: 17))
                            .multilineTextAlignment(.trailing)
                    }
                    WVDivider()
                    // Category picker trigger
                    Button { showCatPicker = true } label: {
                        HStack {
                            Text(L.t("Loại"))
                                .font(.system(size: 17))
                                .foregroundStyle(WVColor.label)
                            Spacer()
                            HStack(spacing: 6) {
                                WVLeadingIcon(
                                    icon: WVCategory.icon(for: category),
                                    color: WVCategory.accent(for: category),
                                    size: 22
                                )
                                Text(catalogCategoryName(category))
                                    .font(.system(size: 17))
                                    .foregroundStyle(WVColor.label3)
                            }
                            WVIcon("arrowRight", size: 13, weight: .semibold)
                                .foregroundStyle(WVColor.label4)
                        }
                        .padding(.horizontal, 16)
                        .frame(minHeight: 44)
                        .padding(.vertical, 7)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(WVRowButtonStyle())
                }

                // Cost
                WVSectionHeader(L.t("Chi phí"))
                WVGroup {
                    fieldRow(L.t("Giá / chu kỳ")) {
                        WVMoneyField(value: $price)
                            .frame(width: 150)
                    }
                    WVDivider()
                    Button { showCyclePicker = true } label: {
                        HStack {
                            Text(L.t("Chu kỳ"))
                                .font(.system(size: 17))
                                .foregroundStyle(WVColor.label)
                            Spacer()
                            Text(billingCycle.shortLabel)
                                .font(.system(size: 17))
                                .foregroundStyle(WVColor.label3)
                            WVIcon("arrowRight", size: 13, weight: .semibold)
                                .foregroundStyle(WVColor.label4)
                        }
                        .padding(.horizontal, 16)
                        .frame(minHeight: 44)
                        .padding(.vertical, 7)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(WVRowButtonStyle())
                    WVDivider()
                    WVRowContainer {
                        DatePicker(L.t("Bắt đầu"), selection: $startedAt,
                                   displayedComponents: .date)
                            .font(.system(size: 17))
                    }
                    if billingCycle != .LIFETIME {
                        WVDivider()
                        WVRowContainer {
                            Toggle(L.t("Có ngày gia hạn"), isOn: $hasRenewal)
                                .font(.system(size: 17))
                        }
                        if hasRenewal {
                            WVDivider()
                            WVRowContainer {
                                DatePicker(L.t("Gia hạn kế"), selection: $renewalDate,
                                           displayedComponents: .date)
                                    .font(.system(size: 17))
                            }
                        }
                    }
                    WVDivider()
                    WVRowContainer {
                        Toggle(L.t("Tự gia hạn"), isOn: $autoRenew)
                            .font(.system(size: 17))
                    }
                    if billingCycle == .CUSTOM {
                        WVDivider()
                        fieldRow(L.t("Số ngày / chu kỳ")) {
                            TextField("30", text: $intervalDays)
                                .keyboardType(.numberPad)
                                .font(.system(size: 17))
                                .multilineTextAlignment(.trailing)
                        }
                    }
                }

                // Trial ("Dùng thử", Feature B). The date is the switch: when it
                // is off there is no trial and the post-trial price is hidden and
                // cleared, because a price without a trial date is the server's
                // 400 `fieldErrors.convertsToPrice`.
                WVSectionHeader(L.t("Dùng thử"))
                WVSectionFooter(L.t("Chỉ nhập giá sau dùng thử khi đã đặt ngày kết thúc dùng thử."))
                WVGroup {
                    WVRowContainer {
                        Toggle(L.t("Có dùng thử"), isOn: $hasTrial)
                            .font(.system(size: 17))
                            .onChange(of: hasTrial) { _, isOn in
                                if !isOn {
                                    convertsToPrice = nil
                                    trialError = nil
                                }
                            }
                    }
                    if hasTrial {
                        WVDivider()
                        WVRowContainer {
                            DatePicker(L.t("Dùng thử đến"), selection: $trialEndsAt,
                                       displayedComponents: .date)
                                .font(.system(size: 17))
                                .onChange(of: trialEndsAt) { _, _ in trialError = nil }
                        }
                        WVDivider()
                        fieldRow(L.t("Giá sau dùng thử")) {
                            WVMoneyField(value: $convertsToPrice)
                                .frame(width: 150)
                                .onChange(of: convertsToPrice) { _, _ in trialError = nil }
                        }
                        if let trialError {
                            WVDivider()
                            Text(trialError)
                                .font(.system(size: 12))
                                .foregroundStyle(WVColor.red)
                                .fixedSize(horizontal: false, vertical: true)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(.horizontal, 16)
                                .padding(.vertical, 8)
                        }
                    }
                }

                // Reminder lead times before the renewal date. Same editor and
                // same `LeadDaysRules` as the device form; the schedule is
                // per-subscription, not a global preference.
                LeadDaysSection(days: $leadDays, error: leadDaysError)
                    .onChange(of: leadDays) { _, _ in leadDaysError = nil }

                // Account
                WVSectionHeader(L.t("Tài khoản"))
                WVGroup {
                    fieldRow("Email") {
                        TextField("account@example.com", text: $accountEmail)
                            .keyboardType(.emailAddress)
                            .textInputAutocapitalization(.never)
                            .font(.system(size: 17))
                            .multilineTextAlignment(.trailing)
                    }
                    WVDivider()
                    fieldRow(L.t("Thanh toán")) {
                        TextField("Visa **4242, Momo...", text: $paymentMethod)
                            .font(.system(size: 17))
                            .multilineTextAlignment(.trailing)
                    }
                    WVDivider()
                    fieldRow(L.t("Quản lý URL")) {
                        TextField("https://...", text: $manageUrl)
                            .keyboardType(.URL)
                            .textInputAutocapitalization(.never)
                            .font(.system(size: 17))
                            .multilineTextAlignment(.trailing)
                    }
                    WVDivider()
                    fieldRow(L.t("Huỷ URL")) {
                        TextField("https://...", text: $cancelUrl)
                            .keyboardType(.URL)
                            .textInputAutocapitalization(.never)
                            .font(.system(size: 17))
                            .multilineTextAlignment(.trailing)
                    }
                }

                // Notes
                WVSectionHeader(L.t("Ghi chú"))
                WVGroup {
                    WVRowContainer {
                        TextField(L.t("Ghi chú thêm..."), text: $notes, axis: .vertical)
                            .font(.system(size: 17))
                            .lineLimit(3...6)
                    }
                }

                // Error
                if let topError {
                    Text(topError)
                        .font(.system(size: 13))
                        .foregroundStyle(WVColor.red)
                        .padding(.horizontal, WVSpacing.gutter)
                        .padding(.top, WVSpacing.sm)
                }

                // Submit button
                VStack(spacing: 0) {
                    Spacer().frame(height: WVSpacing.lg)
                    WVButton(
                        isEditing ? L.t("Lưu thay đổi") : L.t("Thêm gói"),
                        icon: isEditing ? "save" : "plus"
                    ) {
                        Task { await submit() }
                    }
                    .disabled(!isValid || isBusy)
                    .padding(.horizontal, WVSpacing.gutter)
                    Spacer().frame(height: WVSpacing.xl)
                }
            }
        }
        .wvScreen()
        .navigationTitle(isEditing ? L.t("Sửa gói") : L.t("Gói mới"))
        .navigationBarTitleDisplayMode(.inline)
        .task { await catalog.loadIfNeeded() }
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button(L.t("Huỷ")) { showDiscard = true }
                    .foregroundStyle(WVColor.tint)
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button(isEditing ? L.t("Lưu") : L.t("Thêm")) { Task { await submit() } }
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(isValid ? WVColor.tint : WVColor.label4)
                    .disabled(!isValid || isBusy)
            }
        }
        .alert(L.t("Bỏ thay đổi?"), isPresented: $showDiscard) {
            Button(L.t("Tiếp tục"), role: .cancel) {}
            Button(L.t("Bỏ"), role: .destructive) { dismiss() }
        }
        // Category picker sheet
        .sheet(isPresented: $showCatPicker) {
            SubCategoryPickerSheet(selected: $category)
        }
        // Cycle picker sheet
        .sheet(isPresented: $showCyclePicker) {
            SubCyclePickerSheet(selected: $billingCycle)
        }
    }

    // MARK: - Helpers

    private func fieldRow<F: View>(_ label: String, @ViewBuilder field: () -> F) -> some View {
        WVRowContainer {
            HStack {
                Text(label)
                    .font(.system(size: 17))
                    .foregroundStyle(WVColor.label)
                Spacer()
                field()
                    .foregroundStyle(WVColor.label3)
            }
        }
    }

    private func catalogCategoryName(_ code: String) -> String {
        catalog.categories.first(where: { $0.code == code })?.name ?? code.capitalized
    }

    // MARK: - Submit

    private func submit() async {
        topError = nil; leadDaysError = nil; trialError = nil; isBusy = true
        defer { isBusy = false }

        // Empty is the one locally reachable invalid schedule; the toolbar can
        // still fire while the button is disabled, and the server answers `[]`
        // with 400 `fieldErrors.leadDays`.
        guard let normalizedLeadDays = LeadDaysRules.wireValue(leadDays) else {
            topError = L.t("Chọn ít nhất 1 mốc nhắc")
            return
        }

        // Both dates come from a `DatePicker`, so they are zoned instants; the
        // wire wants the bare calendar day *the picker drew*. `WireDay` writes it
        // in the device's own zone — a UTC- or Vietnam-pinned format saves the day
        // before the one on screen for every device east of the pin.
        var input = SubscriptionInput(
            name: name,
            billingCycle: billingCycle,
            price: price ?? 0,
            startedAt: WireDay.string(from: startedAt)
        )
        input.category      = category.isEmpty ? nil : category
        input.brand         = brand.isEmpty ? nil : brand
        input.plan          = plan.isEmpty ? nil : plan
        input.intervalDays  = billingCycle == .CUSTOM ? Int(intervalDays) : nil
        input.renewalDate   = (hasRenewal && billingCycle != .LIFETIME)
            ? WireDay.string(from: renewalDate) : nil
        input.autoRenew     = autoRenew
        input.status        = subStatus
        input.accountEmail  = accountEmail.isEmpty ? nil : accountEmail
        input.paymentMethod = paymentMethod.isEmpty ? nil : paymentMethod
        input.manageUrl     = manageUrl.isEmpty ? nil : manageUrl
        input.cancelUrl     = cancelUrl.isEmpty ? nil : cancelUrl
        input.notes         = notes.isEmpty ? nil : notes
        input.leadDays      = normalizedLeadDays

        // Trial, as a pair. `SubscriptionTrialFields` drops the price when there
        // is no trial day, so the forbidden `convertsToPrice`-without-
        // `trialEndsAt` body cannot be built even if the view state is stale.
        let trial = SubscriptionTrialFields(
            trialEndsAt: hasTrial ? WireDay.string(from: trialEndsAt) : nil,
            convertsToPrice: hasTrial ? convertsToPrice : nil
        )
        SubscriptionTrial.apply(trial, to: &input)

        do {
            if let subscription {
                try await store.update(id: subscription.id, input)
                toast.show(L.t("Đã lưu"))
            } else {
                _ = try await store.create(input)
                toast.show(L.t("Đã thêm gói 🎉"))
            }
            dismiss()
        } catch let err as APIError {
            topError = err.localizedDescription
            leadDaysError = err.fieldErrors["leadDays"]?.first
            trialError = err.fieldErrors["convertsToPrice"]?.first
                ?? err.fieldErrors["trialEndsAt"]?.first
        } catch {
            topError = error.localizedDescription
        }
    }
}

// MARK: - Category picker sheet

private struct SubCategoryPickerSheet: View {
    @Binding var selected: String
    @EnvironmentObject private var catalog: CatalogStore
    @Environment(\.dismiss) private var dismiss

    private let subCategories = [
        ("streaming", "Streaming"), ("ai", "AI"), ("cloud", "Cloud"),
        ("music", L.t("Nhạc")), ("work", L.t("Công việc")), ("domain", "Domain"),
    ]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 0) {
                    Spacer().frame(height: WVSpacing.sm)
                    WVGroup {
                        let combined = subCategories.map { (code: $0.0, name: $0.1) }
                        ForEach(Array(combined.enumerated()), id: \.element.code) { idx, cat in
                            if idx > 0 { WVDivider(inset: 60) }
                            catRow(code: cat.code, name: cat.name)
                        }
                        WVDivider()
                        // Device categories from catalog
                        ForEach(Array(catalog.categories.enumerated()), id: \.element.id) { idx, c in
                            WVDivider(inset: 60)
                            catRow(code: c.code, name: c.name)
                        }
                    }
                    Spacer().frame(height: WVSpacing.xl)
                }
            }
            .wvScreen()
            .navigationTitle(L.t("Loại"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Xong") { dismiss() }
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundStyle(WVColor.tint)
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private func catRow(code: String, name: String) -> some View {
        Button {
            selected = code
            dismiss()
        } label: {
            HStack(spacing: 12) {
                WVLeadingIcon(icon: WVCategory.icon(for: code),
                              color: WVCategory.accent(for: code), size: 30)
                Text(name)
                    .font(.system(size: 17))
                    .foregroundStyle(WVColor.label)
                Spacer()
                if selected == code {
                    WVIcon("check", size: 16, weight: .bold).foregroundStyle(WVColor.tint)
                }
            }
            .padding(.horizontal, 16)
            .frame(minHeight: 44)
            .padding(.vertical, 4)
            .contentShape(Rectangle())
        }
        .buttonStyle(WVRowButtonStyle())
    }
}

// MARK: - Cycle picker sheet

private struct SubCyclePickerSheet: View {
    @Binding var selected: BillingCycle
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 0) {
                    Spacer().frame(height: WVSpacing.sm)
                    WVGroup {
                        ForEach(Array(BillingCycle.allCases.enumerated()), id: \.element) { idx, c in
                            if idx > 0 { WVDivider() }
                            Button {
                                selected = c
                                dismiss()
                            } label: {
                                HStack {
                                    Text(c.shortLabel)
                                        .font(.system(size: 17))
                                        .foregroundStyle(WVColor.label)
                                    Spacer()
                                    if selected == c {
                                        WVIcon("check", size: 16, weight: .bold)
                                            .foregroundStyle(WVColor.tint)
                                    }
                                }
                                .padding(.horizontal, 16)
                                .frame(minHeight: 44)
                                .padding(.vertical, 4)
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(WVRowButtonStyle())
                        }
                    }
                    Spacer().frame(height: WVSpacing.xl)
                }
            }
            .wvScreen()
            .navigationTitle(L.t("Chu kỳ"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Xong") { dismiss() }
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundStyle(WVColor.tint)
                }
            }
        }
        .presentationDetents([.medium])
    }
}
