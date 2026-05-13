#!/usr/bin/env bash
# End-to-end auth flow against the Go service:
#   register → login → me → wrong-password → logout → 401-after-logout.
#
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
TEST_EMAIL="__goauthtest__@local.test"
PW="auth-flow-pw-12345"

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
    echo "  FAIL  $msg"
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
echo "  OK    server is up"

echo "→ Cleanup any prior test data"
cleanup

echo
echo "→ Register"
status=$(curl_status -X POST "${BASE}/v1/auth/register" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"${TEST_EMAIL}\",\"password\":\"${PW}\",\"name\":\"Auth Test\"}")
[ "$status" = "201" ] && cond=true || cond=false
assert "$cond" "register returns 201 (got $status)"
TOKEN=$(jq -r '.accessToken' /tmp/wv_body.json)
[ -n "$TOKEN" ] && [ "$TOKEN" != "null" ] && cond=true || cond=false
assert "$cond" "register returned accessToken"
USER_ID=$(jq -r '.user.id' /tmp/wv_body.json)
[ -n "$USER_ID" ] && [ "$USER_ID" != "null" ] && cond=true || cond=false
assert "$cond" "register returned user.id"

echo
echo "→ /v1/auth/me with token"
status=$(curl_status -X GET "${BASE}/v1/auth/me" \
  -H "authorization: Bearer ${TOKEN}")
[ "$status" = "200" ] && cond=true || cond=false
assert "$cond" "me returns 200"
me_email=$(jq -r '.user.email' /tmp/wv_body.json)
[ "$me_email" = "${TEST_EMAIL}" ] && cond=true || cond=false
assert "$cond" "me returns correct email"

echo
echo "→ Login with correct password"
status=$(curl_status -X POST "${BASE}/v1/auth/login" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"${TEST_EMAIL}\",\"password\":\"${PW}\"}")
[ "$status" = "200" ] && cond=true || cond=false
assert "$cond" "login returns 200 (got $status)"
TOKEN2=$(jq -r '.accessToken' /tmp/wv_body.json)
[ -n "$TOKEN2" ] && [ "$TOKEN2" != "null" ] && [ "$TOKEN2" != "$TOKEN" ] && cond=true || cond=false
assert "$cond" "login returned a fresh accessToken"

echo
echo "→ Login with wrong password"
status=$(curl_status -X POST "${BASE}/v1/auth/login" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"${TEST_EMAIL}\",\"password\":\"definitely-wrong-pw\"}")
[ "$status" = "401" ] && cond=true || cond=false
assert "$cond" "wrong password returns 401 (got $status)"
err=$(jq -r '.error' /tmp/wv_body.json)
[ "$err" = "invalid_credentials" ] && cond=true || cond=false
assert "$cond" "error = invalid_credentials"

echo
echo "→ Login validation: bad email"
status=$(curl_status -X POST "${BASE}/v1/auth/login" \
  -H 'content-type: application/json' \
  -d '{"email":"not-an-email","password":"any-pass"}')
[ "$status" = "400" ] && cond=true || cond=false
assert "$cond" "invalid email returns 400 (got $status)"

echo
echo "→ Logout"
status=$(curl_status -X POST "${BASE}/v1/auth/logout" \
  -H "authorization: Bearer ${TOKEN}")
[ "$status" = "200" ] && cond=true || cond=false
assert "$cond" "logout returns 200 (got $status)"

echo
echo "→ /v1/auth/me after logout (revoked token)"
status=$(curl_status -X GET "${BASE}/v1/auth/me" \
  -H "authorization: Bearer ${TOKEN}")
[ "$status" = "401" ] && cond=true || cond=false
assert "$cond" "revoked token returns 401 (got $status)"

echo
echo "→ /v1/auth/me with second (non-revoked) token"
status=$(curl_status -X GET "${BASE}/v1/auth/me" \
  -H "authorization: Bearer ${TOKEN2}")
[ "$status" = "200" ] && cond=true || cond=false
assert "$cond" "second token still works (got $status)"

echo
echo "→ Forgot password (always 200, no enumeration)"
status=$(curl_status -X POST "${BASE}/v1/auth/forgot" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"${TEST_EMAIL}\"}")
[ "$status" = "200" ] && cond=true || cond=false
assert "$cond" "forgot returns 200 for known email"
status=$(curl_status -X POST "${BASE}/v1/auth/forgot" \
  -H 'content-type: application/json' \
  -d '{"email":"unknown-noone@local.test"}')
[ "$status" = "200" ] && cond=true || cond=false
assert "$cond" "forgot returns 200 for unknown email"

echo
echo "→ Cleanup"
cleanup

echo
echo "Pass: $PASS  Fail: $FAIL"
[ "$FAIL" = "0" ] || exit 1
echo "ALL AUTH FLOW TESTS PASSED"
