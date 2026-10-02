-- ============================================================================
-- seed_dev.sql — realistic Vietnamese sample data for the dev DB
--
-- Usage (KHÔNG cần psql — máy dev chỉ có Postgres server, không có client):
--   api/scripts/dbtool.sh -v "user_id='<user-id>'" -f api/scripts/seed_dev.sql
--
--   # ví dụ lấy user id từ DB dev:
--   DATABASE_URL='postgresql://trungit@localhost:5432/warranty_vault_dev' \
--     api/scripts/dbtool.sh -c 'SELECT id, email FROM "User" ORDER BY "createdAt" LIMIT 5;'
--
--   # hoặc lấy token rồi tự tạo user qua API:
--   #   POST /api/v1/auth/register → .user.id
--
-- `dbtool.sh` build + chạy client SQL nhỏ trong scripts/dbtool (Go + pgx) thay
-- thế psql: nó hiểu `\set` và biến `:user_id` như psql, in kết quả kiểu
-- `psql -tA`. Nếu bạn có psql thật thì lệnh tương đương là:
--   psql "$DATABASE_URL" -v user_id="'<user-id>'" -f api/scripts/seed_dev.sql
--
-- File này được kiểm chứng tự động bởi scripts/test_seed_dev.sh (chạy trong
-- suite `scripts/e2e.sh`): seed phải khớp schema, chạy lại không nhân đôi dữ
-- liệu, và dữ liệu phải đọc được qua HTTP API.
--
-- All row IDs are prefixed with `seed_` so the script is idempotent — rerunning
-- it cleanly deletes the previous batch (cascades down to warranties,
-- reminders, wishlist prices, subscription payments) before reinserting.
--
-- Today (reference): 2026-05-17.
-- Prices: integer VND.
-- ============================================================================

\set ON_ERROR_STOP on

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. clear previous seed batch
-- ----------------------------------------------------------------------------
-- Detach wishlist rows that may have linked to seed devices (purchasedDeviceId)
UPDATE "WishlistItem" SET "purchasedDeviceId" = NULL
  WHERE "purchasedDeviceId" LIKE 'seed_%';

DELETE FROM "WishlistPrice" WHERE id LIKE 'seed_%';
DELETE FROM "WishlistItem" WHERE id LIKE 'seed_%';
DELETE FROM "Reminder"     WHERE id LIKE 'seed_%';
DELETE FROM "Warranty"     WHERE id LIKE 'seed_%';
DELETE FROM "Device"       WHERE id LIKE 'seed_%';
DELETE FROM "Subscription" WHERE id LIKE 'seed_%';

-- ----------------------------------------------------------------------------
-- 2. Devices (10) — vary categories + purchase dates 2023..2025
-- ----------------------------------------------------------------------------
INSERT INTO "Device"
  (id, "userId", name, category, brand, model, "serialNumber",
   "purchaseDate", "purchasePrice", "purchasePlace", status, notes, "updatedAt")
