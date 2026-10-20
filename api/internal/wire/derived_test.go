package wire_test

// The same wire contract as wire_test.go, extended to the DERIVED response DTOs.
//
// wire_test.go pins the generated store models. Those are not the only payloads
// the API emits: /forecast, /return-windows, /actions, /subscriptions/audit,
// the warranty directory, the public share certificate and the device list
// project fields into hand-written structs (effectiveWarrantyEnd, returnDeadline,
// dueDate, nextRenewalAt, …). Those projections were the follow-up this file
// closes: fourteen columns became `wire.Day`, but a derived field echoing one of
// them still serialised as an RFC 3339 `Z` instant, so the same semantic value
// had two shapes depending on the endpoint.
//
// The bug is a class, so the assertions are generic again:
//
//  1. every property `openapi.yaml` declares `format: date` in one of these
//     schemas must be a `wire.Day` (or `*wire.Day`) in the Go DTO, and a filled
//     value must marshal exactly `YYYY-MM-DD`;
//  2. the reverse: every `wire.Day` field in those DTOs must be declared
//     `format: date`, so a converted field cannot leave the contract behind;
//  3. no property declared `format: date-time` may be typed as a day;
//  4. no raw `time.Time` may appear in these DTOs at all. `time.Time` marshals
//     as RFC 3339, which is precisely how `effectiveWarrantyEnd` and
//     `returnDeadline` used to emit a calendar day as an instant.
//
// The only hand-written list is `derivedResponses`, the schema ↔ DTO mapping. A
// new derived response schema must be added there (or it is simply not covered,
// which the review checkpoint makes visible), and any new date-shaped field in a
// listed schema is checked automatically — including fields of an embedded
// `Device` via `allOf`, so the day columns and their projections cannot drift
// apart again.

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"strings"
	"testing"
	"time"

	"gopkg.in/yaml.v3"

	"github.com/thanhtrung9368/warranty-vault/api/internal/services"
	"github.com/thanhtrung9368/warranty-vault/api/internal/wire"
)

// derivedResponses maps each derived response schema in openapi.yaml to the Go
// DTO that serialises it. Several DTOs share one schema on purpose: the device
// list row, the device detail and a search hit all carry the same
// `effectiveWarrantyEnd`/`returnDeadline` projection, and all three must agree.
var derivedResponses = []struct {
	Schema string
	Model  any
}{
	{"ReturnWindow", services.ReturnWindowRow{}},
	{"ForecastWarranty", services.ForecastWarranty{}},
	{"ForecastWishlistItem", services.ForecastWishlistItem{}},
	{"ActionItem", services.ActionItem{}},
	{"ActionDetailParams", services.ActionDetailParams{}},
	{"SubscriptionAuditFinding", services.AuditFinding{}},
	{"WarrantyCentre", services.WarrantyCentre{}},
	{"SharedWarranty", services.SharedWarranty{}},
	{"SharedCertificate", services.SharedCertificate{}},
	{"DeviceListItem", services.DeviceListItem{}},
	{"DeviceDetail", services.DeviceDetail{}},
	{"DeviceWithEffectiveWarranty", services.DeviceSearchHit{}},
}

var (
	dayPtrType  = reflect.TypeOf((*wire.Day)(nil))
	timeType    = reflect.TypeOf(time.Time{})
	timePtrType = reflect.TypeOf((*time.Time)(nil))
	dateRE      = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)
)

// sampleDay has a non-zero time-of-day on purpose: a Day must render only its
// UTC calendar day.
var sampleDay = time.Date(2026, 10, 19, 5, 40, 25, 551_000_000, time.UTC)

