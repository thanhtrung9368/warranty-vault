#!/usr/bin/env bash
# Smoke test for /v1/push/* against the Go service. Verifies the contract
# (register → list → delete) without actually delivering a push (real APNs/FCM
# delivery requires a phone). Cleans up via cascade-delete of the scoped test
# user.

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
TEST_EMAIL="__gopushtest__@local.test"
PW="push-flow-pw-12345"

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
  curl -s -o /tmp/wv_push_body.json -w "%{http_code}" "$@"
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
echo "→ Register test user"
status=$(curl_status -X POST "${BASE}/v1/auth/register" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"${TEST_EMAIL}\",\"password\":\"${PW}\",\"name\":\"Push Test\"}")
[ "$status" = "201" ] && cond=true || cond=false
assert "$cond" "register returns 201 (got $status)"
TOKEN=$(jq -r '.accessToken' /tmp/wv_push_body.json)
[ -n "$TOKEN" ] && [ "$TOKEN" != "null" ] && cond=true || cond=false
assert "$cond" "got accessToken"

echo
echo "→ List subscriptions (initially empty)"
status=$(curl_status -X GET "${BASE}/v1/push" \
  -H "authorization: Bearer ${TOKEN}")
[ "$status" = "200" ] && cond=true || cond=false
assert "$cond" "GET /v1/push returns 200 (got $status)"
count=$(jq -r '.subscriptions | length' /tmp/wv_push_body.json)
[ "$count" = "0" ] && cond=true || cond=false
assert "$cond" "subscriptions list initially empty (got count=$count)"

echo
echo "→ Register a fake web push subscription"
WEB_ENDPOINT="https://fcm.googleapis.com/wp/fake-test-endpoint-$(date +%s)"
status=$(curl_status -X POST "${BASE}/v1/push/register" \
  -H "authorization: Bearer ${TOKEN}" \
  -H 'content-type: application/json' \
  -d "{\"platform\":\"web\",\"endpoint\":\"${WEB_ENDPOINT}\",\"p256dh\":\"BFakeP256dhKey0123456789\",\"auth\":\"FakeAuthSecret123\",\"userAgent\":\"test-agent\"}")
[ "$status" = "201" ] && cond=true || cond=false
assert "$cond" "POST /v1/push/register web returns 201 (got $status)"

echo
echo "→ Re-register same endpoint (upsert idempotent)"
status=$(curl_status -X POST "${BASE}/v1/push/register" \
  -H "authorization: Bearer ${TOKEN}" \
  -H 'content-type: application/json' \
  -d "{\"platform\":\"web\",\"endpoint\":\"${WEB_ENDPOINT}\",\"p256dh\":\"BFakeP256dhKeyUPDATED\",\"auth\":\"FakeAuthSecretUPDATED\"}")
[ "$status" = "201" ] && cond=true || cond=false
assert "$cond" "re-register idempotent (got $status)"

echo
echo "→ Register a fake APNs subscription"
status=$(curl_status -X POST "${BASE}/v1/push/register" \
  -H "authorization: Bearer ${TOKEN}" \
  -H 'content-type: application/json' \
  -d '{"platform":"apns","token":"abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"}')
[ "$status" = "201" ] && cond=true || cond=false
assert "$cond" "POST apns subscription returns 201 (got $status)"

echo
echo "→ Register a fake FCM subscription"
status=$(curl_status -X POST "${BASE}/v1/push/register" \
  -H "authorization: Bearer ${TOKEN}" \
  -H 'content-type: application/json' \
  -d '{"platform":"fcm","token":"fcm-test-registration-token-1234567890"}')
[ "$status" = "201" ] && cond=true || cond=false
assert "$cond" "POST fcm subscription returns 201 (got $status)"

echo
echo "→ Validation: bad platform rejected"
status=$(curl_status -X POST "${BASE}/v1/push/register" \
  -H "authorization: Bearer ${TOKEN}" \
  -H 'content-type: application/json' \
  -d '{"platform":"smoke-signal","endpoint":"x"}')
[ "$status" = "400" ] && cond=true || cond=false
assert "$cond" "bad platform returns 400 (got $status)"

echo
echo "→ Validation: web push missing crypto rejected"
status=$(curl_status -X POST "${BASE}/v1/push/register" \
  -H "authorization: Bearer ${TOKEN}" \
  -H 'content-type: application/json' \
  -d '{"platform":"web","endpoint":"https://example.com/x"}')
[ "$status" = "400" ] && cond=true || cond=false
assert "$cond" "web missing p256dh+auth returns 400 (got $status)"

echo
echo "→ List subscriptions (now 3 rows)"
status=$(curl_status -X GET "${BASE}/v1/push" \
  -H "authorization: Bearer ${TOKEN}")
[ "$status" = "200" ] && cond=true || cond=false
assert "$cond" "GET /v1/push returns 200"
count=$(jq -r '.subscriptions | length' /tmp/wv_push_body.json)
[ "$count" = "3" ] && cond=true || cond=false
assert "$cond" "list has 3 subscriptions (got $count)"

# Pick the apns row to delete by id
APNS_ID=$(jq -r '.subscriptions[] | select(.platform=="apns") | .id' /tmp/wv_push_body.json | head -n1)
[ -n "$APNS_ID" ] && [ "$APNS_ID" != "null" ] && cond=true || cond=false
assert "$cond" "found apns row id"

echo
echo "→ DELETE /v1/push/{id}"
status=$(curl_status -X DELETE "${BASE}/v1/push/${APNS_ID}" \
  -H "authorization: Bearer ${TOKEN}")
[ "$status" = "200" ] && cond=true || cond=false
assert "$cond" "DELETE returns 200 (got $status)"

echo
echo "→ List again (now 2)"
status=$(curl_status -X GET "${BASE}/v1/push" \
  -H "authorization: Bearer ${TOKEN}")
count=$(jq -r '.subscriptions | length' /tmp/wv_push_body.json)
[ "$count" = "2" ] && cond=true || cond=false
assert "$cond" "list has 2 after delete (got $count)"

echo
echo "→ DELETE non-existent id returns 404"
status=$(curl_status -X DELETE "${BASE}/v1/push/clxNotARealId" \
  -H "authorization: Bearer ${TOKEN}")
[ "$status" = "404" ] && cond=true || cond=false
assert "$cond" "delete missing id returns 404 (got $status)"

echo
echo "→ Auth required"
status=$(curl_status -X GET "${BASE}/v1/push")
[ "$status" = "401" ] && cond=true || cond=false
assert "$cond" "GET without bearer returns 401 (got $status)"

echo
echo "→ Cleanup"
cleanup

echo
echo "Pass: $PASS  Fail: $FAIL"
[ "$FAIL" = "0" ] || exit 1
echo "ALL PUSH FLOW TESTS PASSED"
