#!/usr/bin/env bash
# Parity test for /api/v1/devices + warranties + reminders against the Go service.
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
TEST_EMAIL="__godevicestest__@local.test"
PW="device-test-pw-12345"

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
status=$(curl_status -X POST "${BASE}/api/v1/auth/register" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"${TEST_EMAIL}\",\"password\":\"${PW}\",\"name\":\"Devices Test\"}")
[ "$status" = "201" ] && cond=true || cond=false
assert "$cond" "register returns 201 (got $status)"
TOKEN=$(jq -r '.accessToken' /tmp/wv_body.json)
H_AUTH="authorization: Bearer ${TOKEN}"

echo
echo "→ Create device with inline warranty (warrantyMonths=24)"
status=$(curl_status -X POST "${BASE}/api/v1/devices" \
  -H "$H_AUTH" -H 'content-type: application/json' \
  -d '{
    "name":"iPhone 17 Pro",
    "category":"PHONE",
    "brand":"Apple",
    "purchaseDate":"2026-01-15",
    "purchasePrice":35000000,
    "warrantyMonths":24,
    "warrantyProvider":"Apple Authorized"
  }')
[ "$status" = "201" ] && cond=true || cond=false
assert "$cond" "create device returns 201 (got $status)"
DEVICE_ID=$(jq -r '.device.id' /tmp/wv_body.json)
[ -n "$DEVICE_ID" ] && [ "$DEVICE_ID" != "null" ] && cond=true || cond=false
assert "$cond" "device.id present"

echo
echo "→ List devices"
status=$(curl_status -X GET "${BASE}/api/v1/devices" -H "$H_AUTH")
[ "$status" = "200" ] && cond=true || cond=false
assert "$cond" "list devices returns 200 (got $status)"
COUNT=$(jq '.devices | length' /tmp/wv_body.json)
[ "$COUNT" = "1" ] && cond=true || cond=false
assert "$cond" "list returns exactly 1 device (got $COUNT)"

echo
echo "→ Get device detail (with warranty)"
status=$(curl_status -X GET "${BASE}/api/v1/devices/${DEVICE_ID}" -H "$H_AUTH")
[ "$status" = "200" ] && cond=true || cond=false
assert "$cond" "get device returns 200 (got $status)"
WCOUNT=$(jq '.device.warranties | length' /tmp/wv_body.json)
[ "$WCOUNT" = "1" ] && cond=true || cond=false
assert "$cond" "device has 1 warranty (got $WCOUNT)"
WARRANTY_ID=$(jq -r '.device.warranties[0].id' /tmp/wv_body.json)
WTYPE=$(jq -r '.device.warranties[0].type' /tmp/wv_body.json)
[ "$WTYPE" = "STANDARD" ] && cond=true || cond=false
assert "$cond" "inline warranty is STANDARD type (got $WTYPE)"

echo
echo "→ Update device (rename + change purchasePrice)"
status=$(curl_status -X PATCH "${BASE}/api/v1/devices/${DEVICE_ID}" \
  -H "$H_AUTH" -H 'content-type: application/json' \
  -d '{
    "name":"iPhone 17 Pro Max",
    "category":"PHONE",
    "purchaseDate":"2026-01-15",
    "purchasePrice":40000000,
    "warrantyMonths":24
  }')
[ "$status" = "200" ] && cond=true || cond=false
assert "$cond" "update device returns 200 (got $status)"
NAME=$(jq -r '.device.name' /tmp/wv_body.json)
[ "$NAME" = "iPhone 17 Pro Max" ] && cond=true || cond=false
assert "$cond" "name updated (got $NAME)"

echo
echo "→ Create extra warranty (EXTENDED 12 months)"
status=$(curl_status -X POST "${BASE}/api/v1/devices/${DEVICE_ID}/warranties" \
  -H "$H_AUTH" -H 'content-type: application/json' \
  -d '{
    "type":"EXTENDED",
    "provider":"AppleCare+",
    "startDate":"2026-01-15",
    "months":12,
    "cost":3000000
  }')
[ "$status" = "201" ] && cond=true || cond=false
assert "$cond" "create warranty returns 201 (got $status)"
EXTRA_W_ID=$(jq -r '.warranty.id' /tmp/wv_body.json)

echo
echo "→ Confirm device now has 2 warranties"
status=$(curl_status -X GET "${BASE}/api/v1/devices/${DEVICE_ID}" -H "$H_AUTH")
WCOUNT=$(jq '.device.warranties | length' /tmp/wv_body.json)
[ "$WCOUNT" = "2" ] && cond=true || cond=false
assert "$cond" "device now has 2 warranties (got $WCOUNT)"

echo
echo "→ Dismiss reminder for first warranty"
status=$(curl_status -X POST "${BASE}/api/v1/warranties/${WARRANTY_ID}/reminder" -H "$H_AUTH")
[ "$status" = "200" ] && cond=true || cond=false
assert "$cond" "dismiss reminder returns 200 (got $status)"

echo
echo "→ GET /api/v1/reminders (should be reachable, default 30-day window)"
status=$(curl_status -X GET "${BASE}/api/v1/reminders" -H "$H_AUTH")
[ "$status" = "200" ] && cond=true || cond=false
assert "$cond" "list reminders returns 200 (got $status)"
KIND=$(jq -r '.reminders | type' /tmp/wv_body.json)
[ "$KIND" = "array" ] && cond=true || cond=false
assert "$cond" ".reminders is an array (got $KIND)"

echo
echo "→ Restore reminder"
status=$(curl_status -X DELETE "${BASE}/api/v1/warranties/${WARRANTY_ID}/reminder" -H "$H_AUTH")
[ "$status" = "200" ] && cond=true || cond=false
assert "$cond" "restore reminder returns 200 (got $status)"

echo
echo "→ Delete device"
status=$(curl_status -X DELETE "${BASE}/api/v1/devices/${DEVICE_ID}" -H "$H_AUTH")
[ "$status" = "200" ] && cond=true || cond=false
assert "$cond" "delete device returns 200 (got $status)"

echo
echo "→ GET deleted device → 404"
status=$(curl_status -X GET "${BASE}/api/v1/devices/${DEVICE_ID}" -H "$H_AUTH")
[ "$status" = "404" ] && cond=true || cond=false
assert "$cond" "get deleted device returns 404 (got $status)"

echo
echo "Pass: $PASS  Fail: $FAIL"
[ "$FAIL" = "0" ] || exit 1
echo "ALL DEVICES FLOW TESTS PASSED"
