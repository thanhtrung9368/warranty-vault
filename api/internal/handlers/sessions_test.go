package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/thanhtrung9368/warranty-vault/api/internal/auth"
)

// Per-session management over HTTP, against a real Postgres (FEATURE_IDEAS #5):
//
//	GET    /api/v1/auth/sessions
//	DELETE /api/v1/auth/sessions/{id}
//
// What these tests pin, in order of importance:
//   1. ownership — another user's session id is NOT revocable, and the answer is
//      byte-identical to the answer for an id that does not exist (404, never 403);
//   2. revocation — revoking one session leaves every other session working;
//   3. idempotency — a second DELETE is a 200 that changes nothing;
//   4. the current session IS revocable through this path, and the caller's own
//      token stops working immediately afterwards.

func sessionTestMux(pool *pgxpool.Pool) *http.ServeMux {
	mux := http.NewServeMux()
	RegisterSessions(mux, Deps{DB: pool, Limiter: &permissiveLimiter{}})
	return mux
}

func doSessionReq(t *testing.T, h http.Handler, method, path, bearer string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, path, nil)
	if bearer != "" {
		req.Header.Set("Authorization", "Bearer "+bearer)
	}
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	return rr
}

type sessionsBody struct {
	Sessions []struct {
		ID          string  `json:"id"`
		DeviceLabel *string `json:"deviceLabel"`
		Platform    *string `json:"platform"`
		Current     bool    `json:"current"`
		LastSeenAt  string  `json:"lastSeenAt"`
		CreatedAt   string  `json:"createdAt"`
		ExpiresAt   string  `json:"expiresAt"`
	} `json:"sessions"`
}

func decodeSessions(t *testing.T, rr *httptest.ResponseRecorder) sessionsBody {
	t.Helper()
	var body sessionsBody
	if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode sessions body %q: %v", rr.Body.String(), err)
	}
	return body
}

// sessionEnv is one scratch database + the session routes mounted on a mux, plus
// two authenticated users to test ownership against.
type sessionEnv struct {
	pool   *pgxpool.Pool
	mux    *http.ServeMux
	userA  string
	userB  string
	tokenA *auth.IssuedToken
	tokenB *auth.IssuedToken
}

// setupSessionTest creates a migrated scratch database plus two users with a
// bcrypt hash, and issues one labelled token per user.
func setupSessionTest(t *testing.T) *sessionEnv {
	t.Helper()
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
	env := &sessionEnv{
		pool:  pool,
		mux:   sessionTestMux(pool),
		userA: "zz_test_sess_a",
		userB: "zz_test_sess_b",
	}
	insertUser(t, pool, env.userA, "sess-a@example.invalid", hash)
	insertUser(t, pool, env.userB, "sess-b@example.invalid", hash)
	deleteUsers(t, pool, env.userA, env.userB)

	labelA, platA := "iPhone của A", "ios"
	env.tokenA, err = auth.IssueToken(ctx, pool, env.userA, &labelA, &platA)
	if err != nil {
		t.Fatalf("issue token A: %v", err)
	}
	labelB, platB := "Chrome trên Windows", "web"
	env.tokenB, err = auth.IssueToken(ctx, pool, env.userB, &labelB, &platB)
	if err != nil {
		t.Fatalf("issue token B: %v", err)
	}
	return env
}

