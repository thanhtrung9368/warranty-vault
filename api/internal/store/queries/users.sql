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

-- name: UpdateUserProfile :one
-- PATCH /api/v1/auth/me — the narrow write path. Both fields are tri-state:
--
--	name       — SQL NULL clears the name;   ($2, namePresent=false) leaves it ALONE
--	locale     — SQL NULL clears the preference; ($3, localePresent=false) leaves it ALONE
--
-- The `present` booleans mirror what the handler already has to know: a JSON body
-- distinguishes an ABSENT key ("leave unchanged") from an explicit `null`
-- ("clear"), and a nullable parameter cannot express that difference on its own —
-- NULL means "clear" in both directions. Without these flags a client that does
-- not send `locale` (every client today) would wipe the stored preference on every
-- display-name edit. Same reasoning as `displayName`, which the handler has always
-- had to track explicitly.
--
-- Returns the updated row so the handler can answer with the full user DTO.
UPDATE "User"
SET name = CASE WHEN sqlc.arg('namePresent')::boolean THEN $2 ELSE name END,
    locale = CASE WHEN sqlc.arg('localePresent')::boolean THEN $3 ELSE locale END,
    "updatedAt" = NOW()
WHERE id = $1
RETURNING *;

-- name: ListUserLocales :many
-- Cron fan-out support (internal/cron/run.go). Push bodies are built in Go with no
-- request context, so the recipient's stored preference is the only language
-- signal available — read every preference in ONE query at the top of a run rather
-- than one lookup per notification. Users with no preference are simply absent
-- from the map and fall back to the default language.
SELECT id, locale FROM "User" WHERE locale IS NOT NULL;

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
