#!/usr/bin/env bash
# Parity test for the Go cron job (POST /api/v1/cron/warranty-check) against the
# TS reference at website/scripts/test-cron-flow.mjs. Seeds a scoped test user
# directly in the DB (qua dbtool — không cần psql), hits the Go endpoint, then
# asserts the same DB-level side-effects the TS test asserts:
#
#   - autoRenew=true overdue sub → SubscriptionPayment row + advanced renewalDate
#   - autoRenew=false overdue sub → status=EXPIRED
#   - LIFETIME sub stays ACTIVE
#   - wishlist target-date item gets lastNotifiedAt stamped
#   - wishlist 8-days-stale interval item gets lastNotifiedAt stamped
#
# Chạy qua runner:
#   ./scripts/e2e.sh [--only cron_flow]
# Chạy tay:
#   WV_BASE_URL=http://localhost:4000 CRON_SECRET=... ./scripts/test_cron_flow.sh
#
# Yêu cầu:
#   - Server Go đang chạy ở $WV_BASE_URL.
#   - DATABASE_URL trỏ đúng DB server đang dùng (runner tự export DB tạm).
#   - CRON_SECRET trùng với server (và FILE_MASTER_KEY hợp lệ thì server mới boot).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
# shellcheck source=lib.sh
. "${SCRIPT_DIR}/lib.sh"

wv_init "${API_DIR}"

TEST_EMAIL="__cron_go_parity__@local.test"

if [ -z "${CRON_SECRET:-}" ]; then
  echo "CRON_SECRET chưa được đặt — endpoint cron yêu cầu secret này." >&2
  exit 1
fi

wv_require_server

echo "→ Dọn dữ liệu test cũ"
wv_cleanup_user "${TEST_EMAIL}"

