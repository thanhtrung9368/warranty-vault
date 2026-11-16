-- DeviceHandoff queries (Warrly 2.0 — resale handoff / "sang tay").
--
-- Two halves that must not be confused, exactly like DeviceShare:
--
--   * OWNER-scoped: create / status / cancel — always resolved through the
--     caller's "Device"."userId", so a foreign device id is indistinguishable
--     from a missing one.
--   * PUBLIC: the preview (keyed on "codeHash") and the claiming transaction.
--     The preview projection is narrow BY CONSTRUCTION: no "userId", no email,
--     no price, no notes, no full serial, no attachment ids or storage paths.
--
-- The claim does NOT trust anything the client sends beyond the code: the
-- handoff row is locked, and every copy is keyed on ids that came OUT of that
-- row. There is no client-supplied device id anywhere in the claim path.

-- name: CreateDeviceHandoff :one
-- The only INSERT. "codeHash" is UNIQUE, so a generator collision surfaces as
-- SQLSTATE 23505 and the service retries with a fresh code (the code itself never
-- reaches this table, only its sha256 digest).
INSERT INTO "DeviceHandoff" (
    id,
    "deviceId",
    "fromUserId",
    "codeHash",
    "sharedFields",
    "expiresAt",
    "requestIpHash",
    "createdAt"
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, NOW()
)
RETURNING *;

-- name: GetHandoffForDevice :one
-- Owner status read: the LATEST handoff for one device the caller owns. The join
-- on "Device" is the ownership check (a foreign device returns no row, not a
-- leak), and it also means a deleted device cannot describe its handoffs.
--
-- No status/expiry filter: the caller needs the latest row even when it is
-- CLAIMED or EXPIRED — that is what the owner status screen shows. Expiry is
-- folded into the effective status in Go, because the column is not rewritten by
-- a cron.
SELECT h.*
FROM "DeviceHandoff" h
JOIN "Device" d ON d.id = h."deviceId"
WHERE h."deviceId" = $1
  AND d."userId" = $2
ORDER BY h."createdAt" DESC, h.id DESC
LIMIT 1;

-- name: CancelHandoff :execrows
-- Owner cancel. `status = 'PENDING'` is the guard: a claimed or expired handoff
-- has already reached a terminal state and must not be rewritten. Ownership is
-- the same join shape as the create path, so a foreign id affects nothing.
UPDATE "DeviceHandoff" h
SET status = 'CANCELLED'
FROM "Device" d
WHERE h.id = $1
  AND h."deviceId" = d.id
  AND d."userId" = $2
  AND h.status = 'PENDING';

-- name: GetHandoffForOwner :one
-- Owner-scoped read used by the cancel path to tell "already cancelled"
-- (idempotent success) from "not mine" (404) and from a terminal state (409).
SELECT h.*
FROM "DeviceHandoff" h
JOIN "Device" d ON d.id = h."deviceId"
WHERE h.id = $1
  AND d."userId" = $2
LIMIT 1;

-- name: GetHandoffByCodeHash :one
-- THE public read (no bearer token), plus the safe projection the preview needs.
--
-- This is a single indexed probe on "codeHash". It deliberately returns the
-- handoff row even when it is no longer PENDING: the claiming transaction needs
-- to distinguish "expired/cancelled → 410" from "already claimed by somebody
-- else → 409" from "already claimed by YOU → idempotent 200", and the public
-- preview folds all of those into one 404 so it is not an enumeration oracle.
--
-- "seller_name" is the seller's DISPLAY NAME (User.name) — the frozen contract
-- says the buyer may see who handed the device over. Nothing else about the
-- seller is selected: no id, no email, no locale. The device projection is
-- limited to the preview fields; in particular "purchasePrice", "soldPrice",
-- notes and the full serial are absent from this SELECT list, so they cannot
-- leak through a later Go filter edit.
SELECT
    h.id                  AS handoff_id,
    h."deviceId"          AS handoff_device_id,
    h."fromUserId"        AS handoff_from_user_id,
    h.status              AS handoff_status,
    h."expiresAt"         AS handoff_expires_at,
    h."createdAt"         AS handoff_created_at,
    h."claimedByUserId"   AS handoff_claimed_by_user_id,
    h."claimedDeviceId"   AS handoff_claimed_device_id,
    h."claimedAt"         AS handoff_claimed_at,
    h."sharedFields"      AS handoff_shared_fields,
    u.name                AS seller_name,
    u.id                  AS seller_user_id,
    d.name                AS device_name,
    d.category            AS device_category,
    d.brand               AS device_brand,
    d.model               AS device_model,
    d."serialNumber"      AS device_serial_number,
    d."purchaseDate"      AS device_purchase_date
