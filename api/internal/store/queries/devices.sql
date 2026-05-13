-- Device CRUD + list queries.
--
-- The web service layer (`website/src/lib/devices.ts::listDevices`) supports
-- filters by category/status and a free-text search across name/brand/model/
-- serialNumber. We expose those as `NULLIF($N, '')` filters so handlers can
-- pass empty strings for "no filter" without branching SQL.
--
-- Sorting: SQL handles purchaseDate / purchasePrice / name. Sort by effective
-- warranty end date is computed from the related `Warranty` rows and is
-- handled in the service layer (Go) — same trade-off as the TS version.

-- name: ListDevicesByUser :many
SELECT *
FROM "Device"
WHERE "userId" = $1
  AND (NULLIF($2::text, '') IS NULL OR category = $2)
  AND (NULLIF($3::text, '') IS NULL OR status = $3)
  AND (
    NULLIF($4::text, '') IS NULL
    OR name ILIKE '%' || $4 || '%'
    OR brand ILIKE '%' || $4 || '%'
    OR model ILIKE '%' || $4 || '%'
    OR "serialNumber" ILIKE '%' || $4 || '%'
  )
ORDER BY "createdAt" DESC;

-- name: ListDevicesByUserSimple :many
-- Plain list for callers that don't need filters (cron, stats fanout).
SELECT *
FROM "Device"
WHERE "userId" = $1
ORDER BY "createdAt" DESC;

-- name: GetDeviceByID :one
SELECT *
FROM "Device"
WHERE id = $1 AND "userId" = $2
LIMIT 1;

-- name: GetDeviceByIDAnyUser :one
-- Internal use (cron) where user scoping is implicit via join. Prefer
-- GetDeviceByID in handlers.
SELECT *
FROM "Device"
WHERE id = $1
LIMIT 1;

-- name: CreateDevice :one
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
    "createdAt",
    "updatedAt"
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
    COALESCE(sqlc.narg('status')::text, 'ACTIVE'),
    $11,
    NOW(),
    NOW()
)
RETURNING *;

-- name: UpdateDevice :one
UPDATE "Device" SET
    name = $3,
    category = $4,
    brand = $5,
    model = $6,
    "serialNumber" = $7,
    "purchaseDate" = $8,
    "purchasePrice" = $9,
    "purchasePlace" = $10,
    status = $11,
    notes = $12,
    "updatedAt" = NOW()
WHERE id = $1 AND "userId" = $2
RETURNING *;

-- name: DeleteDevice :execrows
-- Cascade handles Warranty / Attachment / Reminder rows. Caller is responsible
-- for removing the encrypted blobs from disk under PRIVATE_UPLOAD_ROOT.
DELETE FROM "Device"
WHERE id = $1 AND "userId" = $2;

-- name: CountDevicesByUser :one
SELECT COUNT(*)::bigint AS count
FROM "Device"
WHERE "userId" = $1;
