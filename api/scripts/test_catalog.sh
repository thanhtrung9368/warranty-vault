#!/usr/bin/env bash
# Smoke test for GET /api/v1/catalog. Verifies the bundle has all four arrays,
# auth-gated.
#
# Chạy qua runner: ./scripts/e2e.sh [--only catalog]
# Dọn dẹp: xoá user test (cascade) qua dbtool — không cần psql.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
# shellcheck source=lib.sh
. "${SCRIPT_DIR}/lib.sh"

wv_init "${API_DIR}"

TEST_EMAIL="__gocataltest__@local.test"
PW="catalog-test-pw-12345"

wv_require_server

echo "→ Dọn dữ liệu test cũ"
wv_cleanup_user "${TEST_EMAIL}"
trap 'wv_cleanup_user "${TEST_EMAIL}"' EXIT

echo "→ Đăng ký"
wv_register "${TEST_EMAIL}" "${PW}" "Catalog Test"
[ "$WV_STATUS" = "201" ] && cond=true || cond=false
assert "$cond" "register trả 201 (nhận $WV_STATUS)"
TOKEN="$WV_TOKEN"
H_AUTH="authorization: Bearer ${TOKEN}"

echo
echo "→ Catalog yêu cầu auth — không token trả 401"
status=$(wv_curl_status -X GET "${BASE}/api/v1/catalog")
[ "$status" = "401" ] && cond=true || cond=false
assert "$cond" "GET /api/v1/catalog không auth trả 401 (nhận $status)"

echo
echo "→ GET /api/v1/catalog với token hợp lệ"
status=$(wv_curl_status -X GET "${BASE}/api/v1/catalog" -H "$H_AUTH")
[ "$status" = "200" ] && cond=true || cond=false
assert "$cond" "GET /api/v1/catalog trả 200 (nhận $status)"

for key in categories brands stores warrantyProviders; do
  KIND=$(jq -r ".$key | type" "$WV_BODY_FILE")
  [ "$KIND" = "array" ] && cond=true || cond=false
  assert "$cond" "key '$key' là array (nhận $KIND)"
done

# Ít nhất categories phải có dữ liệu (migration 0004 seed PHONE/LAPTOP/…)
CCOUNT=$(jq '.categories | length' "$WV_BODY_FILE")
[ "$CCOUNT" -gt 0 ] && cond=true || cond=false
assert "$cond" "categories không rỗng (nhận $CCOUNT phần tử)"

# Kiểm tra shape của một category: code + name là string
HAS_CODE=$(jq -r '.categories[0].code' "$WV_BODY_FILE")
HAS_NAME=$(jq -r '.categories[0].name' "$WV_BODY_FILE")
[ "$HAS_CODE" != "null" ] && [ "$HAS_NAME" != "null" ] && cond=true || cond=false
assert "$cond" "categories[0] có code + name (code=$HAS_CODE)"

wv_summary "TOÀN BỘ TEST CATALOG ĐỀU ĐẠT"
