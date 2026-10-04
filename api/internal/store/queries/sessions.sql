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
    -- Carried on the session lookup so the auth middleware can seed level 3 of
    -- the locale precedence chain (User.locale, migration 0014) without running a
    -- second query on every authenticated request.
    u.locale       AS u_locale,
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

-- ─── Per-session management (GET/DELETE /api/v1/auth/sessions) ────────────

-- name: ListActiveSessionsForUser :many
-- "Active" = not revoked and not expired at $2.
--
-- The expiry boundary is a parameter, not NOW(), on purpose: every timestamp
-- column here is `timestamp without time zone` and the app writes it from Go's
-- wall clock, so comparing against the database clock can be off by the server's
-- UTC offset. The caller passes its own now — the same clock VerifyBearer uses.
--
-- "tokenHash" is deliberately NOT selected: it is credential material and must
-- never leave the server. The exposed id is the row's surrogate key (cuid), which
-- is not derived from the token and appears nowhere else.
--
-- LIMIT 100 bounds the response: PruneExpiredSessions drops rows a day after
-- revocation, so only live sessions accumulate, and 100 live sessions already
-- means something is wrong.
SELECT
    id,
    "deviceLabel",
    platform,
    "lastSeenAt",
    "expiresAt",
    "createdAt"
FROM "Session"
WHERE "userId" = $1
  AND "revokedAt" IS NULL
  AND "expiresAt" > $2
ORDER BY "lastSeenAt" DESC, "createdAt" DESC
LIMIT 100;

-- name: GetSessionByIDForUser :one
-- Ownership-scoped lookup for the per-session revoke path. A miss means "unknown
-- id OR someone else's id" and the handler answers 404 for both, so a foreign id
-- cannot be told apart from a non-existent one.
--
-- No expiry filter on purpose: an expired-but-owned row is still the caller's own
-- row, and the handler — not this query — decides what to say about a row that is
-- already revoked.
SELECT * FROM "Session" WHERE id = $1 AND "userId" = $2 LIMIT 1;

-- name: RevokeSessionByID :execrows
-- Ownership-scoped revoke. `"revokedAt" IS NULL` makes a repeated call a no-op
-- (0 rows, not a second revocation timestamp), which is what makes the endpoint
-- idempotent.
UPDATE "Session"
SET "revokedAt" = NOW()
WHERE id = $1 AND "userId" = $2 AND "revokedAt" IS NULL;
