#!/usr/bin/env bash
# Parity test for the Go cron job (POST /v1/cron/warranty-check) against the
# TS reference at website/scripts/test-cron-flow.mjs. Seeds a scoped test user
# directly in the dev DB, hits the Go endpoint, then asserts the same DB-level
# side-effects the TS test asserts:
#
#   - autoRenew=true overdue sub → SubscriptionPayment row + advanced renewalDate
#   - autoRenew=false overdue sub → status=EXPIRED
#   - LIFETIME sub stays ACTIVE
#   - wishlist target-date item gets lastNotifiedAt stamped
#   - wishlist 8-days-stale interval item gets lastNotifiedAt stamped
#
# Usage:
#   WV_BASE_URL=http://localhost:4000 ./scripts/test_cron_flow.sh
#
# Requires:
#   - The Go server running locally (go run ./cmd/server) on $WV_BASE_URL.
#   - DATABASE_URL pointing at warranty_vault_dev (or any DB the server uses).
#   - CRON_SECRET set in the same env the server is using.
#   - psql + curl + jq.

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
TEST_EMAIL="__cron_go_parity__@local.test"

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL not set." >&2
  exit 1
fi
if [ -z "${CRON_SECRET:-}" ]; then
  echo "CRON_SECRET not set — the server endpoint requires it." >&2
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

ping_server() {
  curl -sf -m 3 "${BASE}/healthz" -o /dev/null
}

cleanup() {
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -tAc \
    "DELETE FROM \"User\" WHERE email = '${TEST_EMAIL}';" >/dev/null
}

# Compose the SQL fixture inline. Uses gen_random_uuid() so the user/device/
# warranty/wishlist IDs are server-side; we read them back via SELECT to feed
# the assertions.
seed() {
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -tA <<SQL
DELETE FROM "User" WHERE email = '${TEST_EMAIL}';

WITH
  u AS (
    INSERT INTO "User" (id, email, "passwordHash", "updatedAt")
    VALUES (gen_random_uuid()::text, '${TEST_EMAIL}', 'x', NOW())
    RETURNING id
  ),
  -- 1) Auto-renew sub overdue by 1 day (MONTHLY 480k)
  sa AS (
    INSERT INTO "Subscription"
      (id, "userId", name, "billingCycle", price, currency,
       "startedAt", "renewalDate", "autoRenew", status, "createdAt", "updatedAt")
    VALUES (gen_random_uuid()::text, (SELECT id FROM u),
            'ChatGPT Plus', 'MONTHLY', 480000, 'VND',
            NOW() - INTERVAL '31 days', NOW() - INTERVAL '1 day',
            true, 'ACTIVE', NOW(), NOW())
    RETURNING id
  ),
  -- 2) Manual sub overdue by 1 day (YEARLY 1.2M, autoRenew=false)
  sm AS (
    INSERT INTO "Subscription"
      (id, "userId", name, "billingCycle", price, currency,
       "startedAt", "renewalDate", "autoRenew", status, "createdAt", "updatedAt")
    VALUES (gen_random_uuid()::text, (SELECT id FROM u),
            'Old Hosting Plan', 'YEARLY', 1200000, 'VND',
            NOW() - INTERVAL '365 days', NOW() - INTERVAL '1 day',
            false, 'ACTIVE', NOW(), NOW())
    RETURNING id
  ),
  -- 3) LIFETIME sub overdue by 1 day (must NOT be touched)
  sl AS (
    INSERT INTO "Subscription"
      (id, "userId", name, "billingCycle", price, currency,
       "startedAt", "renewalDate", "autoRenew", status, "createdAt", "updatedAt")
    VALUES (gen_random_uuid()::text, (SELECT id FROM u),
            'Lifetime Deal', 'LIFETIME', 5000000, 'VND',
            NOW() - INTERVAL '365 days', NOW() - INTERVAL '1 day',
            true, 'ACTIVE', NOW(), NOW())
    RETURNING id
  ),
  -- 4) Wishlist item with targetDate at noon today UTC
  wt AS (
    INSERT INTO "WishlistItem"
      (id, "userId", name, "currentPrice", "targetDate",
       priority, status, "createdAt", "updatedAt")
    VALUES (gen_random_uuid()::text, (SELECT id FROM u),
            'Sony WH-1000XM6', 8500000,
            date_trunc('day', NOW()) + INTERVAL '12 hours',
            'WANT', 'WATCHING', NOW(), NOW())
    RETURNING id
  ),
  -- 5) Wishlist item with reminderIntervalDays=7 + lastNotifiedAt 8d ago
  wi AS (
    INSERT INTO "WishlistItem"
      (id, "userId", name, "currentPrice", "reminderIntervalDays", "lastNotifiedAt",
       priority, status, "createdAt", "updatedAt")
    VALUES (gen_random_uuid()::text, (SELECT id FROM u),
            'iPad mini 7', 14500000, 7, NOW() - INTERVAL '8 days',
            'MAYBE', 'WATCHING', NOW(), NOW())
    RETURNING id
  )
SELECT
  (SELECT id FROM u)  || '|' ||
  (SELECT id FROM sa) || '|' ||
  (SELECT id FROM sm) || '|' ||
  (SELECT id FROM sl) || '|' ||
  (SELECT id FROM wt) || '|' ||
  (SELECT id FROM wi);
SQL
}

echo "→ Server check: ${BASE}"
ping_server || { echo "Server not reachable. Start \`go run ./cmd/server\` first." >&2; exit 1; }
echo "  OK    server is up"

echo "→ Cleanup any prior test data"
cleanup

