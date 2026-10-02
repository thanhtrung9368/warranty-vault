#!/usr/bin/env bash
# Smoke test for /api/v1/push/* against the Go service. Verifies the contract
# (register → list → delete) without actually delivering a push (real APNs/FCM
# delivery requires a phone).
#
# Chạy qua runner: ./scripts/e2e.sh [--only push]
# Dọn dẹp: xoá user test (cascade) qua dbtool — không cần psql.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
# shellcheck source=lib.sh
. "${SCRIPT_DIR}/lib.sh"

wv_init "${API_DIR}"

TEST_EMAIL="__gopushtest__@local.test"
PW="push-flow-pw-12345"

wv_require_server

echo "→ Dọn dữ liệu test cũ"
wv_cleanup_user "${TEST_EMAIL}"
trap 'wv_cleanup_user "${TEST_EMAIL}"' EXIT

echo
echo "→ Đăng ký user test"
wv_register "${TEST_EMAIL}" "${PW}" "Push Test"
[ "$WV_STATUS" = "201" ] && cond=true || cond=false
assert "$cond" "register trả 201 (nhận $WV_STATUS)"
TOKEN="$WV_TOKEN"
[ -n "$TOKEN" ] && cond=true || cond=false
assert "$cond" "có accessToken"

echo
echo "→ Liệt kê subscription (ban đầu rỗng)"
status=$(wv_curl_status -X GET "${BASE}/api/v1/push" \
  -H "authorization: Bearer ${TOKEN}")
[ "$status" = "200" ] && cond=true || cond=false
assert "$cond" "GET /api/v1/push trả 200 (nhận $status)"
count=$(jq -r '.subscriptions | length' "$WV_BODY_FILE")
[ "$count" = "0" ] && cond=true || cond=false
assert "$cond" "danh sách ban đầu rỗng (nhận count=$count)"

echo
echo "→ Đăng ký web push giả"
WEB_ENDPOINT="https://fcm.googleapis.com/wp/fake-test-endpoint-$(date +%s)"
status=$(wv_curl_status -X POST "${BASE}/api/v1/push/register" \
  -H "authorization: Bearer ${TOKEN}" \
  -H 'content-type: application/json' \
  -d "{\"platform\":\"web\",\"endpoint\":\"${WEB_ENDPOINT}\",\"p256dh\":\"BFakeP256dhKey0123456789\",\"auth\":\"FakeAuthSecret123\",\"userAgent\":\"test-agent\"}")
[ "$status" = "201" ] && cond=true || cond=false
assert "$cond" "POST /api/v1/push/register web trả 201 (nhận $status)"

echo
echo "→ Đăng ký lại cùng endpoint (upsert idempotent)"
status=$(wv_curl_status -X POST "${BASE}/api/v1/push/register" \
  -H "authorization: Bearer ${TOKEN}" \
  -H 'content-type: application/json' \
  -d "{\"platform\":\"web\",\"endpoint\":\"${WEB_ENDPOINT}\",\"p256dh\":\"BFakeP256dhKeyUPDATED\",\"auth\":\"FakeAuthSecretUPDATED\"}")
[ "$status" = "201" ] && cond=true || cond=false
assert "$cond" "đăng ký lại idempotent (nhận $status)"

echo
echo "→ Đăng ký subscription APNs giả"
status=$(wv_curl_status -X POST "${BASE}/api/v1/push/register" \
  -H "authorization: Bearer ${TOKEN}" \
  -H 'content-type: application/json' \
  -d '{"platform":"apns","token":"abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"}')
[ "$status" = "201" ] && cond=true || cond=false
assert "$cond" "POST apns subscription trả 201 (nhận $status)"

echo
echo "→ Đăng ký subscription FCM giả"
status=$(wv_curl_status -X POST "${BASE}/api/v1/push/register" \
  -H "authorization: Bearer ${TOKEN}" \
  -H 'content-type: application/json' \
  -d '{"platform":"fcm","token":"fcm-test-registration-token-1234567890"}')
[ "$status" = "201" ] && cond=true || cond=false
assert "$cond" "POST fcm subscription trả 201 (nhận $status)"

echo
echo "→ Validate: platform rác bị từ chối"
status=$(wv_curl_status -X POST "${BASE}/api/v1/push/register" \
  -H "authorization: Bearer ${TOKEN}" \
  -H 'content-type: application/json' \
  -d '{"platform":"smoke-signal","endpoint":"x"}')
[ "$status" = "400" ] && cond=true || cond=false
assert "$cond" "platform rác trả 400 (nhận $status)"

echo
echo "→ Validate: web push thiếu crypto bị từ chối"
status=$(wv_curl_status -X POST "${BASE}/api/v1/push/register" \
  -H "authorization: Bearer ${TOKEN}" \
  -H 'content-type: application/json' \
  -d '{"platform":"web","endpoint":"https://example.com/x"}')
[ "$status" = "400" ] && cond=true || cond=false
assert "$cond" "web thiếu p256dh+auth trả 400 (nhận $status)"

echo
echo "→ Liệt kê subscription (nay 3 dòng)"
status=$(wv_curl_status -X GET "${BASE}/api/v1/push" \
  -H "authorization: Bearer ${TOKEN}")
[ "$status" = "200" ] && cond=true || cond=false
assert "$cond" "GET /api/v1/push trả 200"
count=$(jq -r '.subscriptions | length' "$WV_BODY_FILE")
[ "$count" = "3" ] && cond=true || cond=false
assert "$cond" "danh sách có 3 subscription (nhận $count)"

# Chọn dòng apns để xoá theo id
APNS_ID=$(jq -r '.subscriptions[] | select(.platform=="apns") | .id' "$WV_BODY_FILE" | head -n1)
[ -n "$APNS_ID" ] && [ "$APNS_ID" != "null" ] && cond=true || cond=false
assert "$cond" "tìm được id dòng apns"

echo
echo "→ DELETE /api/v1/push/{id}"
status=$(wv_curl_status -X DELETE "${BASE}/api/v1/push/${APNS_ID}" \
  -H "authorization: Bearer ${TOKEN}")
[ "$status" = "200" ] && cond=true || cond=false
assert "$cond" "DELETE trả 200 (nhận $status)"

echo
echo "→ Liệt kê lại (nay 2)"
status=$(wv_curl_status -X GET "${BASE}/api/v1/push" \
  -H "authorization: Bearer ${TOKEN}")
count=$(jq -r '.subscriptions | length' "$WV_BODY_FILE")
[ "$count" = "2" ] && cond=true || cond=false
assert "$cond" "sau khi xoá còn 2 (nhận $count)"

echo
echo "→ DELETE id không tồn tại trả 404"
status=$(wv_curl_status -X DELETE "${BASE}/api/v1/push/clxNotARealId" \
  -H "authorization: Bearer ${TOKEN}")
[ "$status" = "404" ] && cond=true || cond=false
assert "$cond" "xoá id không tồn tại trả 404 (nhận $status)"

echo
echo "→ Bắt buộc auth"
status=$(wv_curl_status -X GET "${BASE}/api/v1/push")
[ "$status" = "401" ] && cond=true || cond=false
assert "$cond" "GET không bearer trả 401 (nhận $status)"

echo
echo "→ Dọn dẹp"
wv_cleanup_user "${TEST_EMAIL}"

wv_summary "TOÀN BỘ TEST PUSH ĐỀU ĐẠT"
