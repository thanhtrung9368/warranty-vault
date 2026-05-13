#!/usr/bin/env bash
# Parity test for GET /v1/stats. Ports website/scripts/test-stats.mjs to
# bash + psql seeding + curl + jq. Cleans up via cascade delete.

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
TEST_EMAIL="__gostatstest__@local.test"
PW="stats-test-pw-12345"

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

echo "→ Register (sets up scoped user)"
status=$(curl_status -X POST "${BASE}/v1/auth/register" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"${TEST_EMAIL}\",\"password\":\"${PW}\",\"name\":\"Stats Test\"}")
[ "$status" = "201" ] && cond=true || cond=false
assert "$cond" "register returns 201 (got $status)"
TOKEN=$(jq -r '.accessToken' /tmp/wv_body.json)
USER_ID=$(jq -r '.user.id' /tmp/wv_body.json)
H_AUTH="authorization: Bearer ${TOKEN}"

echo
echo "→ Seed fixtures via psql (matching website/scripts/test-stats.mjs)"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q <<SQL
INSERT INTO "Device" (id, "userId", name, category, "purchaseDate", "purchasePrice", status, "createdAt", "updatedAt")
VALUES
  ('stats_dev_1', '$USER_ID', 'MBP M4',    'LAPTOP', '2025-06-01', 30000000, 'ACTIVE', now(), now()),
  ('stats_dev_2', '$USER_ID', 'iPhone 16', 'PHONE',  '2025-09-15', 20000000, 'ACTIVE', now(), now()),
  ('stats_dev_3', '$USER_ID', 'Old iPad',  'TABLET', '2022-01-01', 10000000, 'SOLD',   now(), now());

INSERT INTO "Subscription" (id, "userId", name, "billingCycle", price, currency, "startedAt", "renewalDate", "autoRenew", status, "createdAt", "updatedAt")
VALUES
  ('stats_sub_1', '$USER_ID', 'ChatGPT Plus', 'MONTHLY',  480000,  'VND', '2026-01-01', '2026-06-01', true,  'ACTIVE', now(), now()),
  ('stats_sub_2', '$USER_ID', 'Hosting',      'YEARLY',   1200000, 'VND', '2026-01-01', '2027-01-01', true,  'ACTIVE', now(), now()),
  ('stats_sub_3', '$USER_ID', 'Lifetime Tool','LIFETIME', 5000000, 'VND', '2025-01-01', '2125-01-01', false, 'ACTIVE', now(), now()),
  ('stats_sub_4', '$USER_ID', 'Paused Spotify','MONTHLY', 59000,   'VND', '2025-01-01', '2026-06-01', true,  'PAUSED', now(), now());

INSERT INTO "WishlistItem" (id, "userId", name, "currentPrice", status, priority, "createdAt", "updatedAt")
VALUES
  ('stats_wish_1', '$USER_ID', 'Sony WH-1000XM6', 8500000,  'WATCHING',  'WANT',  now(), now()),
  ('stats_wish_2', '$USER_ID', 'iPad mini 7',     14500000, 'WATCHING',  'MAYBE', now(), now()),
  ('stats_wish_3', '$USER_ID', 'New iMac',        25000000, 'DECIDED',   'MUST',  now(), now()),
  ('stats_wish_4', '$USER_ID', 'AirPods Max',     12000000, 'SKIPPED',   'MAYBE', now(), now());
SQL
echo "  OK    fixtures seeded"

echo
echo "→ Unauthenticated GET /v1/stats → 401"
status=$(curl_status -X GET "${BASE}/v1/stats")
[ "$status" = "401" ] && cond=true || cond=false
assert "$cond" "no-auth returns 401 (got $status)"

echo
echo "→ Authed GET /v1/stats"
status=$(curl_status -X GET "${BASE}/v1/stats" -H "$H_AUTH")
[ "$status" = "200" ] && cond=true || cond=false
assert "$cond" "GET /v1/stats returns 200 (got $status)"

echo
echo "→ Devices totals"
V=$(jq '.devices.total' /tmp/wv_body.json);              [ "$V" = "3" ]            && cond=true || cond=false; assert "$cond" "devices.total = 3 (got $V)"
V=$(jq '.devices.byStatus.ACTIVE' /tmp/wv_body.json);    [ "$V" = "2" ]            && cond=true || cond=false; assert "$cond" "devices.byStatus.ACTIVE = 2 (got $V)"
V=$(jq '.devices.byStatus.SOLD' /tmp/wv_body.json);      [ "$V" = "1" ]            && cond=true || cond=false; assert "$cond" "devices.byStatus.SOLD = 1 (got $V)"
V=$(jq '.devices.byStatus.EXPIRED' /tmp/wv_body.json);   [ "$V" = "0" ]            && cond=true || cond=false; assert "$cond" "devices.byStatus.EXPIRED = 0 (got $V)"
V=$(jq '.devices.totalPurchasePrice' /tmp/wv_body.json); [ "$V" = "60000000" ]     && cond=true || cond=false; assert "$cond" "devices.totalPurchasePrice = 60M (got $V)"

echo
echo "→ Subscriptions totals"
V=$(jq '.subscriptions.total' /tmp/wv_body.json);              [ "$V" = "4" ]      && cond=true || cond=false; assert "$cond" "subscriptions.total = 4 (got $V)"
V=$(jq '.subscriptions.byStatus.ACTIVE' /tmp/wv_body.json);    [ "$V" = "3" ]      && cond=true || cond=false; assert "$cond" "subscriptions.byStatus.ACTIVE = 3 (got $V)"
V=$(jq '.subscriptions.byStatus.PAUSED' /tmp/wv_body.json);    [ "$V" = "1" ]      && cond=true || cond=false; assert "$cond" "subscriptions.byStatus.PAUSED = 1 (got $V)"
V=$(jq '.subscriptions.totalMonthlyVnd' /tmp/wv_body.json);    [ "$V" = "580000" ] && cond=true || cond=false; assert "$cond" "subscriptions.totalMonthlyVnd = 580k (got $V)"

echo
echo "→ Wishlist totals"
V=$(jq '.wishlist.total' /tmp/wv_body.json);                       [ "$V" = "4" ]        && cond=true || cond=false; assert "$cond" "wishlist.total = 4 (got $V)"
V=$(jq '.wishlist.byStatus.WATCHING' /tmp/wv_body.json);           [ "$V" = "2" ]        && cond=true || cond=false; assert "$cond" "wishlist.byStatus.WATCHING = 2 (got $V)"
V=$(jq '.wishlist.byStatus.DECIDED' /tmp/wv_body.json);            [ "$V" = "1" ]        && cond=true || cond=false; assert "$cond" "wishlist.byStatus.DECIDED = 1 (got $V)"
V=$(jq '.wishlist.byStatus.SKIPPED' /tmp/wv_body.json);            [ "$V" = "1" ]        && cond=true || cond=false; assert "$cond" "wishlist.byStatus.SKIPPED = 1 (got $V)"
V=$(jq '.wishlist.byStatus.PURCHASED' /tmp/wv_body.json);          [ "$V" = "0" ]        && cond=true || cond=false; assert "$cond" "wishlist.byStatus.PURCHASED = 0 (got $V)"
V=$(jq '.wishlist.totalCurrentPriceWatching' /tmp/wv_body.json);   [ "$V" = "48000000" ] && cond=true || cond=false; assert "$cond" "wishlist.totalCurrentPriceWatching = 48M (got $V)"

echo
echo "Pass: $PASS  Fail: $FAIL"
[ "$FAIL" = "0" ] || exit 1
echo "ALL STATS TESTS PASSED"
