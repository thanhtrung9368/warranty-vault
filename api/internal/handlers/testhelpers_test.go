package handlers

import (
	"context"
	"database/sql"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	_ "github.com/jackc/pgx/v5/stdlib" // database/sql driver used by goose below
	"github.com/pressly/goose/v3"

	"github.com/thanhtrung9368/warranty-vault/api/internal/ratelimit"
)

// Shared helpers for the DB-backed handler tests. They mirror the helpers in
// api/internal/services/*_test.go: the goose migrations are applied by the test,
// so the target may be an empty scratch database. Point WV_TEST_DATABASE_URL at a
// throwaway database, never at production.
//
// Unlike the services helpers, every handler test gets its OWN freshly created
// database. `go test ./...` runs package test binaries in parallel, and the
// services package's migration round-trip test drops the shared database back to
// version 3 mid-run; sharing one database between the two binaries made the suite
// flaky (observed as a spurious failure of TestCategorySeedMigrationDownAndUp).
// Creating a database per test costs ~200 ms and removes the race entirely.

func testDatabaseURL(t *testing.T) string {
	t.Helper()
	base := strings.TrimSpace(os.Getenv("WV_TEST_DATABASE_URL"))
	if base == "" {
		t.Skip("WV_TEST_DATABASE_URL not set (e.g. postgres://postgres@127.0.0.1:5432/wv_test?sslmode=disable): skipping real-Postgres assertions")
	}
	return newScratchDatabaseDSN(t, base)
}

func migrationsDir(t *testing.T) string {
	t.Helper()
	dir, err := filepath.Abs(filepath.Join("..", "..", "migrations"))
	if err != nil {
		t.Fatalf("resolve migrations dir: %v", err)
	}
	return dir
}

func gooseUp(t *testing.T, dsn string) {
	t.Helper()
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatalf("open database/sql handle: %v", err)
	}
	defer func() { _ = db.Close() }()
	if err := goose.SetDialect("postgres"); err != nil {
		t.Fatalf("goose dialect: %v", err)
	}
	if err := goose.Up(db, migrationsDir(t)); err != nil {
		t.Fatalf("goose up: %v", err)
	}
	// Every handler test gets a fresh database. Pin its default session zone to
	// UTC so the pools those tests open afterwards match production: the
	// handlers write Go instants as UTC and the SQL NOW() defaults must agree.
	// (Each test's pool is its own; a startup guard in cmd/server does not run
	// here.)
	var name string
	if err := db.QueryRow(`SELECT current_database()`).Scan(&name); err != nil {
		t.Fatalf("read scratch database name: %v", err)
	}
	if _, err := db.Exec(`ALTER DATABASE "` + strings.ReplaceAll(name, `"`, `""`) + `" SET timezone TO 'UTC'`); err != nil {
		t.Fatalf("pin scratch database timezone: %v", err)
	}
}

// permissiveLimiter always allows a request. Rate limiting has its own tests; a
// flow test that fires a dozen requests must not trip the production bucket
// (CheckAuth allows 5 per IP+identifier).
type permissiveLimiter struct{ calls int }

func (p *permissiveLimiter) Check(context.Context, string, int, int) (ratelimit.Result, error) {
	p.calls++
	return ratelimit.Result{Ok: true, Remaining: 100}, nil
}

// latestPendingEmail reads the newest unused email-change token's pending address
// and its TTL for a user — used to assert the request endpoint stored what it
// promised without having to intercept the email.
//
// The TTL is computed in SQL as `"expiresAt" - "createdAt"`: both columns are
// `timestamp without time zone`, and subtracting them is zone-free, so the
// assertion does not depend on Go's clock or on the test connection's session
// timezone. (Both columns are UTC in the application.)
func latestPendingEmail(t *testing.T, pool *pgxpool.Pool, userID string) (string, time.Duration) {
	t.Helper()
	var pending string
	var seconds float64
	if err := pool.QueryRow(context.Background(),
		`SELECT "pendingEmail", EXTRACT(EPOCH FROM ("expiresAt" - "createdAt"))
		 FROM "PasswordReset"
		 WHERE "userId" = $1 AND "pendingEmail" IS NOT NULL AND "usedAt" IS NULL
		 ORDER BY "createdAt" DESC LIMIT 1`, userID).Scan(&pending, &seconds); err != nil {
		t.Fatalf("lookup pending email: %v", err)
	}
	return pending, time.Duration(seconds * float64(time.Second))
}

