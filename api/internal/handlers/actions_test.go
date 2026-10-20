package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/thanhtrung9368/warranty-vault/api/internal/auth"
	"github.com/thanhtrung9368/warranty-vault/api/internal/services"
)

// "Việc cần xử lý" over HTTP (FEATURE_IDEAS #3):
//
//   - items are DERIVED (no write happens when listing),
//   - "bảo hành hết hạn hôm qua" shows up here and NOT in the reminders feed,
//   - a snooze survives across devices because it is keyed by user, not session,
//   - a key that is not the caller's own item can never be snoozed.
//
// Runs against its own scratch database. Dates are relative to the wall clock
// because the handler calls time.Now().
func TestActionQueueOverHTTP(t *testing.T) {
	dsn := testDatabaseURL(t)
	gooseUp(t, dsn)
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)

	hash, err := auth.Hash(testPassword)
	if err != nil {
		t.Fatalf("hash: %v", err)
	}
	const userID = "zz_test_action_queue_user"
	const otherID = "zz_test_action_queue_other"
	insertUser(t, pool, userID, "action-queue@example.invalid", hash)
	insertUser(t, pool, otherID, "action-queue-other@example.invalid", hash)
	deleteUsers(t, pool, userID, otherID)

	// Two sessions for the SAME user: the "other device" the snooze must survive to.
	deviceA, err := auth.IssueToken(ctx, pool, userID, nil, nil)
	if err != nil {
		t.Fatalf("issue token A: %v", err)
	}
	deviceB, err := auth.IssueToken(ctx, pool, userID, nil, nil)
	if err != nil {
		t.Fatalf("issue token B: %v", err)
	}
	otherUser, err := auth.IssueToken(ctx, pool, otherID, nil, nil)
	if err != nil {
		t.Fatalf("issue token other: %v", err)
	}

	// ── Fixtures ───────────────────────────────────────────────────────────
	// Device 1: warranty that expired 2 days ago → WARRANTY_EXPIRED (and it must
	// NOT appear in /api/v1/reminders, which only looks forward).
	// Device 2: ACTIVE with no warranty at all → DEVICE_NO_WARRANTY, and it is
	// recent enough to also be RETURN_WINDOW_UNKNOWN.
	if _, err := pool.Exec(ctx, `
		INSERT INTO "Device" (id, "userId", name, category, "purchaseDate", "purchasePrice",
		                      "serialNumber", status, "createdAt", "updatedAt")
		VALUES ('aq_dev_expired', $1, 'Máy vừa hết BH', 'LAPTOP', NOW() - INTERVAL '400 days',
		        30000000, 'SN-EXPIRED', 'ACTIVE', NOW(), NOW()),
		       ('aq_dev_bare', $1, 'Máy chưa có BH', 'PHONE', NOW() - INTERVAL '5 days',
		        5000000, NULL, 'ACTIVE', NOW(), NOW())`, userID); err != nil {
		t.Fatalf("insert devices: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO "Warranty" (id, "deviceId", type, "startDate", "endDate", months, "createdAt", "updatedAt")
		VALUES ('aq_war_expired', 'aq_dev_expired', 'STANDARD',
		        NOW() - INTERVAL '400 days', NOW() - INTERVAL '2 days', 12, NOW(), NOW())`); err != nil {
		t.Fatalf("insert warranty: %v", err)
	}
	// A subscription renewing in 5 days with no cancel URL → the cancel-link rule.
	if _, err := pool.Exec(ctx, `
		INSERT INTO "Subscription" (id, "userId", name, "billingCycle", price, currency,
		                            "startedAt", "renewalDate", "autoRenew", status, "createdAt", "updatedAt")
		VALUES ('aq_sub_nocancel', $1, 'Netflix', 'MONTHLY', 260000, 'VND',
		        NOW() - INTERVAL '1 year', NOW() + INTERVAL '5 days', true, 'ACTIVE', NOW(), NOW())`,
		userID); err != nil {
		t.Fatalf("insert subscription: %v", err)
	}

	mux := http.NewServeMux()
	RegisterActions(mux, Deps{DB: pool, Limiter: &permissiveLimiter{}})
	RegisterReminders(mux, Deps{DB: pool, Limiter: &permissiveLimiter{}})

	do := func(method, url, bearer, body string) *httptest.ResponseRecorder {
		t.Helper()
		var req *http.Request
		if body == "" {
			req = httptest.NewRequest(method, url, nil)
		} else {
			req = httptest.NewRequest(method, url, bytes.NewReader([]byte(body)))
			req.Header.Set("Content-Type", "application/json")
		}
		if bearer != "" {
			req.Header.Set("Authorization", "Bearer "+bearer)
		}
		rr := httptest.NewRecorder()
		mux.ServeHTTP(rr, req)
		return rr
	}

	readQueue := func(bearer, query string) services.ActionQueue {
		t.Helper()
		rr := do(http.MethodGet, "/api/v1/actions"+query, bearer, "")
		if rr.Code != http.StatusOK {
			t.Fatalf("GET /actions%s = %d (%s)", query, rr.Code, rr.Body.String())
		}
		var q services.ActionQueue
		if err := json.Unmarshal(rr.Body.Bytes(), &q); err != nil {
			t.Fatalf("decode queue: %v", err)
		}
		return q
	}
	kindSet := func(q services.ActionQueue) map[string]services.ActionItem {
		out := map[string]services.ActionItem{}
		for _, it := range q.Items {
			out[it.Kind] = it
		}
		return out
	}

	// ── 1. Auth + parameter validation ─────────────────────────────────────
	if rr := do(http.MethodGet, "/api/v1/actions", "", ""); rr.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated = %d, want 401", rr.Code)
	}
	if rr := do(http.MethodGet, "/api/v1/actions?snoozed=maybe", deviceA.AccessToken, ""); rr.Code != http.StatusBadRequest {
		t.Fatalf("snoozed=maybe = %d, want 400", rr.Code)
	}

	// ── 2. Derivation ──────────────────────────────────────────────────────
	queue := readQueue(deviceA.AccessToken, "")
	byKind := kindSet(queue)
	for _, want := range []string{
		services.ActionWarrantyExpired,
		services.ActionDeviceNoWarranty,
		services.ActionDeviceMissingSerial,
		services.ActionDeviceMissingReceipt,
		services.ActionReturnWindowUnknown,
		services.ActionSubRenewingNoCancelURL,
	} {
		if _, ok := byKind[want]; !ok {
			t.Errorf("missing %s in %v", want, queue.Items)
		}
	}
	expired, ok := byKind[services.ActionWarrantyExpired]
	if !ok {
		t.Fatalf("no WARRANTY_EXPIRED item: %s", mustJSON(queue))
	}
	if expired.Severity != services.ActionSeverityHigh {
		t.Errorf("WARRANTY_EXPIRED severity = %s, want HIGH", expired.Severity)
	}
	if expired.WarrantyID == nil || *expired.WarrantyID != "aq_war_expired" {
		t.Errorf("warrantyId = %v", expired.WarrantyID)
	}
	if expired.ItemKey != "WARRANTY_EXPIRED:aq_war_expired" {
		t.Errorf("itemKey = %q", expired.ItemKey)
	}
	if expired.Title == "" || expired.Detail == "" || expired.DueDate == nil {
		t.Errorf("item is not display-ready: %+v", expired)
	}
	// A subscription item carries VND as int64 (money is int32 per row, int64 in
	// transit) — 260.000 is well inside int32, but the field type must not be.
	if sub, ok := byKind[services.ActionSubRenewingNoCancelURL]; ok {
		if sub.AmountVnd == nil || *sub.AmountVnd != 260000 {
			t.Errorf("subscription amountVnd = %v, want 260000", sub.AmountVnd)
		}
	}
	if queue.Counts.Total != len(queue.Items) {
		t.Errorf("counts.total = %d but there are %d items", queue.Counts.Total, len(queue.Items))
	}
	if queue.Counts.High < 1 {
		t.Errorf("counts.high = %d, want at least the expired warranty", queue.Counts.High)
	}
	if queue.Note == "" {
		t.Error("note is empty; clients must not have to guess what the queue is")
	}
	if queue.SnoozedCount != 0 {
		t.Errorf("snoozedCount = %d, want 0 before any snooze", queue.SnoozedCount)
	}

	// The expired warranty must NOT be in the forward-looking reminders feed.
	rrRem := do(http.MethodGet, "/api/v1/reminders?withinDays=365", deviceA.AccessToken, "")
	if rrRem.Code != http.StatusOK {
		t.Fatalf("GET /reminders = %d (%s)", rrRem.Code, rrRem.Body.String())
	}
	var feed struct {
		Reminders []struct {
			ID string `json:"id"`
		} `json:"reminders"`
	}
	if err := json.Unmarshal(rrRem.Body.Bytes(), &feed); err != nil {
		t.Fatalf("decode reminders: %v", err)
	}
	for _, r := range feed.Reminders {
		if r.ID == "aq_war_expired" {
			t.Fatalf("the reminders feed now returns an expired warranty — its contract was supposed to be untouched")
		}
	}

	// ── 3. Snooze, and survival across devices ─────────────────────────────
	key := expired.ItemKey
	rr := do(http.MethodPost, "/api/v1/actions/"+key+"/snooze", deviceA.AccessToken, "")
	if rr.Code != http.StatusOK {
		t.Fatalf("snooze = %d (%s)", rr.Code, rr.Body.String())
	}
	var snoozed services.SnoozeResult
	if err := json.Unmarshal(rr.Body.Bytes(), &snoozed); err != nil {
		t.Fatalf("decode snooze: %v", err)
	}
	if snoozed.Days != services.SnoozeDaysDefault {
		t.Errorf("days = %d, want the %d default when no body is sent", snoozed.Days, services.SnoozeDaysDefault)
	}

	after := readQueue(deviceA.AccessToken, "")
	if _, still := kindSet(after)[services.ActionWarrantyExpired]; still {
		t.Error("the snoozed item is still in the default queue")
	}
	if after.SnoozedCount != 1 {
		t.Errorf("snoozedCount = %d, want 1", after.SnoozedCount)
	}
	if after.Counts.Total != queue.Counts.Total-1 {
		t.Errorf("counts.total = %d, want %d", after.Counts.Total, queue.Counts.Total-1)
	}

	// THE POINT OF THE FEATURE: a different session of the same user sees the same
	// snooze, because the row is keyed by (userId, itemKey) and lives on the server.
	fromOtherDevice := readQueue(deviceB.AccessToken, "")
	if _, still := kindSet(fromOtherDevice)[services.ActionWarrantyExpired]; still {
		t.Error("the snooze did not survive to the user's other device")
	}
	if fromOtherDevice.SnoozedCount != 1 {
		t.Errorf("other device snoozedCount = %d, want 1", fromOtherDevice.SnoozedCount)
	}

	// ?snoozed=true ADDS the hidden rows (and only adds).
	withSnoozed := readQueue(deviceB.AccessToken, "?snoozed=true")
	hidden, ok := kindSet(withSnoozed)[services.ActionWarrantyExpired]
	if !ok {
		t.Fatalf("snoozed=true did not return the hidden item: %s", mustJSON(withSnoozed))
	}
	if hidden.SnoozedUntil == nil {
		t.Error("a hidden row must carry snoozedUntil so a client can render the un-snooze list")
	}
	if len(withSnoozed.Items) != len(after.Items)+1 {
		t.Errorf("snoozed=true returned %d items, want %d (the flag only ever ADDS)", len(withSnoozed.Items), len(after.Items)+1)
	}
	// counts never changes meaning with the flag: it counts what is actionable.
	if withSnoozed.Counts.Total != after.Counts.Total {
		t.Errorf("counts.total changed with snoozed=true: %d vs %d", withSnoozed.Counts.Total, after.Counts.Total)
	}
	if withSnoozed.Counts.Total != len(withSnoozed.Items)-1 {
		t.Errorf("counts.total = %d but %d items are actionable", withSnoozed.Counts.Total, len(withSnoozed.Items)-1)
	}

	// ── 4. Un-snooze ──────────────────────────────────────────────────────
	if rr = do(http.MethodDelete, "/api/v1/actions/"+key+"/snooze", deviceB.AccessToken, ""); rr.Code != http.StatusOK {
		t.Fatalf("un-snooze = %d (%s)", rr.Code, rr.Body.String())
	}
	if _, back := kindSet(readQueue(deviceA.AccessToken, ""))[services.ActionWarrantyExpired]; !back {
		t.Error("the item did not come back after un-snoozing")
	}
	// Un-snoozing twice is a 404, not a silent 200 — the client's state was stale.
	if rr = do(http.MethodDelete, "/api/v1/actions/"+key+"/snooze", deviceB.AccessToken, ""); rr.Code != http.StatusNotFound {
		t.Errorf("second un-snooze = %d, want 404", rr.Code)
	}

	// ── 5. Validation and ownership ───────────────────────────────────────
	if rr = do(http.MethodPost, "/api/v1/actions/"+key+"/snooze", deviceA.AccessToken, `{"days":999}`); rr.Code != http.StatusBadRequest {
		t.Errorf("days=999 = %d, want 400", rr.Code)
	}
	if rr = do(http.MethodPost, "/api/v1/actions/"+key+"/snooze", deviceA.AccessToken, `{"days":30}`); rr.Code != http.StatusOK {
		t.Fatalf("days=30 = %d (%s)", rr.Code, rr.Body.String())
	}
	var thirty services.SnoozeResult
	_ = json.Unmarshal(rr.Body.Bytes(), &thirty)
	if thirty.Days != 30 {
		t.Errorf("days = %d, want 30", thirty.Days)
	}
	// Re-snoozing the SAME key must not stack rows: it is an upsert.
	if rr = do(http.MethodPost, "/api/v1/actions/"+key+"/snooze", deviceA.AccessToken, `{"days":10}`); rr.Code != http.StatusOK {
		t.Fatalf("re-snooze = %d (%s)", rr.Code, rr.Body.String())
	}
	var snoozeRows int
	if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM "DecisionSnooze" WHERE "userId" = $1`, userID).Scan(&snoozeRows); err != nil {
		t.Fatalf("count snoozes: %v", err)
	}
	if snoozeRows != 1 {
		t.Errorf("DecisionSnooze rows = %d, want 1 (re-snoozing must upsert, not append)", snoozeRows)
	}

	// A syntactically invalid key is a 400 (a typo is not "this item is gone").
	for _, bad := range []string{"NOT_A_KIND:abc", "WARRANTY_EXPIRED:", "nocolon"} {
		if rr = do(http.MethodPost, "/api/v1/actions/"+bad+"/snooze", deviceA.AccessToken, ""); rr.Code != http.StatusBadRequest {
			t.Errorf("snooze(%q) = %d, want 400", bad, rr.Code)
		}
	}

	// A well-formed key for an item that does not exist → 404.
	if rr = do(http.MethodPost, "/api/v1/actions/WARRANTY_EXPIRED:does_not_exist/snooze", deviceA.AccessToken, ""); rr.Code != http.StatusNotFound {
		t.Errorf("unknown item = %d, want 404", rr.Code)
	}

	// Another user's real item can never be snoozed by this account: the key is
	// validated against the caller's OWN derived items, so it reads as not found
	// rather than leaking that it exists.
	if rr = do(http.MethodPost, "/api/v1/actions/"+key+"/snooze", otherUser.AccessToken, ""); rr.Code != http.StatusNotFound {
		t.Errorf("cross-user snooze = %d, want 404", rr.Code)
	}
	var foreignRows int
	if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM "DecisionSnooze" WHERE "userId" = $1`, otherID).Scan(&foreignRows); err != nil {
		t.Fatalf("count foreign snoozes: %v", err)
	}
	if foreignRows != 0 {
		t.Errorf("another user has %d snooze rows, want 0", foreignRows)
	}

	// ── 6. Deleting the account takes its snoozes with it (FK ON DELETE CASCADE).
	//      A snooze is a derived-string key with no FK to the item, so this is the
	//      only cleanup path that can exist — and it must actually work, or the
	//      table would accumulate rows for accounts that no longer exist.
	if _, err := pool.Exec(ctx, `DELETE FROM "User" WHERE id = $1`, userID); err != nil {
		t.Fatalf("delete user: %v", err)
	}
	var remaining int
	if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM "DecisionSnooze" WHERE "userId" = $1`, userID).Scan(&remaining); err != nil {
		t.Fatalf("count after user delete: %v", err)
	}
	if remaining != 0 {
		t.Errorf("snooze rows survived the user deletion: %d", remaining)
	}
}

