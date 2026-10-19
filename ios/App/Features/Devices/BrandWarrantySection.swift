import SwiftUI
import UIKit
import WarrlyKit

// ============================================================
// BrandWarrantySection — "Đối chiếu với hãng" (brand warranty lookup)
//
// The section answers a question the local warranty estimate cannot: what does
// the BRAND's system say? It is an honesty feature first and a layout second,
// and every branch is decided by `WarrlyKit/BrandWarranty.swift` (where the copy
// and the rules are unit-tested):
//
//   * `warrantyMismatch != nil` renders the server's kind with both dates, in
//     plain language and **orange, never red** — a disagreement is information,
//     not an alarm;
//   * `warrantyMismatch == nil` does NOT automatically mean agreement: the
//     section only says the two sides agree when the user recorded brand dates;
//     a status-only check (NOT_REGISTERED, say) is its own answer;
//   * `warrantyLookupUrl: null` says plainly that we do not have this brand's
//     page. The app substitutes no support page, guessed path or search URL;
//   * the record sheet is the part competitors do not do: it writes what the
//     brand showed back onto the device, with `brandCheckedAt` set to now.
//
// The same section is used by `DeviceDetailView` (where the sheet persists
// immediately) and by `DeviceFormView` (where the answer travels with the
// form's next save, so a record made inside the form cannot PATCH a half-edited
// device behind the user's back).
// ============================================================

struct BrandWarrantySection: View {
    let client: APIClient
    /// `Device.brand` exactly as recorded (or, in the form, as currently typed).
    let brand: String?
    let fields: BrandWarrantyFields
    let mismatch: WarrantyMismatch?
    /// Seeds a newly picked brand date; the sheet's pickers open on this day.
    let purchaseDate: Date?

    /// Persist the answer now. `nil` = local-only: the parent keeps the fields
    /// in form state and sends them with its next save.
    var persist: ((BrandWarrantyFields) async throws -> Void)? = nil
    /// Called after a local-only record, so the form can update its state.
    var onRecordLocally: ((BrandWarrantyFields) -> Void)? = nil
    /// The form has recorded a newer answer than the device read, so the old
    /// server-computed mismatch must not be shown as current.
    var pendingLocalChanges: Bool = false

    @EnvironmentObject private var catalog: CatalogStore
    @State private var lookup: LookupState = .idle
    @State private var showRecordSheet = false
    @State private var openedURL: URL?
    @State private var savedAt: Date?

    private enum LookupState: Equatable {
        case idle
        case loading
        case available(URL)
        case missing
        case unknownBrand
        case noBrand
        case failed
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            WVSectionHeader(BrandWarrantyCopy.sectionTitle)
            WVSectionFooter(BrandWarrantyCopy.sectionHint)

            stateCard

            WVGroup {
                lookupRow
                WVDivider(inset: 16)
                recordRow
            }

            if fields.hasAnyRecord {
                WVSectionHeader(L.t("Kết quả đã ghi"))
                WVGroup {
                    WVRow(icon: "shieldCheck", iconColor: statusColor,
                          title: BrandWarrantyCopy.statusLabel,
                          detail: fields.status?.label ?? BrandWarrantyCopy.notRecorded)
                    WVDivider(inset: 60)
                    WVRow(icon: "calendar", iconColor: WVColor.blue,
                          title: BrandWarrantyCopy.startLabel,
                          detail: BrandWarrantyRules.dayLabel(fields.start)
                              ?? BrandWarrantyCopy.notRecorded)
                    WVDivider(inset: 60)
                    WVRow(icon: "calendar", iconColor: WVColor.purple,
                          title: BrandWarrantyCopy.endLabel,
                          detail: BrandWarrantyRules.dayLabel(fields.end)
                              ?? BrandWarrantyCopy.notRecorded)
                    WVDivider(inset: 60)
                    WVRow(icon: "clock", iconColor: WVColor.green,
                          title: BrandWarrantyCopy.checkedAtLabel,
                          subtitle: BrandWarrantyRules.checkedAgoLabel(fields.checkedAt),
                          detail: BrandWarrantyRules.dayLabel(fields.checkedAt)
                              ?? BrandWarrantyCopy.notRecorded)
                    if let recorded = BrandWarrantyRules.lookupAvailability(fields.lookupUrl)
                        .url {
                        WVDivider(inset: 60)
                        // A recorded URL is the user's own note of the page they
                        // opened. It is never used to fill a missing live URL —
                        // that would turn a stale record into an app claim.
                        WVRow(icon: "link", iconColor: WVColor.blue,
                              title: BrandWarrantyCopy.lookupURLRecordedLabel,
                              subtitle: recorded.host,
                              chevron: true,
                              action: {
                                  openedURL = recorded
                                  UIApplication.shared.open(recorded)
                              })
                    }
                }
            }

