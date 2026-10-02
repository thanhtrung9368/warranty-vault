#!/usr/bin/env bash
# Parity test for POST /api/v1/auth/change-password against the Go service.
# Mirrors website/scripts/test-change-password.mjs (12 assertions).
#
# Chạy qua runner: ./scripts/e2e.sh [--only change_password]
# Dọn dẹp: xoá user test (cascade) qua dbtool — không cần psql.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
# shellcheck source=lib.sh
. "${SCRIPT_DIR}/lib.sh"

wv_init "${API_DIR}"

TEST_EMAIL="__gopwtest__@local.test"
ORIGINAL_PW="original-pw-12345"
NEW_PW="new-pw-67890"

post_json() {
  local path="$1" body="$2" extra_header="${3:-}"
  if [ -n "$extra_header" ]; then
    wv_curl_status -X POST "${BASE}${path}" \
      -H 'content-type: application/json' \
      -H "${extra_header}" \
      -d "${body}"
  else
    wv_curl_status -X POST "${BASE}${path}" \
      -H 'content-type: application/json' \
      -d "${body}"
  fi
}

wv_require_server

echo "→ Dọn dữ liệu test cũ"
wv_cleanup_user "${TEST_EMAIL}"
trap 'wv_cleanup_user "${TEST_EMAIL}"' EXIT

echo "→ Seed user test (qua /api/v1/auth/register)"
status=$(post_json /api/v1/auth/register \
  "{\"email\":\"${TEST_EMAIL}\",\"password\":\"${ORIGINAL_PW}\",\"name\":\"PW Test\"}")
[ "$status" = "201" ] || {
  echo "register thất bại: status=$status body=$(cat "$WV_BODY_FILE")" >&2
  exit 1
}
echo "  OK    đã seed user"

echo
echo "→ Đăng nhập bằng mật khẩu gốc"
status=$(post_json /api/v1/auth/login \
  "{\"email\":\"${TEST_EMAIL}\",\"password\":\"${ORIGINAL_PW}\",\"platform\":\"web\"}")
[ "$status" = "200" ] && cond=true || cond=false
assert "$cond" "login trả 200 (nhận $status)"
TOKEN=$(jq -r '.accessToken' "$WV_BODY_FILE")
[ -n "$TOKEN" ] && [ "$TOKEN" != "null" ] && cond=true || cond=false
assert "$cond" "response có accessToken"

echo
echo "→ Sai currentPassword → 400 + fieldErrors"
status=$(post_json /api/v1/auth/change-password \
  "{\"currentPassword\":\"definitely-wrong\",\"newPassword\":\"${NEW_PW}\",\"confirmPassword\":\"${NEW_PW}\"}" \
  "authorization: Bearer ${TOKEN}")
[ "$status" = "400" ] && cond=true || cond=false
assert "$cond" "sai mật khẩu hiện tại trả 400 (nhận $status)"
err_code=$(jq -r '.error' "$WV_BODY_FILE")
[ "$err_code" = "bad_input" ] && cond=true || cond=false
assert "$cond" "error code = bad_input"
field_present=$(jq -r '.fieldErrors.currentPassword | type' "$WV_BODY_FILE")
[ "$field_present" = "array" ] && cond=true || cond=false
assert "$cond" "có fieldErrors.currentPassword"

echo
echo "→ confirmPassword không khớp → 400 + fieldErrors.confirmPassword"
status=$(post_json /api/v1/auth/change-password \
  "{\"currentPassword\":\"${ORIGINAL_PW}\",\"newPassword\":\"${NEW_PW}\",\"confirmPassword\":\"something-else-12345\"}" \
  "authorization: Bearer ${TOKEN}")
[ "$status" = "400" ] && cond=true || cond=false
assert "$cond" "confirm không khớp trả 400 (nhận $status)"
field_present=$(jq -r '.fieldErrors.confirmPassword | type' "$WV_BODY_FILE")
[ "$field_present" = "array" ] && cond=true || cond=false
assert "$cond" "có fieldErrors.confirmPassword"

echo
echo "→ Happy path: đổi sang NEW_PW"
status=$(post_json /api/v1/auth/change-password \
  "{\"currentPassword\":\"${ORIGINAL_PW}\",\"newPassword\":\"${NEW_PW}\",\"confirmPassword\":\"${NEW_PW}\"}" \
  "authorization: Bearer ${TOKEN}")
[ "$status" = "200" ] && cond=true || cond=false
assert "$cond" "happy path trả 200 (nhận $status)"
ok=$(jq -r '.ok' "$WV_BODY_FILE")
[ "$ok" = "true" ] && cond=true || cond=false
assert "$cond" "response.ok === true"

echo
echo "→ Mật khẩu cũ không còn dùng được"
status=$(post_json /api/v1/auth/login \
  "{\"email\":\"${TEST_EMAIL}\",\"password\":\"${ORIGINAL_PW}\"}")
[ "$status" = "401" ] && cond=true || cond=false
assert "$cond" "login bằng mật khẩu cũ trả 401 (nhận $status)"

echo
echo "→ Mật khẩu mới dùng được"
status=$(post_json /api/v1/auth/login \
  "{\"email\":\"${TEST_EMAIL}\",\"password\":\"${NEW_PW}\"}")
[ "$status" = "200" ] && cond=true || cond=false
assert "$cond" "login bằng mật khẩu mới trả 200 (nhận $status)"

echo
echo "→ Request không auth → 401"
status=$(post_json /api/v1/auth/change-password \
  "{\"currentPassword\":\"${NEW_PW}\",\"newPassword\":\"whatever-12345\",\"confirmPassword\":\"whatever-12345\"}")
[ "$status" = "401" ] && cond=true || cond=false
assert "$cond" "không auth trả 401 (nhận $status)"

echo
echo "→ Dọn dẹp"
wv_cleanup_user "${TEST_EMAIL}"

wv_summary "TOÀN BỘ TEST CHANGE-PASSWORD ĐỀU ĐẠT"
