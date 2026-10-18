package cron

import (
	"context"
	"strings"
	"testing"
	"time"
)

// Migration 0016 cron coverage.
//
// The properties under test are the ones a unit test cannot fake:
//
//  1. The activation reminder fires ONCE for a device that requires activation
//     and has no activation date, and a second same-day run sends nothing.
//  2. The extended-cover reminder uses the device's own leadDays, fires once per
//     (device, leadDay, day), and a different lead day in the SAME day still
//     fires — the migration-0015 key shape, reused.
//  3. The trial reminder fires once per (subscription, leadDay, day), uses
//     subscription leadDays, and its wording is visibly different from the
//     renewal reminder.
//  4. Legacy rows — a user who never sets any of these fields — produce ZERO new
//     notices. That is the "byte-identical behaviour" promise at the notification
//     layer; services/activation_trial_test.go proves the data-layer half.
//
// Every test gets its own migrated database (cronScratchDB) and skips without
// WV_TEST_DATABASE_URL.

// ─── 1. Activation ──────────────────────────────────────────────────────────

func TestRunActivationReminderFiresOnce(t *testing.T) {
	ctx := context.Background()
	pool := cronScratchDB(t)
	userID := leadDaysUser(t, pool, "vi")

	now := time.Now()
	purchase := now.AddDate(0, 0, -10)
	if _, err := pool.Exec(ctx, `
		INSERT INTO "Device" (id, "userId", name, category, "purchaseDate", "purchasePrice",
		                      status, "activationRequired", "leadDays", "createdAt", "updatedAt")
		VALUES ('act_pending', $1, 'Máy chưa kích hoạt', 'PHONE', $2, 1000000,
		        'ACTIVE', true, ARRAY[30, 7], NOW(), NOW())`, userID, purchase); err != nil {
		t.Fatalf("insert pending device: %v", err)
	}
	// Already activated: the flag is on but the date is recorded, so the query
	// must not select it even before any stamp exists.
	if _, err := pool.Exec(ctx, `
		INSERT INTO "Device" (id, "userId", name, category, "purchaseDate", "purchasePrice",
		                      status, "activationRequired", "activatedAt", "createdAt", "updatedAt")
		VALUES ('act_done', $1, 'Máy đã kích hoạt', 'PHONE', $2, 1000000,
		        'ACTIVE', true, $3, NOW(), NOW())`, userID, purchase, now); err != nil {
		t.Fatalf("insert activated device: %v", err)
	}
	// A legacy row: the flag is false (the column default), no dates.
	if _, err := pool.Exec(ctx, `
		INSERT INTO "Device" (id, "userId", name, category, "purchaseDate", "purchasePrice",
		                      status, "createdAt", "updatedAt")
		VALUES ('act_legacy', $1, 'Máy cũ', 'PHONE', $2, 1000000, 'ACTIVE', NOW(), NOW())`,
		userID, purchase); err != nil {
		t.Fatalf("insert legacy device: %v", err)
	}

	mock := &mockDispatcher{}
	stats, err := Run(ctx, pool, mock)
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if stats.ActivationNotices != 1 {
		t.Errorf("ActivationNotices = %d, want 1", stats.ActivationNotices)
	}
	byTag := sendsByTag(mock.sends, "wv-activation-")
	if _, ok := byTag["wv-activation-act_pending"]; !ok {
		t.Fatalf("no activation push; got tags %v", tagsOf(mock.sends))
	}
	if _, ok := byTag["wv-activation-act_done"]; ok {
		t.Error("pushed for an already-activated device")
	}
	if _, ok := byTag["wv-activation-act_legacy"]; ok {
		t.Error("pushed for a legacy device that never opted in")
	}
	title := byTag["wv-activation-act_pending"]
	if !strings.Contains(title, "chưa kích hoạt bảo hành") {
		t.Errorf("activation title = %q", title)
	}

	// The stamp makes it once-only: a second run on the same day is a no-op.
	second := &mockDispatcher{}
	stats2, err := Run(ctx, pool, second)
	if err != nil {
		t.Fatalf("second Run: %v", err)
	}
	if stats2.ActivationNotices != 0 {
		t.Errorf("second run ActivationNotices = %d, want 0", stats2.ActivationNotices)
	}
	for _, s := range second.sends {
		if strings.HasPrefix(s.payload.Tag, "wv-activation-") {
			t.Errorf("second run re-sent %q", s.payload.Tag)
		}
	}

	// Recording activatedAt after the fact also stops it (even without the
	// stamp, the query's activatedAt IS NULL predicate would). Clearing the date
	// later must NOT resurrect the reminder: the stamp from the first run
	// survives, which is the conservative reading of "a user who dismisses it
	// stays dismissed".
	if _, err := pool.Exec(ctx,
		`UPDATE "Device" SET "activatedAt" = NOW() WHERE id = 'act_pending'`); err != nil {
		t.Fatalf("set activation: %v", err)
	}
	third := &mockDispatcher{}
	stats3, err := Run(ctx, pool, third)
	if err != nil {
		t.Fatalf("third Run: %v", err)
	}
	if stats3.ActivationNotices != 0 {
		t.Errorf("third run ActivationNotices = %d, want 0 (activated)", stats3.ActivationNotices)
	}

	// And clearing activatedAt does not bring the notice back either, because the
	// original run stamped the device.
	if _, err := pool.Exec(ctx,
		`UPDATE "Device" SET "activatedAt" = NULL WHERE id = 'act_pending'`); err != nil {
		t.Fatalf("clear activation: %v", err)
	}
	fourth := &mockDispatcher{}
	stats4, err := Run(ctx, pool, fourth)
	if err != nil {
		t.Fatalf("fourth Run: %v", err)
	}
	if stats4.ActivationNotices != 0 {
		t.Errorf("fourth run ActivationNotices = %d, want 0 (stamp survives)", stats4.ActivationNotices)
	}
}

