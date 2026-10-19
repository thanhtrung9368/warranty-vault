package handlers

import (
	"encoding/json"
	"net/http"
	"regexp"
	"sort"
	"testing"
	"time"
)

// The wire-format contract for timestamps, asserted over real handler JSON.
//
// The bug this fixes was visible in one payload: `GET /api/v1/devices` returned
//
//	createdAt            = 2026-10-19T05:40:25.551     <- no offset
//	purchaseDate         = 2025-11-20T00:00:00         <- no offset
//	effectiveWarrantyEnd = 2026-10-28T00:00:00Z        <- has Z
//
// The two naive strings came from `pgtype.Timestamp.MarshalJSON`; `openapi.yaml`
// declares these fields `format: date-time`, and RFC 3339 requires an offset. A
// JavaScript client reads the naive form as LOCAL time, so on UTC+7 the same
// instant was seven hours wrong depending on which field a screen happened to
// read.
//
// These assertions are deliberately generic over the JSON tree: every string that
// looks like a date-time must parse as RFC 3339 (i.e. carry an offset), and every
// string that is a bare timestamp without one fails, wherever in the payload it
// appears. That catches the whole class without listing a single field, so a new
// pgtype column cannot reintroduce the bug unnoticed.

// naiveTimestampRE is the exact forbidden shape: an RFC 3339 date-time with the
// offset removed — "2026-10-19T05:40:25.551".
var naiveTimestampRE = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$`)

// dateTimeLikeRE matches anything that is trying to be a date-time. Every match
// must parse as RFC 3339 (which requires an offset), or it is the bug.
var dateTimeLikeRE = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}T`)

// naiveTimestampPaths walks a decoded JSON value and returns the paths of every
// string that is a naive RFC 3339 date-time. Paths use `[]` for array elements so
// one list can describe a payload with N rows, e.g. "devices[].purchaseDate".
func naiveTimestampPaths(t *testing.T, v any) []string {
	t.Helper()
	var out []string
	var walk func(path string, node any)
	walk = func(path string, node any) {
		switch n := node.(type) {
		case map[string]any:
			for k, child := range n {
				p := k
				if path != "" {
					p = path + "." + k
				}
				walk(p, child)
			}
		case []any:
			for _, child := range n {
				walk(path+"[]", child)
			}
		case string:
			if naiveTimestampRE.MatchString(n) {
				out = append(out, path+" = "+n)
			}
		}
	}
	walk("", v)
	sort.Strings(out)
	return out
}

// assertNoNaiveTimestamps fails on any offset-less date-time and on any
// date-time-looking string that is not valid RFC 3339.
func assertNoNaiveTimestamps(t *testing.T, responseName string, body []byte) {
	t.Helper()
	var decoded any
	if err := json.Unmarshal(body, &decoded); err != nil {
		t.Fatalf("%s: decode response: %v (%s)", responseName, err, body)
	}

	if bad := naiveTimestampPaths(t, decoded); len(bad) > 0 {
		t.Errorf(
			"%s: %d timestamp(s) without an offset (not RFC 3339, misread as local time by JS clients):\n  %s",
			responseName, len(bad), joinLines(bad),
		)
	}

	// The positive half: anything shaped like a date-time must be a valid
	// RFC 3339 value. `time.RFC3339` accepts both `Z` and numeric offsets.
	var walk func(path string, node any)
	walk = func(path string, node any) {
		switch n := node.(type) {
		case map[string]any:
			for k, child := range n {
				walk(path+"."+k, child)
			}
		case []any:
			for _, child := range n {
				walk(path+"[]", child)
			}
		case string:
			if !dateTimeLikeRE.MatchString(n) {
				return
			}
			if _, err := time.Parse(time.RFC3339, n); err != nil {
				t.Errorf("%s: %s = %q is not a valid RFC 3339 date-time: %v", responseName, path, n, err)
			}
		}
	}
	walk("", decoded)
}

func joinLines(items []string) string {
	out := ""
	for i, item := range items {
		if i > 0 {
			out += "\n  "
		}
		out += item
	}
	return out
}

// TestNaiveTimestampDetectorCatchesTheOldPayload proves the assertion above is a
// real regression test, not a tautology: it feeds the detector a payload with
// exactly the shape the old binary returned and requires both naive fields to be
// reported, while the already-correct `…Z` fields stay silent.
func TestNaiveTimestampDetectorCatchesTheOldPayload(t *testing.T) {
	old := map[string]any{
		"devices": []any{
			map[string]any{
				"createdAt":            "2026-10-19T05:40:25.551",
				"updatedAt":            "2026-10-19T05:40:25.551",
				"purchaseDate":         "2025-11-20T00:00:00",
				"effectiveWarrantyEnd": "2026-10-28T00:00:00Z",
			},
		},
	}
	got := naiveTimestampPaths(t, old)
	want := []string{
		"devices[].createdAt = 2026-10-19T05:40:25.551",
		"devices[].purchaseDate = 2025-11-20T00:00:00",
		"devices[].updatedAt = 2026-10-19T05:40:25.551",
	}
	if len(got) != len(want) {
		t.Fatalf("detector found %d naive timestamps, want %d:\n%v", len(got), len(want), got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("detector[%d] = %q, want %q", i, got[i], want[i])
		}
	}
}

