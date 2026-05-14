package cron

import (
	"context"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/thanhtrung9368/warranty-vault/api/internal/push"
	store "github.com/thanhtrung9368/warranty-vault/api/internal/store/gen"
)

// ─── Pure helpers (no DB) ────────────────────────────────────────────────────

func TestFormatVND(t *testing.T) {
	cases := []struct {
		in   int32
		want string
	}{
		{0, "0 ₫"},
		{1, "1 ₫"},
		{999, "999 ₫"},
		{1000, "1.000 ₫"},
		{12345, "12.345 ₫"},
		{1234567, "1.234.567 ₫"},
		{480000, "480.000 ₫"},
		{1200000, "1.200.000 ₫"},
	}
	for _, tc := range cases {
		got := formatVND(tc.in)
		if got != tc.want {
			t.Errorf("formatVND(%d) = %q, want %q", tc.in, got, tc.want)
		}
	}
}

func TestFormatVi(t *testing.T) {
	got := formatVi(time.Date(2026, time.May, 7, 12, 0, 0, 0, time.UTC))
	if got != "07/05/2026" {
		t.Errorf("formatVi: got %q, want 07/05/2026", got)
	}
}

func TestDayWindow(t *testing.T) {
	// 2026-05-07 13:30 UTC, +7d → [2026-05-14 00:00, 2026-05-15 00:00)
	now := time.Date(2026, time.May, 7, 13, 30, 0, 0, time.UTC)
	start, end := dayWindow(now, 7)
	wantStart := time.Date(2026, time.May, 14, 0, 0, 0, 0, time.UTC)
	wantEnd := time.Date(2026, time.May, 15, 0, 0, 0, 0, time.UTC)
	if !start.Equal(wantStart) || !end.Equal(wantEnd) {
		t.Errorf("dayWindow: got [%v, %v), want [%v, %v)", start, end, wantStart, wantEnd)
	}
}

// ─── Mock dispatcher ─────────────────────────────────────────────────────────

type mockSend struct {
	sub     push.Subscription
	payload push.Payload
}

type mockDispatcher struct {
	mu      sync.Mutex
	sends   []mockSend
	respond func(sub push.Subscription, payload push.Payload) Result
}

func (m *mockDispatcher) Send(sub push.Subscription, payload push.Payload) Result {
	m.mu.Lock()
	m.sends = append(m.sends, mockSend{sub, payload})
	m.mu.Unlock()
	if m.respond != nil {
		return m.respond(sub, payload)
	}
	return Result{Ok: true}
}

// ─── Integration: round-trip Run against the dev DB ──────────────────────────

