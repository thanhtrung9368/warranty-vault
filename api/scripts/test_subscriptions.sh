#!/usr/bin/env bash
# Parity test for /api/v1/subscriptions against the Go service.
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
TEST_EMAIL="__gosubstest__@local.test"
PW="sub-test-pw-12345"

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
  -d "{\"email\":\"${TEST_EMAIL}\",\"password\":\"${PW}\",\"name\":\"Sub Test\"}")
[ "$status" = "201" ] && cond=true || cond=false
assert "$cond" "register returns 201 (got $status)"
TOKEN=$(jq -r '.accessToken' /tmp/wv_body.json)
H_AUTH="authorization: Bearer ${TOKEN}"

echo
echo "→ Create monthly subscription (100000 VND)"
status=$(curl_status -X POST "${BASE}/api/v1/subscriptions" \
  -H "$H_AUTH" -H 'content-type: application/json' \
  -d '{
    "name":"ChatGPT Plus",
    "billingCycle":"MONTHLY",
    "price":100000,
    "startedAt":"2026-04-01",
    "renewalDate":"2026-05-01",
    "autoRenew":true,
    "status":"ACTIVE"
  }')
[ "$status" = "201" ] && cond=true || cond=false
assert "$cond" "create subscription returns 201 (got $status)"
SUB_ID=$(jq -r '.subscription.id' /tmp/wv_body.json)
[ -n "$SUB_ID" ] && [ "$SUB_ID" != "null" ] && cond=true || cond=false
assert "$cond" "subscription.id present"
PRICE=$(jq -r '.subscription.price' /tmp/wv_body.json)
[ "$PRICE" = "100000" ] && cond=true || cond=false
assert "$cond" "price = 100000 (got $PRICE)"

echo
echo "→ List subscriptions"
status=$(curl_status -X GET "${BASE}/api/v1/subscriptions" -H "$H_AUTH")
[ "$status" = "200" ] && cond=true || cond=false
assert "$cond" "list returns 200 (got $status)"
COUNT=$(jq '.subscriptions | length' /tmp/wv_body.json)
[ "$COUNT" = "1" ] && cond=true || cond=false
assert "$cond" "list returns 1 subscription (got $COUNT)"

echo
echo "→ Get subscription detail (with payments=[])"
status=$(curl_status -X GET "${BASE}/api/v1/subscriptions/${SUB_ID}" -H "$H_AUTH")
[ "$status" = "200" ] && cond=true || cond=false
assert "$cond" "get detail returns 200 (got $status)"
PCOUNT=$(jq '.subscription.payments | length' /tmp/wv_body.json)
[ "$PCOUNT" = "0" ] && cond=true || cond=false
assert "$cond" "payments empty initially (got $PCOUNT)"

echo
echo "→ Log a manual payment"
status=$(curl_status -X POST "${BASE}/api/v1/subscriptions/${SUB_ID}/payments" \
  -H "$H_AUTH" -H 'content-type: application/json' \
  -d '{"amount":100000,"paidAt":"2026-04-01","note":"Manual log"}')
[ "$status" = "201" ] && cond=true || cond=false
assert "$cond" "log payment returns 201 (got $status)"

echo
echo "→ Renew subscription → assert payments=2 + renewalDate advanced"
ORIG_RENEWAL=$(curl -s -H "$H_AUTH" "${BASE}/api/v1/subscriptions/${SUB_ID}" | jq -r '.subscription.renewalDate')
status=$(curl_status -X POST "${BASE}/api/v1/subscriptions/${SUB_ID}/renew" -H "$H_AUTH")
[ "$status" = "200" ] && cond=true || cond=false
assert "$cond" "renew returns 200 (got $status)"
NEW_RENEWAL=$(jq -r '.subscription.renewalDate' /tmp/wv_body.json)
[ "$NEW_RENEWAL" != "$ORIG_RENEWAL" ] && [ "$NEW_RENEWAL" != "null" ] && cond=true || cond=false
assert "$cond" "renewalDate advanced ($ORIG_RENEWAL → $NEW_RENEWAL)"
# Pull detail to count payments
status=$(curl_status -X GET "${BASE}/api/v1/subscriptions/${SUB_ID}" -H "$H_AUTH")
PCOUNT=$(jq '.subscription.payments | length' /tmp/wv_body.json)
[ "$PCOUNT" = "2" ] && cond=true || cond=false
assert "$cond" "payments now == 2 (got $PCOUNT)"

echo
echo "→ Update price (PATCH)"
status=$(curl_status -X PATCH "${BASE}/api/v1/subscriptions/${SUB_ID}" \
  -H "$H_AUTH" -H 'content-type: application/json' \
  -d '{
    "name":"ChatGPT Plus",
    "billingCycle":"MONTHLY",
    "price":150000,
    "startedAt":"2026-04-01",
    "autoRenew":true,
    "status":"ACTIVE"
  }')
[ "$status" = "200" ] && cond=true || cond=false
assert "$cond" "update price returns 200 (got $status)"
NEW_PRICE=$(jq -r '.subscription.price' /tmp/wv_body.json)
[ "$NEW_PRICE" = "150000" ] && cond=true || cond=false
assert "$cond" "price updated to 150000 (got $NEW_PRICE)"

echo
echo "→ Delete subscription"
status=$(curl_status -X DELETE "${BASE}/api/v1/subscriptions/${SUB_ID}" -H "$H_AUTH")
[ "$status" = "200" ] && cond=true || cond=false
assert "$cond" "delete returns 200 (got $status)"

echo
echo "→ GET deleted → 404"
status=$(curl_status -X GET "${BASE}/api/v1/subscriptions/${SUB_ID}" -H "$H_AUTH")
[ "$status" = "404" ] && cond=true || cond=false
assert "$cond" "GET deleted returns 404 (got $status)"

echo
echo "Pass: $PASS  Fail: $FAIL"
[ "$FAIL" = "0" ] || exit 1
echo "ALL SUBSCRIPTIONS FLOW TESTS PASSED"
