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
-- Total count + sum of purchasePrice converted to VND at each device's LOCKED
-- rate (migration 0022).
--
-- `purchasePrice` is in the device's own `currency`; before 0022 this SUM added
-- USD 999 and 25,000,000 VND as if both were dong. The conversion uses the
-- `fxRate` stored on the row — the rate the user locked when recording the
-- purchase, NOT a live rate — so a historical total never drifts with the
-- market.
--
-- A VND device has `fxRate IS NULL` and converts 1:1 (the `currency = 'VND'`
-- branch is what keeps every pre-0022 total byte-identical: SUM(purchasePrice)).
-- A non-VND row with no rate can only be hand-edited data, and its VND value is
-- genuinely unknown, so it contributes nothing (NULL) rather than being counted
-- at par — the same honesty rule the per-device `purchasePriceVnd` follows.
--
-- ROUND (half away from zero) rather than truncation: 25,860.555369 VND/USD
-- times 999 USD is 25,834,694.81 VND, and the rollup should not lose a dong to
-- integer division. numeric in the middle, bigint at the end: the product of two
-- int32 columns cannot overflow int64.
SELECT
    COUNT(*)::bigint AS total,
    COALESCE(SUM(
        CASE
            WHEN d.currency = 'VND' THEN d."purchasePrice"::numeric
            WHEN d."fxRate" IS NOT NULL THEN ROUND(d."purchasePrice"::numeric * d."fxRate")
        END
    ), 0)::bigint AS total_purchase_price
FROM "Device" d
WHERE d."userId" = $1;

-- name: StatsActiveAssetValue :one
-- "Còn bảo hành" = device.status = ACTIVE AND has at least one warranty whose
-- endDate is today or later (any package).
--
-- endDate is a calendar-day column (stored at UTC midnight), not an instant, so
-- it must be compared with a DATE. `> NOW()` retired a package at 00:00 UTC
-- (07:00 ICT) on its last covered day — the exact defect d52e01e fixed in
-- services/directory.go — and this predicate was the sibling nobody had wired
-- up. It is still not wired: Snapshot does not expose an active-asset total and
-- the web computes the value from the device list in local days
-- (website/src/lib/stats-rollup.ts). The comparison is against CURRENT_DATE on
-- the session's (UTC) calendar, the only day SQL itself can name; a future
-- caller that needs the user's local day must pass it in as a parameter, the
-- way ListSubscriptionsOverdue takes `today`.
SELECT
    COUNT(DISTINCT d.id)::bigint                 AS count,
    COALESCE(SUM(DISTINCT d."purchasePrice"), 0)::bigint AS total
FROM "Device" d
JOIN "Warranty" w ON w."deviceId" = d.id
WHERE d."userId" = $1
  AND d.status = 'ACTIVE'
  AND w."endDate" >= CURRENT_DATE;

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
  AND "purchaseDate" >= sqlc.arg('purchaseFrom')::timestamp
GROUP BY 1, 2
ORDER BY 1 ASC, 2 ASC;

-- name: StatsYearlySpend :one
SELECT
    COUNT(*)::bigint               AS count,
    COALESCE(SUM("purchasePrice"), 0)::bigint AS total
FROM "Device"
WHERE "userId" = $1
  AND "purchaseDate" >= sqlc.arg('purchaseFrom')::timestamp
  AND "purchaseDate" <  sqlc.arg('purchaseTo')::timestamp;

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
    SUM(CASE WHEN w."endDate" <= sqlc.arg('within7')::timestamp THEN 1 ELSE 0 END)::bigint AS expiring_7d,
    SUM(CASE WHEN w."endDate" <= sqlc.arg('within30')::timestamp THEN 1 ELSE 0 END)::bigint AS expiring_30d
FROM "Warranty" w
JOIN "Device" d ON d.id = w."deviceId"
WHERE d."userId" = $1
  AND d.status = 'ACTIVE'
  AND w."endDate" >= sqlc.arg('windowStart')::timestamp
  AND NOT EXISTS (
      SELECT 1 FROM "Reminder" r
      WHERE r."warrantyId" = w.id AND r."isDismissed" = true
  );

-- name: StatsTotalWarrantyCost :one
-- Sum of Warranty.cost across every package on the user's devices, converted to
-- VND at the device's locked rate (migration 0022). Feeds
-- `devices.totalWarrantyCost` on GET /api/v1/stats.
--
-- `Warranty.cost` is in the DEVICE's currency: a USD 99 AppleCare+ package on a
-- USD device must not be added to the VND total as 99 dong. The rate is the one
-- stored on the device row (locked when the purchase was recorded), never a
-- live rate.
--
-- cost is nullable: SUM() ignores NULL rows (a package stored without a price
-- adds nothing to the total), and COALESCE turns the all-NULL / no-warranty
-- case into 0 — the same treatment every other money rollup in this file
-- gives a nullable sum. A non-VND device with no rate contributes nothing
-- (unknown), not its face value. The result is widened to bigint (money is
-- stored as int32 per row but totalled as int64) so a user with many costly
-- packages cannot overflow the total.
SELECT
    COALESCE(SUM(
        CASE
            WHEN d.currency = 'VND' THEN w."cost"::numeric
            WHEN d."fxRate" IS NOT NULL THEN ROUND(w."cost"::numeric * d."fxRate")
        END
    ), 0)::bigint AS total_warranty_cost
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

-- ─── Spending forecast (GET /api/v1/forecast) ─────────────────────────────
--
-- The forecast is a forward-looking read, so these two queries only fetch the
-- candidate rows inside the caller's window; every bucket is computed in Go by
-- services.Forecast so the arithmetic is a pure, testable function of a
-- deterministic "now" (no NOW() in the maths, no wall-clock test).
--
-- Subscriptions need no new query: ListSubscriptionsByUser(status='ACTIVE')
-- already returns exactly the rows the forecast walks (LIFETIME is filtered in
-- Go, where MonthlyEquivalent also treats it as 0).

-- name: ListWarrantiesExpiringBetween :many
-- Warranties whose endDate lands in [from, to) on a device that is still ACTIVE.
-- A warranty on a SOLD/BROKEN/LOST device is not an upcoming milestone — the same
-- `d.status = 'ACTIVE'` predicate the reminder feed and StatsWarrantyExpiring use.
--
-- The Reminder dismissal gate is deliberately NOT applied: `isDismissed` is a
-- push-suppression flag (see docs/SPEC-MAINTENANCE-SCHEDULES.md §2.3), while this
-- is a money plan the user asked to look at.
SELECT
    w.*,
    d.name AS device_name
FROM "Warranty" w
JOIN "Device" d ON d.id = w."deviceId"
WHERE d."userId" = $1
  AND d.status = 'ACTIVE'
  AND w."endDate" >= sqlc.arg('from')::timestamp
  AND w."endDate" <  sqlc.arg('to')::timestamp
ORDER BY w."endDate" ASC;

-- name: ListWishlistTargetsBetween :many
-- Wishlist items with a targetDate in [from, to), restricted to the "still
-- interesting" statuses (WATCHING|DECIDED) — exactly the set the cron target-date
-- push and StatsWishlistActiveValue treat as active. A PURCHASED or SKIPPED item
-- is not an upcoming spend.
SELECT *
FROM "WishlistItem"
WHERE "userId" = $1
  AND status IN ('WATCHING', 'DECIDED')
  AND "targetDate" IS NOT NULL
  AND "targetDate" >= sqlc.arg('from')::timestamp
  AND "targetDate" <  sqlc.arg('to')::timestamp
ORDER BY "targetDate" ASC;
