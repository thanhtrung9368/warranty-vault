-- WarrantyVault — seed the Brand, Store and WarrantyProvider catalogs.
--
-- Why this migration exists (re-audit of the note in 0004)
-- -------------------------------------------------------
-- Migration 0004 deliberately seeded `Category` only, on the reasoning that
-- Brand / Store / WarrantyProvider "only feed autocomplete suggestions ... an
-- empty table degrades the UI but never blocks a write". That is correct about
-- *blocking*: no service asserts that a brand, store or provider row exists, so
-- device / subscription / wishlist writes always succeeded.
--
-- What that reasoning missed is the first-run experience. On a fresh database
-- every one of those pickers is empty, so a new user has to type "FPT Shop" by
-- hand (and misspell it) or guess a brand spelling — the exact friction the
-- catalog exists to remove. `GET /api/v1/catalog` reads all four tables, and the
-- web device form renders `catalog.stores` / `catalog.warrantyProviders` /
-- `catalog.brands` as comboboxes. An empty list is not a neutral default here:
-- it is a broken-looking form on the very first device a user adds.
--
-- Two further consequences of leaving these empty, specific to Brand:
--   * `BrandCategory` exists so the form can be brand-aware per category. With
--     an empty `Brand` table that join can never return a row — the capability
--     is dead code.
--   * The OCR draft path (`services.buildDraft` → `matchBrand`) can only bind a
--     receipt's free-text brand to a `brandId` when the catalog has brands.
--     Empty catalog ⇒ the model's brand is always "unmatched" free text.
--
-- Decision on Brand: SEED IT, for the same reason as Store and Provider. The
-- values below are real manufacturers of the categories seeded in 0004, not
-- invented marketing data; the table only feeds suggestions (Device.brand stays
-- a free-text column, `allowCustom` stays on in the web combobox), and every
-- category code referenced by `BrandCategory` is one of the 20 codes seeded by
-- 0004, so this migration cannot introduce a dangling reference.
--
-- Source of truth / honesty about the data
-- ----------------------------------------
-- Store and WarrantyProvider names are the real Vietnamese retail chains and the
-- real vendor service networks users buy from and claim warranty at. `Store.type`
-- uses the values the web combobox understands: 'ONLINE' renders the hint
-- "online", 'OFFLINE' renders "cửa hàng" (see
-- website/src/components/device-form.tsx storeOptions). We deliberately leave
-- WarrantyProvider.phone / address NULL: those change constantly, this migration
-- cannot verify them, and a wrong hotline is worse than an empty one. `notes`
-- says how to find the nearest centre instead. `websiteUrl` is only set where the
-- host is stable (vendor support sites / the Apple service locator).
--
-- Ordering: unlike 0004 there is no `sortOrder` column on these three tables, and
-- the catalog queries order by `name ASC` (`ListBrands` / `ListStores` /
-- `ListWarrantyProviders` in internal/store/queries/catalog.sql). Declaration
-- order here is therefore editorial only and does not affect the picker order;
-- `BrandCategory` rows are sorted by the Go service after loading.
--
-- Idempotent
-- ----------
-- ON CONFLICT DO NOTHING on every insert: safe to re-run against an existing
-- database, and it only fills in rows that are missing — an admin-edited row is
-- never touched.
--
-- What is deliberately NOT seeded
-- -------------------------------
-- Nothing here is load-bearing: no write is validated against these tables, so a
-- missing row degrades a suggestion list and never blocks a user. We therefore
-- seed only well-known, broadly applicable values and do not attempt to be
-- exhaustive (no regional dealers, no white-label importers).

