import SwiftUI
import WarrlyKit

// ============================================================
// BulkDeviceAddView — "Thêm nhiều thiết bị"
//
// ## The shape this screen is built for
//
// The primary user is the person who has just moved into a flat and bought
// five appliances at once — fridge, washing machine, air conditioner, TV,
// kitchen appliances. They share a purchase day (roughly), they are entered in
// one sitting, and the thing that makes the batch die is retyping the same form
// five times.
//
// So every row is the **minimum a device needs**:
//
//     name · category · purchase date · price
//
// and the batch is optimised for that shape: a new row inherits the previous
// row's purchase date (the date is the one value that really does repeat), the
// category is picked from the same catalog as the single-device form, and the
// price is entered in VND only. Everything else — brand, model, serial/IMEI,
// purchase place, notes, warranty package, activation, return window, resale,
// brand-warranty lookup, foreign currency/FX rate, attachments — belongs to the
// device form/detail. Putting those here would recreate the long form once per
// row, which is the problem this feature exists to solve.
//
// A shop entering a customer's order was the other candidate shape. It is not
// this screen: an order needs serials, customer/buyer fields, per-item warranty
// terms and often a different currency, so the four-field row would be wrong
// for it. The bulk endpoint creates the signed-in user's own devices anyway.
//
// ## Partial success
//
// Created rows leave the draft (they are already in the account and the shared
// `DevicesStore`), failed rows stay and keep the server's **own** field errors,
// keyed by row id — never by list position. "Gửi lại" therefore sends only the
// rows the server rejected. The success card says how many were added.
//
// ## The 409
//
// A quota rejection created nothing. It is shown as its own card, the draft is
// left untouched, and the card states how many more active devices the account
// can take (from `DeviceQuota`, after refreshing the list).
// ============================================================

struct BulkDeviceAddView: View {
    @ObservedObject var store: DevicesStore

    @EnvironmentObject private var catalog: CatalogStore
    /// The one-time notification rationale, offered when a batch is the first
    /// thing the account ever created (see the alert below).
    @EnvironmentObject private var push: PushRegistrar
    @Environment(\.dismiss) private var dismiss

    // Draft state. Never empty: removing the last row leaves a fresh blank one.
    @State private var rows: [BulkDeviceRow]

    // Per-row server/local errors, keyed by the row's stable id. This is the
    // whole point of the reconciliation: a row keeps its errors even when the
    // array shrinks and the visible "Thiết bị N" numbers change.
    @State private var rowErrors: [UUID: [String: [String]]] = [:]
    @State private var rowMessages: [UUID: String] = [:]
    @State private var rowStatus: [UUID: RowStatus] = [:]

    // Batch-level state.
    @State private var topError: String?
    @State private var limitReached = false
    @State private var limitServerMessage: String?
    @State private var limitQuota: DeviceQuotaCapacity?

    // Results accumulated across retries while this screen is open.
    @State private var createdTotal = 0
    @State private var createdNames: [String] = []
    @State private var unconfirmedCount = 0

    @State private var isSubmitting = false
    @State private var categoryTarget: CategoryTarget?
    @State private var scrollToTopToken = 0
    /// The one-time rationale before the system notification prompt. A batch can
    /// be the first thing the account ever creates, and it is just as much a
    /// "device save" as the single form.
    @State private var showNotificationPrimer = false

    private static let topAnchorID = "bulkDeviceAddTop"

    private enum RowStatus: Equatable {
        case failed
        case unconfirmed
    }

    private struct CategoryTarget: Identifiable {
        let id: UUID
    }

    init(store: DevicesStore) {
        self.store = store
        _rows = State(initialValue: [BulkDeviceRules.newRow()])
    }

    // MARK: - Body

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    Color.clear
                        .frame(height: 1)
                        .id(Self.topAnchorID)

                    if createdTotal > 0 && !rows.isEmpty {
                        successCard
                    }
                    if limitReached {
                        limitCard
                    }
                    if let topError {
                        batchErrorCard(topError)
                    }

                    intro

                    VStack(spacing: 10) {
                        ForEach(Array(rows.enumerated()), id: \.element.id) { index, row in
                            rowCard(index: index, row: row)
                        }
                    }
                    .padding(.top, 14)

