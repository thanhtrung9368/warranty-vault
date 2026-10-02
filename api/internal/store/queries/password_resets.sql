-- name: CreatePasswordReset :one
INSERT INTO "PasswordReset" (id, "userId", "tokenHash", "expiresAt", "createdAt")
VALUES ($1, $2, $3, $4, NOW())
RETURNING *;

-- name: CreateEmailChange :one
-- Email-change token (migration 0009): same table and lifecycle as a password
-- reset, plus the pending address the token authorises. `pendingEmail` is what
-- keeps the two token kinds apart — see the migration header.
INSERT INTO "PasswordReset" (id, "userId", "tokenHash", "pendingEmail", "expiresAt", "createdAt")
VALUES ($1, $2, $3, $4, $5, NOW())
RETURNING *;

-- name: GetPasswordResetByTokenHash :one
-- Password-reset tokens only (`"pendingEmail" IS NULL`): an email-change token is
-- delivered to the new address and must never be spendable as a password credential.
SELECT * FROM "PasswordReset"
WHERE "tokenHash" = $1
  AND "pendingEmail" IS NULL
  AND "usedAt" IS NULL
  AND "expiresAt" > NOW()
LIMIT 1;

-- name: GetEmailChangeByTokenHash :one
-- Email-change tokens only (`"pendingEmail" IS NOT NULL`). Single-use
-- (`"usedAt" IS NULL`) and time-boxed (`"expiresAt"`), exactly like a reset token.
SELECT * FROM "PasswordReset"
WHERE "tokenHash" = $1
  AND "pendingEmail" IS NOT NULL
  AND "usedAt" IS NULL
  AND "expiresAt" > NOW()
LIMIT 1;

-- name: ConsumePasswordReset :exec
UPDATE "PasswordReset"
SET "usedAt" = NOW()
WHERE id = $1;

-- name: ConsumeAllPasswordResetsForUser :exec
-- Used by the reset-password AND email-change confirm steps to invalidate every
-- other outstanding token the user might have issued in parallel (both kinds).
UPDATE "PasswordReset"
SET "usedAt" = NOW()
WHERE "userId" = $1
  AND "usedAt" IS NULL;

-- name: PruneExpiredPasswordResets :execrows
DELETE FROM "PasswordReset"
WHERE "expiresAt" < NOW();
