package wire_test

// The wire contract for timestamps, pinned against the generated store models.
//
// The bug this file guards is a class, not a field: `pgtype.Timestamp.MarshalJSON`
// emits a zoneless RFC 3339 string ("2026-10-19T05:40:25.551") which
// `openapi.yaml` forbids for `format: date-time` and which a JavaScript client
// reads as *local* time. Patching one field at a time is how that class returns.
//
// So the assertions are generic: every `wire.Instant` field must marshal with an
// explicit `Z`, every `wire.Day` field must marshal as `YYYY-MM-DD`, and no
// `pgtype.Timestamp` may remain anywhere in a response model. The one hand-written
// list is `calendarDays`, the same deliberate inventory as api/sqlc.yaml's
// per-column overrides; a timestamp column that is neither an Instant nor named
// there fails the test rather than silently defaulting.

import (
	"encoding/json"
	"reflect"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	store "github.com/thanhtrung9368/warranty-vault/api/internal/store/gen"
	"github.com/thanhtrung9368/warranty-vault/api/internal/wire"
)

// calendarDays is every calendar-day column in the API, by Go field name. These
// are the 14 columns sqlc maps to wire.Day (api/sqlc.yaml). A fifth field would be
// a contract decision, not a rename, so it must be added in both places.
var calendarDays = map[string]bool{
	// Device
	"PurchaseDate":       true,
	"SoldAt":             true,
	"ReceivedAt":         true,
	"ActivatedAt":        true,
	"ExtendedCoverBuyBy": true,
	"BrandWarrantyStart": true,
	"BrandWarrantyEnd":   true,
	// Warranty
	"StartDate": true,
	"EndDate":   true,
	// Subscription
	"StartedAt":   true,
	"RenewalDate": true,
	"TrialEndsAt": true,
	// WishlistItem
	"TargetDate": true,
	// Claim
	"ExpectedReturnAt": true,
}

// responseModels is every generated row that can reach a JSON response. Models
// with no timestamp column are omitted (nothing to assert); a new one with a
// timestamp must be added here, which is the review checkpoint.
var responseModels = []any{
	store.Attachment{},
	store.Claim{},
	store.DecisionSnooze{},
	store.Device{},
	store.DeviceShare{},
	store.PasswordReset{},
	store.PushSubscription{},
	store.Reminder{},
	store.Session{},
	store.Subscription{},
	store.SubscriptionPayment{},
	store.User{},
	store.Warranty{},
	store.WishlistItem{},
	store.WishlistPrice{},
}