VALUES
  ('seed_dev_01', :user_id, 'MacBook Pro 14" M3 Pro',  'LAPTOP',         'Apple',     'M3 Pro 18GB/512GB',  'C02-MBP14-001',
   '2024-08-15', 65000000, 'Topzone Cầu Giấy',     'ACTIVE',
   'Máy chính dùng cho công việc, mua trả góp 0% tại Topzone.', now()),

  ('seed_dev_02', :user_id, 'iPhone 15 Pro Max',       'PHONE',          'Apple',     '256GB Titan Tự Nhiên', 'F2L-IP15PM-002',
   '2024-09-22', 34990000, 'FPT Shop Nguyễn Trãi', 'ACTIVE',
   'Đổi từ iPhone 13 Pro, đã dán PPF + ốp Spigen.', now()),

  ('seed_dev_03', :user_id, 'Galaxy Tab S9',           'TABLET',         'Samsung',   '11" Wi-Fi 256GB',     'R5N-GTS9-003',
   '2024-12-01', 18500000, 'CellphoneS Thái Hà',   'ACTIVE',
   'Mua để đọc tài liệu + vẽ note với S Pen.', now()),

  ('seed_dev_04', :user_id, 'Sony WH-1000XM5',         'HEADPHONE',      'Sony',      'WH-1000XM5 Đen',      'SN-WH1KX5-004',
   '2024-03-10',  8490000, 'Sony Center Bà Triệu', 'ACTIVE',
   'Tai nghe chống ồn dùng hàng ngày khi đi làm.', now()),

  ('seed_dev_05', :user_id, 'Apple Watch Series 9',    'SMARTWATCH',     'Apple',     '45mm GPS Midnight',   'C03-AWS9-005',
   '2024-11-20', 12990000, 'Topzone Tây Sơn',      'ACTIVE',
   'Theo dõi sức khoẻ + tập gym, kèm dây Sport Loop.', now()),

  ('seed_dev_06', :user_id, 'Máy giặt LG Inverter 9kg','WASHING',        'LG',        'FV1409S4W',           'LG-WM-9K-006',
   '2023-06-12', 14200000, 'Điện máy Xanh Cầu Giấy', 'ACTIVE',
   'Lắp ở căn hộ Mỹ Đình, ổn không lỗi.', now()),

  ('seed_dev_07', :user_id, 'Tủ lạnh Panasonic 326L',  'FRIDGE',         'Panasonic', 'NR-BL340PSVN',        'PN-FR-326-007',
   '2023-04-05', 11500000, 'Nguyễn Kim Phạm Hùng', 'ACTIVE',
   'Inverter tiết kiệm điện, dung tích đủ cho 3 người.', now()),

  ('seed_dev_08', :user_id, 'Robot hút bụi Roborock S8','APPLIANCE',     'Roborock',  'S8',                  'RR-S8-008',
   '2024-07-18', 13900000, 'Lazada Mall',          'ACTIVE',
   'Cài lịch hút bụi mỗi sáng, dock sạc đặt phòng khách.', now()),

  ('seed_dev_09', :user_id, 'Dyson V12 Detect Slim',   'APPLIANCE',      'Dyson',     'V12 Detect Slim',     'DY-V12-009',
   '2025-01-08', 18990000, 'Dyson VN Online',      'ACTIVE',
   'Hút bụi cầm tay, dùng kèm Roborock cho góc khó.', now()),

  ('seed_dev_10', :user_id, 'Nintendo Switch OLED',    'GAMING_CONSOLE', 'Nintendo',  'OLED White',          'NS-OLED-010',
   '2023-11-25',  8490000, 'Game Stop Hà Nội',     'ACTIVE',
   'Chơi Zelda + Mario, mua kèm Pro Controller.', now());

-- ----------------------------------------------------------------------------
-- 3. Warranties — spread effective end dates across <30/<60/<90 days, plus
--    one expired. Today = 2026-05-17, so target end ~2026-06-10 (24d),
--    ~2026-07-05 (49d), ~2026-08-10 (85d), plus some longer + expired.
-- ----------------------------------------------------------------------------
INSERT INTO "Warranty"
  (id, "deviceId", type, provider, "startDate", "endDate", months, cost, address, phone, notes, "updatedAt")
