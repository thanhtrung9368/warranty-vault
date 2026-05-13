#!/usr/bin/env bash
# Smoke test for GET /v1/reminders. Asserts:
#   - 401 without auth
#   - 200 + array shape with auth
#   - scoped to the calling user (a fresh user sees no reminders even if
#     other users have warranties)
#   - 400 on invalid `withinDays` query param
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
TEST_EMAIL="__goremtest__@local.test"
PW="rem-test-pw-12345"

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
  -d "{\"email\":\"${TEST_EMAIL}\",\"password\":\"${PW}\",\"name\":\"Reminders Test\"}")
[ "$status" = "201" ] && cond=true || cond=false
assert "$cond" "register returns 201 (got $status)"
TOKEN=$(jq -r '.accessToken' /tmp/wv_body.json)
H_AUTH="authorization: Bearer ${TOKEN}"

echo
echo "→ Unauthenticated GET /v1/reminders → 401"
status=$(curl_status -X GET "${BASE}/v1/reminders")
[ "$status" = "401" ] && cond=true || cond=false
assert "$cond" "no-auth returns 401 (got $status)"

echo
echo "→ Authed GET /v1/reminders"
status=$(curl_status -X GET "${BASE}/v1/reminders" -H "$H_AUTH")
[ "$status" = "200" ] && cond=true || cond=false
assert "$cond" "list reminders returns 200 (got $status)"
KIND=$(jq -r '.reminders | type' /tmp/wv_body.json)
[ "$KIND" = "array" ] && cond=true || cond=false
assert "$cond" ".reminders is an array (got $KIND)"
LEN=$(jq '.reminders | length' /tmp/wv_body.json)
[ "$LEN" = "0" ] && cond=true || cond=false
assert "$cond" "fresh user has 0 reminders (got $LEN) — confirms per-user scope"

echo
echo "→ Custom withinDays=7 still returns 200"
status=$(curl_status -X GET "${BASE}/v1/reminders?withinDays=7" -H "$H_AUTH")
[ "$status" = "200" ] && cond=true || cond=false
assert "$cond" "withinDays=7 returns 200 (got $status)"

echo
echo "→ Invalid withinDays=0 → 400"
status=$(curl_status -X GET "${BASE}/v1/reminders?withinDays=0" -H "$H_AUTH")
[ "$status" = "400" ] && cond=true || cond=false
assert "$cond" "withinDays=0 returns 400 (got $status)"

echo
echo "→ Invalid withinDays=abc → 400"
status=$(curl_status -X GET "${BASE}/v1/reminders?withinDays=abc" -H "$H_AUTH")
[ "$status" = "400" ] && cond=true || cond=false
assert "$cond" "withinDays=abc returns 400 (got $status)"

echo
echo "Pass: $PASS  Fail: $FAIL"
[ "$FAIL" = "0" ] || exit 1
echo "ALL REMINDERS TESTS PASSED"