-- +goose Up
-- +goose StatementBegin
INSERT INTO public."Brand" (id, name, slug, "isActive") VALUES
    ('apple',      'Apple',      'apple',      true),
    ('samsung',    'Samsung',    'samsung',    true),
    ('xiaomi',     'Xiaomi',     'xiaomi',     true),
    ('oppo',       'OPPO',       'oppo',       true),
    ('vivo',       'vivo',       'vivo',       true),
    ('realme',     'realme',     'realme',     true),
    ('honor',      'HONOR',      'honor',      true),
    ('huawei',     'Huawei',     'huawei',     true),
    ('nokia',      'Nokia',      'nokia',      true),
    ('sony',       'Sony',       'sony',       true),
    ('lg',         'LG',         'lg',         true),
    ('panasonic',  'Panasonic',  'panasonic',  true),
    ('toshiba',    'Toshiba',    'toshiba',    true),
    ('sharp',      'Sharp',      'sharp',      true),
    ('daikin',     'Daikin',     'daikin',     true),
    ('casper',     'Casper',     'casper',     true),
    ('electrolux', 'Electrolux', 'electrolux', true),
    ('asus',       'ASUS',       'asus',       true),
    ('acer',       'Acer',       'acer',       true),
    ('dell',       'Dell',       'dell',       true),
    ('hp',         'HP',         'hp',         true),
    ('lenovo',     'Lenovo',     'lenovo',     true),
    ('msi',        'MSI',        'msi',        true),
    ('logitech',   'Logitech',   'logitech',   true),
    ('razer',      'Razer',      'razer',      true),
    ('corsair',    'Corsair',    'corsair',    true),
    ('jbl',        'JBL',        'jbl',        true),
    ('bose',       'Bose',       'bose',       true),
    ('marshall',   'Marshall',   'marshall',   true),
    ('anker',      'Anker',      'anker',      true),
    ('canon',      'Canon',      'canon',      true),
    ('nikon',      'Nikon',      'nikon',      true),
    ('fujifilm',   'Fujifilm',   'fujifilm',   true),
    ('gopro',      'GoPro',      'gopro',      true),
    ('dji',        'DJI',        'dji',        true),
    ('nintendo',   'Nintendo',   'nintendo',   true),
    ('microsoft',  'Microsoft',  'microsoft',  true),
    ('garmin',     'Garmin',     'garmin',     true),
    ('amazfit',    'Amazfit',    'amazfit',    true),
    ('bosch',      'Bosch',      'bosch',      true),
    ('philips',    'Philips',    'philips',    true),
    ('tefal',      'Tefal',      'tefal',      true),
    ('kangaroo',   'Kangaroo',   'kangaroo',   true),
    ('sunhouse',   'Sunhouse',   'sunhouse',   true),
    ('hoa-phat',   'Hòa Phát',   'hoa-phat',   true),
    ('rang-dong',  'Rạng Đông',  'rang-dong',  true),
    ('dien-quang', 'Điện Quang', 'dien-quang', true),
    ('tan-a',      'Tân Á Đại Thành', 'tan-a-dai-thanh', true)
ON CONFLICT DO NOTHING;
-- +goose StatementEnd

