import Foundation

// ============================================================
// Bulk device add — the pure half
//
// `POST /api/v1/devices/bulk` answers with two independent arrays:
//
//     { "created": [<Device>], "failed": [{ index, code, message, fieldErrors }] }
//
// and the important word in the contract is **partial success**: the created
// devices exist no matter what happened to the others, and a failed row keeps
// its own `fieldErrors` so the user can fix *that* row and send only what was
// rejected.
//
// That is deceptively easy to get wrong in a view:
//
//   1. The failures are not in request order and do not carry the row's name —
//      only `index` into the request array. Mapping them by position in
//      `failed` attaches every error to the wrong row as soon as row 2 succeeds.
//   2. `created` carries no index at all. The only correlation is order: the
//      server appends a device as it creates it while walking the request
//      array. This file states that assumption once instead of letting each
//      screen invent its own.
//   3. The 409 is a different animal: it rejects the **whole** batch, creates
//      nothing, and must keep every draft on screen. Reusing the per-row
//      failure path here would silently drop the user's work.
//
// The rules below are pure and live in WarrlyKit so all of that is testable
// without a server, a database or a simulator.
// ============================================================

// MARK: - Draft row

/// One editable row of the bulk screen.
///
/// This is deliberately narrower than `DeviceInput`: a bulk row is the minimum a
/// device needs to exist.
///
///     name · category · purchase date · price
///
/// Everything else (brand, model, serial/IMEI, purchase place, notes, warranty
/// package, activation, return window, resale, brand-warranty lookup, currency
/// and FX rate) belongs to the device form/detail. Adding those here would turn
/// a fast batch into twelve copies of the long form, which is the failure mode
/// this feature exists to remove.
public struct BulkDeviceRow: Identifiable, Equatable, Sendable {
    /// Stable identity for SwiftUI and for carrying row errors across a
    /// reconciliation. It is deliberately **not** the array index: indexes move
    /// when a row is removed or when a partial failure drops the created rows,
    /// and an error attached to a stale index would land on a different device.
    public let id: UUID

    /// What the user typed. Trimmed only when it becomes a `DeviceInput`.
    public var name: String

    /// A catalog code (`FRIDGE`, `WASHING`, ...). Defaults to `OTHER` so a row
    /// is never sent with a blank category: the server treats a blank one as a
    /// row failure, and "Khác" is the honest answer for "not sure yet".
    public var category: String

    /// The calendar day the picker shows. Written to the wire through
    /// `WireDay.string(from:)` in the caller's zone so the stored day is the day
    /// on screen (see `WireDay` for why a UTC pin is wrong).
    public var purchaseDate: Date

    /// `nil` = the field is blank, which maps to `0` — a real price (a gift or
    /// "not recorded"), exactly like the single-device form. Negative values are
    /// rejected by `localErrors`.
    public var purchasePrice: Int?

    public init(id: UUID = UUID(),
                name: String = "",
                category: String = BulkDeviceRules.defaultCategory,
                purchaseDate: Date = Date(),
                purchasePrice: Int? = nil) {
        self.id = id
        self.name = name
        self.category = category
        self.purchaseDate = purchaseDate
        self.purchasePrice = purchasePrice
    }

