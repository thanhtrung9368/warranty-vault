package services

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	store "github.com/thanhtrung9368/warranty-vault/api/internal/store/gen"
)

// Warranty-claim tests (migration 0021). The database-backed cases run only when
// WV_TEST_DATABASE_URL points at a throwaway Postgres; the pure backup-shape
// assertions run everywhere.
//
// Every assertion that checks a user-facing sentence pins Vietnamese with
// viCtx(): the product default is English, so an unpinned test would assert the
// wrong language (docs/I18N_PLAN.md §4.3).

var claimIDSeq atomic.Int64

func claimTestID(prefix string) string {
	return fmt.Sprintf("zz_%s_%d", prefix, claimIDSeq.Add(1))
}

func claimPtr[T any](v T) *T { return &v }

type claimEnv struct {
	pool       *pgxpool.Pool
	dsn        string
	userID     string
	deviceID   string
	warrantyID string
}

func insertClaimUser(t *testing.T, pool *pgxpool.Pool, id string) {
	t.Helper()
	ctx := context.Background()
	if _, err := pool.Exec(ctx,
		`INSERT INTO "User" (id, email, "passwordHash", "updatedAt")
		 VALUES ($1, $2, 'x', NOW()) ON CONFLICT (id) DO NOTHING`,
		id, id+"@claims.invalid"); err != nil {
		t.Fatalf("insert user %s: %v", id, err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM "User" WHERE id = $1`, id)
	})
}

func insertClaimDevice(t *testing.T, pool *pgxpool.Pool, id, userID, name string) {
	t.Helper()
	if _, err := pool.Exec(context.Background(),
		`INSERT INTO "Device" (id, "userId", name, category, "purchaseDate", "purchasePrice", "updatedAt")
		 VALUES ($1, $2, $3, 'PHONE', '2025-01-01', 20000000, NOW())
		 ON CONFLICT (id) DO NOTHING`, id, userID, name); err != nil {
		t.Fatalf("insert device %s: %v", id, err)
	}
}

func insertClaimWarranty(t *testing.T, pool *pgxpool.Pool, id, deviceID string) {
	t.Helper()
	if _, err := pool.Exec(context.Background(),
		`INSERT INTO "Warranty" (id, "deviceId", type, "startDate", "endDate", months, "updatedAt")
		 VALUES ($1, $2, 'STANDARD', '2025-01-01', '2027-01-01', 24, NOW())
		 ON CONFLICT (id) DO NOTHING`, id, deviceID); err != nil {
		t.Fatalf("insert warranty %s: %v", id, err)
	}
}

func newClaimEnv(t *testing.T) *claimEnv {
	t.Helper()
	dsn := testDatabaseURL(t)
	gooseUp(t, dsn)
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)

	e := &claimEnv{pool: pool, dsn: dsn, userID: claimTestID("claim_user")}
	insertClaimUser(t, pool, e.userID)
	e.deviceID = e.addDevice(t, e.userID, "iPhone của chủ sở hữu")
	e.warrantyID = e.addWarranty(t, e.deviceID)
	return e
}

func (e *claimEnv) addUser(t *testing.T) string {
	t.Helper()
	id := claimTestID("claim_user")
	insertClaimUser(t, e.pool, id)
	return id
}

func (e *claimEnv) addDevice(t *testing.T, userID, name string) string {
	t.Helper()
	id := claimTestID("claim_dev")
	insertClaimDevice(t, e.pool, id, userID, name)
	return id
}

func (e *claimEnv) addWarranty(t *testing.T, deviceID string) string {
	t.Helper()
	id := claimTestID("claim_war")
	insertClaimWarranty(t, e.pool, id, deviceID)
	return id
}

func mustCreateClaim(t *testing.T, e *claimEnv, in ClaimInput) store.Claim {
	t.Helper()
	row, err := CreateClaim(viCtx(), e.pool, e.userID, in)
	if err != nil {
		t.Fatalf("CreateClaim(%+v): %v", in, err)
	}
	return row
}

func wantClaimError(t *testing.T, err error, code, field string) *Error {
	t.Helper()
	if err == nil {
		t.Fatalf("want a %s error, got nil", code)
	}
	svc, ok := As(err)
	if !ok {
		t.Fatalf("want a *services.Error, got %T: %v", err, err)
	}
	if svc.Code != code {
		t.Fatalf("error code = %q (%v), want %q", svc.Code, err, code)
	}
	if field != "" && len(svc.FieldErrors[field]) == 0 {
		t.Fatalf("error has no fieldErrors.%s: %v", field, svc.FieldErrors)
	}
	return svc
}

// checkClaimError asserts the error shape when the caller does not need the
// parsed error back. wantClaimError hands it over for the call sites that do,
// and is deliberately not used directly here so every discard is explicit.
func checkClaimError(t *testing.T, err error, code, field string) {
	t.Helper()
	_ = wantClaimError(t, err, code, field)
}

// ── 1. Create defaults + the single-open rule ────────────────────────────────

func TestClaimCreateDefaultsAndSingleOpen(t *testing.T) {
	e := newClaimEnv(t)

	first := mustCreateClaim(t, e, ClaimInput{DeviceID: e.deviceID, Issue: "Màn hình xanh"})
	if first.Status != ClaimStatusOpen {
		t.Errorf("default status = %q, want OPEN", first.Status)
	}
	if first.ClosedAt.Valid {
		t.Errorf("open claim has closedAt = %v, want NULL", first.ClosedAt.Time)
	}
	if first.WarrantyId != nil {
		t.Errorf("default warrantyId = %q, want nil", *first.WarrantyId)
	}
	if !first.OpenedAt.Valid {
		t.Error("openedAt is NULL; a claim must record when it was opened")
	}

	// A second OPEN claim on the same device is a 409 LIMIT_REACHED.
	_, err := CreateClaim(viCtx(), e.pool, e.userID, ClaimInput{
		DeviceID: e.deviceID, Issue: "Một chiếc máy, hai cửa hàng",
	})
	svc := wantClaimError(t, err, "LIMIT_REACHED", "")
	if svc.HTTPStatus() != 409 {
		t.Errorf("HTTPStatus = %d, want 409", svc.HTTPStatus())
	}
	if !strings.Contains(svc.Message, "đang mở") {
		t.Errorf("409 message = %q, want the single-open sentence", svc.Message)
	}

	// IN_REPAIR is the same "at the shop" bucket and is also refused.
	_, err = CreateClaim(viCtx(), e.pool, e.userID, ClaimInput{
		DeviceID: e.deviceID, Issue: "Đang sửa", Status: ClaimStatusInRepair,
	})
	checkClaimError(t, err, "LIMIT_REACHED", "")

	// A CLOSED claim does not occupy the open slot. This is how a device builds
	// a repair history over the years.
	closed := mustCreateClaim(t, e, ClaimInput{
		DeviceID: e.deviceID, Issue: "Đã sửa xong", Status: ClaimStatusResolved,
		OpenedAt: claimPtr("2026-01-01T09:00:00Z"),
	})
	if !closed.ClosedAt.Valid {
		t.Fatal("RESOLVED claim created without closedAt")
	}
	if !closed.ClosedAt.Time.After(closed.OpenedAt.Time) {
		t.Errorf("closedAt %v is not after openedAt %v", closed.ClosedAt.Time, closed.OpenedAt.Time)
	}

	// Newest openedAt first: `first` was opened now, `closed` in January.
	rows, err := ListClaims(viCtx(), e.pool, e.userID, ClaimFilter{})
	if err != nil {
		t.Fatalf("ListClaims: %v", err)
	}
	if len(rows) != 2 {
		t.Fatalf("ListClaims = %d rows, want 2", len(rows))
	}
	if rows[0].ID != first.ID {
		t.Errorf("first row = %q, want the newest-opened claim %q", rows[0].ID, first.ID)
	}
}

// ── 1b. The single-open rule is enforced by SQL, not by the pre-check ────────

// Two concurrent creates must not both succeed. The service's
// CountOtherOpenClaimsByDevice is a friendly pre-check and CAN be raced; the
// partial unique index is what makes the second INSERT fail. This test drives
// both paths with real connections, so it fails if the index is ever dropped
// or its predicate changed. Exactly one request wins; the other must be the
// SAME 409 LIMIT_REACHED a sequential caller gets.
func TestClaimSingleOpenRuleIsRaceSafe(t *testing.T) {
	e := newClaimEnv(t)
	ctx := viCtx()

	const racers = 2
	errs := make(chan error, racers)
	start := make(chan struct{})
	for i := 0; i < racers; i++ {
		go func(n int) {
			<-start
			_, err := CreateClaim(ctx, e.pool, e.userID, ClaimInput{
				DeviceID: e.deviceID,
				Issue:    fmt.Sprintf("Đua số %d", n),
			})
			errs <- err
		}(i)
	}
	close(start)

	var succeeded, conflicted int
	for i := 0; i < racers; i++ {
		err := <-errs
		if err == nil {
			succeeded++
			continue
		}
		svc, ok := As(err)
		if !ok || svc.Code != "LIMIT_REACHED" || svc.HTTPStatus() != 409 {
			t.Fatalf("racer error = %v, want a 409 LIMIT_REACHED", err)
		}
		conflicted++
	}
	if succeeded != 1 || conflicted != racers-1 {
		t.Fatalf("racers = %d succeeded / %d conflicted, want 1 / %d",
			succeeded, conflicted, racers-1)
	}
	rows, err := ListClaims(ctx, e.pool, e.userID, ClaimFilter{})
	if err != nil {
		t.Fatalf("ListClaims: %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("stored claims = %d, want exactly 1", len(rows))
	}
}

// ── 2. closedAt is automatic, preserved and cleared ──────────────────────────

func TestClaimClosedAtLifecycle(t *testing.T) {
	e := newClaimEnv(t)
	ctx := viCtx()

	created := mustCreateClaim(t, e, ClaimInput{
		DeviceID: e.deviceID,
		Issue:    "Chết màn hình",
		OpenedAt: claimPtr("2026-02-03T10:00:00Z"),
	})
	if created.ClosedAt.Valid {
		t.Fatal("new OPEN claim has a closedAt")
	}
	opened := created.OpenedAt.Time

	// 1. OPEN → RESOLVED sets closedAt and keeps openedAt even though the body
	// omits it.
	resolved, err := UpdateClaim(ctx, e.pool, e.userID, created.ID, ClaimInput{
		DeviceID: e.deviceID, Issue: "Đã thay màn hình", Status: ClaimStatusResolved,
	})
	if err != nil {
		t.Fatalf("UpdateClaim(->RESOLVED): %v", err)
	}
	if !resolved.ClosedAt.Valid {
		t.Fatal("RESOLVED claim has no closedAt")
	}
	if !resolved.OpenedAt.Time.Equal(opened) {
		t.Errorf("openedAt changed to %v, want %v (omitted must keep)", resolved.OpenedAt.Time, opened)
	}
	closed := resolved.ClosedAt.Time

	// 2. Staying RESOLVED must not move the resolution date, even if the body
	// omits status altogether (older/partial clients).
	kept, err := UpdateClaim(ctx, e.pool, e.userID, created.ID, ClaimInput{
		DeviceID: e.deviceID, Issue: "Đã thay màn hình (ghi chú)",
	})
	if err != nil {
		t.Fatalf("UpdateClaim(keep closed): %v", err)
	}
	if kept.Status != ClaimStatusResolved {
		t.Errorf("status = %q, want the stored RESOLVED (omitted means keep)", kept.Status)
	}
	if !kept.ClosedAt.Valid || !kept.ClosedAt.Time.Equal(closed) {
		t.Errorf("closedAt = %v, want the unchanged %v", kept.ClosedAt, closed)
	}
	if !kept.OpenedAt.Time.Equal(opened) {
		t.Errorf("openedAt changed on a keep-status PATCH: %v", kept.OpenedAt.Time)
	}

	// 3. A client-sent closedAt is accepted but IGNORED on the API path.
	reopened, err := UpdateClaim(ctx, e.pool, e.userID, created.ID, ClaimInput{
		DeviceID: e.deviceID, Issue: "Mở lại để sửa tiếp", Status: ClaimStatusOpen,
		ClosedAt: claimPtr("2000-01-01T00:00:00Z"),
	})
	if err != nil {
		t.Fatalf("UpdateClaim(->OPEN): %v", err)
	}
	if reopened.ClosedAt.Valid {
		t.Errorf("closedAt = %v after moving back to OPEN, want NULL", reopened.ClosedAt.Time)
	}

	// 4. OPEN → CANCELLED sets it again, and the client's bogus value is ignored.
	cancelled, err := UpdateClaim(ctx, e.pool, e.userID, created.ID, ClaimInput{
		DeviceID: e.deviceID, Issue: "Huỷ", Status: ClaimStatusCancelled,
		ClosedAt: claimPtr("2000-01-01T00:00:00Z"),
	})
	if err != nil {
		t.Fatalf("UpdateClaim(->CANCELLED): %v", err)
	}
	if !cancelled.ClosedAt.Valid {
		t.Fatal("CANCELLED claim has no closedAt")
	}
	if cancelled.ClosedAt.Time.Year() == 2000 {
		t.Error("client-supplied closedAt was honoured; it must be server-managed")
	}

	// 5. An explicit openedAt replaces the stored one (full replacement).
	newOpening := "2026-03-04T00:00:00Z"
	shifted, err := UpdateClaim(ctx, e.pool, e.userID, created.ID, ClaimInput{
		DeviceID: e.deviceID, Issue: "Huỷ", Status: ClaimStatusOpen,
		OpenedAt: &newOpening,
	})
	if err != nil {
		t.Fatalf("UpdateClaim(new openedAt): %v", err)
	}
	if got := shifted.OpenedAt.Time.UTC().Format("2006-01-02"); got != "2026-03-04" {
		t.Errorf("openedAt = %s, want 2026-03-04", got)
	}
}

// ── 3. warrantyId must belong to the SAME device ─────────────────────────────

func TestClaimWarrantyMustBelongToSameDevice(t *testing.T) {
	e := newClaimEnv(t)
	ctx := viCtx()
	deviceB := e.addDevice(t, e.userID, "Pixel")
	warrantyB := e.addWarranty(t, deviceB)

	// Warranty of another device of the SAME user → 400 fieldErrors.warrantyId.
	_, err := CreateClaim(ctx, e.pool, e.userID, ClaimInput{
		DeviceID: e.deviceID, WarrantyID: &warrantyB, Issue: "Sai gói",
	})
	svc := wantClaimError(t, err, "VALIDATION", "warrantyId")
	if svc.HTTPStatus() != 400 {
		t.Errorf("HTTPStatus = %d, want 400", svc.HTTPStatus())
	}

	// A nonexistent warranty is the same 400, not a 404: the id is not confirmed.
	missing := "zz_khong_ton_tai"
	_, err = CreateClaim(ctx, e.pool, e.userID, ClaimInput{
		DeviceID: e.deviceID, WarrantyID: &missing, Issue: "Sai gói",
	})
	checkClaimError(t, err, "VALIDATION", "warrantyId")

	// A warranty owned by ANOTHER user is also 400 (and must not leak that it
	// exists).
	other := e.addUser(t)
	otherDevice := e.addDevice(t, other, "Máy người khác")
	otherWarranty := e.addWarranty(t, otherDevice)
	_, err = CreateClaim(ctx, e.pool, e.userID, ClaimInput{
		DeviceID: e.deviceID, WarrantyID: &otherWarranty, Issue: "Sai gói",
	})
	checkClaimError(t, err, "VALIDATION", "warrantyId")

	// The correct warranty is accepted.
	claim := mustCreateClaim(t, e, ClaimInput{
		DeviceID: e.deviceID, WarrantyID: &e.warrantyID, Issue: "Đúng gói",
	})
	if claim.WarrantyId == nil || *claim.WarrantyId != e.warrantyID {
		t.Fatalf("stored warrantyId = %v, want %q", claim.WarrantyId, e.warrantyID)
	}

	// Moving the claim to device B while still naming device A's warranty → 400.
	_, err = UpdateClaim(ctx, e.pool, e.userID, claim.ID, ClaimInput{
		DeviceID: deviceB, WarrantyID: &e.warrantyID, Issue: "Đúng gói",
	})
	checkClaimError(t, err, "VALIDATION", "warrantyId")

	// Device B + its own warranty is a legal move.
	moved, err := UpdateClaim(ctx, e.pool, e.userID, claim.ID, ClaimInput{
		DeviceID: deviceB, WarrantyID: &warrantyB, Issue: "Đúng gói",
	})
	if err != nil {
		t.Fatalf("UpdateClaim(move to device B): %v", err)
	}
	if moved.DeviceId != deviceB || moved.WarrantyId == nil || *moved.WarrantyId != warrantyB {
		t.Errorf("moved claim = device %q / warranty %v", moved.DeviceId, moved.WarrantyId)
	}
}

// ── 4. Ownership is a 404, never a 403 ───────────────────────────────────────

func TestClaimOwnership404(t *testing.T) {
	e := newClaimEnv(t)
	ctx := viCtx()
	other := e.addUser(t)
	otherDevice := e.addDevice(t, other, "Máy người khác")

	otherClaim, err := CreateClaim(ctx, e.pool, other, ClaimInput{
		DeviceID: otherDevice, Issue: "Yêu cầu của người khác",
	})
	if err != nil {
		t.Fatalf("create other user's claim: %v", err)
	}

	if _, err := GetClaim(ctx, e.pool, e.userID, otherClaim.ID); err == nil {
		t.Fatal("GetClaim(foreign) = nil, want 404")
	} else {
		checkClaimError(t, err, "NOT_FOUND", "")
	}
	if _, err := UpdateClaim(ctx, e.pool, e.userID, otherClaim.ID, ClaimInput{
		DeviceID: e.deviceID, Issue: "Chiếm đoạt",
	}); err == nil {
		t.Fatal("UpdateClaim(foreign) = nil, want 404")
	} else {
		checkClaimError(t, err, "NOT_FOUND", "")
	}
	if err := DeleteClaim(ctx, e.pool, e.userID, otherClaim.ID); err == nil {
		t.Fatal("DeleteClaim(foreign) = nil, want 404")
	} else {
		checkClaimError(t, err, "NOT_FOUND", "")
	}

	// Creating against someone else's device is a 404 too (not a leak).
	_, err = CreateClaim(ctx, e.pool, e.userID, ClaimInput{
		DeviceID: otherDevice, Issue: "Thiết bị của người khác",
	})
	checkClaimError(t, err, "NOT_FOUND", "")

	// Moving your own claim onto someone else's device is a 404.
	own := mustCreateClaim(t, e, ClaimInput{DeviceID: e.deviceID, Issue: "Của tôi"})
	_, err = UpdateClaim(ctx, e.pool, e.userID, own.ID, ClaimInput{
		DeviceID: otherDevice, Issue: "Của tôi",
	})
	checkClaimError(t, err, "NOT_FOUND", "")

	// The owner can delete their own claim.
	if err := DeleteClaim(ctx, e.pool, e.userID, own.ID); err != nil {
		t.Fatalf("DeleteClaim(own): %v", err)
	}
	if _, err := GetClaim(ctx, e.pool, e.userID, own.ID); err == nil {
		t.Fatal("claim still readable after DELETE")
	}
}

// ── 5. Field validation and the chosen limits ────────────────────────────────

func TestClaimValidation(t *testing.T) {
	e := newClaimEnv(t)
	ctx := viCtx()
	long := func(n int) string { return strings.Repeat("á", n) }

	cases := []struct {
		name  string
		in    ClaimInput
		field string
	}{
		{"issue required", ClaimInput{DeviceID: e.deviceID}, "issue"},
		{"deviceId required", ClaimInput{Issue: "x"}, "deviceId"},
		{"status enum", ClaimInput{DeviceID: e.deviceID, Issue: "x", Status: "WAITING"}, "status"},
		{"cost negative", ClaimInput{DeviceID: e.deviceID, Issue: "x", Cost: claimPtr(int32(-1))}, "cost"},
		{"issue too long", ClaimInput{DeviceID: e.deviceID, Issue: long(MaxClaimIssueRunes + 1)}, "issue"},
		{"diagnosis too long", ClaimInput{DeviceID: e.deviceID, Issue: "x", Diagnosis: claimPtr(long(MaxClaimDiagnosisRunes + 1))}, "diagnosis"},
		{"outcome too long", ClaimInput{DeviceID: e.deviceID, Issue: "x", Outcome: claimPtr(long(MaxClaimOutcomeRunes + 1))}, "outcome"},
		{"ticket too long", ClaimInput{DeviceID: e.deviceID, Issue: "x", TicketNumber: claimPtr(long(MaxClaimTicketNumberRunes + 1))}, "ticketNumber"},
		{"service center too long", ClaimInput{DeviceID: e.deviceID, Issue: "x", ServiceCenter: claimPtr(long(MaxClaimServiceCenterRunes + 1))}, "serviceCenter"},
		{"openedAt invalid", ClaimInput{DeviceID: e.deviceID, Issue: "x", OpenedAt: claimPtr("not-a-date")}, "openedAt"},
		{"expectedReturnAt invalid", ClaimInput{DeviceID: e.deviceID, Issue: "x", ExpectedReturnAt: claimPtr("31/02/2026")}, "expectedReturnAt"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := CreateClaim(ctx, e.pool, e.userID, tc.in)
			checkClaimError(t, err, "VALIDATION", tc.field)
		})
	}

	// Exactly at each limit is accepted: the caps are `>`, not `>=`.
	boundary := mustCreateClaim(t, e, ClaimInput{
		DeviceID:      e.deviceID,
		Issue:         long(MaxClaimIssueRunes),
		Diagnosis:     claimPtr(long(MaxClaimDiagnosisRunes)),
		Outcome:       claimPtr(long(MaxClaimOutcomeRunes)),
		TicketNumber:  claimPtr(long(MaxClaimTicketNumberRunes)),
		ServiceCenter: claimPtr(long(MaxClaimServiceCenterRunes)),
		Cost:          claimPtr(int32(0)),
	})
	if len([]rune(boundary.Issue)) != MaxClaimIssueRunes {
		t.Errorf("stored issue length = %d, want %d", len([]rune(boundary.Issue)), MaxClaimIssueRunes)
	}
}

// ── 6. List filters + ordering ───────────────────────────────────────────────

func TestClaimListFiltersAndOrder(t *testing.T) {
	e := newClaimEnv(t)
	ctx := viCtx()
	deviceB := e.addDevice(t, e.userID, "Pixel")

	// Opened out of creation order on purpose, to prove the sort is openedAt.
	aOpen := mustCreateClaim(t, e, ClaimInput{
		DeviceID: e.deviceID, Issue: "A open", OpenedAt: claimPtr("2026-03-03T09:00:00Z"),
	})
	bOpen := mustCreateClaim(t, e, ClaimInput{
		DeviceID: deviceB, Issue: "B open", OpenedAt: claimPtr("2026-03-02T09:00:00Z"),
	})
	aClosed := mustCreateClaim(t, e, ClaimInput{
		DeviceID: e.deviceID, Issue: "A closed", Status: ClaimStatusResolved,
		OpenedAt: claimPtr("2026-03-01T09:00:00Z"),
	})

	all, err := ListClaims(ctx, e.pool, e.userID, ClaimFilter{})
	if err != nil {
		t.Fatalf("ListClaims: %v", err)
	}
	if len(all) != 3 {
		t.Fatalf("ListClaims = %d, want 3", len(all))
	}
	wantOrder := []string{aOpen.ID, bOpen.ID, aClosed.ID}
	for i, id := range wantOrder {
		if all[i].ID != id {
			t.Errorf("row %d = %q, want %q (newest openedAt first)", i, all[i].ID, id)
		}
	}

	for _, tc := range []struct {
		name string
		f    ClaimFilter
		want []string
	}{
		{"device filter", ClaimFilter{DeviceID: e.deviceID}, []string{aOpen.ID, aClosed.ID}},
		{"device sentinel ALL", ClaimFilter{DeviceID: "ALL"}, wantOrder},
		{"status filter", ClaimFilter{Status: ClaimStatusOpen}, []string{aOpen.ID, bOpen.ID}},
		{"status sentinel ALL", ClaimFilter{Status: "ALL"}, wantOrder},
		{"device + status", ClaimFilter{DeviceID: e.deviceID, Status: ClaimStatusResolved}, []string{aClosed.ID}},
		{"unknown status matches nothing", ClaimFilter{Status: "WAITING"}, nil},
		{"foreign device id is empty, not 404", ClaimFilter{DeviceID: "zz_khong_ton_tai"}, nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			rows, err := ListClaims(ctx, e.pool, e.userID, tc.f)
			if err != nil {
				t.Fatalf("ListClaims: %v", err)
			}
			if rows == nil {
				t.Fatal("ListClaims returned nil; the wire contract needs []")
			}
			if len(rows) != len(tc.want) {
				t.Fatalf("rows = %d, want %d", len(rows), len(tc.want))
			}
			for i := range tc.want {
				if rows[i].ID != tc.want[i] {
					t.Errorf("row %d = %q, want %q", i, rows[i].ID, tc.want[i])
				}
			}
		})
	}

	// A user with no claims gets an empty, non-nil slice.
	fresh := e.addUser(t)
	rows, err := ListClaims(ctx, e.pool, fresh, ClaimFilter{})
	if err != nil {
		t.Fatalf("ListClaims(fresh): %v", err)
	}
	if rows == nil || len(rows) != 0 {
		t.Fatalf("fresh ListClaims = %#v, want []", rows)
	}
}

// ── 7. Per-user cap ──────────────────────────────────────────────────────────

func TestClaimPerUserCap(t *testing.T) {
	e := newClaimEnv(t)
	ctx := context.Background()

	// Fill the account directly: 1000 CLOSED claims are legal on one device
	// (only OPEN/IN_REPAIR is unique per device).
	if _, err := e.pool.Exec(ctx, `
		INSERT INTO "Claim" (id, "deviceId", status, "openedAt", issue, "updatedAt")
		SELECT 'zz_cap_' || g::text, $1, 'RESOLVED',
		       NOW() - (g::text || ' minutes')::interval, 'x', NOW()
		FROM generate_series(1, $2) AS g`, e.deviceID, MaxClaimsPerUser); err != nil {
		t.Fatalf("seed claims: %v", err)
	}

	_, err := CreateClaim(viCtx(), e.pool, e.userID, ClaimInput{
		DeviceID: e.deviceID, Issue: "Một yêu cầu quá trần",
	})
	svc := wantClaimError(t, err, "LIMIT_REACHED", "")
	if svc.HTTPStatus() != 409 {
		t.Errorf("HTTPStatus = %d, want 409", svc.HTTPStatus())
	}
	if !strings.Contains(svc.Message, fmt.Sprintf("%d", MaxClaimsPerUser)) {
		t.Errorf("cap message %q does not name the limit %d", svc.Message, MaxClaimsPerUser)
	}
}

// ── 8. Backup: export, round-trip, and old payloads ──────────────────────────

func claimByID(t *testing.T, rows []BackupClaim, id string) BackupClaim {
	t.Helper()
	for _, c := range rows {
		if c.ID == id {
			return c
		}
	}
	t.Fatalf("claim %s missing from payload", id)
	return BackupClaim{}
}

func TestClaimBackupRoundTripPreservesHistory(t *testing.T) {
	e := newClaimEnv(t)
	ctx := viCtx()

	open := mustCreateClaim(t, e, ClaimInput{
		DeviceID: e.deviceID, WarrantyID: &e.warrantyID,
		Status: ClaimStatusInRepair, Issue: "Hỏng màn hình",
		OpenedAt:          claimPtr("2026-02-01T09:00:00Z"),
		ExpectedReturnAt:  claimPtr("2026-02-10T00:00:00Z"),
		TicketNumber:      claimPtr("SC-123"),
		ServiceCenter:     claimPtr("TTBH Q1"),
		Diagnosis:         claimPtr("Chết màn hình"),
		Cost:              claimPtr(int32(500000)),
		CoveredByWarranty: claimPtr(true),
	})
	closed := mustCreateClaim(t, e, ClaimInput{
		DeviceID: e.deviceID,
		Status:   ClaimStatusResolved, Issue: "Hỏng pin",
		OpenedAt:          claimPtr("2025-12-01T08:00:00Z"),
		Diagnosis:         claimPtr("Pin chai"),
		Outcome:           claimPtr("Đã thay pin"),
		Cost:              claimPtr(int32(0)),
		CoveredByWarranty: claimPtr(false),
	})

	payload, err := ExportBackup(ctx, e.pool, e.userID)
	if err != nil {
		t.Fatalf("ExportBackup: %v", err)
	}
	if len(payload.Claims) != 2 {
		t.Fatalf("exported claims = %d, want 2", len(payload.Claims))
	}
	// Oldest openedAt first, matching the query's ORDER BY.
	if payload.Claims[0].ID != closed.ID || payload.Claims[1].ID != open.ID {
		t.Errorf("claim order = %q, %q; want %q, %q",
			payload.Claims[0].ID, payload.Claims[1].ID, closed.ID, open.ID)
	}
	gotOpen := claimByID(t, payload.Claims, open.ID)
	if gotOpen.WarrantyID == nil || *gotOpen.WarrantyID != e.warrantyID {
		t.Errorf("exported warrantyId = %v, want %q", gotOpen.WarrantyID, e.warrantyID)
	}
	if gotOpen.ClosedAt != nil {
		t.Errorf("open claim exported with closedAt = %v", *gotOpen.ClosedAt)
	}
	if gotOpen.CoveredByWarranty == nil || !*gotOpen.CoveredByWarranty {
		t.Errorf("coveredByWarranty = %v, want true (tri-state must survive)", gotOpen.CoveredByWarranty)
	}
	if gotOpen.Cost == nil || *gotOpen.Cost != 500000 {
		t.Errorf("cost = %v, want 500000", gotOpen.Cost)
	}
	gotClosed := claimByID(t, payload.Claims, closed.ID)
	if gotClosed.ClosedAt == nil {
		t.Fatal("closed claim exported without closedAt")
	}
	if gotClosed.CoveredByWarranty == nil || *gotClosed.CoveredByWarranty {
		t.Errorf("coveredByWarranty = %v, want false", gotClosed.CoveredByWarranty)
	}
	raw, _ := json.Marshal(payload)
	if !strings.Contains(string(raw), `"claims"`) {
		t.Error("v5 JSON is missing claims when the user has claims")
	}

	// Restore onto a clean database (same user id, as a real restore does).
	targetDSN := createScratchDatabase(t, e.dsn)
	gooseUp(t, targetDSN)
	target, err := pgxpool.New(context.Background(), targetDSN)
	if err != nil {
		t.Fatalf("connect import target: %v", err)
	}
	t.Cleanup(target.Close)
	insertClaimUser(t, target, e.userID)

	res, err := ImportBackup(ctx, target, e.userID, payload, ImportReplace)
	if err != nil {
		t.Fatalf("ImportBackup(claims): %v", err)
	}
	if res.ClaimsImported != 2 || res.ClaimsSkipped != 0 {
		t.Errorf("import counters = %d imported / %d skipped, want 2/0",
			res.ClaimsImported, res.ClaimsSkipped)
	}

	roundTripped, err := ExportBackup(ctx, target, e.userID)
	if err != nil {
		t.Fatalf("ExportBackup(target): %v", err)
	}
	if len(roundTripped.Claims) != 2 {
		t.Fatalf("round-tripped claims = %d, want 2", len(roundTripped.Claims))
	}
	rtOpen := claimByID(t, roundTripped.Claims, open.ID)
	if rtOpen.Status != ClaimStatusInRepair ||
		rtOpen.OpenedAt != gotOpen.OpenedAt ||
		rtOpen.ExpectedReturnAt == nil || *rtOpen.ExpectedReturnAt != *gotOpen.ExpectedReturnAt ||
		rtOpen.TicketNumber == nil || *rtOpen.TicketNumber != "SC-123" ||
		rtOpen.ServiceCenter == nil || *rtOpen.ServiceCenter != "TTBH Q1" ||
		rtOpen.Diagnosis == nil || *rtOpen.Diagnosis != "Chết màn hình" ||
		rtOpen.Cost == nil || *rtOpen.Cost != 500000 ||
		rtOpen.CoveredByWarranty == nil || !*rtOpen.CoveredByWarranty ||
		rtOpen.WarrantyID == nil || *rtOpen.WarrantyID != e.warrantyID {
		t.Errorf("open claim lost data in the round trip:\n got %+v\nwant %+v", rtOpen, gotOpen)
	}
	rtClosed := claimByID(t, roundTripped.Claims, closed.ID)
	if rtClosed.ClosedAt == nil || *rtClosed.ClosedAt != *gotClosed.ClosedAt {
		t.Errorf("closedAt = %v, want preserved %v", rtClosed.ClosedAt, gotClosed.ClosedAt)
	}
	if rtClosed.ClosedAt != nil && rtClosed.OpenedAt == *rtClosed.ClosedAt {
		t.Error("closedAt fell back to openedAt although the payload carried the real date")
	}

	// Device detail on the restored database carries the claims, always an array.
	detail, err := GetDevice(ctx, target, e.userID, e.deviceID)
	if err != nil {
		t.Fatalf("GetDevice(target): %v", err)
	}
	if len(detail.Claims) != 2 {
		t.Errorf("device detail claims = %d, want 2", len(detail.Claims))
	}

	// An OLD payload with no `claims` key imports unchanged and creates none.
	var wire map[string]any
	if err := json.Unmarshal(raw, &wire); err != nil {
		t.Fatalf("decode exported payload: %v", err)
	}
	delete(wire, "claims")
	oldRaw, err := json.Marshal(wire)
	if err != nil {
		t.Fatalf("re-marshal old payload: %v", err)
	}
	var oldPayload BackupExport
	if err := json.Unmarshal(oldRaw, &oldPayload); err != nil {
		t.Fatalf("decode old payload: %v", err)
	}
	if oldPayload.Claims != nil {
		t.Fatalf("old payload decoded claims = %v, want nil", oldPayload.Claims)
	}

	oldDSN := createScratchDatabase(t, e.dsn)
	gooseUp(t, oldDSN)
	oldTarget, err := pgxpool.New(context.Background(), oldDSN)
	if err != nil {
		t.Fatalf("connect old target: %v", err)
	}
	t.Cleanup(oldTarget.Close)
	insertClaimUser(t, oldTarget, e.userID)
	oldRes, err := ImportBackup(ctx, oldTarget, e.userID, &oldPayload, ImportReplace)
	if err != nil {
		t.Fatalf("ImportBackup(old payload without claims): %v", err)
	}
	if oldRes.ClaimsImported != 0 {
		t.Errorf("old payload imported %d claims, want 0", oldRes.ClaimsImported)
	}
	if oldRes.Imported == 0 {
		t.Error("old payload imported no devices; the missing key must not affect the rest of the restore")
	}
	count, err := store.New(oldTarget).CountClaimsByUser(ctx, e.userID)
	if err != nil {
		t.Fatalf("count claimed on old target: %v", err)
	}
	if count != 0 {
		t.Errorf("old target has %d claims, want 0", count)
	}
}

// A user with no claims gets the byte-identical pre-0021 export: the key is
// omitted entirely (omitempty), not emitted as null or [].
func TestClaimExportOmitsKeyWhenUserHasNoClaims(t *testing.T) {
	e := newClaimEnv(t)
	ctx := viCtx()

	payload, err := ExportBackup(ctx, e.pool, e.userID)
	if err != nil {
		t.Fatalf("ExportBackup: %v", err)
	}
	if payload.Claims != nil {
		t.Errorf("Claims = %v, want nil", payload.Claims)
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if strings.Contains(string(raw), `"claims"`) {
		t.Error("v5 JSON contains a `claims` key for a user with no claims")
	}
}

// validateBackupPayload must reject a tampered payload BEFORE the transaction:
// the partial unique index would otherwise abort the import with a raw 23505
// (a 500) after replace mode had already wiped the account.
func TestValidateBackupPayloadRejectsTwoOpenClaims(t *testing.T) {
	payload := &BackupExport{
		Version: 5,
		Devices: []BackupDevice{{ID: "zz_dev", Name: "Điện thoại"}},
		Claims: []BackupClaim{
			{ID: "zz_claim_1", DeviceID: "zz_dev", Status: ClaimStatusOpen, Issue: "x", OpenedAt: "2026-01-01T00:00:00Z"},
			{ID: "zz_claim_2", DeviceID: "zz_dev", Status: ClaimStatusInRepair, Issue: "y", OpenedAt: "2026-01-02T00:00:00Z"},
		},
	}
	err := validateBackupPayload(viCtx(), payload)
	svc := wantClaimError(t, err, "VALIDATION", "")
	if !strings.Contains(svc.Message, "nhiều hơn một") {
		t.Errorf("message = %q, want the single-open sentence", svc.Message)
	}

	// One open + one closed for the same device is legal.
	payload.Claims[1].Status = ClaimStatusResolved
	if err := validateBackupPayload(viCtx(), payload); err != nil {
		t.Errorf("one open + one closed rejected: %v", err)
	}
}
