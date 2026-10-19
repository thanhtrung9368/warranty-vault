import Foundation

// Each method here mirrors one route in openapi.yaml. Group by tag for
// readability; the underlying APIClient handles auth + JSON.

extension APIClient {

    // MARK: - Auth

    public func register(_ input: RegisterInput) async throws -> AuthSuccess {
        try await request("POST", "/api/v1/auth/register", body: input, authenticated: false)
    }

    public func login(_ input: LoginInput) async throws -> AuthSuccess {
        try await request("POST", "/api/v1/auth/login", body: input, authenticated: false)
    }

    public func logout() async throws {
        let _: EmptyResponse = try await request("POST", "/api/v1/auth/logout")
    }

    public func me() async throws -> User {
        struct Wrapper: Decodable { let user: User }
        let w: Wrapper = try await request("GET", "/api/v1/auth/me")
        return w.user
    }

    /// Updates the profile — display name and/or language.
    ///
    /// Only the fields whose `Field` is not `.unchanged` are sent, which is the
    /// tri-state the contract asks for: `locale: .set("vi")` stores Vietnamese,
    /// `.clear` drops back to "decide per request", and `.unchanged` cannot
    /// accidentally erase an unrelated field.
    ///
    /// The server stores `locale` because its **cron** has no request to read a
    /// language from: push notifications and email are rendered long after the
    /// app is gone, so "which language does this person want" has to live in the
    /// database, not just in this process (docs/I18N_PLAN.md §2.3).
    public func updateProfile(_ input: UpdateProfileInput) async throws -> UpdateProfileResult {
        try await request("PATCH", "/api/v1/auth/me", body: input)
    }

    public func forgotPassword(email: String) async throws {
        struct Body: Encodable { let email: String }
        let _: EmptyResponse = try await request(
            "POST", "/api/v1/auth/forgot", body: Body(email: email), authenticated: false
        )
    }

    public func changePassword(_ input: ChangePasswordInput) async throws -> ChangePasswordResult {
        try await request("POST", "/api/v1/auth/change-password", body: input)
    }

    /// Permanently deletes the signed-in account. The server requires the
    /// current password so a stolen bearer token can't nuke the account.
    public func deleteAccount(password: String) async throws {
        struct Body: Encodable { let password: String }
        let _: EmptyResponse = try await request(
            "DELETE", "/api/v1/auth/me", body: Body(password: password)
        )
    }

    // MARK: - Email change (2 steps)

    /// Step 1 of 2: asks the server to mail a single-use, 30-minute token to
    /// `newEmail`. Requires the current password, so a stolen bearer token
    /// alone cannot move the account. **The account email does not change
    /// here** — the old address keeps working until step 2 succeeds.
    ///
    /// The response is deliberately neutral (same `message` whether the address
    /// is free or already taken by someone else) and carries **no token**: the
    /// raw token is only in the email, which is why `EmailChangeRules` exists to
    /// pull it out of what the user pastes.
    public func requestEmailChange(_ input: EmailChangeInput) async throws -> EmailChangeResult {
        try await request("POST", "/api/v1/auth/change-email", body: input)
    }

    /// Step 2 of 2: consumes the token from the email.
    ///
    /// Unauthenticated on purpose — the token *is* the credential, and it may
    /// have been requested on another device. On success the server revokes
    /// **every** session (like a password reset), so the caller must clear the
    /// local session and send the user back to login with the new address.
    public func confirmEmailChange(token: String) async throws -> ConfirmEmailChangeResult {
        struct Body: Encodable { let token: String }
        return try await request(
            "POST", "/api/v1/auth/confirm-email-change",
            body: Body(token: token), authenticated: false
        )
    }

    // MARK: - Device sessions

    /// The caller's own **active** login sessions, most recently used first
    /// (at most 100). Revoked and expired rows are filtered out server-side, so
    /// an empty array means "nothing else is signed in", not "we didn't ask".
    ///
    /// Unrelated to `listPushSubscriptions()`: that one lists notification
    /// targets, and deleting one only stops pushes.
    public func listSessions() async throws -> [SessionSummary] {
        let body: SessionList = try await request("GET", "/api/v1/auth/sessions")
        return body.sessions ?? []
    }

    /// Revokes one session by its `Session` row id (never a token).
    ///
    /// Idempotent: a second call is a 200 with `alreadyRevoked = true`. Revoking
    /// the **current** session is allowed and returns `current = true` — the
    /// stored bearer is dead from that moment, so the caller must clear the
    /// Keychain and send the user back to login (`EmailChangeSheet` does the
    /// same after an email change revokes every session).
    public func revokeSession(id: String) async throws -> SessionRevokeResult {
        try await request("DELETE", "/api/v1/auth/sessions/\(id)")
    }

    // MARK: - Backup

    /// Downloads the full account backup as raw JSON bytes (v5 payload).
    public func exportBackup() async throws -> Data {
        try await rawDataRequest("GET", "/api/v1/backup/export")
    }

    /// Imports a previously-exported backup file. `mode` is "merge" or "replace".
    public func importBackup(_ json: Data, mode: String) async throws -> ImportResult {
        let data = try await rawDataRequest(
            "POST", "/api/v1/backup/import",
            query: [.init(name: "mode", value: mode)],
            rawBody: json
        )
        struct Wrapper: Decodable { let result: ImportResult }
        return try Self.decoder.decode(Wrapper.self, from: data).result
    }

    // MARK: - Catalog

    public func catalog() async throws -> Catalog {
        try await request("GET", "/api/v1/catalog")
    }

    // MARK: - Devices