-- Brand ↔ Category links. Every category code below comes from migration 0004;
-- the FK makes a typo fail loudly at migration time instead of silently
-- producing a brand that never shows up for any category.
-- +goose StatementBegin
INSERT INTO public."BrandCategory" ("brandId", "categoryCode") VALUES
    ('apple',      'PHONE'),
    ('apple',      'TABLET'),
    ('apple',      'LAPTOP'),
    ('apple',      'SMARTWATCH'),
    ('apple',      'HEADPHONE'),
    ('samsung',    'PHONE'),
    ('samsung',    'TABLET'),
    ('samsung',    'TV'),
    ('samsung',    'MONITOR'),
    ('samsung',    'SMARTWATCH'),
    ('samsung',    'HEADPHONE'),
    ('samsung',    'APPLIANCE'),
    ('xiaomi',     'PHONE'),
    ('xiaomi',     'TABLET'),
    ('xiaomi',     'LAPTOP'),
    ('xiaomi',     'SMARTWATCH'),
    ('xiaomi',     'TV'),
    ('xiaomi',     'HEADPHONE'),
    ('xiaomi',     'APPLIANCE'),
    ('oppo',       'PHONE'),
    ('oppo',       'TABLET'),
    ('oppo',       'SMARTWATCH'),
    ('oppo',       'HEADPHONE'),
    ('vivo',       'PHONE'),
    ('vivo',       'TABLET'),
    ('vivo',       'SMARTWATCH'),
    ('vivo',       'HEADPHONE'),
    ('realme',     'PHONE'),
    ('realme',     'TABLET'),
    ('realme',     'LAPTOP'),
    ('realme',     'SMARTWATCH'),
    ('realme',     'HEADPHONE'),
    ('honor',      'PHONE'),
    ('honor',      'TABLET'),
    ('honor',      'LAPTOP'),
    ('honor',      'SMARTWATCH'),
    ('huawei',     'PHONE'),
    ('huawei',     'TABLET'),
    ('huawei',     'LAPTOP'),
    ('huawei',     'SMARTWATCH'),
    ('huawei',     'HEADPHONE'),
    ('nokia',      'PHONE'),
    ('nokia',      'TABLET'),
    ('sony',       'TV'),
    ('sony',       'HEADPHONE'),
    ('sony',       'SPEAKER'),
    ('sony',       'CAMERA'),
    ('sony',       'GAMING_CONSOLE'),
    ('sony',       'MONITOR'),
    ('lg',         'TV'),
    ('lg',         'MONITOR'),
    ('lg',         'AC'),
    ('lg',         'FRIDGE'),
    ('lg',         'WASHING'),
    ('lg',         'SPEAKER'),
    ('lg',         'APPLIANCE'),
    ('panasonic',  'TV'),
    ('panasonic',  'AC'),
    ('panasonic',  'FRIDGE'),
    ('panasonic',  'WASHING'),
    ('panasonic',  'KITCHEN'),
    ('panasonic',  'CAMERA'),
    ('panasonic',  'APPLIANCE'),
    ('toshiba',    'LAPTOP'),
    ('toshiba',    'TV'),
    ('toshiba',    'FRIDGE'),
    ('toshiba',    'WASHING'),
    ('toshiba',    'KITCHEN'),
    ('toshiba',    'APPLIANCE'),
    ('sharp',      'TV'),
    ('sharp',      'AC'),
    ('sharp',      'FRIDGE'),
    ('sharp',      'KITCHEN'),
    ('sharp',      'APPLIANCE'),
    ('daikin',     'AC'),
    ('casper',     'AC'),
    ('casper',     'TV'),
    ('casper',     'APPLIANCE'),
    ('electrolux', 'AC'),
    ('electrolux', 'FRIDGE'),
    ('electrolux', 'WASHING'),
    ('electrolux', 'KITCHEN'),
    ('electrolux', 'APPLIANCE'),
    ('asus',       'LAPTOP'),
    ('asus',       'PHONE'),
    ('asus',       'MONITOR'),
    ('asus',       'KEYBOARD'),
    ('asus',       'MOUSE'),
    ('asus',       'GAMING_CONSOLE'),
    ('acer',       'LAPTOP'),
    ('acer',       'TABLET'),
    ('acer',       'MONITOR'),
    ('dell',       'LAPTOP'),
    ('dell',       'MONITOR'),
    ('dell',       'KEYBOARD'),
    ('dell',       'MOUSE'),
    ('hp',         'LAPTOP'),
    ('hp',         'MONITOR'),
    ('hp',         'KEYBOARD'),
    ('hp',         'MOUSE'),
    ('lenovo',     'LAPTOP'),
    ('lenovo',     'TABLET'),
    ('lenovo',     'MONITOR'),
    ('lenovo',     'KEYBOARD'),
    ('lenovo',     'MOUSE'),
    ('msi',        'LAPTOP'),
    ('msi',        'MONITOR'),
    ('msi',        'KEYBOARD'),
    ('msi',        'MOUSE'),
    ('msi',        'GAMING_CONSOLE'),
    ('logitech',   'KEYBOARD'),
    ('logitech',   'MOUSE'),
    ('logitech',   'SPEAKER'),
    ('logitech',   'HEADPHONE'),
    ('razer',      'LAPTOP'),
    ('razer',      'KEYBOARD'),
    ('razer',      'MOUSE'),
    ('razer',      'HEADPHONE'),
    ('corsair',    'KEYBOARD'),
    ('corsair',    'MOUSE'),
    ('corsair',    'HEADPHONE'),
    ('jbl',        'SPEAKER'),
    ('jbl',        'HEADPHONE'),
    ('bose',       'SPEAKER'),
    ('bose',       'HEADPHONE'),
    ('marshall',   'SPEAKER'),
    ('marshall',   'HEADPHONE'),
    ('anker',      'SPEAKER'),
    ('anker',      'HEADPHONE'),
    ('anker',      'ELECTRONICS'),
    ('canon',      'CAMERA'),
    ('nikon',      'CAMERA'),
    ('fujifilm',   'CAMERA'),
    ('gopro',      'CAMERA'),
    ('dji',        'CAMERA'),
    ('dji',        'ELECTRONICS'),
    ('nintendo',   'GAMING_CONSOLE'),
    ('microsoft',  'GAMING_CONSOLE'),
    ('microsoft',  'LAPTOP'),
    ('microsoft',  'KEYBOARD'),
    ('microsoft',  'MOUSE'),
    ('garmin',     'SMARTWATCH'),
    ('amazfit',    'SMARTWATCH'),
    ('bosch',      'WASHING'),
    ('bosch',      'KITCHEN'),
    ('bosch',      'APPLIANCE'),
    ('philips',    'KITCHEN'),
    ('philips',    'APPLIANCE'),
    ('philips',    'ELECTRONICS'),
    ('tefal',      'KITCHEN'),
    ('tefal',      'APPLIANCE'),
    ('kangaroo',   'KITCHEN'),
    ('kangaroo',   'APPLIANCE'),
    ('sunhouse',   'KITCHEN'),
    ('sunhouse',   'APPLIANCE'),
    ('hoa-phat',   'FURNITURE'),
    ('hoa-phat',   'APPLIANCE'),
    ('rang-dong',  'ELECTRONICS'),
    ('dien-quang', 'ELECTRONICS'),
    ('tan-a',      'KITCHEN'),
    ('tan-a',      'APPLIANCE')
