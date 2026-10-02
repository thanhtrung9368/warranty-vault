-- Cross-entity search (GET /api/v1/search).
--
-- One query per entity instead of one UNION: the three result sets have
-- different shapes and different ORDER BY needs, and the service merges them into
-- a grouped payload. Each query is scoped to the caller ("userId") and capped by
-- a LIMIT, so a one-character query cannot return the whole account.
--
-- Diacritic-insensitive matching uses the exact expression migration 0007
-- established: `lower(public.wv_unaccent(x))` — unaccent FIRST, then lower, so it
-- behaves identically on a C/POSIX-locale database and a UTF-8 one. Plain ILIKE
-- is NOT used: it does not fold Vietnamese diacritics, so "dien thoai" would not
-- match "Điện thoại" and the search would silently return nothing.
--
-- Searched fields (documented in openapi.yaml):
--   Device       name, brand, model, serialNumber      (same set as GET /devices?q=)
--   Subscription name, brand, plan, accountEmail
--   WishlistItem name, brand, notes
--
-- Index note: migration 0007's trigram indexes cover exactly the four Device
-- expressions used here (and the pattern is built with `'%' || <immutable expr> ||
-- '%'`, which PostgreSQL can fold into a constant and match against the index in a
-- custom plan). Subscription / WishlistItem have no trigram index on purpose:
-- the write path caps them at 100 and 200 rows per user (services/subscriptions.go,
-- services/wishlist.go), so scanning the caller's own rows is cheap by
-- construction and an index would only add write cost.

-- name: SearchDevices :many
SELECT *
FROM "Device"
WHERE "userId" = sqlc.arg('userId')::text
  AND (
    lower(public.wv_unaccent(name)) LIKE '%' || lower(public.wv_unaccent(sqlc.arg('q')::text)) || '%'
    OR lower(public.wv_unaccent(brand)) LIKE '%' || lower(public.wv_unaccent(sqlc.arg('q')::text)) || '%'
    OR lower(public.wv_unaccent(model)) LIKE '%' || lower(public.wv_unaccent(sqlc.arg('q')::text)) || '%'
    OR lower(public.wv_unaccent("serialNumber")) LIKE '%' || lower(public.wv_unaccent(sqlc.arg('q')::text)) || '%'
  )
ORDER BY "createdAt" DESC
LIMIT sqlc.arg('rowLimit')::int;

-- name: SearchSubscriptions :many
SELECT *
FROM "Subscription"
WHERE "userId" = sqlc.arg('userId')::text
  AND (
    lower(public.wv_unaccent(name)) LIKE '%' || lower(public.wv_unaccent(sqlc.arg('q')::text)) || '%'
    OR lower(public.wv_unaccent(brand)) LIKE '%' || lower(public.wv_unaccent(sqlc.arg('q')::text)) || '%'
    OR lower(public.wv_unaccent(plan)) LIKE '%' || lower(public.wv_unaccent(sqlc.arg('q')::text)) || '%'
    OR lower(public.wv_unaccent("accountEmail")) LIKE '%' || lower(public.wv_unaccent(sqlc.arg('q')::text)) || '%'
  )
ORDER BY "renewalDate" ASC
LIMIT sqlc.arg('rowLimit')::int;

-- name: SearchWishlist :many
SELECT *
FROM "WishlistItem"
WHERE "userId" = sqlc.arg('userId')::text
  AND (
    lower(public.wv_unaccent(name)) LIKE '%' || lower(public.wv_unaccent(sqlc.arg('q')::text)) || '%'
    OR lower(public.wv_unaccent(brand)) LIKE '%' || lower(public.wv_unaccent(sqlc.arg('q')::text)) || '%'
    OR lower(public.wv_unaccent(notes)) LIKE '%' || lower(public.wv_unaccent(sqlc.arg('q')::text)) || '%'
  )
ORDER BY "createdAt" DESC
LIMIT sqlc.arg('rowLimit')::int;
