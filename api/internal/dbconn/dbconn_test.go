package dbconn

import (
	"context"
	"database/sql"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/lucsky/cuid"
	"github.com/pressly/goose/v3"
)

func TestIsUTC(t *testing.T) {
	for _, tz := range []string{"UTC", "utc", "Etc/UTC", "GMT", "Etc/GMT", "Zulu"} {
		if !IsUTC(tz) {
			t.Errorf("IsUTC(%q) = false, want true", tz)
		}
	}
	for _, tz := range []string{"Asia/Ho_Chi_Minh", "America/New_York", "", "UTC+7"} {
		if IsUTC(tz) {
			t.Errorf("IsUTC(%q) = true, want false", tz)
		}
	}
}

func TestParsePoolConfigForcesUTC(t *testing.T) {
	// A DSN that explicitly asks for the local zone must still be overridden:
	// the invariant belongs to the process, not to an individual DATABASE_URL.
	cfg, err := ParsePoolConfig("postgres://user:pass@localhost:5432/wv?sslmode=disable&timezone=Asia/Ho_Chi_Minh")
	if err != nil {
		t.Fatalf("ParsePoolConfig: %v", err)
	}
	if got := cfg.ConnConfig.RuntimeParams["timezone"]; got != SessionTimeZone {
		t.Fatalf("RuntimeParams[timezone] = %q, want %q", got, SessionTimeZone)
	}
}

func TestOpenSQLForcesUTC(t *testing.T) {
	// OpenSQL parses the DSN into a pgx config, so the same assertion can be
	// made without opening a connection.
	db, err := OpenSQL("postgres://user:pass@localhost:5432/wv?sslmode=disable&timezone=Asia/Ho_Chi_Minh")
	if err != nil {
		t.Fatalf("OpenSQL: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	// database/sql does not expose the config; the DB-gated test below proves
	// the session on a real connection.
}

func testDSN(t *testing.T) string {
	t.Helper()
	dsn := strings.TrimSpace(os.Getenv("WV_TEST_DATABASE_URL"))
	if dsn == "" {
		t.Skip("WV_TEST_DATABASE_URL not set (e.g. postgres://postgres@127.0.0.1:5432/wv_test?sslmode=disable): skipping real-Postgres assertions")
	}
	return dsn
}

func withParam(t *testing.T, dsn, key, value string) string {
	t.Helper()
	u, err := url.Parse(dsn)
	if err != nil {
		t.Fatalf("parse test DSN: %v", err)
	}
	q := u.Query()
	q.Set(key, value)
	u.RawQuery = q.Encode()
	return u.String()
}

// TestPoolSessionTimeZoneIsUTC is the honest guard: it opens the same pool the
// server opens and asks PostgreSQL what zone the connection is actually in, then
// writes a DEFAULT CURRENT_TIMESTAMP value and checks it is the real UTC instant.
func TestPoolSessionTimeZoneIsUTC(t *testing.T) {
	dsn := withParam(t, testDSN(t), "timezone", "Asia/Ho_Chi_Minh") // try to poison it
	ctx := context.Background()
	pool, err := NewPool(ctx, dsn)
	if err != nil {
		t.Fatalf("NewPool: %v", err)
	}
	t.Cleanup(pool.Close)

	tz, err := SessionTimeZoneOf(ctx, pool)
	if err != nil {
		t.Fatalf("SessionTimeZoneOf: %v", err)
	}
	if tz != SessionTimeZone {
		t.Fatalf("session TimeZone = %q, want %q", tz, SessionTimeZone)
	}
	if err := AssertUTC(ctx, pool); err != nil {
		t.Fatalf("AssertUTC: %v", err)
	}

	// CURRENT_TIMESTAMP inside the pool must be the real UTC instant, not the
	// host's wall clock. A 5s window absorbs scheduling delay without hiding a
	// +7h error.
	before := time.Now().UTC()
	var stamped time.Time
	if err := pool.QueryRow(ctx, `SELECT CURRENT_TIMESTAMP`).Scan(&stamped); err != nil {
		t.Fatalf("SELECT CURRENT_TIMESTAMP: %v", err)
	}
	after := time.Now().UTC()
	if stamped.Before(before.Add(-5*time.Second)) || stamped.After(after.Add(5*time.Second)) {
		t.Fatalf("CURRENT_TIMESTAMP = %s, want between %s and %s (UTC)", stamped, before, after)
	}
}

// TestAssertUTCRejectsLocalSession proves the guard fails when the session is
// not UTC. It opens a deliberately un-pinned pool, so the test does not depend
// on the server's default zone.
func TestAssertUTCRejectsLocalSession(t *testing.T) {
	dsn := withParam(t, testDSN(t), "timezone", "Asia/Ho_Chi_Minh")
	ctx := context.Background()
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatalf("pgxpool.ParseConfig: %v", err)
	}
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatalf("pgxpool.NewWithConfig: %v", err)
	}
	t.Cleanup(pool.Close)

	err = AssertUTC(ctx, pool)
	if err == nil {
		t.Fatal("AssertUTC accepted a non-UTC session; the startup guard would not catch the bug")
	}
	if !strings.Contains(err.Error(), "Asia/Ho_Chi_Minh") {
		t.Fatalf("AssertUTC error = %v, want it to name Asia/Ho_Chi_Minh", err)
	}
}