// ─── 2. Extended cover ──────────────────────────────────────────────────────

func TestRunExtendedCoverPerLeadDayIdempotency(t *testing.T) {
	ctx := context.Background()
	pool := cronScratchDB(t)
	userID := leadDaysUser(t, pool, "vi")

	now := time.Now()
	midnight := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())

	// Deadline exactly 7 days out; leadDays [30, 7] so only the 7-day milestone
	// is in its window today.
	if _, err := pool.Exec(ctx, `
		INSERT INTO "Device" (id, "userId", name, category, "purchaseDate", "purchasePrice",
		                      status, "leadDays", "extendedCoverBuyBy", "createdAt", "updatedAt")
		VALUES ('ec_main', $1, 'Máy mua bảo hiểm', 'PHONE', $2, 1000000,
		        'ACTIVE', ARRAY[30, 7], $3, NOW(), NOW())`,
		userID, midnight.AddDate(0, -1, 0), midnight.AddDate(0, 0, 7).Add(12*time.Hour)); err != nil {
		t.Fatalf("insert extended-cover device: %v", err)
	}
	// A device whose own leadDays do NOT include 30 must never receive the
	// globally-run 30-day sweep, even if its deadline happens to land there.
	if _, err := pool.Exec(ctx, `
		INSERT INTO "Device" (id, "userId", name, category, "purchaseDate", "purchasePrice",
		                      status, "leadDays", "extendedCoverBuyBy", "createdAt", "updatedAt")
		VALUES ('ec_seven_only', $1, 'Máy chỉ mốc 7', 'PHONE', $2, 1000000,
		        'ACTIVE', ARRAY[7], $3, NOW(), NOW())`,
		userID, midnight.AddDate(0, -1, 0), midnight.AddDate(0, 0, 30).Add(12*time.Hour)); err != nil {
		t.Fatalf("insert lead-day-filter device: %v", err)
	}
	// No deadline at all: never selected.
	if _, err := pool.Exec(ctx, `
		INSERT INTO "Device" (id, "userId", name, category, "purchaseDate", "purchasePrice",
		                      status, "leadDays", "createdAt", "updatedAt")
		VALUES ('ec_none', $1, 'Máy không hạn', 'PHONE', $2, 1000000,
		        'ACTIVE', ARRAY[30, 7], NOW(), NOW())`,
		userID, midnight.AddDate(0, -1, 0)); err != nil {
		t.Fatalf("insert no-deadline device: %v", err)
	}

	mock := &mockDispatcher{}
	stats, err := Run(ctx, pool, mock)
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if stats.ExtendedCoverNotices != 1 {
		t.Errorf("ExtendedCoverNotices = %d, want 1 (7-day)", stats.ExtendedCoverNotices)
	}
	byTag := sendsByTag(mock.sends, "wv-extcover-")
	if _, ok := byTag["wv-extcover-7-ec_main"]; !ok {
		t.Fatalf("no 7-day extended-cover push; got tags %v", tagsOf(mock.sends))
	}
	title := byTag["wv-extcover-7-ec_main"]
	if !strings.Contains(title, "7 ngày") || !strings.Contains(title, "bảo hiểm mở rộng") {
		t.Errorf("7-day title = %q", title)
	}
	// The 30-day window is not today for ec_main, and ec_seven_only does not ask
	// for 30 at all.
	if _, ok := byTag["wv-extcover-30-ec_seven_only"]; ok {
		t.Error("30-day push sent to a device whose leadDays excludes 30")
	}
	if _, ok := byTag["wv-extcover-7-ec_none"]; ok {
		t.Error("push sent for a device with no extended-cover deadline")
	}

	// Same-day second run: the per-lead-day stamp suppresses the 7-day notice.
	second := &mockDispatcher{}
	stats2, err := Run(ctx, pool, second)
	if err != nil {
		t.Fatalf("second Run: %v", err)
	}
	if stats2.ExtendedCoverNotices != 0 {
		t.Errorf("second run ExtendedCoverNotices = %d, want 0", stats2.ExtendedCoverNotices)
	}

	// Move the SAME device's deadline to 30 days out, still on the same calendar
	// day. The 7-day stamp must not suppress the 30-day milestone: that is the
	// whole point of the per-lead-day key.
	if _, err := pool.Exec(ctx,
		`UPDATE "Device" SET "extendedCoverBuyBy" = $1 WHERE id = 'ec_main'`,
		midnight.AddDate(0, 0, 30).Add(12*time.Hour)); err != nil {
		t.Fatalf("move deadline: %v", err)
	}
	third := &mockDispatcher{}
	stats3, err := Run(ctx, pool, third)
	if err != nil {
		t.Fatalf("third Run: %v", err)
	}
	if stats3.ExtendedCoverNotices != 1 {
		t.Errorf("third run ExtendedCoverNotices = %d, want 1 (30-day, different key)", stats3.ExtendedCoverNotices)
	}
	if _, ok := sendsByTag(third.sends, "wv-extcover-")["wv-extcover-30-ec_main"]; !ok {
		t.Fatalf("no 30-day push after moving the deadline; got tags %v", tagsOf(third.sends))
	}

	// Clearing the deadline stops the notices entirely.
	if _, err := pool.Exec(ctx,
		`UPDATE "Device" SET "extendedCoverBuyBy" = NULL WHERE id = 'ec_main'`); err != nil {
		t.Fatalf("clear deadline: %v", err)
	}
	fourth := &mockDispatcher{}
	stats4, err := Run(ctx, pool, fourth)
	if err != nil {
		t.Fatalf("fourth Run: %v", err)
	}
	if stats4.ExtendedCoverNotices != 0 {
		t.Errorf("fourth run ExtendedCoverNotices = %d, want 0", stats4.ExtendedCoverNotices)
	}
}

