-- Essentials / "đồ dùng thiết yếu" queries.
--
-- Ordered for the screen: things to buy first (OUT then LOW), then the rest.
-- The app groups the rows again, but this order is what a plain list gets.

-- name: ListStaplesByUser :many
SELECT *
FROM "Staple"
WHERE "userId" = $1
  AND (NULLIF($2::text, '') IS NULL OR state = $2)
ORDER BY
    CASE state WHEN 'OUT' THEN 0 WHEN 'LOW' THEN 1 ELSE 2 END,
    LOWER(name) ASC,
    "createdAt" DESC;

-- name: GetStapleByID :one
SELECT *
FROM "Staple"
WHERE id = $1 AND "userId" = $2
LIMIT 1;

-- name: CreateStaple :one
INSERT INTO "Staple" (
    id,
    "userId",
    name,
    category,
    unit,
    "cadenceDays",
    "lastBoughtAt",
    state,
    notes,
    "createdAt",
    "updatedAt"
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW()
)
RETURNING *;

-- name: UpdateStaple :one
UPDATE "Staple" SET
    name = $3,
    category = $4,
    unit = $5,
    "cadenceDays" = $6,
    "lastBoughtAt" = $7,
    state = $8,
    notes = $9,
    "updatedAt" = NOW()
WHERE id = $1 AND "userId" = $2
RETURNING *;

-- name: DeleteStaple :execrows
DELETE FROM "Staple"
WHERE id = $1 AND "userId" = $2;