VALUES
  -- dev_01 MacBook: STANDARD 12m -> 2025-08-15 (expired), EXTENDED 24m -> 2027-08-15
  ('seed_war_01a', 'seed_dev_01', 'STANDARD', 'Apple Authorized Service Provider',
   '2024-08-15', '2025-08-15', 12, NULL, '63 Trần Thái Tông, Cầu Giấy, Hà Nội', '1800-1192',
   'Bảo hành chính hãng Apple 12 tháng.', now()),
  ('seed_war_01b', 'seed_dev_01', 'EXTENDED', 'AppleCare+ VN',
   '2025-08-15', '2027-08-15', 24, 5990000, '63 Trần Thái Tông, Cầu Giấy, Hà Nội', '1800-1192',
   'Mua gói AppleCare+ gia hạn thêm 24 tháng.', now()),

  -- dev_02 iPhone 15 Pro Max: STANDARD 12m -> 2025-09-22 (expired), EXTENDED 24m -> ~2026-06-10 (<30d)
  ('seed_war_02a', 'seed_dev_02', 'STANDARD', 'Apple Authorized Service Provider',
   '2024-09-22', '2025-09-22', 12, NULL, '63 Trần Thái Tông, Cầu Giấy, Hà Nội', '1800-1192',
   'Bảo hành Apple chuẩn 12 tháng.', now()),
  ('seed_war_02b', 'seed_dev_02', 'EXTENDED', 'FPT Care',
   '2025-06-10', '2026-06-10', 12, 2490000, 'FPT Shop 88 Nguyễn Trãi, Thanh Xuân', '1800-6601',
   'Gói FPT Care kéo dài đổi máy lỗi nhà sản xuất.', now()),

  -- dev_03 Galaxy Tab S9: STANDARD 24m -> 2026-12-01 (~6.5 tháng)
  ('seed_war_03a', 'seed_dev_03', 'STANDARD', 'Samsung Care',
   '2024-12-01', '2026-12-01', 24, NULL, 'TTBH Samsung 144 Phố Huế', '1800-588-855',
   'Bảo hành Samsung chính hãng 2 năm.', now()),

  -- dev_04 Sony WH-1000XM5: STANDARD 12m -> 2025-03-10 (expired)
  ('seed_war_04a', 'seed_dev_04', 'STANDARD', 'Sony Vietnam',
   '2024-03-10', '2025-03-10', 12, NULL, 'Sony Center 257 Bà Triệu, Hai Bà Trưng', '1800-588-885',
   'Đã hết hạn. Cần đăng ký gia hạn riêng nếu muốn.', now()),

  -- dev_05 Apple Watch S9: STANDARD 12m -> 2025-11-20 (expired), EXTENDED 12m -> ~2026-07-05 (<60d)
  ('seed_war_05a', 'seed_dev_05', 'STANDARD', 'Apple Authorized Service Provider',
   '2024-11-20', '2025-11-20', 12, NULL, '63 Trần Thái Tông, Cầu Giấy, Hà Nội', '1800-1192',
   'Hết bảo hành chuẩn.', now()),
  ('seed_war_05b', 'seed_dev_05', 'EXTENDED', 'Topzone Care',
   '2025-07-05', '2026-07-05', 12, 1490000, 'Topzone 23 Tây Sơn, Đống Đa', '1800-2097',
   'Gói gia hạn Topzone Care.', now()),

  -- dev_06 LG Washer: STANDARD 24m -> 2025-06-12 (expired), THIRD_PARTY 24m -> ~2026-08-10 (<90d)
  ('seed_war_06a', 'seed_dev_06', 'STANDARD', 'LG Service VN',
   '2023-06-12', '2025-06-12', 24, NULL, 'TTBH LG 89 Cầu Giấy, Hà Nội', '1800-1503',
   'Bảo hành LG chính hãng 24 tháng.', now()),
  ('seed_war_06b', 'seed_dev_06', 'THIRD_PARTY', 'Điện máy Xanh Bảo hành mở rộng',
   '2024-08-10', '2026-08-10', 24, 890000, 'Điện máy Xanh 234 Cầu Giấy', '1800-1060',
   'Gói bảo hành mở rộng tại Điện máy Xanh.', now()),

  -- dev_07 Panasonic Fridge: STANDARD 24m -> 2025-04-05 (expired), EXTENDED 24m -> 2027-04-05
  ('seed_war_07a', 'seed_dev_07', 'STANDARD', 'Panasonic VN',
   '2023-04-05', '2025-04-05', 24, NULL, 'TTBH Panasonic 96 Định Công, Hoàng Mai', '1800-8113',
   'Bảo hành chuẩn 2 năm.', now()),
  ('seed_war_07b', 'seed_dev_07', 'EXTENDED', 'Nguyễn Kim Bảo hành Vàng',
   '2025-04-05', '2027-04-05', 24, 1290000, 'Nguyễn Kim Phạm Hùng', '1800-6800',
   'Gói Bảo hành Vàng Nguyễn Kim mua thêm.', now()),

  -- dev_08 Roborock S8: STANDARD 24m -> 2026-07-18 (~2 tháng, <90d)
  ('seed_war_08a', 'seed_dev_08', 'STANDARD', 'Roborock Việt Nam',
   '2024-07-18', '2026-07-18', 24, NULL, 'Showroom Roborock 24 Thái Hà, Đống Đa', '1900-1259',
   'Bảo hành toàn quốc qua hệ thống Roborock VN.', now()),

  -- dev_09 Dyson V12: STANDARD 24m -> 2027-01-08
  ('seed_war_09a', 'seed_dev_09', 'STANDARD', 'Dyson Việt Nam',
   '2025-01-08', '2027-01-08', 24, NULL, 'Dyson Demo Store Vincom Bà Triệu', '1800-1271',
   'Bảo hành Dyson 24 tháng kèm online support.', now()),

  -- dev_10 Switch OLED: STANDARD 12m -> 2024-11-25 (expired)
  ('seed_war_10a', 'seed_dev_10', 'STANDARD', 'Game Stop Hà Nội',
   '2023-11-25', '2024-11-25', 12, NULL, 'Game Stop 152 Tây Sơn, Đống Đa', '0243-555-1111',
   'Bảo hành cửa hàng. Hiện đã hết hạn.', now());