// insertUser creates a throwaway user with the given bcrypt hash.
func insertUser(t *testing.T, pool *pgxpool.Pool, id, email, passwordHash string) {
	t.Helper()
	if _, err := pool.Exec(context.Background(),
		`INSERT INTO "User" (id, email, "passwordHash", "updatedAt") VALUES ($1, $2, $3, NOW())
		 ON CONFLICT (id) DO NOTHING`, id, email, passwordHash); err != nil {
		t.Fatalf("insert user %s: %v", id, err)
	}
}

// deleteUsers removes the throwaway users (cascades devices / sessions / tokens).
func deleteUsers(t *testing.T, pool *pgxpool.Pool, ids ...string) {
	t.Helper()
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM "User" WHERE id = ANY($1)`, ids)
	})
}

// newScratchDatabaseDSN creates a brand-new empty database on the server behind
// base and returns its DSN, dropping it again when the test ends. No migrations
// are applied — callers run gooseUp on the returned DSN.
// httpTemplateDatabase builds — once per test process — a database with the full
// migration chain applied, to be used as a CREATE DATABASE template.
//
// Returns the database name. The template is left behind on purpose: dropping it
// from a test cleanup would run at the end of whichever test happened to create
// it, which is far too early. CI runners are ephemeral; a local `go test` leaves
// one `wv_http_template_<pid>` database that is cheap to remove by hand.
var (
	httpTemplateOnce sync.Once
	httpTemplateName string
	httpTemplateErr  error
)

func httpTemplateDatabase(t *testing.T, base string) (string, error) {
	t.Helper()
	httpTemplateOnce.Do(func() {
		name := fmt.Sprintf("wv_http_template_%d", os.Getpid())
		ctx := context.Background()

		admin, err := pgx.Connect(ctx, base)
		if err != nil {
			httpTemplateErr = err
			return
		}
		_, err = admin.Exec(ctx, `DROP DATABASE IF EXISTS "`+name+`" WITH (FORCE)`)
		if err == nil {
			_, err = admin.Exec(ctx, `CREATE DATABASE "`+name+`"`)
		}
		_ = admin.Close(ctx)
		if err != nil {
			httpTemplateErr = err
			return
		}

		u, err := url.Parse(base)
		if err != nil {
			httpTemplateErr = err
			return
		}
		u.Path = "/" + name
		gooseUp(t, u.String())

		// A template must have no connections open to it, or every clone fails.
		if admin, err = pgx.Connect(ctx, base); err == nil {
			_, _ = admin.Exec(ctx,
				`SELECT pg_terminate_backend(pid) FROM pg_stat_activity
				  WHERE datname = $1 AND pid <> pg_backend_pid()`, name)
			_ = admin.Close(ctx)
		}
		httpTemplateName = name
	})
	return httpTemplateName, httpTemplateErr
}

func newScratchDatabaseDSN(t *testing.T, base string) string {
	t.Helper()
	u, err := url.Parse(base)
	if err != nil {
		t.Fatalf("parse dsn: %v", err)
	}
	name := fmt.Sprintf("wv_http_rt_%d", time.Now().UnixNano())
	ctx := context.Background()

	// Every handler test used to create an empty database and run the whole
	// migration chain on it — 24 migrations per test, roughly two hundred times.
	// That put this package at 595 of go test's 600-second default timeout, and
	// then over it, so CI failed on the deadline rather than on an assertion.
	//
	// The schema is identical for every test, so it is migrated once into a
	// template database and every scratch database is cloned from it. The
	// per-database timezone is deliberately NOT part of the template (Postgres
	// does not copy `ALTER DATABASE ... SET`), so `gooseUp` still runs per test —
	// it finds the version already current and only pins the timezone.
	tmpl, err := httpTemplateDatabase(t, base)
	if err != nil {
		t.Skipf("cannot build the scratch template (%v) — the DB-backed handler tests need a createdb role", err)
	}

	admin, err := pgx.Connect(ctx, base)
	if err != nil {
		t.Fatalf("connect admin: %v", err)
	}
	if _, err := admin.Exec(ctx, `CREATE DATABASE "`+name+`" TEMPLATE "`+tmpl+`"`); err != nil {
		_ = admin.Close(ctx)
		t.Skipf("cannot CREATE DATABASE (%v) — the DB-backed handler tests need a createdb role", err)
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

// createScratchDatabase returns a migrated, empty database as a pool. Used by the
// backup HTTP test so a restore can be proven against a database with no rows at
// all (the service-level round trip does the same thing; this covers the wire
// path).
func createScratchDatabase(t *testing.T, dsn string) *pgxpool.Pool {
	t.Helper()
	scratchDSN := newScratchDatabaseDSN(t, dsn)
	gooseUp(t, scratchDSN)
	pool, err := pgxpool.New(context.Background(), scratchDSN)
	if err != nil {
		t.Fatalf("connect scratch: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}
