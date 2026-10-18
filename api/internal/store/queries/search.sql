-- Cross-entity search (GET /api/v1/search).
--
-- One query per entity instead of one UNION: the four result sets have
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
--   Attachment   extractedText (the OCR text, migration 0019)
--
-- Index note: migration 0007's trigram indexes cover exactly the four Device
-- expressions used here (and the pattern is built with `'%' || <immutable expr> ||
-- '%'`, which PostgreSQL can fold into a constant and match against the index in a
-- custom plan). Subscription / WishlistItem have no trigram index on purpose:
-- the write path caps them at 100 and 200 rows per user (services/subscriptions.go,
-- services/wishlist.go), so scanning the caller's own rows is cheap by
-- construction and an index would only add write cost.
--
-- Attachment DOES have one (migration 0019), on the same
-- `lower(public.wv_unaccent(...))` expression used by SearchAttachments below.
-- The expression must stay byte-for-byte identical to the index definition or the
-- planner silently stops using it; TestSearchPersistedOCRTextAgainstRealPostgres
-- pins both the index definition and the plan.

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

-- name: SearchAttachments :many
-- Full-text OCR search (roadmap #13, migration 0019). Only `extractedText` is
-- searched, not fileName/description: the feature is "find the receipt that says
-- 65W", and a NULL extractedText (never OCR'd) matches nothing — exactly like a
-- receipt that was never scanned should.
--
-- The expression is byte-for-byte the index definition in migration 0019:
--   index: lower(public.wv_unaccent("extractedText"))
--   query: lower(public.wv_unaccent("extractedText")) LIKE ...
-- Do not add an alias, a cast or a different function ordering here without
-- rebuilding that index in the same migration.
--
-- The result is the full Attachment row; the service redacts it through
-- toAttachmentMeta and adds the owning deviceId, because the raw row carries
-- storagePath / iv / wrappedKey.
SELECT *
FROM "Attachment"
WHERE "userId" = sqlc.arg('userId')::text
  AND lower(public.wv_unaccent("extractedText")) LIKE '%' || lower(public.wv_unaccent(sqlc.arg('q')::text)) || '%'
ORDER BY "uploadedAt" DESC
LIMIT sqlc.arg('rowLimit')::int;