FROM "DeviceHandoff" h
JOIN "Device" d ON d.id = h."deviceId"
JOIN "User" u ON u.id = h."fromUserId"
WHERE h."codeHash" = $1
LIMIT 1;

-- name: LockHandoffByCodeHash :one
-- The claiming transaction's first statement. `FOR UPDATE` serialises concurrent
-- claims of the same code on this row, so the status/expiry re-read below is
-- authoritative: two buyers cannot both see PENDING.
SELECT *
FROM "DeviceHandoff"
WHERE "codeHash" = $1
FOR UPDATE;

-- name: ClaimHandoff :execrows
-- Terminal PENDING → CLAIMED transition. The `status = 'PENDING'` and
-- `"expiresAt" > $4` predicates make this the SINGLE-USE gate: a second claim
-- affects zero rows and the service turns that into the right answer (200 for the
-- same buyer when "claimedDeviceId" is still theirs, 409 for anyone else).
UPDATE "DeviceHandoff"
SET status = 'CLAIMED',
    "claimedByUserId" = $2,
    "claimedDeviceId" = $3,
    "claimedAt" = $4
WHERE id = $1
  AND status = 'PENDING'
  AND "expiresAt" > $4;

-- name: MarkHandoffExpired :execrows
-- Lazy PENDING → EXPIRED. Called only when a read/claim observes the deadline in
-- the past. No cron: an unclaimed code that nobody looks at transfers nothing, so
-- its stored status is cosmetic; this keeps the owner's screen truthful.
UPDATE "DeviceHandoff"
SET status = 'EXPIRED'
WHERE id = $1
  AND status = 'PENDING'
  AND "expiresAt" <= $2;

-- name: ListWarrantiesForHandoff :many
-- Preview rows. Same reasoning as ListWarrantiesForShare: the buyer needs the
-- coverage window and the provider name, not what the seller paid.
--
-- `notes` and `cost` are absent from the SELECT list on purpose. The contract
-- terms that DEFINE the cover (scope/cap/deductible/exclusions/component) are also
-- not previewed; the frozen preview shape is
-- {type,startDate,endDate,provider,status} and the full row arrives with the
-- claimed device for a buyer who is signed in.
SELECT
    id,
    type,
    component,
    provider,
    "startDate",
    "endDate",
    months
FROM "Warranty"
WHERE "deviceId" = $1
ORDER BY "endDate" DESC, id ASC;

