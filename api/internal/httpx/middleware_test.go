package httpx

import "testing"

// The share link (FEATURE_IDEAS #2) is a credential carried in the URL PATH, and
// the request log is the longest-lived copy of a URL — it lands in journald, in a
// log shipper and often in a third-party aggregator, readable by people who have no
// business holding a live read capability. These cases pin that the token never
// reaches the log line.

func TestRedactPathHidesShareTokens(t *testing.T) {
	cases := []struct {
		in   string
		want string
	}{
		{"/api/v1/public/shares/abcDEF123", "/api/v1/public/shares/{token}"},
		{"/api/v1/public/shares/abcDEF123/", "/api/v1/public/shares/{token}"},
		{"/api/v1/public/shares/", "/api/v1/public/shares/"},
		{"/api/v1/public/shares", "/api/v1/public/shares"},
		{"/api/v1/devices/abc/shares", "/api/v1/devices/abc/shares"},
		{"/api/files/abc123", "/api/files/abc123"},
		{"/healthz", "/healthz"},
		{"", ""},
	}
	for _, tc := range cases {
		if got := RedactPath(tc.in); got != tc.want {
			t.Errorf("RedactPath(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}

func TestRedactPathKeepsUsefulRouteInformation(t *testing.T) {
	// The point is not to hide the route — an operator must still see WHICH endpoint
	// was hit — only the credential inside it.
	got := RedactPath("/api/v1/public/shares/eyJhbGciOiJIUzI1NiJ9.secret")
	if got != "/api/v1/public/shares/{token}" {
		t.Fatalf("RedactPath = %q", got)
	}
}