var (
	instantType = reflect.TypeOf(wire.Instant{})
	dayType     = reflect.TypeOf(wire.Day{})
	pgtypeType  = reflect.TypeOf(pgtype.Timestamp{})
	naiveRE     = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$`)
	dayRE       = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)
	hasOffsetRE = regexp.MustCompile(`(Z|[+-]\d{2}:\d{2})$`)
)

// sampleTime has a non-zero time-of-day on purpose: a day must drop it, an
// instant must keep it.
var sampleTime = time.Date(2026, 10, 19, 5, 40, 25, 551_000_000, time.UTC)

// TestModelsNeverMarshalANaiveTimestamp is the failing-before assertion at the
// model boundary: on the old types this JSON contained strings like
// "2026-10-19T05:40:25.551" with no offset.
func TestModelsNeverMarshalANaiveTimestamp(t *testing.T) {
	for _, model := range responseModels {
		model := model
		typ := reflect.TypeOf(model)
		t.Run(typ.Name(), func(t *testing.T) {
			blob, err := json.Marshal(fillTimestamps(model, sampleTime))
			if err != nil {
				t.Fatalf("marshal: %v", err)
			}
			var fields map[string]any
			if err := json.Unmarshal(blob, &fields); err != nil {
				t.Fatalf("unmarshal %s: %v", blob, err)
			}

			kinds := fieldKinds(typ)
			seen := 0
			for key, v := range fields {
				kind, ok := kinds[key]
				if !ok {
					continue
				}
				s, ok := v.(string)
				if !ok || s == "" {
					t.Errorf("%s.%s = %v, want a non-empty timestamp string", typ.Name(), key, v)
					continue
				}
				seen++
				if naiveRE.MatchString(s) {
					t.Errorf("%s.%s = %q: a timestamp without an offset is not RFC 3339", typ.Name(), key, s)
				}
				if kind == dayType {
					if !dayRE.MatchString(s) {
						t.Errorf("%s.%s = %q, want a YYYY-MM-DD calendar day", typ.Name(), key, s)
					}
					if want := sampleTime.Format("2006-01-02"); s != want {
						t.Errorf("%s.%s = %q, want %q", typ.Name(), key, s, want)
					}
					continue
				}
				if !hasOffsetRE.MatchString(s) {
					t.Errorf("%s.%s = %q, want an explicit UTC offset", typ.Name(), key, s)
				}
				if want := sampleTime.UTC().Format(time.RFC3339Nano); s != want {
					t.Errorf("%s.%s = %q, want %q", typ.Name(), key, s, want)
				}
			}
			if seen == 0 {
				t.Fatalf("%s carries no timestamp fields; remove it from responseModels", typ.Name())
			}
		})
	}
}

// TestTimestampColumnsAreClassified makes the inventory itself executable: each
// timestamp column is either an Instant (default) or one of the deliberate
// calendar days in sqlc.yaml. A new date-only column that was not classified here
// will marshal as an instant — contract-valid, but the wrong meaning — so it must
// be added to both lists, which is where the decision is reviewed.
func TestTimestampColumnsAreClassified(t *testing.T) {
	foundDay := map[string]bool{}

	for _, model := range responseModels {
		typ := reflect.TypeOf(model)
		for i := 0; i < typ.NumField(); i++ {
			f := typ.Field(i)
			switch f.Type {
			case instantType:
				if calendarDays[f.Name] {
					t.Errorf("%s.%s is wire.Instant but listed as a calendar day", typ.Name(), f.Name)
				}
			case dayType:
				if !calendarDays[f.Name] {
					t.Errorf("%s.%s is wire.Day but missing from the calendarDays inventory", typ.Name(), f.Name)
				}
				foundDay[f.Name] = true
			case pgtypeType:
				t.Errorf("%s.%s is a raw pgtype.Timestamp, which marshals without an offset", typ.Name(), f.Name)
			}
		}
	}

	for name := range calendarDays {
		if !foundDay[name] {
			t.Errorf("calendarDays lists %q, but no response model has a wire.Day field with that name", name)
		}
	}
}

// TestScalarShapes pins the two scalars directly, including the two cases the
// generated-model test cannot express: NULL, and a value whose time.Time is not
// already in UTC.
func TestScalarShapes(t *testing.T) {
	ict := time.FixedZone("ICT", 7*60*60)
	local := time.Date(2026, 10, 19, 12, 40, 25, 0, ict)

	instantJSON, err := json.Marshal(wire.At(local))
	if err != nil {
		t.Fatalf("marshal instant: %v", err)
	}
	if got, want := string(instantJSON), `"2026-10-19T05:40:25Z"`; got != want {
		t.Errorf("wire.At(%s) = %s, want %s (the UTC instant, not local wall clock)", local, got, want)
	}

	dayJSON, err := json.Marshal(wire.Date(local))
	if err != nil {
		t.Fatalf("marshal day: %v", err)
	}
	// The UTC calendar day of 12:40 ICT on the 19th is still the 19th. This pins
	// that a Day is its stored UTC day, not an arbitrary local truncation.
	if got, want := string(dayJSON), `"2026-10-19"`; got != want {
		t.Errorf("wire.Date(%s) = %s, want %s", local, got, want)
	}

	for name, v := range map[string]any{
		"instant": wire.Instant{},
		"day":     wire.Day{},
	} {
		blob, err := json.Marshal(v)
		if err != nil {
			t.Fatalf("marshal NULL %s: %v", name, err)
		}
		if got, want := string(blob), "null"; got != want {
			t.Errorf("NULL %s = %s, want %s", name, got, want)
		}
	}
}

// fillTimestamps returns a copy of model with every wire.Instant / wire.Day field
// set to t, so one marshal exercises every timestamp column of that model.
func fillTimestamps(model any, t time.Time) any {
	v := reflect.New(reflect.TypeOf(model)).Elem()
	v.Set(reflect.ValueOf(model))
	for i := 0; i < v.NumField(); i++ {
		f := v.Field(i)
		if !f.CanSet() {
			continue
		}
		switch f.Type() {
		case instantType:
			f.Set(reflect.ValueOf(wire.At(t)))
		case dayType:
			f.Set(reflect.ValueOf(wire.Date(t)))
		}
	}
	return v.Interface()
}

// fieldKinds maps a model's JSON key to the scalar type of its timestamp field,
// so the marshal test can tell a timestamp key from an ordinary string (a name, a
// note) that happens to look date-shaped.
func fieldKinds(typ reflect.Type) map[string]reflect.Type {
	out := map[string]reflect.Type{}
	for i := 0; i < typ.NumField(); i++ {
		f := typ.Field(i)
		if f.Type != instantType && f.Type != dayType {
			continue
		}
		out[jsonKey(f)] = f.Type
	}
	return out
}

func jsonKey(f reflect.StructField) string {
	tag := f.Tag.Get("json")
	if i := strings.IndexByte(tag, ','); i >= 0 {
		tag = tag[:i]
	}
	return tag
}
