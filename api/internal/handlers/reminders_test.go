package handlers

import "testing"

// GET /api/v1/reminders?includeDismissed=... is opt-in: absent must mean false
// (existing callers unchanged), and garbage must be rejected instead of being
// silently read as false.
func TestParseBoolQuery(t *testing.T) {
	for _, tc := range []struct {
		raw       string
		wantVal   bool
		wantValid bool
	}{
		{raw: "", wantVal: false, wantValid: true}, // absent → caller keeps its default
		{raw: "true", wantVal: true, wantValid: true},
		{raw: "TRUE", wantVal: true, wantValid: true},
		{raw: " true ", wantVal: true, wantValid: true},
		{raw: "1", wantVal: true, wantValid: true},
		{raw: "false", wantVal: false, wantValid: true},
		{raw: "0", wantVal: false, wantValid: true},
		{raw: "yes", wantValid: false},
		{raw: "on", wantValid: false},
		{raw: "2", wantValid: false},
		{raw: "maybe", wantValid: false},
	} {
		t.Run(tc.raw, func(t *testing.T) {
			val, ok := parseBoolQuery(tc.raw)
			if ok != tc.wantValid {
				t.Fatalf("parseBoolQuery(%q) ok = %v, want %v", tc.raw, ok, tc.wantValid)
			}
			if ok && val != tc.wantVal {
				t.Errorf("parseBoolQuery(%q) = %v, want %v", tc.raw, val, tc.wantVal)
			}
		})
	}
}
