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
--
-- Search is diacritic-insensitive: `public.wv_unaccent(lower(x))` (defined in
-- migration 0005) strips Vietnamese accents on BOTH sides, so "dien thoai"
-- matches "Điện thoại". ILIKE is no longer needed because both sides are
-- lowercased; the predicate is `LIKE`.
--
-- Index note: migration 0005 creates GIN trigram indexes on exactly these four
-- expressions, but a trigram index can only be used when the LIKE pattern is
-- known at plan time. `'%' || wv_unaccent(lower($4)) || '%'` is immutable, so
-- PostgreSQL folds it into a constant in a *custom* plan and can then use the
-- index; under a generic plan (pgx caches statements, plan_cache_mode=auto) the
-- planner falls back to a sequential scan. Correctness does not depend on the
-- index either way — it is a speed optimisation only.

-- name: ListDevicesByUser :many
SELECT *
FROM "Device"
WHERE "userId" = $1
  AND (NULLIF($2::text, '') IS NULL OR category = $2)
  AND (NULLIF($3::text, '') IS NULL OR status = $3)
  AND (
    NULLIF($4::text, '') IS NULL
    OR public.wv_unaccent(lower(name)) LIKE '%' || public.wv_unaccent(lower($4::text)) || '%'
    OR public.wv_unaccent(lower(brand)) LIKE '%' || public.wv_unaccent(lower($4::text)) || '%'
    OR public.wv_unaccent(lower(model)) LIKE '%' || public.wv_unaccent(lower($4::text)) || '%'
    OR public.wv_unaccent(lower("serialNumber")) LIKE '%' || public.wv_unaccent(lower($4::text)) || '%'
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