func TestDerivedDTOsEmitDaysAsCalendarDays(t *testing.T) {
	schemas := loadOpenAPISchemas(t)

	for _, entry := range derivedResponses {
		entry := entry
		t.Run(entry.Schema+"/"+reflect.TypeOf(entry.Model).Name(), func(t *testing.T) {
			props := schemaProperties(t, schemas, entry.Schema)
			fields := jsonFields(reflect.TypeOf(entry.Model))

			// 1. The contract's day fields must be wire.Day in Go.
			for name, raw := range props {
				prop, ok := raw.(map[string]any)
				if !ok {
					continue
				}
				format, _ := prop["format"].(string)
				field, inModel := fields[name]

				switch format {
				case "date":
					if !inModel {
						t.Errorf("%s: openapi property %q is `format: date` but the Go DTO has no such field", entry.Schema, name)
						continue
					}
					if !isDayKind(field.Type) {
						t.Errorf("%s.%s: openapi says `format: date` but the Go field is %s; it must be wire.Day (or *wire.Day)",
							entry.Schema, name, field.Type)
					}
				case "date-time":
					if !inModel {
						t.Errorf("%s: openapi property %q is `format: date-time` but the Go DTO has no such field", entry.Schema, name)
						continue
					}
					if isDayKind(field.Type) {
						t.Errorf("%s.%s: openapi says `format: date-time` but the Go field is %s (a day is not an instant)",
							entry.Schema, name, field.Type)
					}
				}
			}

			// 2/3. The Go DTO must not contain a day the contract forgot, nor a
			// raw time.Time anywhere (the shape that regressed).
			for name, field := range fields {
				if isRawTime(field.Type) {
					t.Errorf("%s.%s is %s: a derived DTO must use wire.Day or wire.Instant, never time.Time (which always marshals as RFC 3339)",
						entry.Schema, name, field.Type)
				}
				if !isDayKind(field.Type) {
					continue
				}
				prop, _ := props[name].(map[string]any)
				if format, _ := prop["format"].(string); format != "date" {
					t.Errorf("%s.%s is %s but openapi.yaml declares it %q; a converted field must move the contract in the same change",
						entry.Schema, name, field.Type, format)
				}
			}

			// 4. A filled day must actually marshal as YYYY-MM-DD.
			v := reflect.New(reflect.TypeOf(entry.Model)).Elem()
			v.Set(reflect.ValueOf(entry.Model))
			fillDayFields(v)

			blob, err := json.Marshal(v.Interface())
			if err != nil {
				t.Fatalf("marshal: %v", err)
			}
			var decoded map[string]any
			if err := json.Unmarshal(blob, &decoded); err != nil {
				t.Fatalf("decode %s: %v", blob, err)
			}
			seen := 0
			for name, field := range fields {
				if !isDayKind(field.Type) {
					continue
				}
				seen++
				got, present := decoded[name]
				if !present {
					t.Errorf("%s.%s is a wire.Day but the marshalled JSON has no %q key: %s", entry.Schema, name, name, blob)
					continue
				}
				s, ok := got.(string)
				if !ok {
					t.Errorf("%s.%s = %v, want a YYYY-MM-DD string", entry.Schema, name, got)
					continue
				}
				if !dateRE.MatchString(s) {
					t.Errorf("%s.%s = %q, want YYYY-MM-DD (a day is not an instant)", entry.Schema, name, s)
				}
				if want := sampleDay.Format(wire.DayLayout); s != want {
					t.Errorf("%s.%s = %q, want %q", entry.Schema, name, s, want)
				}
			}
			if seen == 0 {
				t.Errorf("%s/%s carries no wire.Day field; remove it from derivedResponses if that is intentional",
					entry.Schema, reflect.TypeOf(entry.Model).Name())
			}
		})
	}
}

// TestDerivedDayInventoryIsNotEmpty keeps the mapping above from silently
// shrinking to nothing (an empty test would pass).
func TestDerivedDayInventoryIsNotEmpty(t *testing.T) {
	total := 0
	for _, entry := range derivedResponses {
		for _, field := range jsonFields(reflect.TypeOf(entry.Model)) {
			if isDayKind(field.Type) {
				total++
			}
		}
	}
	// The derived day fields this job converted: returnDeadline, purchaseDate,
	// receivedAt (ReturnWindow), endDate, targetDate, dueDate, nextRenewalAt,
	// warranty endDate, the three shared-certificate dates plus two per-package
	// dates, effectiveWarrantyEnd and returnDeadline on the device shapes, and
	// the seven embedded Device day columns. The exact number is not the contract
	// — the assertion is that converting the inventory to `wire.Day` cannot leave
	// this file vacuous.
	if total < 20 {
		t.Fatalf("only %d wire.Day fields found across derivedResponses; the inventory looks wrong", total)
	}
}

