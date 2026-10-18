package handlers

import (
	"net/http"
	"strings"
	"testing"
)

// The HTTP surface for migration 0016 (activation / extended cover on Device,
// trial on Subscription). The service tests prove the rules and the database
// round trip; these prove the three things only the wire can:
//
//  1. The JSON keys decode on create AND update (they are part of DeviceInput /
//     subscriptionRequest, not just the response).
//  2. The trial date is parsed with the same flexible parser as every other
//     subscription date, and a bad value comes back as fieldErrors.trialEndsAt.
//  3. `convertsToPrice` without `trialEndsAt` is a normal 400 with
//     fieldErrors.convertsToPrice — in both languages, because the message comes
//     from the catalog.

func jsonString(t *testing.T, obj map[string]any, key string) string {
	t.Helper()
	v, ok := obj[key]
	if !ok {
		t.Fatalf("response has no %q: %v", key, obj)
	}
	s, ok := v.(string)
	if !ok {
		t.Fatalf("%q = %T (%v), want a string", key, v, v)
	}
	return s
}

func TestDeviceActivationFieldsOverHTTP(t *testing.T) {
	env := setupDevicesI18nEnv(t)

	// Pre-activation: activatedAt BEFORE purchaseDate is deliberately accepted
	// over HTTP too — this is the contract's most surprising rule.
	rr := env.do(t, http.MethodPost, "/api/v1/devices", "", `{
		"name":"Máy kích hoạt trước","category":"PHONE","purchaseDate":"2026-01-15","purchasePrice":1000,
		"activationRequired":true,
		"activatedAt":"2025-12-20",
		"extendedCoverBuyBy":"2026-03-01"
	}`)
	if rr.Code != http.StatusCreated {
		t.Fatalf("create with activation fields = %d, want 201 (%s)", rr.Code, rr.Body.String())
	}
	body := decodeResponse(t, rr)
	device, ok := body["device"].(map[string]any)
	if !ok {
		t.Fatalf("response has no device object: %v", body)
	}
	if got, ok := device["activationRequired"].(bool); !ok || !got {
		t.Errorf("activationRequired = %v, want true", device["activationRequired"])
	}
	if got := jsonString(t, device, "activatedAt"); !strings.HasPrefix(got, "2025-12-20") {
		t.Errorf("activatedAt = %q, want 2025-12-20…", got)
	}
	if got := jsonString(t, device, "extendedCoverBuyBy"); !strings.HasPrefix(got, "2026-03-01") {
		t.Errorf("extendedCoverBuyBy = %q, want 2026-03-01…", got)
	}
	deviceID, _ := device["id"].(string)

	// GET detail returns them too (every device read).
	rr = env.do(t, http.MethodGet, "/api/v1/devices/"+deviceID, "", "")
	if rr.Code != http.StatusOK {
		t.Fatalf("GET device = %d (%s)", rr.Code, rr.Body.String())
	}
	detail := decodeResponse(t, rr)["device"].(map[string]any)
	if got := jsonString(t, detail, "activatedAt"); !strings.HasPrefix(got, "2025-12-20") {
		t.Errorf("detail activatedAt = %q", got)
	}

	// A nonsense date is a field error, not a 500, and it moves with `lang`.
	rr = env.do(t, http.MethodPost, "/api/v1/devices?lang=vi", "", `{
		"name":"Máy","category":"PHONE","purchaseDate":"2026-01-15","purchasePrice":1000,
		"activatedAt":"hôm qua"
	}`)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("invalid activatedAt = %d, want 400 (%s)", rr.Code, rr.Body.String())
	}
	if got := firstFieldError(t, decodeResponse(t, rr), "activatedAt"); got != "Ngày kích hoạt không hợp lệ" {
		t.Errorf("fieldErrors.activatedAt = %q", got)
	}

	rr = env.do(t, http.MethodPatch, "/api/v1/devices/"+deviceID+"?lang=en", "", `{
		"name":"Máy","category":"PHONE","purchaseDate":"2026-01-15","purchasePrice":1000,
		"extendedCoverBuyBy":"31/12/2026"
	}`)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("invalid extendedCoverBuyBy = %d, want 400 (%s)", rr.Code, rr.Body.String())
	}
	if got := firstFieldError(t, decodeResponse(t, rr), "extendedCoverBuyBy"); got != "Invalid extended-cover purchase deadline" {
		t.Errorf("fieldErrors.extendedCoverBuyBy (en) = %q", got)
	}

	// PATCH omitting the fields clears them (documented replace semantics).
	rr = env.do(t, http.MethodPatch, "/api/v1/devices/"+deviceID, "", `{
		"name":"Máy thường","category":"PHONE","purchaseDate":"2026-01-15","purchasePrice":1000
	}`)
	if rr.Code != http.StatusOK {
		t.Fatalf("PATCH clear = %d, want 200 (%s)", rr.Code, rr.Body.String())
	}
	cleared := decodeResponse(t, rr)["device"].(map[string]any)
	if got, _ := cleared["activationRequired"].(bool); got {
		t.Error("PATCH without activationRequired left it true, want false")
	}
	if v, ok := cleared["activatedAt"]; !ok || v != nil {
		t.Errorf("PATCH clear activatedAt = %v, want null", v)
	}
	if v, ok := cleared["extendedCoverBuyBy"]; !ok || v != nil {
		t.Errorf("PATCH clear extendedCoverBuyBy = %v, want null", v)
	}
}