// ─── 3. Subscription trial ──────────────────────────────────────────────────

func TestRunTrialReminderFiresOnceAndDiffersFromRenewal(t *testing.T) {
	ctx := context.Background()
	pool := cronScratchDB(t)
	userID := leadDaysUser(t, pool, "vi")

	now := time.Now()
	midnight := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	price := int32(260000)

	// trialEndsAt exactly 3 days out; renewalDate far in the future so the
	// renewal sweep cannot be what produces the push.
	trialEnd := midnight.AddDate(0, 0, 3).Add(12 * time.Hour)
	if _, err := pool.Exec(ctx, `
		INSERT INTO "Subscription" (id, "userId", name, "billingCycle", price,
		                            "startedAt", "renewalDate", "autoRenew", status,
		                            "leadDays", "trialEndsAt", "convertsToPrice",
		                            "createdAt", "updatedAt")
		VALUES ('trial_main', $1, 'Gói dùng thử', 'MONTHLY', 0, $2, $3, true, 'ACTIVE',
		        ARRAY[3, 1, 0], $4, $5, NOW(), NOW())`,
		userID, midnight.AddDate(0, 0, -10), midnight.AddDate(1, 0, 0), trialEnd, price); err != nil {
		t.Fatalf("insert trial subscription: %v", err)
	}

	mock := &mockDispatcher{}
	stats, err := Run(ctx, pool, mock)
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if stats.TrialNotices != 1 {
		t.Errorf("TrialNotices = %d, want 1", stats.TrialNotices)
	}
	byTag := sendsByTag(mock.sends, "sub-trial-")
	title, ok := byTag["sub-trial-3-trial_main"]
	if !ok {
		t.Fatalf("no trial push; got tags %v", tagsOf(mock.sends))
	}
	// Distinct wording: a trial asks the user to DECIDE; a renewal talks about
	// automatic renewal/expiry. The title must not read like the renewal one.
	if !strings.Contains(title, "Dùng thử") || !strings.Contains(title, "3 ngày") {
		t.Errorf("trial title = %q", title)
	}
	if strings.Contains(title, "tự gia hạn") || strings.Contains(title, "hết hạn:") {
		t.Errorf("trial title reuses renewal wording: %q", title)
	}

	// The body names the date and the conversion price, and the action verb is
	// "decide", not "renew".
	var body string
	for _, s := range mock.sends {
		if s.payload.Tag == "sub-trial-3-trial_main" {
			body = s.payload.Body
		}
	}
	if !strings.Contains(body, "260.000 ₫") {
		t.Errorf("trial body = %q, want the conversion price", body)
	}
	if !strings.Contains(body, "Quyết định giữ hay huỷ") {
		t.Errorf("trial body = %q, want the decide-before-billing wording", body)
	}

	// Same-day second run is a no-op.
	second := &mockDispatcher{}
	stats2, err := Run(ctx, pool, second)
	if err != nil {
		t.Fatalf("second Run: %v", err)
	}
	if stats2.TrialNotices != 0 {
		t.Errorf("second run TrialNotices = %d, want 0", stats2.TrialNotices)
	}
	for _, s := range second.sends {
		if strings.HasPrefix(s.payload.Tag, "sub-trial-") {
			t.Errorf("second run re-sent %q", s.payload.Tag)
		}
	}

	// trialEndsAt WITHOUT convertsToPrice is valid and gets a body with no price.
	if _, err := pool.Exec(ctx, `
		INSERT INTO "Subscription" (id, "userId", name, "billingCycle", price,
		                            "startedAt", "renewalDate", "autoRenew", status,
		                            "leadDays", "trialEndsAt", "createdAt", "updatedAt")
		VALUES ('trial_noprice', $1, 'Gói chỉ có ngày', 'MONTHLY', 0, $2, $3, true, 'ACTIVE',
		        ARRAY[3], $4, NOW(), NOW())`,
		userID, midnight.AddDate(0, 0, -10), midnight.AddDate(1, 0, 0), trialEnd); err != nil {
		t.Fatalf("insert date-only trial: %v", err)
	}
	third := &mockDispatcher{}
	stats3, err := Run(ctx, pool, third)
	if err != nil {
		t.Fatalf("third Run: %v", err)
	}
	if stats3.TrialNotices != 1 {
		t.Errorf("third run TrialNotices = %d, want 1 (date-only trial)", stats3.TrialNotices)
	}
	var noPriceBody string
	for _, s := range third.sends {
		if s.payload.Tag == "sub-trial-3-trial_noprice" {
			noPriceBody = s.payload.Body
		}
	}
	if noPriceBody == "" {
		t.Fatalf("no date-only trial push; got tags %v", tagsOf(third.sends))
	}
	if strings.Contains(noPriceBody, "₫") {
		t.Errorf("date-only trial body mentions a price: %q", noPriceBody)
	}
}

