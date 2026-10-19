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
-- Search is diacritic-insensitive: `lower(public.wv_unaccent(x))` (wrapper from
-- migration 0005, ordering fixed in 0007) strips Vietnamese accents on BOTH
-- sides, so "dien thoai" matches "Điện thoại". ILIKE is no longer needed because
-- both sides are lowercased; the predicate is `LIKE`.
--
-- The order matters: unaccent runs FIRST, then lower(). `wv_unaccent(lower(x))`
-- (the original 0005 ordering) is broken on a C/POSIX-locale database, where
-- lower() is ASCII-only — 'Đ' survives it and unaccent turns it into an
-- uppercase 'D', so the search silently matches nothing. See migration 0007.
--
-- Index note: migration 0007 creates GIN trigram indexes on exactly these four
-- expressions (in this order), but a trigram index can only be used when the LIKE
-- pattern is known at plan time. `'%' || lower(wv_unaccent($4)) || '%'` is
-- immutable, so PostgreSQL folds it into a constant in a *custom* plan and can
-- then use the index; under a generic plan (pgx caches statements,
-- plan_cache_mode=auto) the planner falls back to a sequential scan. Correctness
-- does not depend on the index either way — it is a speed optimisation only.

-- name: ListDevicesByUser :many
SELECT *
FROM "Device"
WHERE "userId" = $1
  AND (NULLIF($2::text, '') IS NULL OR category = $2)
  AND (NULLIF($3::text, '') IS NULL OR status = $3)
  AND (
    NULLIF($4::text, '') IS NULL
    OR lower(public.wv_unaccent(name)) LIKE '%' || lower(public.wv_unaccent($4::text)) || '%'
    OR lower(public.wv_unaccent(brand)) LIKE '%' || lower(public.wv_unaccent($4::text)) || '%'
    OR lower(public.wv_unaccent(model)) LIKE '%' || lower(public.wv_unaccent($4::text)) || '%'
    OR lower(public.wv_unaccent("serialNumber")) LIKE '%' || lower(public.wv_unaccent($4::text)) || '%'
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
-- currency/fxRate (migration 0022): fxRate is the VND value of one unit of
-- currency, LOCKED at entry. services.ValidateDeviceInput + resolveCreateCurrency
-- normalise and default currency, but the wishlist -> PURCHASED path calls this
-- query directly, so an empty param is mapped to 'VND' here as well — the same
-- default the column carries. fxRate is NULL for VND and for a row whose rate
-- was never recorded.
--
-- Brand warranty lookup (migration 0023, gap #11): the five columns are a
-- USER-ENTERED record of what the brand's own lookup page said. They are not a
-- second warranty calculation and the server never fetches "brandLookupUrl".
-- Nullable, no default: an unchecked brand is NULL, which is exactly the state
-- of every row that existed before this migration.
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
    "createdAt",
    "updatedAt"
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
    COALESCE(sqlc.narg('status')::text, 'ACTIVE'),
    $11, $12, $13, $14, $15,
    $16, $17, $18,
    COALESCE(sqlc.narg('leadDays')::int[], ARRAY[30, 7]::int[]),
    COALESCE(NULLIF(sqlc.arg('currency')::text, ''), 'VND'),
    sqlc.narg('fxRate')::int,
    sqlc.narg('brandWarrantyStatus')::text,
    sqlc.narg('brandWarrantyStart'),
    sqlc.narg('brandWarrantyEnd'),
    sqlc.narg('brandCheckedAt')::timestamp,
    sqlc.narg('brandLookupUrl')::text,
    NOW(),
    NOW()
)
RETURNING *;

-- name: UpdateDevice :one
-- Brand lookup fields are part of the full replacement, like soldAt/returnWindowDays:
-- an absent key clears them. That is the endpoint's documented PATCH semantics;
-- a client that has recorded a lookup must send all five back.
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
    "soldAt" = $13,
    "soldPrice" = $14,
    "returnWindowDays" = $15,
    "receivedAt" = $16,
    "leadDays" = $17,
    "activationRequired" = $18,
    "activatedAt" = $19,
    "extendedCoverBuyBy" = $20,
    currency = $21,
    "fxRate" = $22,
    "brandWarrantyStatus" = sqlc.narg('brandWarrantyStatus')::text,
    "brandWarrantyStart" = sqlc.narg('brandWarrantyStart'),
    "brandWarrantyEnd" = sqlc.narg('brandWarrantyEnd'),
    "brandCheckedAt" = sqlc.narg('brandCheckedAt')::timestamp,
    "brandLookupUrl" = sqlc.narg('brandLookupUrl')::text,
    "updatedAt" = NOW()
WHERE id = $1 AND "userId" = $2
RETURNING *;

-- name: DeleteDevice :execrows
-- Cascade handles Warranty / Attachment / Reminder rows. Caller is responsible
-- for removing the encrypted blobs from disk under PRIVATE_UPLOAD_ROOT.
DELETE FROM "Device"
WHERE id = $1 AND "userId" = $2;

-- name: CountActiveDevicesByUser :one
-- QUOTA count (FEATURE_IDEAS #14): a device the user has SOLD is history, not a
-- slot in the working set. Before this predicate existed the count included
-- `status = 'SOLD'`, so a user who had owned phones for five years hit the
-- 50-device ceiling and the only way to add the next one was to DELETE a sold
-- device — destroying the invoice, the sale date and the profit/loss record the
-- app exists to keep.
--
-- What "counts" is deliberately `status <> 'SOLD'` and NOT `"soldAt" IS NULL`:
-- `status` is the field the user sets (and the field every client/UI filters on),
-- while `soldAt` is the optional resale pair of migration 0006 that a user may
-- leave empty ("đã bán, không ghi chi tiết"). Keying the quota on `soldAt` would
-- make the limit depend on a field the user never sees in the list, and would
-- count a device as active while the UI shows "Đã bán".
--
-- This query is the QUOTA rule only. Reporting is untouched on purpose: the
-- device list, `GET /api/v1/stats` and the action queue keep using
-- ListDevicesByUserSimple / ListDevicesByUser, so a sold device still appears in
-- history and still counts in spend totals.
SELECT COUNT(*)::bigint AS count
FROM "Device"
WHERE "userId" = $1
  AND status <> 'SOLD';

-- name: CountAllDevicesByUser :one
-- Storage backstop (FEATURE_IDEAS #14, hazard 1). Relaxing the quota to "sold
-- devices are free" without a second ceiling would let an account accumulate
-- unbounded rows by repeatedly marking a device sold, creating another, and
-- un-selling the first. This count is the hard stop on TOTAL rows per user
-- (MAX_DEVICES_TOTAL_PER_USER = 500 = 10× the active cap) and is enforced on
-- BOTH write paths (CreateDevice and the backup import) so neither can be used
-- to walk around the other.
SELECT COUNT(*)::bigint AS count
FROM "Device"
WHERE "userId" = $1;

-- name: CountOtherDevicesBySerial :one
-- Advisory duplicate-serial lookup (FEATURE_IDEAS #6). Device."serialNumber"
-- has no unique index anywhere on purpose: legacy rows exist, a serial is not
-- globally unique, and VN warranty is keyed to the IMEI/serial — so a duplicate
-- is something to SHOW the user, never something to reject.
--
-- Case-insensitive: "abc123" and "ABC123" are the same identifier on a sticker.
-- exclude_id ($3) is the device being edited; '' (create / AI draft) matches
-- nothing, so the caller can always pass the id it already has and a device can
-- never collide with itself.
SELECT COUNT(*)::bigint AS count
FROM "Device"
WHERE "userId" = $1
  AND "serialNumber" IS NOT NULL
  AND lower("serialNumber") = lower(sqlc.arg('serial')::text)
  AND (sqlc.arg('excludeId')::text = '' OR id <> sqlc.arg('excludeId')::text);

-- name: ListActiveDeviceLeadDays :many
-- Cron support (migration 0015). One row per DISTINCT lead day that any active
-- device is currently asking for, sorted newest-first. The sweep runs one
-- day-window query per value, so the number of queries is the number of distinct
-- user choices (at most 5 per device, and typically a handful globally) rather
-- than 366.
--
-- `unnest` inside DISTINCT is what keeps this cheap: it does not care how many
-- devices chose the same number.
SELECT DISTINCT unnest("leadDays")::int AS lead_day
FROM "Device"
WHERE status = 'ACTIVE'
ORDER BY lead_day DESC;

-- name: ListDevicesAwaitingActivation :many
-- Cron support (migration 0016, Feature A). A device whose warranty only starts
-- on activation, where the user has not recorded an activation date yet.
--
-- ONCE-ONLY, not per-lead-day: there is no deadline to count down from — the
-- condition is true until the user acts — so the sweep relies on
-- "activationNotifiedAt" being NULL and stamps it after the fan-out. That keeps
-- the notification from becoming a daily nag and means a user who dismisses it
-- stays dismissed. Setting "activatedAt" stops it by definition; a later
-- clearing of that date does not resurrect the reminder (the stamp survives),
-- which is the conservative direction for a notice whose only action is
-- "go and enter a date".
--
-- Only ACTIVE devices: a SOLD/BROKEN/LOST device has no live warranty whose
-- start matters. The set is bounded by MAX_DEVICES_PER_USER = 50.
SELECT
    d.id       AS id,
    d."userId" AS user_id,
    d.name     AS device_name
FROM "Device" d
WHERE d.status = 'ACTIVE'
  AND d."activationRequired" = true
  AND d."activatedAt" IS NULL
  AND d."activationNotifiedAt" IS NULL
ORDER BY d."createdAt" ASC;

-- name: StampDeviceActivationNotified :exec
-- Once-only marker: the next run filters the row out forever. Bumps "updatedAt"
-- like the other subject-table stamps.
UPDATE "Device"
SET "activationNotifiedAt" = NOW(),
    "updatedAt" = NOW()
WHERE id = $1;

-- name: ListExtendedCoverInWindow :many
-- Cron support (migration 0016, Feature A). ACTIVE devices whose
-- "extendedCoverBuyBy" falls in [windowStart, windowEnd) AND whose "leadDays"
-- contains this run's leadDay.
--
-- "extendedCoverBuyBy" is an INCLUSIVE last day (the day the window closes), so
-- this uses the NATURAL day mapping — dayWindow(now, days) — the same convention
-- as the return-window and subscription-renewal sweeps: a 7-day lead means the
-- deadline is exactly 7 calendar days away. It deliberately does NOT use the
-- warranty sweep's inclusive-minus-one convention, which counts today as day 1
-- for an endDate.
--
-- Idempotency is the per-lead-day key of migration 0015, on this table:
--   (deviceId, leadDay, calendar day)
-- stored as (extendedCoverNotifiedAt::date, extendedCoverNotifiedLeadDay). A row
-- is skipped only when the SAME lead day was stamped today; a different lead day
-- on the same day still fires. leadDay IS NULL on a hand-edited row means
-- "handled today for every lead day" — the conservative reading.
SELECT
    d.id                 AS id,
    d."userId"           AS user_id,
    d.name               AS device_name,
    d."extendedCoverBuyBy" AS extended_cover_buy_by
FROM "Device" d
WHERE d.status = 'ACTIVE'
  AND d."extendedCoverBuyBy" IS NOT NULL
  AND sqlc.arg('leadDay')::int = ANY(d."leadDays")
  AND d."extendedCoverBuyBy" >= sqlc.arg('windowStart')::timestamp
  AND d."extendedCoverBuyBy" <  sqlc.arg('windowEnd')::timestamp
  AND (
      d."extendedCoverNotifiedAt" IS NULL
      OR d."extendedCoverNotifiedAt"::date < CURRENT_DATE
      OR (d."extendedCoverNotifiedLeadDay" IS NOT NULL
          AND d."extendedCoverNotifiedLeadDay" <> sqlc.arg('leadDay')::int)
  );

-- name: StampDeviceExtendedCoverNotified :exec
-- Cron stamps this after the fan-out. `leadDay` is part of the idempotency key,
-- not decoration: a same-day 30-day push must not suppress the 7-day one.
UPDATE "Device"
SET "extendedCoverNotifiedAt" = NOW(),
    "extendedCoverNotifiedLeadDay" = sqlc.arg('leadDay')::int,
    "updatedAt" = NOW()
WHERE id = $1;