func TestSubscriptionTrialFieldsOverHTTP(t *testing.T) {
	env := setupSubsI18nEnv(t)

	// A trial with a conversion price.
	rr := env.do(t, http.MethodPost, "/api/v1/subscriptions", "", `{
		"name":"Trial plan","billingCycle":"MONTHLY","price":0,"startedAt":"2026-10-12",
		"autoRenew":true,"trialEndsAt":"2026-11-12","convertsToPrice":260000
	}`)
	if rr.Code != http.StatusCreated {
		t.Fatalf("create trial = %d, want 201 (%s)", rr.Code, rr.Body.String())
	}
	sub := decodeResponse(t, rr)["subscription"].(map[string]any)
	if got := jsonString(t, sub, "trialEndsAt"); !strings.HasPrefix(got, "2026-11-12") {
		t.Errorf("trialEndsAt = %q, want 2026-11-12…", got)
	}
	if got, _ := sub["convertsToPrice"].(float64); got != 260000 {
		t.Errorf("convertsToPrice = %v, want 260000", sub["convertsToPrice"])
	}
	subID, _ := sub["id"].(string)

	// GET detail carries the pair.
	rr = env.do(t, http.MethodGet, "/api/v1/subscriptions/"+subID, "", "")
	if rr.Code != http.StatusOK {
		t.Fatalf("GET subscription = %d (%s)", rr.Code, rr.Body.String())
	}
	detail := decodeResponse(t, rr)["subscription"].(map[string]any)
	if got, _ := detail["convertsToPrice"].(float64); got != 260000 {
		t.Errorf("detail convertsToPrice = %v", detail["convertsToPrice"])
	}

	// ConvertsToPrice without trialEndsAt: 400 fieldErrors.convertsToPrice in both
	// languages. This is THE rule the contract calls out.
	for _, tc := range []struct {
		name, lang, want string
	}{
		{"vi", "vi", "Chỉ đặt giá sau dùng thử khi đã có ngày kết thúc dùng thử"},
		{"en", "en-US,en;q=0.9", "A post-trial price needs a trial end date"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			rr := env.do(t, http.MethodPost, "/api/v1/subscriptions", tc.lang, `{
				"name":"No trial date","billingCycle":"MONTHLY","price":0,"startedAt":"2026-10-12",
				"autoRenew":true,"convertsToPrice":260000
			}`)
			if rr.Code != http.StatusBadRequest {
				t.Fatalf("price without date = %d, want 400 (%s)", rr.Code, rr.Body.String())
			}
			if got := firstFieldError(t, decodeResponse(t, rr), "convertsToPrice"); got != tc.want {
				t.Errorf("fieldErrors.convertsToPrice = %q, want %q", got, tc.want)
			}
		})
	}

	// A date without a price is allowed (the user knows when, not how much).
	rr = env.do(t, http.MethodPost, "/api/v1/subscriptions", "", `{
		"name":"Date only","billingCycle":"MONTHLY","price":0,"startedAt":"2026-10-12",
		"autoRenew":true,"trialEndsAt":"2026-11-12"
	}`)
	if rr.Code != http.StatusCreated {
		t.Fatalf("date without price = %d, want 201 (%s)", rr.Code, rr.Body.String())
	}
	if v, ok := decodeResponse(t, rr)["subscription"].(map[string]any)["convertsToPrice"]; !ok || v != nil {
		t.Errorf("convertsToPrice = %v, want null", v)
	}

	// A malformed trial date names trialEndsAt and does not invent another key.
	rr = env.do(t, http.MethodPost, "/api/v1/subscriptions?lang=vi", "", `{
		"name":"Bad date","billingCycle":"MONTHLY","price":0,"startedAt":"2026-10-12",
		"autoRenew":true,"trialEndsAt":"12/11/2026","convertsToPrice":260000
	}`)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("bad trial date = %d, want 400 (%s)", rr.Code, rr.Body.String())
	}
	if got := firstFieldError(t, decodeResponse(t, rr), "trialEndsAt"); got != "Ngày kết thúc dùng thử không hợp lệ" {
		t.Errorf("fieldErrors.trialEndsAt = %q", got)
	}
}