// The trial and the renewal reminders for the SAME subscription can land on the
// same day (a trial that ends on the renewal date is unusual but possible, and
// the lead-day windows can overlap). Their markers are separate on purpose; this
// pins that one does not suppress the other.
func TestRunTrialAndRenewalCanBothFireSameDay(t *testing.T) {
	ctx := context.Background()
	pool := cronScratchDB(t)
	userID := leadDaysUser(t, pool, "vi")

	now := time.Now()
	midnight := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	due := midnight.AddDate(0, 0, 3).Add(12 * time.Hour)

	if _, err := pool.Exec(ctx, `
		INSERT INTO "Subscription" (id, "userId", name, "billingCycle", price,
		                            "startedAt", "renewalDate", "autoRenew", status,
		                            "leadDays", "trialEndsAt", "convertsToPrice",
		                            "createdAt", "updatedAt")
		VALUES ('both', $1, 'Gói vừa hết dùng thử vừa gia hạn', 'MONTHLY', 50000,
		        $2, $3, true, 'ACTIVE', ARRAY[3], $3, 260000, NOW(), NOW())`,
		userID, midnight.AddDate(0, -1, 0), due); err != nil {
		t.Fatalf("insert subscription: %v", err)
	}

	mock := &mockDispatcher{}
	stats, err := Run(ctx, pool, mock)
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	// The renewal warning is the 3-day bucket, and the trial notice is its own.
	if stats.SubscriptionRenewals != 0 {
		t.Errorf("SubscriptionRenewals = %d, want 0 (nothing overdue)", stats.SubscriptionRenewals)
	}
	var renewal, trial bool
	for _, s := range mock.sends {
		if s.payload.Tag == "sub-d3-both" {
			renewal = true
		}
		if s.payload.Tag == "sub-trial-3-both" {
			trial = true
		}
	}
	if !renewal {
		t.Errorf("renewal warning missing; got tags %v", tagsOf(mock.sends))
	}
	if !trial {
		t.Errorf("trial notice missing; got tags %v", tagsOf(mock.sends))
	}

	// Still idempotent as a pair on a second same-day run.
	second := &mockDispatcher{}
	stats2, err := Run(ctx, pool, second)
	if err != nil {
		t.Fatalf("second Run: %v", err)
	}
	if stats2.TrialNotices != 0 {
		t.Errorf("second run TrialNotices = %d, want 0", stats2.TrialNotices)
	}
	for _, s := range second.sends {
		if strings.HasPrefix(s.payload.Tag, "sub-d3-") || strings.HasPrefix(s.payload.Tag, "sub-trial-") {
			t.Errorf("second run re-sent %q", s.payload.Tag)
		}
	}
}