                    addRowButton

                    if BulkDeviceRules.canAddRow(rows) {
                        WVSectionFooter(BulkDeviceCopy.newRowInheritsDate)
                    } else {
                        WVSectionFooter(BulkDeviceCopy.rowLimit)
                    }

                    Spacer().frame(height: 24)
                }
            }
            .scrollDismissesKeyboard(.interactively)
            .onChange(of: scrollToTopToken) { _, _ in
                withAnimation { proxy.scrollTo(Self.topAnchorID, anchor: .top) }
            }
        }
        .wvScreen()
        .navigationTitle(BulkDeviceCopy.title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                if isSubmitting {
                    ProgressView()
                } else {
                    Button(L.t("Thêm")) {
                        Task { await submit() }
                    }
                    .wvFont(.bodyEmphasis)
                    .foregroundStyle(WVColor.tint)
                }
            }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            submitBar
        }
        .sheet(item: $categoryTarget) { target in
            if rows.contains(where: { $0.id == target.id }) {
                CategoryPickerSheet(
                    selected: binding(target.id, \.category,
                                      fallback: BulkDeviceRules.defaultCategory,
                                      field: "category"),
                    options: categoryOptions
                )
            }
        }
        .task { await catalog.loadIfNeeded() }
        // The rationale comes before the system prompt, always. An alert is the
        // right shape here because this screen is about to dismiss itself: there
        // is no surface left for an inline card, and the answer decides whether
        // the system prompt is raised at all. The wording is the same as the
        // single-device form's card.
        .alert(L.t("Bật nhắc nhở?"), isPresented: $showNotificationPrimer) {
            Button(L.t("Bật thông báo")) {
                Task {
                    await push.requestAndRegister()
                    dismiss()
                }
            }
            Button(L.t("Để sau"), role: .cancel) { dismiss() }
        } message: {
            Text(L.t("Bật nhắc nhở để Warrly báo trước khi hết bảo hành hoặc tới hạn đổi trả. Thông báo chỉ dùng cho việc đó — không gửi khuyến mãi."))
        }
    }

    // MARK: - Copy / derived

    private var categoryOptions: [CategoryOption] {
        if !catalog.categories.isEmpty { return catalog.categories }
        // The catalog read is best-effort. Falling back to the static table
        // keeps the picker usable on a cold/offline launch, with uppercase
        // codes — the server compares `code = $1` exactly.
        return CategoryLabels.table
            .map { CategoryOption(code: $0.key, name: CategoryLabels.label(for: $0.key)) }
            .sorted { $0.name.localizedCompare($1.name) == .orderedAscending }
    }

    private func categoryLabel(_ code: String) -> String {
        categoryOptions.first(where: { $0.code.caseInsensitiveCompare(code) == .orderedSame })?.name
            ?? CategoryLabels.label(for: code)
    }

    private var createdNamesLine: String {
        let visible = createdNames.prefix(6)
        var line = visible.joined(separator: ", ")
        if createdNames.count > visible.count {
            line += " · " + BulkDeviceCopy.moreDevices(createdNames.count - visible.count)
        }
        return line
    }

    // MARK: - Cards

    private var intro: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(BulkDeviceCopy.intro)
                .wvFont(.subheadline)
                .foregroundStyle(WVColor.label2)
                .fixedSize(horizontal: false, vertical: true)
            Text(BulkDeviceCopy.priceNote)
                .wvFont(.caption)
                .foregroundStyle(WVColor.label3)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, WVSpacing.titleGutter)
        .padding(.top, 16)
    }

    /// "Đã thêm N thiết bị" + the rows that still need work.
    private var successCard: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                WVIcon("checkCircle", size: 16)
                    .foregroundStyle(WVColor.green)
                Text(BulkDeviceCopy.created(createdTotal))
                    .wvFont(.subheadlineEmphasis)
                    .foregroundStyle(WVColor.label)
            }
            if !createdNames.isEmpty {
                Text(createdNamesLine)
                    .wvFont(.footnote)
                    .foregroundStyle(WVColor.label3)
                    .lineLimit(2)
            }
            Text(BulkDeviceCopy.rowsToFix(rows.count))
                .wvFont(.footnoteEmphasis)
                .foregroundStyle(WVColor.label2)
            Text(BulkDeviceCopy.retryNote)
                .wvFont(.caption)
                .foregroundStyle(WVColor.label3)
                .fixedSize(horizontal: false, vertical: true)
            if unconfirmedCount > 0 {
                Text(BulkDeviceCopy.unconfirmedNote)
                    .wvFont(.caption)
                    .foregroundStyle(WVColor.orange)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(WVColor.green.opacity(0.10))
        .clipShape(RoundedRectangle(cornerRadius: WVRadius.card, style: .continuous))
        .padding(.horizontal, WVSpacing.gutter)
        .padding(.top, 12)
    }

    /// The whole-batch 409. Nothing was created; the draft is still on screen
    /// below, and the remaining capacity is stated so "what do I do now" has a
    /// number in it.
    private var limitCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                WVIcon("alert", size: 15)
                    .foregroundStyle(WVColor.red)
                Text(BulkDeviceCopy.limitTitle)
                    .wvFont(.subheadlineEmphasis)
                    .foregroundStyle(WVColor.label)
            }
            Text(BulkDeviceCopy.limitBody)
                .wvFont(.footnote)
                .foregroundStyle(WVColor.label2)
                .fixedSize(horizontal: false, vertical: true)

            if let quota = limitQuota {
                if quota.isFull {
                    Text(BulkDeviceCopy.quotaFull)
                        .wvFont(.footnoteEmphasis)
                        .foregroundStyle(WVColor.label)
                        .fixedSize(horizontal: false, vertical: true)
                } else {
                    Text(BulkDeviceCopy.remaining(quota.remaining))
                        .wvFont(.footnoteEmphasis)
                        .foregroundStyle(WVColor.label)
                    let overflow = max(0, rows.count - quota.remaining)
                    if overflow > 0 {
                        Text(BulkDeviceCopy.overflow(overflow))
                            .wvFont(.footnote)
                            .foregroundStyle(WVColor.red)
                    } else {
                        Text(BulkDeviceCopy.capacityStale)
                            .wvFont(.caption)
                            .foregroundStyle(WVColor.label3)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            } else {
                Text(BulkDeviceCopy.capacityUnknown)
                    .wvFont(.caption)
                    .foregroundStyle(WVColor.label3)
                    .fixedSize(horizontal: false, vertical: true)
            }

            if let limitServerMessage, !limitServerMessage.isEmpty {
                Text(limitServerMessage)
                    .wvFont(.caption)
                    .foregroundStyle(WVColor.label3)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(WVColor.red.opacity(0.08))
        .clipShape(RoundedRectangle(cornerRadius: WVRadius.card, style: .continuous))
        .padding(.horizontal, WVSpacing.gutter)
        .padding(.top, 12)
    }

    /// A batch-level error (the 50-row 400, transport, decoding). Not attached
    /// to a row because no single row can fix it.
    private func batchErrorCard(_ message: String) -> some View {
        HStack(alignment: .top, spacing: 8) {
            WVIcon("alert", size: 14)
                .foregroundStyle(WVColor.red)
            Text(message)
                .wvFont(.footnote)
                .foregroundStyle(WVColor.red)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(WVColor.red.opacity(0.08))
        .clipShape(RoundedRectangle(cornerRadius: WVRadius.card, style: .continuous))
        .padding(.horizontal, WVSpacing.gutter)
        .padding(.top, 12)
    }

    // MARK: - Row card

    private func rowCard(index: Int, row: BulkDeviceRow) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 8) {
                Text(BulkDeviceCopy.rowTitle(index + 1))
                    .wvFont(.footnoteEmphasis)
                    .foregroundStyle(WVColor.label3)

                if let status = rowStatus[row.id] {
                    WVChip(status == .unconfirmed
                               ? BulkDeviceCopy.unconfirmedChip
                               : BulkDeviceCopy.needsFixChip,
                           tone: status == .unconfirmed ? .orange : .red)
                }

                Spacer()

                Button {
                    removeRow(row.id)
                } label: {
                    WVIcon("trash", size: 14)
                        .foregroundStyle(WVColor.label3)
                        .frame(width: 32, height: 32)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(BulkDeviceCopy.removeRow)
                .disabled(isSubmitting)
            }
            .padding(.horizontal, 16)
            .padding(.top, 6)
            .padding(.bottom, 2)

            WVDivider()

            fieldRow(BulkDeviceCopy.nameLabel) {
                TextField(BulkDeviceCopy.namePlaceholder, text: textBinding(row.id, \.name, field: "name"))
                    .wvFont(.body)
                    .multilineTextAlignment(.trailing)
                    .textInputAutocapitalization(.words)
                    .autocorrectionDisabled()
                    .frame(maxWidth: .infinity, alignment: .trailing)
                    .disabled(isSubmitting)
            }
            fieldError(rowErrors[row.id]?["name"])

            WVDivider()

            Button {
                categoryTarget = CategoryTarget(id: row.id)
            } label: {
                HStack(spacing: 8) {
                    Text(BulkDeviceCopy.categoryLabel)
                        .wvFont(.body)
                        .foregroundStyle(WVColor.label)
                    Spacer(minLength: 8)
                    WVLeadingIcon(
                        icon: WVCategory.icon(for: row.category),
                        color: WVCategory.accent(for: row.category),
                        size: 22
                    )
                    Text(categoryLabel(row.category))
                        .wvFont(.body)
                        .foregroundStyle(WVColor.label3)
                        .lineLimit(1)
                    WVIcon("arrowRight", size: 12)
                        .foregroundStyle(WVColor.label4)
                }
                .padding(.horizontal, 16)
                .frame(minHeight: 44)
                .padding(.vertical, 4)
                .contentShape(Rectangle())
            }
            .buttonStyle(WVRowButtonStyle())
            .disabled(isSubmitting)
            fieldError(rowErrors[row.id]?["category"])

            WVDivider()

            HStack(spacing: 12) {
                Text(BulkDeviceCopy.purchaseDateLabel)
                    .wvFont(.body)
                    .foregroundStyle(WVColor.label)
                Spacer()
                DatePicker("", selection: dateBinding(row.id), displayedComponents: .date)
                    .labelsHidden()
                    .disabled(isSubmitting)
            }
            .padding(.horizontal, 16)
            .frame(minHeight: 44)
            .padding(.vertical, 4)
            fieldError(rowErrors[row.id]?["purchaseDate"])

            WVDivider()

            HStack(spacing: 10) {
                Text(BulkDeviceCopy.priceLabel)
                    .wvFont(.body)
                    .foregroundStyle(WVColor.label)
                Spacer(minLength: 8)
                WVMoneyField(value: priceBinding(row.id))
                    .frame(width: 150)
                    .disabled(isSubmitting)
                Text("₫")
                    .wvFont(.subheadline)
                    .foregroundStyle(WVColor.label3)
            }
            .padding(.horizontal, 16)
            .frame(minHeight: 44)
            .padding(.vertical, 4)
            fieldError(rowErrors[row.id]?["purchasePrice"])

            if !otherFieldErrors(row.id).isEmpty || rowMessages[row.id] != nil {
                WVDivider()
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(Array(otherFieldErrors(row.id).enumerated()), id: \.offset) { _, message in
                        Text(message)
                            .wvFont(.caption)
                            .foregroundStyle(WVColor.red)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    if let message = rowMessages[row.id] {
                        Text(message)
                            .wvFont(.caption)
                            .foregroundStyle(WVColor.red)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 16)
                .padding(.top, 6)
                .padding(.bottom, 10)
            }
        }
        .background(WVColor.bg2)
        .clipShape(RoundedRectangle(cornerRadius: WVRadius.list, style: .continuous))
        .padding(.horizontal, WVSpacing.gutter)
    }

    @ViewBuilder
    private func fieldRow<Content: View>(_ label: String,
                                         @ViewBuilder content: () -> Content) -> some View {
        HStack(spacing: 10) {
            Text(label)
                .wvFont(.body)
                .foregroundStyle(WVColor.label)
            Spacer(minLength: 8)
            content()
        }
        .padding(.horizontal, 16)
        .frame(minHeight: 44)
        .padding(.vertical, 4)
    }

    @ViewBuilder
    private func fieldError(_ messages: [String]?) -> some View {
        if let message = messages?.first {
            Text(message)
                .wvFont(.caption)
                .foregroundStyle(WVColor.red)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 16)
                .padding(.bottom, 6)
        }
    }

    private func otherFieldErrors(_ id: UUID) -> [String] {
        let known: Set<String> = ["name", "category", "purchaseDate", "purchasePrice"]
        return (rowErrors[id] ?? [:])
            .filter { !known.contains($0.key) }
            .sorted { $0.key < $1.key }
            .flatMap { $0.value }
    }

    private var addRowButton: some View {
        Button {
            guard !isSubmitting else { return }
            withAnimation { rows = BulkDeviceRules.appendingRow(to: rows) }
        } label: {
            HStack(spacing: 8) {
                WVIcon("plus", size: 15)
                Text(BulkDeviceCopy.addRow)
                    .wvFont(.calloutEmphasis)
                Spacer()
                Text(BulkDeviceCopy.rowCount(rows.count))
                    .wvFont(.footnote)
                    .foregroundStyle(WVColor.label3)
            }
            .foregroundStyle(BulkDeviceRules.canAddRow(rows) ? WVColor.tint : WVColor.label3)
            .padding(.horizontal, 16)
            .frame(minHeight: 48)
            .background(WVColor.bg2)
            .clipShape(RoundedRectangle(cornerRadius: WVRadius.list, style: .continuous))
            .padding(.horizontal, WVSpacing.gutter)
            .padding(.top, 4)
        }
        .buttonStyle(WVRowButtonStyle())
        .disabled(!BulkDeviceRules.canAddRow(rows) || isSubmitting)
    }

    private var submitBar: some View {
        VStack(spacing: 0) {
            Divider()
            WVButton(BulkDeviceCopy.submit(rows.count), icon: "plus") {
                Task { await submit() }
            }
            .disabled(isSubmitting)
            .opacity(isSubmitting ? 0.55 : 1)
            .padding(.horizontal, WVSpacing.gutter)
            .padding(.vertical, 10)
        }
        .background(.ultraThinMaterial)
    }

    // MARK: - Row mutations

    private func removeRow(_ id: UUID) {
        guard !isSubmitting else { return }
        withAnimation {
            rows = BulkDeviceRules.removingRow(id: id, from: rows)
            rowErrors[id] = nil
            rowMessages[id] = nil
            rowStatus[id] = nil
        }
    }

    /// A binding that writes through the row's id rather than its index.
    ///
    /// The index is not stable across a reconciliation or a removal, and a
    /// binding captured for a row that has moved would edit a different device.
    /// Editing a field also clears that field's stale server error.
    private func binding<Value>(_ id: UUID,
                                _ keyPath: WritableKeyPath<BulkDeviceRow, Value>,
                                fallback: Value,
                                field: String) -> Binding<Value> {
        Binding(
            get: { rows.first(where: { $0.id == id })?[keyPath: keyPath] ?? fallback },
            set: { newValue in
                guard let index = rows.firstIndex(where: { $0.id == id }) else { return }
                rows[index][keyPath: keyPath] = newValue
                clear(field: field, for: id)
            }
        )
    }

    private func textBinding(_ id: UUID,
                             _ keyPath: WritableKeyPath<BulkDeviceRow, String>,
                             field: String) -> Binding<String> {
        binding(id, keyPath, fallback: "", field: field)
    }

    private func dateBinding(_ id: UUID) -> Binding<Date> {
        binding(id, \.purchaseDate, fallback: Date(), field: "purchaseDate")
    }

    private func priceBinding(_ id: UUID) -> Binding<Int?> {
        binding(id, \.purchasePrice, fallback: nil, field: "purchasePrice")
    }

    private func clear(field: String, for id: UUID) {
        if var fields = rowErrors[id] {
            fields[field] = nil
            rowErrors[id] = fields
        }
        rowMessages[id] = nil
    }

    // MARK: - Submit

    private func submit() async {
        guard !isSubmitting, !rows.isEmpty else { return }

        if let message = BulkDeviceRules.rowCountError(rows.count) {
            topError = message
            scrollToTopToken += 1
            return
        }

        // A new attempt starts clean: the previous server verdicts are stale
        // the moment the user can edit again, and stale errors on fixed rows are
        // worse than none.
        topError = nil
        limitReached = false
        limitServerMessage = nil
        limitQuota = nil
        unconfirmedCount = 0
        rowErrors = [:]
        rowMessages = [:]
        rowStatus = [:]

        var localErrors: [UUID: [String: [String]]] = [:]
        var localStatus: [UUID: RowStatus] = [:]
        for row in rows {
            let errors = BulkDeviceRules.localErrors(for: row)
            guard !errors.isEmpty else { continue }
            localErrors[row.id] = errors
            localStatus[row.id] = .failed
        }
        if !localErrors.isEmpty {
            rowErrors = localErrors
            rowStatus = localStatus
            topError = BulkDeviceCopy.checkHighlighted
            scrollToTopToken += 1
            return
        }

        isSubmitting = true
        defer { isSubmitting = false }

        let submitted = rows
        do {
            let result = try await store.createBulk(
                BulkDeviceRules.makeInputs(submitted)
            )
            let reconciliation = BulkDeviceRules.reconcile(rows: submitted, result: result)

            createdTotal += reconciliation.createdCount
            createdNames.append(contentsOf: reconciliation.createdDevices.map(\.name))
            createdNames.append(contentsOf: reconciliation.unmatchedCreatedDevices.map(\.name))

            // Everything was created: the screen has nothing left to do, and
            // the shared store already inserted the devices. If this was the
            // account's first device, ask once for notification permission
            // before leaving — the reminder app cannot remind without it.
            guard reconciliation.hasRetryRows else {
                if await push.offerPrimerAfterFirstSave() {
                    showNotificationPrimer = true
                    return
                }
                dismiss()
                return
            }

            rows = reconciliation.retryRows
            unconfirmedCount = reconciliation.unconfirmedRows.count

            var nextErrors: [UUID: [String: [String]]] = [:]
            var nextMessages: [UUID: String] = [:]
            var nextStatus: [UUID: RowStatus] = [:]

            for (index, outcome) in reconciliation.outcomes.enumerated() {
                let row = submitted[index]
                switch outcome {
                case .created:
                    break
                case let .failed(failure):
                    if !failure.fieldErrorsOrEmpty.isEmpty {
                        nextErrors[row.id] = failure.fieldErrorsOrEmpty
                    }
                    nextMessages[row.id] = failure.messageOrNil
                        ?? BulkDeviceCopy.rowFailedFallback
                    nextStatus[row.id] = .failed
                case .unconfirmed:
                    nextMessages[row.id] = BulkDeviceCopy.rowUnconfirmedFallback
                    nextStatus[row.id] = .unconfirmed
                }
            }

            rowErrors = nextErrors
            rowMessages = nextMessages
            rowStatus = nextStatus
            scrollToTopToken += 1
        } catch {
            let failure = BulkDeviceRules.submitFailure(error)
            // The 50-row 400 is about the request, not a row. Show the server's
            // own `fieldErrors.devices` rather than a generic failure.
            rowErrors = [:]
            rowMessages = [:]
            rowStatus = [:]

            switch failure {
            case let .limitReached(message):
                limitReached = true
                limitServerMessage = message
                // The capacity is arithmetic over the device list, so refresh
                // it first: the number shown must include anything created
                // between the last list read and this rejection.
                await store.load()
                if store.state == .loaded || !store.devices.isEmpty {
                    limitQuota = DeviceQuota.capacity(in: store.devices)
                }
            case let .rejected(message, fieldErrors):
                topError = fieldErrors["devices"]?.first
                    ?? message
                    ?? BulkDeviceCopy.genericFailure
            case let .other(message):
                topError = message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                    ? BulkDeviceCopy.genericFailure
                    : message
            }
            scrollToTopToken += 1
        }
    }
}