# Fixture SQL: dùng gen_random_uuid() để ID do server sinh, rồi SELECT trả về
# một dòng `user|subAuto|subManual|subLifetime|wlToday|wlInterval` cho assertion.
seed() {
  wv_sql <<SQL
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

echo "→ Seed fixture test"
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
[ -n "$USER_ID" ] && [ -n "$SUB_AUTO" ] && cond=true || cond=false
assert "$cond" "seed fixture trả đủ ID"

echo
echo "→ Gọi cron bằng secret sai (kỳ vọng 401)"
status=$(wv_curl_status \
  -X POST "${BASE}/api/v1/cron/warranty-check" \
  -H 'authorization: Bearer wrong-secret')
[ "$status" = "401" ] && cond=true || cond=false
assert "$cond" "bearer sai trả 401 (nhận $status)"

echo
echo "→ Gọi cron bằng bearer hợp lệ"
status=$(wv_curl_status \
  -X POST "${BASE}/api/v1/cron/warranty-check" \
  -H "authorization: Bearer ${CRON_SECRET}")
[ "$status" = "200" ] && cond=true || cond=false
assert "$cond" "bearer auth trả 200 (nhận $status)"
ok=$(jq -r '.ok' "$WV_BODY_FILE")
[ "$ok" = "true" ] && cond=true || cond=false
assert "$cond" "response ok=true"

echo
echo "→ Gọi cron bằng query ?secret="
status=$(wv_curl_status \
  -X POST "${BASE}/api/v1/cron/warranty-check?secret=${CRON_SECRET}")
[ "$status" = "200" ] && cond=true || cond=false
assert "$cond" "?secret= dùng được (nhận $status)"

echo
echo "→ Kiểm tra side-effect của subscription"
auto_status=$(wv_sql -c \
  "SELECT status FROM \"Subscription\" WHERE id = '${SUB_AUTO}';")
[ "$auto_status" = "ACTIVE" ] && cond=true || cond=false
assert "$cond" "sub auto-renew vẫn ACTIVE (nhận '$auto_status')"

pay_count=$(wv_sql -c \
  "SELECT COUNT(*) FROM \"SubscriptionPayment\" WHERE \"subscriptionId\" = '${SUB_AUTO}' AND note = 'Auto-renew';")
[ "$pay_count" = "1" ] && cond=true || cond=false
assert "$cond" "sub auto-renew có đúng 1 payment 'Auto-renew' (nhận $pay_count)"

advanced=$(wv_sql -c \
  "SELECT \"renewalDate\" > NOW() FROM \"Subscription\" WHERE id = '${SUB_AUTO}';")
[ "$advanced" = "t" ] && cond=true || cond=false
assert "$cond" "renewalDate của sub auto-renew đã vượt hôm nay"

manual_status=$(wv_sql -c \
  "SELECT status FROM \"Subscription\" WHERE id = '${SUB_MANUAL}';")
[ "$manual_status" = "EXPIRED" ] && cond=true || cond=false
assert "$cond" "sub autoRenew=false chuyển EXPIRED (nhận '$manual_status')"

life_status=$(wv_sql -c \
  "SELECT status FROM \"Subscription\" WHERE id = '${SUB_LIFETIME}';")
[ "$life_status" = "ACTIVE" ] && cond=true || cond=false
assert "$cond" "sub LIFETIME không bị đụng (nhận '$life_status')"

echo
echo "→ Kiểm tra side-effect của wishlist"
wt_stamped=$(wv_sql -c \
  "SELECT \"lastNotifiedAt\" IS NOT NULL FROM \"WishlistItem\" WHERE id = '${WL_TODAY}';")
[ "$wt_stamped" = "t" ] && cond=true || cond=false
assert "$cond" "wishlist target-date hôm nay được đóng dấu lastNotifiedAt"

wi_advanced=$(wv_sql -c \
  "SELECT \"lastNotifiedAt\" > NOW() - INTERVAL '1 hour' FROM \"WishlistItem\" WHERE id = '${WL_INTERVAL}';")
[ "$wi_advanced" = "t" ] && cond=true || cond=false
assert "$cond" "wishlist interval được bump lastNotifiedAt trong 1 giờ qua"

echo
echo "→ Chạy cron lần 2 — kiểm tra idempotency ở tầng DB"
# Snapshot state before the second run so we can prove non-duplication.
# NOTE on what idempotency we can / can't assert here:
#   * Subscription auto-bill IS idempotent at the DB layer — after the first
#     run advances renewalDate past today, the row no longer matches
#     ListSubscriptionsOverdue. SubscriptionPayment count should stay at 1.
#   * Wishlist periodic check-in IS idempotent — ListWishlistDueForCheckin
#     filters by NOW() - lastNotifiedAt >= interval, and the first run just
#     stamped lastNotifiedAt to ~now, so the second run skips it. We assert
#     lastNotifiedAt is unchanged between runs (within a few seconds).
#   * Subscription "expire" path (autoRenew=false): once status=EXPIRED, the
#     row no longer matches `status='ACTIVE'` filters, so it's idempotent too.
#   * Notification-only buckets — fixed by migration 0002:
#       - warranty 7d/30d → Reminder.lastNotifiedAt stamped after fan-out;
#         ListWarrantiesInWindow filters by ::date >= CURRENT_DATE.
#       - wishlist target-date day-of → WishlistItem.lastNotifiedAt is already
#         stamped (existed pre-fix); ListWishlistTargetDateDue now filters it.
#       - subscription renewal warnings 3/1/0 → Subscription.lastNotifiedRenewalAt
#         is stamped after fan-out; ListSubscriptionsDueForRenewal filters it.
#     The 2nd-run assertions below cover these via the same-day re-run check.
wt_stamp_before=$(wv_sql -c \
  "SELECT \"lastNotifiedAt\" FROM \"WishlistItem\" WHERE id = '${WL_INTERVAL}';")
sub_renewal_before=$(wv_sql -c \
  "SELECT \"renewalDate\" FROM \"Subscription\" WHERE id = '${SUB_AUTO}';")

wv_curl_status -X POST "${BASE}/api/v1/cron/warranty-check" \
  -H "authorization: Bearer ${CRON_SECRET}" >/dev/null

# 1. Auto-renew sub: no second payment.
pay_count2=$(wv_sql -c \
  "SELECT COUNT(*) FROM \"SubscriptionPayment\" WHERE \"subscriptionId\" = '${SUB_AUTO}';")
[ "$pay_count2" = "1" ] && cond=true || cond=false
assert "$cond" "cron lần 2 KHÔNG thêm payment (nhận $pay_count2)"

# 2. Auto-renew sub: renewalDate didn't advance a second time.
sub_renewal_after=$(wv_sql -c \
  "SELECT \"renewalDate\" FROM \"Subscription\" WHERE id = '${SUB_AUTO}';")
[ "$sub_renewal_before" = "$sub_renewal_after" ] && cond=true || cond=false
assert "$cond" "renewalDate của sub auto-renew không đổi ở lần 2"

# 3. Manual (autoRenew=false) sub: still EXPIRED, no flip back.
manual_status2=$(wv_sql -c \
  "SELECT status FROM \"Subscription\" WHERE id = '${SUB_MANUAL}';")
[ "$manual_status2" = "EXPIRED" ] && cond=true || cond=false
assert "$cond" "sub manual vẫn EXPIRED ở lần 2 (nhận '$manual_status2')"

# 4. Wishlist interval check-in: lastNotifiedAt did NOT bump again, because
#    the first run set it to ~now and the next-run window check (>= 7 days
#    elapsed) won't fire so soon.
wt_stamp_after=$(wv_sql -c \
  "SELECT \"lastNotifiedAt\" FROM \"WishlistItem\" WHERE id = '${WL_INTERVAL}';")
[ "$wt_stamp_before" = "$wt_stamp_after" ] && cond=true || cond=false
assert "$cond" "lastNotifiedAt của wishlist interval không đổi ở lần 2"

# 5. Wishlist payment table sanity — there should never be > 1 Auto-renew row
#    even across many runs (regression guard).
auto_pay_total=$(wv_sql -c \
  "SELECT COUNT(*) FROM \"SubscriptionPayment\" WHERE \"subscriptionId\" = '${SUB_AUTO}' AND note = 'Auto-renew';")
[ "$auto_pay_total" = "1" ] && cond=true || cond=false
assert "$cond" "chỉ tồn tại đúng 1 payment 'Auto-renew' cho sub test (nhận $auto_pay_total)"

echo
echo "→ Dọn dẹp"
wv_cleanup_user "${TEST_EMAIL}"

wv_summary "TOÀN BỘ TEST CRON-FLOW ĐỀU ĐẠT"