-- name: ListAttachmentsForHandoff :many
-- Preview rows for the SELECTED receipts only. Metadata is all that is exposed:
-- no id, no storage path, no IV, no wrapped key, no bytes. A public blob route
-- would be a second unauthenticated surface for far more sensitive data than
-- this JSON (a receipt photo carries the seller's name, address and phone), so
-- the files become downloadable only after the claim, through the authenticated
-- file route.
SELECT
    "fileName",
    "fileType",
    "fileSize"
FROM "Attachment"
WHERE "deviceId" = $1
  AND "userId" = $2
  AND id = ANY(sqlc.arg('attachmentIds')::text[])
ORDER BY "uploadedAt" ASC;

-- name: ListClaimsForHandoff :many
-- Preview rows: the repair history the buyer inherits. The frozen preview shape is
-- {status,openedAt,closedAt,coveredByWarranty}; the issue/diagnosis text is not
-- published before the claim (it can describe a personal circumstance) but DOES
-- travel with the copied rows after it.
SELECT
    status,
    "openedAt",
    "closedAt",
    "coveredByWarranty"
FROM "Claim"
WHERE "deviceId" = $1
ORDER BY "openedAt" DESC, id ASC;

-- name: CreateDeviceFromHandoff :one
-- The buyer's copy of the seller's Device row — an INSERT ... SELECT so the
-- redaction is a property of the SQL rather than of a Go filter that a later edit
-- could drop:
--
--   * "purchasePrice" is written as 0, "soldPrice"/"soldAt" as NULL,
--     "fxRate" as NULL and "notes" as NULL. PRICE AND PRIVATE NOTES DO NOT
--     TRAVEL — that is the product rule, not an omission.
--   * "handoffReceivedAt" ($3) and "handoffSellerName" ($4) are the provenance
--     the buyer's UI reads.
--   * everything else that is a FACT (purchase date, serial/model, brand,
--     currency, return window, activation, brand-lookup record, reminder
--     lead-days) is copied.
--
-- "status" is copied as-is. The service refuses to claim when the seller's row has
-- become SOLD or LOST between minting and claiming, so the only statuses that can
-- arrive here are ACTIVE / EXPIRED / BROKEN — a condition fact, not a sale.
--
-- Every source column is qualified with `src.` on purpose: sqlc's analyzer treats
-- a bare `id` in an INSERT ... SELECT as ambiguous with the target column list,
-- and spelling the source out also makes the copy list auditable line by line.
INSERT INTO "Device" (
    id,
    "userId",
    name,
    category,
    brand,
    model,
    "serialNumber",
    "purchaseDate",
    "purchasePrice",
    "purchasePlace",
    status,
    notes,
    "soldAt",
    "soldPrice",
    "returnWindowDays",
    "receivedAt",
    "activationRequired",
    "activatedAt",
    "extendedCoverBuyBy",
    "leadDays",
    currency,
    "fxRate",
    "brandWarrantyStatus",
    "brandWarrantyStart",
    "brandWarrantyEnd",
    "brandCheckedAt",
    "brandLookupUrl",
    "retailerId",
    "handoffReceivedAt",
    "handoffSellerName",
    "createdAt",
    "updatedAt"
) SELECT
    $1,
    $2,
    src.name,
    src.category,
    src.brand,
    src.model,
    src."serialNumber",
    src."purchaseDate",
    0,
    src."purchasePlace",
    src.status,
    NULL,
    NULL,
    NULL,
    src."returnWindowDays",
    src."receivedAt",
    src."activationRequired",
    src."activatedAt",
    src."extendedCoverBuyBy",
    src."leadDays",
    src.currency,
    NULL,
    src."brandWarrantyStatus",
    src."brandWarrantyStart",
    src."brandWarrantyEnd",
    src."brandCheckedAt",
    src."brandLookupUrl",
    src."retailerId",
    $3,
    $4,
    NOW(),
    NOW()
FROM "Device" src
WHERE src.id = $5
  AND src."userId" = $6
RETURNING *;

-- name: CopyWarrantyFromHandoff :one
-- One buyer-side copy of one seller warranty row. "cost" and "notes" are NULL for
-- the same privacy rule as the device; the contract terms that define the cover
-- (component/scope/cap/deductible/exclusions/region/transferable) DO travel, and
-- so does "claimsUsed" — the repair history below was copied with these rows, so
-- resetting the counter would misstate how much of the plan has been consumed.
INSERT INTO "Warranty" (
    id,
    "deviceId",
    type,
    provider,
    "startDate",
    "endDate",
    months,
    cost,
    address,
    phone,
    notes,
    component,
    scope,
    cap,
    deductible,
    exclusions,
    region,
    transferable,
    "claimsAllowed",
    "claimsUsed",
    "createdAt",
    "updatedAt"
) SELECT
    $1, $2, src.type, src.provider, src."startDate", src."endDate", src.months,
    NULL, src.address, src.phone, NULL,
    src.component, src.scope, src.cap, src.deductible, src.exclusions, src.region, src.transferable,
    src."claimsAllowed", src."claimsUsed", NOW(), NOW()
FROM "Warranty" src
WHERE src.id = $3
  AND src."deviceId" = $4
RETURNING *;

-- name: CopyAttachmentFromHandoff :one
-- Buyer-side attachment row pointing at the SAME encrypted blob: same
-- "storagePath", same IV, same wrapped key. No re-encryption — the per-file data
-- key is wrapped with the server-wide FILE_MASTER_KEY, so the buyer's account can
-- decrypt bytes that were encrypted for the seller.
--
-- "extractedText" (OCR) is NOT copied: it is the seller's derived index and can
-- contain text from other paperwork captured in the same photo. The buyer gets the
-- file itself and may OCR it themselves.
--
-- Scope is the seller's device AND the seller's userId, so an id from anywhere
-- else copies nothing (the service treats a vanished row as "skip", never as an
-- error: the seller may delete an attachment between minting and claiming).
--
-- The shared blob path means the buyer's row and the seller's row point at ONE
-- file on disk: if the seller later deletes their attachment, the encrypted bytes
-- are removed and the buyer's copy can no longer be streamed. That is the accepted
-- trade of copying the row without re-encrypting; a reference-counted blob store
-- would be a larger change than this feature.
INSERT INTO "Attachment" (
    id,
    "deviceId",
    "userId",
    "fileName",
    "storagePath",
    "fileType",
    "fileSize",
    iv,
    "wrappedKey",
    description,
    "uploadedAt",
    "extractedText"
) SELECT
    $1, $2, $3, src."fileName", src."storagePath", src."fileType", src."fileSize",
    src.iv, src."wrappedKey", src.description, src."uploadedAt", NULL
FROM "Attachment" src
WHERE src.id = $4
  AND src."deviceId" = $5
  AND src."userId" = $6
RETURNING *;

-- name: CopyClaimFromHandoff :one
-- Buyer-side copy of the seller's repair history. "warrantyId" is REMAPPED by the
-- service to the copied warranty's id (or NULL when the seller's row referenced a
-- warranty that was not copied). "cost" is NULL — what the seller paid for a
-- repair is a price and prices do not travel. The notification bookkeeping
-- columns are left to their defaults: the buyer's cron schedule is the buyer's,
-- and a copied "promiseNotifiedAt" would suppress a reminder they never received.
INSERT INTO "Claim" (
    id,
    "deviceId",
    "warrantyId",
    status,
    "openedAt",
    "expectedReturnAt",
    "closedAt",
    "ticketNumber",
    "serviceCenter",
    issue,
    diagnosis,
    outcome,
    cost,
    "coveredByWarranty",
    "createdAt",
    "updatedAt"
) SELECT
    $1, $2, $3, src.status, src."openedAt", src."expectedReturnAt", src."closedAt",
    src."ticketNumber", src."serviceCenter", src.issue, src.diagnosis, src.outcome,
    NULL, src."coveredByWarranty", NOW(), NOW()
FROM "Claim" src
WHERE src.id = $4
  AND src."deviceId" = $5
RETURNING *;

-- name: MarkDeviceHandedOff :execrows
-- The seller's row after a successful claim: SOLD + "handoffSentAt". The pair is
-- what the UI renders as "đã chuyển"; "soldAt"/"soldPrice" are deliberately NOT
-- written, because the app does not know the price and must not invent one (the
-- seller can still record a sale price later through the ordinary device PATCH).
--
-- `status <> 'SOLD'` makes this idempotent for a row the seller already marked
-- sold, and the userId join is the same ownership guard as every other write.
UPDATE "Device" d
SET status = 'SOLD',
    "handoffSentAt" = $3,
    "updatedAt" = NOW()
WHERE d.id = $1
  AND d."userId" = $2
  AND d.status <> 'SOLD';
