#!/usr/bin/env bash
# Smoke test cho scripts/seed_dev.sql — bộ dữ liệu mẫu tiếng Việt cho dev.
#
# Trước đây file này chỉ chạy được bằng `psql` (dùng `\set` + biến `:user_id`),
# nên chưa bao giờ được kiểm chứng là còn khớp schema. Test này chạy nó qua
# dbtool rồi assert:
#   - seed khớp schema hiện tại (không lỗi cột/bảng)
#   - chạy lại không nhân đôi dữ liệu (header của file tự nhận là idempotent)
#   - dữ liệu seed đọc được qua HTTP API (devices / subscriptions / wishlist)
#
# Chạy qua runner: ./scripts/e2e.sh [--only seed_dev]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
# shellcheck source=lib.sh
. "${SCRIPT_DIR}/lib.sh"

wv_init "${API_DIR}"

TEST_EMAIL="__goseeddevtest__@local.test"
PW="seed-dev-pw-12345"
# devices|warranties|reminders|subscriptions|wishlist|wishlist_prices
EXPECTED_SEED_ROW="10|15|4|5|3|9"

wv_require_server

echo "→ Dọn dữ liệu test cũ"
wv_cleanup_user "${TEST_EMAIL}"
trap 'wv_cleanup_user "${TEST_EMAIL}"' EXIT

echo "→ Đăng ký user để gắn dữ liệu seed"
wv_register "${TEST_EMAIL}" "${PW}" "Seed Dev Test"
[ "$WV_STATUS" = "201" ] && cond=true || cond=false
assert "$cond" "register trả 201 (nhận $WV_STATUS)"
TOKEN="$WV_TOKEN"
H_AUTH="authorization: Bearer ${TOKEN}"
USER_ID=$(jq -r '.user.id' "$WV_BODY_FILE")

echo
echo "→ Chạy seed_dev.sql lần 1 (qua dbtool — không cần psql)"
verify1="$(wv_sql -v "user_id='${USER_ID}'" -f "${SCRIPT_DIR}/seed_dev.sql" | tail -1)"
[ "$verify1" = "$EXPECTED_SEED_ROW" ] && cond=true || cond=false
assert "$cond" "seed lần 1 đúng số dòng (nhận '$verify1', mong đợi '$EXPECTED_SEED_ROW')"

echo
echo "→ Chạy lại lần 2 — file tự xoá batch cũ nên phải idempotent"
verify2="$(wv_sql -v "user_id='${USER_ID}'" -f "${SCRIPT_DIR}/seed_dev.sql" | tail -1)"
[ "$verify2" = "$verify1" ] && cond=true || cond=false
assert "$cond" "seed lần 2 không nhân đôi dữ liệu (nhận '$verify2')"

echo
echo "→ Kiểm tra enum của seed khớp hợp đồng API (openapi.yaml)"
# seed_dev.sql ghi thẳng vào DB nên bỏ qua validator của API: một giá trị enum
# sai (vd priority 'HIGH' thay vì MUST/WANT/MAYBE) vẫn insert được nhưng web/
# mobile không map ra nhãn. Query này bắt đúng lớp lỗi đó.
bad_enums="$(wv_sql -c "
SELECT
  (SELECT count(*) FROM \"Device\"       WHERE id LIKE 'seed_dev_%' AND status NOT IN ('ACTIVE','EXPIRED','SOLD','BROKEN','LOST'))
+ (SELECT count(*) FROM \"Warranty\"     WHERE id LIKE 'seed_war_%' AND type NOT IN ('STANDARD','EXTENDED','THIRD_PARTY'))
+ (SELECT count(*) FROM \"Subscription\" WHERE id LIKE 'seed_sub_%' AND \"billingCycle\" NOT IN ('MONTHLY','QUARTERLY','YEARLY','LIFETIME','CUSTOM'))
+ (SELECT count(*) FROM \"Subscription\" WHERE id LIKE 'seed_sub_%' AND status NOT IN ('ACTIVE','PAUSED','CANCELED','EXPIRED'))
+ (SELECT count(*) FROM \"WishlistItem\" WHERE id LIKE 'seed_wl_%'  AND priority NOT IN ('MUST','WANT','MAYBE'))
+ (SELECT count(*) FROM \"WishlistItem\" WHERE id LIKE 'seed_wl_%'  AND status NOT IN ('WATCHING','DECIDED','SKIPPED','PURCHASED'));
")"
[ "$bad_enums" = "0" ] && cond=true || cond=false
assert "$cond" "enum trong seed hợp lệ theo openapi.yaml (số giá trị sai: $bad_enums)"

echo
echo "→ Đọc dữ liệu seed qua HTTP API"
status=$(wv_curl_status -X GET "${BASE}/api/v1/devices" -H "$H_AUTH")
[ "$status" = "200" ] && cond=true || cond=false
assert "$cond" "GET /api/v1/devices trả 200 (nhận $status)"
DCOUNT=$(jq '.devices | length' "$WV_BODY_FILE")
[ "$DCOUNT" = "10" ] && cond=true || cond=false
assert "$cond" "API trả 10 thiết bị seed (nhận $DCOUNT)"

status=$(wv_curl_status -X GET "${BASE}/api/v1/subscriptions" -H "$H_AUTH")
SCOUNT=$(jq '.subscriptions | length' "$WV_BODY_FILE")
[ "$SCOUNT" = "5" ] && cond=true || cond=false
assert "$cond" "API trả 5 subscription seed (nhận $SCOUNT)"

status=$(wv_curl_status -X GET "${BASE}/api/v1/wishlist" -H "$H_AUTH")
WCOUNT=$(jq '.items | length' "$WV_BODY_FILE")
[ "$WCOUNT" = "3" ] && cond=true || cond=false
assert "$cond" "API trả 3 wishlist item seed (nhận $WCOUNT)"

echo
echo "→ GET /api/v1/stats trên dữ liệu seed"
status=$(wv_curl_status -X GET "${BASE}/api/v1/stats" -H "$H_AUTH")
[ "$status" = "200" ] && cond=true || cond=false
assert "$cond" "GET /api/v1/stats trả 200 (nhận $status)"
TOTAL=$(jq '.devices.total' "$WV_BODY_FILE")
[ "$TOTAL" = "10" ] && cond=true || cond=false
assert "$cond" "stats.devices.total = 10 (nhận $TOTAL)"

echo
echo "→ Dọn dẹp"
wv_cleanup_user "${TEST_EMAIL}"

wv_summary "TOÀN BỘ TEST SEED_DEV ĐỀU ĐẠT"