    /// The trimmed name used for validation and for `DeviceInput`.
    public var trimmedName: String {
        name.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// The trimmed category used for validation and for `DeviceInput`.
    public var trimmedCategory: String {
        category.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

// MARK: - Rules

public enum BulkDeviceRules {

    /// The contract's per-request row ceiling. Over this the server answers a
    /// 400 with `fieldErrors.devices` and creates nothing, so the screen stops
    /// the user at 50 rather than spending a round trip to say so.
    ///
    /// Keep in sync with the bulk handler; this is the client's copy of a frozen
    /// wire limit, not a user preference.
    public static let maxRows = 50

    /// Category given to a new row. `OTHER` is seeded by migration 0004 and is
    /// the only category that is never a wrong guess. It is uppercase like every
    /// catalog code (`assertCategoryExists` compares `code = $1` exactly).
    public static let defaultCategory = "OTHER"

    // MARK: Building rows

    /// A fresh blank row.
    ///
    /// When it follows another row it **inherits that row's purchase date**.
    /// The chosen primary shape for this screen is the person who has just
    /// furnished a flat: five appliances bought around the same day. Inheriting
    /// the day means the date is typed once, while the name, category and price
    /// stay per-device. The category is deliberately *not* inherited — a fridge
    /// followed by a washing machine followed by a TV is the normal case, and
    /// silently copying "Tủ lạnh" would produce wrong rows that look filled in.
    public static func newRow(following previous: BulkDeviceRow? = nil,
                              now: Date = Date()) -> BulkDeviceRow {
        BulkDeviceRow(category: defaultCategory,
                      purchaseDate: previous?.purchaseDate ?? now,
                      purchasePrice: nil)
    }

    /// Whether another row can be added without breaking the contract's 50-row
    /// ceiling.
    public static func canAddRow(_ rows: [BulkDeviceRow]) -> Bool {
        rows.count < maxRows
    }

    /// Adds a row, or returns the array unchanged at the ceiling. Pure so the
    /// screen's "Thêm dòng" button and the ceiling copy cannot disagree.
    public static func appendingRow(to rows: [BulkDeviceRow],
                                    now: Date = Date()) -> [BulkDeviceRow] {
        guard canAddRow(rows) else { return rows }
        return rows + [newRow(following: rows.last, now: now)]
    }

    /// Removes one row. The screen never ends up with zero rows — an empty
    /// batch has nothing to submit and no field to put the cursor in — so
    /// removing the last row leaves one fresh blank row instead.
    public static func removingRow(id: UUID,
                                   from rows: [BulkDeviceRow],
                                   now: Date = Date()) -> [BulkDeviceRow] {
        let kept = rows.filter { $0.id != id }
        return kept.isEmpty ? [newRow(now: now)] : kept
    }

    /// The local copy of the contract's row ceiling, or `nil` when the batch is
    /// sendable. Rendered as a batch-level error, not attached to a row.
    public static func rowCountError(_ count: Int) -> String? {
        guard count > maxRows else { return nil }
        return BulkDeviceCopy.rowLimitError
    }

    // MARK: Row → request

    /// Maps the drafts to the request array, in order.
    ///
    /// Only the four minimum fields are filled in; everything else keeps
    /// `DeviceInput`'s defaults:
    ///
    /// * `purchasePrice = 0` for a blank price (a real number — a gift, or
    ///   "don't remember" — just like the single-device form);
    /// * `status = ACTIVE`;
    /// * `currency = VND` with `fxRate = nil`;
    /// * `warrantyMonths = 0`, no warranty package;
    /// * `leadDays` absent, so the server applies its documented `[30, 7]`.
    ///
    /// The date is written in `timeZone` (default: the device's own) through
    /// `WireDay`, which is the one round-trip-safe conversion the rest of the
    /// app uses.
    public static func makeInputs(_ rows: [BulkDeviceRow],
                                  timeZone: TimeZone = .current) -> [DeviceInput] {
        rows.map { row in
            var input = DeviceInput(
                name: row.trimmedName,
                category: row.trimmedCategory,
                purchaseDate: WireDay.string(from: row.purchaseDate, in: timeZone)
            )
            input.purchasePrice = row.purchasePrice ?? 0
            // State the currency explicitly. It is `DeviceInput`'s default too,
            // but a bulk row has no currency picker: if a future default changed,
            // these rows would silently be denominated differently.
            input.currency = CurrencyRules.vnd
            input.fxRate = nil
            return input
        }
    }

    // MARK: Local validation

    /// Errors this device can find before the request leaves the phone.
    ///
    /// The server still validates every row (it is the authority), but a blank
    /// name is knowable locally and sending it only to have the server reject
    /// the whole row is a wasted round trip that looks like a server problem.
    ///
    /// Keys are the request field names (`name`, `category`, `purchasePrice`)
    /// so server-side failures and local ones render through the same row
    /// lookup.
    public static func localErrors(for row: BulkDeviceRow) -> [String: [String]] {
        var errors: [String: [String]] = [:]
        if row.trimmedName.isEmpty {
            errors["name"] = [BulkDeviceCopy.nameRequired]
        }
        if row.trimmedCategory.isEmpty {
            errors["category"] = [BulkDeviceCopy.categoryRequired]
        }
        if let price = row.purchasePrice, price < 0 {
            errors["purchasePrice"] = [BulkDeviceCopy.priceInvalid]
        }
        return errors
    }

    // MARK: Reconciliation

    /// Reconciles the server's two arrays back onto the rows that were sent.
    ///
    /// `outcomes` is aligned with `rows` (same count, same order). A row is:
    ///
    /// * `.failed` when a failure carries its index;
    /// * `.created` when it is not failed and a created device is still
    ///   available, consumed in order (see the assumption in `created`'s doc);
    /// * `.unconfirmed` otherwise — the server reported neither outcome.
    ///
    /// `.unconfirmed` is defensive, not expected against the frozen contract.
    /// It is the only honest reading of "no news": treating the row as created
    /// would lose it silently, and treating it as failed could duplicate it on
    /// retry. The UI keeps the row and tells the user to check the device list
    /// before resending.
    ///
    /// A failure whose index is outside `rows` — or a duplicate failure for the
    /// same index — is collected in `ignoredFailures` rather than trapping. The
    /// first failure for an index wins; a later duplicate cannot move an error
    /// onto another row.
    public static func reconcile(rows: [BulkDeviceRow],
                                 result: BulkCreateDevicesResult) -> BulkDeviceReconciliation {
        var failureByIndex: [Int: BulkDeviceFailure] = [:]
        var ignoredFailures: [BulkDeviceFailure] = []
        for failure in result.failed {
            guard rows.indices.contains(failure.index) else {
                ignoredFailures.append(failure)
                continue
            }
            guard failureByIndex[failure.index] == nil else {
                ignoredFailures.append(failure)
                continue
            }
            failureByIndex[failure.index] = failure
        }

        var outcomes: [BulkDeviceRowOutcome] = []
        outcomes.reserveCapacity(rows.count)
        var failedRows: [BulkDeviceRow] = []
        var unconfirmedRows: [BulkDeviceRow] = []
        var retryRows: [BulkDeviceRow] = []
        var nextCreatedIndex = 0

        for (index, row) in rows.enumerated() {
            if let failure = failureByIndex[index] {
                outcomes.append(.failed(failure))
                failedRows.append(row)
                retryRows.append(row)
                continue
            }
            if nextCreatedIndex < result.created.count {
                outcomes.append(.created(result.created[nextCreatedIndex]))
                nextCreatedIndex += 1
                continue
            }
            outcomes.append(.unconfirmed)
            unconfirmedRows.append(row)
            retryRows.append(row)
        }

        return BulkDeviceReconciliation(
            outcomes: outcomes,
            failedRows: failedRows,
            unconfirmedRows: unconfirmedRows,
            retryRows: retryRows,
            createdDevices: Array(result.created.prefix(nextCreatedIndex)),
            unmatchedCreatedDevices: Array(result.created.dropFirst(nextCreatedIndex)),
            ignoredFailures: ignoredFailures
        )
    }

    // MARK: Failure classification

    /// Classifies a thrown error into the three things the screen does next.
    ///
    /// The 409 is special because it is **batch-level**: the contract says the
    /// whole request is rejected and nothing is created, so the drafts must stay
    /// exactly where they are. Any 409 on this endpoint is that branch (the
    /// quota is the only documented conflict); the code check is deliberately
    /// not used, so a server that spells `LIMIT_REACHED` / `limit_reached`
    /// differently still lands in the right place.
    public static func submitFailure(_ error: Error) -> BulkDeviceSubmitFailure {
        guard let apiError = error as? APIError,
              case let .server(status, envelope) = apiError
        else {
            return .other(error.localizedDescription)
        }

        let message = envelope.message?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let cleanMessage = (message?.isEmpty == false) ? message : nil

        if status == 409 {
            return .limitReached(message: cleanMessage)
        }
        return .rejected(message: cleanMessage,
                         fieldErrors: envelope.fieldErrors ?? [:])
    }
}

// MARK: - Row outcome

/// What the server said about one submitted row.
public enum BulkDeviceRowOutcome: Equatable, Sendable {
    /// The device exists. Carries the server's device (already persisted).
    case created(Device)
    /// The row was refused. Carries that row's own errors, never another row's.
    case failed(BulkDeviceFailure)
    /// Neither array mentioned this row. Kept so it cannot silently disappear.
    case unconfirmed
}

/// Per-row answer to one bulk submission, plus the rows worth resending.
public struct BulkDeviceReconciliation: Equatable, Sendable {
    /// One outcome per submitted row, in request order.
    public let outcomes: [BulkDeviceRowOutcome]

    /// Rows the server explicitly rejected, in request order.
    public let failedRows: [BulkDeviceRow]

    /// Rows the server neither created nor rejected. Expected to be empty
    /// against the frozen contract; see `BulkDeviceRules.reconcile`.
    public let unconfirmedRows: [BulkDeviceRow]

    /// Failed + unconfirmed rows, in their original relative order. This is what
    /// the screen keeps editable and what the next request contains — created
    /// rows are gone from the draft and are never sent twice.
    public let retryRows: [BulkDeviceRow]

    /// Created devices matched to their request rows, in request order.
    public let createdDevices: [Device]

    /// Created devices with no remaining successful row to attach to. Should be
    /// empty; exposed instead of dropped so a mismatched server response cannot
    /// hide a device that was created.
    public let unmatchedCreatedDevices: [Device]

    /// Failures that named a missing/duplicate index. Should be empty.
    public let ignoredFailures: [BulkDeviceFailure]

    /// Total devices the server reports as created, matched or not.
    public var createdCount: Int {
        createdDevices.count + unmatchedCreatedDevices.count
    }

    /// Whether anything has to be fixed and resubmitted.
    public var hasRetryRows: Bool { !retryRows.isEmpty }
}

// MARK: - Submission failure

/// The three shapes a failed bulk submission can take.
///
/// The distinction is the point: `.limitReached` created **nothing** and every
/// draft must survive, while `.rejected` is a batch-level validation error (the
/// 50-row ceiling) and `.other` is transport/decoding.
public enum BulkDeviceSubmitFailure: Equatable, Sendable {
    /// `409 LIMIT_REACHED`: the whole batch was refused, no device was created.
    /// `message` is the server's own sentence when it sent one.
    case limitReached(message: String?)
    /// A batch-level rejection (`400 fieldErrors.devices`, ...).
    case rejected(message: String?, fieldErrors: [String: [String]])
    /// Transport, decoding or an unrecognised server error.
    case other(String)

    public var isLimitReached: Bool {
        if case .limitReached = self { return true }
        return false
    }

    /// The server's localised sentence, when there is one.
    public var serverMessage: String? {
        switch self {
        case let .limitReached(message): return message
        case let .rejected(message, _): return message
        case let .other(message):
            return message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : message
        }
    }

    /// Field errors on the **request**, not on a row. `devices` is the documented
    /// one (the 50-row ceiling).
    public var fieldErrors: [String: [String]] {
        if case let .rejected(_, errors) = self { return errors }
        return [:]
    }
}

// MARK: - Device quota

/// How many more active devices the account can take.
///
/// The 409 body does **not** carry the remaining allowance (the frozen contract
/// only says "the whole request is 409 LIMIT_REACHED"), so the number has to be
/// derived. The service applies two ceilings in one rule — both from
/// `api/internal/services/devices.go`:
///
/// * `MAX_DEVICES_PER_USER` = 50 **active** rows (any status except `SOLD`);
/// * `MAX_DEVICES_TOTAL_PER_USER` = 500 rows in total, sold ones included.
///
/// Every bulk row is created `ACTIVE`, so the capacity is the smaller of the two
/// remainders. Counting sold rows as "free" is correct for the active ceiling and
/// wrong for the total one; taking the minimum is what makes both true.
///
/// This is arithmetic over the most recent device list, not a server field. The
/// 409 itself remains authoritative about the failure; this number tells the
/// user how much to shrink the batch.
public enum DeviceQuota {
    /// Keep in sync with `services.MAX_DEVICES_PER_USER`.
    public static let maxActiveDevices = 50
    /// Keep in sync with `services.MAX_DEVICES_TOTAL_PER_USER`.
    public static let maxTotalDevices = 500

    /// Active rows (anything but `SOLD`), the ceiling the service counts for
    /// "how many devices do I have".
    public static func activeCount(in devices: [Device]) -> Int {
        devices.reduce(into: 0) { count, device in
            if device.status != .SOLD { count += 1 }
        }
    }

    /// The remaining allowance, clamped at zero, plus the inputs it came from.
    public static func capacity(in devices: [Device]) -> DeviceQuotaCapacity {
        let active = activeCount(in: devices)
        let total = devices.count
        let activeRemaining = max(0, maxActiveDevices - active)
        let totalRemaining = max(0, maxTotalDevices - total)
        return DeviceQuotaCapacity(
            active: active,
            total: total,
            activeRemaining: activeRemaining,
            totalRemaining: totalRemaining,
            remaining: min(activeRemaining, totalRemaining)
        )
    }
}

/// The result of `DeviceQuota.capacity(in:)`.
public struct DeviceQuotaCapacity: Equatable, Sendable {
    /// Rows whose status is not `SOLD`.
    public let active: Int
    /// Every row, sold ones included.
    public let total: Int
    /// Slots left under the 50-active ceiling.
    public let activeRemaining: Int
    /// Slots left under the 500-row ceiling.
    public let totalRemaining: Int
    /// What a new `ACTIVE` device actually has room for: the smaller remainder.
    public let remaining: Int

    /// Nothing more can be added until a device is sold or deleted.
    public var isFull: Bool { remaining == 0 }
}

// MARK: - Copy

/// Every user-facing sentence of the bulk flow, kept in one place so the two
/// languages stay side by side in the catalog and the pure rules never render a
/// hard-coded identifier.
///
/// These are computed properties, **not** `static let`s: the app can switch
/// language at runtime and a cached `L.t(...)` would keep the old language until
/// relaunch.
public enum BulkDeviceCopy {

    // Screen

    public static var title: String { L.t("Thêm nhiều thiết bị") }

    /// States the chosen shape out loud: a household batch, same day, four
    /// fields per row, everything else later.
    public static var intro: String {
        L.t("Vừa mua nhiều thiết bị cùng lúc? Nhập nhanh từng dòng: tên, loại, ngày mua và giá. Hãng, model, serial và bảo hành bổ sung sau ở trang chi tiết.")
    }

    public static var priceNote: String {
        L.t("Giá nhập bằng đồng (₫). Thiết bị mua bằng ngoại tệ: thêm xong rồi sửa ở trang chi tiết.")
    }

    public static var addRow: String { L.t("Thêm dòng") }

    public static var newRowInheritsDate: String {
        L.t("Dòng mới lấy ngày mua của dòng trước. Sửa riêng từng dòng nếu khác.")
    }

    public static func rowTitle(_ number: Int) -> String {
        L.t("Thiết bị %d", number)
    }

    public static var removeRow: String { L.t("Xoá dòng") }

    // Minimum fields

    public static var nameLabel: String { L.t("Tên thiết bị") }
    public static var namePlaceholder: String { L.t("Ví dụ: Tủ lạnh Toshiba") }
    /// Existing catalog key, reused so the label cannot drift from the single
    /// device form.
    public static var categoryLabel: String { L.t("Loại") }
    public static var purchaseDateLabel: String { L.t("Ngày mua") }
    public static var priceLabel: String { L.t("Giá mua") }

    // Row counters / limits

    public static var rowLimit: String { L.t("Tối đa %d dòng mỗi lần.", BulkDeviceRules.maxRows) }
    public static func rowCount(_ count: Int) -> String {
        L.t("%d/%d dòng", count, BulkDeviceRules.maxRows)
    }
    public static var rowLimitError: String {
        L.t("Mỗi lần chỉ thêm được tối đa %d thiết bị.", BulkDeviceRules.maxRows)
    }
    public static var checkHighlighted: String {
        L.t("Kiểm tra lại các dòng được đánh dấu.")
    }
    public static func submit(_ count: Int) -> String {
        L.p("Thêm %d thiết bị", count)
    }

    // Partial success

    public static func created(_ count: Int) -> String {
        L.p("Đã thêm %d thiết bị", count)
    }
    public static func rowsToFix(_ count: Int) -> String {
        L.p("%d dòng cần sửa và gửi lại", count)
    }
    public static var retryNote: String {
        L.t("Chỉ các dòng còn lại được gửi lại. Các thiết bị đã tạo sẽ không bị tạo trùng.")
    }
    public static var unconfirmedNote: String {
        L.t("Có dòng máy chủ không trả lời kết quả. Kiểm tra tab Thiết bị trước khi gửi lại — gửi lại có thể tạo trùng.")
    }
    public static var needsFixChip: String { L.t("Cần sửa") }
    public static var unconfirmedChip: String { L.t("Chưa rõ kết quả") }
    public static var rowFailedFallback: String {
        L.t("Không lưu được dòng này. Sửa rồi gửi lại.")
    }
    public static var rowUnconfirmedFallback: String {
        L.t("Không lưu được dòng này. Kiểm tra tab Thiết bị trước khi gửi lại.")
    }
    public static func moreDevices(_ count: Int) -> String {
        L.p("… và %d thiết bị khác", count)
    }

    // Quota 409

    public static var limitTitle: String { L.t("Lần gửi này không tạo thiết bị nào") }
    public static var limitBody: String {
        L.t("Cả lô bị từ chối vì vượt giới hạn thiết bị của tài khoản. Không dòng nào trong lần gửi này được lưu.")
    }
    public static var quotaFull: String {
        L.t("Tài khoản đã đạt giới hạn thiết bị. Bán hoặc xoá bớt một thiết bị đang dùng rồi thử lại.")
    }
    public static func remaining(_ count: Int) -> String {
        L.p("Tài khoản còn có thể thêm %d thiết bị.", count)
    }
    public static func overflow(_ count: Int) -> String {
        L.p("Bớt ít nhất %d dòng rồi gửi lại.", count)
    }
    public static var capacityStale: String {
        L.t("Danh sách thiết bị có thể chưa cập nhật. Mở tab Thiết bị, làm mới rồi thử lại.")
    }
    public static var capacityUnknown: String {
        L.t("Không đọc được số thiết bị còn lại. Mở tab Thiết bị để kiểm tra.")
    }
    public static var genericFailure: String {
        L.t("Không gửi được lô thiết bị. Thử lại nhé.")
    }

    // Local validation

    public static var nameRequired: String { L.t("Tên thiết bị bắt buộc") }
    public static var categoryRequired: String { L.t("Loại thiết bị bắt buộc") }
    public static var priceInvalid: String { L.t("Giá mua không hợp lệ") }
}