echo "→ Seed test fixtures"
ids=$(seed | tail -1)
USER_ID=$(echo "$ids" | cut -d'|' -f1)
SUB_AUTO=$(echo "$ids" | cut -d'|' -f2)
SUB_MANUAL=$(echo "$ids" | cut -d'|' -f3)
SUB_LIFETIME=$(echo "$ids" | cut -d'|' -f4)
WL_TODAY=$(echo "$ids" | cut -d'|' -f5)
WL_INTERVAL=$(echo "$ids" | cut -d'|' -f6)
echo "  user=${USER_ID}"
echo "  subAuto=${SUB_AUTO} subManual=${SUB_MANUAL} subLifetime=${SUB_LIFETIME}"
echo "  wlToday=${WL_TODAY} wlInterval=${WL_INTERVAL}"

echo
echo "→ Hit cron endpoint with bad secret (expect 401)"
status=$(curl -s -o /tmp/wv_cron.json -w "%{http_code}" \
  -X POST "${BASE}/v1/cron/warranty-check" \
  -H 'authorization: Bearer wrong-secret')
[ "$status" = "401" ] && cond=true || cond=false
assert "$cond" "bad bearer returns 401 (got $status)"

echo
echo "→ Hit cron endpoint with valid bearer"
status=$(curl -s -o /tmp/wv_cron.json -w "%{http_code}" \
  -X POST "${BASE}/v1/cron/warranty-check" \
  -H "authorization: Bearer ${CRON_SECRET}")
[ "$status" = "200" ] && cond=true || cond=false
assert "$cond" "bearer auth returns 200 (got $status)"
ok=$(jq -r '.ok' /tmp/wv_cron.json)
[ "$ok" = "true" ] && cond=true || cond=false
assert "$cond" "response ok=true"

echo
echo "→ Hit cron endpoint with ?secret= query string"
status=$(curl -s -o /tmp/wv_cron.json -w "%{http_code}" \
  -X POST "${BASE}/v1/cron/warranty-check?secret=${CRON_SECRET}")
[ "$status" = "200" ] && cond=true || cond=false
assert "$cond" "?secret= works (got $status)"

echo
echo "→ Verify subscription side-effects"
auto_status=$(psql "$DATABASE_URL" -tAc \
  "SELECT status FROM \"Subscription\" WHERE id = '${SUB_AUTO}';")
[ "$auto_status" = "ACTIVE" ] && cond=true || cond=false
assert "$cond" "auto-renew sub still ACTIVE (got '$auto_status')"

pay_count=$(psql "$DATABASE_URL" -tAc \
  "SELECT COUNT(*) FROM \"SubscriptionPayment\" WHERE \"subscriptionId\" = '${SUB_AUTO}' AND note = 'Auto-renew';")
[ "$pay_count" = "1" ] && cond=true || cond=false
assert "$cond" "auto-renew sub has 1 'Auto-renew' payment (got $pay_count)"

advanced=$(psql "$DATABASE_URL" -tAc \
  "SELECT \"renewalDate\" > NOW() FROM \"Subscription\" WHERE id = '${SUB_AUTO}';")
[ "$advanced" = "t" ] && cond=true || cond=false
assert "$cond" "auto-renew sub renewalDate advanced past today"

manual_status=$(psql "$DATABASE_URL" -tAc \
  "SELECT status FROM \"Subscription\" WHERE id = '${SUB_MANUAL}';")
[ "$manual_status" = "EXPIRED" ] && cond=true || cond=false
assert "$cond" "manual (autoRenew=false) sub flipped to EXPIRED (got '$manual_status')"

life_status=$(psql "$DATABASE_URL" -tAc \
  "SELECT status FROM \"Subscription\" WHERE id = '${SUB_LIFETIME}';")
[ "$life_status" = "ACTIVE" ] && cond=true || cond=false
assert "$cond" "LIFETIME sub untouched (got '$life_status')"

echo
echo "→ Verify wishlist side-effects"
wt_stamped=$(psql "$DATABASE_URL" -tAc \
  "SELECT \"lastNotifiedAt\" IS NOT NULL FROM \"WishlistItem\" WHERE id = '${WL_TODAY}';")
[ "$wt_stamped" = "t" ] && cond=true || cond=false
assert "$cond" "wishlist today-bucket item got lastNotifiedAt stamped"

wi_advanced=$(psql "$DATABASE_URL" -tAc \
  "SELECT \"lastNotifiedAt\" > NOW() - INTERVAL '1 hour' FROM \"WishlistItem\" WHERE id = '${WL_INTERVAL}';")
[ "$wi_advanced" = "t" ] && cond=true || cond=false
assert "$cond" "wishlist interval item lastNotifiedAt bumped within last hour"

echo
echo "→ Re-run cron (idempotent within window)"
curl -s -o /tmp/wv_cron2.json -w "%{http_code}" \
  -X POST "${BASE}/v1/cron/warranty-check" \
  -H "authorization: Bearer ${CRON_SECRET}" >/dev/null
# After advancing once, the auto-renew sub should now be in the future and
# NOT trigger a second payment.
pay_count2=$(psql "$DATABASE_URL" -tAc \
  "SELECT COUNT(*) FROM \"SubscriptionPayment\" WHERE \"subscriptionId\" = '${SUB_AUTO}';")
[ "$pay_count2" = "1" ] && cond=true || cond=false
assert "$cond" "second cron run does NOT add another payment (got $pay_count2)"

echo
echo "→ Cleanup"
cleanup

echo
echo "Pass: $PASS  Fail: $FAIL"
[ "$FAIL" = "0" ] || exit 1
echo "ALL CRON-FLOW PARITY TESTS PASSED"