// loadOpenAPISchemas parses the repo-root openapi.yaml. The test lives at
// api/internal/wire, so the spec is three directories up; `go test` runs with
// the package directory as the working directory.
func loadOpenAPISchemas(t *testing.T) map[string]any {
	t.Helper()
	path := filepath.Join("..", "..", "..", "openapi.yaml")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	var doc map[string]any
	if err := yaml.Unmarshal(raw, &doc); err != nil {
		t.Fatalf("parse %s: %v", path, err)
	}
	components, _ := doc["components"].(map[string]any)
	schemas, _ := components["schemas"].(map[string]any)
	if schemas == nil {
		t.Fatalf("%s has no components.schemas", path)
	}
	return schemas
}

// schemaProperties resolves a schema's properties, following `allOf` and `$ref`
// so an embedded schema (Device on the device shapes) is covered too.
func schemaProperties(t *testing.T, schemas map[string]any, name string) map[string]any {
	t.Helper()
	out := map[string]any{}
	seen := map[string]bool{}

	var walk func(string)
	walk = func(name string) {
		if seen[name] {
			return
		}
		seen[name] = true
		raw, ok := schemas[name]
		if !ok {
			t.Fatalf("openapi.yaml has no schema %q", name)
		}
		schema, _ := raw.(map[string]any)
		if props, ok := schema["properties"].(map[string]any); ok {
			for k, v := range props {
				if _, exists := out[k]; !exists {
					out[k] = v
				}
			}
		}
		parts, _ := schema["allOf"].([]any)
		for _, part := range parts {
			pm, _ := part.(map[string]any)
			if ref, ok := pm["$ref"].(string); ok {
				walk(strings.TrimPrefix(ref, "#/components/schemas/"))
				continue
			}
			if props, ok := pm["properties"].(map[string]any); ok {
				for k, v := range props {
					if _, exists := out[k]; !exists {
						out[k] = v
					}
				}
			}
		}
	}
	walk(name)
	return out
}

// jsonFields indexes a DTO's JSON keys to their fields, promoting embedded
// structs (DeviceVND → store.Device) the way encoding/json does.
func jsonFields(typ reflect.Type) map[string]reflect.StructField {
	out := map[string]reflect.StructField{}
	var walk func(reflect.Type)
	walk = func(typ reflect.Type) {
		for i := 0; i < typ.NumField(); i++ {
			f := typ.Field(i)
			if f.Anonymous && f.Type.Kind() == reflect.Struct && f.Type != dayType && f.Type != instantType {
				walk(f.Type)
				continue
			}
			key := jsonKey(f)
			if key == "" || key == "-" {
				continue
			}
			if _, exists := out[key]; !exists {
				out[key] = f
			}
		}
	}
	walk(typ)
	return out
}

// fillDayFields sets every wire.Day / *wire.Day field of an addressable value,
// recursing into embedded structs, so one marshal exercises every day field.
func fillDayFields(v reflect.Value) {
	for i := 0; i < v.NumField(); i++ {
		f := v.Field(i)
		if !f.CanSet() {
			continue
		}
		switch f.Type() {
		case dayType:
			f.Set(reflect.ValueOf(wire.Date(sampleDay)))
		case dayPtrType:
			day := wire.Date(sampleDay)
			f.Set(reflect.ValueOf(&day))
			continue
		}
		if v.Type().Field(i).Anonymous && f.Kind() == reflect.Struct && f.Type() != dayType && f.Type() != instantType {
			fillDayFields(f)
		}
	}
}

func isDayKind(typ reflect.Type) bool { return typ == dayType || typ == dayPtrType }

func isRawTime(typ reflect.Type) bool { return typ == timeType || typ == timePtrType }