    public struct DeviceListFilter: Sendable {
        public var q: String?
        public var category: String?
        public var status: DeviceStatus?
        public var sort: String?  // "purchaseDate" | "warrantyEndDate" | "price" | "name"
        public var dir: String?   // "asc" | "desc"

        public init(q: String? = nil, category: String? = nil,
                    status: DeviceStatus? = nil, sort: String? = nil, dir: String? = nil) {
            self.q = q; self.category = category; self.status = status
            self.sort = sort; self.dir = dir
        }

        var queryItems: [URLQueryItem] {
            var items: [URLQueryItem] = []
            if let q { items.append(.init(name: "q", value: q)) }
            if let category { items.append(.init(name: "category", value: category)) }
            if let status { items.append(.init(name: "status", value: status.rawValue)) }
            if let sort { items.append(.init(name: "sort", value: sort)) }
            if let dir { items.append(.init(name: "dir", value: dir)) }
            return items
        }
    }

    public func listDevices(filter: DeviceListFilter = .init()) async throws -> [Device] {
        struct Wrapper: Decodable { let devices: [Device] }
        let w: Wrapper = try await request(
            "GET", "/api/v1/devices", query: filter.queryItems
        )
        return w.devices
    }

    public func getDevice(id: String) async throws -> DeviceDetailBody {
        let w: DeviceDetail = try await request("GET", "/api/v1/devices/\(id)")
        return w.device
    }

    /// Creates a device and returns it **together with the serial advisories**
    /// the server attached. The create is never rejected because of a warning —
    /// the device exists by the time this returns; the caller only has to show
    /// the yellow note (and must not present it as a failure).
    ///
    /// The reminder schedule (`DeviceInput.leadDays`) travels in the same body:
    /// normalised descending, 1…5 entries in `0...365`, or omitted so the server
    /// applies its `[30, 7]` default. An empty array would be a 400
    /// (`fieldErrors.leadDays`), which is why callers build it with
    /// `LeadDaysRules.wireValue`.
    ///
    /// The activation trio (`activationRequired`, `activatedAt`,
    /// `extendedCoverBuyBy`) rides in the same body through `DeviceInput` — the
    /// form sends it, and `WarrantyActivation.apply` is the only supported way to
    /// populate it.
    public func createDevice(_ input: DeviceInput) async throws -> DeviceSaveResult {
        try await request("POST", "/api/v1/devices", body: input)
    }

    /// Same contract as `createDevice`, including `warnings` and the activation
    /// fields. The device being edited is excluded from the duplicate-serial probe
    /// server-side, so saving an unchanged serial does not warn about "duplicating
    /// itself".
    ///
    /// `leadDays` is accepted here too. It is the one field a PATCH does **not**
    /// replace when omitted (`null`/absent means "keep the stored schedule"),
    /// but the form sends it anyway so the save states the schedule explicitly.
    /// `activatedAt` / `extendedCoverBuyBy` are full-replacement fields: omitted
    /// means cleared, which is why `DeviceDetailView.saveStatus` and the form both
    /// carry them with `WarrantyActivation.apply`.
    public func updateDevice(id: String, _ input: DeviceInput) async throws -> DeviceSaveResult {
        try await request("PATCH", "/api/v1/devices/\(id)", body: input)
    }

    public func deleteDevice(id: String) async throws {
        let _: EmptyResponse = try await request("DELETE", "/api/v1/devices/\(id)")
    }

    // MARK: - Warranties

    /// Creates a warranty on a device.
    ///
    /// The whole contract-terms block rides in the same `WarrantyInput` body:
    /// `component`, `scope`, `cap`, `deductible`, `exclusions`, `region`,
    /// `transferable`, `claimsAllowed`, `claimsUsed`. Build it through
    /// `WarrantyTerms.apply(to:)` rather than setting the fields one by one —
    /// that helper is what keeps the nine fields and their nil/zero rules in one
    /// place, and it always sends `claimsUsed` (`0` is the contract's default).
    public func createWarranty(deviceId: String, _ input: WarrantyInput) async throws -> Warranty {
        struct Wrapper: Decodable { let warranty: Warranty }
        let w: Wrapper = try await request(
            "POST", "/api/v1/devices/\(deviceId)/warranties", body: input
        )
        return w.warranty
    }

    /// Updates a warranty. Same body and same nine contract-term fields as
    /// `createWarranty`; the response carries them back on the `Warranty`.
    public func updateWarranty(id: String, _ input: WarrantyInput) async throws -> Warranty {
        struct Wrapper: Decodable { let warranty: Warranty }
        let w: Wrapper = try await request("PATCH", "/api/v1/warranties/\(id)", body: input)
        return w.warranty
    }

    public func deleteWarranty(id: String) async throws {
        let _: EmptyResponse = try await request("DELETE", "/api/v1/warranties/\(id)")
    }

    public func dismissReminder(warrantyId: String) async throws {
        let _: EmptyResponse = try await request(
            "POST", "/api/v1/warranties/\(warrantyId)/reminder"
        )
    }

    public func restoreReminder(warrantyId: String) async throws {
        let _: EmptyResponse = try await request(
            "DELETE", "/api/v1/warranties/\(warrantyId)/reminder"
        )
    }

    // MARK: - Claims ("Sửa chữa & bảo hành")

    /// Optional filters on `GET /api/v1/claims`. Both are optional and both are
    /// server-side; omitting them returns the caller's claims across every
    /// device. The device detail uses `deviceId` through `WarrantiesStore`; the
    /// status filter exists for a future cross-device "đang sửa" read and is
    /// tested so it cannot silently rot.
    public struct ClaimListFilter: Sendable {
        public var deviceId: String?
        public var status: ClaimStatus?

