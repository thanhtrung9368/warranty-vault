package main

import (
	"context"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestReadyzURL(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name string
		port string
		want string
	}{
		{"explicit port", "4000", "http://127.0.0.1:4000/readyz"},
		{"custom port", "8080", "http://127.0.0.1:8080/readyz"},
		{"empty falls back to 4000", "", "http://127.0.0.1:4000/readyz"},
		{"whitespace only falls back to 4000", "   ", "http://127.0.0.1:4000/readyz"},
		{"trims surrounding whitespace", " 4000 ", "http://127.0.0.1:4000/readyz"},
	}
	for _, c := range cases {
		if got := readyzURL(c.port); got != c.want {
			t.Errorf("%s: readyzURL(%q) = %q want %q", c.name, c.port, got, c.want)
		}
	}
}

func TestProbeReadyz_OK(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/readyz" {
			t.Errorf("probe hit %q, want /readyz", r.URL.Path)
		}
		if r.Method != http.MethodGet {
			t.Errorf("probe used %s, want GET", r.Method)
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer srv.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	if err := probeReadyz(ctx, srv.Client(), srv.URL+"/readyz"); err != nil {
		t.Fatalf("expected nil error for HTTP 200, got %v", err)
	}
}

func TestProbeReadyz_DBUnavailable(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
		_, _ = w.Write([]byte(`{"error":"db_unavailable"}`))
	}))
	defer srv.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	err := probeReadyz(ctx, srv.Client(), srv.URL+"/readyz")
	if err == nil {
		t.Fatal("expected error for HTTP 503, got nil")
	}
	if want := "HTTP 503"; !strings.Contains(err.Error(), want) {
		t.Fatalf("error %q should mention %q", err.Error(), want)
	}
}

// TestProbeReadyz_ClosedPort covers the "server is down" case: nothing listens
// on the port, so the probe must fail fast instead of hanging.
func TestProbeReadyz_ClosedPort(t *testing.T) {
	t.Parallel()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	url := "http://" + ln.Addr().String() + "/readyz"
	if err := ln.Close(); err != nil {
		t.Fatalf("close listener: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	start := time.Now()
	if err := probeReadyz(ctx, &http.Client{Timeout: 2 * time.Second}, url); err == nil {
		t.Fatal("expected connection error, got nil")
	}
	if elapsed := time.Since(start); elapsed > 2*time.Second {
		t.Fatalf("probe took %s, should fail fast", elapsed)
	}
}

// TestRunHealthcheck_ExitCodes asserts the exit codes Docker consumes without
// spawning a process: 0 for a healthy /readyz, 1 for a 503 one.
func TestRunHealthcheck_ExitCodes(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name   string
		status int
		want   int
	}{
		{"200 -> healthy", http.StatusOK, 0},
		{"503 -> unhealthy", http.StatusServiceUnavailable, 1},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(c.status)
				_, _ = w.Write([]byte(`{"ok":true}`))
			}))
			defer srv.Close()

			if got := runHealthcheck(srv.URL + "/readyz"); got != c.want {
				t.Fatalf("runHealthcheck = %d want %d", got, c.want)
			}
		})
	}
}

// TestRunHealthcheck_ClosedPort is the exit-code view of the closed-port case.
func TestRunHealthcheck_ClosedPort(t *testing.T) {
	t.Parallel()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	url := "http://" + ln.Addr().String() + "/readyz"
	if err := ln.Close(); err != nil {
		t.Fatalf("close listener: %v", err)
	}

	if got := runHealthcheck(url); got != 1 {
		t.Fatalf("runHealthcheck on closed port = %d want 1", got)
	}
}
