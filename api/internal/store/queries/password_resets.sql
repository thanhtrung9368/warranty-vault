-- name: CreatePasswordReset :one
INSERT INTO "PasswordReset" (id, "userId", "tokenHash", "expiresAt", "createdAt")
VALUES ($1, $2, $3, $4, NOW())
RETURNING *;

-- name: GetPasswordResetByTokenHash :one
SELECT * FROM "PasswordReset"
WHERE "tokenHash" = $1
  AND "usedAt" IS NULL
  AND "expiresAt" > NOW()
LIMIT 1;

-- name: ConsumePasswordReset :exec
UPDATE "PasswordReset"
SET "usedAt" = NOW()
WHERE id = $1;

-- name: PruneExpiredPasswordResets :execrows
DELETE FROM "PasswordReset"
WHERE "expiresAt" < NOW();
