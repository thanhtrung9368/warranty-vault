#!/usr/bin/env bash
# Parity test for /v1/wishlist against the Go service.
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
TEST_EMAIL="__gowishtest__@local.test"
PW="wish-test-pw-12345"

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
  -d "{\"email\":\"${TEST_EMAIL}\",\"password\":\"${PW}\",\"name\":\"Wish Test\"}")
[ "$status" = "201" ] && cond=true || cond=false
assert "$cond" "register returns 201 (got $status)"
TOKEN=$(jq -r '.accessToken' /tmp/wv_body.json)
H_AUTH="authorization: Bearer ${TOKEN}"

echo
echo "→ Create wishlist (WATCHING, with initialPrice → seeds price history)"
status=$(curl_status -X POST "${BASE}/v1/wishlist" \
  -H "$H_AUTH" -H 'content-type: application/json' \
  -d '{
    "name":"MacBook Pro 16 M5",
    "category":"LAPTOP",
    "brand":"Apple",
    "initialPrice":80000000,
    "priority":"WANT",
    "status":"WATCHING"
  }')
[ "$status" = "201" ] && cond=true || cond=false
assert "$cond" "create wishlist returns 201 (got $status)"
ITEM_ID=$(jq -r '.item.id' /tmp/wv_body.json)
[ -n "$ITEM_ID" ] && [ "$ITEM_ID" != "null" ] && cond=true || cond=false
assert "$cond" "item.id present"

echo
echo "→ List wishlist"
status=$(curl_status -X GET "${BASE}/v1/wishlist" -H "$H_AUTH")
[ "$status" = "200" ] && cond=true || cond=false
assert "$cond" "list returns 200 (got $status)"
COUNT=$(jq '.items | length' /tmp/wv_body.json)
[ "$COUNT" = "1" ] && cond=true || cond=false
assert "$cond" "list returns 1 item (got $COUNT)"

echo
echo "→ Update currentPrice → assert price history grew"
status=$(curl_status -X PATCH "${BASE}/v1/wishlist/${ITEM_ID}" \
  -H "$H_AUTH" -H 'content-type: application/json' \
  -d '{
    "name":"MacBook Pro 16 M5",
    "category":"LAPTOP",
    "brand":"Apple",
    "initialPrice":80000000,
    "currentPrice":75000000,
    "priority":"WANT",
    "status":"WATCHING"
  }')
[ "$status" = "200" ] && cond=true || cond=false
assert "$cond" "update returns 200 (got $status)"

# Verify via GET detail
status=$(curl_status -X GET "${BASE}/v1/wishlist/${ITEM_ID}" -H "$H_AUTH")
PCOUNT=$(jq '.prices | length' /tmp/wv_body.json)
# Initial create with initialPrice seeds 1 row, then PATCH appends another → 2
[ "$PCOUNT" = "2" ] && cond=true || cond=false
assert "$cond" "price history has 2 rows after price update (got $PCOUNT)"
CURRENT=$(jq -r '.item.currentPrice' /tmp/wv_body.json)
[ "$CURRENT" = "75000000" ] && cond=true || cond=false
assert "$cond" "currentPrice = 75000000 (got $CURRENT)"

echo
echo "→ Mark PURCHASED → assert purchasedDeviceId set + new Device created"
status=$(curl_status -X PATCH "${BASE}/v1/wishlist/${ITEM_ID}" \
  -H "$H_AUTH" -H 'content-type: application/json' \
  -d '{
    "name":"MacBook Pro 16 M5",
    "category":"LAPTOP",
    "brand":"Apple",
    "currentPrice":75000000,
    "priority":"WANT",
    "status":"PURCHASED"
  }')
[ "$status" = "200" ] && cond=true || cond=false
assert "$cond" "mark PURCHASED returns 200 (got $status)"
PURCHASED_DID=$(jq -r '.item.purchasedDeviceId' /tmp/wv_body.json)
[ -n "$PURCHASED_DID" ] && [ "$PURCHASED_DID" != "null" ] && cond=true || cond=false
assert "$cond" "purchasedDeviceId set (got $PURCHASED_DID)"

# Verify the device exists
status=$(curl_status -X GET "${BASE}/v1/devices/${PURCHASED_DID}" -H "$H_AUTH")
[ "$status" = "200" ] && cond=true || cond=false
assert "$cond" "spawned device fetchable (got $status)"
DNAME=$(jq -r '.device.name' /tmp/wv_body.json)
[ "$DNAME" = "MacBook Pro 16 M5" ] && cond=true || cond=false
assert "$cond" "spawned device has correct name (got $DNAME)"

echo
echo "→ Delete wishlist item"
status=$(curl_status -X DELETE "${BASE}/v1/wishlist/${ITEM_ID}" -H "$H_AUTH")
[ "$status" = "200" ] && cond=true || cond=false
assert "$cond" "delete returns 200 (got $status)"

echo
echo "→ GET deleted → 404"
status=$(curl_status -X GET "${BASE}/v1/wishlist/${ITEM_ID}" -H "$H_AUTH")
[ "$status" = "404" ] && cond=true || cond=false
assert "$cond" "GET deleted returns 404 (got $status)"

echo
echo "Pass: $PASS  Fail: $FAIL"
[ "$FAIL" = "0" ] || exit 1
echo "ALL WISHLIST FLOW TESTS PASSED"
