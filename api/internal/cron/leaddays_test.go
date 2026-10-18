package cron

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	store "github.com/thanhtrung9368/warranty-vault/api/internal/store/gen"
)

// Reminder lead days (migration 0015), on a real migrated Postgres.
//
// The two properties under test are the ones a unit test cannot fake:
//
//  1. A device with the DEFAULT [30, 7] still fires on the old 7- and 30-day
//     windows. That is the "do not break existing users" promise.
//  2. The idempotency key now includes the lead day. The compressed-clock test
//     below runs the cron twice on the SAME calendar day for the SAME warranty
//     (moving endDate instead of waiting three weeks): with the pre-0015
//     per-warranty-per-day key the second run would be suppressed; with the
//     per-lead-day key it must fire.
//
// `cronScratchDB` creates a brand-new migrated database per test and drops it
// afterwards (see run_test.go). It skips without WV_TEST_DATABASE_URL.

func leadDaysUser(t *testing.T, pool *pgxpool.Pool, locale any) string {
	t.Helper()
	ctx := context.Background()
	userID := uuid.NewString()
	if _, err := pool.Exec(ctx, `
		INSERT INTO "User" (id, email, "passwordHash", "updatedAt", locale)
		VALUES ($1, $2, 'x', NOW(), $3)`, userID, userID+"@cron-leaddays.test", locale); err != nil {
		t.Fatalf("insert user: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO "PushSubscription" (id, "userId", endpoint, p256dh, auth, platform, "createdAt")
		VALUES ($1, $2, $3, 'p', 'a', 'web', NOW())`,
		uuid.NewString(), userID, "https://fake.local/"+userID); err != nil {
		t.Fatalf("insert push sub: %v", err)
	}
	return userID
}

// leadDaysDevice inserts a device. A nil slice deliberately omits the column's
// value via COALESCE so the DATABASE default [30, 7] is exercised, not a
// hard-coded Go copy.
func leadDaysDevice(t *testing.T, pool *pgxpool.Pool, userID, id, name string, leadDays []int32) {
	t.Helper()
	now := time.Now()
	if _, err := pool.Exec(context.Background(), `
		INSERT INTO "Device" (id, "userId", name, category, "purchaseDate", "purchasePrice",
		                      status, "leadDays", "createdAt", "updatedAt")
		VALUES ($1, $2, $3, 'PHONE', $4, 1000000, 'ACTIVE',
		        COALESCE($5::int[], ARRAY[30, 7]), NOW(), NOW())`,
		id, userID, name, now.AddDate(0, 0, -100), leadDays); err != nil {
		t.Fatalf("insert device %s: %v", id, err)
	}
}

func leadDaysWarranty(t *testing.T, pool *pgxpool.Pool, id, deviceID string, endDate time.Time) {
	t.Helper()
	if _, err := pool.Exec(context.Background(), `
		INSERT INTO "Warranty" (id, "deviceId", type, "startDate", "endDate", months, "createdAt", "updatedAt")
		VALUES ($1, $2, 'STANDARD', $3, $4, 12, NOW(), NOW())`,
		id, deviceID, endDate.AddDate(-1, 0, 0), endDate); err != nil {
		t.Fatalf("insert warranty %s: %v", id, err)
	}
}

func leadDaysSubscription(t *testing.T, q *store.Queries, userID, id, name string, renewal time.Time, leadDays []int32) {
	t.Helper()
	if _, err := q.CreateSubscription(context.Background(), store.CreateSubscriptionParams{
		ID:           id,
		UserId:       userID,
		Name:         name,
		BillingCycle: "MONTHLY",
		Price:        100000,
		StartedAt:    pgtype.Timestamp{Time: renewal.AddDate(0, -1, 0), Valid: true},
		RenewalDate:  pgtype.Timestamp{Time: renewal, Valid: true},
		AutoRenew:    true,
		LeadDays:     leadDays,
	}); err != nil {
		t.Fatalf("create subscription %s: %v", id, err)
	}
}

// sendsByTag returns the payloads of the sends whose tag starts with prefix.
func sendsByTag(sends []mockSend, prefix string) map[string]string {
	out := map[string]string{}
	for _, s := range sends {
		if strings.HasPrefix(s.payload.Tag, prefix) {
			out[s.payload.Tag] = s.payload.Title
		}
	}
	return out
}

// ─── Warranty: default [30, 7] still means the old 30/7 windows ─────────────

func TestRunWarrantyLeadDaysDefaultMatchesLegacySchedule(t *testing.T) {
	ctx := context.Background()
	pool := cronScratchDB(t)
	userID := leadDaysUser(t, pool, "vi")

	now := time.Now()
	midnight := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())

	// Neither call passes leadDays: the database default [30, 7] must apply.
	leadDaysDevice(t, pool, userID, "ld_default_7", "Máy 7 ngày", nil)
	leadDaysWarranty(t, pool, "ld_war_7", "ld_default_7", midnight.AddDate(0, 0, 6).Add(12*time.Hour))

	leadDaysDevice(t, pool, userID, "ld_default_30", "Máy 30 ngày", nil)
	leadDaysWarranty(t, pool, "ld_war_30", "ld_default_30", midnight.AddDate(0, 0, 29).Add(12*time.Hour))

	mock := &mockDispatcher{}
	stats, err := Run(ctx, pool, mock)
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if stats.WarrantyNotices != 2 {
		t.Errorf("WarrantyNotices = %d, want 2 (7d + 30d)", stats.WarrantyNotices)
	}

	byTag := sendsByTag(mock.sends, "wv-")
	if _, ok := byTag["wv-7-ld_war_7"]; !ok {
		t.Errorf("no 7-day push; got tags %v", tagsOf(mock.sends))
	}
	if _, ok := byTag["wv-30-ld_war_30"]; !ok {
		t.Errorf("no 30-day push; got tags %v", tagsOf(mock.sends))
	}
	if got := byTag["wv-7-ld_war_7"]; !strings.Contains(got, "7 ngày") {
		t.Errorf("7-day title = %q, want it to mention 7 ngày", got)
	}
	if got := byTag["wv-30-ld_war_30"]; !strings.Contains(got, "30 ngày") {
		t.Errorf("30-day title = %q, want it to mention 30 ngày", got)
	}

	// Same-day second run: both were stamped for their own lead day.
	firstSends := len(mock.sends)
	stats2, err := Run(ctx, pool, mock)
	if err != nil {
		t.Fatalf("Run (2nd): %v", err)
	}
	if stats2.WarrantyNotices != 0 {
		t.Errorf("2nd run WarrantyNotices = %d, want 0", stats2.WarrantyNotices)
	}
	if len(mock.sends) != firstSends {
		t.Errorf("2nd run sent %d extra pushes, want 0", len(mock.sends)-firstSends)
	}

	// The stamp records WHICH lead day fired.
	for warrantyID, want := range map[string]int32{"ld_war_7": 7, "ld_war_30": 30} {
		var got *int32
		if err := pool.QueryRow(ctx,
			`SELECT "lastNotifiedLeadDay" FROM "Reminder" WHERE "warrantyId" = $1`,
			warrantyID).Scan(&got); err != nil {
			t.Fatalf("read reminder lead day for %s: %v", warrantyID, err)
		}
		if got == nil || *got != want {
			t.Errorf("Reminder(%s).lastNotifiedLeadDay = %v, want %d", warrantyID, got, want)
		}
	}
}

// The exact scenario in the brief: ONE device with [30, 7] produces one push at
// the 30-day window and another at the 7-day window. The second run is on the
// same calendar day (the end date is moved instead of waiting 23 days), which is
// the compressed-clock proof that the idempotency key includes the lead day.
func TestRunWarrantyLeadDaysThirtySevenTwoPushesSameDevice(t *testing.T) {
	ctx := context.Background()
	pool := cronScratchDB(t)
	userID := leadDaysUser(t, pool, "vi")

	now := time.Now()
	midnight := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())

	leadDaysDevice(t, pool, userID, "ld_30_7", "Máy 30/7", []int32{30, 7})
	leadDaysWarranty(t, pool, "ld_war_30_7", "ld_30_7", midnight.AddDate(0, 0, 29).Add(12*time.Hour))

	mock := &mockDispatcher{}
	first, err := Run(ctx, pool, mock)
	if err != nil {
		t.Fatalf("Run (30d): %v", err)
	}
	if first.WarrantyNotices != 1 {
		t.Errorf("30d run WarrantyNotices = %d, want 1", first.WarrantyNotices)
	}
	if _, ok := sendsByTag(mock.sends, "wv-30-")["wv-30-ld_war_30_7"]; !ok {
		t.Fatalf("no 30-day push; got tags %v", tagsOf(mock.sends))
	}

	// Same device, same warranty, SAME calendar day: the 7-day window.
	if _, err := pool.Exec(ctx,
		`UPDATE "Warranty" SET "endDate" = $1 WHERE id = $2`,
		midnight.AddDate(0, 0, 6).Add(12*time.Hour), "ld_war_30_7"); err != nil {
		t.Fatalf("move endDate: %v", err)
	}
	before := len(mock.sends)
	second, err := Run(ctx, pool, mock)
	if err != nil {
		t.Fatalf("Run (7d): %v", err)
	}
	if second.WarrantyNotices != 1 {
		t.Errorf("7d run WarrantyNotices = %d, want 1 (the other lead day)", second.WarrantyNotices)
	}
	if len(mock.sends)-before != 1 {
		t.Fatalf("7d run added %d pushes, want 1", len(mock.sends)-before)
	}
	if _, ok := sendsByTag(mock.sends, "wv-7-")["wv-7-ld_war_30_7"]; !ok {
		t.Fatalf("no 7-day push; got tags %v", tagsOf(mock.sends))
	}

	// A third same-day run for the 7-day lead day is a no-op.
	third, err := Run(ctx, pool, mock)
	if err != nil {
		t.Fatalf("Run (3rd): %v", err)
	}
	if third.WarrantyNotices != 0 {
		t.Errorf("3rd run WarrantyNotices = %d, want 0", third.WarrantyNotices)
	}
}

// ─── Warranty: custom values + the per-lead-day idempotency key ─────────────

func TestRunWarrantyLeadDaysCustomAndPerLeadDayKey(t *testing.T) {
	ctx := context.Background()
	pool := cronScratchDB(t)
	userID := leadDaysUser(t, pool, "vi")

	now := time.Now()
	midnight := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())

	leadDaysDevice(t, pool, userID, "ld_custom", "Máy 14/3", []int32{3, 14})
	// The 14-day window under the warranty's inclusive convention: endDate is
	// today+13, which is what the legacy 7-day bucket would call "today+6".
	leadDaysWarranty(t, pool, "ld_war_custom", "ld_custom", midnight.AddDate(0, 0, 13).Add(12*time.Hour))

	mock := &mockDispatcher{}
	first, err := Run(ctx, pool, mock)
	if err != nil {
		t.Fatalf("Run (14d): %v", err)
	}
	if first.WarrantyNotices != 1 {
		t.Errorf("14d run WarrantyNotices = %d, want 1", first.WarrantyNotices)
	}
	if _, ok := sendsByTag(mock.sends, "wv-14-")["wv-14-ld_war_custom"]; !ok {
		t.Fatalf("no 14-day push; got tags %v", tagsOf(mock.sends))
	}

	// Compressed clock: move the warranty end date to the 3-day window and run
	// again on the SAME calendar day. The old per-warranty-per-day key would
	// suppress this; the per-lead-day key must not.
	if _, err := pool.Exec(ctx,
		`UPDATE "Warranty" SET "endDate" = $1 WHERE id = $2`,
		midnight.AddDate(0, 0, 2).Add(12*time.Hour), "ld_war_custom"); err != nil {
		t.Fatalf("move endDate: %v", err)
	}
	before := len(mock.sends)
	second, err := Run(ctx, pool, mock)
	if err != nil {
		t.Fatalf("Run (3d): %v", err)
	}
	if second.WarrantyNotices != 1 {
		t.Errorf("3d run WarrantyNotices = %d, want 1 (a different lead day)", second.WarrantyNotices)
	}
	if len(mock.sends)-before != 1 {
		t.Fatalf("3d run added %d pushes, want exactly 1", len(mock.sends)-before)
	}
	if _, ok := sendsByTag(mock.sends, "wv-3-")["wv-3-ld_war_custom"]; !ok {
		t.Errorf("no 3-day push; got tags %v", tagsOf(mock.sends))
	}

	// A third run on the same day for the SAME lead day is a no-op.
	third, err := Run(ctx, pool, mock)
	if err != nil {
		t.Fatalf("Run (3rd): %v", err)
	}
	if third.WarrantyNotices != 0 {
		t.Errorf("3rd run WarrantyNotices = %d, want 0", third.WarrantyNotices)
	}
}

// ─── Warranty: past / future milestones do not fire ─────────────────────────

func TestRunWarrantyLeadDaysDoesNotFireRetroactivelyOrEarly(t *testing.T) {
	ctx := context.Background()
	pool := cronScratchDB(t)
	userID := leadDaysUser(t, pool, "en")

	now := time.Now()
	midnight := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())

	// 365 > remaining 7: the 365-day window is long past; no catch-up push.
	leadDaysDevice(t, pool, userID, "ld_past", "Past mark", []int32{365})
	leadDaysWarranty(t, pool, "ld_war_past", "ld_past", midnight.AddDate(0, 0, 6).Add(12*time.Hour))

	// 3 < remaining 30: the 3-day window is still in the future; no early push.
	leadDaysDevice(t, pool, userID, "ld_future", "Future mark", []int32{3})
	leadDaysWarranty(t, pool, "ld_war_future", "ld_future", midnight.AddDate(0, 0, 30).Add(12*time.Hour))

	mock := &mockDispatcher{}
	stats, err := Run(ctx, pool, mock)
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if stats.WarrantyNotices != 0 {
		t.Errorf("WarrantyNotices = %d, want 0 (neither milestone is due)", stats.WarrantyNotices)
	}
	if got := sendsByTag(mock.sends, "wv-"); len(got) != 0 {
		t.Errorf("unexpected warranty pushes: %v", got)
	}
}

// The contract explicitly allows 0. A user who picks 0 means "on the expiry
// day", so the sweep must not apply the legacy L-1 offset (which would put it
// on the day AFTER expiry).
func TestRunWarrantyLeadDayZeroFiresOnExpiryDay(t *testing.T) {
	ctx := context.Background()
	pool := cronScratchDB(t)
	userID := leadDaysUser(t, pool, "en")

	now := time.Now()
	midnight := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())

	leadDaysDevice(t, pool, userID, "ld_zero_today", "Expires today", []int32{0})
	leadDaysWarranty(t, pool, "ld_war_zero_today", "ld_zero_today", midnight.Add(12*time.Hour))

	// A warranty that expired yesterday is past the 0 mark; no retroactive push.
	leadDaysDevice(t, pool, userID, "ld_zero_past", "Expired yesterday", []int32{0})
	leadDaysWarranty(t, pool, "ld_war_zero_past", "ld_zero_past", midnight.AddDate(0, 0, -1).Add(12*time.Hour))

	mock := &mockDispatcher{}
	stats, err := Run(ctx, pool, mock)
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if stats.WarrantyNotices != 1 {
		t.Errorf("WarrantyNotices = %d, want 1 (only the expiry-day device)", stats.WarrantyNotices)
	}
	byTag := sendsByTag(mock.sends, "wv-")
	if _, ok := byTag["wv-0-ld_war_zero_today"]; !ok {
		t.Errorf("no 0-day push for the expiry-day warranty; got %v", tagsOf(mock.sends))
	}
	if _, ok := byTag["wv-0-ld_war_zero_past"]; ok {
		t.Errorf("0-day push fired for a warranty that already expired")
	}

	// Same-day re-run is still idempotent for lead day 0.
	before := len(mock.sends)
	if _, err := Run(ctx, pool, mock); err != nil {
		t.Fatalf("Run (2nd): %v", err)
	}
	if len(mock.sends) != before {
		t.Errorf("2nd run added %d pushes, want 0", len(mock.sends)-before)
	}
}

// ─── Subscription: default [3, 1, 0] + the same per-lead-day key ────────────

func TestRunSubscriptionLeadDaysDefaultAndPerLeadDayKey(t *testing.T) {
	ctx := context.Background()
	pool := cronScratchDB(t)
	userID := leadDaysUser(t, pool, "vi")
	q := store.New(pool)

	now := time.Now()
	midnight := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())

	// nil leadDays -> the column default [3, 1, 0], which is the OLD renewal
	// cron's schedule. It is deliberately not the device default [30, 7]:
	// sharing one default would have moved every existing subscription's
	// renewal warnings two weeks earlier.
	leadDaysSubscription(t, q, userID, "ld_sub_3", "Gói 3", midnight.AddDate(0, 0, 3).Add(12*time.Hour), nil)
	leadDaysSubscription(t, q, userID, "ld_sub_1", "Gói 1", midnight.AddDate(0, 0, 1).Add(12*time.Hour), nil)

	mock := &mockDispatcher{}
	if _, err := Run(ctx, pool, mock); err != nil {
		t.Fatalf("Run: %v", err)
	}
	subTags := sendsByTag(mock.sends, "sub-d")
	if _, ok := subTags["sub-d3-ld_sub_3"]; !ok {
		t.Errorf("no 3-day subscription push; got tags %v", tagsOf(mock.sends))
	}
	if _, ok := subTags["sub-d1-ld_sub_1"]; !ok {
		t.Errorf("no 1-day subscription push; got tags %v", tagsOf(mock.sends))
	}
	for _, tag := range []string{"sub-d3-ld_sub_3", "sub-d1-ld_sub_1"} {
		if got := subTags[tag]; !strings.Contains(got, "ngày") {
			t.Errorf("%s title = %q, want a day count", tag, got)
		}
	}

	// Same-day second run is idempotent.
	before := len(mock.sends)
	if _, err := Run(ctx, pool, mock); err != nil {
		t.Fatalf("Run (2nd): %v", err)
	}
	if len(mock.sends) != before {
		t.Errorf("2nd run added %d subscription pushes, want 0", len(mock.sends)-before)
	}

	// Custom schedule, compressed clock: 14-day push, then move renewalDate to
	// the 3-day window and run again the same day. The lead day must be part of
	// the key, otherwise the second push would be suppressed as "already sent
	// today".
	leadDaysSubscription(t, q, userID, "ld_sub_custom", "Gói 14/3", midnight.AddDate(0, 0, 14).Add(12*time.Hour), []int32{3, 14})
	before = len(mock.sends)
	if _, err := Run(ctx, pool, mock); err != nil {
		t.Fatalf("Run (14d sub): %v", err)
	}
	if len(mock.sends)-before != 1 {
		t.Fatalf("14d sub run added %d pushes, want 1", len(mock.sends)-before)
	}
	if _, ok := sendsByTag(mock.sends, "sub-d14-")["sub-d14-ld_sub_custom"]; !ok {
		t.Fatalf("no 14-day subscription push; got tags %v", tagsOf(mock.sends))
	}

	if _, err := pool.Exec(ctx,
		`UPDATE "Subscription" SET "renewalDate" = $1 WHERE id = $2`,
		midnight.AddDate(0, 0, 3).Add(12*time.Hour), "ld_sub_custom"); err != nil {
		t.Fatalf("move renewalDate: %v", err)
	}
	before = len(mock.sends)
	if _, err := Run(ctx, pool, mock); err != nil {
		t.Fatalf("Run (3d sub): %v", err)
	}
	if len(mock.sends)-before != 1 {
		t.Fatalf("3d sub run added %d pushes, want 1 (a different lead day)", len(mock.sends)-before)
	}
	if _, ok := sendsByTag(mock.sends, "sub-d3-")["sub-d3-ld_sub_custom"]; !ok {
		t.Errorf("no 3-day subscription push; got tags %v", tagsOf(mock.sends))
	}

	// Third run, same lead day -> no-op.
	before = len(mock.sends)
	if _, err := Run(ctx, pool, mock); err != nil {
		t.Fatalf("Run (3rd sub): %v", err)
	}
	if len(mock.sends) != before {
		t.Errorf("3rd sub run added %d pushes, want 0", len(mock.sends)-before)
	}
}
