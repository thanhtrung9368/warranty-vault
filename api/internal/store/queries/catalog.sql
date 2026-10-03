-- Global catalog (admin-curated). Used for autocomplete / autofill in device
-- and subscription forms. The Go service caches these in-memory with TTL.

-- name: ListCategories :many
SELECT code, name, "sortOrder", "isActive"
FROM "Category"
WHERE "isActive" = true
ORDER BY "sortOrder" ASC, name ASC;

-- name: GetCategoryByCode :one
-- Used by createDevice / createSubscription / createWishlistItem to verify
-- the category exists + is active before insert.
SELECT code, name, "sortOrder", "isActive"
FROM "Category"
WHERE code = $1 AND "isActive" = true
LIMIT 1;

-- name: ListBrands :many
SELECT id, name, slug, "isActive"
FROM "Brand"
WHERE "isActive" = true
ORDER BY name ASC;

-- name: ListBrandCategoriesByBrand :many
SELECT "brandId", "categoryCode"
FROM "BrandCategory"
WHERE "brandId" = $1
ORDER BY "categoryCode" ASC;

-- name: ListAllBrandCategories :many
-- Used to build the (brand_id -> category_codes[]) map in one query, mirror
-- the TS catalog `getBrands()` shape.
SELECT "brandId", "categoryCode"
FROM "BrandCategory"
ORDER BY "brandId" ASC, "categoryCode" ASC;

-- name: ListStores :many
SELECT id, name, slug, type, "isActive"
FROM "Store"
WHERE "isActive" = true
ORDER BY name ASC;

-- name: ListWarrantyProviders :many
SELECT id, name, slug, phone, address, "websiteUrl", notes, "isActive"
FROM "WarrantyProvider"
WHERE "isActive" = true
ORDER BY name ASC;

-- name: ListBrandServiceInfo :many
-- Directory rows for "where do I take this" (FEATURE_IDEAS #15, migration 0012).
-- Loaded through the same services.loadCatalog pass as the other four catalogs,
-- so entries share the 60s in-process cache and InvalidateCatalogCache().
--
-- No `phone` / `address` column exists to select: migration 0012 deliberately
-- has none, because this repo cannot verify a hotline and a wrong one is worse
-- than an empty one.
SELECT "brandId", "serviceLocatorUrl", "supportUrl", notes
FROM "BrandServiceInfo"
WHERE "isActive" = true
ORDER BY "brandId" ASC;
