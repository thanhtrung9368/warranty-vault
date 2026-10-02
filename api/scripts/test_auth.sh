#!/usr/bin/env bash
# End-to-end auth flow against the Go service:
#   register → login → me → wrong-password → logout → 401-after-logout.
#
# Chạy qua runner: ./scripts/e2e.sh [--only auth]
# Dọn dẹp: xoá user test (cascade) qua dbtool — không cần psql.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
# shellcheck source=lib.sh
. "${SCRIPT_DIR}/lib.sh"

wv_init "${API_DIR}"

TEST_EMAIL="__goauthtest__@local.test"
PW="auth-flow-pw-12345"

wv_require_server

echo "→ Dọn dữ liệu test cũ"
wv_cleanup_user "${TEST_EMAIL}"
trap 'wv_cleanup_user "${TEST_EMAIL}"' EXIT

echo
echo "→ Đăng ký"
wv_register "${TEST_EMAIL}" "${PW}" "Auth Test"
[ "$WV_STATUS" = "201" ] && cond=true || cond=false
assert "$cond" "register trả 201 (nhận $WV_STATUS)"
TOKEN="$WV_TOKEN"
[ -n "$TOKEN" ] && cond=true || cond=false
assert "$cond" "register trả accessToken"
USER_ID=$(jq -r '.user.id' "$WV_BODY_FILE")
[ -n "$USER_ID" ] && [ "$USER_ID" != "null" ] && cond=true || cond=false
assert "$cond" "register trả user.id"

echo
echo "→ GET /api/v1/auth/me kèm token"
status=$(wv_curl_status -X GET "${BASE}/api/v1/auth/me" \
  -H "authorization: Bearer ${TOKEN}")
[ "$status" = "200" ] && cond=true || cond=false
assert "$cond" "me trả 200 (nhận $status)"
me_email=$(jq -r '.user.email' "$WV_BODY_FILE")
[ "$me_email" = "${TEST_EMAIL}" ] && cond=true || cond=false
assert "$cond" "me trả đúng email"

echo
echo "→ Đăng nhập bằng mật khẩu đúng"
status=$(wv_curl_status -X POST "${BASE}/api/v1/auth/login" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"${TEST_EMAIL}\",\"password\":\"${PW}\"}")
[ "$status" = "200" ] && cond=true || cond=false
assert "$cond" "login trả 200 (nhận $status)"
TOKEN2=$(jq -r '.accessToken' "$WV_BODY_FILE")
[ -n "$TOKEN2" ] && [ "$TOKEN2" != "null" ] && [ "$TOKEN2" != "$TOKEN" ] && cond=true || cond=false
assert "$cond" "login trả accessToken mới"

echo
echo "→ Đăng nhập sai mật khẩu"
status=$(wv_curl_status -X POST "${BASE}/api/v1/auth/login" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"${TEST_EMAIL}\",\"password\":\"definitely-wrong-pw\"}")
[ "$status" = "401" ] && cond=true || cond=false
assert "$cond" "sai mật khẩu trả 401 (nhận $status)"
err=$(jq -r '.error' "$WV_BODY_FILE")
[ "$err" = "invalid_credentials" ] && cond=true || cond=false
assert "$cond" "error = invalid_credentials"

echo
echo "→ Validate login: email không hợp lệ"
status=$(wv_curl_status -X POST "${BASE}/api/v1/auth/login" \
  -H 'content-type: application/json' \
  -d '{"email":"not-an-email","password":"any-pass"}')
[ "$status" = "400" ] && cond=true || cond=false
assert "$cond" "email không hợp lệ trả 400 (nhận $status)"

echo
echo "→ Đăng xuất"
status=$(wv_curl_status -X POST "${BASE}/api/v1/auth/logout" \
  -H "authorization: Bearer ${TOKEN}")
[ "$status" = "200" ] && cond=true || cond=false
assert "$cond" "logout trả 200 (nhận $status)"

echo
echo "→ GET /api/v1/auth/me sau logout (token đã thu hồi)"
status=$(wv_curl_status -X GET "${BASE}/api/v1/auth/me" \
  -H "authorization: Bearer ${TOKEN}")
[ "$status" = "401" ] && cond=true || cond=false
assert "$cond" "token đã thu hồi trả 401 (nhận $status)"

echo
echo "→ GET /api/v1/auth/me bằng token thứ hai (chưa thu hồi)"
status=$(wv_curl_status -X GET "${BASE}/api/v1/auth/me" \
  -H "authorization: Bearer ${TOKEN2}")
[ "$status" = "200" ] && cond=true || cond=false
assert "$cond" "token thứ hai vẫn dùng được (nhận $status)"

echo
echo "→ Quên mật khẩu (luôn 200, không lộ email tồn tại)"
status=$(wv_curl_status -X POST "${BASE}/api/v1/auth/forgot" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"${TEST_EMAIL}\"}")
[ "$status" = "200" ] && cond=true || cond=false
assert "$cond" "forgot trả 200 với email đã đăng ký"
status=$(wv_curl_status -X POST "${BASE}/api/v1/auth/forgot" \
  -H 'content-type: application/json' \
  -d '{"email":"unknown-noone@local.test"}')
[ "$status" = "200" ] && cond=true || cond=false
assert "$cond" "forgot trả 200 với email không tồn tại"

echo
echo "→ Dọn dẹp"
wv_cleanup_user "${TEST_EMAIL}"

wv_summary "TOÀN BỘ TEST AUTH ĐỀU ĐẠT"