func TestListSessionsShowsOnlyOwnLiveSessions(t *testing.T) {
	env := setupSessionTest(t)
	pool, mux, tokenA := env.pool, env.mux, env.tokenA
	ctx := context.Background()

	// A second live session for A, plus a revoked one and an expired one — both
	// of which must stay out of the list.
	older, err := auth.IssueToken(ctx, pool, env.userA, nil, nil)
	if err != nil {
		t.Fatalf("issue second token: %v", err)
	}
	revoked, err := auth.IssueToken(ctx, pool, env.userA, nil, nil)
	if err != nil {
		t.Fatalf("issue third token: %v", err)
	}
	expired, err := auth.IssueToken(ctx, pool, env.userA, nil, nil)
	if err != nil {
		t.Fatalf("issue fourth token: %v", err)
	}
	if _, err := pool.Exec(ctx, `UPDATE "Session" SET "lastSeenAt" = NOW() - INTERVAL '3 hours' WHERE id = $1`, older.SessionID); err != nil {
		t.Fatalf("age second session: %v", err)
	}
	if _, err := pool.Exec(ctx, `UPDATE "Session" SET "revokedAt" = NOW() WHERE id = $1`, revoked.SessionID); err != nil {
		t.Fatalf("revoke third session: %v", err)
	}
	if _, err := pool.Exec(ctx, `UPDATE "Session" SET "expiresAt" = NOW() - INTERVAL '1 hour' WHERE id = $1`, expired.SessionID); err != nil {
		t.Fatalf("expire fourth session: %v", err)
	}

	rr := doSessionReq(t, mux, http.MethodGet, "/api/v1/auth/sessions", tokenA.AccessToken)
	if rr.Code != http.StatusOK {
		t.Fatalf("GET /auth/sessions = %d (%s)", rr.Code, rr.Body.String())
	}
	body := decodeSessions(t, rr)
	if len(body.Sessions) != 2 {
		t.Fatalf("sessions = %d rows, want 2 (revoked + expired + other user's must be excluded): %s",
			len(body.Sessions), rr.Body.String())
	}
	if body.Sessions[0].ID != tokenA.SessionID || !body.Sessions[0].Current {
		t.Errorf("first row = %+v, want the calling session %s marked current", body.Sessions[0], tokenA.SessionID)
	}
	if body.Sessions[1].ID != older.SessionID || body.Sessions[1].Current {
		t.Errorf("second row = %+v, want %s not marked current", body.Sessions[1], older.SessionID)
	}
	first := body.Sessions[0]
	if first.DeviceLabel == nil || *first.DeviceLabel != "iPhone của A" {
		t.Errorf("deviceLabel = %v, want the label written at login", first.DeviceLabel)
	}
	if first.Platform == nil || *first.Platform != "ios" {
		t.Errorf("platform = %v, want ios", first.Platform)
	}
	for _, field := range []struct {
		name  string
		value string
	}{
		{"lastSeenAt", first.LastSeenAt},
		{"createdAt", first.CreatedAt},
		{"expiresAt", first.ExpiresAt},
	} {
		if field.value == "" {
			t.Errorf("%s is empty, want an RFC3339 timestamp", field.name)
			continue
		}
		if _, err := time.Parse(time.RFC3339Nano, field.value); err != nil {
			t.Errorf("%s = %q, not RFC3339: %v", field.name, field.value, err)
		}
	}

	// The credential material must never appear in the response: not the raw
	// token, not its hash. Pull the stored hash so the assertion is about the
	// real value, not a field name.
	var tokenHash string
	if err := pool.QueryRow(ctx, `SELECT "tokenHash" FROM "Session" WHERE id = $1`, tokenA.SessionID).Scan(&tokenHash); err != nil {
		t.Fatalf("read tokenHash: %v", err)
	}
	raw := rr.Body.String()
	if strings.Contains(raw, tokenHash) || strings.Contains(raw, tokenA.AccessToken) || strings.Contains(raw, "tokenHash") {
		t.Errorf("session list leaks credential material: %s", raw)
	}
}

func TestListSessionsWithoutBearerIs401(t *testing.T) {
	rr := doSessionReq(t, setupSessionTest(t).mux, http.MethodGet, "/api/v1/auth/sessions", "")
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated list = %d, want 401 (%s)", rr.Code, rr.Body.String())
	}
}

func TestRevokeForeignSessionIs404AndChangesNothing(t *testing.T) {
	env := setupSessionTest(t)
	pool, mux, tokenA, tokenB := env.pool, env.mux, env.tokenA, env.tokenB
	ctx := context.Background()

	// B's own session id, as B sees it.
	listB := doSessionReq(t, mux, http.MethodGet, "/api/v1/auth/sessions", tokenB.AccessToken)
	foreign := decodeSessions(t, listB).Sessions[0].ID

	foreignRR := doSessionReq(t, mux, http.MethodDelete, "/api/v1/auth/sessions/"+foreign, tokenA.AccessToken)
	unknownRR := doSessionReq(t, mux, http.MethodDelete, "/api/v1/auth/sessions/zzz_khong_ton_tai", tokenA.AccessToken)

	if foreignRR.Code != http.StatusNotFound {
		t.Fatalf("revoking another user's session = %d, want 404 (%s)", foreignRR.Code, foreignRR.Body.String())
	}
	if unknownRR.Code != http.StatusNotFound {
		t.Fatalf("revoking an unknown session = %d, want 404 (%s)", unknownRR.Code, unknownRR.Body.String())
	}
	// Byte-identical answers: the caller cannot tell an existing foreign id from
	// a made-up one (the same 404-not-403 rule the file/attachment handlers use).
	if foreignRR.Body.String() != unknownRR.Body.String() {
		t.Errorf("foreign and unknown ids answer differently:\n foreign: %s\n unknown: %s",
			foreignRR.Body.String(), unknownRR.Body.String())
	}

	// B's session survived both attempts.
	var revoked *time.Time
	if err := pool.QueryRow(ctx, `SELECT "revokedAt" FROM "Session" WHERE id = $1`, foreign).Scan(&revoked); err != nil {
		t.Fatalf("read foreign session: %v", err)
	}
	if revoked != nil {
		t.Errorf("another user's session was revoked by a foreign request: revokedAt = %v", revoked)
	}
	// …and B can still call the API.
	if rr := doSessionReq(t, mux, http.MethodGet, "/api/v1/auth/sessions", tokenB.AccessToken); rr.Code != http.StatusOK {
		t.Errorf("victim token = %d after a foreign revoke attempt, want 200", rr.Code)
	}
}

