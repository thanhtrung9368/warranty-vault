package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/thanhtrung9368/warranty-vault/api/internal/auth"
	"github.com/thanhtrung9368/warranty-vault/api/internal/services"
)

// Subscription audit over HTTP (FEATURE_IDEAS #4). This covers the three SQL
// queries against real rows; the thresholds themselves are pinned with fixtures
// in services/subscription_audit_test.go.
//
// Runs against its own scratch database.
func TestSubscriptionAuditOverHTTP(t *testing.T) {
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
	const userID = "zz_test_sub_audit_user"
	insertUser(t, pool, userID, "sub-audit@example.invalid", hash)
	deleteUsers(t, pool, userID)
	issued, err := auth.IssueToken(ctx, pool, userID, nil, nil)
	if err != nil {
		t.Fatalf("issue token: %v", err)
	}

	seedSub := func(id, name, cycle, brand, category string, price int32, autoRenew bool) {
		t.Helper()
		var brandArg, catArg any
		if brand != "" {
			brandArg = brand
		}
		if category != "" {
			catArg = category
		}
		if _, err := pool.Exec(ctx, `
			INSERT INTO "Subscription" (id, "userId", name, brand, category, "billingCycle", price,
			                            currency, "startedAt", "renewalDate", "autoRenew", status,
			                            "createdAt", "updatedAt")
			VALUES ($1, $2, $3, $4, $5, $6, $7, 'VND',
			        NOW() - INTERVAL '400 days', NOW() + INTERVAL '20 days', $8, 'ACTIVE', NOW(), NOW())`,
			id, userID, name, brandArg, catArg, cycle, price, autoRenew); err != nil {
			t.Fatalf("insert subscription %s: %v", id, err)
		}
	}
	seedPayment := func(id, subID string, amount int32, monthsAgo int, note *string) {
		t.Helper()
		if _, err := pool.Exec(ctx, `
			INSERT INTO "SubscriptionPayment" (id, "subscriptionId", amount, "paidAt", note, "createdAt")
			VALUES ($1, $2, $3, NOW() - make_interval(months => $4::int), $5, NOW())`,
			id, subID, amount, monthsAgo, note); err != nil {
			t.Fatalf("insert payment %s: %v", id, err)
		}
	}
	autoNote := "Auto-renew"

	// 1. QUIET_AUTO_RENEW: auto-charged for over a year, never recorded by hand.
	//    Deliberately NOT named "iCloud+": duplicate detection reports every PAIR,
	//    so a third row with the same name would (correctly) add two more pair
	//    findings and make this fixture assert the wrong thing.
	seedSub("aud_quiet", "Apple One", "MONTHLY", "Apple", "CLOUD", 59000, true)
	for i := 1; i <= 12; i++ {
		seedPayment(fmt.Sprintf("aud_quiet_p%02d", i), "aud_quiet", 59000, i, &autoNote)
	}

	// 2. Same shape, but the user logged one payment themselves → suppressed.
	seedSub("aud_manual", "Spotify", "MONTHLY", "Spotify", "MUSIC", 59000, true)
	for i := 1; i <= 12; i++ {
		seedPayment(fmt.Sprintf("aud_manual_p%02d", i), "aud_manual", 59000, i, &autoNote)
	}
	manualNote := "Tự trả"
	seedPayment("aud_manual_manual", "aud_manual", 59000, 2, &manualNote)

	// 3. PRICE_INCREASED: 59.000 → 79.000 between consecutive payments.
	seedSub("aud_rise", "Gói tăng giá", "MONTHLY", "", "", 79000, true)
	seedPayment("aud_rise_old", "aud_rise", 59000, 3, &manualNote)
	seedPayment("aud_rise_new", "aud_rise", 79000, 1, &manualNote)

	// 4. DUPLICATE by normalized name: "icloud+" vs "iCloud+".
	seedSub("aud_dup_a", "icloud+", "MONTHLY", "", "", 59000, true)
	seedSub("aud_dup_b", "iCloud+", "MONTHLY", "", "", 199000, true)

	// 5. LIFETIME with the same name must NOT pair with anything.
	seedSub("aud_life", "icloud+", "LIFETIME", "", "", 1990000, false)

	mux := http.NewServeMux()
	RegisterSubscriptions(mux, Deps{DB: pool, Limiter: &permissiveLimiter{}})

	req := httptest.NewRequest(http.MethodGet, "/api/v1/subscriptions/audit", nil)
	req.Header.Set("Authorization", "Bearer "+issued.AccessToken)
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("audit = %d (%s)", rr.Code, rr.Body.String())
	}

	var audit services.SubscriptionAudit
	if err := json.Unmarshal(rr.Body.Bytes(), &audit); err != nil {
		t.Fatalf("decode audit: %v", err)
	}

	byKind := map[string][]services.AuditFinding{}
	for _, f := range audit.Findings {
		byKind[f.Kind] = append(byKind[f.Kind], f)
	}

	// Only aud_quiet may be flagged as quiet: aud_manual has a hand-logged payment,
	// aud_rise/aud_dup_* have no auto charges at all.
	quiet := byKind[services.AuditQuietAutoRenew]
	if len(quiet) != 1 {
		t.Fatalf("QUIET_AUTO_RENEW findings = %d (%+v), want exactly aud_quiet", len(quiet), quiet)
	}
	if quiet[0].SubscriptionIDs[0] != "aud_quiet" {
		t.Errorf("quiet finding is for %q, want aud_quiet", quiet[0].SubscriptionIDs[0])
	}
	if quiet[0].ChargedTotalVnd != 59000*12 {
		t.Errorf("chargedTotalVnd = %d, want %d", quiet[0].ChargedTotalVnd, 59000*12)
	}
	if quiet[0].LastRecordedAt == nil {
		t.Error("lastRecordedAt must be present when there are payments")
	}

	rises := byKind[services.AuditPriceIncreased]
	if len(rises) != 1 {
		t.Fatalf("PRICE_INCREASED findings = %d (%+v), want 1", len(rises), rises)
	}
	if rises[0].IncreaseVnd == nil || *rises[0].IncreaseVnd != 20000 {
		t.Errorf("increaseVnd = %v, want 20000", rises[0].IncreaseVnd)
	}

	dups := byKind[services.AuditDuplicate]
	if len(dups) != 1 {
		t.Fatalf("DUPLICATE findings = %d (%+v), want 1 (the two MONTHLY icloud+ rows)", len(dups), dups)
	}
	if len(dups[0].SubscriptionIDs) != 2 {
		t.Fatalf("duplicate finding ids = %v, want both sides", dups[0].SubscriptionIDs)
	}
	for _, id := range dups[0].SubscriptionIDs {
		if id == "aud_life" {
			t.Error("a LIFETIME row was paired as a duplicate — it is a one-off, not a second bill")
		}
	}
	if dups[0].Reason == nil || *dups[0].Reason != "SAME_NAME" {
		t.Errorf("reason = %v, want SAME_NAME (wv_unaccent must fold case)", dups[0].Reason)
	}

	// The report is advisory and must say so, with the thresholds it used.
	if !audit.Advisory {
		t.Error("advisory must be true")
	}
	if audit.Thresholds.QuietMinAutoCharges != services.AuditQuietMinAutoCharges ||
		audit.Thresholds.QuietMinMonths != services.AuditQuietMinMonths ||
		audit.Thresholds.PriceRiseMinPercent != services.AuditPriceRiseMinPercent {
		t.Errorf("thresholds are not echoed: %+v", audit.Thresholds)
	}
	if audit.Note == "" {
		t.Error("note is empty; the payload must state what the analysis cannot see")
	}
	if audit.Counts.Total != len(audit.Findings) {
		t.Errorf("counts.total = %d, findings = %d", audit.Counts.Total, len(audit.Findings))
	}

	// ── The endpoint must be read-only. Re-reading returns identical findings and
	//    the subscription rows are untouched: a price, an autoRenew flag and a
	//    status all survive a call to an "audit" endpoint.
	before := struct {
		price     int32
		autoRenew bool
		status    string
	}{}
	if err := pool.QueryRow(ctx,
		`SELECT price, "autoRenew", status FROM "Subscription" WHERE id = 'aud_quiet'`).
		Scan(&before.price, &before.autoRenew, &before.status); err != nil {
		t.Fatalf("read before: %v", err)
	}
	req2 := httptest.NewRequest(http.MethodGet, "/api/v1/subscriptions/audit", nil)
	req2.Header.Set("Authorization", "Bearer "+issued.AccessToken)
	rr2 := httptest.NewRecorder()
	mux.ServeHTTP(rr2, req2)
	if rr2.Code != http.StatusOK {
		t.Fatalf("second audit = %d", rr2.Code)
	}
	var after struct {
		price     int32
		autoRenew bool
		status    string
	}
	if err := pool.QueryRow(ctx,
		`SELECT price, "autoRenew", status FROM "Subscription" WHERE id = 'aud_quiet'`).
		Scan(&after.price, &after.autoRenew, &after.status); err != nil {
		t.Fatalf("read after: %v", err)
	}
	if before != after {
		t.Errorf("the audit endpoint modified a subscription: before=%+v after=%+v", before, after)
	}
}