ON CONFLICT ("brandId", "categoryCode") DO NOTHING;
-- +goose StatementEnd

-- +goose StatementBegin
INSERT INTO public."Store" (id, name, slug, type, "isActive") VALUES
    ('dien-may-xanh',    'Điện Máy Xanh',    'dien-may-xanh',    'OFFLINE', true),
    ('the-gioi-di-dong', 'Thế Giới Di Động', 'the-gioi-di-dong', 'OFFLINE', true),
    ('fpt-shop',         'FPT Shop',         'fpt-shop',         'OFFLINE', true),
    ('cellphones',       'CellphoneS',       'cellphones',       'OFFLINE', true),
    ('viettel-store',    'Viettel Store',    'viettel-store',    'OFFLINE', true),
    ('hoang-ha-mobile',  'Hoàng Hà Mobile',  'hoang-ha-mobile',  'OFFLINE', true),
    ('di-dong-viet',     'Di Động Việt',     'di-dong-viet',     'OFFLINE', true),
    ('topzone',          'TopZone',          'topzone',          'OFFLINE', true),
    ('gearvn',           'GEARVN',           'gearvn',           'OFFLINE', true),
    ('hacom',            'HACOM',            'hacom',            'OFFLINE', true),
    ('nguyen-kim',       'Nguyễn Kim',       'nguyen-kim',       'OFFLINE', true),
    ('mediamart',        'MediaMart',        'mediamart',        'OFFLINE', true),
    ('pico',             'PICO',             'pico',             'OFFLINE', true),
    ('thien-hoa',        'Thiên Hòa',        'thien-hoa',        'OFFLINE', true),
    ('dien-may-cho-lon', 'Điện Máy Chợ Lớn', 'dien-may-cho-lon', 'OFFLINE', true),
    ('shopee',           'Shopee',           'shopee',           'ONLINE',  true),
    ('lazada',           'Lazada',           'lazada',           'ONLINE',  true),
    ('tiki',             'Tiki',             'tiki',             'ONLINE',  true),
    ('tiktok-shop',      'TikTok Shop',      'tiktok-shop',      'ONLINE',  true),
    ('sendo',            'Sendo',            'sendo',            'ONLINE',  true),
    ('amazon',           'Amazon',           'amazon',           'ONLINE',  true),
    ('chotot',           'Chợ Tốt',          'chotot',           'ONLINE',  true)
ON CONFLICT DO NOTHING;
-- +goose StatementEnd

