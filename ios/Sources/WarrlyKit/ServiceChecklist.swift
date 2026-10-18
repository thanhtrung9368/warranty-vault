import Foundation

// MARK: - Pre-service handover checklist
//
// Vietnamese retailers refuse a locked device and may wipe data during service
// (FPT Shop and CellphoneS both publish intake rules). The expensive failure is
// not the repair — it is arriving with a passcode on the phone, no backup and no
// invoice, then losing the trip.
//
// The content lives here, in the Kit, rather than in the screen for three
// reasons:
//
//   1. the list is per device (serial, warranty end, where it was bought, the
//      invoice photos already in the app), so the rules are worth testing;
//   2. the order matters — data/accounts first, then paperwork/photos, then the
//      handover, then what to check at pickup;
//   3. `ServiceChecklistProgress` is the tick state, pure and testable, while the
//      screen only draws it.
//
// ## What this is not
//
// It is a **read-only list with tick-boxes**: no item can be added, edited or
// deleted, and nothing is saved. The ticks live in an in-memory session store in
// the app (`ServiceChecklistSession`) keyed by device id; leaving the screen and
// coming back keeps them, force-quitting does not. Persisting the list is out of
// scope for this pass — no API field exists for it, and adding a client-only
// server write would be a contract change.

// MARK: - Model

/// One tick-box line. `id` is stable across renders and languages: it is the key
/// the session's tick state uses, so the wording may change without losing ticks.
public struct ServiceChecklistItem: Identifiable, Equatable, Sendable {
    public let id: String
    public let title: String
    public let detail: String
    /// Semantic icon name understood by the app's `WVIcon` map.
    public let icon: String

    public init(id: String, title: String, detail: String, icon: String) {
        self.id = id
        self.title = title
        self.detail = detail
        self.icon = icon
    }
}

public struct ServiceChecklistSection: Identifiable, Equatable, Sendable {
    public let id: String
    public let title: String
    public let items: [ServiceChecklistItem]

    public init(id: String, title: String, items: [ServiceChecklistItem]) {
        self.id = id
        self.title = title
        self.items = items
    }
}

/// The device facts the checklist is generated from.
///
/// `warrantyEndText` is already formatted by the caller (`WVFormat.date`), not a
/// `Date`: the checklist is copy, and a date formatter pinned inside the Kit
/// would make the text's language depend on the machine's locale rather than on
/// `L.language`. The caller owns display formatting; this model owns the rules.
public struct ServiceChecklistDevice: Equatable, Sendable {
    public let name: String
    public let category: String
    public let serialNumber: String?
    /// `nil` means "no warranty end recorded" — deliberately different from the
    /// date of an expired package.
    public let warrantyEndText: String?
    public let purchasePlace: String?
    /// How many attachments (invoice photos etc.) the app already holds.
    public let attachmentCount: Int

    public init(name: String, category: String,
                serialNumber: String? = nil,
                warrantyEndText: String? = nil,
                purchasePlace: String? = nil,
                attachmentCount: Int = 0) {
        self.name = name
        self.category = category
        self.serialNumber = serialNumber
        self.warrantyEndText = warrantyEndText
        self.purchasePlace = purchasePlace
        self.attachmentCount = max(0, attachmentCount)
    }
}

// MARK: - Generation

public enum ServiceChecklist {

    /// The section ids, in the order the screen renders them. Public so a test can
    /// pin the order without reaching into the generated copy.
    public static let sectionIDs = ["data", "paperwork", "handover", "pickup"]

    /// Every item for this device, sectioned and ordered.
    ///
    /// The four sections are a sequence on purpose: get the device out of your
    /// accounts and backed up, then assemble the paper trail, then hand it over,
    /// then check it at pickup. Reordering them would put "take a photo" after
    /// "leave the device", which is the mistake this list exists to prevent.
    public static func sections(for device: ServiceChecklistDevice) -> [ServiceChecklistSection] {
        [dataSection(), paperworkSection(for: device), handoverSection(), pickupSection(for: device)]
    }

    /// Flattened item list — used by the screen for its progress count and by
    /// tests for uniqueness/order assertions.
    public static func items(for device: ServiceChecklistDevice) -> [ServiceChecklistItem] {
        sections(for: device).flatMap(\.items)
    }

    public static func itemCount(for device: ServiceChecklistDevice) -> Int {
        items(for: device).count
    }

    // MARK: - Sections