// The literal "audit" must be routed to the audit handler, never read as a
// subscription id — Go 1.22 ServeMux precedence picks the more specific pattern.
func TestSubscriptionAuditIsNotAnID(t *testing.T) {
	dsn := testDatabaseURL(t)
	gooseUp(t, dsn)
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)

	hash, _ := auth.Hash(testPassword)
	const userID = "zz_test_sub_audit_route_user"
	insertUser(t, pool, userID, "sub-audit-route@example.invalid", hash)
	deleteUsers(t, pool, userID)
	issued, err := auth.IssueToken(ctx, pool, userID, nil, nil)
	if err != nil {
		t.Fatalf("issue token: %v", err)
	}

	mux := http.NewServeMux()
	RegisterSubscriptions(mux, Deps{DB: pool, Limiter: &permissiveLimiter{}})

	req := httptest.NewRequest(http.MethodGet, "/api/v1/subscriptions/audit", nil)
	req.Header.Set("Authorization", "Bearer "+issued.AccessToken)
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("GET /subscriptions/audit = %d (%s)", rr.Code, rr.Body.String())
	}
	// The audit shape, not the single-subscription shape (which would be a 404 for
	// an id that does not exist).
	var probe map[string]json.RawMessage
	if err := json.Unmarshal(rr.Body.Bytes(), &probe); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if _, ok := probe["findings"]; !ok {
		t.Fatalf("response is not the audit payload: %s", rr.Body.String())
	}
}
