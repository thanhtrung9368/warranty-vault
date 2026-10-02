import Foundation
import XCTest
@testable import WarrantyVaultKit

/// Magic-byte sniffing for attachment uploads. The Go server
/// (`api/internal/files/mime.go`) rejects any upload whose declared
/// `Content-Type` disagrees with the bytes, so these must match its whitelist
/// exactly — including HEIC, which is what an iPhone camera produces by default.
final class AttachmentFileTypeTests: KitTestCase {

    /// `signature` + zero padding, so the sniffer sees a realistic header.
    private func payload(_ signature: [UInt8], total: Int = 32) -> Data {
        var bytes = signature
        while bytes.count < total { bytes.append(0) }
        return Data(bytes)
    }

    private func isoBMFF(_ brand: String) -> Data {
        var bytes: [UInt8] = [0x00, 0x00, 0x00, 0x18]           // box size
        bytes += Array("ftyp".utf8)
        bytes += Array(brand.utf8)
        while bytes.count < 32 { bytes.append(0) }
        return Data(bytes)
    }

    // MARK: - Accepted types

    func testPNG() {
        let detected = AttachmentFileType.detect(payload([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]))
        XCTAssertEqual(detected, .init(mimeType: "image/png", fileExtension: "png"))
    }

    func testJPEG() {
        let detected = AttachmentFileType.detect(payload([0xFF, 0xD8, 0xFF, 0xE0]))
        XCTAssertEqual(detected, .init(mimeType: "image/jpeg", fileExtension: "jpg"))
    }

    func testGIF() {
        XCTAssertEqual(AttachmentFileType.detect(payload(Array("GIF87a".utf8))),
                       .init(mimeType: "image/gif", fileExtension: "gif"))
        XCTAssertEqual(AttachmentFileType.detect(payload(Array("GIF89a".utf8))),
                       .init(mimeType: "image/gif", fileExtension: "gif"))
    }

    func testWEBP() {
        var bytes = Array("RIFF".utf8)
        bytes += [0x24, 0x00, 0x00, 0x00]
        bytes += Array("WEBP".utf8)
        XCTAssertEqual(AttachmentFileType.detect(payload(bytes)),
                       .init(mimeType: "image/webp", fileExtension: "webp"))
    }

    func testPDF() {
        let detected = AttachmentFileType.detect(payload(Array("%PDF-1.7".utf8)))
        XCTAssertEqual(detected, .init(mimeType: "application/pdf", fileExtension: "pdf"))
    }

    /// The case that used to break every real receipt: an iPhone camera writes
    /// HEIC, and the uploader declared it as `image/jpeg`.
    func testHEICBrandsAreRecognised() {
        for brand in ["heic", "heix", "hevc", "mif1", "msf1"] {
            XCTAssertEqual(AttachmentFileType.detect(isoBMFF(brand)),
                           .init(mimeType: "image/heic", fileExtension: "heic"),
                           "brand \(brand)")
        }
    }

    // MARK: - Rejected types

    func testVideoAndOtherContainersAreRejected() {
        // MP4 / QuickTime have an ISO-BMFF header too — only the brand differs.
        for brand in ["isom", "mp42", "qt  ", "avc1", "M4V "] {
            XCTAssertNil(AttachmentFileType.detect(isoBMFF(brand)), "brand \(brand)")
        }
    }

    func testUnsupportedAndEmptyPayloadsAreRejected() {
        XCTAssertNil(AttachmentFileType.detect(Data()))
        XCTAssertNil(AttachmentFileType.detect(payload(Array("hello world".utf8))))
        // SVG is deliberately not on the server's whitelist.
        XCTAssertNil(AttachmentFileType.detect(payload(Array("<svg xmlns=".utf8))))
        XCTAssertNil(AttachmentFileType.detect(payload([0x00, 0x01, 0x02])))
    }

    func testShortButValidSignatureStillMatches() {
        // A truncated JPEG header is enough — we only read the first bytes.
        XCTAssertEqual(AttachmentFileType.detect(Data([0xFF, 0xD8, 0xFF])),
                       .init(mimeType: "image/jpeg", fileExtension: "jpg"))
    }

    // MARK: - Guard messages / limits

    func testLimitsMirrorTheServer() {
        XCTAssertEqual(AttachmentFileType.maxBytes, 5 * 1024 * 1024)
        XCTAssertEqual(AttachmentFileType.unsupportedMessage,
                       "Chỉ chấp nhận ảnh JPG/PNG/WEBP/GIF/HEIC hoặc PDF.")
        XCTAssertEqual(AttachmentFileType.tooLargeMessage, "File vượt quá 5MB.")
    }

    // MARK: - Receipt-scan acceptance

    func testOCRPayloadsThatPassThroughUntouched() {
        XCTAssertFalse(AttachmentFileType.ocrNeedsTranscode(payload([0xFF, 0xD8, 0xFF])))
        XCTAssertFalse(AttachmentFileType.ocrNeedsTranscode(
            payload([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])))

        var webp = Array("RIFF".utf8)
        webp += [0x24, 0x00, 0x00, 0x00]
        webp += Array("WEBP".utf8)
        XCTAssertFalse(AttachmentFileType.ocrNeedsTranscode(payload(webp)))
    }

    /// The endpoint is stricter than the attachment whitelist, so HEIC (the
    /// iPhone default), GIF and PDF all have to be re-encoded before upload.
    func testOCRPayloadsThatNeedTranscoding() {
        XCTAssertTrue(AttachmentFileType.ocrNeedsTranscode(isoBMFF("heic")))
        XCTAssertTrue(AttachmentFileType.ocrNeedsTranscode(isoBMFF("mif1")))
        XCTAssertTrue(AttachmentFileType.ocrNeedsTranscode(payload(Array("GIF89a".utf8))))
        XCTAssertTrue(AttachmentFileType.ocrNeedsTranscode(payload(Array("%PDF-1.7".utf8))))
        XCTAssertTrue(AttachmentFileType.ocrNeedsTranscode(isoBMFF("isom")), "video")
        XCTAssertTrue(AttachmentFileType.ocrNeedsTranscode(Data()))
    }

    func testOCRWhitelistMatchesTheHandler() {
        XCTAssertEqual(AttachmentFileType.ocrAcceptedMIMEs,
                       ["image/jpeg", "image/png", "image/webp"])
        XCTAssertEqual(AttachmentFileType.ocrUnsupportedMessage,
                       "Chỉ hỗ trợ ảnh JPEG, PNG hoặc WEBP.")
    }
}