    private static func dataSection() -> ServiceChecklistSection {
        ServiceChecklistSection(
            id: "data",
            title: L.t("Dữ liệu và tài khoản"),
            items: [
                .init(
                    id: "account.signOut",
                    title: L.t("Đăng xuất iCloud/Google/Mi và tắt Find My"),
                    detail: L.t("Máy còn tài khoản hoặc khoá kích hoạt có thể bị từ chối tiếp nhận, và sau khi xoá dữ liệu bạn sẽ không đăng nhập lại được. Tắt Find My (iPhone/iPad/Mac) hoặc Find My Device (Android) trước, rồi mới đăng xuất."),
                    icon: "logOut"
                ),
                .init(
                    id: "security.removeLock",
                    title: L.t("Gỡ mật khẩu màn hình và mọi khoá sinh trắc học"),
                    detail: L.t("Xoá mật khẩu, Face ID/Touch ID, vân tay hoặc mật khẩu hình vẽ. Máy còn khoá có thể bị từ chối kiểm tra hoặc bị xoá dữ liệu ngay tại quầy; bạn sẽ phải thiết lập lại sau khi nhận máy."),
                    icon: "lock"
                ),
                .init(
                    id: "data.backup",
                    title: L.t("Sao lưu ảnh và dữ liệu, kiểm tra bản sao lưu đã xong"),
                    detail: L.t("Trung tâm có thể xoá dữ liệu trong lúc sửa, kể cả khi chỉ thay màn hình. Dùng iCloud/Google One hoặc sao lưu vào máy tính; mở thử một ảnh cũ để chắc lần sao lưu gần nhất đã hoàn tất, đừng chỉ bấm bắt đầu."),
                    icon: "cloud"
                ),
                .init(
                    id: "data.removeSim",
                    title: L.t("Rút SIM, thẻ nhớ và giữ lại"),
                    detail: L.t("Nhân viên không cần SIM/thẻ nhớ để sửa máy và chúng rất dễ thất lạc. Giữ lại, trừ khi lỗi cần SIM để tái hiện (mất sóng, không nhận SIM)."),
                    icon: "sim"
                ),
            ]
        )
    }

    private static func paperworkSection(for device: ServiceChecklistDevice) -> ServiceChecklistSection {
        let serial = clean(device.serialNumber)
        let place = clean(device.purchasePlace)
        let warranty = clean(device.warrantyEndText)

        let serialLine: String
        if let serial {
            serialLine = L.t("Serial/IMEI đã lưu: %@. Đối chiếu số này với hộp, hoá đơn và mục Giới thiệu trên máy trước khi đi.", serial)
        } else {
            serialLine = L.t("Máy chưa lưu serial/IMEI — ghi lại từ hộp hoặc Cài đặt trước khi đi, vì trung tâm tra cứu bảo hành theo số này.")
        }

        let attachmentLine: String
        if device.attachmentCount > 0 {
            attachmentLine = L.t("Ứng dụng đang có %d tệp đính kèm cho máy này; mở sẵn để đối chiếu, nhưng vẫn mang bản giấy nếu có.", device.attachmentCount)
        } else {
            attachmentLine = L.t("Chưa có ảnh hoá đơn trong ứng dụng — chụp và lưu hoá đơn vào máy này trước khi đi.")
        }

        let warrantyLine: String
        if let warranty {
            warrantyLine = L.t("Gói bảo hành xa nhất hết hạn ngày %@. Hỏi trước lỗi này có thuộc diện bảo hành không, hay phải trả phí.", warranty)
        } else {
            warrantyLine = L.t("Chưa ghi ngày hết hạn bảo hành. Tìm ngày trên hoá đơn hoặc phiếu bảo hành, hoặc hỏi hãng trước khi đi để biết lỗi có được bảo hành không.")
        }

        let placeLine: String
        if let place {
            placeLine = L.t("Bạn mua ở %@. Gọi trước để hỏi giờ tiếp nhận, có cần đặt lịch không và cần mang giấy tờ gì.", place)
        } else {
            placeLine = L.t("Gọi trước cho nơi mua hoặc trung tâm bảo hành để hỏi giờ tiếp nhận, có cần đặt lịch không và cần mang giấy tờ gì.")
        }

        return ServiceChecklistSection(
            id: "paperwork",
            title: L.t("Giấy tờ và bằng chứng"),
            items: [
                .init(
                    id: "paperwork.invoiceBox",
                    title: L.t("Mang hoá đơn, phiếu bảo hành và hộp có IMEI khớp"),
                    detail: "\(serialLine) \(attachmentLine)",
                    icon: "receipt"
                ),
                .init(
                    id: "paperwork.warrantyEnd",
                    title: L.t("Biết chính xác hạn bảo hành"),
                    detail: warrantyLine,
                    icon: "calendar"
                ),
                .init(
                    id: "paperwork.purchasePlace",
                    title: L.t("Kiểm tra chính sách tiếp nhận của nơi mua"),
                    detail: placeLine,
                    icon: "store"
                ),
                .init(
                    id: "evidence.condition",
                    title: L.t("Chụp ảnh hoặc quay video tình trạng máy trước khi giao"),
                    detail: L.t("Chụp đủ các mặt, viền, màn hình đang bật sáng, cổng sạc và mọi vết trầy đã có; quay một đoạn ngắn lúc máy đang chạy. Đây là bằng chứng nếu trung tâm cho rằng hư hỏng mới phát sinh trong lúc sửa."),
                    icon: "camera"
                ),
                .init(
                    id: "evidence.fault",
                    title: L.t("Ghi lại lỗi và cách tái hiện"),
                    detail: L.t("Ghi lỗi xuất hiện khi nào, sau thao tác gì, kèm ảnh chụp thông báo lỗi. Nếu lỗi chỉ thỉnh thoảng mới xảy ra, quay video lại — không tái hiện được thì trung tâm dễ trả máy về với lý do “không thấy lỗi”."),
                    icon: "alert"
                ),
            ]
        )
    }

