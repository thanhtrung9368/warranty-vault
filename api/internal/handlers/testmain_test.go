package handlers

import (
	"context"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
)

// TestMain gives the package-wide scratch TEMPLATE database a lifetime that ends
// with the test binary.
//
// The template is built lazily by httpTemplateDatabase (testhelpers_test.go),
// because most tests never need Postgres. A t.Cleanup there would drop it at the
// end of the first DB-backed test — far too early, since every later test clones
// it. m.Run() owns the "after every test" edge, so TestMain is the only place
// that can express the lifetime correctly.
//
// When WV_TEST_DATABASE_URL is unset no template is built and this is a no-op.
// A cleanup failure is reported on stderr but never changes the exit code: the
// tests' own result is what the runner must see.
func TestMain(m *testing.M) {
	code := m.Run()
	dropHTTPTemplate()
	os.Exit(code)
}

// dropHTTPTemplate drops this process's template database, if one was built, and
// releases the advisory lock that marked it live. WITH (FORCE) is what makes it
// robust: it terminates any backend still connected to the template (a leaked
// pool from a failed test, or a stale connection in a crashed-previous-run
// scenario), which a plain DROP would refuse to do.
func dropHTTPTemplate() {
	name := httpTemplateName
	if name == "" {
		// The template never got as far as a name (the guard may still exist if
		// CREATE DATABASE failed). Closing the session releases the advisory lock.
		if httpTemplateLock != nil {
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			_ = httpTemplateLock.Close(ctx)
			cancel()
		}
		return
	}
	base := strings.TrimSpace(os.Getenv("WV_TEST_DATABASE_URL"))
	if base == "" {
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	admin, err := pgx.Connect(ctx, base)
	if err != nil {
		fmt.Fprintf(os.Stderr, "handlers: cannot connect to drop template database %s: %v\n", name, err)
		return
	}
	if _, err := admin.Exec(ctx, `DROP DATABASE IF EXISTS `+quoteIdent(name)+` WITH (FORCE)`); err != nil {
		fmt.Fprintf(os.Stderr, "handlers: dropping template database %s: %v\n", name, err)
	}
	_ = admin.Close(ctx)
	if httpTemplateLock != nil {
		// Closing the session is what releases pg_advisory_lock.
		_ = httpTemplateLock.Close(ctx)
	}
}