        public init(deviceId: String? = nil, status: ClaimStatus? = nil) {
            self.deviceId = deviceId
            self.status = status
        }

        var queryItems: [URLQueryItem] {
            var items: [URLQueryItem] = []
            if let deviceId { items.append(.init(name: "deviceId", value: deviceId)) }
            if let status { items.append(.init(name: "status", value: status.rawValue)) }
            return items
        }
    }

    /// `GET /api/v1/claims` — the caller's claims, optionally filtered.
    ///
    /// The documented response is the list-shaped `{"claims": [...]}` used by
    /// every other collection in this API. A bare JSON array is accepted too,
    /// so a differently wrapped server cannot make the whole feature look
    /// empty. A payload with no rows is `[]` in both shapes.
    public func listClaims(filter: ClaimListFilter = ClaimListFilter()) async throws -> [Claim] {
        let data = try await rawRequest("GET", "/api/v1/claims", query: filter.queryItems)
        return try Self.decodeClaimList(data)
    }

    /// `GET /api/v1/claims/{id}` — one claim.
    ///
    /// Same envelope leniency as `listClaims`: `{"claim": {...}}` or the bare
    /// object.
    public func getClaim(id: String) async throws -> Claim {
        let data = try await rawRequest("GET", "/api/v1/claims/\(id)")
        guard let claim = Self.decodeClaimIfPresent(data) else {
            throw APIError.decoding("claim response contained no claim")
        }
        return claim
    }

    /// `POST /api/v1/claims`.
    ///
    /// A second `OPEN`/`IN_REPAIR` claim for the same device is a **409**
    /// `limit_reached`; map the thrown error through `ClaimRules.saveFailure`
    /// so the form can offer the claim that is already open instead of a
    /// generic failure.
    ///
    /// The return value is best-effort. The claim exists once this returns
    /// successfully (2xx), and the device-detail section re-reads the list
    /// afterwards; a server that answers 201 with no body therefore still
    /// counts as success. `nil` means "saved, but the response carried no
    /// claim to decode", never "not saved".
    @discardableResult
    public func createClaim(_ input: ClaimInput) async throws -> Claim? {
        let data = try await rawRequest("POST", "/api/v1/claims", body: input)
        return Self.decodeClaimIfPresent(data)
    }

    /// `PATCH /api/v1/claims/{id}`. Same body and same 409 rule as
    /// `createClaim`.
    ///
    /// `closedAt` is not part of `ClaimInput` and is never sent: the server sets
    /// it when the status becomes closed.
    @discardableResult
    public func updateClaim(id: String, _ input: ClaimInput) async throws -> Claim? {
        let data = try await rawRequest("PATCH", "/api/v1/claims/\(id)", body: input)
        return Self.decodeClaimIfPresent(data)
    }

    public func deleteClaim(id: String) async throws {
        let _: EmptyResponse = try await request("DELETE", "/api/v1/claims/\(id)")
    }

    /// `{"claims": [...]}` — the list envelope used by every other collection.
    private struct ClaimListBody: Decodable {
        let claims: [Claim]

        init(from decoder: Decoder) throws {
            if let keyed = try? decoder.container(keyedBy: CodingKeys.self),
               keyed.contains(.claims) {
                claims = try keyed.decodeIfPresent([Claim].self, forKey: .claims) ?? []
            } else {
                claims = try decoder.singleValueContainer().decode([Claim].self)
            }
        }

        enum CodingKeys: String, CodingKey { case claims }
    }

    /// `{"claim": {...}}` — the single-object envelope.
    private struct ClaimBody: Decodable {
        let claim: Claim

        init(from decoder: Decoder) throws {
            if let keyed = try? decoder.container(keyedBy: CodingKeys.self),
               keyed.contains(.claim) {
                claim = try keyed.decode(Claim.self, forKey: .claim)
            } else {
                claim = try decoder.singleValueContainer().decode(Claim.self)
            }
        }

        enum CodingKeys: String, CodingKey { case claim }
    }

    private static func decodeClaimList(_ data: Data) throws -> [Claim] {
        do {
            return try decoder.decode(ClaimListBody.self, from: data).claims
        } catch {
            throw APIError.decoding(error.localizedDescription)
        }
    }

    /// A write/get response that may be empty (204) or use either envelope.
    /// `nil` only when there are no bytes at all.
    private static func decodeClaimIfPresent(_ data: Data) -> Claim? {
        guard !data.isEmpty else { return nil }
        if let body = try? decoder.decode(ClaimBody.self, from: data) {
            return body.claim
        }
        return try? decoder.decode(Claim.self, from: data)
    }

    // MARK: - Attachments

    public func listAttachments(deviceId: String) async throws -> [AttachmentMeta] {
        struct Wrapper: Decodable { let attachments: [AttachmentMeta] }
        let w: Wrapper = try await request("GET", "/api/v1/devices/\(deviceId)/attachments")
        return w.attachments
    }

    /// Uploads a file to `POST /api/v1/attachments`, optionally filing it under
    /// a device at the same time.
    ///
    /// `deviceId` is optional by contract. With one, this is the old per-device
    /// upload (the endpoint it used to hit, `POST /api/v1/devices/{id}/attachments`,
    /// was folded into this one so both paths share the same MIME/size/quota
    /// rules). Without one, the file becomes an **inbox item**: it consumes none
    /// of any device's five slots and waits in `GET /api/v1/inbox` until
    /// `fileAttachment(id:deviceId:)` files it.
    ///
    /// The typed `AttachmentUploadInput` is the multipart metadata, not the file
    /// bytes: a blank/absent `deviceId` is omitted from the form entirely rather
    /// than sent as an empty string.
    public func uploadAttachment(
        _ input: AttachmentUploadInput, fileName: String, fileType: String, data: Data
    ) async throws -> AttachmentMeta {
        struct Wrapper: Decodable { let attachment: AttachmentMeta }
        let w: Wrapper = try await uploadMultipart(
            "/api/v1/attachments",
            fileName: fileName, fileType: fileType, fileData: data,
            deviceId: input.deviceId, description: input.description
        )
        return w.attachment
    }

