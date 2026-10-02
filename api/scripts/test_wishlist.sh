#!/usr/bin/env bash
# Parity test for /api/v1/wishlist against the Go service.
#
# Chạy qua runner: ./scripts/e2e.sh [--only wishlist]
# Dọn dẹp: xoá user test (cascade) qua dbtool — không cần psql.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
# shellcheck source=lib.sh
. "${SCRIPT_DIR}/lib.sh"

wv_init "${API_DIR}"

TEST_EMAIL="__gowishtest__@local.test"
PW="wish-test-pw-12345"

wv_require_server

echo "→ Dọn dữ liệu test cũ"
wv_cleanup_user "${TEST_EMAIL}"
trap 'wv_cleanup_user "${TEST_EMAIL}"' EXIT

echo "→ Đăng ký"
wv_register "${TEST_EMAIL}" "${PW}" "Wish Test"
[ "$WV_STATUS" = "201" ] && cond=true || cond=false
assert "$cond" "register trả 201 (nhận $WV_STATUS)"
TOKEN="$WV_TOKEN"
H_AUTH="authorization: Bearer ${TOKEN}"

echo
echo "→ Tạo wishlist (WATCHING, có initialPrice → seed lịch sử giá)"
status=$(wv_curl_status -X POST "${BASE}/api/v1/wishlist" \
  -H "$H_AUTH" -H 'content-type: application/json' \
  -d '{
    "name":"MacBook Pro 16 M5",
    "category":"LAPTOP",
    "brand":"Apple",
    "initialPrice":80000000,
    "priority":"WANT",
    "status":"WATCHING"
  }')
[ "$status" = "201" ] && cond=true || cond=false
assert "$cond" "tạo wishlist trả 201 (nhận $status)"
ITEM_ID=$(jq -r '.item.id' "$WV_BODY_FILE")
[ -n "$ITEM_ID" ] && [ "$ITEM_ID" != "null" ] && cond=true || cond=false
assert "$cond" "có item.id"

echo
echo "→ Liệt kê wishlist"
status=$(wv_curl_status -X GET "${BASE}/api/v1/wishlist" -H "$H_AUTH")
[ "$status" = "200" ] && cond=true || cond=false
assert "$cond" "list trả 200 (nhận $status)"
COUNT=$(jq '.items | length' "$WV_BODY_FILE")
[ "$COUNT" = "1" ] && cond=true || cond=false
assert "$cond" "danh sách đúng 1 item (nhận $COUNT)"

echo
echo "→ Cập nhật currentPrice → lịch sử giá tăng"
status=$(wv_curl_status -X PATCH "${BASE}/api/v1/wishlist/${ITEM_ID}" \
  -H "$H_AUTH" -H 'content-type: application/json' \
  -d '{
    "name":"MacBook Pro 16 M5",
    "category":"LAPTOP",
    "brand":"Apple",
    "initialPrice":80000000,
    "currentPrice":75000000,
    "priority":"WANT",
    "status":"WATCHING"
  }')
[ "$status" = "200" ] && cond=true || cond=false
assert "$cond" "update trả 200 (nhận $status)"

# Kiểm tra qua GET detail
status=$(wv_curl_status -X GET "${BASE}/api/v1/wishlist/${ITEM_ID}" -H "$H_AUTH")
PCOUNT=$(jq '.prices | length' "$WV_BODY_FILE")
# Tạo với initialPrice seed 1 dòng, PATCH thêm 1 → 2
[ "$PCOUNT" = "2" ] && cond=true || cond=false
assert "$cond" "lịch sử giá có 2 dòng sau khi đổi giá (nhận $PCOUNT)"
CURRENT=$(jq -r '.item.currentPrice' "$WV_BODY_FILE")
[ "$CURRENT" = "75000000" ] && cond=true || cond=false
assert "$cond" "currentPrice = 75000000 (nhận $CURRENT)"

echo
echo "→ Đánh dấu PURCHASED → có purchasedDeviceId + tạo Device mới"
status=$(wv_curl_status -X PATCH "${BASE}/api/v1/wishlist/${ITEM_ID}" \
  -H "$H_AUTH" -H 'content-type: application/json' \
  -d '{
    "name":"MacBook Pro 16 M5",
    "category":"LAPTOP",
    "brand":"Apple",
    "currentPrice":75000000,
    "priority":"WANT",
    "status":"PURCHASED"
  }')
[ "$status" = "200" ] && cond=true || cond=false
assert "$cond" "mark PURCHASED trả 200 (nhận $status)"
PURCHASED_DID=$(jq -r '.item.purchasedDeviceId' "$WV_BODY_FILE")
[ -n "$PURCHASED_DID" ] && [ "$PURCHASED_DID" != "null" ] && cond=true || cond=false
assert "$cond" "đã set purchasedDeviceId (nhận $PURCHASED_DID)"

# Xác nhận device đã được tạo
status=$(wv_curl_status -X GET "${BASE}/api/v1/devices/${PURCHASED_DID}" -H "$H_AUTH")
[ "$status" = "200" ] && cond=true || cond=false
assert "$cond" "device sinh ra fetch được (nhận $status)"
DNAME=$(jq -r '.device.name' "$WV_BODY_FILE")
[ "$DNAME" = "MacBook Pro 16 M5" ] && cond=true || cond=false
assert "$cond" "device sinh ra đúng tên (nhận $DNAME)"

echo
echo "→ Xoá wishlist item"
status=$(wv_curl_status -X DELETE "${BASE}/api/v1/wishlist/${ITEM_ID}" -H "$H_AUTH")
[ "$status" = "200" ] && cond=true || cond=false
assert "$cond" "xoá trả 200 (nhận $status)"

echo
echo "→ GET item đã xoá → 404"
status=$(wv_curl_status -X GET "${BASE}/api/v1/wishlist/${ITEM_ID}" -H "$H_AUTH")
[ "$status" = "404" ] && cond=true || cond=false
assert "$cond" "GET item đã xoá trả 404 (nhận $status)"

wv_summary "TOÀN BỘ TEST WISHLIST ĐỀU ĐẠT"
