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
--
-- "warrantyLookupUrl" (migration 0023) is the brand's own warranty-STATUS page,
-- a different question from the service-centre locator above. It is nullable:
-- only brands whose lookup page could be verified carry one, and NULL means the
-- app does not know rather than "there is no page".
--
-- The Brand join supplies the display name the single-brand endpoint returns on
-- its own (GET /api/v1/brands/{brandId}/service-info has no sibling brands[]
-- array to resolve the id against). The FK guarantees the join cannot drop a row.
SELECT bsi."brandId", b.name, bsi."serviceLocatorUrl", bsi."supportUrl",
       bsi."warrantyLookupUrl", bsi.notes
FROM "BrandServiceInfo" bsi
JOIN "Brand" b ON b.id = bsi."brandId"
WHERE bsi."isActive" = true
  AND b."isActive" = true
ORDER BY bsi."brandId" ASC;