    /// Convenience overload for the two existing call shapes: a device upload
    /// passes its id, an inbox capture passes `nil`.
    public func uploadAttachment(
        deviceId: String?, fileName: String, fileType: String, data: Data,
        description: String? = nil
    ) async throws -> AttachmentMeta {
        try await uploadAttachment(
            AttachmentUploadInput(deviceId: deviceId, description: description),
            fileName: fileName, fileType: fileType, data: data
        )
    }

    /// `GET /api/v1/inbox` — the caller's attachments with no device yet, newest
    /// first. The server owns the order; this method does not re-sort.
    ///
    /// The envelope is `{ "attachments": [...] }` like the per-device list, but
    /// an `inbox` key is accepted too: the endpoint's name makes that spelling
    /// plausible, and reading either one cannot mis-file anything — it only
    /// avoids an empty inbox if the server chooses the other key.
    public func getInbox() async throws -> [AttachmentMeta] {
        struct Body: Decodable {
            let attachments: [AttachmentMeta]?
            let inbox: [AttachmentMeta]?
        }
        let body: Body = try await request("GET", "/api/v1/inbox")
        return body.attachments ?? body.inbox ?? []
    }

    /// `POST /api/v1/attachments/{id}/file` — files an inbox item under a device,
    /// or returns a filed attachment to the inbox with `deviceId: nil`.
    ///
    /// 409 `limit_reached` means the target device already holds five
    /// attachments; the item stays in the inbox. Map the thrown `APIError`
    /// through `InboxRules.fileFailure(_:)` so the UI can offer the way out.
    /// `PATCH /api/v1/attachments/{id}` remains description-only; filing never
    /// goes through it.
    @discardableResult
    public func fileAttachment(id: String, deviceId: String?) async throws -> AttachmentMeta {
        struct Wrapper: Decodable { let attachment: AttachmentMeta }
        let w: Wrapper = try await request(
            "POST", "/api/v1/attachments/\(id)/file",
            body: FileAttachmentInput(deviceId: deviceId)
        )
        return w.attachment
    }

    public func deleteAttachment(id: String) async throws {
        let _: EmptyResponse = try await request("DELETE", "/api/v1/attachments/\(id)")
    }

    /// `PATCH /api/v1/attachments/{id}` — sets or clears the attachment's
    /// description, the only mutable field (`openapi.yaml`).
    ///
    /// `nil` clears it. Ownership is the server's call: someone else's id is a
    /// 404, never a 403.
    public func updateAttachmentDescription(
        id: String, description: String?
    ) async throws -> AttachmentMeta {
        struct Wrapper: Decodable { let attachment: AttachmentMeta }
        let w: Wrapper = try await request(
            "PATCH", "/api/v1/attachments/\(id)",
            body: AttachmentDescriptionInput(description: description)
        )
        return w.attachment
    }

    // MARK: - AI receipt OCR

    /// Sends a receipt / warranty-card document to the Go OCR endpoint and
    /// returns the extracted draft.
    ///
    /// The server decrypts/validates, calls the model, fuzzy-maps the catalog,
    /// and never creates a Device — the caller pre-fills the form and the user
    /// confirms before saving. What happens to the **transcript** depends on the
    /// branch, and that is why the scan flow uses `attachmentId`:
    ///
    ///   * `.attachment` → `{"attachmentId": ...}`. The server persists
    ///     `draft.extractedText` on that attachment and indexes it for
    ///     `GET /api/v1/search`; `extractedTextStored` is `true`.
    ///   * `.file` → multipart. No Attachment row exists, so nothing is stored
    ///     and `extractedTextStored` is `false`.
    ///
    /// Uploading first (`uploadAttachment(deviceId: nil, ...)`) is therefore the
    /// only client-side way to make a receipt searchable.
    public func extractReceipt(_ input: ReceiptExtractInput) async throws -> DraftDevice {
        struct Wrapper: Decodable { let draft: DraftDevice }
        let wrapper: Wrapper
        switch input {
        case let .attachment(id):
            wrapper = try await request(
                "POST", "/api/v1/ai/extract-receipt",
                body: ReceiptExtractAttachmentBody(attachmentId: id)
            )
        case let .file(fileName, fileType, data):
            wrapper = try await uploadMultipart(
                "/api/v1/ai/extract-receipt",
                fileName: fileName, fileType: fileType, fileData: data
            )
        }
        return wrapper.draft
    }

    /// The searchable path: extract from an attachment that was uploaded first.
    ///
    /// `attachmentId` must be a non-blank id. The scan flow gets it from
    /// `uploadAttachment(deviceId: nil, ...)`, so the file is already an inbox
    /// item before the model is called — if extraction fails, the file is still
    /// there and the UI says so.
    public func extractReceipt(attachmentId: String) async throws -> DraftDevice {
        try await extractReceipt(ReceiptExtractInput(attachmentId: attachmentId))
    }

    /// The legacy multipart path. It still works, but it **cannot** persist the
    /// transcript: there is no Attachment row to own it. Prefer
    /// `extractReceipt(attachmentId:)` for anything that should be searchable.
    public func extractReceipt(fileName: String, fileType: String, data: Data) async throws -> DraftDevice {
        try await extractReceipt(.file(fileName: fileName, fileType: fileType, data: data))
    }