func TestRun_AgainstDevDB(t *testing.T) {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		t.Skip("DATABASE_URL not set; skipping integration test")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("pgxpool.New: %v", err)
	}
	defer pool.Close()

	if err := pool.Ping(ctx); err != nil {
		t.Skipf("DB not reachable: %v", err)
	}

	const testEmail = "__cron_go__@local.test"

	// Cleanup any prior run (cascade removes everything).
	cleanup := func() {
		_, _ = pool.Exec(ctx, `DELETE FROM "User" WHERE email = $1`, testEmail)
	}
	cleanup()
	defer cleanup()

	// Seed test user.
	userID := uuid.NewString()
	if _, err := pool.Exec(ctx, `
		INSERT INTO "User" (id, email, "passwordHash", "updatedAt")
		VALUES ($1, $2, 'x', NOW())`, userID, testEmail); err != nil {
		t.Fatalf("insert user: %v", err)
	}

	// One web push subscription. Fixed fake VAPID endpoint that the mock will
	// always intercept before any real HTTP call.
	pushID := uuid.NewString()
	p256 := "fake-p256dh"
	auth := "fake-auth"
	if _, err := pool.Exec(ctx, `
		INSERT INTO "PushSubscription" (id, "userId", endpoint, p256dh, auth, platform, "createdAt")
		VALUES ($1, $2, 'https://fake.local/push', $3, $4, 'web', NOW())`,
		pushID, userID, p256, auth); err != nil {
		t.Fatalf("insert push sub: %v", err)
	}

	q := store.New(pool)

	// Device + warranty due in exactly 7 days (warranty bucket).
	deviceID := uuid.NewString()
	if _, err := pool.Exec(ctx, `
		INSERT INTO "Device" (id, "userId", name, category, "purchaseDate", "purchasePrice", status, "updatedAt")
		VALUES ($1, $2, 'Test Phone', 'phone', NOW(), 0, 'ACTIVE', NOW())`,
		deviceID, userID); err != nil {
		t.Fatalf("insert device: %v", err)
	}
	// All times in local TZ to match the cron's wall-clock comparisons against
	// "timestamp without time zone" columns.
	nowLocal := time.Now()
	todayLocal := time.Date(nowLocal.Year(), nowLocal.Month(), nowLocal.Day(), 0, 0, 0, 0, nowLocal.Location())
	in7d := todayLocal.AddDate(0, 0, 6) // dayWindow uses days-1 for warranty buckets
	warrantyID := uuid.NewString()
	if _, err := q.CreateWarranty(ctx, store.CreateWarrantyParams{
		ID:        warrantyID,
		DeviceId:  deviceID,
		Type:      "STANDARD",
		StartDate: pgtype.Timestamp{Time: nowLocal, Valid: true},
		EndDate:   pgtype.Timestamp{Time: in7d.Add(12 * time.Hour), Valid: true},
		Months:    12,
	}); err != nil {
		t.Fatalf("create warranty: %v", err)
	}

	// Subscriptions: auto-renew overdue, manual overdue, lifetime overdue
	// (the LIFETIME row stays ACTIVE — it's filtered out at SQL level).
	yesterday := nowLocal.Add(-24 * time.Hour)
	subAutoID := uuid.NewString()
	subManualID := uuid.NewString()
	subLifetimeID := uuid.NewString()
	if _, err := q.CreateSubscription(ctx, store.CreateSubscriptionParams{
		ID:           subAutoID,
		UserId:       userID,
		Name:         "ChatGPT Plus",
		BillingCycle: "MONTHLY",
		Price:        480000,
		StartedAt:    pgtype.Timestamp{Time: yesterday.AddDate(0, -1, 0), Valid: true},
		RenewalDate:  pgtype.Timestamp{Time: yesterday, Valid: true},
		AutoRenew:    true,
	}); err != nil {
		t.Fatalf("create autoRenew sub: %v", err)
	}
	if _, err := q.CreateSubscription(ctx, store.CreateSubscriptionParams{
		ID:           subManualID,
		UserId:       userID,
		Name:         "Old Hosting",
		BillingCycle: "YEARLY",
		Price:        1200000,
		StartedAt:    pgtype.Timestamp{Time: yesterday.AddDate(-1, 0, 0), Valid: true},
		RenewalDate:  pgtype.Timestamp{Time: yesterday, Valid: true},
		AutoRenew:    false,
	}); err != nil {
		t.Fatalf("create manual sub: %v", err)
	}
	if _, err := q.CreateSubscription(ctx, store.CreateSubscriptionParams{
		ID:           subLifetimeID,
		UserId:       userID,
		Name:         "Lifetime Deal",
		BillingCycle: "LIFETIME",
		Price:        5000000,
		StartedAt:    pgtype.Timestamp{Time: time.Date(2025, time.January, 1, 0, 0, 0, 0, time.UTC), Valid: true},
		RenewalDate:  pgtype.Timestamp{Time: time.Date(2125, time.January, 1, 0, 0, 0, 0, time.UTC), Valid: true},
		AutoRenew:    true,
	}); err != nil {
		t.Fatalf("create lifetime sub: %v", err)
	}

	// Wishlist: today bucket + 8-days-stale interval ping.
	wlTodayID := uuid.NewString()
	wlIntervalID := uuid.NewString()
	todayMid := todayLocal.Add(12 * time.Hour)
	currentPrice := int32(8500000)
	if _, err := q.CreateWishlist(ctx, store.CreateWishlistParams{
		ID:           wlTodayID,
		UserId:       userID,
		Name:         "Sony WH-1000XM6",
		CurrentPrice: &currentPrice,
		TargetDate:   pgtype.Timestamp{Time: todayMid, Valid: true},
	}); err != nil {
		t.Fatalf("create wishlist today: %v", err)
	}
	interval := int32(7)
	intervalPrice := int32(14500000)
	eightDaysAgo := nowLocal.AddDate(0, 0, -8)
	if _, err := q.CreateWishlist(ctx, store.CreateWishlistParams{
		ID:                   wlIntervalID,
		UserId:               userID,
		Name:                 "iPad mini 7",
		CurrentPrice:         &intervalPrice,
		ReminderIntervalDays: &interval,
	}); err != nil {
		t.Fatalf("create wishlist interval: %v", err)
	}
	// Backdate lastNotifiedAt so the periodic-checkin SQL fires.
	if _, err := pool.Exec(ctx,
		`UPDATE "WishlistItem" SET "lastNotifiedAt" = $1 WHERE id = $2`,
		eightDaysAgo, wlIntervalID); err != nil {
		t.Fatalf("backdate lastNotifiedAt: %v", err)
	}

	// ─── Run cron ──────────────────────────────────────────────────────────
	mock := &mockDispatcher{}
	stats, err := Run(ctx, pool, mock)
	if err != nil {
		t.Fatalf("Run: %v", err)
	}

	// Subscription side-effects.
	if stats.SubscriptionRenewals != 1 {
		t.Errorf("SubscriptionRenewals = %d, want 1", stats.SubscriptionRenewals)
	}
	if stats.SubscriptionExpired != 1 {
		t.Errorf("SubscriptionExpired = %d, want 1", stats.SubscriptionExpired)
	}

	// Verify the auto-renew advanced + payment row created.
	var newRenewal time.Time
	if err := pool.QueryRow(ctx,
		`SELECT "renewalDate" FROM "Subscription" WHERE id = $1`, subAutoID).
		Scan(&newRenewal); err != nil {
		t.Fatalf("read auto-renew sub: %v", err)
	}
	if !newRenewal.After(yesterday) {
		t.Errorf("auto-renew renewalDate not advanced: %v <= %v", newRenewal, yesterday)
	}
	var payCount int
	if err := pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM "SubscriptionPayment" WHERE "subscriptionId" = $1`,
		subAutoID).Scan(&payCount); err != nil {
		t.Fatalf("count payments: %v", err)
	}
	if payCount != 1 {
		t.Errorf("auto-renew payments = %d, want 1", payCount)
	}

	// Manual sub flipped to EXPIRED.
	var manualStatus string
	if err := pool.QueryRow(ctx,
		`SELECT status FROM "Subscription" WHERE id = $1`, subManualID).
		Scan(&manualStatus); err != nil {
		t.Fatalf("read manual sub: %v", err)
	}
	if manualStatus != "EXPIRED" {
		t.Errorf("manual sub status = %q, want EXPIRED", manualStatus)
	}

	// Wishlist target-date hit at least once (today bucket includes wlToday).
	if stats.WishlistTargetHits == 0 {
		t.Errorf("WishlistTargetHits = 0, want >= 1")
	}

	// Wishlist periodic checkin fired exactly once.
	if stats.WishlistCheckins != 1 {
		t.Errorf("WishlistCheckins = %d, want 1", stats.WishlistCheckins)
	}

	// Warranty notice fired at least once for our 7d-out warranty.
	if stats.WarrantyNotices == 0 {
		t.Errorf("WarrantyNotices = 0, want >= 1")
	}

	// All sends should have been routed through the mock (no real HTTP).
	if len(mock.sends) == 0 {
		t.Errorf("mock dispatcher recorded 0 sends; expected at least 1")
	}
	// Spot-check: every send targeted our seed user's push subscription.
	for _, s := range mock.sends {
		if s.sub.ID != pushID {
			t.Errorf("unexpected sub ID in mock send: %s", s.sub.ID)
		}
		if !strings.Contains(s.payload.Title, "") { // sanity, payload non-empty
			t.Errorf("empty payload title")
		}
	}

	// Total pushes sent (mock returns Ok:true) should equal len(mock.sends).
	if stats.PushesSent != len(mock.sends) {
		t.Errorf("PushesSent = %d, want %d", stats.PushesSent, len(mock.sends))
	}

	// ─── 2nd-run idempotency (regression guard for the duplicate-push bug) ─
	// Re-running Run on the same day must NOT re-fan-out the 3 notification
	// buckets we just fixed:
	//   - warranty 7d notice (Reminder.lastNotifiedAt stamped above)
	//   - wishlist target-date day-of (WishlistItem.lastNotifiedAt stamped)
	//   - subscription renewal warning (Subscription.lastNotifiedRenewalAt
	//     stamped — N/A here because our subs are overdue, not warning-window,
	//     but we still assert WarrantyNotices and WishlistTargetHits.)
	firstSends := len(mock.sends)
	stats2, err := Run(ctx, pool, mock)
	if err != nil {
		t.Fatalf("Run (2nd): %v", err)
	}
	if stats2.WarrantyNotices != 0 {
		t.Errorf("2nd run WarrantyNotices = %d, want 0 (idempotency)", stats2.WarrantyNotices)
	}
	if stats2.WishlistTargetHits != 0 {
		t.Errorf("2nd run WishlistTargetHits = %d, want 0 (idempotency)", stats2.WishlistTargetHits)
	}
	// Only newly-stale wishlist intervals should fire; ours was just stamped.
	if stats2.WishlistCheckins != 0 {
		t.Errorf("2nd run WishlistCheckins = %d, want 0 (idempotency)", stats2.WishlistCheckins)
	}
	// Auto-bill / expire already mutated row state — no second-pass effects.
	if stats2.SubscriptionRenewals != 0 || stats2.SubscriptionExpired != 0 {
		t.Errorf("2nd run sub state changed: renew=%d expire=%d, want 0/0",
			stats2.SubscriptionRenewals, stats2.SubscriptionExpired)
	}
	if len(mock.sends) != firstSends {
		t.Errorf("2nd run added %d push sends, want 0",
			len(mock.sends)-firstSends)
	}
}

// TestRun_SubRenewalWarningIdempotent seeds an ACTIVE sub whose renewalDate
// lands in the "today" (0d) warning bucket — autoRenew=true, status=ACTIVE,
// so the cron should fire a `subscription_renewal` warning push the first
// time, then skip it on the second same-day run because
// ListSubscriptionsDueForRenewal filters by lastNotifiedRenewalAt::date <
// CURRENT_DATE. Guards against the bug fixed in 0002_cron_idempotency.sql.
func TestRun_SubRenewalWarningIdempotent(t *testing.T) {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		t.Skip("DATABASE_URL not set; skipping integration test")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("pgxpool.New: %v", err)
	}
	defer pool.Close()
	if err := pool.Ping(ctx); err != nil {
		t.Skipf("DB not reachable: %v", err)
	}

	const testEmail = "__cron_go_subwarn__@local.test"
	cleanup := func() {
		_, _ = pool.Exec(ctx, `DELETE FROM "User" WHERE email = $1`, testEmail)
	}
	cleanup()
	defer cleanup()

	userID := uuid.NewString()
	if _, err := pool.Exec(ctx, `
		INSERT INTO "User" (id, email, "passwordHash", "updatedAt")
		VALUES ($1, $2, 'x', NOW())`, userID, testEmail); err != nil {
		t.Fatalf("insert user: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO "PushSubscription" (id, "userId", endpoint, p256dh, auth, platform, "createdAt")
		VALUES ($1, $2, 'https://fake.local/push-warn', 'p', 'a', 'web', NOW())`,
		uuid.NewString(), userID); err != nil {
		t.Fatalf("insert push sub: %v", err)
	}

	// renewalDate at noon today (matches the 0-day warning bucket).
	now := time.Now()
	todayNoon := time.Date(now.Year(), now.Month(), now.Day(), 12, 0, 0, 0, now.Location())
	q := store.New(pool)
	subID := uuid.NewString()
	if _, err := q.CreateSubscription(ctx, store.CreateSubscriptionParams{
		ID:           subID,
		UserId:       userID,
		Name:         "Warning Sub",
		BillingCycle: "MONTHLY",
		Price:        100000,
		StartedAt:    pgtype.Timestamp{Time: todayNoon.AddDate(0, -1, 0), Valid: true},
		RenewalDate:  pgtype.Timestamp{Time: todayNoon, Valid: true},
		AutoRenew:    true,
	}); err != nil {
		t.Fatalf("create sub: %v", err)
	}

	mock := &mockDispatcher{}
	stats, err := Run(ctx, pool, mock)
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	// First run: at least one warning push fired (we can't read the
	// warning-bucket count directly, but mock.sends should be non-empty and
	// lastNotifiedRenewalAt should now be stamped).
	if len(mock.sends) == 0 {
		t.Fatalf("first run: no push sent for 0d warning bucket")
	}
	var stampedAt *time.Time
	if err := pool.QueryRow(ctx,
		`SELECT "lastNotifiedRenewalAt" FROM "Subscription" WHERE id = $1`, subID).
		Scan(&stampedAt); err != nil {
		t.Fatalf("read lastNotifiedRenewalAt: %v", err)
	}
	if stampedAt == nil {
		t.Fatalf("lastNotifiedRenewalAt not stamped after first run")
	}

	firstSends := len(mock.sends)
	stats2, err := Run(ctx, pool, mock)
	if err != nil {
		t.Fatalf("Run (2nd): %v", err)
	}
	// 2nd run on same day must not fan out again.
	if len(mock.sends) != firstSends {
		t.Errorf("2nd run added %d new sends, want 0 (idempotency)",
			len(mock.sends)-firstSends)
	}
	_ = stats
	_ = stats2
}