    private static func handoverSection() -> ServiceChecklistSection {
        ServiceChecklistSection(
            id: "handover",
            title: L.t("Đóng gói và bàn giao"),
            items: [
                .init(
                    id: "handover.accessories",
                    title: L.t("Liệt kê phụ kiện gửi kèm"),
                    detail: L.t("Chỉ gửi những món cần cho việc sửa: củ sạc, cáp, hộp, ốp, bút cảm ứng, dây đeo hoặc tay cầm. Ghi rõ từng món vào phiếu tiếp nhận để không mất hoặc tranh cãi khi nhận lại."),
                    icon: "box"
                ),
                .init(
                    id: "handover.removePersonal",
                    title: L.t("Lấy hết đồ cá nhân khỏi máy, ốp và túi đựng"),
                    detail: L.t("Kiểm tra khe SIM, thẻ nhớ, ốp, ngăn phụ và túi đựng máy. Đừng để lại thẻ ngân hàng, giấy tờ, ảnh gia đình hay chìa khoá."),
                    icon: "key"
                ),
                .init(
                    id: "handover.writtenReceipt",
                    title: L.t("Lấy phiếu tiếp nhận có đủ thông tin"),
                    detail: L.t("Phiếu phải ghi tên máy, IMEI/serial, tình trạng ngoại hình, danh sách phụ kiện, lỗi tiếp nhận, chi phí dự kiến, ngày hẹn trả và chính sách xoá dữ liệu. Chụp lại phiếu trước khi rời quầy; không có phiếu thì đừng để máy lại."),
                    icon: "stickyNote"
                ),
                .init(
                    id: "handover.dataWipe",
                    title: L.t("Hỏi rõ việc xoá dữ liệu và yêu cầu ghi vào phiếu"),
                    detail: L.t("Hỏi họ có xoá dữ liệu không, xoá lúc nào và có gọi trước không. Yêu cầu ghi câu trả lời vào phiếu; nếu họ không đồng ý, hãy tự sao lưu và xoá máy trước khi giao."),
                    icon: "database"
                ),
                .init(
                    id: "handover.quote",
                    title: L.t("Hỏi báo giá và xác nhận trước khi đồng ý sửa"),
                    detail: L.t("Yêu cầu báo giá, thời gian sửa và việc lỗi có thuộc diện bảo hành hay không trước khi họ bắt đầu. Hỏi thêm chi phí có thay đổi nếu phát sinh không, và chỉ đồng ý bằng văn bản hoặc tin nhắn."),
                    icon: "wallet"
                ),
            ]
        )
    }

