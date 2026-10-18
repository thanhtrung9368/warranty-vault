import Foundation

// ============================================================
// ReceiptExtractInput — the two request shapes of
// POST /api/v1/ai/extract-receipt
//
// The endpoint accepts either a multipart `file` OR a JSON
// `{"attachmentId": "..."}` (openapi.yaml). The two branches are **not**
// equivalent for persistence:
//
//   * `attachmentId` — the transcript is written to `Attachment.extractedText`
//     and becomes searchable; `draft.extractedTextStored` is `true`.
//   * multipart `file` — there is no Attachment row to own the text, so
//     nothing is stored; `draft.extractedTextStored` is `false`.
//
// The scan flow therefore uploads first (an inbox item, no `deviceId`) and
// extracts second, which is what makes a scanned receipt searchable. Keeping
// the choice as a value — rather than two unrelated client methods — is what
// lets a test pin the request shape before any network call exists.
// ============================================================

/// Body of the JSON branch: exactly `{"attachmentId": "..."}`.
public struct ReceiptExtractAttachmentBody: Encodable, Equatable, Sendable {
    public let attachmentId: String

    public init(attachmentId: String) {
        self.attachmentId = attachmentId
    }
}

/// Which input a receipt extraction is sending.
public enum ReceiptExtractInput: Equatable, Sendable {

    /// The searchable branch: an already-uploaded attachment. The id is trimmed
    /// when built through `init(attachmentId:)`; a blank id is not a valid
    /// attachment and `isReadyToSend` reports it rather than letting a doomed
    /// request out.
    case attachment(id: String)

    /// The non-persisting branch: raw bytes with no Attachment row. Kept
    /// because the contract still accepts it, but the scan flow no longer uses
    /// it — it is here so the shape and its `extractedTextStored: false`
    /// consequence stay visible.
    case file(fileName: String, fileType: String, data: Data)

    /// Builds the branch the scan flow uses. The id comes from
    /// `POST /api/v1/attachments`, so it is normally already clean; trimming
    /// here means a stray newline can never become part of the JSON body.
    public init(attachmentId raw: String) {
        self = .attachment(id: raw.trimmingCharacters(in: .whitespacesAndNewlines))
    }

    /// The attachment id for the JSON branch, `nil` for the multipart one.
    public var attachmentId: String? {
        guard case let .attachment(id) = self else { return nil }
        return id
    }

    /// `true` when the server can persist the transcript for this request.
    public var storesExtractedText: Bool { attachmentId != nil }

    /// The JSON body, or `nil` for the multipart branch.
    public var attachmentBody: ReceiptExtractAttachmentBody? {
        attachmentId.map(ReceiptExtractAttachmentBody.init(attachmentId:))
    }

    /// Whether the input is complete enough to send. A blank attachment id is
    /// the one impossible shape: it would become `{"attachmentId": ""}`, which
    /// the server answers with 404/400 after a wasted round trip.
    public var isReadyToSend: Bool {
        switch self {
        case let .attachment(id):
            return !id.isEmpty
        case let .file(fileName, fileType, data):
            return !fileName.isEmpty && !fileType.isEmpty && !data.isEmpty
        }
    }
}
