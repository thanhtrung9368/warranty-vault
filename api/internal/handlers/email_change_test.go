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

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/thanhtrung9368/warranty-vault/api/internal/auth"
	store "github.com/thanhtrung9368/warranty-vault/api/internal/store/gen"
)

// The email-change flow (roadmap #10) is two endpoints over the PasswordReset
// table (migration 0009). These tests exercise the real handlers against a real
// Postgres: the request endpoint's validation + enumeration behaviour, and the
// confirm endpoint's happy / wrong-password / reused-token / expired-token paths.

const testPassword = "MatKhau12345"

func postJSON(t *testing.T, h http.HandlerFunc, path, bearer string, body any) *httptest.ResponseRecorder {
	t.Helper()
	raw, err := json.Marshal(body)
	if err != nil {
		t.Fatalf("marshal body: %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, path, bytes.NewReader(raw))
	req.Header.Set("Content-Type", "application/json")
	if bearer != "" {
		req.Header.Set("Authorization", "Bearer "+bearer)
	}
	rr := httptest.NewRecorder()
	h(rr, req)
	return rr
}

func decodeBody(t *testing.T, rr *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var out map[string]any
	if err := json.Unmarshal(rr.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode response %q: %v", rr.Body.String(), err)
	}
	return out
}

// seedEmailChangeToken inserts an email-change token whose raw value the test
// knows, so the confirm path can be driven without reading the email.
func seedEmailChangeToken(t *testing.T, pool *pgxpool.Pool, rawToken, userID, pendingEmail string, expires time.Time) {
	t.Helper()
	sum := sha256Hex(rawToken)
	if _, err := pool.Exec(context.Background(),
		`INSERT INTO "PasswordReset" (id, "userId", "tokenHash", "pendingEmail", "expiresAt", "createdAt")
		 VALUES ($1, $2, $3, $4, $5, NOW())`,
		auth.NewID(), userID, sum, pendingEmail, expires); err != nil {
		t.Fatalf("insert email-change token: %v", err)
	}
}

func TestRequestEmailChangeAgainstRealPostgres(t *testing.T) {
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
	const (
		userA = "zz_test_emailchange_a"
		userB = "zz_test_emailchange_b"
	)
	insertUser(t, pool, userA, "old-a@example.invalid", hash)
	insertUser(t, pool, userB, "taken@example.invalid", hash)
	deleteUsers(t, pool, userA, userB)

	issued, err := auth.IssueToken(ctx, pool, userA, nil, nil)
	if err != nil {
		t.Fatalf("issue token: %v", err)
	}
	deps := Deps{DB: pool, Limiter: &permissiveLimiter{}}
	h := RequestEmailChange(deps)

	// ---- wrong password: 400 on the password field, nothing stored ----------
	rr := postJSON(t, h, "/api/v1/auth/change-email", issued.AccessToken, map[string]string{
		"newEmail": "new-a@example.invalid", "currentPassword": "sai-mat-khau",
	})
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("wrong password status = %d, want 400 (%s)", rr.Code, rr.Body.String())
	}
	if body := decodeBody(t, rr); !strings.Contains(rr.Body.String(), "currentPassword") {
		t.Errorf("wrong-password body = %v, want a currentPassword fieldError", body)
	}
	var count int
	if err := pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM "PasswordReset" WHERE "userId" = $1 AND "pendingEmail" IS NOT NULL`, userA).Scan(&count); err != nil {
		t.Fatalf("count tokens: %v", err)
	}
	if count != 0 {
		t.Errorf("wrong password created %d email-change tokens, want 0", count)
	}

	// ---- same address: 400, own address is not an enumeration risk ----------
	rr = postJSON(t, h, "/api/v1/auth/change-email", issued.AccessToken, map[string]string{
		"newEmail": "OLD-A@example.invalid", "currentPassword": testPassword,
	})
	if rr.Code != http.StatusBadRequest {
		t.Errorf("same-address status = %d, want 400 (%s)", rr.Code, rr.Body.String())
	}

	// ---- address already in use: neutral 200, no token, no email ------------
	rr = postJSON(t, h, "/api/v1/auth/change-email", issued.AccessToken, map[string]string{
		"newEmail": "taken@example.invalid", "currentPassword": testPassword,
	})
	if rr.Code != http.StatusOK {
		t.Fatalf("already-used address status = %d, want the neutral 200 (%s)", rr.Code, rr.Body.String())
	}
	body := decodeBody(t, rr)
	if body["ok"] != true {
		t.Errorf("already-used address body = %v, want ok:true", body)
	}
	msg, _ := body["message"].(string)
	if !strings.Contains(msg, "Nếu địa chỉ mới hợp lệ") {
		t.Errorf("message %q is not the neutral non-enumerating message", msg)
	}
	if err := pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM "PasswordReset" WHERE "userId" = $1 AND "pendingEmail" IS NOT NULL`, userA).Scan(&count); err != nil {
		t.Fatalf("count tokens: %v", err)
	}
	if count != 0 {
		t.Errorf("in-use address created %d tokens, want 0 (no mail may be sent to someone else's address)", count)
	}

	// ---- happy path: token stored, account email untouched ------------------
	const newEmail = "new-a@example.invalid"
	rr = postJSON(t, h, "/api/v1/auth/change-email", issued.AccessToken, map[string]string{
		"newEmail": "  NEW-A@example.invalid  ", "currentPassword": testPassword,
	})
	if rr.Code != http.StatusOK {
		t.Fatalf("valid request status = %d, want 200 (%s)", rr.Code, rr.Body.String())
	}
	if msg, _ := decodeBody(t, rr)["message"].(string); !strings.Contains(msg, "Nếu địa chỉ mới hợp lệ") {
		t.Errorf("valid request message = %q, want the same neutral message as the in-use path", msg)
	}
	pending, ttl := latestPendingEmail(t, pool, userA)
	if pending != newEmail {
		t.Errorf("stored pendingEmail = %q, want %q (normalised lowercase)", pending, newEmail)
	}
	// The TTL must be the same 30-minute window a password reset uses, but it
	// cannot be compared for exact equality: expiresAt comes back from a
	// timestamp(3) column (millisecond precision) and time passes between the
	// INSERT and this read, so the measured value is always a hair under 30m.
	// Asserting exact equality made this test flaky — it passed in isolation
	// and failed roughly one run in three under full-suite load, which is
	// worse than a hard failure because CI goes red at random.
	const wantTTL = 30 * time.Minute
	if ttl > wantTTL || ttl <= wantTTL-time.Minute {
		t.Errorf("token TTL = %v, want it within (29m, 30m] (same window as a password reset)", ttl)
	}
	var current string
	if err := pool.QueryRow(ctx, `SELECT email FROM "User" WHERE id = $1`, userA).Scan(&current); err != nil {
		t.Fatalf("read user email: %v", err)
	}
	if current != "old-a@example.invalid" {
		t.Errorf("User.email = %q after the request step, want the OLD address until confirm", current)
	}
	// The session must still work: the old address keeps working until confirm.
	if _, err := auth.VerifyBearer(ctx, pool, "Bearer "+issued.AccessToken); err != nil {
		t.Errorf("bearer session invalidated by the request step: %v", err)
	}

	// ---- unauthenticated request is rejected --------------------------------
	rr = postJSON(t, h, "/api/v1/auth/change-email", "", map[string]string{
		"newEmail": "x@example.invalid", "currentPassword": testPassword,
	})
	if rr.Code != http.StatusUnauthorized {
		t.Errorf("no bearer status = %d, want 401", rr.Code)
	}
}

