-- name: CreateSession :one
INSERT INTO "Session" (id, "userId", "tokenHash", "deviceLabel", platform, "lastSeenAt", "expiresAt", "createdAt")
VALUES ($1, $2, $3, $4, $5, NOW(), $6, NOW())
RETURNING *;

-- name: GetSessionByTokenHash :one
SELECT
    s.id           AS session_id,
    s."userId"     AS user_id,
    s."tokenHash"  AS token_hash,
    s."deviceLabel" AS device_label,
    s.platform     AS platform,
    s."lastSeenAt" AS last_seen_at,
    s."expiresAt"  AS expires_at,
    s."revokedAt"  AS revoked_at,
    s."createdAt"  AS created_at,
    u.id           AS u_id,
    u.email        AS u_email,
    u.name         AS u_name,
    u."passwordChangedAt" AS u_password_changed_at
FROM "Session" s
JOIN "User" u ON u.id = s."userId"
WHERE s."tokenHash" = $1
LIMIT 1;

-- name: TouchSession :exec
-- Bumps lastSeenAt, but only when the column is stale by ≥ 5 minutes. This
-- turns the per-request touch into a no-op for the vast majority of requests
-- (a session is "touched" at most once per 5-minute window). 0 rows affected
-- is expected and not an error — the :exec contract ignores the row count.
UPDATE "Session"
SET "lastSeenAt" = NOW()
WHERE id = $1
  AND ("lastSeenAt" IS NULL OR "lastSeenAt" < NOW() - INTERVAL '5 minutes');

-- name: ExtendSession :exec
UPDATE "Session"
SET "lastSeenAt" = NOW(),
    "expiresAt" = $2
WHERE id = $1;

-- name: RevokeSessionByTokenHash :exec
UPDATE "Session"
SET "revokedAt" = NOW()
WHERE "tokenHash" = $1
  AND "revokedAt" IS NULL;

-- name: RevokeAllSessionsForUser :exec
-- Used after password reset / account compromise: invalidate every still-live
-- session the user has, regardless of device.
UPDATE "Session"
SET "revokedAt" = NOW()
WHERE "userId" = $1
  AND "revokedAt" IS NULL;

-- name: PruneExpiredSessions :execrows
DELETE FROM "Session"
WHERE "expiresAt" < NOW()
   OR ("revokedAt" IS NOT NULL AND "revokedAt" < NOW() - INTERVAL '1 day');