// TestActionQueueDetailParamsCarryTheDayCount covers the ADDITIVE half of the
// /actions payload. `detail` is a finished sentence with the day count baked in
// (the clients render it verbatim), so a reader outside Vietnam reads the count
// as of the server's day. The fix is `detailParams` — the count, the kind and
// the calendar day it was measured against — NOT a change to `detail`.
//
// All four count-bearing kinds are seeded at exactly ONE day so the singular
// form is the one the server must pick, in BOTH languages. That is the boundary
// a client re-rendering the count is most likely to get wrong ("1 days"), and
// it is also where `days` and the sentence must agree. The `asOf` assertions
// prove the number is not just "some count": it is the day distance between
// DueDate and the day the server measured against, in the direction Kind means.
//
// This reuses setupWave5Env (same package) for a scratch database + an
// authenticated mux with RegisterActions; it needs nothing wave-5-specific.
func TestActionQueueDetailParamsCarryTheDayCount(t *testing.T) {
	env := setupWave5Env(t, nil)
	ctx := context.Background()

	// Every fixture is pinned to a calendar day computed here, not to NOW().
	// The session is UTC while the process day is local (Asia/Ho_Chi_Minh in
	// production, UTC on CI), so a NOW()-relative fixture slides across midnight
	// in one of the two and would make the expected count flaky. Stored at
	// 00:00 UTC, these are the Day semantics the API documents.
	now := time.Now()
	day := func(offset int) time.Time {
		return time.Date(now.Year(), now.Month(), now.Day()+offset, 0, 0, 0, 0, time.UTC)
	}

	// WARRANTY_EXPIRED: a covered device whose warranty ended yesterday.
	// RETURN_WINDOW_CLOSING: the exchange window closes tomorrow
	// (purchaseDate day(-6) + 7 days).
	if _, err := env.pool.Exec(ctx, `
		INSERT INTO "Device" (id, "userId", name, category, "purchaseDate", "purchasePrice",
		                      "serialNumber", "returnWindowDays", status, "createdAt", "updatedAt")
		VALUES ('dp_dev_expired', $1, 'Máy hết bảo hành', 'LAPTOP', $2, 30000000,
		        'SN-DP-1', NULL, 'ACTIVE', NOW(), NOW()),
		       ('dp_dev_return', $1, 'Máy sắp hết đổi trả', 'PHONE', $3, 5000000,
		        'SN-DP-2', 7, 'ACTIVE', NOW(), NOW())`,
		env.userID, day(-400), day(-6)); err != nil {
		t.Fatalf("insert devices: %v", err)
	}
	if _, err := env.pool.Exec(ctx, `
		INSERT INTO "Warranty" (id, "deviceId", type, "startDate", "endDate", months, "createdAt", "updatedAt")
		VALUES ('dp_war_expired', 'dp_dev_expired', 'STANDARD', $1, $2, 12, NOW(), NOW())`,
		day(-400), day(-1)); err != nil {
		t.Fatalf("insert warranty: %v", err)
	}

	// SUBSCRIPTION_PAID_NOT_ADVANCED: renewal date yesterday, a payment recorded
	// today. autoRenew is OFF so the item cannot also match the cancel-link rule.
	if _, err := env.pool.Exec(ctx, `
		INSERT INTO "Subscription" (id, "userId", name, "billingCycle", price, currency,
		                            "startedAt", "renewalDate", "autoRenew", status, "createdAt", "updatedAt")
		VALUES ('dp_sub_paid', $1, 'Gói đã trả', 'MONTHLY', 120000, 'VND', $2, $3, false, 'ACTIVE', NOW(), NOW())`,
		env.userID, day(-365), day(-1)); err != nil {
		t.Fatalf("insert subscription: %v", err)
	}
	if _, err := env.pool.Exec(ctx, `
		INSERT INTO "SubscriptionPayment" (id, "subscriptionId", amount, "paidAt")
		VALUES ('dp_pay_paid', 'dp_sub_paid', 120000, $1)`, day(0)); err != nil {
		t.Fatalf("insert payment: %v", err)
	}

	// WISHLIST_TARGET_PASSED: the user's own target date was yesterday.
	if _, err := env.pool.Exec(ctx, `
		INSERT INTO "WishlistItem" (id, "userId", name, "targetDate", status, "createdAt", "updatedAt")
		VALUES ('dp_wish', $1, 'Món đã qua ngày', $2, 'WATCHING', NOW(), NOW())`,
		env.userID, day(-1)); err != nil {
		t.Fatalf("insert wishlist: %v", err)
	}

	// kind → direction + the singular sentence fragment in each language.
	// `past` means `days` counts BACK from the measurement day (asOf - dueDate);
	// otherwise it counts FORWARD to the deadline (dueDate - asOf).
	cases := []struct {
		kind       string
		past       bool
		enSingular string
		viSingular string
	}{
		{services.ActionWarrantyExpired, true, "(1 day ago)", "(1 ngày trước)"},
		{services.ActionReturnWindowClosing, false, "has 1 day left", "còn 1 ngày đổi/trả"},
		{services.ActionSubPaidNotAdvanced, true, "(1 day in the past)", "(đã qua 1 ngày)"},
		{services.ActionWishlistTargetPassed, true, "passed 1 day ago", "đã qua 1 ngày"},
	}

	for _, lang := range []string{"en", "vi"} {
		t.Run(lang, func(t *testing.T) {
			rr := env.do(t, http.MethodGet, "/api/v1/actions?lang="+lang, env.token, nil)
			if rr.Code != http.StatusOK {
				t.Fatalf("status = %d (%s)", rr.Code, rr.Body.String())
			}
			var queue services.ActionQueue
			if err := json.Unmarshal(rr.Body.Bytes(), &queue); err != nil {
				t.Fatalf("decode queue: %v", err)
			}
			byKind := make(map[string]services.ActionItem, len(queue.Items))
			for _, it := range queue.Items {
				byKind[it.Kind] = it
			}

			for _, tc := range cases {
				it, ok := byKind[tc.kind]
				if !ok {
					t.Fatalf("%s missing from the queue: %s", tc.kind, mustJSON(queue))
				}
				if it.DueDate == nil {
					t.Fatalf("%s has no dueDate, so detailParams cannot be checked against it", tc.kind)
				}
				p := it.DetailParams
				if p == nil {
					t.Fatalf("%s: detailParams is absent; detail = %q", tc.kind, it.Detail)
				}
				if p.Kind != tc.kind {
					t.Errorf("%s: detailParams.kind = %q, want the item's kind", tc.kind, p.Kind)
				}
				if p.Days != 1 {
					t.Errorf("%s: detailParams.days = %d, want 1 (the fixture is exactly one day away)", tc.kind, p.Days)
				}
				if !p.AsOf.Valid {
					t.Errorf("%s: detailParams.asOf is not a valid day: %+v", tc.kind, p.AsOf)
				}
				// The invariant that makes the field usable: days is the absolute
				// day distance between dueDate and asOf, in the direction Kind means.
				delta := int(p.AsOf.Time.Sub(it.DueDate.Time).Hours() / 24)
				if tc.past && delta != 1 {
					t.Errorf("%s: asOf - dueDate = %d day(s), want +1 (days ago)", tc.kind, delta)
				}
				if !tc.past && delta != -1 {
					t.Errorf("%s: asOf - dueDate = %d day(s), want -1 (days left)", tc.kind, delta)
				}
				fragment := tc.enSingular
				if lang == "vi" {
					fragment = tc.viSingular
				}
				if !strings.Contains(it.Detail, fragment) {
					t.Errorf("%s/%s: detail = %q, want it to contain the count-bearing fragment %q",
						tc.kind, lang, it.Detail, fragment)
				}
			}

			// Absence is part of the contract too: a kind whose sentence has no
			// day count must not carry a made-up one. Every device without an
			// attachment produces DEVICE_MISSING_RECEIPT.
			noCount, ok := byKind[services.ActionDeviceMissingReceipt]
			if !ok {
				t.Fatalf("DEVICE_MISSING_RECEIPT missing from the queue: %s", mustJSON(queue))
			}
			if noCount.DetailParams != nil {
				t.Errorf("DEVICE_MISSING_RECEIPT carries detailParams %+v; only count-bearing kinds may",
					noCount.DetailParams)
			}

			// English must use the singular TEMPLATE, not the plural one with the
			// count substituted: "1 days" is exactly the rendered text a client
			// re-rendering this count has to avoid, so the server must not emit it
			// either. (Vietnamese does not inflect, so there is nothing to check.)
			if lang == "en" {
				for _, it := range queue.Items {
					if strings.Contains(it.Detail, "1 days") {
						t.Errorf("%s: detail = %q renders the English plural for a count of 1", it.Kind, it.Detail)
					}
				}
			}
		})
	}
}

func mustJSON(v any) string {
	b, _ := json.Marshal(v)
	return string(b)
}
