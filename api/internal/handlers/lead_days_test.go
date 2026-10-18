package handlers

import (
	"net/http"
	"reflect"
	"testing"
)

// The HTTP surface for `leadDays` (migration 0015). The service-level tests in
// internal/services prove the rules and the database round trip; these prove the
// three things only the wire can: the JSON key is decoded on BOTH create paths,
// an ABSENT/PATCH field is distinguishable from an EMPTY array, and a violation
// comes back as a normal 400 with `fieldErrors.leadDays` rather than a 500.

func leadDaysFromObject(t *testing.T, body map[string]any, key string) (string, []int32) {
	t.Helper()
	obj, ok := body[key].(map[string]any)
	if !ok {
		t.Fatalf("response has no %q object: %v", key, body)
	}
	id, _ := obj["id"].(string)
	raw, ok := obj["leadDays"].([]any)
	if !ok {
		t.Fatalf("%s.leadDays is %v, want an array", key, obj["leadDays"])
	}
	out := make([]int32, 0, len(raw))
	for _, v := range raw {
		n, ok := v.(float64)
		if !ok {
			t.Fatalf("%s.leadDays contains %T (%v), want a number", key, v, v)
		}
		out = append(out, int32(n))
	}
	return id, out
}

func assertLeadDays(t *testing.T, got, want []int32) {
	t.Helper()
	if !reflect.DeepEqual(got, want) {
		t.Errorf("leadDays = %v, want %v", got, want)
	}
}

func TestDeviceLeadDaysOverHTTP(t *testing.T) {
	env := setupDevicesI18nEnv(t)

	// Absent on create -> [30, 7].
	rr := env.do(t, http.MethodPost, "/api/v1/devices", "", `{
		"name":"Máy mặc định","category":"PHONE","purchaseDate":"2026-01-15","purchasePrice":1000
	}`)
	if rr.Code != http.StatusCreated {
		t.Fatalf("create without leadDays = %d, want 201 (%s)", rr.Code, rr.Body.String())
	}
	_, got := leadDaysFromObject(t, decodeResponse(t, rr), "device")
	assertLeadDays(t, got, []int32{30, 7})

	// Explicit unsorted values are sorted descending before storage.
	rr = env.do(t, http.MethodPost, "/api/v1/devices", "", `{
		"name":"Máy custom","category":"PHONE","purchaseDate":"2026-01-15","purchasePrice":1000,
		"leadDays":[3,14]
	}`)
	if rr.Code != http.StatusCreated {
		t.Fatalf("create with leadDays = %d, want 201 (%s)", rr.Code, rr.Body.String())
	}
	deviceID, got := leadDaysFromObject(t, decodeResponse(t, rr), "device")
	assertLeadDays(t, got, []int32{14, 3})

	// PATCH without the field keeps it (this is the regression that matters:
	// a PATCH that only renames a device must not reset the schedule).
	rr = env.do(t, http.MethodPatch, "/api/v1/devices/"+deviceID, "", `{
		"name":"Máy custom đổi tên","category":"PHONE","purchaseDate":"2026-01-15","purchasePrice":1000
	}`)
	if rr.Code != http.StatusOK {
		t.Fatalf("PATCH without leadDays = %d, want 200 (%s)", rr.Code, rr.Body.String())
	}
	_, got = leadDaysFromObject(t, decodeResponse(t, rr), "device")
	assertLeadDays(t, got, []int32{14, 3})

	// PATCH with JSON null also keeps it.
	rr = env.do(t, http.MethodPatch, "/api/v1/devices/"+deviceID, "", `{
		"name":"Máy custom đổi tên","category":"PHONE","purchaseDate":"2026-01-15","purchasePrice":1000,
		"leadDays":null
	}`)
	if rr.Code != http.StatusOK {
		t.Fatalf("PATCH with null leadDays = %d, want 200 (%s)", rr.Code, rr.Body.String())
	}
	_, got = leadDaysFromObject(t, decodeResponse(t, rr), "device")
	assertLeadDays(t, got, []int32{14, 3})

	// An explicit empty array is a 400 with the field error, on both verbs.
	for _, tc := range []struct {
		name, method, path string
	}{
		{"create empty", http.MethodPost, "/api/v1/devices"},
		{"update empty", http.MethodPatch, "/api/v1/devices/" + deviceID},
	} {
		t.Run(tc.name, func(t *testing.T) {
			rr := env.do(t, tc.method, tc.path, "vi", `{
				"name":"Máy","category":"PHONE","purchaseDate":"2026-01-15","purchasePrice":1000,
				"leadDays":[]
			}`)
			if rr.Code != http.StatusBadRequest {
				t.Fatalf("empty leadDays = %d, want 400 (%s)", rr.Code, rr.Body.String())
			}
			body := decodeResponse(t, rr)
			if got := firstFieldError(t, body, "leadDays"); got != "Số ngày nhắc phải có từ 1 đến 5 giá trị" {
				t.Errorf("fieldErrors.leadDays = %q", got)
			}

			// The same rule in English comes from the catalog, not a second
			// hand-written literal at the call site.
			rrEN := env.do(t, tc.method, tc.path, "en-US,en;q=0.9", `{
				"name":"Máy","category":"PHONE","purchaseDate":"2026-01-15","purchasePrice":1000,
				"leadDays":[]
			}`)
			if rrEN.Code != http.StatusBadRequest {
				t.Fatalf("empty leadDays (en) = %d, want 400 (%s)", rrEN.Code, rrEN.Body.String())
			}
			if got := firstFieldError(t, decodeResponse(t, rrEN), "leadDays"); got != "Lead days must contain between 1 and 5 values" {
				t.Errorf("fieldErrors.leadDays (en) = %q", got)
			}
		})
	}

	// Every rule, through the same route.
	for _, tc := range []struct {
		name string
		json string
	}{
		{"too many", `[1,2,3,4,5,6]`},
		{"negative", `[-1]`},
		{"over 365", `[366]`},
		{"duplicate", `[7,7]`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			rr := env.do(t, http.MethodPost, "/api/v1/devices", "vi", `{
				"name":"Máy","category":"PHONE","purchaseDate":"2026-01-15","purchasePrice":1000,
				"leadDays":`+tc.json+`
			}`)
			if rr.Code != http.StatusBadRequest {
				t.Fatalf("leadDays=%s = %d, want 400 (%s)", tc.json, rr.Code, rr.Body.String())
			}
			body := decodeResponse(t, rr)
			if got := firstFieldError(t, body, "leadDays"); got == "" {
				t.Errorf("fieldErrors.leadDays is empty: %v", body)
			}
		})
	}
}

