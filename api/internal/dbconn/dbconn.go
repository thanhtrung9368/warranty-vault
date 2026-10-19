// Package dbconn opens PostgreSQL connections that are pinned to UTC.
//
// The schema stores every instant as `timestamp(3) without time zone` and the
// application treats those values as UTC. PostgreSQL's CURRENT_TIMESTAMP / now()
// do NOT return UTC unless the session timezone says so: with the stock
// Asia/Ho_Chi_Minh default on this host they returned the local wall clock,
// which was then stored without a zone and read back by pgx as if it were UTC.
// Every connection this service opens therefore sets `timezone=UTC` in the
// startup packet (RuntimeParams), and every entrypoint asserts the result before
// it writes anything.
package dbconn

import (
	"context"
	"database/sql"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"
)

// SessionTimeZone is the only zone the application stores instants in.
const SessionTimeZone = "UTC"

// configure forces the zone on a parsed pgx config. RuntimeParams is sent in the
// startup packet of *every* physical connection the pool opens, so a pooled
// connection can never inherit a different server/role default. It deliberately
// overwrites any `timezone=` already present in the DSN: the DSN is not allowed
// to opt out of the invariant.
func configure(cfg *pgx.ConnConfig) {
	if cfg.RuntimeParams == nil {
		cfg.RuntimeParams = make(map[string]string)
	}
	cfg.RuntimeParams["timezone"] = SessionTimeZone
}

// ParsePoolConfig parses dsn and returns a pool config with the UTC session
// timezone forced. Exported so a caller can tune pool sizes without losing the
// invariant.
func ParsePoolConfig(dsn string) (*pgxpool.Config, error) {
	cfg, err := pgxpool.ParseConfig(strings.TrimSpace(dsn))
	if err != nil {
		return nil, fmt.Errorf("parse database url: %w", err)
	}
	configure(cfg.ConnConfig)
	return cfg, nil
}

// NewPool opens a pgx pool whose connections all run with TimeZone=UTC.
func NewPool(ctx context.Context, dsn string) (*pgxpool.Pool, error) {
	cfg, err := ParsePoolConfig(dsn)
	if err != nil {
		return nil, err
	}
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("open database pool: %w", err)
	}
	return pool, nil
}

// OpenSQL opens a database/sql handle (used by goose) whose connections all run
// with TimeZone=UTC. sql.Open("pgx", dsn) would leave the zone at the server
// default, which is how the migrations command escaped the invariant.
func OpenSQL(dsn string) (*sql.DB, error) {
	cfg, err := pgx.ParseConfig(strings.TrimSpace(dsn))
	if err != nil {
		return nil, fmt.Errorf("parse database url: %w", err)
	}
	configure(cfg)
	return stdlib.OpenDB(*cfg), nil
}

// pgxQuerier is the slice of pgxpool.Pool / pgx.Conn / pgx.Tx needed below.
type pgxQuerier interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}

// sqlQuerier is the database/sql equivalent.
type sqlQuerier interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

const sessionTimeZoneQuery = "SELECT current_setting('TimeZone')"

// SessionTimeZoneOf reports the zone PostgreSQL is actually using for q.
func SessionTimeZoneOf(ctx context.Context, q pgxQuerier) (string, error) {
	var tz string
	if err := q.QueryRow(ctx, sessionTimeZoneQuery).Scan(&tz); err != nil {
		return "", fmt.Errorf("read database session timezone: %w", err)
	}
	return tz, nil
}

// SessionTimeZoneOfSQL is SessionTimeZoneOf for a database/sql handle.
func SessionTimeZoneOfSQL(ctx context.Context, q sqlQuerier) (string, error) {
	var tz string
	if err := q.QueryRowContext(ctx, sessionTimeZoneQuery).Scan(&tz); err != nil {
		return "", fmt.Errorf("read database session timezone: %w", err)
	}
	return tz, nil
}

// IsUTC reports whether tz is a fixed zero-offset zone. PostgreSQL echoes the
// name it was given, so accept the aliases that mean the same instant.
func IsUTC(tz string) bool {
	switch strings.ToUpper(strings.TrimSpace(tz)) {
	case "UTC", "ETC/UTC", "GMT", "ETC/GMT", "UCT", "ZULU":
		return true
	}
	return false
}

// AssertUTC returns an error unless q's session timezone is UTC. Callers use it
// as a startup guard: refusing to boot is preferable to writing more timestamps
// into the wrong wall clock.
func AssertUTC(ctx context.Context, q pgxQuerier) error {
	tz, err := SessionTimeZoneOf(ctx, q)
	if err != nil {
		return err
	}
	if !IsUTC(tz) {
		return fmt.Errorf("database session timezone is %q, want UTC: refusing to write timestamps into a local wall clock (set the connection timezone, e.g. ?timezone=UTC)", tz)
	}
	return nil
}

// AssertUTCSQL is AssertUTC for a database/sql handle.
func AssertUTCSQL(ctx context.Context, q sqlQuerier) error {
	tz, err := SessionTimeZoneOfSQL(ctx, q)
	if err != nil {
		return err
	}
	if !IsUTC(tz) {
		return fmt.Errorf("database session timezone is %q, want UTC: refusing to write timestamps into a local wall clock (set the connection timezone, e.g. ?timezone=UTC)", tz)
	}
	return nil
}
