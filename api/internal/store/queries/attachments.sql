-- Attachment CRUD. Files themselves live encrypted on disk under
-- PRIVATE_UPLOAD_ROOT; this table only stores metadata + the wrapped data
-- key + IV. The file_master_key (env) is required to decrypt — disk alone
-- or DB alone is not enough.
--
-- Migration 0018 made "deviceId" nullable (an inbox item has no device yet) and
-- added the stored owner "userId". Ownership is therefore direct for every row —
-- filed or inbox — instead of being derived through the owning device. The join
-- in ListAttachmentsByDevice is kept as a second guard.

-- name: ListAttachmentsByDevice :many
SELECT a.*
FROM "Attachment" a
JOIN "Device" d ON d.id = a."deviceId"
WHERE a."deviceId" = $1 AND d."userId" = $2
ORDER BY a."uploadedAt" DESC;

-- name: ListInboxAttachments :many
-- GET /api/v1/inbox: the caller's unassigned attachments, newest first. Uses the
-- partial index Attachment_inbox_idx (userId, uploadedAt DESC) WHERE deviceId IS
-- NULL. Returns the same columns/shape as ListAttachmentsByDevice.
SELECT a.*
FROM "Attachment" a
WHERE a."userId" = $1 AND a."deviceId" IS NULL
ORDER BY a."uploadedAt" DESC;

-- name: GetAttachmentByID :one
-- Direct ownership since 0018. This row may be an inbox item (deviceId NULL) or
-- a filed one; both are read by the same owner check, which is what lets
-- GET /api/files/{id}, PATCH and AI extraction work on an inbox item.
SELECT a.*
FROM "Attachment" a
WHERE a.id = $1 AND a."userId" = $2
LIMIT 1;

-- name: GetAttachmentByIDInternal :one
-- No user-scoping; used by file streaming after the handler has verified
-- ownership separately (or in tests).
SELECT *
FROM "Attachment"
WHERE id = $1
LIMIT 1;

-- name: CreateAttachment :one
-- One insert for both destinations: "deviceId" NULL creates an inbox item.
-- "userId" is always the caller (the owner does not change when the file is
-- later filed or returned to the inbox).
INSERT INTO "Attachment" (
    id,
    "userId",
    "deviceId",
    "fileName",
    "storagePath",
    "fileType",
    "fileSize",
    iv,
    "wrappedKey",
    description,
    "uploadedAt"
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW()
)
RETURNING *;

-- name: DeleteAttachment :one
-- Works for filed AND inbox rows: ownership is the row's "userId" since 0018.
-- Returns the row (storagePath in particular) so the service can rm the
-- encrypted blob after the DB delete.
DELETE FROM "Attachment" a
WHERE a.id = $1 AND a."userId" = $2
RETURNING a.*;

-- name: UpdateAttachmentDescription :one
-- PATCH /api/v1/attachments/{id}. Ownership is the row's "userId" since 0018, so
-- the same endpoint now also edits an inbox item's description. A non-owned id
-- matches no row → sqlc/pgx returns ErrNoRows → handler 404 (never 403, matching
-- downloadFileHandler's "leak nothing" policy).
-- A NULL $3 clears the description.
UPDATE "Attachment" a
SET description = $3
WHERE a.id = $1 AND a."userId" = $2
RETURNING a.*;

-- name: AssignAttachmentToDevice :one
-- POST /api/v1/attachments/{id}/file. $3 is the target device, or NULL to return
-- the item to the inbox. $4 is the blob's storagePath after the service moved it
-- to (or from) the reserved `_inbox` segment; storagePath is part of the backup
-- payload, so it must keep matching where the bytes actually are.
UPDATE "Attachment" a
SET "deviceId" = $3,
    "storagePath" = $4
WHERE a.id = $1 AND a."userId" = $2
RETURNING a.*;

-- name: SetAttachmentExtractedText :one
-- POST /api/v1/ai/extract-receipt, attachmentId branch (migration 0019). Writes
-- the text the model read off this attachment so GET /api/v1/search can find the
-- receipt by its contents later.
--
-- The text is PLAINTEXT in Postgres on purpose — the GIN trigram index in 0019 is
-- built over lower(public.wv_unaccent("extractedText")), and an encrypted value
-- could not be indexed or substring-searched. See the migration header and the
-- openapi.yaml privacy note for the trade-off.
--
-- $3 is the already-normalized text (trimmed, NUL-free, length-capped) or NULL;
-- "userId" keeps the write owner-scoped exactly like every other attachment read.
UPDATE "Attachment" a
SET "extractedText" = $3
WHERE a.id = $1 AND a."userId" = $2
RETURNING a.*;

-- name: CountAttachmentsByDevice :one
-- Filed attachments only, by construction: inbox rows have "deviceId" NULL and
-- NULL = $1 matches nothing. This is the per-device 5-file cap, so an inbox item
-- must never consume a slot.
SELECT COUNT(*)::bigint AS count
FROM "Attachment"
WHERE "deviceId" = $1;

-- name: CountAttachmentsByDeviceIDs :many
-- Batch attachment counts for ListDevices: one grouped query instead of one
-- COUNT per device. Devices with zero attachments are simply absent from the
-- result set — the caller defaults missing ids to 0. Inbox rows are excluded
-- (`deviceId` is NULL), matching CountAttachmentsByDevice.
SELECT a."deviceId" AS device_id, COUNT(*)::bigint AS count
FROM "Attachment" a
JOIN "Device" d ON d.id = a."deviceId"
WHERE a."deviceId" = ANY($1::text[]) AND d."userId" = $2
GROUP BY a."deviceId";

-- name: SumAttachmentBytesByUser :one
-- For MAX_UPLOAD_BYTES_PER_USER (100 MB) cap. Counts EVERYTHING the user owns,
-- inbox items included — the per-user ceiling is about bytes on disk, not about
-- whether the receipt has been filed yet. COALESCE so the empty-set case returns
-- 0 instead of NULL.
SELECT COALESCE(SUM(a."fileSize"), 0)::bigint AS total_bytes
FROM "Attachment" a
WHERE a."userId" = $1;

-- name: ListAttachmentsByUser :many
-- One batch for the insurance pack: every attachment FILED to one of the
-- caller's devices. Inbox items are excluded (deviceId IS NULL) because the
-- pack is a schedule of devices; they have no row in the schedule to hang from.
-- The join through Device is the ownership guard; "userId" is checked too so a
-- legacy row with a stale owner cannot leak in.
SELECT a.*
FROM "Attachment" a
JOIN "Device" d ON d.id = a."deviceId"
WHERE a."userId" = $1 AND a."deviceId" IS NOT NULL
ORDER BY a."deviceId" ASC, a."uploadedAt" DESC;