-- ----------------------------------------------------------------------------
-- 4. Reminders — surface a few warranties on the dashboard reminders page.
-- ----------------------------------------------------------------------------
INSERT INTO "Reminder" (id, "warrantyId", "isDismissed")
VALUES
  ('seed_rem_02b', 'seed_war_02b', false),  -- iPhone <30d
  ('seed_rem_05b', 'seed_war_05b', false),  -- Apple Watch <60d
  ('seed_rem_06b', 'seed_war_06b', false),  -- LG <90d
  ('seed_rem_08a', 'seed_war_08a', false);  -- Roborock <90d

-- ----------------------------------------------------------------------------
-- 5. Subscriptions (5) — VND integer prices; today = 2026-05-17
-- ----------------------------------------------------------------------------
INSERT INTO "Subscription"
  (id, "userId", name, category, brand, plan, "billingCycle", "intervalDays",
   price, currency, "startedAt", "renewalDate", "autoRenew", status,
   "accountEmail", "paymentMethod", "manageUrl", notes, "updatedAt")
VALUES
  ('seed_sub_01', :user_id, 'Apple One Premier',     'STREAMING',    'Apple',    'Premier (Family)',
   'MONTHLY', NULL, 195000, 'VND', '2024-01-05', '2026-06-05', true, 'ACTIVE',
   'thanhtrung9368@icloud.com', 'Visa Techcombank',
   'https://account.apple.com/subscriptions',
   'Gói gia đình 5 người, gồm iCloud 2TB + Music + TV+ + Arcade + News+.', now()),

  ('seed_sub_02', :user_id, 'Spotify Family',        'MUSIC',        'Spotify',  'Family',
   'MONTHLY', NULL,  99000, 'VND', '2024-03-12', '2026-06-12', true, 'ACTIVE',
   'thanhtrung9368@gmail.com', 'MoMo',
   'https://www.spotify.com/vn/account/subscription/',
   'Gói gia đình 6 người, share với người thân.', now()),

  ('seed_sub_03', :user_id, 'ChatGPT Plus',          'AI_TOOL',      'OpenAI',   'Plus',
   'MONTHLY', NULL, 510000, 'VND', '2024-02-01', '2026-06-01', true, 'ACTIVE',
   'thanhtrung9368@gmail.com', 'Visa Techcombank',
   'https://chat.openai.com/#settings/Subscription',
   'Khoảng 20 USD/tháng, dùng cho công việc + viết code.', now()),

  ('seed_sub_04', :user_id, 'YouTube Premium Family','STREAMING',    'Google',   'Premium Family',
   'MONTHLY', NULL, 119000, 'VND', '2024-05-28', '2026-05-22', true, 'ACTIVE',
   'thanhtrung9368@gmail.com', 'Visa Techcombank',
   'https://www.youtube.com/paid_memberships',
   'Sắp gia hạn trong tuần này — kiểm tra payment method.', now()),

  ('seed_sub_05', :user_id, 'Adobe Creative Cloud',  'PRODUCTIVITY', 'Adobe',    'All Apps (Yearly)',
   'YEARLY',  NULL, 2290000,'VND', '2025-01-15', '2027-01-15', true, 'ACTIVE',
   'thanhtrung9368@gmail.com', 'Visa Techcombank',
   'https://account.adobe.com/plans',
   'Gói all-apps, thanh toán năm sale Black Friday.', now());