    /// Current AI opt-in state for the signed-in user.
    public func getAIOptIn() async throws -> Bool {
        struct Wrapper: Decodable { let aiOptIn: Bool }
        let w: Wrapper = try await request("GET", "/api/v1/ai/opt-in")
        return w.aiOptIn
    }

    /// Enable/disable the AI receipt-scan opt-in. Returns the new state.
    @discardableResult
    public func setAIOptIn(_ enabled: Bool) async throws -> Bool {
        struct Body: Encodable { let enabled: Bool }
        struct Wrapper: Decodable { let aiOptIn: Bool }
        let w: Wrapper = try await request("PUT", "/api/v1/ai/opt-in", body: Body(enabled: enabled))
        return w.aiOptIn
    }

    // MARK: - AI claim assessment

    /// `POST /api/v1/ai/assess-claim` — advice about one claim, **read-only**.
    ///
    /// The server reads the claim, the device and the warranty terms and
    /// returns `{coverage, confidence, reasoning, questions, draftLetter,
    /// generatedAt, model}`. It writes nothing: no claim, device or warranty row
    /// is touched, so this method does not reload anything.
    ///
    /// `reasoning` and `questions` come back in the request language
    /// (`Accept-Language`, already attached by `APIClient`); `draftLetter` is
    /// always Vietnamese because the service centre reads it. Do not translate
    /// it client-side.
    ///
    /// Two documented gates are thrown as `APIError.server` and must be mapped
    /// with `ClaimAssessmentGate.from(error:)`, not rendered as raw errors:
    ///
    ///   * 403 `ai_optin_required` → the user has not enabled the AI opt-in
    ///     (the same switch as receipt scanning). Offer to turn it on.
    ///   * 503 `feature_disabled` → the server has no model key. Say the feature
    ///     is not available, without an error tone.
    public func assessClaim(_ input: ClaimAssessmentInput) async throws -> ClaimAssessment {
        try await request("POST", "/api/v1/ai/assess-claim", body: input)
    }

    /// Convenience for the common call: a claim row already holds the id.
    public func assessClaim(claimId: String) async throws -> ClaimAssessment {
        try await assessClaim(ClaimAssessmentInput(claimId: claimId))
    }

    /// URL of the byte stream for an attachment. `nonisolated` because it only
    /// reads the immutable `baseURL` — callers (SwiftUI views) build these
    /// synchronously while rendering.
    nonisolated public func attachmentDownloadURL(id: String, download: Bool = false) -> URL {
        var components = URLComponents(
            url: baseURL.appendingPathComponent("/api/files/\(id)"),
            resolvingAgainstBaseURL: false
        )!
        if download { components.queryItems = [.init(name: "download", value: "1")] }
        return components.url!
    }

    /// Decrypted bytes of an attachment (`GET /api/files/{id}`).
    ///
    /// The stream is bearer-gated, so `AsyncImage(url:)` cannot load it — a
    /// thumbnail has to go through the client. Kept deliberately separate from
    /// `attachmentDownloadURL` (which is what a share sheet opens after the user
    /// taps a row): this one is for in-app previews.
    public func attachmentData(id: String) async throws -> Data {
        try await rawDataRequest("GET", "/api/files/\(id)", accept: "*/*")
    }

    // MARK: - Insurance pack

    /// Downloads the insurance property schedule PDF
    /// (`GET /api/v1/insurance-pack`) as bytes.
    ///
    /// This is an authenticated binary fetch, exactly like `attachmentData(id:)`
    /// — the body is `application/pdf`, not JSON, so it goes through
    /// `rawDataRequest` with an explicit `Accept`.
    ///
    /// The query is built by `InsurancePackRules` so the wire shape is tested
    /// without a server: `deviceIds` is omitted for "all devices" and
    /// `includeSold` is omitted when false (the server default).
    ///
    /// The document is **always Vietnamese**; the insurer / loss adjuster reads
    /// it, not the app user. Do not translate its contents. `InsurancePackRules`
    /// also carries the filename and the `%PDF-` header check the caller needs
    /// before writing a shareable temp file.
    public func insurancePack(
        deviceIds: [String] = [],
        includeSold: Bool = false
    ) async throws -> Data {
        try await rawDataRequest(
            "GET", InsurancePackRules.path,
            query: InsurancePackRules.queryItems(
                deviceIds: deviceIds, includeSold: includeSold
            ),
            accept: InsurancePackRules.contentType
        )
    }

    // MARK: - Subscriptions

    public func listSubscriptions() async throws -> [Subscription] {
        struct Wrapper: Decodable { let subscriptions: [Subscription] }
        let w: Wrapper = try await request("GET", "/api/v1/subscriptions")
        return w.subscriptions
    }

    public func getSubscription(id: String) async throws -> (Subscription, [Payment]) {
        // Server returns { subscription: { ...Subscription, payments: [...] } }.
        // Decode twice with two views over the same nested object.
        struct Outer: Decodable {
            struct Body: Decodable {
                let payments: [Payment]?
            }
            let subscription: Subscription
            let body: Body
            init(from decoder: Decoder) throws {
                let c = try decoder.container(keyedBy: CodingKeys.self)
                self.subscription = try c.decode(Subscription.self, forKey: .subscription)
                self.body = try c.decode(Body.self, forKey: .subscription)
            }
            enum CodingKeys: String, CodingKey { case subscription }
        }
        let outer: Outer = try await request("GET", "/api/v1/subscriptions/\(id)")
        return (outer.subscription, outer.body.payments ?? [])
    }

