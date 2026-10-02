#!/usr/bin/env bash
# Parity test for GET /api/v1/stats. Bản gốc: website/scripts/test-stats.mjs —
# seed fixture bằng dbtool (thay psql) + curl + jq. Dọn dẹp bằng cascade delete.
#
# Chạy qua runner: ./scripts/e2e.sh [--only stats]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
# shellcheck source=lib.sh
. "${SCRIPT_DIR}/lib.sh"

wv_init "${API_DIR}"

TEST_EMAIL="__gostatstest__@local.test"
PW="stats-test-pw-12345"

wv_require_server

wv_cleanup_user "${TEST_EMAIL}"
trap 'wv_cleanup_user "${TEST_EMAIL}"' EXIT

echo "→ Đăng ký (tạo user scoped cho test)"
wv_register "${TEST_EMAIL}" "${PW}" "Stats Test"
[ "$WV_STATUS" = "201" ] && cond=true || cond=false
assert "$cond" "register trả 201 (nhận $WV_STATUS)"
TOKEN="$WV_TOKEN"
USER_ID=$(jq -r '.user.id' "$WV_BODY_FILE")
H_AUTH="authorization: Bearer ${TOKEN}"

echo
echo "→ Seed fixture qua dbtool (khớp website/scripts/test-stats.mjs)"
wv_sql -q <<SQL
INSERT INTO "Device" (id, "userId", name, category, "purchaseDate", "purchasePrice", status, "createdAt", "updatedAt")
VALUES
  ('stats_dev_1', '$USER_ID', 'MBP M4',    'LAPTOP', '2025-06-01', 30000000, 'ACTIVE', now(), now()),
  ('stats_dev_2', '$USER_ID', 'iPhone 16', 'PHONE',  '2025-09-15', 20000000, 'ACTIVE', now(), now()),
  ('stats_dev_3', '$USER_ID', 'Old iPad',  'TABLET', '2022-01-01', 10000000, 'SOLD',   now(), now());

-- Warranty packages: 2.5M on dev_1 plus a NULL-cost package on dev_2, so
-- devices.totalWarrantyCost must be 2500000 (the NULL row contributes 0).
INSERT INTO "Warranty" (id, "deviceId", type, "startDate", "endDate", months, cost, "createdAt", "updatedAt")
VALUES
  ('stats_war_1', 'stats_dev_1', 'STANDARD',    '2025-06-01', '2027-06-01', 24, 2500000, now(), now()),
  ('stats_war_2', 'stats_dev_2', 'THIRD_PARTY', '2025-09-15', '2026-09-15', 12, NULL,    now(), now());

INSERT INTO "Subscription" (id, "userId", name, "billingCycle", price, currency, "startedAt", "renewalDate", "autoRenew", status, "createdAt", "updatedAt")
VALUES
  ('stats_sub_1', '$USER_ID', 'ChatGPT Plus', 'MONTHLY',  480000,  'VND', '2026-01-01', '2026-06-01', true,  'ACTIVE', now(), now()),
  ('stats_sub_2', '$USER_ID', 'Hosting',      'YEARLY',   1200000, 'VND', '2026-01-01', '2027-01-01', true,  'ACTIVE', now(), now()),
  ('stats_sub_3', '$USER_ID', 'Lifetime Tool','LIFETIME', 5000000, 'VND', '2025-01-01', '2125-01-01', false, 'ACTIVE', now(), now()),
  ('stats_sub_4', '$USER_ID', 'Paused Spotify','MONTHLY', 59000,   'VND', '2025-01-01', '2026-06-01', true,  'PAUSED', now(), now());

INSERT INTO "WishlistItem" (id, "userId", name, "currentPrice", status, priority, "createdAt", "updatedAt")
VALUES
  ('stats_wish_1', '$USER_ID', 'Sony WH-1000XM6', 8500000,  'WATCHING',  'WANT',  now(), now()),
  ('stats_wish_2', '$USER_ID', 'iPad mini 7',     14500000, 'WATCHING',  'MAYBE', now(), now()),
  ('stats_wish_3', '$USER_ID', 'New iMac',        25000000, 'DECIDED',   'MUST',  now(), now()),
  ('stats_wish_4', '$USER_ID', 'AirPods Max',     12000000, 'SKIPPED',   'MAYBE', now(), now());
SQL
echo "  OK    đã seed fixture"

echo
echo "→ GET /api/v1/stats không auth → 401"
status=$(wv_curl_status -X GET "${BASE}/api/v1/stats")
[ "$status" = "401" ] && cond=true || cond=false
assert "$cond" "không auth trả 401 (nhận $status)"

