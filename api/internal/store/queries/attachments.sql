-- Attachment CRUD. Files themselves live encrypted on disk under
-- PRIVATE_UPLOAD_ROOT; this table only stores metadata + the wrapped data
-- key + IV. The file_master_key (env) is required to decrypt — disk alone
-- or DB alone is not enough.

-- name: ListAttachmentsByDevice :many
SELECT a.*
FROM "Attachment" a
JOIN "Device" d ON d.id = a."deviceId"
WHERE a."deviceId" = $1 AND d."userId" = $2
ORDER BY a."uploadedAt" DESC;

-- name: GetAttachmentByID :one
SELECT a.*
FROM "Attachment" a
JOIN "Device" d ON d.id = a."deviceId"
WHERE a.id = $1 AND d."userId" = $2
LIMIT 1;

-- name: GetAttachmentByIDInternal :one
-- No user-scoping; used by file streaming after the handler has verified
-- ownership separately (or in tests).
SELECT *
FROM "Attachment"
WHERE id = $1
LIMIT 1;

-- name: CreateAttachment :one
INSERT INTO "Attachment" (
    id,
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
    $1, $2, $3, $4, $5, $6, $7, $8, $9, NOW()
)
RETURNING *;

-- name: DeleteAttachment :one
-- Returns the row (storagePath in particular) so the service can rm the
-- encrypted blob after the DB delete.
DELETE FROM "Attachment" a
USING "Device" d
WHERE a.id = $1 AND a."deviceId" = d.id AND d."userId" = $2
RETURNING a.*;

-- name: UpdateAttachmentDescription :one
-- PATCH /api/v1/attachments/{id}. Ownership is enforced through the owning
-- Device row (the same join used by GetAttachmentByID), and a non-owned id
-- simply matches no row → sqlc/pgx returns ErrNoRows → handler 404 (never 403,
-- matching downloadFileHandler's "leak nothing" policy).
-- A NULL $3 clears the description.
UPDATE "Attachment" a
SET description = $3
FROM "Device" d
WHERE a.id = $1 AND a."deviceId" = d.id AND d."userId" = $2
RETURNING a.*;

-- name: CountAttachmentsByDevice :one
SELECT COUNT(*)::bigint AS count
FROM "Attachment"
WHERE "deviceId" = $1;

-- name: CountAttachmentsByDeviceIDs :many
-- Batch attachment counts for ListDevices: one grouped query instead of one
-- COUNT per device. Devices with zero attachments are simply absent from the
-- result set — the caller defaults missing ids to 0.
SELECT a."deviceId" AS device_id, COUNT(*)::bigint AS count
FROM "Attachment" a
JOIN "Device" d ON d.id = a."deviceId"
WHERE a."deviceId" = ANY($1::text[]) AND d."userId" = $2
GROUP BY a."deviceId";

-- name: SumAttachmentBytesByUser :one
-- For MAX_UPLOAD_BYTES_PER_USER (100 MB) cap. COALESCE so the empty-set
-- case returns 0 instead of NULL.
SELECT COALESCE(SUM(a."fileSize"), 0)::bigint AS total_bytes
FROM "Attachment" a
JOIN "Device" d ON d.id = a."deviceId"
WHERE d."userId" = $1;