    /// Creates a subscription. `SubscriptionInput.leadDays` rides in the body,
    /// already normalised by `LeadDaysRules.wireValue`; omitted means the server
    /// default `[30, 7]`. An empty array is a 400 (`fieldErrors.leadDays`).
    ///
    /// `trialEndsAt` / `convertsToPrice` ride in the same body as a pair through
    /// `SubscriptionTrial.apply`. Sending a price without a trial end date is a
    /// 400 `fieldErrors.convertsToPrice`, so callers must not build that
    /// combination by hand.
    public func createSubscription(_ input: SubscriptionInput) async throws -> Subscription {
        struct Wrapper: Decodable { let subscription: Subscription }
        let w: Wrapper = try await request("POST", "/api/v1/subscriptions", body: input)
        return w.subscription
    }

    /// Updates a subscription. `leadDays` is accepted here too; absent/`null`
    /// leaves the stored schedule unchanged, but the form sends the value it
    /// loaded so the intent is explicit.
    ///
    /// The trial pair is a full-replacement field: omitting `trialEndsAt` clears
    /// the trial, and `convertsToPrice` is never sent on its own. Both every save
    /// path and `SubscriptionsStore.setStatus` carry it with
    /// `SubscriptionTrial.apply`.
    public func updateSubscription(id: String, _ input: SubscriptionInput) async throws -> Subscription {
        struct Wrapper: Decodable { let subscription: Subscription }
        let w: Wrapper = try await request("PATCH", "/api/v1/subscriptions/\(id)", body: input)
        return w.subscription
    }

    public func deleteSubscription(id: String) async throws {
        let _: EmptyResponse = try await request("DELETE", "/api/v1/subscriptions/\(id)")
    }

    public func logSubscriptionPayment(id: String, _ input: PaymentInput) async throws -> Payment {
        struct Wrapper: Decodable { let payment: Payment }
        let w: Wrapper = try await request(
            "POST", "/api/v1/subscriptions/\(id)/payments", body: input
        )
        return w.payment
    }

    public func renewSubscription(id: String) async throws {
        let _: EmptyResponse = try await request("POST", "/api/v1/subscriptions/\(id)/renew")
    }

    // MARK: - Wishlist

    public func listWishlist() async throws -> [WishlistItem] {
        struct Wrapper: Decodable { let items: [WishlistItem] }
        let w: Wrapper = try await request("GET", "/api/v1/wishlist")
        return w.items
    }

    public func getWishlistItem(id: String) async throws -> (WishlistItem, [WishlistPrice]) {
        struct Wrapper: Decodable {
            let item: WishlistItem
            let prices: [WishlistPrice]?
        }
        let w: Wrapper = try await request("GET", "/api/v1/wishlist/\(id)")
        return (w.item, w.prices ?? [])
    }

    public func createWishlistItem(_ input: WishlistInput) async throws -> WishlistItem {
        struct Wrapper: Decodable { let item: WishlistItem }
        let w: Wrapper = try await request("POST", "/api/v1/wishlist", body: input)
        return w.item
    }

    public func updateWishlistItem(id: String, _ input: WishlistInput) async throws {
        let _: EmptyResponse = try await request("PATCH", "/api/v1/wishlist/\(id)", body: input)
    }

    public func deleteWishlistItem(id: String) async throws {
        let _: EmptyResponse = try await request("DELETE", "/api/v1/wishlist/\(id)")
    }

    public func logWishlistPrice(id: String, _ input: PriceLogInput) async throws {
        let _: EmptyResponse = try await request(
            "POST", "/api/v1/wishlist/\(id)/prices", body: input
        )
    }

    // MARK: - Action queue ("Việc cần xử lý")

    /// The derived queue of things that need a decision.
    ///
    /// `snoozed` is an **opt-in that only adds rows**: the default read returns
    /// what is actionable now, and `true` returns those *plus* the rows a snooze
    /// is hiding (each carrying `snoozedUntil`). `counts` counts the actionable
    /// subset either way, which is why a badge must read it rather than the row
    /// count. The flag is only ever sent when it is `true` — the server default is
    /// already the other branch, so `snoozed=false` would just be noise.
    public func listActionItems(snoozed: Bool = false) async throws -> ActionQueue {
        var query: [URLQueryItem] = []
        if snoozed { query.append(.init(name: "snoozed", value: "true")) }
        return try await request("GET", "/api/v1/actions", query: query)
    }

    /// Hides one item until `now + days`, for this account, on **every** device
    /// (the snooze lives server-side, so a local flag could not do this).
    ///
    /// `days` is always sent explicitly by this client; leaving it `nil` sends no
    /// body at all, which the server reads as its 90-day default. The returned
    /// `days` is the duration the server actually applied.
    ///
    /// Snoozing does **not** touch warranty notifications: the server keeps
    /// `DecisionSnooze` separate from `Reminder`.
    public func snoozeActionItem(_ itemKey: String, days: Int? = nil) async throws -> SnoozeResult {
        try await request(
            "POST", Self.actionSnoozePath(itemKey),
            body: days.map { SnoozeInput(days: $0) },
            percentEncodedPath: true
        )
    }

    /// Un-snoozes — the item returns to the queue on the next read. The server
    /// answers 404 when the item was not snoozed (deliberately not a silent 200),
    /// so the caller can tell that another device already changed the state.
    public func unsnoozeActionItem(_ itemKey: String) async throws {
        let _: EmptyResponse = try await request(
            "DELETE", Self.actionSnoozePath(itemKey), percentEncodedPath: true
        )
    }

