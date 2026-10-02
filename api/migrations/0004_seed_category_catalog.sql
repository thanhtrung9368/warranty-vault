-- WarrantyVault — seed the global category catalog.
--
-- Why this migration exists
-- -------------------------
-- `assertCategoryExists` (api/internal/services/devices.go) rejects every device
-- write and every wishlist write whose `category` is not an *active* row of
-- public."Category" with HTTP 400 "Loại thiết bị không hợp lệ" /
-- "Loại sản phẩm không hợp lệ". No migration before this one contained a single
-- INSERT, so on a fresh database the catalog was empty and NO user could create a
-- device: the web picker (`website/src/components/device-form.tsx`) reads the
-- empty catalog, falls back to the literal string 'OTHER', and that fails
-- validation too. Registering and logging in worked; the failure only surfaced on
-- the last step of the device form.
--
-- Source of truth
-- ---------------
-- Codes + Vietnamese names are copied verbatim from `CATEGORY_LABELS` in
-- website/src/lib/types.ts (20 entries). `sortOrder` mirrors the declaration
-- order there (10, 20, ... 200) so the picker lists categories in the same order
-- as the TS map, matching the previous Prisma-era data.
-- `api/internal/services/category_labels_test.go` re-parses both files and fails
-- if they ever drift apart.
--
-- Idempotent
-- ----------
-- ON CONFLICT (code) DO NOTHING: safe to re-run against an existing database, and
-- it only fills in codes that are missing — an admin-edited row is never touched.
--
-- What is deliberately NOT seeded
-- -------------------------------
-- Brand / Store / WarrantyProvider are NOT seeded. Those three tables only feed
-- autocomplete suggestions on the web forms; the values are stored as free text
-- (Device.brand, Device.purchasePlace, Warranty.provider are plain text columns,
-- and the web comboboxes pass `allowCustom`). No service asserts that a brand,
-- store or provider exists, so an empty table degrades the UI but never blocks a
-- write — seeding plausible-looking brand/store names would be inventing data
-- that nothing requires. See the audit note on catalog.go.
--
-- +goose Up
-- +goose StatementBegin
INSERT INTO public."Category" (code, name, "sortOrder", "isActive") VALUES
    ('PHONE',          'Điện thoại',           10, true),
    ('LAPTOP',         'Laptop',               20, true),
    ('TABLET',         'Máy tính bảng',        30, true),
    ('SMARTWATCH',     'Đồng hồ thông minh',   40, true),
    ('HEADPHONE',      'Tai nghe',             50, true),
    ('SPEAKER',        'Loa',                  60, true),
    ('CAMERA',         'Máy ảnh / Quay phim',  70, true),
    ('TV',             'Tivi',                 80, true),
    ('MONITOR',        'Màn hình',             90, true),
    ('KEYBOARD',       'Bàn phím',            100, true),
    ('MOUSE',          'Chuột',               110, true),
    ('GAMING_CONSOLE', 'Máy chơi game',       120, true),
    ('AC',             'Điều hòa',            130, true),
    ('FRIDGE',         'Tủ lạnh',             140, true),
    ('WASHING',        'Máy giặt / Sấy',      150, true),
    ('KITCHEN',        'Đồ nhà bếp',          160, true),
    ('APPLIANCE',      'Đồ gia dụng khác',    170, true),
    ('ELECTRONICS',    'Điện tử khác',        180, true),
    ('FURNITURE',      'Nội thất',            190, true),
    ('OTHER',          'Khác',                200, true)
ON CONFLICT (code) DO NOTHING;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
-- Delete only the rows `up` actually inserted: if an admin has since edited a row
-- (name, "sortOrder" or "isActive" differs from the seeded values) it is left in
-- place, because it is no longer data this migration created.
DELETE FROM public."Category" AS c
USING (VALUES
    ('PHONE',          'Điện thoại',           10, true),
    ('LAPTOP',         'Laptop',               20, true),
    ('TABLET',         'Máy tính bảng',        30, true),
    ('SMARTWATCH',     'Đồng hồ thông minh',   40, true),
    ('HEADPHONE',      'Tai nghe',             50, true),
    ('SPEAKER',        'Loa',                  60, true),
    ('CAMERA',         'Máy ảnh / Quay phim',  70, true),
    ('TV',             'Tivi',                 80, true),
    ('MONITOR',        'Màn hình',             90, true),
    ('KEYBOARD',       'Bàn phím',            100, true),
    ('MOUSE',          'Chuột',               110, true),
    ('GAMING_CONSOLE', 'Máy chơi game',       120, true),
    ('AC',             'Điều hòa',            130, true),
    ('FRIDGE',         'Tủ lạnh',             140, true),
    ('WASHING',        'Máy giặt / Sấy',      150, true),
    ('KITCHEN',        'Đồ nhà bếp',          160, true),
    ('APPLIANCE',      'Đồ gia dụng khác',    170, true),
    ('ELECTRONICS',    'Điện tử khác',        180, true),
    ('FURNITURE',      'Nội thất',            190, true),
    ('OTHER',          'Khác',                200, true)
) AS seeded(code, name, "sortOrder", "isActive")
WHERE c.code = seeded.code
  AND c.name = seeded.name
  AND c."sortOrder" = seeded."sortOrder"
  AND c."isActive" = seeded."isActive";
-- +goose StatementEnd
