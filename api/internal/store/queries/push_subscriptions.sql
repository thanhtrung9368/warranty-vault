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