func TestSubscriptionLeadDaysOverHTTP(t *testing.T) {
	env := setupSubsI18nEnv(t)

	// Absent on create -> [30, 7].
	rr := env.do(t, http.MethodPost, "/api/v1/subscriptions", "", `{
		"name":"Netflix mặc định","billingCycle":"MONTHLY","price":1000,"startedAt":"2026-01-15"
	}`)
	if rr.Code != http.StatusCreated {
		t.Fatalf("create without leadDays = %d, want 201 (%s)", rr.Code, rr.Body.String())
	}
	_, got := leadDaysFromObject(t, decodeResponse(t, rr), "subscription")
	assertLeadDays(t, got, []int32{30, 7})

	// Explicit unsorted values are sorted descending.
	rr = env.do(t, http.MethodPost, "/api/v1/subscriptions", "", `{
		"name":"Netflix custom","billingCycle":"MONTHLY","price":1000,"startedAt":"2026-01-15",
		"leadDays":[3,14]
	}`)
	if rr.Code != http.StatusCreated {
		t.Fatalf("create with leadDays = %d, want 201 (%s)", rr.Code, rr.Body.String())
	}
	subID, got := leadDaysFromObject(t, decodeResponse(t, rr), "subscription")
	assertLeadDays(t, got, []int32{14, 3})

	// PATCH without / with null keeps it.
	for _, extra := range []string{"", `,"leadDays":null`} {
		rr = env.do(t, http.MethodPatch, "/api/v1/subscriptions/"+subID, "", `{
			"name":"Netflix custom đổi tên","billingCycle":"MONTHLY","price":1000,"startedAt":"2026-01-15"`+extra+`
		}`)
		if rr.Code != http.StatusOK {
			t.Fatalf("PATCH leadDays%s = %d, want 200 (%s)", extra, rr.Code, rr.Body.String())
		}
		_, got = leadDaysFromObject(t, decodeResponse(t, rr), "subscription")
		assertLeadDays(t, got, []int32{14, 3})
	}

	// Empty array is a 400 and names the field.
	for _, tc := range []struct {
		name, method, path string
	}{
		{"create empty", http.MethodPost, "/api/v1/subscriptions"},
		{"update empty", http.MethodPatch, "/api/v1/subscriptions/" + subID},
	} {
		t.Run(tc.name, func(t *testing.T) {
			rr := env.do(t, tc.method, tc.path, "vi", `{
				"name":"Netflix","billingCycle":"MONTHLY","price":1000,"startedAt":"2026-01-15",
				"leadDays":[]
			}`)
			if rr.Code != http.StatusBadRequest {
				t.Fatalf("empty leadDays = %d, want 400 (%s)", rr.Code, rr.Body.String())
			}
			if got := firstFieldError(t, decodeResponse(t, rr), "leadDays"); got == "" {
				t.Errorf("fieldErrors.leadDays is empty")
			}

			rrEN := env.do(t, tc.method, tc.path, "en-US,en;q=0.9", `{
				"name":"Netflix","billingCycle":"MONTHLY","price":1000,"startedAt":"2026-01-15",
				"leadDays":[]
			}`)
			if rrEN.Code != http.StatusBadRequest {
				t.Fatalf("empty leadDays (en) = %d, want 400 (%s)", rrEN.Code, rrEN.Body.String())
			}
			if got := firstFieldError(t, decodeResponse(t, rrEN), "leadDays"); got != "Lead days must contain between 1 and 5 values" {
				t.Errorf("fieldErrors.leadDays (en) = %q", got)
			}
		})
	}
}