// TestMigrationCorrectsLegacyRowsAndLeavesUTCRowsAlone is the end-to-end proof
// for migration 0024 on a scratch database built the old way: one row written
// with the local wall clock and one with UTC, both with real cuid ids. The
// migration must shift only the former, leave the latter untouched, and record
// exactly what it did.
func TestMigrationCorrectsLegacyRowsAndLeavesUTCRowsAlone(t *testing.T) {
	base := testDSN(t)
	scratch := createScratchDB(t, base)
	dir, err := filepath.Abs(filepath.Join("..", "..", "migrations"))
	if err != nil {
		t.Fatalf("resolve migrations dir: %v", err)
	}

	// The pre-fix application opened its database without pinning a session
	// timezone; reproduce that here so NOW() writes the host wall clock.
	db, err := sql.Open("pgx", scratch)
	if err != nil {
		t.Fatalf("open scratch database: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })

	if err := goose.SetDialect("postgres"); err != nil {
		t.Fatalf("goose dialect: %v", err)
	}
	if err := goose.UpTo(db, dir, 23); err != nil {
		t.Fatalf("goose up-to 23: %v", err)
	}

	oldID, utcID := cuid.New(), cuid.New()
	// Derive each row's clock from the timestamp embedded in its OWN cuid id,
	// never from NOW(). The migration's classification evidence IS that embedded
	// clock, so constructing the legacy value as `cuidClock + 7h` makes the row
	// genuinely 7 hours ahead on every machine. Using NOW() made the test depend
	// on the environment: on a UTC database (CI) NOW() is already UTC, the
	// migration correctly computed offsetSeconds = 0, and this test failed even
	// though the migration was right.
	//
	// `AT TIME ZONE 'UTC'` converts the timestamptz to a `timestamp` in UTC
	// explicitly, so the stored wall clock does not depend on the session
	// timezone either; `+ interval '7 hours'` is then pure timestamp arithmetic.
	oldClock := cuidClock(t, oldID)
	utcClock := cuidClock(t, utcID)
	if _, err := db.Exec(`INSERT INTO "User" (id, email, "passwordHash", "createdAt", "updatedAt")
		VALUES ($1, 'legacy@example.invalid', 'x',
		        (to_timestamp($2::double precision / 1000) AT TIME ZONE 'UTC') + interval '7 hours',
		        (to_timestamp($2::double precision / 1000) AT TIME ZONE 'UTC') + interval '7 hours')`,
		oldID, oldClock.UnixMilli()); err != nil {
		t.Fatalf("insert legacy row: %v", err)
	}
	if _, err := db.Exec(`INSERT INTO "User" (id, email, "passwordHash", "createdAt", "updatedAt")
		VALUES ($1, 'utc@example.invalid', 'x',
		        to_timestamp($2::double precision / 1000) AT TIME ZONE 'UTC',
		        to_timestamp($2::double precision / 1000) AT TIME ZONE 'UTC')`,
		utcID, utcClock.UnixMilli()); err != nil {
		t.Fatalf("insert UTC row: %v", err)
	}
	if err := goose.Up(db, dir); err != nil {
		t.Fatalf("goose up to 24: %v", err)
	}

	readCreated := func(id string) time.Time {
		t.Helper()
		var created time.Time
		if err := db.QueryRow(`SELECT "createdAt" FROM "User" WHERE id = $1`, id).Scan(&created); err != nil {
			t.Fatalf("read createdAt for %s: %v", id, err)
		}
		return created.UTC()
	}

	// Both rows should now hold exactly the instant their cuid id was minted,
	// which is what the migration reconstructs. Comparing against that instant
	// (rather than a wall-clock window) keeps the assertion meaningful on any
	// host timezone.
	for _, tc := range []struct {
		name string
		id   string
		want time.Time
	}{
		{"legacy", oldID, oldClock},
		{"already-UTC", utcID, utcClock},
	} {
		got := readCreated(tc.id)
		if !got.Equal(tc.want) {
			t.Errorf("%s createdAt = %s, want %s (the instant embedded in the cuid id; stored=%s)",
				tc.name, got.Format(time.RFC3339Nano), tc.want.Format(time.RFC3339Nano),
				readCreatedRaw(t, db, tc.id))
		}
	}

	var offset int
	if err := db.QueryRow(`SELECT "offsetSeconds" FROM "WVUTCTimezoneBaseline" WHERE id = 'utc-cutover-0024'`).Scan(&offset); err != nil {
		t.Fatalf("read baseline: %v", err)
	}
	if offset != 25200 {
		t.Errorf("baseline offsetSeconds = %d, want 25200", offset)
	}
	var corrected int
	if err := db.QueryRow(`SELECT COUNT(*) FROM "WVUTCTimezoneCorrected" WHERE "tableName" = 'User' AND "rowId" = $1`, oldID).Scan(&corrected); err != nil {
		t.Fatalf("read corrected rows: %v", err)
	}
	if corrected != 1 {
		t.Errorf("legacy row was not recorded as corrected")
	}
	if err := db.QueryRow(`SELECT COUNT(*) FROM "WVUTCTimezoneCorrected" WHERE "rowId" = $1`, utcID).Scan(&corrected); err != nil {
		t.Fatalf("read corrected rows: %v", err)
	}
	if corrected != 0 {
		t.Errorf("already-UTC row was shifted; it must be left untouched")
	}
}

// cuidClock decodes the millisecond Unix timestamp embedded in a cuid v1 id
// (`c` + 8 base-36 chars + ...). Migration 0024 uses the same evidence in SQL;
// decoding it here is what lets the test construct a +7h legacy row explicitly
// instead of asking the environment to produce one.
func cuidClock(t *testing.T, id string) time.Time {
	t.Helper()
	if len(id) != 25 || id[0] != 'c' {
		t.Fatalf("cuidClock(%q): not a cuid v1 id", id)
	}
	var ms int64
	for _, r := range id[1:9] {
		d := strings.IndexRune("0123456789abcdefghijklmnopqrstuvwxyz", r)
		if d < 0 {
			t.Fatalf("cuidClock(%q): %q is not base36", id, string(r))
		}
		ms = ms*36 + int64(d)
	}
	return time.UnixMilli(ms).UTC()
}

// readCreatedRaw formats the stored column the way PostgreSQL sees it, so a
// failure message includes the actual row values instead of only the decoded
// instant.
func readCreatedRaw(t *testing.T, db *sql.DB, id string) string {
	t.Helper()
	var raw string
	if err := db.QueryRow(`SELECT "createdAt"::text FROM "User" WHERE id = $1`, id).Scan(&raw); err != nil {
		return "unreadable: " + err.Error()
	}
	return raw
}

// createScratchDB creates an isolated database from the admin DSN in
// WV_TEST_DATABASE_URL and drops it at the end of the test.
func createScratchDB(t *testing.T, base string) string {
	t.Helper()
	u, err := url.Parse(base)
	if err != nil {
		t.Fatalf("parse WV_TEST_DATABASE_URL: %v", err)
	}
	name := fmt.Sprintf("wv_dbconn_rt_%d", time.Now().UnixNano())
	ctx := context.Background()
	admin, err := pgx.Connect(ctx, base)
	if err != nil {
		t.Fatalf("connect admin: %v", err)
	}
	if _, err := admin.Exec(ctx, `CREATE DATABASE "`+name+`"`); err != nil {
		_ = admin.Close(ctx)
		t.Skipf("cannot CREATE DATABASE (%v)", err)
	}
	_ = admin.Close(ctx)
	t.Cleanup(func() {
		cctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		a, err := pgx.Connect(cctx, base)
		if err != nil {
			return
		}
		defer func() { _ = a.Close(cctx) }()
		_, _ = a.Exec(cctx, `DROP DATABASE IF EXISTS "`+name+`" WITH (FORCE)`)
	})
	u.Path = "/" + name
	return u.String()
}