-- ----------------------------------------------------------------------------
-- 6. Wishlist (3) + price history
-- ----------------------------------------------------------------------------
INSERT INTO "WishlistItem"
  (id, "userId", name, category, brand, "initialPrice", "currentPrice",
   "buyUrl", "targetDate", priority, status, notes, "reminderIntervalDays", "updatedAt")
VALUES
  ('seed_wl_01', :user_id, 'iPad Pro M4 11"',        'TABLET',         'Apple',
   28990000, 27490000,
   'https://www.topzone.vn/ipad-pro-m4-11', '2026-09-01', 'MUST',  'WATCHING',
   'Theo dõi giá khi Apple ra series mới, cần Wi-Fi 256GB.', 14, now()),

  ('seed_wl_02', :user_id, 'Sony A7C II body',       'CAMERA',         'Sony',
   50990000, 48500000,
   'https://www.sonycenter.vn/a7c-ii-body', '2026-12-31', 'WANT',  'WATCHING',
   'Để đổi từ A6400, ưu tiên body trước rồi mua lens 35mm sau.', 30, now()),

  ('seed_wl_03', :user_id, 'Steam Deck OLED 512GB',  'GAMING_CONSOLE', 'Valve',
   14500000, 13800000,
   'https://shopdunk.com/steam-deck-oled', '2026-08-15', 'WANT',  'WATCHING',
   'Mua bản OLED, đợi sale hè + freeship.', 21, now());

INSERT INTO "WishlistPrice" (id, "itemId", price, note, "recordedAt") VALUES
  ('seed_wp_01a', 'seed_wl_01', 28990000, 'Giá niêm yết ban đầu Topzone',         '2026-02-01 10:00:00'),
  ('seed_wp_01b', 'seed_wl_01', 28490000, 'Giảm 500k dịp lễ 30/4',                '2026-04-28 11:00:00'),
  ('seed_wp_01c', 'seed_wl_01', 27490000, 'Sale tuần này — thấp nhất từ trước',   '2026-05-15 09:00:00'),

  ('seed_wp_02a', 'seed_wl_02', 50990000, 'Giá Sony Center khi mới ra',           '2026-01-20 10:00:00'),
  ('seed_wp_02b', 'seed_wl_02', 49990000, 'Giảm 1 triệu sau Tết',                 '2026-03-05 10:00:00'),
  ('seed_wp_02c', 'seed_wl_02', 48500000, 'Khuyến mãi tháng 5',                   '2026-05-10 10:00:00'),

  ('seed_wp_03a', 'seed_wl_03', 14500000, 'Giá nhập ban đầu',                     '2026-03-01 10:00:00'),
  ('seed_wp_03b', 'seed_wl_03', 14200000, 'Giảm nhẹ giữa tháng 4',                '2026-04-15 10:00:00'),
  ('seed_wp_03c', 'seed_wl_03', 13800000, 'Mức thấp nhất hiện tại',               '2026-05-12 10:00:00');

COMMIT;

-- ----------------------------------------------------------------------------
-- Verification
-- ----------------------------------------------------------------------------
SELECT
  (SELECT count(*) FROM "Device"        WHERE id LIKE 'seed_dev_%')  AS devices,
  (SELECT count(*) FROM "Warranty"      WHERE id LIKE 'seed_war_%')  AS warranties,
  (SELECT count(*) FROM "Reminder"      WHERE id LIKE 'seed_rem_%')  AS reminders,
  (SELECT count(*) FROM "Subscription"  WHERE id LIKE 'seed_sub_%')  AS subs,
  (SELECT count(*) FROM "WishlistItem"  WHERE id LIKE 'seed_wl_%')   AS wishlist,
  (SELECT count(*) FROM "WishlistPrice" WHERE id LIKE 'seed_wp_%')   AS wishlist_prices;
