#!/usr/bin/env bash
# Smoke test for GET /api/v1/reminders. Asserts:
#   - 401 without auth
#   - 200 + array shape with auth
#   - scoped to the calling user (a fresh user sees no reminders even if
#     other users have warranties)
#   - 400 on invalid `withinDays` query param
#
# Chạy qua runner: ./scripts/e2e.sh [--only reminders]
# Dọn dẹp: xoá user test (cascade) qua dbtool — không cần psql.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
# shellcheck source=lib.sh
. "${SCRIPT_DIR}/lib.sh"

wv_init "${API_DIR}"

TEST_EMAIL="__goremtest__@local.test"
PW="rem-test-pw-12345"

wv_require_server

echo "→ Dọn dữ liệu test cũ"
wv_cleanup_user "${TEST_EMAIL}"
trap 'wv_cleanup_user "${TEST_EMAIL}"' EXIT

echo "→ Đăng ký"
wv_register "${TEST_EMAIL}" "${PW}" "Reminders Test"
[ "$WV_STATUS" = "201" ] && cond=true || cond=false
assert "$cond" "register trả 201 (nhận $WV_STATUS)"
TOKEN="$WV_TOKEN"
H_AUTH="authorization: Bearer ${TOKEN}"

echo
echo "→ GET /api/v1/reminders không auth → 401"
status=$(wv_curl_status -X GET "${BASE}/api/v1/reminders")
[ "$status" = "401" ] && cond=true || cond=false
assert "$cond" "không auth trả 401 (nhận $status)"

echo
echo "→ GET /api/v1/reminders có auth"
status=$(wv_curl_status -X GET "${BASE}/api/v1/reminders" -H "$H_AUTH")
[ "$status" = "200" ] && cond=true || cond=false
assert "$cond" "list reminders trả 200 (nhận $status)"
KIND=$(jq -r '.reminders | type' "$WV_BODY_FILE")
[ "$KIND" = "array" ] && cond=true || cond=false
assert "$cond" ".reminders là array (nhận $KIND)"
LEN=$(jq '.reminders | length' "$WV_BODY_FILE")
[ "$LEN" = "0" ] && cond=true || cond=false
assert "$cond" "user mới có 0 reminder (nhận $LEN) — xác nhận scope theo user"

echo
echo "→ withinDays=7 tuỳ chỉnh vẫn trả 200"
status=$(wv_curl_status -X GET "${BASE}/api/v1/reminders?withinDays=7" -H "$H_AUTH")
[ "$status" = "200" ] && cond=true || cond=false
assert "$cond" "withinDays=7 trả 200 (nhận $status)"

echo
echo "→ withinDays=0 không hợp lệ → 400"
status=$(wv_curl_status -X GET "${BASE}/api/v1/reminders?withinDays=0" -H "$H_AUTH")
[ "$status" = "400" ] && cond=true || cond=false
assert "$cond" "withinDays=0 trả 400 (nhận $status)"

echo
echo "→ withinDays=abc không hợp lệ → 400"
status=$(wv_curl_status -X GET "${BASE}/api/v1/reminders?withinDays=abc" -H "$H_AUTH")
[ "$status" = "400" ] && cond=true || cond=false
assert "$cond" "withinDays=abc trả 400 (nhận $status)"

wv_summary "TOÀN BỘ TEST REMINDERS ĐỀU ĐẠT"
