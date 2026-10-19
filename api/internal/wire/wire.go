// Package wire defines the two JSON scalar types every timestamp column is
// serialised through.
//
// The database columns are `timestamp(3) without time zone` with UTC semantics
// (0001_initial.sql:11), and the session timezone is pinned to UTC (dbconn).
// `pgtype.Timestamp` still marshals a valid instant as a *zoneless* RFC 3339
// string ("2026-10-19T05:40:25.551"), which `openapi.yaml`'s `format:
// date-time` forbids: RFC 3339 requires an offset. A JavaScript client reads
// that string as **local time**, so the same payload was seven hours wrong on a
// UTC+7 machine depending on which field a client happened to read.
//
// There are exactly two kinds of timestamp in the API, and they get two types:
//
//   - Instant — a point in time. JSON: RFC 3339 with an explicit UTC `Z`
//     ("2026-10-19T05:40:25.551Z"). Contract: `format: date-time`.
//   - Day — a calendar day, not an instant (purchase date, warranty start/end,
//     renewal date, wishlist target…). JSON: "YYYY-MM-DD". Contract:
//     `format: date`. A day has no timezone, so no client can move it by
//     applying one; a midnight instant can be moved a day by a negative-offset
//     zone, which is exactly what a warranty end date must never do.
//
// Both types embed pgtype.Timestamp, so pgx scanning/encoding and every
// existing `.Time` / `.Valid` read are unchanged. Neither type reinterprets the
// stored value: the instant is read as UTC (the value the previous commit
// established), and a Day is that value's UTC calendar day — the same day the
// old zoneless string carried before its first `T`.
//
// sqlc maps `timestamp` columns to these types (api/sqlc.yaml): the global
// override is Instant, and the fourteen genuinely date-only columns are
// overridden to Day. Adding a timestamp column therefore defaults to the safe,
// contract-valid shape; making it a Day is a deliberate schema-level choice.
package wire

import (
	"database/sql"
	"database/sql/driver"
	"encoding/json"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
)

// DayLayout is the only shape a calendar day takes on the wire.
const DayLayout = "2006-01-02"

// Instant is a point in time, serialised as RFC 3339 in UTC with a `Z` offset.
type Instant struct {
	pgtype.Timestamp
}

// Day is a calendar day, serialised as YYYY-MM-DD with no time and no zone.
type Day struct {
	pgtype.Timestamp
}

var (
	_ json.Marshaler   = Instant{}
	_ json.Marshaler   = Day{}
	_ driver.Valuer    = Instant{}
	_ driver.Valuer    = Day{}
	_ sql.Scanner      = (*Instant)(nil)
	_ sql.Scanner      = (*Day)(nil)
	_ json.Unmarshaler = (*Instant)(nil)
	_ json.Unmarshaler = (*Day)(nil)
)

// At returns a valid Instant at t, normalised to UTC so the wire value can
// never depend on the process's local zone.
func At(t time.Time) Instant {
	return Instant{pgtype.Timestamp{Time: t.UTC(), Valid: true}}
}

// From converts a scanned pgtype.Timestamp into an Instant without touching the
// value. The timestamp's Time is already UTC when it came from the database
// (pgx labels a `timestamp without time zone` value UTC); At would apply the
// same normalisation, but From is the honest name for "carry this through".
func From(ts pgtype.Timestamp) Instant {
	return Instant{ts}
}

// Date returns a valid Day for t's UTC calendar day.
func Date(t time.Time) Day {
	return Day{pgtype.Timestamp{Time: t.UTC(), Valid: true}}
}

// FromDay carries a scanned pgtype.Timestamp into a Day without touching the
// stored value. MarshalJSON renders its UTC calendar day, so nothing is
// truncated in the database or in the Go value.
func FromDay(ts pgtype.Timestamp) Day {
	return Day{ts}
}

// Instant returns the underlying instant (a Day's UTC midnight).
func (d Day) Instant() Instant {
	return Instant(d)
}

// Day returns the calendar day an instant falls on, in UTC.
func (i Instant) Day() Day {
	return Day(i)
}

// MarshalJSON renders an instant as RFC 3339 with nanoseconds and a `Z` offset,
// or null when the column is NULL. RFC3339Nano drops trailing zeros, so a whole
// second has no fractional part at all — still a valid RFC 3339 date-time.
func (i Instant) MarshalJSON() ([]byte, error) {
	if !i.Valid {
		return []byte("null"), nil
	}
	return json.Marshal(i.Time.UTC().Format(time.RFC3339Nano))
}

// MarshalJSON renders a calendar day as YYYY-MM-DD, or null when the column is
// NULL. The day is taken in UTC, which is where the stored wall clock lives.
func (d Day) MarshalJSON() ([]byte, error) {
	if !d.Valid {
		return []byte("null"), nil
	}
	return json.Marshal(d.Time.UTC().Format(DayLayout))
}

// The four methods below are written out rather than left to embedding: pgx's
// plan builders find them through interface assertions, and an explicitly
// declared method makes that contract visible at the type definition.

// Scan implements sql.Scanner via the embedded pgtype.Timestamp.
func (i *Instant) Scan(src any) error { return i.Timestamp.Scan(src) }

// Value implements driver.Valuer via the embedded pgtype.Timestamp.
func (i Instant) Value() (driver.Value, error) { return i.Timestamp.Value() }

// Scan implements sql.Scanner via the embedded pgtype.Timestamp.
func (d *Day) Scan(src any) error { return d.Timestamp.Scan(src) }

// Value implements driver.Valuer via the embedded pgtype.Timestamp.
func (d Day) Value() (driver.Value, error) { return d.Timestamp.Value() }

// UnmarshalJSON keeps pgtype.Timestamp's lenient parsing (RFC 3339 with or
// without an offset, plus YYYY-MM-DD) for request/test decoding. The API's
// request bodies use plain strings/time.Time; this exists so the scalar cannot
// surprise a decoder that binds to a model directly.
func (i *Instant) UnmarshalJSON(b []byte) error { return i.Timestamp.UnmarshalJSON(b) }

// UnmarshalJSON keeps pgtype.Timestamp's lenient parsing for decoders that bind
// to a model directly.
func (d *Day) UnmarshalJSON(b []byte) error { return d.Timestamp.UnmarshalJSON(b) }
