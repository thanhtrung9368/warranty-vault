import Foundation

// MARK: - Attachment file-type sniffing

/// Magic-byte detection for the MIME whitelist the Go service enforces on
/// attachment uploads (`api/internal/files/mime.go::AllowedMIMEs`).
///
/// Why this exists: the server rejects any upload whose declared
/// `Content-Type` disagrees with the bytes it actually received
/// ("Nội dung file không khớp định dạng khai báo"). An iPhone camera writes
/// **HEIC** by default, so declaring every photo as `image/jpeg` (what the
/// uploader used to do) made most real receipts fail. Sniffing the header
/// first lets the client declare the truth, and refuse videos / unsupported
/// formats before spending a round trip.
///
/// Keep the accepted set in sync with `AllowedMIMEs`:
/// JPG · PNG · WEBP · GIF · HEIC/HEIF · PDF.
public enum AttachmentFileType {

    public struct Detected: Equatable, Sendable {
        public let mimeType: String
        public let fileExtension: String

        public init(mimeType: String, fileExtension: String) {
            self.mimeType = mimeType
            self.fileExtension = fileExtension
        }
    }

    /// Longest header the sniffers inspect (ISO-BMFF `ftyp` box).
    private static let sniffLength = 12

    /// Detects the file type from `data`'s leading bytes.
    /// - Returns: the canonical MIME + extension, or `nil` when the payload is
    ///   not one of the whitelisted types (e.g. a video).
    public static func detect(_ data: Data) -> Detected? {
        let header = [UInt8](data.prefix(sniffLength))
        guard !header.isEmpty else { return nil }

        if matches(header, [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]) {
            return Detected(mimeType: "image/png", fileExtension: "png")
        }
        if matches(header, [0xFF, 0xD8, 0xFF]) {
            return Detected(mimeType: "image/jpeg", fileExtension: "jpg")
        }
        if matches(header, Array("GIF87a".utf8)) || matches(header, Array("GIF89a".utf8)) {
            return Detected(mimeType: "image/gif", fileExtension: "gif")
        }
        // RIFF....WEBP
        if header.count >= 12,
           Array(header[0..<4]) == Array("RIFF".utf8),
           Array(header[8..<12]) == Array("WEBP".utf8) {
            return Detected(mimeType: "image/webp", fileExtension: "webp")
        }
        if matches(header, Array("%PDF".utf8)) {
            return Detected(mimeType: "application/pdf", fileExtension: "pdf")
        }
        if let brand = isoBrand(header), heicBrands.contains(brand) {
            return Detected(mimeType: "image/heic", fileExtension: "heic")
        }
        return nil
    }

    /// Vietnamese message for a rejected payload, mirroring the server's
    /// `"Chỉ chấp nhận JPG/PNG/WEBP/GIF/HEIC hoặc PDF"`.
    public static let unsupportedMessage = L.t("Chỉ chấp nhận ảnh JPG/PNG/WEBP/GIF/HEIC hoặc PDF.")

    /// Per-file cap the server enforces (`services.MaxAttachmentBytes`).
    public static let maxBytes = 5 * 1024 * 1024

    /// Vietnamese message for an oversized payload.
    public static let tooLargeMessage = L.t("File vượt quá 5MB.")

    // MARK: - OCR (receipt scan) acceptance
    //
    // `POST /api/v1/ai/extract-receipt` is *stricter* than the attachment
    // whitelist: it accepts JPEG / PNG / WEBP **and PDF** only — GIF and HEIC
    // are rejected with a clear 400 before any paid model call — and, like the
    // attachment path, validates the declared Content-Type against the magic
    // bytes (`api/internal/handlers/ai.go`).
    //
    // PDFs go to the model as Anthropic `document` blocks
    // (`services/ai_extract.go`), so a PDF is a supported input that must be
    // uploaded **byte-for-byte**: it is not an image and cannot be re-encoded
    // as one.

    public static let ocrAcceptedMIMEs: Set<String> = [
        "image/jpeg", "image/png", "image/webp", "application/pdf",
    ]

    /// Vietnamese message for a payload the OCR endpoint can't take
    /// (mirrors the server's `Chỉ hỗ trợ ảnh JPEG, PNG, WEBP hoặc PDF`).
    public static let ocrUnsupportedMessage = L.t("Chỉ hỗ trợ ảnh JPEG, PNG, WEBP hoặc PDF.")

    /// What the receipt scan has to do with `data` before uploading it.
    public enum OCRPayload: Equatable, Sendable {
        /// Send it as-is, declaring `mimeType` (JPEG / PNG / WEBP / PDF).
        case asIs(mimeType: String, fileExtension: String)
        /// A still image the endpoint won't take (an iPhone camera writes HEIC;
        /// GIF is the other one): re-encode as JPEG first.
        case transcodeToJPEG
        /// Nothing the endpoint could ever read (video, empty, unknown bytes).
        case unsupported
    }

    /// Decides the upload shape for a receipt scan.
    ///
    /// The PDF case matters: it is accepted (`.asIs`), so it can never fall
    /// through to the image transcode step — decoding a PDF with `UIImage(data:)`
    /// yields nothing, and *pretending* to convert it would silently lose the
    /// receipt. Anything that is not an `image/*` the endpoint accepts is
    /// `unsupported`, not "transcode me".
    public static func ocrPayload(for data: Data) -> OCRPayload {
        guard let detected = detect(data) else { return .unsupported }
        if ocrAcceptedMIMEs.contains(detected.mimeType) {
            return .asIs(mimeType: detected.mimeType, fileExtension: detected.fileExtension)
        }
        // HEIC / GIF: images the endpoint rejects but `UIImage` can decode.
        if detected.mimeType.hasPrefix("image/") { return .transcodeToJPEG }
        return .unsupported
    }

    // MARK: - Private

    /// ISO-BMFF brands that mean "HEIC/HEIF image" rather than video/MP4.
    private static let heicBrands: Set<String> = [
        "heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs",
        "mif1", "msf1",
    ]

    private static func matches(_ header: [UInt8], _ signature: [UInt8]) -> Bool {
        guard header.count >= signature.count else { return false }
        return Array(header[0..<signature.count]) == signature
    }

    /// Reads the major brand of an ISO-BMFF box: bytes 4..7 are `ftyp`, the
    /// major brand is bytes 8..11.
    private static func isoBrand(_ header: [UInt8]) -> String? {
        guard header.count >= 12,
              Array(header[4..<8]) == Array("ftyp".utf8) else { return nil }
        return String(bytes: header[8..<12], encoding: .ascii)?.lowercased()
    }
}
