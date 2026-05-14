#!/usr/bin/env bash
# Parity test for POST /api/v1/auth/change-password against the Go service.
# Mirrors website/scripts/test-change-password.mjs (12 assertions).
#
# Requires:
#   - bash, curl, jq, psql
#   - Running Go server (default http://localhost:4000; override WV_BASE_URL)
#   - DATABASE_URL pointing at the dev DB (loaded from api/.env if present)
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
TEST_EMAIL="__gopwtest__@local.test"
ORIGINAL_PW="original-pw-12345"
NEW_PW="new-pw-67890"

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

ping_server() {
  curl -sf -m 3 "${BASE}/healthz" -o /dev/null
}

post_json() {
  local path="$1" body="$2" extra_header="${3:-}"
  if [ -n "$extra_header" ]; then
    curl -s -o /tmp/wv_body.json -w "%{http_code}" \
      -X POST "${BASE}${path}" \
      -H 'content-type: application/json' \
      -H "${extra_header}" \
      -d "${body}"
  else
    curl -s -o /tmp/wv_body.json -w "%{http_code}" \
      -X POST "${BASE}${path}" \
      -H 'content-type: application/json' \
      -d "${body}"
  fi
}

echo "→ Server check: ${BASE}"
if ! ping_server; then
  echo "Server not reachable at ${BASE}. Start with \`go run ./cmd/server\` first." >&2
  exit 1
fi
echo "  OK    server is up"

echo "→ Cleanup any prior test data"
cleanup

echo "→ Seed test user (via /api/v1/auth/register)"
status=$(post_json /api/v1/auth/register \
  "{\"email\":\"${TEST_EMAIL}\",\"password\":\"${ORIGINAL_PW}\",\"name\":\"PW Test\"}")
[ "$status" = "201" ] || { echo "register failed: status=$status body=$(cat /tmp/wv_body.json)" >&2; exit 1; }
echo "  OK    user seeded"

echo
echo "→ Login with original password"
status=$(post_json /api/v1/auth/login \
  "{\"email\":\"${TEST_EMAIL}\",\"password\":\"${ORIGINAL_PW}\",\"platform\":\"web\"}")
[ "$status" = "200" ] && cond=true || cond=false
assert "$cond" "login returns 200 (got $status)"
TOKEN=$(jq -r '.accessToken' /tmp/wv_body.json)
[ -n "$TOKEN" ] && [ "$TOKEN" != "null" ] && cond=true || cond=false
assert "$cond" "response has accessToken"

echo
echo "→ Wrong currentPassword → 400 + fieldErrors"
status=$(post_json /api/v1/auth/change-password \
  "{\"currentPassword\":\"definitely-wrong\",\"newPassword\":\"${NEW_PW}\",\"confirmPassword\":\"${NEW_PW}\"}" \
  "authorization: Bearer ${TOKEN}")
[ "$status" = "400" ] && cond=true || cond=false
assert "$cond" "wrong-current returns 400 (got $status)"
err_code=$(jq -r '.error' /tmp/wv_body.json)
[ "$err_code" = "bad_input" ] && cond=true || cond=false
assert "$cond" "error code = bad_input"
field_present=$(jq -r '.fieldErrors.currentPassword | type' /tmp/wv_body.json)
[ "$field_present" = "array" ] && cond=true || cond=false
assert "$cond" "fieldErrors.currentPassword present"

echo
echo "→ Mismatched confirm → 400 + fieldErrors.confirmPassword"
status=$(post_json /api/v1/auth/change-password \
  "{\"currentPassword\":\"${ORIGINAL_PW}\",\"newPassword\":\"${NEW_PW}\",\"confirmPassword\":\"something-else-12345\"}" \
  "authorization: Bearer ${TOKEN}")
[ "$status" = "400" ] && cond=true || cond=false
assert "$cond" "mismatch returns 400 (got $status)"
field_present=$(jq -r '.fieldErrors.confirmPassword | type' /tmp/wv_body.json)
[ "$field_present" = "array" ] && cond=true || cond=false
assert "$cond" "fieldErrors.confirmPassword present"

echo
echo "→ Happy path: change to NEW_PW"
status=$(post_json /api/v1/auth/change-password \
  "{\"currentPassword\":\"${ORIGINAL_PW}\",\"newPassword\":\"${NEW_PW}\",\"confirmPassword\":\"${NEW_PW}\"}" \
  "authorization: Bearer ${TOKEN}")
[ "$status" = "200" ] && cond=true || cond=false
assert "$cond" "happy path returns 200 (got $status)"
ok=$(jq -r '.ok' /tmp/wv_body.json)
[ "$ok" = "true" ] && cond=true || cond=false
assert "$cond" "response.ok === true"

echo
echo "→ Old password no longer works"
status=$(post_json /api/v1/auth/login \
  "{\"email\":\"${TEST_EMAIL}\",\"password\":\"${ORIGINAL_PW}\"}")
[ "$status" = "401" ] && cond=true || cond=false
assert "$cond" "old password login returns 401 (got $status)"

echo
echo "→ New password works"
status=$(post_json /api/v1/auth/login \
  "{\"email\":\"${TEST_EMAIL}\",\"password\":\"${NEW_PW}\"}")
[ "$status" = "200" ] && cond=true || cond=false
assert "$cond" "new password login returns 200 (got $status)"

echo
echo "→ Unauthenticated request → 401"
status=$(post_json /api/v1/auth/change-password \
  "{\"currentPassword\":\"${NEW_PW}\",\"newPassword\":\"whatever-12345\",\"confirmPassword\":\"whatever-12345\"}")
[ "$status" = "401" ] && cond=true || cond=false
assert "$cond" "unauthenticated returns 401 (got $status)"

echo
echo "→ Cleanup"
cleanup

echo
echo "Pass: $PASS  Fail: $FAIL"
[ "$FAIL" = "0" ] || exit 1
echo "ALL CHANGE-PASSWORD TESTS PASSED"