// ─── 4. Legacy rows: no new behaviour ───────────────────────────────────────

// A user who never sets any migration-0016 field must see exactly the pushes
// they saw before this feature existed: none of the three new notices. This is
// the notification-layer half of the "byte-identical behaviour" promise.
func TestRunNoActivationOrTrialNoticesForLegacyRows(t *testing.T) {
	ctx := context.Background()
	pool := cronScratchDB(t)
	userID := leadDaysUser(t, pool, "vi")

	now := time.Now()
	midnight := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())

	if _, err := pool.Exec(ctx, `
		INSERT INTO "Device" (id, "userId", name, category, "purchaseDate", "purchasePrice",
		                      status, "createdAt", "updatedAt")
		VALUES ('legacy_device', $1, 'Máy cũ', 'PHONE', $2, 1000000, 'ACTIVE', NOW(), NOW())`,
		userID, midnight.AddDate(0, -6, 0)); err != nil {
		t.Fatalf("insert legacy device: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO "Subscription" (id, "userId", name, "billingCycle", price,
		                            "startedAt", "renewalDate", "autoRenew", status,
		                            "createdAt", "updatedAt")
		VALUES ('legacy_sub', $1, 'Gói cũ', 'MONTHLY', 100000, $2, $3, true, 'ACTIVE',
		        NOW(), NOW())`,
		userID, midnight.AddDate(0, -1, 0), midnight.AddDate(0, 1, 0)); err != nil {
		t.Fatalf("insert legacy subscription: %v", err)
	}

	mock := &mockDispatcher{}
	stats, err := Run(ctx, pool, mock)
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if stats.ActivationNotices != 0 {
		t.Errorf("ActivationNotices = %d, want 0 for a legacy device", stats.ActivationNotices)
	}
	if stats.ExtendedCoverNotices != 0 {
		t.Errorf("ExtendedCoverNotices = %d, want 0 for a legacy device", stats.ExtendedCoverNotices)
	}
	if stats.TrialNotices != 0 {
		t.Errorf("TrialNotices = %d, want 0 for a legacy subscription", stats.TrialNotices)
	}
	for _, s := range mock.sends {
		switch {
		case strings.HasPrefix(s.payload.Tag, "wv-activation-"),
			strings.HasPrefix(s.payload.Tag, "wv-extcover-"),
			strings.HasPrefix(s.payload.Tag, "sub-trial-"):
			t.Errorf("legacy run sent a migration-0016 notice %q", s.payload.Tag)
		}
	}
}