echo
echo "→ GET /api/v1/stats có auth"
status=$(wv_curl_status -X GET "${BASE}/api/v1/stats" -H "$H_AUTH")
[ "$status" = "200" ] && cond=true || cond=false
assert "$cond" "GET /api/v1/stats trả 200 (nhận $status)"

echo
echo "→ Tổng hợp thiết bị"
V=$(jq '.devices.total' "$WV_BODY_FILE");              [ "$V" = "3" ]        && cond=true || cond=false; assert "$cond" "devices.total = 3 (nhận $V)"
V=$(jq '.devices.byStatus.ACTIVE' "$WV_BODY_FILE");    [ "$V" = "2" ]        && cond=true || cond=false; assert "$cond" "devices.byStatus.ACTIVE = 2 (nhận $V)"
V=$(jq '.devices.byStatus.SOLD' "$WV_BODY_FILE");      [ "$V" = "1" ]        && cond=true || cond=false; assert "$cond" "devices.byStatus.SOLD = 1 (nhận $V)"
V=$(jq '.devices.byStatus.EXPIRED' "$WV_BODY_FILE");   [ "$V" = "0" ]        && cond=true || cond=false; assert "$cond" "devices.byStatus.EXPIRED = 0 (nhận $V)"
V=$(jq '.devices.totalPurchasePrice' "$WV_BODY_FILE"); [ "$V" = "60000000" ] && cond=true || cond=false; assert "$cond" "devices.totalPurchasePrice = 60M (nhận $V)"
V=$(jq '.devices.totalWarrantyCost' "$WV_BODY_FILE");  [ "$V" = "2500000" ]  && cond=true || cond=false; assert "$cond" "devices.totalWarrantyCost = 2.5M (nhận $V)"

echo
echo "→ Tổng hợp subscription"
V=$(jq '.subscriptions.total' "$WV_BODY_FILE");              [ "$V" = "4" ]      && cond=true || cond=false; assert "$cond" "subscriptions.total = 4 (nhận $V)"
V=$(jq '.subscriptions.byStatus.ACTIVE' "$WV_BODY_FILE");    [ "$V" = "3" ]      && cond=true || cond=false; assert "$cond" "subscriptions.byStatus.ACTIVE = 3 (nhận $V)"
V=$(jq '.subscriptions.byStatus.PAUSED' "$WV_BODY_FILE");    [ "$V" = "1" ]      && cond=true || cond=false; assert "$cond" "subscriptions.byStatus.PAUSED = 1 (nhận $V)"
V=$(jq '.subscriptions.totalMonthlyVnd' "$WV_BODY_FILE");    [ "$V" = "580000" ] && cond=true || cond=false; assert "$cond" "subscriptions.totalMonthlyVnd = 580k (nhận $V)"

echo
echo "→ Tổng hợp wishlist"
V=$(jq '.wishlist.total' "$WV_BODY_FILE");                       [ "$V" = "4" ]        && cond=true || cond=false; assert "$cond" "wishlist.total = 4 (nhận $V)"
V=$(jq '.wishlist.byStatus.WATCHING' "$WV_BODY_FILE");           [ "$V" = "2" ]        && cond=true || cond=false; assert "$cond" "wishlist.byStatus.WATCHING = 2 (nhận $V)"
V=$(jq '.wishlist.byStatus.DECIDED' "$WV_BODY_FILE");            [ "$V" = "1" ]        && cond=true || cond=false; assert "$cond" "wishlist.byStatus.DECIDED = 1 (nhận $V)"
V=$(jq '.wishlist.byStatus.SKIPPED' "$WV_BODY_FILE");            [ "$V" = "1" ]        && cond=true || cond=false; assert "$cond" "wishlist.byStatus.SKIPPED = 1 (nhận $V)"
V=$(jq '.wishlist.byStatus.PURCHASED' "$WV_BODY_FILE");          [ "$V" = "0" ]        && cond=true || cond=false; assert "$cond" "wishlist.byStatus.PURCHASED = 0 (nhận $V)"
V=$(jq '.wishlist.totalCurrentPriceWatching' "$WV_BODY_FILE");   [ "$V" = "48000000" ] && cond=true || cond=false; assert "$cond" "wishlist.totalCurrentPriceWatching = 48M (nhận $V)"

echo
echo "→ Dọn dẹp"
wv_cleanup_user "${TEST_EMAIL}"

wv_summary "TOÀN BỘ TEST STATS ĐỀU ĐẠT"