func TestRevokeOwnSessionIsIdempotentAndKillsOnlyThatToken(t *testing.T) {
	env := setupSessionTest(t)
	pool, mux, tokenA := env.pool, env.mux, env.tokenA
	ctx := context.Background()

	victim, err := auth.IssueToken(ctx, pool, env.userA, nil, nil)
	if err != nil {
		t.Fatalf("issue victim token: %v", err)
	}

	first := doSessionReq(t, mux, http.MethodDelete, "/api/v1/auth/sessions/"+victim.SessionID, tokenA.AccessToken)
	if first.Code != http.StatusOK {
		t.Fatalf("first revoke = %d, want 200 (%s)", first.Code, first.Body.String())
	}
	var firstBody map[string]any
	if err := json.Unmarshal(first.Body.Bytes(), &firstBody); err != nil {
		t.Fatalf("decode first revoke: %v", err)
	}
	if firstBody["ok"] != true || firstBody["alreadyRevoked"] != false || firstBody["current"] != false {
		t.Errorf("first revoke body = %v, want ok/alreadyRevoked=false/current=false", firstBody)
	}
	if msg, _ := firstBody["message"].(string); !strings.Contains(msg, "Đã thu hồi") {
		t.Errorf("first revoke message = %q, want the Vietnamese confirmation", msg)
	}

	var revokedAt time.Time
	if err := pool.QueryRow(ctx, `SELECT "revokedAt" FROM "Session" WHERE id = $1`, victim.SessionID).Scan(&revokedAt); err != nil {
		t.Fatalf("read revokedAt: %v", err)
	}

	// The victim token is dead, the caller's own token is not.
	if rr := doSessionReq(t, mux, http.MethodGet, "/api/v1/auth/sessions", victim.AccessToken); rr.Code != http.StatusUnauthorized {
		t.Errorf("revoked token = %d, want 401", rr.Code)
	}
	if rr := doSessionReq(t, mux, http.MethodGet, "/api/v1/auth/sessions", tokenA.AccessToken); rr.Code != http.StatusOK {
		t.Errorf("caller's own token = %d after revoking another session, want 200", rr.Code)
	}
	// …and the revoked session is gone from the list.
	if got := len(decodeSessions(t, doSessionReq(t, mux, http.MethodGet, "/api/v1/auth/sessions", tokenA.AccessToken)).Sessions); got != 1 {
		t.Errorf("list after revoke = %d rows, want 1", got)
	}

	// Second DELETE: 200, alreadyRevoked=true, and the timestamp is untouched.
	second := doSessionReq(t, mux, http.MethodDelete, "/api/v1/auth/sessions/"+victim.SessionID, tokenA.AccessToken)
	if second.Code != http.StatusOK {
		t.Fatalf("second revoke = %d, want 200 (idempotent) (%s)", second.Code, second.Body.String())
	}
	var secondBody map[string]any
	if err := json.Unmarshal(second.Body.Bytes(), &secondBody); err != nil {
		t.Fatalf("decode second revoke: %v", err)
	}
	if secondBody["ok"] != true || secondBody["alreadyRevoked"] != true {
		t.Errorf("second revoke body = %v, want ok=true/alreadyRevoked=true", secondBody)
	}
	var revokedAtAgain time.Time
	if err := pool.QueryRow(ctx, `SELECT "revokedAt" FROM "Session" WHERE id = $1`, victim.SessionID).Scan(&revokedAtAgain); err != nil {
		t.Fatalf("read revokedAt again: %v", err)
	}
	if !revokedAtAgain.Equal(revokedAt) {
		t.Errorf("revokedAt changed on the second DELETE: %v → %v", revokedAt, revokedAtAgain)
	}
}

func TestRevokeCurrentSessionIsAllowedAndSignsTheCallerOut(t *testing.T) {
	env := setupSessionTest(t)
	pool, mux, tokenA := env.pool, env.mux, env.tokenA

	current := decodeSessions(t, doSessionReq(t, mux, http.MethodGet, "/api/v1/auth/sessions", tokenA.AccessToken)).Sessions[0].ID
	rr := doSessionReq(t, mux, http.MethodDelete, "/api/v1/auth/sessions/"+current, tokenA.AccessToken)
	if rr.Code != http.StatusOK {
		t.Fatalf("revoking the current session = %d, want 200 (%s)", rr.Code, rr.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body["current"] != true || body["alreadyRevoked"] != false {
		t.Errorf("body = %v, want current=true/alreadyRevoked=false", body)
	}
	// The message must tell the client to drop its local token.
	if msg, _ := body["message"].(string); !strings.Contains(msg, "đăng nhập lại") {
		t.Errorf("message = %q, want it to mention signing in again", msg)
	}

	// The row is revoked, and the very next request with that token is a 401 —
	// the same end state POST /auth/logout produces.
	var revoked *time.Time
	if err := pool.QueryRow(context.Background(),
		`SELECT "revokedAt" FROM "Session" WHERE id = $1`, current).Scan(&revoked); err != nil {
		t.Fatalf("read session: %v", err)
	}
	if revoked == nil {
		t.Error("current session row is not revoked")
	}
	if rr := doSessionReq(t, mux, http.MethodGet, "/api/v1/auth/sessions", tokenA.AccessToken); rr.Code != http.StatusUnauthorized {
		t.Errorf("list with the just-revoked token = %d, want 401", rr.Code)
	}
}
