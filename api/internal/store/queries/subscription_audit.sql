-- Subscription audit (FEATURE_IDEAS #4) — "gói bị bỏ quên / tăng giá / trùng nhau".
--
-- Pure SQL, no AI. These three queries do the AGGREGATION only; every threshold
-- lives as a named constant in internal/services/subscription_audit.go so the
-- decision logic is unit-testable without a database and cannot drift between the
-- SQL and the docs.
--
-- Advisory by construction: nothing in this file writes.

-- name: ListSubscriptionPaymentAudit :many
-- One row per subscription the user owns, carrying everything the detector needs
-- to judge "gói bị bỏ quên".
--
-- `Auto-renew` is the exact note the cron writes when it auto-charges
-- (internal/cron/run.go, bucket 5), so splitting payments on it separates
-- machine-billed periods from periods the user recorded by hand. That split is
-- the ONLY activity signal this app actually has: it cannot observe whether a
-- service was used, opened, or streamed. The detector is written to say so out
-- loud rather than to imply "unused".
SELECT
    s.id,
    s.name,
    s."billingCycle" AS billing_cycle,
    s."intervalDays" AS interval_days,
    s.price,
    s."autoRenew"    AS auto_renew,
    s.status,
    s."renewalDate"  AS renewal_date,
    s."startedAt"    AS started_at,
    COUNT(p.id)::bigint AS payment_count,
    COUNT(p.id) FILTER (WHERE p.note = 'Auto-renew')::bigint AS auto_renew_count,
    COUNT(p.id) FILTER (WHERE p.note IS DISTINCT FROM 'Auto-renew')::bigint AS manual_count,
    MIN(p."paidAt")::timestamp AS first_paid_at,
    MAX(p."paidAt")::timestamp AS last_paid_at,
    COALESCE(SUM(p.amount) FILTER (WHERE p.note = 'Auto-renew'), 0)::bigint AS auto_charged_total
FROM "Subscription" s
LEFT JOIN "SubscriptionPayment" p ON p."subscriptionId" = s.id
WHERE s."userId" = $1
GROUP BY s.id, s.name, s."billingCycle", s."intervalDays", s.price,
         s."autoRenew", s.status, s."renewalDate", s."startedAt"
ORDER BY s."renewalDate" ASC;

-- name: ListSubscriptionPriceRises :many
-- Price rises between CONSECUTIVE payments. LAG over the whole history means one
-- query for every subscription of the user instead of one query per subscription
-- from the client (the N+1 that makes this worth doing server-side).
--
-- `p.id` is the tiebreaker in the window ordering: two payments can share a
-- paidAt (a manual entry logged with the same date), and without a deterministic
-- order the "previous" amount would flip between runs.
SELECT
    pr."subscriptionId" AS subscription_id,
    s.name              AS subscription_name,
    s."billingCycle"    AS billing_cycle,
    pr."paidAt"         AS paid_at,
    pr.amount           AS amount,
    pr.prev_amount      AS prev_amount,
    pr.prev_paid_at     AS prev_paid_at
FROM (
    SELECT
        p."subscriptionId",
        p."paidAt",
        p.amount,
        (LAG(p.amount)  OVER w)::integer  AS prev_amount,
        (LAG(p."paidAt") OVER w)::timestamp AS prev_paid_at
    FROM "SubscriptionPayment" p
    JOIN "Subscription" s ON s.id = p."subscriptionId"
    WHERE s."userId" = $1
    WINDOW w AS (PARTITION BY p."subscriptionId" ORDER BY p."paidAt", p.id)
) pr
JOIN "Subscription" s ON s.id = pr."subscriptionId"
WHERE pr.prev_amount IS NOT NULL
  AND pr.amount > pr.prev_amount
ORDER BY pr."paidAt" DESC;

-- name: ListSubscriptionDuplicatePairs :many
-- Likely duplicates: two ACTIVE subscriptions of the same user that are the same
-- thing under a different spelling. Two independent signals, reported in `reason`:
--
--   SAME_NAME           — equal after lower(wv_unaccent(btrim(name))).
--   SAME_BRAND_CATEGORY — equal brand AND equal category, both non-empty.
--
-- The comparison reuses public.wv_unaccent (migrations 0005/0007), the same
-- IMMUTABLE wrapper device search is built on, so "iCloud+" matches "icloud+" and
-- "Điện thoại" matches "dien thoai" without introducing a fourth normalisation
-- implementation in the repo.
--
-- LIFETIME is excluded on BOTH sides: a one-off lifetime purchase next to a
-- recurring plan is not a duplicate, and neither is a plan that is not billed
-- again. Both rows must be ACTIVE, which by definition means the user holds both
-- right now — that is the only "overlap" the schema can express, since an ACTIVE
-- subscription has no end date.
--
-- `b.id > a.id` yields each unordered pair exactly once.
SELECT
    a.id             AS id_a,
    a.name           AS name_a,
    a.brand          AS brand_a,
    a.category       AS category_a,
    a.price          AS price_a,
    a."billingCycle" AS billing_cycle_a,
    a."intervalDays" AS interval_days_a,
    a."renewalDate"  AS renewal_date_a,
    b.id             AS id_b,
    b.name           AS name_b,
    b.brand          AS brand_b,
    b.category       AS category_b,
    b.price          AS price_b,
    b."billingCycle" AS billing_cycle_b,
    b."intervalDays" AS interval_days_b,
    b."renewalDate"  AS renewal_date_b,
    CASE
        WHEN lower(public.wv_unaccent(btrim(a.name)))
             = lower(public.wv_unaccent(btrim(b.name)))
        THEN 'SAME_NAME'
        ELSE 'SAME_BRAND_CATEGORY'
    END AS reason
FROM "Subscription" a
JOIN "Subscription" b
    ON b."userId" = a."userId"
   AND b.id > a.id
WHERE a."userId" = $1
  AND a.status = 'ACTIVE'
  AND b.status = 'ACTIVE'
  AND a."billingCycle" <> 'LIFETIME'
  AND b."billingCycle" <> 'LIFETIME'
  AND (
      lower(public.wv_unaccent(btrim(a.name)))
          = lower(public.wv_unaccent(btrim(b.name)))
      OR (
          a.brand IS NOT NULL AND b.brand IS NOT NULL
          AND btrim(a.brand) <> '' AND btrim(b.brand) <> ''
          AND a.category IS NOT NULL AND b.category IS NOT NULL
          AND btrim(a.category) <> '' AND btrim(b.category) <> ''
          AND lower(public.wv_unaccent(btrim(a.brand)))
              = lower(public.wv_unaccent(btrim(b.brand)))
          AND lower(public.wv_unaccent(btrim(a.category)))
              = lower(public.wv_unaccent(btrim(b.category)))
      )
  )
ORDER BY a.name ASC, b.name ASC;
