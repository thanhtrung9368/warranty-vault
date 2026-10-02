#!/usr/bin/env bash
# Parity test for /api/v1/subscriptions against the Go service.
#
# Chạy qua runner: ./scripts/e2e.sh [--only subscriptions]
# Dọn dẹp: xoá user test (cascade) qua dbtool — không cần psql.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
# shellcheck source=lib.sh
. "${SCRIPT_DIR}/lib.sh"

wv_init "${API_DIR}"

TEST_EMAIL="__gosubstest__@local.test"
PW="sub-test-pw-12345"

wv_require_server

echo "→ Dọn dữ liệu test cũ"
wv_cleanup_user "${TEST_EMAIL}"
trap 'wv_cleanup_user "${TEST_EMAIL}"' EXIT

echo "→ Đăng ký"
wv_register "${TEST_EMAIL}" "${PW}" "Sub Test"
[ "$WV_STATUS" = "201" ] && cond=true || cond=false
assert "$cond" "register trả 201 (nhận $WV_STATUS)"
TOKEN="$WV_TOKEN"
H_AUTH="authorization: Bearer ${TOKEN}"

echo
echo "→ Tạo subscription MONTHLY (100000 VND)"
status=$(wv_curl_status -X POST "${BASE}/api/v1/subscriptions" \
  -H "$H_AUTH" -H 'content-type: application/json' \
  -d '{
    "name":"ChatGPT Plus",
    "billingCycle":"MONTHLY",
    "price":100000,
    "startedAt":"2026-04-01",
    "renewalDate":"2026-05-01",
    "autoRenew":true,
    "status":"ACTIVE"
  }')
[ "$status" = "201" ] && cond=true || cond=false
assert "$cond" "tạo subscription trả 201 (nhận $status)"
SUB_ID=$(jq -r '.subscription.id' "$WV_BODY_FILE")
[ -n "$SUB_ID" ] && [ "$SUB_ID" != "null" ] && cond=true || cond=false
assert "$cond" "có subscription.id"
PRICE=$(jq -r '.subscription.price' "$WV_BODY_FILE")
[ "$PRICE" = "100000" ] && cond=true || cond=false
assert "$cond" "price = 100000 (nhận $PRICE)"

echo
echo "→ Liệt kê subscription"
status=$(wv_curl_status -X GET "${BASE}/api/v1/subscriptions" -H "$H_AUTH")
[ "$status" = "200" ] && cond=true || cond=false
assert "$cond" "list trả 200 (nhận $status)"
COUNT=$(jq '.subscriptions | length' "$WV_BODY_FILE")
[ "$COUNT" = "1" ] && cond=true || cond=false
assert "$cond" "danh sách đúng 1 subscription (nhận $COUNT)"

echo
echo "→ Chi tiết subscription (payments=[] ban đầu)"
status=$(wv_curl_status -X GET "${BASE}/api/v1/subscriptions/${SUB_ID}" -H "$H_AUTH")
[ "$status" = "200" ] && cond=true || cond=false
assert "$cond" "get detail trả 200 (nhận $status)"
PCOUNT=$(jq '.subscription.payments | length' "$WV_BODY_FILE")
[ "$PCOUNT" = "0" ] && cond=true || cond=false
assert "$cond" "payments rỗng ban đầu (nhận $PCOUNT)"

echo
echo "→ Ghi nhận thanh toán thủ công"
status=$(wv_curl_status -X POST "${BASE}/api/v1/subscriptions/${SUB_ID}/payments" \
  -H "$H_AUTH" -H 'content-type: application/json' \
  -d '{"amount":100000,"paidAt":"2026-04-01","note":"Manual log"}')
[ "$status" = "201" ] && cond=true || cond=false
assert "$cond" "log payment trả 201 (nhận $status)"

echo
echo "→ Gia hạn subscription → payments=2 + renewalDate tiến lên"
ORIG_RENEWAL=$(wv_curl -s -H "$H_AUTH" "${BASE}/api/v1/subscriptions/${SUB_ID}" | jq -r '.subscription.renewalDate')
status=$(wv_curl_status -X POST "${BASE}/api/v1/subscriptions/${SUB_ID}/renew" -H "$H_AUTH")
[ "$status" = "200" ] && cond=true || cond=false
assert "$cond" "renew trả 200 (nhận $status)"
NEW_RENEWAL=$(jq -r '.subscription.renewalDate' "$WV_BODY_FILE")
[ "$NEW_RENEWAL" != "$ORIG_RENEWAL" ] && [ "$NEW_RENEWAL" != "null" ] && cond=true || cond=false
assert "$cond" "renewalDate đã tiến ($ORIG_RENEWAL → $NEW_RENEWAL)"
# Lấy detail để đếm payments
status=$(wv_curl_status -X GET "${BASE}/api/v1/subscriptions/${SUB_ID}" -H "$H_AUTH")
PCOUNT=$(jq '.subscription.payments | length' "$WV_BODY_FILE")
[ "$PCOUNT" = "2" ] && cond=true || cond=false
assert "$cond" "payments nay = 2 (nhận $PCOUNT)"

echo
echo "→ Cập nhật giá (PATCH)"
status=$(wv_curl_status -X PATCH "${BASE}/api/v1/subscriptions/${SUB_ID}" \
  -H "$H_AUTH" -H 'content-type: application/json' \
  -d '{
    "name":"ChatGPT Plus",
    "billingCycle":"MONTHLY",
    "price":150000,
    "startedAt":"2026-04-01",
    "autoRenew":true,
    "status":"ACTIVE"
  }')
[ "$status" = "200" ] && cond=true || cond=false
assert "$cond" "update giá trả 200 (nhận $status)"
NEW_PRICE=$(jq -r '.subscription.price' "$WV_BODY_FILE")
[ "$NEW_PRICE" = "150000" ] && cond=true || cond=false
assert "$cond" "giá đã đổi thành 150000 (nhận $NEW_PRICE)"

echo
echo "→ Xoá subscription"
status=$(wv_curl_status -X DELETE "${BASE}/api/v1/subscriptions/${SUB_ID}" -H "$H_AUTH")
[ "$status" = "200" ] && cond=true || cond=false
assert "$cond" "xoá trả 200 (nhận $status)"

echo
echo "→ GET subscription đã xoá → 404"
status=$(wv_curl_status -X GET "${BASE}/api/v1/subscriptions/${SUB_ID}" -H "$H_AUTH")
[ "$status" = "404" ] && cond=true || cond=false
assert "$cond" "GET subscription đã xoá trả 404 (nhận $status)"

wv_summary "TOÀN BỘ TEST SUBSCRIPTIONS ĐỀU ĐẠT"