    /// Path of the snooze endpoints for one item.
    ///
    /// `itemKey` is `<KIND>:<entityId>`. The colon is legal unencoded inside a
    /// path segment, but it is percent-encoded here so the key can never be read
    /// as a structural separator — and `/` is encoded with it so an id can never
    /// split the path into extra segments. Go's `ServeMux` unescapes a segment
    /// before `PathValue`, so the handler still sees `KIND:id`
    /// (`api/internal/handlers/actions.go`).
    nonisolated public static func actionSnoozePath(_ itemKey: String) -> String {
        var allowed = CharacterSet.urlPathAllowed
        allowed.remove(charactersIn: ":/")
        let segment = itemKey.addingPercentEncoding(withAllowedCharacters: allowed) ?? itemKey
        return "/api/v1/actions/\(segment)/snooze"
    }

    // MARK: - Subscription audit ("Soát gói đăng ký")

    /// The advisory self-audit of the user's subscriptions.
    ///
    /// Read-only by construction: the endpoint has no write path, cancels nothing
    /// and disables nothing (`advisory` is always `true`). It reads **payment
    /// history**, never usage — the app has no usage telemetry, which is why the
    /// payload's own `note` says so and why the screen renders it verbatim.
    public func subscriptionAudit() async throws -> SubscriptionAudit {
        try await request("GET", "/api/v1/subscriptions/audit")
    }

    // MARK: - Cross-entity search

    /// Searches devices, subscriptions and wishlist in one round trip.
    ///
    /// `limit` is **per group** (default 20, max 50) and is clamped client-side
    /// so an out-of-range value can never turn into the server's 400 on
    /// `limit`. `q` is trimmed; a blank one is a valid request that returns 200
    /// with three empty groups — the screen only skips the call because there is
    /// nothing to show, not because blank input is an error.
    public func search(
        q: String,
        limit: Int = SearchQueryRules.defaultLimit
    ) async throws -> SearchResults {
        try await request("GET", "/api/v1/search", query: [
            .init(name: "q", value: SearchQueryRules.trimmed(q)),
            .init(name: "limit", value: String(SearchQueryRules.clampedLimit(limit))),
        ])
    }

    // MARK: - Stats

    public func getStats() async throws -> UserStats {
        let stats: UserStats = try await request("GET", "/api/v1/stats")
        return stats
    }

    // MARK: - FX rates ("Lấy tỷ giá")

    /// `GET /api/v1/fx/rates?base=USD` → `{base, rates, fetchedAt, stale}`.
    ///
    /// Used only by the device form, and only as a convenience: `fxRate` is
    /// **locked at entry**, so this is a suggestion the user can overwrite, not
    /// a value that keeps tracking the market. `base` is the device's ISO
    /// currency code; the caller reads `FxRates.vndRate` for the quote it needs.
    ///
    /// The endpoint is allowed to answer **503**. That is not a failure of the
    /// save — the form keeps the rate field editable and tells the user to type
    /// it. `APIError.isServiceUnavailable` is the distinction the caller needs.
    public func fxRates(base: String) async throws -> FxRates {
        try await request("GET", "/api/v1/fx/rates", query: [
            .init(name: "base", value: CurrencyRules.normalized(base)),
        ])
    }

    /// The forward-looking counterpart of `getStats()`: subscription renewals,
    /// warranty expiries and wishlist target dates over the next `months`
    /// months (1–24), split per calendar month.
    ///
    /// `months` is clamped client-side before the request is built
    /// (`ForecastRules.clampedMonths`) because an out-of-range value is a 400 on
    /// the server, not a silent default. The response's own `buckets` normally
    /// hold `months + 1` entries — the screen iterates whatever comes back
    /// rather than assuming a length.
    public func forecast(months: Int = ForecastRules.defaultMonths) async throws -> Forecast {
        try await request("GET", "/api/v1/forecast", query: [
            .init(name: "months", value: String(ForecastRules.clampedMonths(months))),
        ])
    }

    // MARK: - Reminders

    /// The reminders feed.
    ///
    /// `includeDismissed` opts into the rows the user has hidden — each one
    /// carries a top-level `isDismissed: true` plus its device's `status`, so
    /// the "Đã ẩn" list can be read from this light endpoint instead of the
    /// whole backup export. It defaults to `false`, which leaves the plain
    /// upcoming read (and its response shape) exactly as it was.
    public func listUpcomingReminders(
        withinDays: Int = 30,
        includeDismissed: Bool = false
    ) async throws -> [UpcomingReminder] {
        struct Wrapper: Decodable { let reminders: [UpcomingReminder] }
        var query: [URLQueryItem] = [.init(name: "withinDays", value: String(withinDays))]
        if includeDismissed {
            query.append(.init(name: "includeDismissed", value: "true"))
        }
        let w: Wrapper = try await request("GET", "/api/v1/reminders", query: query)
        return w.reminders
    }

    // MARK: - Handover certificate / share links

    /// The device's share links, newest first, **dead rows included** (openapi
    /// `GET /api/v1/devices/{id}/shares`).
    ///
    /// The array is always `[]`, never `null`, and never carries a `token` — the
    /// server keeps only the hash, so there is no way to read an existing link
    /// back. A device that belongs to someone else also answers `[]`, which is the
    /// same amount of information an empty list gives.
    public func listShares(deviceId: String) async throws -> [DeviceShare] {
        struct Wrapper: Decodable { let shares: [DeviceShare] }
        let w: Wrapper = try await request("GET", "/api/v1/devices/\(deviceId)/shares")
        return w.shares
    }

