import SwiftUI
import WarrlyKit

// MARK: - SubscriptionFormView

struct SubscriptionFormView: View {
    let client: APIClient
    @ObservedObject var store: SubscriptionsStore
    var subscription: Subscription?          // nil → create
    /// `true` when this form is the root of a sheet's own `NavigationStack`:
    /// the sheet shows Huỷ / Thêm and no back chevron; a pushed form keeps the
    /// system back button as its only leading control. See `DeviceFormView`.
    private let presentedAsSheet: Bool

    @EnvironmentObject private var catalog: CatalogStore
    @EnvironmentObject private var toast:   WVToastCenter
    @Environment(\.dismiss) private var dismiss
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

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
    /// `true` once a person has picked a renewal date by hand (or the form is
    /// editing a stored subscription). Until then the date is the server's own
    /// derivation and follows `startedAt` / `billingCycle` / `intervalDays`.
    @State private var renewalDateIsUserSet: Bool
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

    // MARK: - Derived money and date

    /// The custom cycle's interval, when it parses. The server enforces 1…3650;
    /// the form only needs a positive number to be able to derive a date.
    private var parsedIntervalDays: Int? {
        billingCycle == .CUSTOM ? Int(intervalDays) : nil
    }

    /// The monthly equivalent of what is typed, when there is one to show.
    ///
    /// Lifetime has no monthly cost and an empty custom interval has no divisor,
    /// so both hide the row instead of printing a `0 ₫` that would claim the plan
    /// is free.
    private var monthlyEquivalent: Int? {
        guard let price, price > 0 else { return nil }
        let monthly = SubscriptionBilling.monthlyEquivalent(
            price: price,
            cycle: billingCycle,
            intervalDays: parsedIntervalDays
        )
        return monthly > 0 ? monthly : nil
    }

    /// The rule the server itself applies when a create omits `renewalDate`
    /// (`services/subscriptions.go:268-271`). Shown in the picker on create, so
    /// "when does it charge me" has an answer before the save — and so the
    /// default can never be today, which the daily cron would turn into a
    /// payment that never happened.
    private var derivedRenewalDate: Date? {
        SubscriptionBilling.nextRenewalDate(
            from: startedAt,
            cycle: billingCycle,
            intervalDays: parsedIntervalDays
        )
    }

    /// The picker writes through this binding, so a date the user chose is never
    /// overwritten when they then change the cycle or the start date. The
    /// programmatic seeds in `init` / `syncRenewalDate` do not go through it.
    private var renewalDateBinding: Binding<Date> {
        Binding(
            get: { renewalDate },
            set: {
                renewalDate = $0
                renewalDateIsUserSet = true
            }
        )
    }

    /// Keep the seeded date in step with the inputs it was derived from.
    ///
    /// Create only, and only until the user picks a date: editing a stored
    /// subscription must not silently move a real renewal date, and a deliberate
    /// choice must survive a later cycle change.
    private func syncRenewalDate() {
        guard !isEditing, !renewalDateIsUserSet, hasRenewal,
              let derived = derivedRenewalDate else { return }
        renewalDate = derived
    }

    // MARK: - Plan suggestions

    /// Common services sold in Vietnam. A plan is free text — "Spotify Premium
    /// Family", "ChatGPT Plus" and a gym membership are all valid — so these are
    /// chips that fill the field, never a picker that limits it. The list is
    /// deliberately short: it is a starting point, not a catalog.
    private static let commonPlanSuggestions = [
        "Netflix", "Spotify Premium", "YouTube Premium", "Apple One",
        "Apple Music", "iCloud+", "Google One", "ChatGPT Plus", "Claude Pro",
        "Microsoft 365", "Canva Pro", "Adobe Creative Cloud", "FPT Play",
        "Galaxy Play", "VieON", "TV360", "Zing MP3", "GrabUnlimited", "ShopeeVIP",
    ]

    /// Filtered by what is already typed. With an empty field the first few
    /// services are offered; once the user types something that matches nothing
    /// the chips disappear and the field is simply text again.
    private var planSuggestions: [String] {
        let query = plan.trimmingCharacters(in: .whitespaces).lowercased()
        let pool = query.isEmpty
            ? Self.commonPlanSuggestions
            : Self.commonPlanSuggestions.filter { $0.lowercased().contains(query) }
        return Array(pool.prefix(8))
    }

    // MARK: - Screenshot QA

    /// Where the form starts scrolled. `.top` in every build; the
    /// `WV_QA_SUB_SCROLL=cost` launch value starts mid-form so the cost block can
    /// be photographed headlessly. See the modifier in `body`.
    private static var initialScrollAnchor: UnitPoint {
#if DEBUG
        if ProcessInfo.processInfo.environment["WV_QA_SUB_SCROLL"] == "cost" {
            // Slightly above centre: puts the price/monthly/cycle/date block in
            // the viewport without clipping the row above it under the bar.
            return UnitPoint(x: 0.5, y: 0.435)
        }
#endif
        return .top
    }

