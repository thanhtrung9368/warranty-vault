#!/usr/bin/env bash
# Smoke test for GET /v1/catalog. Verifies the bundle has all four arrays,
# auth-gated.
# Cleans up via cascade delete of the scoped test user.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

if [ -f "${API_DIR}/.env" ]; then
  set -o allexport
  # shellcheck disable=SC1090,SC1091
  source "${API_DIR}/.env"
  set +o allexport
fi

BASE="${WV_BASE_URL:-http://localhost:4000}"
TEST_EMAIL="__gocataltest__@local.test"
PW="catalog-test-pw-12345"

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL not set." >&2
  exit 1
fi
for tool in curl jq psql; do
  command -v "$tool" >/dev/null || { echo "missing required tool: $tool" >&2; exit 1; }
done

PASS=0
FAIL=0
assert() {
  local cond="$1" msg="$2"
  if [ "$cond" = "true" ]; then
    echo "  OK    $msg"
    PASS=$((PASS+1))
  else
    echo "  FAIL  $msg  body=$(cat /tmp/wv_body.json 2>/dev/null | head -c 400)"
    FAIL=$((FAIL+1))
  fi
}

cleanup() {
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -tAc \
    "DELETE FROM \"User\" WHERE email = '${TEST_EMAIL}';" >/dev/null
}

curl_status() {
  curl -s -o /tmp/wv_body.json -w "%{http_code}" "$@"
}

ping_server() {
  curl -sf -m 3 "${BASE}/healthz" -o /dev/null
}

echo "→ Server check: ${BASE}"
ping_server || { echo "Server not reachable. Start \`go run ./cmd/server\` first." >&2; exit 1; }

cleanup
trap cleanup EXIT

echo "→ Register"
status=$(curl_status -X POST "${BASE}/v1/auth/register" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"${TEST_EMAIL}\",\"password\":\"${PW}\",\"name\":\"Catalog Test\"}")
[ "$status" = "201" ] && cond=true || cond=false
assert "$cond" "register returns 201 (got $status)"
TOKEN=$(jq -r '.accessToken' /tmp/wv_body.json)
H_AUTH="authorization: Bearer ${TOKEN}"

echo
echo "→ Catalog requires auth — without token returns 401"
status=$(curl_status -X GET "${BASE}/v1/catalog")
[ "$status" = "401" ] && cond=true || cond=false
assert "$cond" "no-auth GET /v1/catalog returns 401 (got $status)"

echo
echo "→ GET /v1/catalog with valid token"
status=$(curl_status -X GET "${BASE}/v1/catalog" -H "$H_AUTH")
[ "$status" = "200" ] && cond=true || cond=false
assert "$cond" "GET /v1/catalog returns 200 (got $status)"

for key in categories brands stores warrantyProviders; do
  KIND=$(jq -r ".$key | type" /tmp/wv_body.json)
  [ "$KIND" = "array" ] && cond=true || cond=false
  assert "$cond" "key '$key' is an array (got $KIND)"
done

# At least categories should be non-empty in dev DB (PHONE/LAPTOP/etc are seeded)
CCOUNT=$(jq '.categories | length' /tmp/wv_body.json)
[ "$CCOUNT" -gt 0 ] && cond=true || cond=false
assert "$cond" "categories non-empty (got $CCOUNT entries)"

# Spot-check a category shape: code + name strings
HAS_CODE=$(jq -r '.categories[0].code' /tmp/wv_body.json)
HAS_NAME=$(jq -r '.categories[0].name' /tmp/wv_body.json)
[ "$HAS_CODE" != "null" ] && [ "$HAS_NAME" != "null" ] && cond=true || cond=false
assert "$cond" "categories[0] has code + name (code=$HAS_CODE)"

echo
echo "Pass: $PASS  Fail: $FAIL"
[ "$FAIL" = "0" ] || exit 1
echo "ALL CATALOG TESTS PASSED"