func TestConfirmEmailChangeAgainstRealPostgres(t *testing.T) {
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
	const (
		userHappy   = "zz_test_confirm_happy"
		userReuse   = "zz_test_confirm_reuse"
		userExpired = "zz_test_confirm_expired"
		userTaken   = "zz_test_confirm_taken"
		userOther   = "zz_test_confirm_other"
		userReset   = "zz_test_confirm_reset"
	)
	insertUser(t, pool, userHappy, "happy-old@example.invalid", hash)
	insertUser(t, pool, userReuse, "reuse-old@example.invalid", hash)
	insertUser(t, pool, userExpired, "expired-old@example.invalid", hash)
	insertUser(t, pool, userTaken, "taken-old@example.invalid", hash)
	insertUser(t, pool, userOther, "someone-else@example.invalid", hash)
	insertUser(t, pool, userReset, "reset-only@example.invalid", hash)
	deleteUsers(t, pool, userHappy, userReuse, userExpired, userTaken, userOther, userReset)

	deps := Deps{DB: pool, Limiter: &permissiveLimiter{}}
	h := ConfirmEmailChange(deps)
	confirm := func(token string) *httptest.ResponseRecorder {
		return postJSON(t, h, "/api/v1/auth/confirm-email-change", "", map[string]string{"token": token})
	}

	// ---- happy path ---------------------------------------------------------
	rawHappy, _, err := auth.NewTokenAndHash()
	if err != nil {
		t.Fatalf("token: %v", err)
	}
	seedEmailChangeToken(t, pool, rawHappy, userHappy, "happy-new@example.invalid", time.Now().Add(30*time.Minute))

	// A live session that must be revoked by the change.
	session, err := auth.IssueToken(ctx, pool, userHappy, nil, nil)
	if err != nil {
		t.Fatalf("issue token: %v", err)
	}

	rr := confirm(rawHappy)
	if rr.Code != http.StatusOK {
		t.Fatalf("confirm status = %d, want 200 (%s)", rr.Code, rr.Body.String())
	}
	if body := decodeBody(t, rr); body["ok"] != true {
		t.Errorf("confirm body = %v, want ok:true", body)
	}
	var email string
	if err := pool.QueryRow(ctx, `SELECT email FROM "User" WHERE id = $1`, userHappy).Scan(&email); err != nil {
		t.Fatalf("read email: %v", err)
	}
	if email != "happy-new@example.invalid" {
		t.Errorf("User.email = %q after confirm, want the new address", email)
	}
	// Token is single-use.
	var usedAt *time.Time
	if err := pool.QueryRow(ctx,
		`SELECT "usedAt" FROM "PasswordReset" WHERE "tokenHash" = $1`, sha256Hex(rawHappy)).Scan(&usedAt); err != nil {
		t.Fatalf("read token: %v", err)
	}
	if usedAt == nil {
		t.Error("token usedAt is NULL after a successful confirm, want it consumed")
	}
	// Reused token: 400, and the address must not change again.
	rr = confirm(rawHappy)
	if rr.Code != http.StatusBadRequest {
		t.Errorf("reused token status = %d, want 400 (%s)", rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), "invalid_email_change_token") {
		t.Errorf("reused token body = %s, want code invalid_email_change_token", rr.Body.String())
	}
	// Sessions revoked (the password-reset behaviour).
	var revoked *time.Time
	if err := pool.QueryRow(ctx,
		`SELECT "revokedAt" FROM "Session" WHERE id = $1`, session.SessionID).Scan(&revoked); err != nil {
		t.Fatalf("read session: %v", err)
	}
	if revoked == nil {
		t.Error("session still live after the email change, want revokedAt set (mirrors password reset)")
	}
	if _, err := auth.VerifyBearer(ctx, pool, "Bearer "+session.AccessToken); err == nil {
		t.Error("VerifyBearer accepted the pre-change session, want it rejected")
	}

	// ---- reused token on a *different* user's flow --------------------------
	rawReuse, _, _ := auth.NewTokenAndHash()
	seedEmailChangeToken(t, pool, rawReuse, userReuse, "reuse-new@example.invalid", time.Now().Add(30*time.Minute))
	if rr := confirm(rawReuse); rr.Code != http.StatusOK {
		t.Fatalf("first confirm for reuse user = %d (%s)", rr.Code, rr.Body.String())
	}
	if rr := confirm(rawReuse); rr.Code != http.StatusBadRequest {
		t.Errorf("second confirm = %d, want 400", rr.Code)
	}

	// ---- expired token ------------------------------------------------------
	rawExpired, _, _ := auth.NewTokenAndHash()
	seedEmailChangeToken(t, pool, rawExpired, userExpired, "expired-new@example.invalid", time.Now().Add(-1*time.Minute))
	if rr := confirm(rawExpired); rr.Code != http.StatusBadRequest {
		t.Fatalf("expired token status = %d, want 400 (%s)", rr.Code, rr.Body.String())
	} else if !strings.Contains(rr.Body.String(), "hết hạn") {
		t.Errorf("expired token body = %s, want a 'hết hạn' message", rr.Body.String())
	}
	if err := pool.QueryRow(ctx, `SELECT email FROM "User" WHERE id = $1`, userExpired).Scan(&email); err != nil {
		t.Fatalf("read email: %v", err)
	}
	if email != "expired-old@example.invalid" {
		t.Errorf("expired token changed the address to %q", email)
	}

	// ---- address claimed by someone else while the token was outstanding ----
	rawTaken, _, _ := auth.NewTokenAndHash()
	seedEmailChangeToken(t, pool, rawTaken, userTaken, "someone-else@example.invalid", time.Now().Add(30*time.Minute))
	if rr := confirm(rawTaken); rr.Code != http.StatusBadRequest {
		t.Fatalf("in-use-at-confirm status = %d, want 400 (%s)", rr.Code, rr.Body.String())
	} else if !strings.Contains(rr.Body.String(), "email_in_use") {
		t.Errorf("in-use-at-confirm body = %s, want code email_in_use", rr.Body.String())
	}

	// ---- a password-reset token must NOT be usable as an email change -------
	rawReset, resetHash, _ := auth.NewTokenAndHash()
	if _, err := pool.Exec(ctx,
		`INSERT INTO "PasswordReset" (id, "userId", "tokenHash", "expiresAt", "createdAt")
		 VALUES ($1, $2, $3, $4, NOW())`,
		auth.NewID(), userReset, resetHash, time.Now().Add(30*time.Minute)); err != nil {
		t.Fatalf("insert reset token: %v", err)
	}
	if rr := confirm(rawReset); rr.Code != http.StatusBadRequest {
		t.Errorf("password-reset token accepted by confirm-email-change: %d (%s)", rr.Code, rr.Body.String())
	}
}

