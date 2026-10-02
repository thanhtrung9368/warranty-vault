-- Aggregate stats for the dashboard / mobile home screen.
--
-- Mirrors `website/src/lib/services/stats.ts::getUserStats` and
-- `website/src/lib/stats.ts`. We push as much of the aggregation into SQL
-- as is practical without losing readability. The monthly-equivalent
-- calculation for subscriptions is done with a CASE expression because the
-- formula varies per billingCycle.

-- ─── Devices ──────────────────────────────────────────────────────────────

-- name: StatsDevicesByStatus :many
-- One row per status with the count.
SELECT status, COUNT(*)::bigint AS count
FROM "Device"
WHERE "userId" = $1
GROUP BY status;

-- name: StatsDevicesTotal :one
-- Total count + sum of purchasePrice for the user's devices.
SELECT
    COUNT(*)::bigint                  AS total,
    COALESCE(SUM("purchasePrice"), 0)::bigint AS total_purchase_price
FROM "Device"
WHERE "userId" = $1;

-- name: StatsActiveAssetValue :one
-- "Còn bảo hành" = device.status = ACTIVE AND has at least one warranty
-- with endDate > now (any package).
SELECT
    COUNT(DISTINCT d.id)::bigint                 AS count,
    COALESCE(SUM(DISTINCT d."purchasePrice"), 0)::bigint AS total
FROM "Device" d
JOIN "Warranty" w ON w."deviceId" = d.id
WHERE d."userId" = $1
  AND d.status = 'ACTIVE'
  AND w."endDate" > NOW();

-- name: StatsTopExpensiveDevices :many
SELECT id, name, brand, category, "purchasePrice", "purchaseDate"
FROM "Device"
WHERE "userId" = $1
ORDER BY "purchasePrice" DESC
LIMIT $2;

-- name: StatsSpendByCategory :many
-- GROUP BY category with sum + count. Caller maps category code -> Vietnamese
-- label via CATEGORY_LABELS in app code.
SELECT
    category,
    COUNT(*)::bigint              AS count,
    COALESCE(SUM("purchasePrice"), 0)::bigint AS total
FROM "Device"
WHERE "userId" = $1
GROUP BY category;

-- name: StatsMonthlySpend :many
-- 12-month rolling buckets (or N months if caller wants more). Returns one
-- row per (year, month) with the device-purchase total. Caller right-fills
-- empty months in app code so the histogram has a value for every bucket.
SELECT
    EXTRACT(YEAR  FROM "purchaseDate")::int  AS year,
    EXTRACT(MONTH FROM "purchaseDate")::int  AS month,
    COALESCE(SUM("purchasePrice"), 0)::bigint AS total
FROM "Device"
WHERE "userId" = $1
  AND "purchaseDate" >= $2
GROUP BY 1, 2
ORDER BY 1 ASC, 2 ASC;

-- name: StatsYearlySpend :one
SELECT
    COUNT(*)::bigint               AS count,
    COALESCE(SUM("purchasePrice"), 0)::bigint AS total
FROM "Device"
WHERE "userId" = $1
  AND "purchaseDate" >= $2
  AND "purchaseDate" <  $3;

-- name: StatsYearsWithData :many
-- Distinct years where the user has at least one device purchase. Caller
-- adds the current year + sorts desc.
SELECT DISTINCT EXTRACT(YEAR FROM "purchaseDate")::int AS year
FROM "Device"
WHERE "userId" = $1
ORDER BY 1 DESC;

-- ─── Warranties ───────────────────────────────────────────────────────────

-- name: StatsWarrantyExpiring :one
-- Counts of warranties expiring within 7 days vs 30 days, scoped to ACTIVE
-- devices and excluding warranties with a dismissed Reminder. Caller passes
-- the [now, +7d] and [now, +30d] window bounds.
SELECT
    SUM(CASE WHEN w."endDate" <= $2 THEN 1 ELSE 0 END)::bigint AS expiring_7d,
    SUM(CASE WHEN w."endDate" <= $3 THEN 1 ELSE 0 END)::bigint AS expiring_30d
FROM "Warranty" w
JOIN "Device" d ON d.id = w."deviceId"
WHERE d."userId" = $1
  AND d.status = 'ACTIVE'
  AND w."endDate" >= $4
  AND NOT EXISTS (
      SELECT 1 FROM "Reminder" r
      WHERE r."warrantyId" = w.id AND r."isDismissed" = true
  );

-- name: StatsTotalWarrantyCost :one
-- Sum of Warranty.cost across every package on the user's devices. Feeds
-- `devices.totalWarrantyCost` on GET /api/v1/stats.
--
-- cost is nullable: SUM() ignores NULL rows (a package stored without a price
-- adds nothing to the total), and COALESCE turns the all-NULL / no-warranty
-- case into 0 — the same treatment every other money rollup in this file
-- gives a nullable sum. The result is widened to bigint (money is stored as
-- int32 per row but totalled as int64) so a user with many costly packages
-- cannot overflow the total.
SELECT
    COALESCE(SUM(w."cost"), 0)::bigint AS total_warranty_cost
FROM "Warranty" w
JOIN "Device" d ON d.id = w."deviceId"
WHERE d."userId" = $1;

-- ─── Subscriptions ────────────────────────────────────────────────────────

-- name: StatsSubscriptionsByStatus :many
SELECT status, COUNT(*)::bigint AS count
FROM "Subscription"
WHERE "userId" = $1
GROUP BY status;

-- name: StatsSubscriptionsMonthly :one
-- Per-cycle monthly equivalent:
--   MONTHLY   -> price
--   QUARTERLY -> floor(price / 3)
--   YEARLY    -> floor(price / 12)
--   CUSTOM    -> round(price * 30.0 / intervalDays) when intervalDays > 0
--   LIFETIME  -> 0 (filtered out by predicate)
-- Counts only ACTIVE non-LIFETIME subs, matching the TS implementation.
SELECT
    COALESCE(SUM(
        CASE "billingCycle"
            WHEN 'MONTHLY'   THEN price
            WHEN 'QUARTERLY' THEN price / 3
            WHEN 'YEARLY'    THEN price / 12
            WHEN 'CUSTOM'    THEN
                CASE WHEN COALESCE("intervalDays", 0) > 0
                     THEN ROUND((price::numeric * 30) / "intervalDays")::int
                     ELSE 0
                END
            ELSE 0
        END
    ), 0)::bigint AS total_monthly_vnd
FROM "Subscription"
WHERE "userId" = $1
  AND status = 'ACTIVE'
  AND "billingCycle" <> 'LIFETIME';

-- ─── Wishlist ─────────────────────────────────────────────────────────────

-- name: StatsWishlistByStatus :many
SELECT status, COUNT(*)::bigint AS count
FROM "WishlistItem"
WHERE "userId" = $1
GROUP BY status;

-- name: StatsWishlistActiveValue :one
-- Sum of currentPrice for items in WATCHING|DECIDED.
SELECT
    COALESCE(SUM("currentPrice"), 0)::bigint AS total
FROM "WishlistItem"
WHERE "userId" = $1
  AND status IN ('WATCHING', 'DECIDED');