            if savedAt != nil {
                Text(BrandWarrantyCopy.savedMark)
                    .font(.system(size: 12))
                    .foregroundStyle(WVColor.green)
                    .padding(.horizontal, 32)
                    .padding(.top, 7)
            }
        }
        .task(id: brand) { await loadLookup() }
        .sheet(isPresented: $showRecordSheet) {
            BrandWarrantyRecordSheet(
                fields: fields,
                suggestedURL: openedURL?.absoluteString ?? liveURLString ?? fields.lookupUrl,
                purchaseDate: purchaseDate,
                localOnly: persist == nil,
                onSave: save
            )
        }
    }

    // MARK: - State card

    @ViewBuilder
    private var stateCard: some View {
        if pendingLocalChanges {
            infoCard(icon: "clock", color: WVColor.blue,
                     title: BrandWarrantyCopy.localOnlyNote,
                     detail: BrandWarrantyCopy.checkedAtNote)
        } else {
            switch BrandWarrantyRules.mismatchState(mismatch, fields: fields) {
            case .mismatch(let value):
                // Orange, not red: a different date is information the user can
                // act on, not an error and not a warning that the device is bad.
                infoCard(icon: "alert", color: WVColor.orange,
                         title: BrandWarrantyRules.mismatchHeadline(value),
                         detail: BrandWarrantyRules.mismatchDatesLine(value),
                         extra: fields.status?.label)
            case .agrees:
                infoCard(icon: "checkCircle", color: WVColor.green,
                         title: BrandWarrantyCopy.agreesTitle,
                         detail: BrandWarrantyCopy.agreesDetail)
            case .statusOnly(let status):
                infoCard(icon: "info", color: WVColor.blue,
                         title: status?.label ?? BrandWarrantyCopy.checkedNoDatesTitle,
                         detail: BrandWarrantyCopy.statusOnlyDetail)
            case .notChecked:
                infoCard(icon: "info", color: WVColor.label3,
                         title: BrandWarrantyCopy.notCheckedTitle,
                         detail: BrandWarrantyCopy.notCheckedDetail)
            }
        }
    }

    private func infoCard(icon: String, color: Color, title: String,
                          detail: String?, extra: String? = nil) -> some View {
        HStack(alignment: .top, spacing: 10) {
            WVIcon(icon, size: 16)
                .foregroundStyle(color)
                .padding(.top, 1)
            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(WVColor.label)
                    .fixedSize(horizontal: false, vertical: true)
                if let detail {
                    Text(detail)
                        .font(.system(size: 13))
                        .foregroundStyle(WVColor.label2)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if let extra {
                    Text(extra)
                        .font(.system(size: 12))
                        .foregroundStyle(WVColor.label3)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(color.opacity(0.10))
        .clipShape(RoundedRectangle(cornerRadius: WVRadius.card, style: .continuous))
        .padding(.horizontal, WVSpacing.gutter)
    }

    // MARK: - Lookup / record rows

    @ViewBuilder
    private var lookupRow: some View {
        switch lookup {
        case .idle, .loading:
            HStack(spacing: 10) {
                ProgressView().controlSize(.small)
                Text(BrandWarrantyCopy.lookupLoading)
                    .font(.system(size: 15))
                    .foregroundStyle(WVColor.label2)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 16)
            .frame(minHeight: 44)
            .padding(.vertical, 7)

        case .available(let url):
            WVRow(icon: "externalLink", iconColor: WVColor.blue,
                  title: BrandWarrantyCopy.lookupAction,
                  subtitle: url.host,
                  chevron: true,
                  action: {
                      openedURL = url
                      UIApplication.shared.open(url)
                  })

        case .missing:
            missingRow(title: BrandWarrantyCopy.lookupMissingTitle,
                       detail: BrandWarrantyCopy.lookupMissingDetail)

        case .unknownBrand:
            missingRow(title: BrandWarrantyCopy.lookupMissingTitle,
                       detail: BrandWarrantyCopy.lookupUnknownBrandDetail)

        case .noBrand:
            missingRow(title: L.t("Thiết bị chưa ghi hãng"),
                       detail: BrandWarrantyCopy.noBrandDetail)

        case .failed:
            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .top, spacing: 8) {
                    WVIcon("alert", size: 13)
                        .foregroundStyle(WVColor.orange)
                        .padding(.top, 1)
                    Text(BrandWarrantyCopy.lookupFailed)
                        .font(.system(size: 13))
                        .foregroundStyle(WVColor.label2)
                        .fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 0)
                }
                Button {
                    Task { await loadLookup() }
                } label: {
                    Text(L.t("Thử lại"))
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(WVColor.tint)
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 16)
            .frame(minHeight: 44)
            .padding(.vertical, 7)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func missingRow(title: String, detail: String) -> some View {
        HStack(alignment: .top, spacing: 10) {
            WVIcon("info", size: 14)
                .foregroundStyle(WVColor.label3)
                .padding(.top, 1)
            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(WVColor.label)
                    .fixedSize(horizontal: false, vertical: true)
                Text(detail)
                    .font(.system(size: 12))
                    .foregroundStyle(WVColor.label3)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 16)
        .frame(minHeight: 44)
        .padding(.vertical, 7)
    }

    private var recordRow: some View {
        WVRow(icon: "edit", iconColor: WVColor.tint,
              title: BrandWarrantyCopy.recordAction,
              subtitle: fields.hasAnyRecord
                  ? BrandWarrantyRules.checkedAgoLabel(fields.checkedAt)
                  : nil,
              chevron: true,
              role: .tint,
              action: { showRecordSheet = true })
    }

    private var statusColor: Color {
        switch fields.status {
        case .ACTIVE:         return WVColor.green
        case .EXPIRED:        return WVColor.gray
        case .NOT_REGISTERED: return WVColor.orange
        case .PRE_ACTIVATED:  return WVColor.orange
        case .UNKNOWN:        return WVColor.gray
        case nil:             return WVColor.gray
        }
    }

    private var liveURLString: String? {
        if case .available(let url) = lookup { return url.absoluteString }
        return nil
    }

    // MARK: - Load

    @MainActor
    private func loadLookup() async {
        savedAt = nil
        openedURL = nil
        guard let rawBrand = brand?.trimmingCharacters(in: .whitespacesAndNewlines),
              !rawBrand.isEmpty else {
            lookup = .noBrand
            return
        }
        lookup = .loading
        // In the device form this id is the brand TextField, so `.task(id:)`
        // re-runs on every keystroke. Debounce and let the cancellation of the
        // previous task drop stale work; the catalog match below still decides
        // whether any request is made at all.
        try? await Task.sleep(nanoseconds: 300_000_000)
        guard !Task.isCancelled else { return }
        // The catalog is what maps the free-text brand to the `brandId` the
        // service-info route needs. A catalog that cannot load is a failure,
        // not "this brand has no page".
        await catalog.loadIfNeeded()
        guard !Task.isCancelled else { return }
        guard catalog.isLoaded else {
            lookup = .failed
            return
        }
        guard let brandId = BrandWarrantyRules.brandId(for: rawBrand, in: catalog.brands) else {
            lookup = .unknownBrand
            return
        }
        do {
            let info = try await client.brandServiceInfo(brandId: brandId)
            switch BrandWarrantyRules.lookupAvailability(info?.warrantyLookupUrl) {
            case .available(let url):
                lookup = .available(url)
            case .missing:
                // `{"serviceInfo": null}` (known brand, no directory row) and a
                // row with `warrantyLookupUrl: null` mean the same thing here:
                // we do not have this brand's page. Say that, invent nothing.
                lookup = .missing
            }
        } catch let error as APIError where error.statusCode == 404 {
            // The catalog carried an id the service-info route does not know.
            // That is still "we have no page", not a request to retry.
            lookup = .missing
        } catch {
            lookup = .failed
        }
    }

    // MARK: - Save

    private func save(_ newFields: BrandWarrantyFields) async throws {
        if let persist {
            try await persist(newFields)
            savedAt = Date()
        } else {
            onRecordLocally?(newFields)
        }
    }
}

// MARK: - LookupAvailability URL helper

private extension BrandWarrantyRules.LookupAvailability {
    /// The URL when there is one. Keeps the view's call sites free of a switch
    /// whose only purpose is unwrapping.
    var url: URL? {
        if case .available(let url) = self { return url }
        return nil
    }
}

// ============================================================
// BrandWarrantyRecordSheet — record what the brand's page said.
//
// The fields are exactly the five the contract added to Device:
// `brandWarrantyStatus`, the two dates the brand showed, `brandLookupUrl` (the
// page opened, prefilled), and `brandCheckedAt` (set to now by this sheet).
//
// Local validation mirrors the server's rules so a half-filled record never
// leaves the device, but the server's own `fieldErrors` still win when it
// rejects something this file cannot predict.
// ============================================================

struct BrandWarrantyRecordSheet: View {
    let fields: BrandWarrantyFields
    let suggestedURL: String?
    let purchaseDate: Date?
    let localOnly: Bool
    let onSave: (BrandWarrantyFields) async throws -> Void

    @Environment(\.dismiss) private var dismiss

    @State private var status: BrandWarrantyStatus?
    @State private var startDate: Date?
    @State private var endDate: Date?
    @State private var lookupURL: String
    @State private var isSaving = false
    @State private var topError: String?
    @State private var fieldErrors: [String: [String]] = [:]
    @State private var showClearConfirm = false

    init(fields: BrandWarrantyFields,
         suggestedURL: String?,
         purchaseDate: Date?,
         localOnly: Bool,
         onSave: @escaping (BrandWarrantyFields) async throws -> Void) {
        self.fields = fields
        self.suggestedURL = suggestedURL
        self.purchaseDate = purchaseDate
        self.localOnly = localOnly
        self.onSave = onSave
        _status = State(initialValue: fields.status)
        _startDate = State(initialValue: WireDay.date(from: fields.start))
        _endDate = State(initialValue: WireDay.date(from: fields.end))
        _lookupURL = State(initialValue: fields.lookupUrl ?? suggestedURL ?? "")
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    Spacer().frame(height: 8)

                    WVSectionFooter(BrandWarrantyCopy.recordSheetHint)

                    WVGroup {
                        statusRow
                        fieldErrorRow("brandWarrantyStatus")

                        WVDivider(inset: 16)
                        dateRow(label: BrandWarrantyCopy.recordSheetStartLabel,
                                date: $startDate,
                                errorKey: "brandWarrantyStart")
                        fieldErrorRow("brandWarrantyStart")

                        WVDivider(inset: 16)
                        dateRow(label: BrandWarrantyCopy.recordSheetEndLabel,
                                date: $endDate,
                                errorKey: "brandWarrantyEnd")
                        fieldErrorRow("brandWarrantyEnd")

                        WVDivider(inset: 16)
                        HStack(spacing: 12) {
                            Text(BrandWarrantyCopy.recordSheetLinkLabel)
                                .font(.system(size: 17))
                                .foregroundStyle(WVColor.label)
                            TextField(BrandWarrantyCopy.recordSheetLinkPlaceholder,
                                      text: $lookupURL)
                                .font(.system(size: 15))
                                .foregroundStyle(WVColor.label)
                                .keyboardType(.URL)
                                .textInputAutocapitalization(.never)
                                .autocorrectionDisabled()
                                .multilineTextAlignment(.trailing)
                                .onChange(of: lookupURL) { _, _ in
                                    fieldErrors["brandLookupUrl"] = nil
                                }
                        }
                        .padding(.horizontal, 16)
                        .frame(minHeight: 44)
                        .padding(.vertical, 7)
                        fieldErrorRow("brandLookupUrl")
                    }

                    WVSectionFooter(BrandWarrantyCopy.checkedAtNote)
                    if localOnly {
                        WVSectionFooter(BrandWarrantyCopy.localOnlyNote)
                    }

                    if !BrandWarrantyRules.isEmpty(fields) {
                        WVGroup {
                            Button(role: .destructive) {
                                showClearConfirm = true
                            } label: {
                                HStack {
                                    Text(BrandWarrantyCopy.clearAction)
                                    Spacer(minLength: 0)
                                }
                                .font(.system(size: 17))
                                .foregroundStyle(WVColor.red)
                                .padding(.horizontal, 16)
                                .frame(minHeight: 44)
                                .padding(.vertical, 7)
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(WVRowButtonStyle())
                            .disabled(isSaving)
                        }
                        .padding(.top, 16)
                    }

                    if let topError {
                        Text(topError)
                            .font(.system(size: 13))
                            .foregroundStyle(WVColor.red)
                            .padding(.horizontal, 32)
                            .padding(.top, 8)
                            .fixedSize(horizontal: false, vertical: true)
                    }

                    Spacer().frame(height: 24)
                }
            }
            .wvScreen()
            .navigationTitle(BrandWarrantyCopy.recordSheetTitle)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button(L.t("Huỷ")) { dismiss() }
                        .foregroundStyle(WVColor.tint)
                        .disabled(isSaving)
                }
                ToolbarItem(placement: .topBarTrailing) {
                    if isSaving {
                        ProgressView()
                    } else {
                        Button(L.t("Lưu")) { Task { await save() } }
                            .font(.system(size: 17, weight: .semibold))
                            .foregroundStyle(WVColor.tint)
                            .disabled(status == nil)
                    }
                }
            }
        }
        .presentationDetents([.medium, .large])
        .alert(BrandWarrantyCopy.clearConfirmTitle, isPresented: $showClearConfirm) {
            Button(L.t("Huỷ"), role: .cancel) {}
            Button(L.t("Xoá"), role: .destructive) {
                Task { await clear() }
            }
        } message: {
            Text(BrandWarrantyCopy.clearConfirmMessage)
        }
    }

    // MARK: - Rows

    private var statusRow: some View {
        Menu {
            Button {
                status = nil
            } label: {
                if status == nil {
                    Label(BrandWarrantyCopy.notChosen, systemImage: "checkmark")
                } else {
                    Text(BrandWarrantyCopy.notChosen)
                }
            }
            ForEach(BrandWarrantyStatus.allCases, id: \.self) { value in
                Button {
                    status = value
                    fieldErrors["brandWarrantyStatus"] = nil
                } label: {
                    if status == value {
                        Label(value.label, systemImage: "checkmark")
                    } else {
                        Text(value.label)
                    }
                }
            }
        } label: {
            HStack(spacing: 12) {
                Text(BrandWarrantyCopy.recordSheetStatusLabel)
                    .font(.system(size: 17))
                    .foregroundStyle(WVColor.label)
                Spacer(minLength: 8)
                Text(status?.label ?? BrandWarrantyCopy.notChosen)
                    .font(.system(size: 17))
                    .foregroundStyle(status == nil ? WVColor.label3 : WVColor.label)
                    .multilineTextAlignment(.trailing)
                    .lineLimit(1)
                WVIcon("arrowDown", size: 11)
                    .foregroundStyle(WVColor.label4)
            }
            .padding(.horizontal, 16)
            .frame(minHeight: 44)
            .padding(.vertical, 7)
            .contentShape(Rectangle())
        }
        .disabled(isSaving)
    }

    /// Optional date picker: `nil` is a real state ("hãng không hiện ngày"),
    /// and a picked day is written back in the picker's own zone so the calendar
    /// day cannot slide (`WireDay.string`).
    private func dateRow(label: String, date: Binding<Date?>,
                         errorKey: String) -> some View {
        HStack(spacing: 12) {
            Text(label)
                .font(.system(size: 17))
                .foregroundStyle(WVColor.label)
            Spacer(minLength: 8)
            if let value = date.wrappedValue {
                DatePicker("", selection: Binding(
                    get: { value },
                    set: { date.wrappedValue = $0 }
                ), displayedComponents: .date)
                .labelsHidden()
                .disabled(isSaving)
                .onChange(of: date.wrappedValue) { _, _ in
                    fieldErrors[errorKey] = nil
                }
                Button {
                    date.wrappedValue = nil
                    fieldErrors[errorKey] = nil
                } label: {
                    WVIcon("x", size: 13)
                        .foregroundStyle(WVColor.label4)
                }
                .buttonStyle(.plain)
                .disabled(isSaving)
                .accessibilityLabel(L.t("Xoá"))
            } else {
                Button(BrandWarrantyCopy.notRecorded) {
                    date.wrappedValue = purchaseDate ?? Date()
                }
                .font(.system(size: 17))
                .foregroundStyle(WVColor.tint)
                .buttonStyle(.plain)
                .disabled(isSaving)
            }
        }
        .padding(.horizontal, 16)
        .frame(minHeight: 44)
        .padding(.vertical, 7)
    }

    @ViewBuilder
    private func fieldErrorRow(_ key: String) -> some View {
        if let message = fieldErrors[key]?.first {
            Text(message)
                .font(.system(size: 12))
                .foregroundStyle(WVColor.red)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 16)
                .padding(.bottom, 8)
        }
    }

    // MARK: - Save

    private func currentFields() -> BrandWarrantyFields {
        let trimmedURL = lookupURL.trimmingCharacters(in: .whitespacesAndNewlines)
        return BrandWarrantyFields(
            status: status,
            start: startDate.map { WireDay.string(from: $0) },
            end: endDate.map { WireDay.string(from: $0) },
            // A check is happening now; "now" is the moment the user saves.
            checkedAt: BrandWarrantyRules.checkedAtString(),
            lookupUrl: trimmedURL.isEmpty ? nil : trimmedURL
        )
    }

    private func save() async {
        guard !isSaving else { return }
        topError = nil
        fieldErrors = [:]
        isSaving = true
        defer { isSaving = false }

        let newFields = currentFields()
        let errors = BrandWarrantyRules.validationErrors(newFields)
        if !errors.isEmpty {
            fieldErrors = errors
            topError = errors["brandWarrantyStatus"]?.first
                ?? errors["brandWarrantyEnd"]?.first
                ?? errors["brandLookupUrl"]?.first
            return
        }

        do {
            try await onSave(newFields)
            dismiss()
        } catch let error as APIError {
            fieldErrors = error.fieldErrors
            if fieldErrors.isEmpty {
                topError = error.localizedDescription
            } else {
                topError = error.fieldErrors["brandWarrantyStatus"]?.first
                    ?? error.fieldErrors["brandWarrantyEnd"]?.first
                    ?? error.fieldErrors["brandLookupUrl"]?.first
                    ?? error.localizedDescription
            }
        } catch {
            topError = error.localizedDescription.isEmpty
                ? BrandWarrantyCopy.saveFailedMessage
                : error.localizedDescription
        }
    }

    /// Clears all five fields. This is the only path that may send an empty
    /// record while `status` is nil, and it is explicit.
    private func clear() async {
        guard !isSaving else { return }
        topError = nil
        fieldErrors = [:]
        isSaving = true
        defer { isSaving = false }
        do {
            try await onSave(.empty)
            dismiss()
        } catch let error as APIError {
            fieldErrors = error.fieldErrors
            topError = error.localizedDescription
        } catch {
            topError = BrandWarrantyCopy.saveFailedMessage
        }
    }
}
