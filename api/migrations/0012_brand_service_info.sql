-- WarrantyVault — danh bạ bảo hành theo HÃNG: "giờ tôi mang máy đi đâu?"
-- (FEATURE_IDEAS #15).
--
-- The problem this table answers
-- ------------------------------
-- The question a user actually has while standing at a counter is "where do I
-- take this". Today the app can only answer it from what the user typed into
-- "Warranty"."provider" / "address" / "phone", because migration 0008
-- deliberately seeded "WarrantyProvider".phone and .address as NULL:
--
--     "those change constantly, this migration cannot verify them, and a wrong
--      hotline is worse than an empty one"  (0008, header)
--
-- That judgement still holds, so this migration does NOT revise it and does NOT
-- invent a single hotline or street address. What it adds is the one kind of
-- contact data that CAN be stated without claiming to be current: the VENDOR'S
-- OWN lookup page. A URL that the vendor maintains ("find your nearest service
-- centre") cannot go stale in the way a copied phone number does — when the
-- network changes, the vendor's own page changes with it.
--
-- Why a NEW table instead of reusing "WarrantyProvider"
-- -----------------------------------------------------
--   * Keyed by BRAND, not by provider network. `Device.brand` is free text and
--     is what the user picked for the device in front of them; "Warranty".
--     "provider" is free text the user typed on a warranty package. "For THIS
--     device, where do I go" is a brand question, and a device with no warranty
--     row at all (or with an unrecorded one) still deserves an answer.
--   * A provider row is selectable in the device form (it feeds a combobox);
--     this table is reference data that is never chosen, only looked up.
--   * `priceListUrl` from the FEATURE_IDEAS sketch is deliberately absent: a
--     repair price list is exactly the kind of page this repo cannot verify, so
--     there is no column for it. When nobody can fill a column honestly, the
--     column should not exist — the same reasoning that left 0008's phone NULL,
--     applied one step earlier.
--
-- There is NO phone and NO address column here, on purpose. Adding one later
-- means adding a migration and justifying it; filling a hotline in by hand is
-- already impossible. The API answers "what is the hotline" with the number the
-- USER recorded at the counter (`Warranty.phone`, surfaced as
-- `phoneSource: "user"`), never with one the app made up.
--
-- Honesty about the data (every URL below is COPIED, not researched)
-- -----------------------------------------------------------------
-- Every URL in BOTH columns — "serviceLocatorUrl" and "supportUrl" — is the exact
-- value already present in "WarrantyProvider"."websiteUrl" from migration 0008 for
-- the matching vendor service row, byte-for-byte. This migration therefore
-- introduces ZERO new external claims: if a URL is wrong, it was already wrong in
-- 0008 and the fix belongs in one place. `supportUrl` means "the vendor's support
-- home"; where a vendor exposes a single page, both columns carry that page rather
-- than a second URL this migration would have had to guess. Brands that have no
-- 0008 provider row are NOT listed at all (no entry is more honest than a guessed
-- URL); the device endpoint reports `brand: null` and shows only what the user
-- recorded. internal/services/brand_service_info_seed_test.go parses this file and
-- fails if a URL appears here that 0008 does not contain, so the claim cannot rot.
--
-- Selected columns only: the app never writes this table at runtime; like the
-- other four catalogs it is seeded here and edited directly in Postgres
-- afterwards (there is no admin UI — see services/catalog.go).
--
-- Cached like the rest of the catalog
-- -----------------------------------
-- Rows are loaded by services.loadCatalog, so they sit behind the same 60s
-- in-process cache and the same InvalidateCatalogCache() as Category / Brand /
-- Store / WarrantyProvider. An operator edit shows up within a minute, or
-- immediately after a restart.
--
-- Idempotent: ON CONFLICT DO NOTHING, so re-running against an existing
-- database only fills gaps and never touches an operator-edited row.

-- +goose Up
-- +goose StatementBegin
CREATE TABLE public."BrandServiceInfo" (
    "brandId" text NOT NULL,
    "serviceLocatorUrl" text,
    "supportUrl" text,
    notes text,
    "isActive" boolean DEFAULT true NOT NULL,
    CONSTRAINT "BrandServiceInfo_pkey" PRIMARY KEY ("brandId"),
    CONSTRAINT "BrandServiceInfo_brandId_fkey" FOREIGN KEY ("brandId")
        REFERENCES public."Brand"(id) ON UPDATE CASCADE ON DELETE CASCADE
);
-- +goose StatementEnd

-- The FK above makes a typo fail loudly at migration time instead of silently
-- seeding a directory entry for a brand that does not exist.
-- +goose StatementBegin
INSERT INTO public."BrandServiceInfo" ("brandId", "serviceLocatorUrl", "supportUrl", notes, "isActive") VALUES
    ('apple',      'https://locate.apple.com/',                               'https://locate.apple.com/',                   'Trang định vị trung tâm uỷ quyền chính thức của Apple. Chọn Việt Nam để xem AASP gần nhất. Apple không có tổng đài bảo hành chung cho người dùng cuối.', true),
    ('samsung',    'https://www.samsung.com/vn/support/service-center/',      'https://www.samsung.com/vn/support/service-center/', 'Danh sách trung tâm bảo hành uỷ quyền Samsung tại Việt Nam, do Samsung tự cập nhật.', true),
    ('xiaomi',     'https://www.mi.com/vn/service/',                          'https://www.mi.com/vn/service/',              'Trang dịch vụ của Xiaomi Việt Nam: tra cứu trung tâm bảo hành uỷ quyền và đặt lịch.', true),
    ('oppo',       'https://www.oppo.com/vn/service/',                        'https://www.oppo.com/vn/service/',            'Trang dịch vụ của OPPO Việt Nam: tra cứu trung tâm bảo hành uỷ quyền gần nhất.', true),
    ('vivo',       'https://www.vivo.com/vn/support',                         'https://www.vivo.com/vn/support',             'Trang hỗ trợ của vivo Việt Nam: tra cứu trung tâm bảo hành uỷ quyền.', true),
    ('realme',     'https://www.realme.com/vn/support',                       'https://www.realme.com/vn/support',           'Trang hỗ trợ của realme Việt Nam: tra cứu trung tâm bảo hành uỷ quyền.', true),
    ('sony',       'https://www.sony.com.vn/electronics/support',             'https://www.sony.com.vn/electronics/support', 'Trang hỗ trợ Sony Việt Nam: tra cứu trung tâm bảo hành uỷ quyền theo sản phẩm.', true),
    ('lg',         'https://www.lg.com/vn/support',                           'https://www.lg.com/vn/support',               'Trang hỗ trợ LG Việt Nam: tra cứu trung tâm bảo hành uỷ quyền.', true),
    ('panasonic',  'https://www.panasonic.com/vn/support.html',               'https://www.panasonic.com/vn/support.html',   'Trang hỗ trợ Panasonic Việt Nam: tra cứu trung tâm bảo hành uỷ quyền.', true),
    ('daikin',     'https://www.daikin.com.vn/vi/service',                    'https://www.daikin.com.vn/vi/service',        'Trang dịch vụ Daikin Việt Nam (điều hoà): tra cứu trung tâm bảo hành uỷ quyền.', true),
    ('electrolux', 'https://www.electrolux.vn/support/',                      'https://www.electrolux.vn/support/',          'Trang hỗ trợ Electrolux Việt Nam: tra cứu trung tâm bảo hành uỷ quyền.', true),
    ('asus',       'https://www.asus.com/vn/support/',                        'https://www.asus.com/vn/support/',            'Trang hỗ trợ ASUS Việt Nam: tra cứu trung tâm bảo hành uỷ quyền.', true),
    ('acer',       'https://www.acer.com/vn-vi/support',                      'https://www.acer.com/vn-vi/support',          'Trang hỗ trợ Acer Việt Nam: tra cứu trung tâm bảo hành uỷ quyền.', true),
    ('dell',       'https://www.dell.com/support/home/vi-vn',                 'https://www.dell.com/support/home/vi-vn',     'Trang hỗ trợ Dell Việt Nam: tra cứu trung tâm bảo hành uỷ quyền.', true),
    ('hp',         'https://support.hp.com/vn-vi',                            'https://support.hp.com/vn-vi',                'Trang hỗ trợ HP Việt Nam: tra cứu trung tâm bảo hành uỷ quyền.', true),
    ('lenovo',     'https://support.lenovo.com/vn/vi/',                       'https://support.lenovo.com/vn/vi/',           'Trang hỗ trợ Lenovo Việt Nam: tra cứu trung tâm bảo hành uỷ quyền.', true)
ON CONFLICT ("brandId") DO NOTHING;
-- +goose StatementEnd

-- +goose Down
-- Drops the table, which also drops every seeded row. Unlike 0008 this `down`
-- does not try to preserve admin-edited rows: the whole table is new here, so
-- rolling this migration back is meant to remove the feature completely.
-- +goose StatementBegin
DROP TABLE IF EXISTS public."BrandServiceInfo";
-- +goose StatementEnd
