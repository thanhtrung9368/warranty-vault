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
--   Device       name, brand, model, serialNumber, purchasePlace  (same set as GET /devices?q=)
--   Subscription name, brand, plan, accountEmail
--   WishlistItem name, brand, notes
--   Attachment   extractedText (the OCR text, migration 0019), fileName and
--                description (migration 0026)
--
-- `purchasePlace` is the shop the device was bought from (migration 0025). It is
-- the field that answers "I only remember the shop" — the form asks for it, so
-- search has to be able to give it back.
--
-- Index note: migration 0007's trigram indexes cover the four original Device
-- columns and migration 0025 adds the fifth (`"purchasePlace"`) — all five use
-- the expression in SearchDevices below (and the pattern is built with
-- `'%' || <immutable expr> || '%'`, which PostgreSQL can fold into a constant and
-- match against the index in a custom plan). Subscription / WishlistItem have no
-- trigram index on purpose: the write path caps them at 100 and 200 rows per
-- user (services/subscriptions.go, services/wishlist.go), so scanning the
-- caller's own rows is cheap by construction and an index would only add write
-- cost.
--
-- Attachment HAS three (migrations 0019 and 0026), on the same
-- `lower(public.wv_unaccent(...))` expression used by SearchAttachments below.
-- The expression must stay byte-for-byte identical to the index definition or the
-- planner silently stops using it; TestSearchAttachmentsAgainstRealPostgres
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
    OR lower(public.wv_unaccent("purchasePlace")) LIKE '%' || lower(public.wv_unaccent(sqlc.arg('q')::text)) || '%'
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
-- Receipt search (roadmap #13, migration 0019) over the three text columns an
-- attachment actually has: `extractedText` (what OCR read off the file),
-- `fileName` and `description` (what the user typed or the camera generated).
--
-- All three are searched since migration 0026. Before that only `extractedText`
-- was, and that column is written by exactly one path — the opt-in OCR call —
-- so on a default account (`User.aiOptIn = false`) the group could never match
-- anything. A receipt named "hoa-don-cellphones.png" or described "Ảnh hộp máy
-- chụp lúc mở seal" was unfindable even though both strings are stored, shown
-- in the UI and editable.
--
-- No join is needed for any of the three: `Attachment."userId"` (migration 0018)
-- is the stored owner, so the group is owner-scoped without going through
-- "Device" — which matters because an inbox attachment has no device at all.
--
-- The expression is byte-for-byte each index definition (migrations 0019/0026):
--   index: lower(public.wv_unaccent("extractedText"))
--   index: lower(public.wv_unaccent("fileName"))
--   index: lower(public.wv_unaccent(description))
--   query: lower(public.wv_unaccent(<same column>)) LIKE ...
-- Do not add an alias, a cast or a different function ordering here without
-- rebuilding those indexes in the same migration.
--
-- The result is the full Attachment row; the service redacts it through
-- toAttachmentMeta and adds the owning deviceId, because the raw row carries
-- storagePath / iv / wrappedKey.
SELECT *
FROM "Attachment"
WHERE "userId" = sqlc.arg('userId')::text
  AND (
    lower(public.wv_unaccent("extractedText")) LIKE '%' || lower(public.wv_unaccent(sqlc.arg('q')::text)) || '%'
    OR lower(public.wv_unaccent("fileName")) LIKE '%' || lower(public.wv_unaccent(sqlc.arg('q')::text)) || '%'
    OR lower(public.wv_unaccent(description)) LIKE '%' || lower(public.wv_unaccent(sqlc.arg('q')::text)) || '%'
  )
ORDER BY "uploadedAt" DESC
LIMIT sqlc.arg('rowLimit')::int;
