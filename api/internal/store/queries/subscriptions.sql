-- Subscription + SubscriptionPayment queries.
--
-- Every per-user query filters by "userId". The cron-only fan-out queries
-- skip user scoping by design — the fan-out logic walks all users.

-- name: ListSubscriptionsByUser :many
SELECT *
FROM "Subscription"
WHERE "userId" = $1
  AND (NULLIF($2::text, '') IS NULL OR status = $2)
ORDER BY "renewalDate" ASC;

-- name: GetSubscriptionByID :one
SELECT *
FROM "Subscription"
WHERE id = $1 AND "userId" = $2
LIMIT 1;

-- name: CreateSubscription :one
INSERT INTO "Subscription" (
    id,
    "userId",
    name,
    category,
    brand,
    plan,
    "billingCycle",
    "intervalDays",
    price,
    currency,
    "startedAt",
    "renewalDate",
    "autoRenew",
    status,
    "accountEmail",
    "paymentMethod",
    "manageUrl",
    "cancelUrl",
    notes,
    "leadDays",
    "createdAt",
    "updatedAt"
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9,
    COALESCE(sqlc.narg('currency')::text, 'VND'),
    $10, $11, $12,
    COALESCE(sqlc.narg('status')::text, 'ACTIVE'),
    $13, $14, $15, $16, $17,
    COALESCE(sqlc.narg('leadDays')::int[], ARRAY[30, 7]::int[]),
    NOW(), NOW()
)
RETURNING *;

-- name: UpdateSubscription :one
UPDATE "Subscription" SET
    name = $3,
    category = $4,
    brand = $5,
    plan = $6,
    "billingCycle" = $7,
    "intervalDays" = $8,
    price = $9,
    currency = $10,
    "startedAt" = $11,
    "renewalDate" = $12,
    "autoRenew" = $13,
    status = $14,
    "accountEmail" = $15,
    "paymentMethod" = $16,
    "manageUrl" = $17,
    "cancelUrl" = $18,
    notes = $19,
    "leadDays" = $20,
    "updatedAt" = NOW()
WHERE id = $1 AND "userId" = $2
RETURNING *;

-- name: DeleteSubscription :execrows
DELETE FROM "Subscription"
WHERE id = $1 AND "userId" = $2;

-- name: SetSubscriptionStatus :one
UPDATE "Subscription"
SET status = $3, "updatedAt" = NOW()
WHERE id = $1 AND "userId" = $2
RETURNING *;

-- name: CountSubscriptionsByUser :one
SELECT COUNT(*)::bigint AS count
FROM "Subscription"
WHERE "userId" = $1;

-- ─── Payments ─────────────────────────────────────────────────────────────

-- name: CreateSubscriptionPayment :one
INSERT INTO "SubscriptionPayment" (
    id,
    "subscriptionId",
    amount,
    "paidAt",
    note,
    "createdAt"
) VALUES (
    $1, $2, $3, $4, $5, NOW()
)
RETURNING *;

-- name: ListPaymentsBySubscription :many
SELECT p.*
FROM "SubscriptionPayment" p
JOIN "Subscription" s ON s.id = p."subscriptionId"
WHERE p."subscriptionId" = $1 AND s."userId" = $2
ORDER BY p."paidAt" DESC;

-- ─── Cron / renewal helpers ───────────────────────────────────────────────

-- name: ListSubscriptionsDueForRenewal :many
-- ACTIVE, non-LIFETIME subs whose renewalDate falls in [start, end) AND whose
-- leadDays contains `leadDay`. The cron calls this once per DISTINCT lead day
-- (queries/devices.sql::ListActiveDeviceLeadDays does the same for warranties).
--
-- Idempotency (migration 0015): the key is
--   (subscriptionId, leadDay, calendar day)
-- stored as (lastNotifiedRenewalAt::date, lastNotifiedRenewalLeadDay). A row is
-- skipped only when the SAME lead day was already stamped today; a different
-- lead day in the same day is still allowed, which is what makes [30,7] two
-- reminders rather than one. `lastNotifiedRenewalLeadDay IS NULL` means the row
-- was stamped by the pre-0015 code (or by AdvanceSubscriptionRenewal, which
-- marks "handled today" for every lead day): treat it as suppressing all lead
-- days for the rest of that day, so a deploy-day re-run cannot duplicate.
SELECT *
FROM "Subscription"
WHERE status = 'ACTIVE'
  AND "billingCycle" <> 'LIFETIME'
  AND sqlc.arg('leadDay')::int = ANY("leadDays")
  AND "renewalDate" >= $1
  AND "renewalDate" <  $2
  AND (
      "lastNotifiedRenewalAt" IS NULL
      OR "lastNotifiedRenewalAt"::date < CURRENT_DATE
      OR ("lastNotifiedRenewalLeadDay" IS NOT NULL
          AND "lastNotifiedRenewalLeadDay" <> sqlc.arg('leadDay')::int)
  );

-- name: StampSubscriptionRenewalNotified :exec
-- Cron stamps this after a successful renewal-warning fan-out so the next
-- same-day run is filtered out by ListSubscriptionsDueForRenewal. `leadDay` is
-- part of the idempotency key, not decoration: see migration 0015.
UPDATE "Subscription"
SET "lastNotifiedRenewalAt" = NOW(),
    "lastNotifiedRenewalLeadDay" = sqlc.arg('leadDay')::int,
    "updatedAt" = NOW()
WHERE id = $1;

-- name: ListSubscriptionsOverdue :many
-- ACTIVE, non-LIFETIME subs whose renewalDate has passed (< today midnight).
-- Caller decides per-row whether to auto-bill or expire based on autoRenew.
SELECT *
FROM "Subscription"
WHERE status = 'ACTIVE'
  AND "billingCycle" <> 'LIFETIME'
  AND "renewalDate" < $1;

-- name: AdvanceSubscriptionRenewal :one
-- Called inside a transaction with CreateSubscriptionPayment. Stamps
-- lastNotifiedRenewalAt so the same row doesn't refire today's bucket.
--
-- `lastNotifiedRenewalLeadDay` is reset to NULL rather than carried over: the
-- renewal date just moved to a new cycle, so the lead day that fired belongs to
-- the old one. NULL combined with today's timestamp means "handled today, do not
-- warn again for ANY lead day" — the pre-0015 behaviour, which is what an
-- auto-bill should keep for the rest of the day.
UPDATE "Subscription"
SET "renewalDate" = $2,
    "lastNotifiedRenewalAt" = $3,
    "lastNotifiedRenewalLeadDay" = NULL,
    "updatedAt" = NOW()
WHERE id = $1
RETURNING *;

-- name: ExpireSubscription :one
UPDATE "Subscription"
SET status = 'EXPIRED', "updatedAt" = NOW()
WHERE id = $1
RETURNING *;

-- name: ListActiveSubscriptionLeadDays :many
-- Cron support (migration 0015). One row per DISTINCT lead day any ACTIVE,
-- non-LIFETIME subscription is asking for, newest-first. Mirrors
-- devices.sql::ListActiveDeviceLeadDays: the sweep runs one day-window query per
-- value, so the query count is the number of distinct user choices, not 366.
SELECT DISTINCT unnest("leadDays")::int AS lead_day
FROM "Subscription"
WHERE status = 'ACTIVE'
  AND "billingCycle" <> 'LIFETIME'
ORDER BY lead_day DESC;