-- phone / address intentionally NULL — see the header. `notes` tells the user
-- how to reach the centre instead of pinning an unverifiable hotline.
-- +goose StatementBegin
INSERT INTO public."WarrantyProvider" (id, name, slug, phone, address, "websiteUrl", notes, "isActive") VALUES
    ('samsung-service',    'Trung tâm bảo hành Samsung',    'samsung-service',    NULL, NULL, 'https://www.samsung.com/vn/support/service-center/', 'Trung tâm bảo hành uỷ quyền Samsung. Tra cứu trung tâm gần nhất trên trang hỗ trợ của Samsung.', true),
    ('apple-aasp',         'Trung tâm bảo hành Apple uỷ quyền', 'apple-aasp',      NULL, NULL, 'https://locate.apple.com/', 'Mạng lưới Apple Authorized Service Provider (AASP) tại Việt Nam. Tra cứu trung tâm uỷ quyền trên locate.apple.com.', true),
    ('fpt-service',        'FPT Service',                   'fpt-service',        NULL, NULL, 'https://fptshop.com.vn/ho-tro/chinh-sach-bao-hanh', 'Trung tâm bảo hành của hệ thống FPT Shop. Tiếp nhận bảo hành tại cửa hàng FPT Shop hoặc gửi qua hotline.', true),
    ('cellphones-service', 'CellphoneS Service',             'cellphones-service', NULL, NULL, NULL, 'Trung tâm bảo hành của hệ thống CellphoneS.', true),
    ('xiaomi-service',     'Trung tâm bảo hành Xiaomi',      'xiaomi-service',     NULL, NULL, 'https://www.mi.com/vn/service/', 'Trung tâm bảo hành uỷ quyền Xiaomi. Tra cứu trung tâm gần nhất trên trang hỗ trợ của Xiaomi.', true),
    ('oppo-service',       'Trung tâm bảo hành OPPO',        'oppo-service',       NULL, NULL, 'https://www.oppo.com/vn/service/', 'Trung tâm bảo hành uỷ quyền OPPO. Tra cứu trung tâm gần nhất trên trang hỗ trợ của OPPO.', true),
    ('vivo-service',       'Trung tâm bảo hành vivo',        'vivo-service',       NULL, NULL, 'https://www.vivo.com/vn/support', 'Trung tâm bảo hành uỷ quyền vivo. Tra cứu trung tâm gần nhất trên trang hỗ trợ của vivo.', true),
    ('realme-service',     'Trung tâm bảo hành realme',      'realme-service',     NULL, NULL, 'https://www.realme.com/vn/support', 'Trung tâm bảo hành uỷ quyền realme. Tra cứu trung tâm gần nhất trên trang hỗ trợ của realme.', true),
    ('sony-service',       'Trung tâm bảo hành Sony',        'sony-service',       NULL, NULL, 'https://www.sony.com.vn/electronics/support', 'Trung tâm bảo hành uỷ quyền Sony. Tra cứu trung tâm gần nhất trên trang hỗ trợ của Sony.', true),
    ('lg-service',         'Trung tâm bảo hành LG',          'lg-service',         NULL, NULL, 'https://www.lg.com/vn/support', 'Trung tâm bảo hành uỷ quyền LG. Tra cứu trung tâm gần nhất trên trang hỗ trợ của LG.', true),
    ('panasonic-service',  'Trung tâm bảo hành Panasonic',   'panasonic-service',  NULL, NULL, 'https://www.panasonic.com/vn/support.html', 'Trung tâm bảo hành uỷ quyền Panasonic. Tra cứu trung tâm gần nhất trên trang hỗ trợ của Panasonic.', true),
    ('toshiba-service',    'Trung tâm bảo hành Toshiba',     'toshiba-service',    NULL, NULL, NULL, 'Trung tâm bảo hành uỷ quyền Toshiba tại Việt Nam.', true),
    ('daikin-service',     'Trung tâm bảo hành Daikin',      'daikin-service',     NULL, NULL, 'https://www.daikin.com.vn/vi/service', 'Trung tâm bảo hành uỷ quyền Daikin (điều hoà). Tra cứu trung tâm gần nhất trên trang hỗ trợ của Daikin.', true),
    ('electrolux-service', 'Trung tâm bảo hành Electrolux',  'electrolux-service', NULL, NULL, 'https://www.electrolux.vn/support/', 'Trung tâm bảo hành uỷ quyền Electrolux (gia dụng). Tra cứu trung tâm gần nhất trên trang hỗ trợ của Electrolux.', true),
    ('asus-service',       'Trung tâm bảo hành ASUS',        'asus-service',       NULL, NULL, 'https://www.asus.com/vn/support/', 'Trung tâm bảo hành uỷ quyền ASUS. Tra cứu trung tâm gần nhất trên trang hỗ trợ của ASUS.', true),
    ('acer-service',       'Trung tâm bảo hành Acer',        'acer-service',       NULL, NULL, 'https://www.acer.com/vn-vi/support', 'Trung tâm bảo hành uỷ quyền Acer. Tra cứu trung tâm gần nhất trên trang hỗ trợ của Acer.', true),
    ('dell-service',       'Trung tâm bảo hành Dell',        'dell-service',       NULL, NULL, 'https://www.dell.com/support/home/vi-vn', 'Trung tâm bảo hành uỷ quyền Dell. Tra cứu trung tâm gần nhất trên trang hỗ trợ của Dell.', true),
    ('hp-service',         'Trung tâm bảo hành HP',          'hp-service',         NULL, NULL, 'https://support.hp.com/vn-vi', 'Trung tâm bảo hành uỷ quyền HP. Tra cứu trung tâm gần nhất trên trang hỗ trợ của HP.', true),
    ('lenovo-service',     'Trung tâm bảo hành Lenovo',      'lenovo-service',     NULL, NULL, 'https://support.lenovo.com/vn/vi/', 'Trung tâm bảo hành uỷ quyền Lenovo. Tra cứu trung tâm gần nhất trên trang hỗ trợ của Lenovo.', true)