// The reverse direction of the same rule: an email-change token must not be
// spendable as a password reset, because it is delivered to the NEW address
// (which the attacker in the classic scenario controls).
func TestEmailChangeTokenRejectedByResetPassword(t *testing.T) {
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
	const userID = "zz_test_emailchange_reset_guard"
	insertUser(t, pool, userID, "guard-old@example.invalid", hash)
	deleteUsers(t, pool, userID)

	raw, _, _ := auth.NewTokenAndHash()
	seedEmailChangeToken(t, pool, raw, userID, "guard-new@example.invalid", time.Now().Add(30*time.Minute))

	deps := Deps{DB: pool, Limiter: &permissiveLimiter{}}
	rr := postJSON(t, ResetPassword(deps), "/api/v1/auth/reset-password", "", map[string]string{
		"token": raw, "newPassword": "MatKhauMoi123",
	})
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("email-change token used on reset-password: status = %d, want 400 (%s)", rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), "invalid_reset_token") {
		t.Errorf("body = %s, want code invalid_reset_token", rr.Body.String())
	}
	// And the password must be unchanged.
	var stored string
	if err := pool.QueryRow(ctx, `SELECT "passwordHash" FROM "User" WHERE id = $1`, userID).Scan(&stored); err != nil {
		t.Fatalf("read hash: %v", err)
	}
	if !auth.Verify(testPassword, stored) {
		t.Error("password changed by an email-change token")
	}
}