    // MARK: - Init

    init(client: APIClient, store: SubscriptionsStore, subscription: Subscription? = nil,
         presentedAsSheet: Bool = false) {
        self.client       = client
        self.store        = store
        self.subscription = subscription
        self.presentedAsSheet = presentedAsSheet

        let sub = subscription

        // Screenshot-QA only (DEBUG): the simulator cannot type or tap
        // headlessly, so the create-form shots prefill the two fields this screen
        // exists to make visible. Never applied while editing, never compiled
        // into Release.
#if DEBUG
        let qaEnv = sub == nil ? ProcessInfo.processInfo.environment : [:]
        let qaPrice = qaEnv["WV_QA_SUB_PRICE"].flatMap(Int.init)
        let qaCycle = qaEnv["WV_QA_SUB_CYCLE"].flatMap(BillingCycle.init(rawValue:))
        let qaRenewalOff = qaEnv["WV_QA_SUB_RENEWAL"] == "0"
#else
        let qaPrice: Int? = nil
        let qaCycle: BillingCycle? = nil
        let qaRenewalOff = false
#endif

        let initialCycle = qaCycle ?? sub?.billingCycle ?? .MONTHLY
        let initialStart = sub?.startedAt ?? Date()
        // Seed the date from the server's own rule, not from `Date()`. The old
        // `Date()` default handed the daily cron an already-due renewal: a
        // user could toggle the row on, accept it, and the next pass would write
        // a `SubscriptionPayment` for money that was never taken.
        let derivedRenewal = SubscriptionBilling.nextRenewalDate(
            from: initialStart,
            cycle: initialCycle,
            intervalDays: sub?.intervalDays
        )

        _name          = State(initialValue: sub?.name ?? "")
        _brand         = State(initialValue: sub?.brand ?? "")
        _plan          = State(initialValue: sub?.plan ?? "")
        // No category is preselected. The old "ai" default was a value the user
        // never chose: every untouched subscription claimed to be AI, which made
        // the audit's brand+category duplicate rule report Apple One + iCloud+
        // as "you may be paying twice". An empty category is a valid
        // subscription and is excluded from that rule.
        _category      = State(initialValue: sub?.category ?? "")
        _price         = State(initialValue: qaPrice ?? sub?.price)
        _billingCycle  = State(initialValue: initialCycle)
        _intervalDays  = State(initialValue: sub?.intervalDays.map { String($0) } ?? "")
        _startedAt     = State(initialValue: initialStart)
        _renewalDate   = State(initialValue: sub?.renewalDate ?? derivedRenewal ?? initialStart)
        // On create the toggle starts on, with the date above already filled
        // from the cycle; on edit it reflects the stored row. The row stays
        // hidden for a lifetime plan, which never renews.
        _hasRenewal    = State(initialValue:
            !qaRenewalOff && (sub != nil || initialCycle != .LIFETIME))
        _renewalDateIsUserSet = State(initialValue: sub != nil)
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
                        TextField("Apple One...", text: $name)
                            .wvFont(.body)
                            .multilineTextAlignment(.trailing)
                    }
                    WVDivider()
                    fieldRow(L.t("Hãng")) {
                        TextField("Apple...", text: $brand)
                            .wvFont(.body)
                            .multilineTextAlignment(.trailing)
                    }
                    WVDivider()
                    fieldRow(L.t("Gói")) {
                        TextField("Family...", text: $plan)
                            .wvFont(.body)
                            .multilineTextAlignment(.trailing)
                    }
                    if !planSuggestions.isEmpty {
                        WVDivider()
                        // Tapping a suggestion is a suggestion, not a selection:
                        // the value goes into the same editable field. If the
                        // required name is still empty, the picked service fills
                        // it too, so the chip is a usable starting point rather
                        // than a plan with no subscription behind it.
                        AutocompleteChips(suggestions: planSuggestions, text: $plan) { picked in
                            if name.trimmingCharacters(in: .whitespaces).isEmpty {
                                name = picked
                            }
                        }
                    }
                    WVDivider()
                    // Category picker trigger
                    Button { showCatPicker = true } label: {
                        HStack {
                            Text(L.t("Loại"))
                                .wvFont(.body)
                                .foregroundStyle(WVColor.label)
                            Spacer()
                            HStack(spacing: 6) {
                                if !category.isEmpty {
                                    WVLeadingIcon(
                                        icon: WVCategory.icon(for: category),
                                        color: WVCategory.accent(for: category),
                                        size: 22
                                    )
                                }
                                Text(category.isEmpty
                                     ? L.t("Chưa chọn")
                                     : catalogCategoryName(category))
                                    .wvFont(.body)
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
                WVSectionFooter(L.t("Gợi ý dịch vụ phổ biến — bạn vẫn có thể nhập bất kỳ gói nào."))

                // Cost
                WVSectionHeader(L.t("Chi phí"))
                WVGroup {
                    fieldRow(L.t("Giá / chu kỳ")) {
                        WVMoneyField(value: $price)
                            .frame(width: 150)
                    }
                    // The division the form used to leave to the user: a yearly
                    // price shown as what it costs per month, updated as the
                    // price and cycle change. Read-only, so it costs no taps.
                    if let monthlyEquivalent {
                        WVDivider()
                        WVRowContainer {
                            Text(L.t("~ %@ / tháng", WVFormat.vnd(monthlyEquivalent)))
                                .wvFont(.footnote)
                                .foregroundStyle(WVColor.label3)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        .accessibilityElement(children: .combine)
                    }
                    WVDivider()
                    Button { showCyclePicker = true } label: {
                        HStack {
                            Text(L.t("Chu kỳ"))
                                .wvFont(.body)
                                .foregroundStyle(WVColor.label)
                            Spacer()
                            Text(billingCycle.shortLabel)
                                .wvFont(.body)
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
                        datePickerRow(L.t("Bắt đầu"), selection: $startedAt)
                    }
                    if billingCycle != .LIFETIME {
                        WVDivider()
                        WVRowContainer {
                            Toggle(L.t("Có ngày gia hạn"), isOn: $hasRenewal)
                                .wvFont(.body)
                                .onChange(of: hasRenewal) { _, isOn in
                                    // Turning it back on re-seeds from the cycle
                                    // rather than leaving the old picker where it
                                    // was — unless the user picked a date by hand.
                                    if isOn { syncRenewalDate() }
                                }
                        }
                        if hasRenewal {
                            WVDivider()
                            if derivedRenewalDate != nil {
                                WVRowContainer {
                                    datePickerRow(L.t("Gia hạn kế"),
                                                  selection: renewalDateBinding)
                                }
                            } else {
                                // A custom cycle with no interval yet. Say what
                                // is missing instead of opening the picker on
                                // today, which the daily cron would later read as
                                // an overdue renewal and bill.
                                WVRowContainer {
                                    Text(L.t("Nhập số ngày / chu kỳ để tính ngày gia hạn."))
                                        .wvFont(.footnote)
                                        .foregroundStyle(WVColor.label3)
                                        .fixedSize(horizontal: false, vertical: true)
                                }
                            }
                        }
                    }
                    WVDivider()
                    WVRowContainer {
                        Toggle(L.t("Tự gia hạn"), isOn: $autoRenew)
                            .wvFont(.body)
                    }
                    if billingCycle == .CUSTOM {
                        WVDivider()
                        fieldRow(L.t("Số ngày / chu kỳ")) {
                            TextField("30", text: $intervalDays)
                                .keyboardType(.numberPad)
                                .wvFont(.body)
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
                            .wvFont(.body)
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
                                .wvFont(.body)
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
                                .wvFont(.caption)
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
                            .wvFont(.body)
                            .multilineTextAlignment(.trailing)
                    }
                    WVDivider()
                    fieldRow(L.t("Thanh toán")) {
                        TextField("Visa **4242, Momo...", text: $paymentMethod)
                            .wvFont(.body)
                            .multilineTextAlignment(.trailing)
                    }
                    WVDivider()
                    fieldRow(L.t("Quản lý URL")) {
                        TextField("https://...", text: $manageUrl)
                            .keyboardType(.URL)
                            .textInputAutocapitalization(.never)
                            .wvFont(.body)
                            .multilineTextAlignment(.trailing)
                    }
                    WVDivider()
                    fieldRow(L.t("Huỷ URL")) {
                        TextField("https://...", text: $cancelUrl)
                            .keyboardType(.URL)
                            .textInputAutocapitalization(.never)
                            .wvFont(.body)
                            .multilineTextAlignment(.trailing)
                    }
                }

                // Notes
                WVSectionHeader(L.t("Ghi chú"))
                WVGroup {
                    WVRowContainer {
                        TextField(L.t("Ghi chú thêm..."), text: $notes, axis: .vertical)
                            .wvFont(.body)
                            .lineLimit(3...6)
                    }
                }

                // Error
                if let topError {
                    Text(topError)
                        .wvFont(.footnote)
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
            // Pin the form to the scroll view's width. Without this a long
            // placeholder or a date row reports an ideal width wider than the
            // phone at AX sizes, the whole card is laid out at that width and
            // centred, and every row's leading edge is pushed off-screen — the
            // same guard `DeviceFormView` already has.
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .wvScreen()
        .navigationTitle(isEditing ? L.t("Sửa gói") : L.t("Gói mới"))
        .navigationBarTitleDisplayMode(.inline)
        // As a sheet root there is nothing to go back to: Huỷ is the leading
        // control and any inherited back chevron is hidden. Pushed from a tab,
        // the system back button is the only leading control.
        .navigationBarBackButtonHidden(presentedAsSheet)
        // Screenshot-QA only: the charge-date control sits below the fold at the
        // default text size and the simulator cannot be scrolled headlessly.
        // `.top` is the normal behaviour; the QA value just starts the form
        // mid-way so the cost block can be photographed. DEBUG-only, like
        // `WV_QA_NEW_SUBSCRIPTION`.
        .defaultScrollAnchor(Self.initialScrollAnchor)
        .task { await catalog.loadIfNeeded() }
        // The seeded renewal date follows the inputs it is derived from. The
        // handlers live here, not on each control, so the cycle sheet, the date
        // picker and the custom-interval field all take the same path.
        .onChange(of: startedAt) { _, _ in syncRenewalDate() }
        .onChange(of: billingCycle) { _, _ in syncRenewalDate() }
        .onChange(of: intervalDays) { _, _ in syncRenewalDate() }
        .toolbar {
            if presentedAsSheet {
                ToolbarItem(placement: .topBarLeading) {
                    Button(L.t("Huỷ")) { showDiscard = true }
                        .foregroundStyle(WVColor.tint)
                }
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button(isEditing ? L.t("Lưu") : L.t("Thêm")) { Task { await submit() } }
                    .wvFont(.bodyEmphasis)
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
            // At Accessibility sizes the label and a real placeholder cannot
            // share a line: "Apple One, ChatGPT Plus..." alone is wider than
            // the phone, and an HStack cannot compress a TextField below its
            // content width — it widened the whole form past the screen. The
            // device form's `inputRow` stacks for the same reason.
            if dynamicTypeSize.isAccessibilitySize {
                VStack(alignment: .leading, spacing: 4) {
                    Text(label)
                        .wvFont(.body)
                        .foregroundStyle(WVColor.label)
                    field()
                        .foregroundStyle(WVColor.label3)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        // A TextField's placeholder sets its ideal width; at AX
                        // sizes "Apple One, ChatGPT Plus..." is wider than the
                        // phone. Deprioritising the field lets the label and the
                        // row's width win, so the form cannot widen past the
                        // screen.
                        .layoutPriority(-1)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                HStack {
                    Text(label)
                        .wvFont(.body)
                        .foregroundStyle(WVColor.label)
                    Spacer()
                    field()
                        .foregroundStyle(WVColor.label3)
                        // A TextField reports its placeholder's width as its
                        // ideal width; take the row's remaining width instead.
                        .frame(maxWidth: .infinity, alignment: .trailing)
                        .layoutPriority(-1)
                }
            }
        }
    }

    /// A date row that stacks at Accessibility sizes.
    ///
    /// The compact `DatePicker` draws its label and the full Vietnamese date
    /// ("ngày 31 thg 10, 2026") on one line; at AX3 that pair is wider than the
    /// phone, and an HStack cannot compress it — the form's whole content width
    /// grew with it. Stacking the label above a label-less picker keeps both
    /// readable inside the screen.
    @ViewBuilder
    private func datePickerRow(_ label: String, selection: Binding<Date>) -> some View {
        if dynamicTypeSize.isAccessibilitySize {
            VStack(alignment: .leading, spacing: 6) {
                Text(label)
                    .wvFont(.body)
                    .foregroundStyle(WVColor.label)
                DatePicker("", selection: selection, displayedComponents: .date)
                    .labelsHidden()
                    .wvFont(.body)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        } else {
            DatePicker(label, selection: selection, displayedComponents: .date)
                .wvFont(.body)
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
        } catch {
            // Same classifier as the device form: never a raw wire code, and a
            // 5xx / transport failure says the request did not complete.
            let failure = FormErrorCopy.presentation(
                for: error,
                limitFallback: L.t("Đã đạt giới hạn gói đăng ký. Xoá bớt rồi thử lại.")
            )
            topError = failure.headline
            leadDaysError = failure.fieldErrors["leadDays"]?.first
            trialError = failure.fieldErrors["convertsToPrice"]?.first
                ?? failure.fieldErrors["trialEndsAt"]?.first
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
                        .wvFont(.bodyEmphasis)
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
                    .wvFont(.body)
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
                                        .wvFont(.body)
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
                        .wvFont(.bodyEmphasis)
                        .foregroundStyle(WVColor.tint)
                }
            }
        }
        .presentationDetents([.medium])
    }
}