ON CONFLICT DO NOTHING;
-- +goose StatementEnd

-- +goose Down
-- Deletes only the rows `up` actually inserted: a row an admin has since edited
-- (any seeded column differs) is left in place, because it is no longer data
-- this migration created. `BrandCategory` rows are NOT deleted explicitly — the
-- "brandId" FK is ON DELETE CASCADE, so the links disappear with their brand and
-- a preserved (edited) brand keeps its links.

-- +goose StatementBegin
DELETE FROM public."WarrantyProvider" AS w
USING (VALUES
    ('samsung-service',    'Trung tâm bảo hành Samsung',    'samsung-service',    NULL, NULL, 'https://www.samsung.com/vn/support/service-center/', 'Trung tâm bảo hành uỷ quyền Samsung. Tra cứu trung tâm gần nhất trên trang hỗ trợ của Samsung.', true),
    ('apple-aasp',         'Trung tâm bảo hành Apple uỷ quyền', 'apple-aasp',      NULL, NULL, 'https://locate.apple.com/', 'Mạng lưới Apple Authorized Service Provider (AASP) tại Việt Nam. Tra cứu trung tâm uỷ quyền trên locate.apple.com.', true),
    ('fpt-service',        'FPT Service',                   'fpt-service',        NULL, NULL, 'https://fptshop.com.vn/ho-tro/chinh-sach-bao-hanh', 'Trung tâm bảo hành của hệ thống FPT Shop. Tiếp nhận bảo hành tại cửa hàng FPT Shop hoặc gửi qua hotline.', true),
    ('cellphones-service', 'CellphoneS Service',             'cellphones-service', NULL, NULL, NULL, 'Trung tâm bảo hành của hệ thống CellphoneS.', true),
    ('xiaomi-service',     'Trung tâm bảo hành Xiaomi',      'xiaomi-service',     NULL, NULL, 'https://www.mi.com/vn/service/', 'Trung tâm bảo hành uỷ quyền Xiaomi. Tra cứu trung tâm gần nhất trên trang hỗ trợ của Xiaomi.', true),
    ('oppo-service',       'Trung tâm bảo hành OPPO',        'oppo-service',       NULL, NULL, 'https://www.oppo.com/vn/service/', 'Trung tâm bảo hành uỷ quyền OPPO. Tra cứu trung tâm gần nhất trên trang hỗ trợ của OPPO.', true),
    ('vivo-service',       'Trung tâm bảo hành vivo',        'vivo-service',       NULL, NULL, 'https://www.vivo.com/vn/support', 'Trung tâm bảo hành uỷ quyền vivo. Tra cứu trung tâm gần nhất trên trang hỗ trợ của vivo.', true),
    ('realme-service',     'Trung tâm bảo hành realme',      'realme-service',     NULL, NULL, 'https://www.realme.com/vn/support', 'Trung tâm bảo hành uỷ quyền realme. Tra cứu trung tâm gần nhất trên trang hỗ trợ của realme.', true),
    ('sony-service',       'Trung tâm bảo hành Sony',        'sony-service',       NULL, NULL, 'https://www.sony.com.vn/electronics/support', 'Trung tâm bảo hành uỷ quyền Sony. Tra cứu trung tâm gần nhất trên trang hỗ trợ của Sony.', true),
    ('lg-service',         'Trung tâm bảo hành LG',          'lg-service',         NULL, NULL, 'https://www.lg.com/vn/support', 'Trung tâm bảo hành uỷ quyền LG. Tra cứu trung tâm gần nhất trên trang hỗ trợ của LG.', true),
    ('panasonic-service',  'Trung tâm bảo hành Panasonic',   'panasonic-service',  NULL, NULL, 'https://www.panasonic.com/vn/support.html', 'Trung tâm bảo hành uỷ quyền Panasonic. Tra cứu trung tâm gần nhất trên trang hỗ trợ của Panasonic.', true),
    ('toshiba-service',    'Trung tâm bảo hành Toshiba',     'toshiba-service',    NULL, NULL, NULL, 'Trung tâm bảo hành uỷ quyền Toshiba tại Việt Nam.', true),
    ('daikin-service',     'Trung tâm bảo hành Daikin',      'daikin-service',     NULL, NULL, 'https://www.daikin.com.vn/vi/service', 'Trung tâm bảo hành uỷ quyền Daikin (điều hoà). Tra cứu trung tâm gần nhất trên trang hỗ trợ của Daikin.', true),
    ('electrolux-service', 'Trung tâm bảo hành Electrolux',  'electrolux-service', NULL, NULL, 'https://www.electrolux.vn/support/', 'Trung tâm bảo hành uỷ quyền Electrolux (gia dụng). Tra cứu trung tâm gần nhất trên trang hỗ trợ của Electrolux.', true),
    ('asus-service',       'Trung tâm bảo hành ASUS',        'asus-service',       NULL, NULL, 'https://www.asus.com/vn/support/', 'Trung tâm bảo hành uỷ quyền ASUS. Tra cứu trung tâm gần nhất trên trang hỗ trợ của ASUS.', true),
    ('acer-service',       'Trung tâm bảo hành Acer',        'acer-service',       NULL, NULL, 'https://www.acer.com/vn-vi/support', 'Trung tâm bảo hành uỷ quyền Acer. Tra cứu trung tâm gần nhất trên trang hỗ trợ của Acer.', true),
    ('dell-service',       'Trung tâm bảo hành Dell',        'dell-service',       NULL, NULL, 'https://www.dell.com/support/home/vi-vn', 'Trung tâm bảo hành uỷ quyền Dell. Tra cứu trung tâm gần nhất trên trang hỗ trợ của Dell.', true),
    ('hp-service',         'Trung tâm bảo hành HP',          'hp-service',         NULL, NULL, 'https://support.hp.com/vn-vi', 'Trung tâm bảo hành uỷ quyền HP. Tra cứu trung tâm gần nhất trên trang hỗ trợ của HP.', true),
    ('lenovo-service',     'Trung tâm bảo hành Lenovo',      'lenovo-service',     NULL, NULL, 'https://support.lenovo.com/vn/vi/', 'Trung tâm bảo hành uỷ quyền Lenovo. Tra cứu trung tâm gần nhất trên trang hỗ trợ của Lenovo.', true)
) AS seeded(id, name, slug, phone, address, "websiteUrl", notes, "isActive")
WHERE w.id = seeded.id
  AND w.name = seeded.name
  AND w.slug = seeded.slug
  AND w.phone IS NOT DISTINCT FROM seeded.phone
  AND w.address IS NOT DISTINCT FROM seeded.address
  AND w."websiteUrl" IS NOT DISTINCT FROM seeded."websiteUrl"
  AND w.notes IS NOT DISTINCT FROM seeded.notes
  AND w."isActive" = seeded."isActive";
