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

-- name: SetUserAIOptIn :exec
UPDATE "User"
SET "aiOptIn" = $2,
    "updatedAt" = NOW()
WHERE id = $1;

-- name: DeleteUser :exec
DELETE FROM "User" WHERE id = $1;
