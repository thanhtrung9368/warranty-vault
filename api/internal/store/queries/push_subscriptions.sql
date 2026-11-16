-- PushSubscription CRUD.
-- platform ∈ {web, apns, fcm}. For web, p256dh + auth are filled; for native
-- platforms they're NULL and the bare token is encoded in `endpoint` as
-- `<platform>://<token>` (see `services/push.ts::endpointFor`).

-- name: ListPushSubscriptionsByUser :many
SELECT id, "userId", endpoint, p256dh, auth, "userAgent", platform, "createdAt"
FROM "PushSubscription"
WHERE "userId" = $1
ORDER BY "createdAt" DESC;

-- name: ListPushSubscriptionsByUserAndPlatform :many
SELECT id, "userId", endpoint, p256dh, auth, "userAgent", platform, "createdAt"
FROM "PushSubscription"
WHERE "userId" = $1 AND platform = $2
ORDER BY "createdAt" DESC;

-- name: GetPushSubscriptionByID :one
SELECT *
FROM "PushSubscription"
WHERE id = $1 AND "userId" = $2
LIMIT 1;

-- name: GetPushSubscriptionByEndpoint :one
SELECT *
FROM "PushSubscription"
WHERE endpoint = $1
LIMIT 1;

-- name: UpsertPushSubscription :one
-- Mirrors the TS upsert: same endpoint -> overwrite owner + crypto + UA.
INSERT INTO "PushSubscription" (
    id, "userId", endpoint, p256dh, auth, "userAgent", platform, "createdAt"
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, NOW()
)
ON CONFLICT (endpoint) DO UPDATE SET
    "userId"   = EXCLUDED."userId",
    platform   = EXCLUDED.platform,
    p256dh     = EXCLUDED.p256dh,
    auth       = EXCLUDED.auth,
    "userAgent" = EXCLUDED."userAgent"
RETURNING *;

-- name: CreatePushSubscription :one
INSERT INTO "PushSubscription" (
    id, "userId", endpoint, p256dh, auth, "userAgent", platform, "createdAt"
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, NOW()
)
RETURNING *;

-- name: DeletePushSubscriptionByID :execrows
DELETE FROM "PushSubscription"
WHERE id = $1 AND "userId" = $2;

-- name: DeletePushSubscriptionByIDInternal :execrows
-- No user scoping — used by cron when we get a 404/410 from the push gateway
-- and have to remove the dead row regardless of who owns it.
DELETE FROM "PushSubscription"
WHERE id = $1;

-- name: DeletePushSubscriptionByEndpoint :execrows
DELETE FROM "PushSubscription"
WHERE endpoint = $1 AND "userId" = $2;

-- name: RecordPushSubscriptionFailure :exec
-- Push delivery health (FEATURE_RESEARCH_2026-11 §5 #8). The cron calls this on
-- every non-Gone failure — a permanent 401/403 from a rotated key, a temporary 5xx
-- or timeout, and the "transport not configured" result — so "this subscription
-- keeps failing" becomes a fact in the database instead of one line in a log.
--
-- 404/410 are deliberately NOT recorded: those rows are deleted in the same pass
-- (DeletePushSubscriptionByIDInternal), and health on a row that no longer exists
-- would be meaningless.
--
-- "failureCount" is cumulative and is NOT reset by a later success. There is no
-- "lastSuccessAt" column, so a count alone must not be read as "consecutive
-- failures"; it answers "has this target ever failed, how many times, and what did
-- the last failure say", which is what an investigation needs.
UPDATE "PushSubscription"
SET "lastFailureAt" = sqlc.arg('lastFailureAt')::timestamp,
    "failureCount" = "failureCount" + 1,
    "lastError" = sqlc.arg('lastError')::text
WHERE id = sqlc.arg('id');