-- +goose StatementEnd

-- +goose StatementBegin
DELETE FROM public."Store" AS s
USING (VALUES
    ('dien-may-xanh',    'Điện Máy Xanh',    'dien-may-xanh',    'OFFLINE', true),
    ('the-gioi-di-dong', 'Thế Giới Di Động', 'the-gioi-di-dong', 'OFFLINE', true),
    ('fpt-shop',         'FPT Shop',         'fpt-shop',         'OFFLINE', true),
    ('cellphones',       'CellphoneS',       'cellphones',       'OFFLINE', true),
    ('viettel-store',    'Viettel Store',    'viettel-store',    'OFFLINE', true),
    ('hoang-ha-mobile',  'Hoàng Hà Mobile',  'hoang-ha-mobile',  'OFFLINE', true),
    ('di-dong-viet',     'Di Động Việt',     'di-dong-viet',     'OFFLINE', true),
    ('topzone',          'TopZone',          'topzone',          'OFFLINE', true),
    ('gearvn',           'GEARVN',           'gearvn',           'OFFLINE', true),
    ('hacom',            'HACOM',            'hacom',            'OFFLINE', true),
    ('nguyen-kim',       'Nguyễn Kim',       'nguyen-kim',       'OFFLINE', true),
    ('mediamart',        'MediaMart',        'mediamart',        'OFFLINE', true),
    ('pico',             'PICO',             'pico',             'OFFLINE', true),
    ('thien-hoa',        'Thiên Hòa',        'thien-hoa',        'OFFLINE', true),
    ('dien-may-cho-lon', 'Điện Máy Chợ Lớn', 'dien-may-cho-lon', 'OFFLINE', true),
    ('shopee',           'Shopee',           'shopee',           'ONLINE',  true),
    ('lazada',           'Lazada',           'lazada',           'ONLINE',  true),
    ('tiki',             'Tiki',             'tiki',             'ONLINE',  true),
    ('tiktok-shop',      'TikTok Shop',      'tiktok-shop',      'ONLINE',  true),
    ('sendo',            'Sendo',            'sendo',            'ONLINE',  true),
    ('amazon',           'Amazon',           'amazon',           'ONLINE',  true),
    ('chotot',           'Chợ Tốt',          'chotot',           'ONLINE',  true)
) AS seeded(id, name, slug, type, "isActive")
WHERE s.id = seeded.id
  AND s.name = seeded.name
  AND s.slug = seeded.slug
  AND s.type = seeded.type
  AND s."isActive" = seeded."isActive";