    /// Creates a read-only handover certificate for one device.
    ///
    /// ⚠️ **The response is the only place `share.token` ever appears.** The server
    /// stores its sha256, so the token cannot be fetched again — not by the owner,
    /// not from a log. The caller must show it immediately, next to a copy action,
    /// inside a surface that refuses to close until it has been copied or
    /// acknowledged (`ShareCopy.closeBlockedHint`), and must never persist it.
    ///
    /// `expiresInDays` is clamped into the documented `1...90` by
    /// `ShareLinks.normalizedExpiryDays` (default 30); there is no permanent link.
    /// A `409` means the device already holds `ShareLinks.maxActivePerDevice`
    /// live links.
    public func createShare(deviceId: String,
                            _ input: CreateShareInput = CreateShareInput()) async throws -> CreatedDeviceShare {
        struct Wrapper: Decodable { let share: CreatedDeviceShare }
        var body = input
        body.expiresInDays = ShareLinks.normalizedExpiryDays(input.expiresInDays)
        let w: Wrapper = try await request("POST", "/api/v1/devices/\(deviceId)/shares", body: body)
        return w.share
    }

    /// Revokes a share link by its `DeviceShare.id`.
    ///
    /// Idempotent — a second call is still a 200 — and a link belonging to someone
    /// else is a `404`, indistinguishable from an id that never existed. Links do
    /// **not** auto-revoke when the device is marked `SOLD`: the certificate is
    /// exactly what the buyer needs *after* the sale.
    public func revokeShare(id: String) async throws {
        let _: EmptyResponse = try await request("DELETE", "/api/v1/shares/\(id)")
    }

    // MARK: - Service directory

    /// "Mang máy đi bảo hành ở đâu" for one device (openapi
    /// `GET /api/v1/devices/{id}/service-directory`).
    ///
    /// Read it through `ServiceDirectoryInfo`: `brand == nil` and every `null`
    /// field are answers, not errors, and the phone rows are gated on
    /// `phoneSource`. Nothing here re-derives or invents contact details — the
    /// server's `disclaimer` says so in its own words.
    public func serviceDirectory(deviceId: String) async throws -> ServiceDirectory {
        struct Wrapper: Decodable { let directory: ServiceDirectory }
        let w: Wrapper = try await request("GET", "/api/v1/devices/\(deviceId)/service-directory")
        return w.directory
    }

    // MARK: - Brand warranty service info

    /// One brand's service page bundle (openapi
    /// `GET /api/v1/brands/{brandId}/service-info`).
    ///
    /// The only field this feature uses is `warrantyLookupUrl`, and it is
    /// legitimately `nil`: the API adds only URLs it can source, and the frozen
    /// contract says outright that it is null for some brands. A caller must
    /// render that as "we do not have this brand's page" and **never** fall back
    /// to `supportUrl`, a guessed path, or a search-engine URL.
    ///
    /// Returns `nil` for the contract's second documented 200: a **known brand
    /// with no directory row** (`{"serviceInfo": null}`, only 16 of 49 seeded
    /// brands have one). That is not the same as the third outcome, a 404 for a
    /// brand that does not exist; both leave the section saying it has no page,
    /// but only the 404 is "no such brand". A transport or decoding failure is
    /// distinct again and the section offers a retry.
    ///
    /// `brandId` comes from `BrandWarrantyRules.brandId(for:in:)` — the catalog
    /// row whose name matches the device's free-text brand exactly (folded). A
    /// device carries no brand id, so a missing or ambiguous match is a real
    /// answer: the section says it cannot find the brand's page rather than
    /// asking the server about a guess.
    ///
    /// The envelope is decoded through `BrandServiceInfoResponse`, which accepts
    /// the row directly or under the wrapper keys the Go handlers use elsewhere;
    /// the route ships from a parallel change, and guessing the wrong envelope
    /// would lose the URL for every brand.
    public func brandServiceInfo(brandId: String) async throws -> BrandServiceInfo? {
        let payload: BrandServiceInfoResponse = try await request(
            "GET", Self.brandServiceInfoPath(brandId), percentEncodedPath: true
        )
        return payload.info
    }

    /// Path of the brand service-info route. Same segment-escaping rule as
    /// `actionSnoozePath`: `/` and `:` are percent-encoded so an id can never
    /// split the path or be read as structure.
    nonisolated public static func brandServiceInfoPath(_ brandId: String) -> String {
        var allowed = CharacterSet.urlPathAllowed
        allowed.remove(charactersIn: ":/")
        let segment = brandId.addingPercentEncoding(withAllowedCharacters: allowed) ?? brandId
        return "/api/v1/brands/\(segment)/service-info"
    }

    // MARK: - Push

    public func listPushSubscriptions() async throws -> [PushSubscriptionMeta] {
        struct Wrapper: Decodable { let subscriptions: [PushSubscriptionMeta] }
        let w: Wrapper = try await request("GET", "/api/v1/push")
        return w.subscriptions
    }

    public func registerPush(_ input: NativePushInput) async throws {
        let _: EmptyResponse = try await request(
            "POST", "/api/v1/push/register", body: input
        )
    }

    public func unregisterPush(id: String) async throws {
        let _: EmptyResponse = try await request("DELETE", "/api/v1/push/\(id)")
    }

    /// Sends a sample push to every subscription owned by the current user.
    /// Returns `(sent, failed)` so the UI can show a Vietnamese toast.
    public func sendTestPush() async throws -> (sent: Int, failed: Int) {
        struct Resp: Decodable { let sent: Int; let failed: Int }
        let r: Resp = try await request("POST", "/api/v1/push/test")
        return (r.sent, r.failed)
    }
}
