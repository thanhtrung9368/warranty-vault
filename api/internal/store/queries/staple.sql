-- Essentials / "đồ dùng thiết yếu" queries.
--
-- Ordered for the screen: things to buy first (OUT then LOW), then the rest.
-- The app groups the rows again, but this order is what a plain list gets.
--
-- The purchase-price summary lives in its own query (bottom of this file), not
-- as correlated subqueries on the list. One grouped read covers every staple the
-- user owns, and sqlc can type its four numbers exactly: a scalar subquery is
-- always generated as a non-null int even when it returns no row, so computing
-- the summary there would either lie about "not bought yet" or force the Go DTO
-- back to `interface{}`.

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

-- ── Purchases (migration 0034) ──────────────────────────────────────────────
--
-- The response shape is the contract's field list, not `SELECT *`: `userId` is
-- an ownership key the client never needs, so it is not selected into the row
-- struct that reaches JSON. Newest first is the only order the history screen
-- uses; `createdAt` breaks a same-day tie so two bags of coffee on one day stay
-- in the order they were recorded.

-- name: ListStaplePurchases :many
SELECT
    id,
    "stapleId",
    price,
    "purchasedAt",
    store,
    note,
    "createdAt"
FROM "StaplePurchase"
WHERE "stapleId" = $1 AND "userId" = $2
ORDER BY "purchasedAt" DESC, "createdAt" DESC;

-- name: CreateStaplePurchase :one
INSERT INTO "StaplePurchase" (
    id,
    "stapleId",
    "userId",
    price,
    "purchasedAt",
    store,
    note,
    "createdAt"
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, NOW()
)
RETURNING
    id,
    "stapleId",
    price,
    "purchasedAt",
    store,
    note,
    "createdAt";

-- name: TouchStapleAfterPurchase :one
-- One purchase has two side effects on the staple, and they must commit with the
-- purchase row (the service wraps all of it in one transaction):
--
--   * `state` becomes ENOUGH — the user just bought it, that is the observation.
--   * `lastBoughtAt` moves to the LATER of the stored day and this purchase's
--     day. GREATEST (which ignores NULL in Postgres) rather than a blind
--     assignment, so back-filling an old receipt cannot move the "last bought"
--     day backwards. Doing it in SQL, not in Go, keeps it correct under two
--     concurrent purchases: each UPDATE evaluates the row it locks.
--
-- RETURNING * so the POST response can show the updated state/lastBoughtAt; 0
-- rows means the id is not this user's staple, and the caller rolls back.
UPDATE "Staple" SET
    "lastBoughtAt" = GREATEST("lastBoughtAt", $3),
    state = 'ENOUGH',
    "updatedAt" = NOW()
WHERE id = $1 AND "userId" = $2
RETURNING *;

-- name: ListStaplePurchaseSummariesByUser :many
-- The list screen's three price numbers + purchase count, for every staple the
-- user owns that has at least one purchase. Staples with no purchases are simply
-- absent; the service renders them as `null` money + count 0, which is the
-- contract ("0 when none") and keeps "never bought" distinct from "free".
--
-- The JOIN starts from Staple so the planner uses `Staple_user_state_idx` for
-- the owner filter and `StaplePurchase_staple_purchased_idx` for each item's
-- rows. `$2` is the optional single-staple filter: '' lists every staple, an id
-- returns 0 or 1 row (the POST response and any future detail endpoint).
--
-- `array_agg(...)[1]` is the latest price (same ordering the history uses);
-- `ROUND(AVG(...))` is a whole đồng because VND has no minor unit and the
-- contract's summary fields are ints. Both are non-null here: the GROUP BY only
-- emits a group that has at least one purchase row.
SELECT
    s.id AS "stapleId",
    (array_agg(p.price ORDER BY p."purchasedAt" DESC, p."createdAt" DESC))[1]::int AS "lastPrice",
    MIN(p.price)::int AS "lowestPrice",
    ROUND(AVG(p.price))::int AS "averagePrice",
    COUNT(*)::int AS "purchaseCount"
FROM "Staple" s
JOIN "StaplePurchase" p
  ON p."stapleId" = s.id
 AND p."userId" = s."userId"
WHERE s."userId" = $1
  AND (NULLIF($2::text, '') IS NULL OR s.id = $2)
GROUP BY s.id;
