-- name: GetUserByEmail :one
SELECT * FROM "User" WHERE email = $1 LIMIT 1;

-- name: GetUserByID :one
SELECT * FROM "User" WHERE id = $1 LIMIT 1;

-- name: CreateUser :one
INSERT INTO "User" (id, email, "passwordHash", name, "createdAt", "updatedAt", "passwordChangedAt")
VALUES ($1, $2, $3, $4, NOW(), NOW(), NOW())
RETURNING *;

-- name: UpdateUserPassword :exec
UPDATE "User"
SET "passwordHash" = $2,
    "passwordChangedAt" = NOW(),
    "updatedAt" = NOW()
WHERE id = $1;

-- name: UpdateUserDisplayName :one
-- PATCH /api/v1/auth/me. A NULL $2 clears the display name (the column is
-- nullable and Register already treats "no name" as NULL). Returns the updated
-- row so the handler can respond with the full user DTO (including aiOptIn).
UPDATE "User"
SET name = $2,
    "updatedAt" = NOW()
WHERE id = $1
RETURNING *;

-- name: SetUserAIOptIn :exec
UPDATE "User"
SET "aiOptIn" = $2,
    "updatedAt" = NOW()
WHERE id = $1;

-- name: UpdateUserEmail :execrows
-- Confirm step of the email-change flow (migration 0009). The caller has already
-- verified a single-use token sent to $2 and checked the address is free; the
-- unique index on email is the final race guard (a 23505 surfaces as 400, not 500).
-- Deliberately does NOT touch "passwordChangedAt": the email change is not a
-- password change, and the sessions are revoked explicitly by the handler.
UPDATE "User"
SET email = $2,
    "updatedAt" = NOW()
WHERE id = $1;

-- name: DeleteUser :exec
DELETE FROM "User" WHERE id = $1;
