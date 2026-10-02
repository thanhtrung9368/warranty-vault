package services

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// ---- DB-free: query-parameter parsing lives in the handler ------------------

// parseBoolQuery is tested in internal/handlers/reminders_test.go.

// ---- real-database: the feed predicate -------------------------------------

// Roadmap #5: dismissed reminders must be readable again without falling back to
// a full backup export, hidden rows must survive both the endDate window and a
// non-ACTIVE device, and the default path must not change shape.
func TestListUpcomingRemindersIncludeDismissedAgainstRealPostgres(t *testing.T) {
	dsn := testDatabaseURL(t)
	gooseUp(t, dsn)

	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)

	const (
		userID = "zz_test_reminders_user"
		// Devices.
		devActive = "zz_test_rem_dev_active"
		devSold   = "zz_test_rem_dev_sold"
		// Warranties.
		warActiveSoon   = "zz_test_rem_war_active_soon"   // in window, ACTIVE device, not dismissed
		warActiveHidden = "zz_test_rem_war_active_hidden" // in window, ACTIVE device, dismissed
		warSoldHidden   = "zz_test_rem_war_sold_hidden"   // out of window, SOLD device, dismissed
		warSoldOld      = "zz_test_rem_war_sold_old"      // out of window, SOLD device, not dismissed
		warActiveOld    = "zz_test_rem_war_active_old"    // out of window, ACTIVE device, not dismissed
		warDoubleRemind = "zz_test_rem_war_double"        // two Reminder rows, one dismissed
	)
	inWindow := time.Now().AddDate(0, 0, 10)
	longAgo := time.Now().AddDate(-3, 0, 0)

	if _, err := pool.Exec(ctx,
		`INSERT INTO "User" (id, email, "passwordHash", "updatedAt") VALUES ($1, $2, 'x', NOW())
		 ON CONFLICT (id) DO NOTHING`, userID, userID+"@example.invalid"); err != nil {
		t.Fatalf("insert test user: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM "User" WHERE id = $1`, userID)
	})

	insertDevice := func(id, status string) {
		t.Helper()
		if _, err := pool.Exec(ctx,
			`INSERT INTO "Device" (id, "userId", name, category, status, "purchaseDate", "purchasePrice", "updatedAt")
			 VALUES ($1, $2, $3, 'PHONE', $4, '2022-01-01', 1000000, NOW())`, id, userID, id, status); err != nil {
			t.Fatalf("insert device %s: %v", id, err)
		}
	}
	insertDevice(devActive, "ACTIVE")
	insertDevice(devSold, "SOLD")

	insertWarranty := func(id, deviceID string, end time.Time) {
		t.Helper()
		if _, err := pool.Exec(ctx,
			`INSERT INTO "Warranty" (id, "deviceId", type, "startDate", "endDate", months, "updatedAt")
			 VALUES ($1, $2, 'STANDARD', $3, $4, 12, NOW())`, id, deviceID, end.AddDate(-1, 0, 0), end); err != nil {
			t.Fatalf("insert warranty %s: %v", id, err)
		}
	}
	insertWarranty(warActiveSoon, devActive, inWindow)
	insertWarranty(warActiveHidden, devActive, inWindow)
	insertWarranty(warSoldHidden, devSold, longAgo)
	insertWarranty(warSoldOld, devSold, longAgo)
	insertWarranty(warActiveOld, devActive, longAgo)
	insertWarranty(warDoubleRemind, devActive, inWindow)

	insertReminder := func(id, warrantyID string, dismissed bool) {
		t.Helper()
		if _, err := pool.Exec(ctx,
			`INSERT INTO "Reminder" (id, "warrantyId", "isDismissed", "createdAt")
			 VALUES ($1, $2, $3, NOW())`, id, warrantyID, dismissed); err != nil {
			t.Fatalf("insert reminder %s: %v", id, err)
		}
	}
	insertReminder("zz_test_rem_rem_active_hidden", warActiveHidden, true)
	insertReminder("zz_test_rem_rem_sold_hidden", warSoldHidden, true)
	// Two rows for one warranty where at least one is dismissed: the row must be
	// reported once, as dismissed (guards the bool_or aggregate against a plain
	// LEFT JOIN that would duplicate the warranty).
	insertReminder("zz_test_rem_rem_double_a", warDoubleRemind, false)
	insertReminder("zz_test_rem_rem_double_b", warDoubleRemind, true)

	// ---- default: exactly the pre-flag feed ---------------------------------
	got, err := ListUpcomingReminders(ctx, pool, userID, 30, false)
	if err != nil {
		t.Fatalf("ListUpcomingReminders(default): %v", err)
	}
	ids := map[string]ReminderRow{}
	for _, r := range got {
		ids[r.ID] = r
	}
	if _, ok := ids[warActiveSoon]; !ok {
		t.Errorf("default feed is missing the active in-window warranty %s", warActiveSoon)
	}
	for _, hidden := range []string{warActiveHidden, warSoldHidden, warDoubleRemind} {
		if _, ok := ids[hidden]; ok {
			t.Errorf("default feed returned dismissed warranty %s — includeDismissed=false must keep the old predicate", hidden)
		}
	}
	for _, out := range []string{warSoldOld, warActiveOld} {
		if _, ok := ids[out]; ok {
			t.Errorf("default feed returned out-of-window warranty %s", out)
		}
	}

	// ---- includeDismissed: hidden rows come back ----------------------------
	got, err = ListUpcomingReminders(ctx, pool, userID, 30, true)
	if err != nil {
		t.Fatalf("ListUpcomingReminders(includeDismissed): %v", err)
	}
	ids = map[string]ReminderRow{}
	counts := map[string]int{}
	for _, r := range got {
		ids[r.ID] = r
		counts[r.ID]++
	}

	// The active in-window reminder is unchanged.
	if r, ok := ids[warActiveSoon]; !ok {
		t.Error("includeDismissed=true dropped the active in-window reminder")
	} else if r.IsDismissed {
		t.Error("active reminder reported isDismissed=true")
	}
	// Hidden in-window reminder.
	if r, ok := ids[warActiveHidden]; !ok {
		t.Error("includeDismissed=true did not return the dismissed in-window reminder")
	} else if !r.IsDismissed {
		t.Error("dismissed reminder reported isDismissed=false")
	}
	// Hidden reminder on a SOLD device with an end date 3 years ago: no window,
	// no ACTIVE requirement for hidden rows.
	if r, ok := ids[warSoldHidden]; !ok {
		t.Error("includeDismissed=true dropped a dismissed reminder because its device was SOLD and/or outside withinDays")
	} else {
		if !r.IsDismissed {
			t.Error("dismissed reminder reported isDismissed=false")
		}
		if r.Device.Status != "SOLD" {
			t.Errorf("device ref status = %q, want SOLD (the UI badge needs it)", r.Device.Status)
		}
	}
	// Non-dismissed rows still respect window + ACTIVE.
	for _, out := range []string{warSoldOld, warActiveOld} {
		if _, ok := ids[out]; ok {
			t.Errorf("includeDismissed=true returned the non-dismissed out-of-window warranty %s", out)
		}
	}
	// Duplicate Reminder rows must not duplicate the warranty row.
	if counts[warDoubleRemind] != 1 {
		t.Errorf("warranty with two Reminder rows returned %d times, want 1", counts[warDoubleRemind])
	}
	if r, ok := ids[warDoubleRemind]; !ok {
		t.Error("warranty with a dismissed Reminder row missing from includeDismissed=true")
	} else if !r.IsDismissed {
		t.Error("warranty with one dismissed Reminder row reported isDismissed=false")
	}

	// ---- response shape -----------------------------------------------------
	activeJSON, err := json.Marshal(ids[warActiveSoon])
	if err != nil {
		t.Fatalf("marshal active row: %v", err)
	}
	hiddenJSON, err := json.Marshal(ids[warActiveHidden])
	if err != nil {
		t.Fatalf("marshal hidden row: %v", err)
	}
	if strings.Contains(string(activeJSON), "isDismissed") {
		t.Errorf("non-dismissed row serialised an isDismissed key: %s — clients must be able to default missing=false", activeJSON)
	}
	if !strings.Contains(string(hiddenJSON), `"isDismissed":true`) {
		t.Errorf("dismissed row JSON = %s, want an isDismissed:true key", hiddenJSON)
	}
	for _, raw := range []string{string(activeJSON), string(hiddenJSON)} {
		if !strings.Contains(raw, `"status":"`) {
			t.Errorf("device ref is missing status: %s", raw)
		}
	}

	// The default-path payload must be byte-identical to the pre-flag shape: no
	// isDismissed key anywhere, and device.status present.
	got, err = ListUpcomingReminders(ctx, pool, userID, 30, false)
	if err != nil {
		t.Fatalf("ListUpcomingReminders(default, shape): %v", err)
	}
	raw, err := json.Marshal(map[string]any{"reminders": got})
	if err != nil {
		t.Fatalf("marshal default payload: %v", err)
	}
	if strings.Contains(string(raw), "isDismissed") {
		t.Errorf("default payload contains isDismissed: %s", raw)
	}
}