// TestDeviceResponsesCarryUTCOffsets is the handler-level regression: a device
// with every date column populated, read back through the list, detail, warranty
// list and search endpoints. The old binary failed the generic assertion on
// purchaseDate/createdAt/updatedAt and on the warranty's startDate/endDate.
func TestDeviceResponsesCarryUTCOffsets(t *testing.T) {
	env := setupDevicesI18nEnv(t)

	const createBody = `{
		"name": "Timestamp Contract Device",
		"category": "PHONE",
		"brand": "Apple",
		"model": "iPhone 15",
		"purchaseDate": "2025-11-20",
		"purchasePrice": 25000000,
		"receivedAt": "2025-11-22",
		"activatedAt": "2025-11-21",
		"extendedCoverBuyBy": "2026-01-31",
		"soldAt": "2026-03-01",
		"soldPrice": 18000000,
		"status": "SOLD",
		"brandWarrantyStatus": "ACTIVE",
		"brandWarrantyStart": "2025-11-21",
		"brandWarrantyEnd": "2026-11-20",
		"brandCheckedAt": "2026-10-19T12:00:00Z"
	}`
	rr := env.do(t, http.MethodPost, "/api/v1/devices?lang=en", "en", createBody)
	if rr.Code != http.StatusCreated {
		t.Fatalf("create device = %d (%s)", rr.Code, rr.Body.String())
	}
	assertNoNaiveTimestamps(t, "POST /api/v1/devices", rr.Body.Bytes())

	var created struct {
		Device struct {
			ID           string `json:"id"`
			PurchaseDate string `json:"purchaseDate"`
			CreatedAt    string `json:"createdAt"`
			UpdatedAt    string `json:"updatedAt"`
			SoldAt       string `json:"soldAt"`
		} `json:"device"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &created); err != nil || created.Device.ID == "" {
		t.Fatalf("decode created device: %v (%s)", err, rr.Body.String())
	}

	rr = env.do(t, http.MethodPost, "/api/v1/devices/"+created.Device.ID+"/warranties?lang=en", "en",
		`{"type":"STANDARD","provider":"Apple","startDate":"2025-11-20","endDate":"2026-10-28","months":12}`)
	if rr.Code != http.StatusCreated {
		t.Fatalf("create warranty = %d (%s)", rr.Code, rr.Body.String())
	}
	assertNoNaiveTimestamps(t, "POST /api/v1/devices/{id}/warranties", rr.Body.Bytes())

	for name, path := range map[string]string{
		"GET /api/v1/devices":                 "/api/v1/devices?lang=en",
		"GET /api/v1/devices/{id}":            "/api/v1/devices/" + created.Device.ID + "?lang=en",
		"GET /api/v1/devices/{id}/warranties": "/api/v1/devices/" + created.Device.ID + "/warranties?lang=en",
		"GET /api/v1/search":                  "/api/v1/search?q=Timestamp%20Contract&lang=en",
	} {
		rr := env.do(t, http.MethodGet, path, "en", "")
		if rr.Code != http.StatusOK {
			t.Fatalf("%s = %d (%s)", name, rr.Code, rr.Body.String())
		}
		assertNoNaiveTimestamps(t, name, rr.Body.Bytes())
	}

	// The date-only fields must keep their meaning while changing their shape:
	// the day the client sent comes back as the same day, not as a midnight
	// instant a negative-offset zone could slide one day either way.
	if got := created.Device.PurchaseDate; got != "2025-11-20" {
		t.Errorf("device.purchaseDate = %q, want the calendar day 2025-11-20", got)
	}
	if got := created.Device.SoldAt; got != "2026-03-01" {
		t.Errorf("device.soldAt = %q, want the calendar day 2026-03-01", got)
	}
	// Instants must keep the UTC Z and parse.
	for field, got := range map[string]string{
		"createdAt": created.Device.CreatedAt,
		"updatedAt": created.Device.UpdatedAt,
	} {
		if _, err := time.Parse(time.RFC3339, got); err != nil {
			t.Errorf("device.%s = %q, want RFC 3339 with an offset: %v", field, got, err)
		}
	}
}