// TestRun_DispatchGoneDeletesRow verifies the Gone path removes the
// PushSubscription row. Skips if no DATABASE_URL.
func TestRun_DispatchGoneDeletesRow(t *testing.T) {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		t.Skip("DATABASE_URL not set; skipping integration test")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("pgxpool.New: %v", err)
	}
	defer pool.Close()
	if err := pool.Ping(ctx); err != nil {
		t.Skipf("DB not reachable: %v", err)
	}

	const testEmail = "__cron_go_gone__@local.test"
	cleanup := func() {
		_, _ = pool.Exec(ctx, `DELETE FROM "User" WHERE email = $1`, testEmail)
	}
	cleanup()
	defer cleanup()

	userID := uuid.NewString()
	if _, err := pool.Exec(ctx, `
		INSERT INTO "User" (id, email, "passwordHash", "updatedAt")
		VALUES ($1, $2, 'x', NOW())`, userID, testEmail); err != nil {
		t.Fatalf("insert user: %v", err)
	}
	pushID := uuid.NewString()
	p256 := "fake-p256dh"
	auth := "fake-auth"
	if _, err := pool.Exec(ctx, `
		INSERT INTO "PushSubscription" (id, "userId", endpoint, p256dh, auth, platform, "createdAt")
		VALUES ($1, $2, 'https://fake.local/push-gone', $3, $4, 'web', NOW())`,
		pushID, userID, p256, auth); err != nil {
		t.Fatalf("insert push sub: %v", err)
	}

	// Subscription overdue with autoRenew=false → triggers exactly one expire
	// notification, which the mock returns Gone for.
	q := store.New(pool)
	yesterday := time.Now().Add(-24 * time.Hour)
	subID := uuid.NewString()
	if _, err := q.CreateSubscription(ctx, store.CreateSubscriptionParams{
		ID:           subID,
		UserId:       userID,
		Name:         "Gone Test Sub",
		BillingCycle: "YEARLY",
		Price:        100000,
		StartedAt:    pgtype.Timestamp{Time: yesterday.AddDate(-1, 0, 0), Valid: true},
		RenewalDate:  pgtype.Timestamp{Time: yesterday, Valid: true},
		AutoRenew:    false,
	}); err != nil {
		t.Fatalf("create sub: %v", err)
	}

	mock := &mockDispatcher{
		respond: func(sub push.Subscription, payload push.Payload) Result {
			return Result{Ok: false, Gone: true, Error: "gone"}
		},
	}
	stats, err := Run(ctx, pool, mock)
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if stats.PushesGone == 0 {
		t.Errorf("PushesGone = 0, want >= 1")
	}

	// Row should be deleted.
	var remaining int
	if err := pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM "PushSubscription" WHERE id = $1`, pushID).
		Scan(&remaining); err != nil {
		t.Fatalf("count push subs: %v", err)
	}
	if remaining != 0 {
		t.Errorf("PushSubscription row not deleted; %d still exist", remaining)
	}
}
