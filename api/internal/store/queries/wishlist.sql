-- Wishlist + WishlistPrice queries.
--
-- Wishlist statuses: WATCHING / DECIDED / SKIPPED / PURCHASED.
-- "Active" set used by cron = (WATCHING, DECIDED).

-- name: ListWishlistByUser :many
SELECT *
FROM "WishlistItem"
WHERE "userId" = $1
  AND (NULLIF($2::text, '') IS NULL OR status = $2)
ORDER BY "createdAt" DESC;

-- name: GetWishlistByID :one
SELECT *
FROM "WishlistItem"
WHERE id = $1 AND "userId" = $2
LIMIT 1;

-- name: CreateWishlist :one
INSERT INTO "WishlistItem" (
    id,
    "userId",
    name,
    category,
    brand,
    "initialPrice",
    "currentPrice",
    "buyUrl",
    "imageUrl",
    "targetDate",
    priority,
    status,
    notes,
    "reminderIntervalDays",
    "createdAt",
    "updatedAt"
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
    COALESCE(sqlc.narg('priority')::text, 'WANT'),
    COALESCE(sqlc.narg('status')::text, 'WATCHING'),
    $11, $12,
    NOW(), NOW()
)
RETURNING *;

-- name: UpdateWishlist :one
UPDATE "WishlistItem" SET
    name = $3,
    category = $4,
    brand = $5,
    "initialPrice" = $6,
    "currentPrice" = $7,
    "buyUrl" = $8,
    "imageUrl" = $9,
    "targetDate" = $10,
    priority = $11,
    status = $12,
    notes = $13,
    "reminderIntervalDays" = $14,
    "updatedAt" = NOW()
WHERE id = $1 AND "userId" = $2
RETURNING *;

-- name: DeleteWishlist :execrows
DELETE FROM "WishlistItem"
WHERE id = $1 AND "userId" = $2;

-- name: SetWishlistStatus :one
UPDATE "WishlistItem"
SET status = $3, "updatedAt" = NOW()
WHERE id = $1 AND "userId" = $2
RETURNING *;

-- name: SetWishlistCurrentPrice :exec
-- Used by `logWishlistPrice`: when a user adds a price-history row, also bump
-- currentPrice on the item itself. Caller wraps both in a transaction.
UPDATE "WishlistItem"
SET "currentPrice" = $2, "updatedAt" = NOW()
WHERE id = $1 AND "userId" = $3;

-- name: CountWishlistByUser :one
SELECT COUNT(*)::bigint AS count
FROM "WishlistItem"
WHERE "userId" = $1;

-- ─── Mark purchased (linked to Device) ────────────────────────────────────

-- name: MarkWishlistPurchased :one
-- Called inside a transaction with CreateDevice. Caller passes the device id
-- after creating the device so we can store the back-reference. Defense in
-- depth: filters by userId here too.
UPDATE "WishlistItem"
SET status = 'PURCHASED',
    "purchasedDeviceId" = $3,
    "updatedAt" = NOW()
WHERE id = $1 AND "userId" = $2
RETURNING *;

-- name: MarkWishlistPurchasedAsSubscription :one
-- Variant for when the user converts a wishlist item into a Subscription
-- (no Device link). Mirrors the TS createSubscription wishlist branch.
UPDATE "WishlistItem"
SET status = 'PURCHASED',
    notes = $3,
    "updatedAt" = NOW()
WHERE id = $1 AND "userId" = $2
RETURNING *;

-- ─── Price history ────────────────────────────────────────────────────────

-- name: CreateWishlistPrice :one
INSERT INTO "WishlistPrice" (
    id,
    "itemId",
    price,
    note,
    "recordedAt"
) VALUES (
    $1, $2, $3, $4, NOW()
)
RETURNING *;

-- name: ListWishlistPricesByItem :many
SELECT p.*
FROM "WishlistPrice" p
JOIN "WishlistItem" i ON i.id = p."itemId"
WHERE p."itemId" = $1 AND i."userId" = $2
ORDER BY p."recordedAt" DESC;

-- ─── Cron fan-out queries ─────────────────────────────────────────────────

-- name: ListWishlistTargetDateDue :many
-- Items in WATCHING|DECIDED status with targetDate in [start, end).
-- Skips items whose lastNotifiedAt is already today — that's the idempotency
-- guard against re-firing the same target-date push when the cron runs more
-- than once in a day. The cron stamps lastNotifiedAt = NOW() after firing.
SELECT *
FROM "WishlistItem"
WHERE status IN ('WATCHING', 'DECIDED')
  AND "targetDate" IS NOT NULL
  AND "targetDate" >= $1
  AND "targetDate" <  $2
  AND ("lastNotifiedAt" IS NULL OR "lastNotifiedAt"::date < CURRENT_DATE);

-- name: ListWishlistDueForCheckin :many
-- Periodic price-check pings. Items with reminderIntervalDays set, where
-- elapsed since lastNotifiedAt (or createdAt if never notified) is >=
-- reminderIntervalDays. Pushes the elapsed-days check into SQL — TS does it
-- client-side, this is a deliberate improvement.
SELECT *
FROM "WishlistItem"
WHERE status IN ('WATCHING', 'DECIDED')
  AND "reminderIntervalDays" IS NOT NULL
  AND NOW() - COALESCE("lastNotifiedAt", "createdAt")
      >= ("reminderIntervalDays" * INTERVAL '1 day');

-- name: StampWishlistNotified :exec
UPDATE "WishlistItem"
SET "lastNotifiedAt" = NOW(),
    "updatedAt" = NOW()
WHERE id = $1;