    private static func pickupSection(for device: ServiceChecklistDevice) -> ServiceChecklistSection {
        let serial = clean(device.serialNumber)

        let serialLine: String
        if let serial {
            serialLine = L.t("Serial/IMEI trên máy phải là %@. Kiểm tra trong Cài đặt > Giới thiệu và trên phiếu; không ký nhận nếu số không khớp.", serial)
        } else {
            serialLine = L.t("Kiểm tra serial/IMEI trong Cài đặt > Giới thiệu và so với phiếu tiếp nhận; không ký nhận nếu số không khớp.")
        }

        return ServiceChecklistSection(
            id: "pickup",
            title: L.t("Khi nhận lại máy"),
            items: [
                .init(
                    id: "pickup.verifySerial",
                    title: L.t("Đối chiếu serial/IMEI với phiếu tiếp nhận"),
                    detail: serialLine,
                    icon: "hash"
                ),
                .init(
                    id: "pickup.inspect",
                    title: L.t("So lại ngoại hình với ảnh chụp lúc giao"),
                    detail: L.t("Xem kỹ vết trầy, móp, nứt và vết keo ở viền máy trước khi ký. Nếu có hư hỏng mới, chụp ảnh tại chỗ và hỏi ngay, đừng mang máy về rồi mới báo."),
                    icon: "camera"
                ),
                .init(
                    id: "pickup.testFunctions",
                    title: L.t("Kiểm tra chức năng tại quầy trước khi về"),
                    detail: pickupTestDetail(category: device.category),
                    icon: "checkCircle"
                ),
                .init(
                    id: "pickup.accessories",
                    title: L.t("Đếm đủ phụ kiện đã gửi"),
                    detail: L.t("Đối chiếu với danh sách trên phiếu và nhận lại đủ trước khi rời quầy. Kiểm tra cả hộp, cáp, củ sạc và ốp nếu bạn đã gửi kèm."),
                    icon: "box"
                ),
                .init(
                    id: "pickup.repairWarranty",
                    title: L.t("Nhận giấy bảo hành cho lần sửa này"),
                    detail: L.t("Hỏi linh kiện đã thay, thời hạn bảo hành của lần sửa và điều kiện áp dụng; xin phiếu hoặc biên nhận ghi rõ những thông tin đó. Chụp lại trước khi rời quầy."),
                    icon: "shieldCheck"
                ),
                .init(
                    id: "pickup.dataRestore",
                    title: L.t("Khôi phục dữ liệu và kiểm tra tài khoản"),
                    detail: L.t("Đăng nhập lại, khôi phục từ bản sao lưu và kiểm tra ảnh, danh bạ. Làm ngay tại quầy khi còn Wi-Fi, để nếu thiếu dữ liệu bạn còn báo được trước khi về."),
                    icon: "cloud"
                ),
            ]
        )
    }

    // MARK: - Per-category pickup test

    /// Which functions to exercise at the counter. A phone and a washing machine
    /// fail in different ways, and "test everything" is not a tick-box anyone can
    /// honestly tick.
    private static func pickupTestDetail(category: String) -> String {
        switch category.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
        case "phone", "tablet":
            return L.t("Thử màn hình và cảm ứng, camera trước/sau, loa, mic, sạc, Wi-Fi/4G/5G, Face ID hoặc vân tay.")
        case "laptop":
            return L.t("Thử màn hình, bàn phím, touchpad, cổng sạc, loa, webcam và Wi-Fi.")
        case "watch":
            return L.t("Thử màn hình/cảm ứng, sạc, loa/mic, cảm biến nhịp tim và dây đeo.")
        case "audio":
            return L.t("Thử kết nối Bluetooth, mic, loa và sạc hoặc hộp sạc.")
        case "tv", "console":
            return L.t("Thử màn hình, cổng HDMI, loa và tay điều khiển.")
        case "appliance":
            return L.t("Thử nguồn, các chế độ chính, rò nước và tiếng ồn bất thường.")
        default:
            return L.t("Thử đúng chức năng bạn mang đi sửa, rồi thử thêm nguồn, sạc và kết nối.")
        }
    }

    // MARK: - Helpers

    private static func clean(_ value: String?) -> String? {
        guard let value = value?.trimmingCharacters(in: .whitespacesAndNewlines),
              !value.isEmpty else { return nil }
        return value
    }
}

// MARK: - Tick state

/// The tick-boxes for one or more devices, pure and in-memory.
///
/// Deliberately a value type with no storage: the screen keeps one per device in
/// `ServiceChecklistSession` for the lifetime of the process, and a unit test can
/// exercise every rule without a UI. Nothing here is persisted — not to the API,
/// not to `UserDefaults`, not to a file.
public struct ServiceChecklistProgress: Equatable, Sendable {
    public private(set) var checkedIDs: Set<String>

    public init(checkedIDs: Set<String> = []) {
        self.checkedIDs = checkedIDs
    }

    public func isChecked(_ itemID: String) -> Bool {
        checkedIDs.contains(itemID)
    }

    public mutating func toggle(_ itemID: String) {
        if checkedIDs.contains(itemID) {
            checkedIDs.remove(itemID)
        } else {
            checkedIDs.insert(itemID)
        }
    }

    /// How many of `itemIDs` are ticked. Ids not in the checklist are ignored, so
    /// a stale id from an older build can never inflate the progress count.
    public func completedCount(in itemIDs: [String]) -> Int {
        itemIDs.reduce(into: 0) { count, id in
            if checkedIDs.contains(id) { count += 1 }
        }
    }

    public mutating func reset() {
        checkedIDs.removeAll()
    }
}
