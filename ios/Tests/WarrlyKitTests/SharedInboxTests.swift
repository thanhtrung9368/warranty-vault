import XCTest
@testable import WarrlyKit

// The Share Extension hand-off is the one path where a failure is invisible:
/// the extension runs in another process, the app may not be running at all, and
/// the file is the only copy the user has. These tests cover the queue itself
/// (atomic enough to never claim a half-written file, never deleting a payload
/// on failure) and the copy the extension shows when it rejects something.
final class SharedInboxTests: XCTestCase {

    private var root: URL!

    override func setUpWithError() throws {
        try super.setUpWithError()
        root = FileManager.default.temporaryDirectory
            .appendingPathComponent("wv-shared-inbox-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    }

    override func tearDownWithError() throws {
        if let root { try? FileManager.default.removeItem(at: root) }
        try super.tearDownWithError()
    }

    private var store: SharedInboxStore { SharedInboxStore(rootURL: root) }

    // MARK: - Fixtures

    private var jpegData: Data {
        Data([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46])
    }

    private var pngData: Data {
        Data([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00])
    }

    private var heicData: Data {
        var data = Data([0x00, 0x00, 0x00, 0x18])
        data.append(contentsOf: Array("ftypheic".utf8))
        data.append(contentsOf: [0x00, 0x00, 0x00, 0x00])
        return data
    }

    private var pdfData: Data {
        Data(Array("%PDF-1.7".utf8) + [0x0A, 0x25, 0x25, 0x45, 0x4F, 0x46])
    }

    // MARK: - Accepted formats

    func testEnqueueSniffsTheTypeAndStoresThePayload() throws {
        let item = try store.enqueue(data: jpegData, fileName: "IMG_1234")

        XCTAssertEqual(item.mimeType, "image/jpeg")
        XCTAssertEqual(item.fileExtension, "jpg")
        // The provider's name had no extension: the sniffed one is appended so
        // the inbox row does not read `IMG_1234` for a JPEG.
        XCTAssertEqual(item.fileName, "IMG_1234.jpg")
        XCTAssertEqual(item.byteCount, jpegData.count)
        XCTAssertEqual(item.attempts, 0)
        XCTAssertNil(item.lastError)

        XCTAssertEqual(store.pendingCount(), 1)
        XCTAssertEqual(try store.payload(for: item), jpegData)
    }

    func testEnqueueAcceptsPNGHEICAndPDF() throws {
        let png = try store.enqueue(data: pngData, fileName: "receipt.png")
        let heic = try store.enqueue(data: heicData, fileName: "IMG_5678.HEIC")
        let pdf = try store.enqueue(data: pdfData, fileName: "Hoa don.pdf")

        XCTAssertEqual(png.mimeType, "image/png")
        XCTAssertEqual(heic.mimeType, "image/heic")
        XCTAssertEqual(heic.fileName, "IMG_5678.HEIC")
        XCTAssertEqual(pdf.mimeType, "application/pdf")
        XCTAssertEqual(pdf.fileName, "Hoa don.pdf")
        XCTAssertEqual(store.pendingCount(), 3)
    }

    func testEnqueueRejectsGIFAndWEBPEvenThoughAttachmentsAllowThem() throws {
        // The server's attachment whitelist accepts GIF/WEBP; the share sheet
        // deliberately does not, because they are not receipt formats and the
        // rejection copy names exactly JPG/PNG/HEIC/PDF.
        let gif = Data(Array("GIF89a".utf8) + [0x00, 0x00])
        XCTAssertThrowsError(try store.enqueue(data: gif, fileName: "anim.gif")) {
            XCTAssertEqual($0 as? SharedInboxError, .unsupportedType)
        }

        var webp = Data(Array("RIFF".utf8))
        webp.append(contentsOf: [0x00, 0x00, 0x00, 0x00])
        webp.append(contentsOf: Array("WEBP".utf8))
        XCTAssertThrowsError(try store.enqueue(data: webp, fileName: "photo.webp")) {
            XCTAssertEqual($0 as? SharedInboxError, .unsupportedType)
        }

        XCTAssertEqual(store.pendingCount(), 0)
    }

    func testEnqueueRejectsAnythingThatIsNotAReceipt() throws {
        XCTAssertThrowsError(
            try store.enqueue(data: Data("just some text".utf8), fileName: "notes.txt")
        ) {
            XCTAssertEqual($0 as? SharedInboxError, .unsupportedType)
        }
        XCTAssertThrowsError(try store.enqueue(data: Data(), fileName: "empty.jpg")) {
            XCTAssertEqual($0 as? SharedInboxError, .unsupportedType)
        }
        XCTAssertEqual(store.pendingCount(), 0)
    }

    func testEnqueueRejectsOverTheFiveMegabyteCapBeforeWriting() throws {
        // Reuses `AttachmentFileType.maxBytes` — the same constant the server's
        // `MAX_ATTACHMENT_BYTES` mirrors.
        let oversized = Data(repeating: 0xAA, count: AttachmentFileType.maxBytes + 1)
        XCTAssertThrowsError(try store.enqueue(data: oversized, fileName: "big.pdf")) {
            XCTAssertEqual($0 as? SharedInboxError, .tooLarge)
        }
        XCTAssertEqual(store.pendingCount(), 0)
        let leftovers = try FileManager.default.contentsOfDirectory(atPath: root.path)
        XCTAssertEqual(leftovers, [], "a rejected enqueue must not leave a partial item")
    }

    // MARK: - Queue behaviour

    func testPendingItemsAreOldestFirst() throws {
        let older = try store.enqueue(
            data: jpegData,
            fileName: "older.jpg",
            now: Date(timeIntervalSince1970: 1_000)
        )
        let newer = try store.enqueue(
            data: pngData,
            fileName: "newer.png",
            now: Date(timeIntervalSince1970: 2_000)
        )

        XCTAssertEqual(store.pendingItems().map(\.id), [older.id, newer.id])
    }

    func testIncompleteStagingDirectoryIsNeverClaimed() throws {
        let staging = root.appendingPathComponent(".staging-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: staging, withIntermediateDirectories: true)
        try jpegData.write(to: staging.appendingPathComponent(SharedInbox.payloadFileName))

        XCTAssertEqual(store.pendingItems(), [])
        XCTAssertEqual(store.pendingCount(), 0)
    }

    func testMetadataWithoutPayloadIsIgnoredRatherThanUploadedEmpty() throws {
        let item = try store.enqueue(data: jpegData, fileName: "receipt.jpg")
        try FileManager.default.removeItem(
            at: root.appendingPathComponent(item.id)
                .appendingPathComponent(SharedInbox.payloadFileName)
        )

        XCTAssertEqual(store.pendingItems(), [])
        XCTAssertThrowsError(try store.payload(for: item)) {
            XCTAssertEqual($0 as? SharedInboxError, .unreadable)
        }
    }

    func testTruncatedPayloadIsUnreadable() throws {
        let item = try store.enqueue(data: jpegData, fileName: "receipt.jpg")
        try Data([0xFF, 0xD8]).write(
            to: root.appendingPathComponent(item.id)
                .appendingPathComponent(SharedInbox.payloadFileName)
        )

        XCTAssertThrowsError(try store.payload(for: item)) {
            XCTAssertEqual($0 as? SharedInboxError, .unreadable)
        }
    }

    func testFailureKeepsThePayloadAndRecordsTheAttempt() throws {
        let item = try store.enqueue(data: jpegData, fileName: "receipt.jpg")

        let updated = store.markFailure(
            item,
            message: "Mất kết nối",
            now: Date(timeIntervalSince1970: 3_000)
        )

        XCTAssertEqual(updated.attempts, 1)
        XCTAssertEqual(updated.lastError, "Mất kết nối")
        XCTAssertEqual(updated.lastAttemptAt, Date(timeIntervalSince1970: 3_000))

        // Still there: a failed upload must never delete the only copy.
        XCTAssertEqual(store.pendingCount(), 1)
        XCTAssertEqual(try store.payload(for: item), jpegData)
        XCTAssertEqual(store.pendingItems().first?.attempts, 1)
        XCTAssertEqual(store.pendingItems().first?.lastError, "Mất kết nối")
    }

    func testRemoveDeletesOnlyThatItem() throws {
        let keep = try store.enqueue(data: jpegData, fileName: "keep.jpg")
        let remove = try store.enqueue(data: pngData, fileName: "remove.png")

        store.remove(remove)

        XCTAssertEqual(store.pendingItems().map(\.id), [keep.id])
        XCTAssertEqual(try store.payload(for: keep), jpegData)
    }

    // MARK: - File names

    func testDisplayFileNameReplacesHeaderAndPathCharacters() {
        let name = SharedInbox.displayFileName(
            "../../etc/pa\"ss\r\nwd.pdf",
            fileExtension: "pdf"
        )

        XCTAssertFalse(name.contains("/"))
        XCTAssertFalse(name.contains("\""))
        XCTAssertFalse(name.contains("\r"))
        XCTAssertFalse(name.contains("\n"))
        XCTAssertTrue(name.hasSuffix(".pdf"))
        // `lastPathComponent` already dropped the directories; the remainder is
        // made harmless rather than rejected.
        XCTAssertTrue(name.contains("pa"))
    }

    func testDisplayFileNameForcesTheSniffedExtension() {
        // A provider can suggest `.jpg` for bytes that are actually HEIC (or no
        // name at all); the extension must follow the bytes.
        XCTAssertTrue(
            SharedInbox.displayFileName("IMG_0001.JPG", fileExtension: "heic")
                .hasSuffix(".heic")
        )
        XCTAssertTrue(
            SharedInbox.displayFileName("receipt.jpeg", fileExtension: "jpg")
                .hasSuffix(".jpeg")
        )
    }

    func testDisplayFileNameFallsBackWhenTheProviderHasNoName() {
        let name = SharedInbox.displayFileName(
            nil,
            fileExtension: "png",
            now: Date(timeIntervalSince1970: 1_700_000_000)
        )
        XCTAssertEqual(name, "shared-1700000000.png")
    }

    func testDisplayFileNameIsCappedAtAReasonableLength() {
        let name = SharedInbox.displayFileName(
            String(repeating: "a", count: 400),
            fileExtension: "pdf"
        )
        XCTAssertEqual(name.count, 120)
        XCTAssertTrue(name.hasSuffix(".pdf"))
    }

    // MARK: - Copy

    func testRejectionCopyIsBilingualAndReusesTheTooLargeMessage() {
        L.withLanguage(.vi) {
            XCTAssertEqual(
                SharedInboxError.unsupportedType.message,
                "Chỉ chấp nhận ảnh JPG/PNG/HEIC hoặc PDF."
            )
            XCTAssertEqual(
                SharedInboxError.tooLarge.message,
                AttachmentFileType.tooLargeMessage
            )
            XCTAssertEqual(
                SharedInboxError.unreadable.message,
                "Không đọc được tệp được chia sẻ."
            )
        }
        L.withLanguage(.en) {
            XCTAssertEqual(
                SharedInboxError.unsupportedType.message,
                "Only JPG, PNG, HEIC images or PDFs are accepted."
            )
            XCTAssertEqual(
                SharedInboxError.tooLarge.message,
                "The file is over 5MB."
            )
            XCTAssertEqual(
                SharedInboxError.unreadable.message,
                "Could not read the shared file."
            )
        }
    }

    // MARK: - Language bridge

    func testSharedLanguagePrefersTheMirroredAppChoice() {
        let defaults = makeDefaults()
        SharedInboxLanguage.publish(.en, defaults: defaults)

        XCTAssertEqual(
            SharedInboxLanguage.resolved(defaults: defaults, preferredLanguages: ["vi-VN"]),
            .en
        )
    }

    func testSharedLanguageFallsBackToTheDeviceThenEnglish() {
        let defaults = makeDefaults()

        XCTAssertEqual(
            SharedInboxLanguage.resolved(defaults: defaults, preferredLanguages: ["vi-VN"]),
            .vi
        )
        XCTAssertEqual(
            SharedInboxLanguage.resolved(defaults: defaults, preferredLanguages: ["fr-FR"]),
            .en
        )
        XCTAssertEqual(
            SharedInboxLanguage.resolved(defaults: defaults, preferredLanguages: []),
            .en
        )
    }

    func testPublishingNilClearsTheMirroredChoice() {
        let defaults = makeDefaults()
        SharedInboxLanguage.publish(.vi, defaults: defaults)
        XCTAssertEqual(
            SharedInboxLanguage.resolved(defaults: defaults, preferredLanguages: []),
            .vi
        )

        SharedInboxLanguage.publish(nil, defaults: defaults)

        XCTAssertEqual(
            SharedInboxLanguage.resolved(defaults: defaults, preferredLanguages: ["en-US"]),
            .en
        )
    }

    // MARK: - Helpers

    private func makeDefaults() -> UserDefaults {
        // A throwaway suite, not `.standard`: the test process shares standard
        // defaults with unrelated suites and a leftover key would make the
        // fallback assertions order-dependent.
        let suite = "wv.shared-inbox.tests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defaults.removePersistentDomain(forName: suite)
        addTeardownBlock {
            defaults.removePersistentDomain(forName: suite)
        }
        return defaults
    }
}