// Guard for migration 0009's column: the store model must expose PendingEmail and
// the reset lookup must exclude email-change rows (both directions of the split).
func TestPasswordResetTokenKindSplitAtStoreLevel(t *testing.T) {
	dsn := testDatabaseURL(t)
	gooseUp(t, dsn)
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)

	hash, _ := auth.Hash(testPassword)
	const userID = "zz_test_emailchange_kinds"
	insertUser(t, pool, userID, "kinds-old@example.invalid", hash)
	deleteUsers(t, pool, userID)

	q := store.New(pool)
	_, changeHash, _ := auth.NewTokenAndHash()
	pending := "kinds-new@example.invalid"
	if _, err := q.CreateEmailChange(ctx, store.CreateEmailChangeParams{
		ID:           auth.NewID(),
		UserId:       userID,
		TokenHash:    changeHash,
		PendingEmail: &pending,
		ExpiresAt:    pgtype.Timestamp{Time: time.Now().Add(10 * time.Minute), Valid: true},
	}); err != nil {
		t.Fatalf("CreateEmailChange: %v", err)
	}
	_, resetHash, _ := auth.NewTokenAndHash()
	if _, err := q.CreatePasswordReset(ctx, store.CreatePasswordResetParams{
		ID:        auth.NewID(),
		UserId:    userID,
		TokenHash: resetHash,
		ExpiresAt: pgtype.Timestamp{Time: time.Now().Add(10 * time.Minute), Valid: true},
	}); err != nil {
		t.Fatalf("CreatePasswordReset: %v", err)
	}

	// Email-change token: visible to GetEmailChangeByTokenHash only.
	if _, err := q.GetEmailChangeByTokenHash(ctx, changeHash); err != nil {
		t.Errorf("GetEmailChangeByTokenHash(email-change token) = %v, want the row", err)
	}
	if _, err := q.GetPasswordResetByTokenHash(ctx, changeHash); err == nil {
		t.Error("GetPasswordResetByTokenHash accepted an email-change token")
	}
	// Password-reset token: visible to GetPasswordResetByTokenHash only.
	if _, err := q.GetPasswordResetByTokenHash(ctx, resetHash); err != nil {
		t.Errorf("GetPasswordResetByTokenHash(reset token) = %v, want the row", err)
	}
	if _, err := q.GetEmailChangeByTokenHash(ctx, resetHash); err == nil {
		t.Error("GetEmailChangeByTokenHash accepted a password-reset token")
	}

	// UpdateUserEmail moves the address and leaves passwordChangedAt alone.
	before, err := q.GetUserByID(ctx, userID)
	if err != nil {
		t.Fatalf("GetUserByID: %v", err)
	}
	rows, err := q.UpdateUserEmail(ctx, store.UpdateUserEmailParams{ID: userID, Email: pending})
	if err != nil || rows != 1 {
		t.Fatalf("UpdateUserEmail = (%d, %v), want (1, nil)", rows, err)
	}
	after, err := q.GetUserByID(ctx, userID)
	if err != nil {
		t.Fatalf("GetUserByID after: %v", err)
	}
	if after.Email != pending {
		t.Errorf("email = %q, want %q", after.Email, pending)
	}
	if after.PasswordChangedAt.Time.Unix() != before.PasswordChangedAt.Time.Unix() {
		t.Error("UpdateUserEmail changed passwordChangedAt; an email change is not a password change")
	}
}
