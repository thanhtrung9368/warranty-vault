#!/usr/bin/env bash
# Parity test for /api/v1/devices + warranties + reminders against the Go service.
#
# Chạy qua runner: ./scripts/e2e.sh [--only devices]
# Dọn dẹp: xoá user test (cascade) qua dbtool — không cần psql.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
# shellcheck source=lib.sh
. "${SCRIPT_DIR}/lib.sh"

wv_init "${API_DIR}"

TEST_EMAIL="__godevicestest__@local.test"
PW="device-test-pw-12345"

wv_require_server

echo "→ Dọn dữ liệu test cũ"
wv_cleanup_user "${TEST_EMAIL}"
trap 'wv_cleanup_user "${TEST_EMAIL}"' EXIT

echo "→ Đăng ký"
wv_register "${TEST_EMAIL}" "${PW}" "Devices Test"
[ "$WV_STATUS" = "201" ] && cond=true || cond=false
assert "$cond" "register trả 201 (nhận $WV_STATUS)"
TOKEN="$WV_TOKEN"
H_AUTH="authorization: Bearer ${TOKEN}"

echo
echo "→ Tạo thiết bị kèm bảo hành inline (warrantyMonths=24)"
status=$(wv_curl_status -X POST "${BASE}/api/v1/devices" \
  -H "$H_AUTH" -H 'content-type: application/json' \
  -d '{
    "name":"iPhone 17 Pro",
    "category":"PHONE",
    "brand":"Apple",
    "purchaseDate":"2026-01-15",
    "purchasePrice":35000000,
    "warrantyMonths":24,
    "warrantyProvider":"Apple Authorized"
  }')
[ "$status" = "201" ] && cond=true || cond=false
assert "$cond" "tạo thiết bị trả 201 (nhận $status)"
DEVICE_ID=$(jq -r '.device.id' "$WV_BODY_FILE")
[ -n "$DEVICE_ID" ] && [ "$DEVICE_ID" != "null" ] && cond=true || cond=false
assert "$cond" "có device.id"

echo
echo "→ Liệt kê thiết bị"
status=$(wv_curl_status -X GET "${BASE}/api/v1/devices" -H "$H_AUTH")
[ "$status" = "200" ] && cond=true || cond=false
assert "$cond" "list devices trả 200 (nhận $status)"
COUNT=$(jq '.devices | length' "$WV_BODY_FILE")
[ "$COUNT" = "1" ] && cond=true || cond=false
assert "$cond" "danh sách đúng 1 thiết bị (nhận $COUNT)"

echo
echo "→ Chi tiết thiết bị (kèm bảo hành)"
status=$(wv_curl_status -X GET "${BASE}/api/v1/devices/${DEVICE_ID}" -H "$H_AUTH")
[ "$status" = "200" ] && cond=true || cond=false
assert "$cond" "get device trả 200 (nhận $status)"
WCOUNT=$(jq '.device.warranties | length' "$WV_BODY_FILE")
[ "$WCOUNT" = "1" ] && cond=true || cond=false
assert "$cond" "thiết bị có 1 bảo hành (nhận $WCOUNT)"
WARRANTY_ID=$(jq -r '.device.warranties[0].id' "$WV_BODY_FILE")
WTYPE=$(jq -r '.device.warranties[0].type' "$WV_BODY_FILE")
[ "$WTYPE" = "STANDARD" ] && cond=true || cond=false
assert "$cond" "bảo hành inline là loại STANDARD (nhận $WTYPE)"

echo
echo "→ Cập nhật thiết bị (đổi tên + giá mua)"
status=$(wv_curl_status -X PATCH "${BASE}/api/v1/devices/${DEVICE_ID}" \
  -H "$H_AUTH" -H 'content-type: application/json' \
  -d '{
    "name":"iPhone 17 Pro Max",
    "category":"PHONE",
    "purchaseDate":"2026-01-15",
    "purchasePrice":40000000,
    "warrantyMonths":24
  }')
[ "$status" = "200" ] && cond=true || cond=false
assert "$cond" "update device trả 200 (nhận $status)"
NAME=$(jq -r '.device.name' "$WV_BODY_FILE")
[ "$NAME" = "iPhone 17 Pro Max" ] && cond=true || cond=false
assert "$cond" "đã đổi tên (nhận $NAME)"

echo
echo "→ Thêm bảo hành EXTENDED 12 tháng"
status=$(wv_curl_status -X POST "${BASE}/api/v1/devices/${DEVICE_ID}/warranties" \
  -H "$H_AUTH" -H 'content-type: application/json' \
  -d '{
    "type":"EXTENDED",
    "provider":"AppleCare+",
    "startDate":"2026-01-15",
    "months":12,
    "cost":3000000
  }')
[ "$status" = "201" ] && cond=true || cond=false
assert "$cond" "tạo warranty trả 201 (nhận $status)"
EXTRA_W_ID=$(jq -r '.warranty.id' "$WV_BODY_FILE")

echo
echo "→ Xác nhận thiết bị đã có 2 bảo hành"
status=$(wv_curl_status -X GET "${BASE}/api/v1/devices/${DEVICE_ID}" -H "$H_AUTH")
WCOUNT=$(jq '.device.warranties | length' "$WV_BODY_FILE")
[ "$WCOUNT" = "2" ] && cond=true || cond=false
assert "$cond" "thiết bị có 2 bảo hành (nhận $WCOUNT)"

echo
echo "→ Tắt nhắc nhở cho bảo hành đầu"
status=$(wv_curl_status -X POST "${BASE}/api/v1/warranties/${WARRANTY_ID}/reminder" -H "$H_AUTH")
[ "$status" = "200" ] && cond=true || cond=false
assert "$cond" "dismiss reminder trả 200 (nhận $status)"

echo
echo "→ GET /api/v1/reminders (mặc định cửa sổ 30 ngày)"
status=$(wv_curl_status -X GET "${BASE}/api/v1/reminders" -H "$H_AUTH")
[ "$status" = "200" ] && cond=true || cond=false
assert "$cond" "list reminders trả 200 (nhận $status)"
KIND=$(jq -r '.reminders | type' "$WV_BODY_FILE")
[ "$KIND" = "array" ] && cond=true || cond=false
assert "$cond" ".reminders là array (nhận $KIND)"

echo
echo "→ Bật lại nhắc nhở"
status=$(wv_curl_status -X DELETE "${BASE}/api/v1/warranties/${WARRANTY_ID}/reminder" -H "$H_AUTH")
[ "$status" = "200" ] && cond=true || cond=false
assert "$cond" "restore reminder trả 200 (nhận $status)"

echo
echo "→ Xoá thiết bị"
status=$(wv_curl_status -X DELETE "${BASE}/api/v1/devices/${DEVICE_ID}" -H "$H_AUTH")
[ "$status" = "200" ] && cond=true || cond=false
assert "$cond" "xoá thiết bị trả 200 (nhận $status)"

echo
echo "→ GET thiết bị đã xoá → 404"
status=$(wv_curl_status -X GET "${BASE}/api/v1/devices/${DEVICE_ID}" -H "$H_AUTH")
[ "$status" = "404" ] && cond=true || cond=false
assert "$cond" "get thiết bị đã xoá trả 404 (nhận $status)"

wv_summary "TOÀN BỘ TEST DEVICES ĐỀU ĐẠT"