-- +goose StatementEnd

-- +goose StatementBegin
DELETE FROM public."Brand" AS b
USING (VALUES
    ('apple',      'Apple',      'apple',      true),
    ('samsung',    'Samsung',    'samsung',    true),
    ('xiaomi',     'Xiaomi',     'xiaomi',     true),
    ('oppo',       'OPPO',       'oppo',       true),
    ('vivo',       'vivo',       'vivo',       true),
    ('realme',     'realme',     'realme',     true),
    ('honor',      'HONOR',      'honor',      true),
    ('huawei',     'Huawei',     'huawei',     true),
    ('nokia',      'Nokia',      'nokia',      true),
    ('sony',       'Sony',       'sony',       true),
    ('lg',         'LG',         'lg',         true),
    ('panasonic',  'Panasonic',  'panasonic',  true),
    ('toshiba',    'Toshiba',    'toshiba',    true),
    ('sharp',      'Sharp',      'sharp',      true),
    ('daikin',     'Daikin',     'daikin',     true),
    ('casper',     'Casper',     'casper',     true),
    ('electrolux', 'Electrolux', 'electrolux', true),
    ('asus',       'ASUS',       'asus',       true),
    ('acer',       'Acer',       'acer',       true),
    ('dell',       'Dell',       'dell',       true),
    ('hp',         'HP',         'hp',         true),
    ('lenovo',     'Lenovo',     'lenovo',     true),
    ('msi',        'MSI',        'msi',        true),
    ('logitech',   'Logitech',   'logitech',   true),
    ('razer',      'Razer',      'razer',      true),
    ('corsair',    'Corsair',    'corsair',    true),
    ('jbl',        'JBL',        'jbl',        true),
    ('bose',       'Bose',       'bose',       true),
    ('marshall',   'Marshall',   'marshall',   true),
    ('anker',      'Anker',      'anker',      true),
    ('canon',      'Canon',      'canon',      true),
    ('nikon',      'Nikon',      'nikon',      true),
    ('fujifilm',   'Fujifilm',   'fujifilm',   true),
    ('gopro',      'GoPro',      'gopro',      true),
    ('dji',        'DJI',        'dji',        true),
    ('nintendo',   'Nintendo',   'nintendo',   true),
    ('microsoft',  'Microsoft',  'microsoft',  true),
    ('garmin',     'Garmin',     'garmin',     true),
    ('amazfit',    'Amazfit',    'amazfit',    true),
    ('bosch',      'Bosch',      'bosch',      true),
    ('philips',    'Philips',    'philips',    true),
    ('tefal',      'Tefal',      'tefal',      true),
    ('kangaroo',   'Kangaroo',   'kangaroo',   true),
    ('sunhouse',   'Sunhouse',   'sunhouse',   true),
    ('hoa-phat',   'Hòa Phát',   'hoa-phat',   true),
    ('rang-dong',  'Rạng Đông',  'rang-dong',  true),
    ('dien-quang', 'Điện Quang', 'dien-quang', true),
    ('tan-a',      'Tân Á Đại Thành', 'tan-a-dai-thanh', true)
) AS seeded(id, name, slug, "isActive")
WHERE b.id = seeded.id
  AND b.name = seeded.name
  AND b.slug = seeded.slug
  AND b."isActive" = seeded."isActive";
-- +goose StatementEnd
