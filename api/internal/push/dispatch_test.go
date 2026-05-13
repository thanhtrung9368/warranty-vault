package push

import (
	"strings"
	"testing"
)

// stubWeb / stubAPNs / stubFCM record the args their Send method was called
// with so tests can assert routing decisions without hitting the network.
type stubWeb struct {
	called  bool
	gotSub  WebSub
	gotPL   Payload
	respond Result
}

func (s *stubWeb) SendWeb(sub WebSub, pl Payload) Result {
	s.called = true
	s.gotSub = sub
	s.gotPL = pl
	return s.respond
}

type stubAPNs struct {
	called  bool
	gotTok  string
	gotPL   Payload
	respond Result
}

func (s *stubAPNs) SendAPNS(tok string, pl Payload) Result {
	s.called = true
	s.gotTok = tok
	s.gotPL = pl
	return s.respond
}

type stubFCM struct {
	called  bool
	gotTok  string
	gotPL   Payload
	respond Result
}

func (s *stubFCM) SendFCM(tok string, pl Payload) Result {
	s.called = true
	s.gotTok = tok
	s.gotPL = pl
	return s.respond
}

func newDispatcherWithStubs() (*Dispatcher, *stubWeb, *stubAPNs, *stubFCM) {
	w := &stubWeb{respond: Result{Ok: true}}
	a := &stubAPNs{respond: Result{Ok: true}}
	f := &stubFCM{respond: Result{Ok: true}}
	return &Dispatcher{Web: w, APNs: a, FCM: f}, w, a, f
}

func ptr(s string) *string { return &s }

func TestDispatch_RoutesByPlatform(t *testing.T) {
	t.Run("web", func(t *testing.T) {
		d, w, a, f := newDispatcherWithStubs()
		res := d.Send(Subscription{
			Platform: "web",
			Endpoint: "https://example.com/push/abc",
			P256dh:   ptr("p256dh-bytes"),
			Auth:     ptr("auth-bytes"),
		}, Payload{Title: "T", Body: "B"})
		if !res.Ok {
			t.Fatalf("expected Ok, got %+v", res)
		}
		if !w.called || a.called || f.called {
			t.Fatalf("only web should be called: web=%v apns=%v fcm=%v", w.called, a.called, f.called)
		}
		if w.gotSub.Endpoint != "https://example.com/push/abc" || w.gotSub.P256dh != "p256dh-bytes" || w.gotSub.Auth != "auth-bytes" {
			t.Fatalf("web sub mismatch: %+v", w.gotSub)
		}
		if w.gotPL.Title != "T" {
			t.Fatalf("payload not forwarded: %+v", w.gotPL)
		}
	})

	t.Run("apns strips prefix", func(t *testing.T) {
		d, w, a, f := newDispatcherWithStubs()
		res := d.Send(Subscription{
			Platform: "apns",
			Endpoint: "apns://device-token-123",
		}, Payload{Title: "T"})
		if !res.Ok {
			t.Fatalf("expected Ok, got %+v", res)
		}
		if w.called || !a.called || f.called {
			t.Fatalf("only apns should be called: w=%v a=%v f=%v", w.called, a.called, f.called)
		}
		if a.gotTok != "device-token-123" {
			t.Fatalf("expected stripped token, got %q", a.gotTok)
		}
	})

	t.Run("fcm strips prefix", func(t *testing.T) {
		d, _, _, f := newDispatcherWithStubs()
		res := d.Send(Subscription{
			Platform: "fcm",
			Endpoint: "fcm://reg-token-xyz",
		}, Payload{Title: "T"})
		if !res.Ok {
			t.Fatalf("expected Ok, got %+v", res)
		}
		if f.gotTok != "reg-token-xyz" {
			t.Fatalf("expected stripped fcm token, got %q", f.gotTok)
		}
	})

	t.Run("apns with bad prefix returns error", func(t *testing.T) {
		d, _, a, _ := newDispatcherWithStubs()
		res := d.Send(Subscription{
			Platform: "apns",
			Endpoint: "https://something-else",
		}, Payload{})
		if res.Ok {
			t.Fatalf("expected !Ok for invalid apns endpoint")
		}
		if a.called {
			t.Fatalf("apns transport must not be invoked on bad prefix")
		}
		if !strings.Contains(res.Error, "invalid apns") {
			t.Fatalf("error should mention invalid apns: %q", res.Error)
		}
	})

	t.Run("fcm with empty token returns error", func(t *testing.T) {
		d, _, _, f := newDispatcherWithStubs()
		res := d.Send(Subscription{
			Platform: "fcm",
			Endpoint: "fcm://",
		}, Payload{})
		if res.Ok {
			t.Fatalf("expected !Ok for empty fcm token")
		}
		if f.called {
			t.Fatalf("fcm transport must not be invoked on empty token")
		}
	})

	t.Run("unknown platform", func(t *testing.T) {
		d, w, a, f := newDispatcherWithStubs()
		res := d.Send(Subscription{Platform: "carrierPigeon", Endpoint: "x"}, Payload{})
		if res.Ok {
			t.Fatalf("expected !Ok for unknown platform")
		}
		if w.called || a.called || f.called {
			t.Fatalf("no transport should be called for unknown platform")
		}
		if !strings.Contains(res.Error, "unknown platform") {
			t.Fatalf("error should mention unknown platform: %q", res.Error)
		}
	})

	t.Run("empty platform falls back to web", func(t *testing.T) {
		d, w, _, _ := newDispatcherWithStubs()
		res := d.Send(Subscription{
			Platform: "",
			Endpoint: "https://x/y",
			P256dh:   ptr("p"),
			Auth:     ptr("a"),
		}, Payload{Title: "fallback"})
		if !res.Ok {
			t.Fatalf("expected Ok, got %+v", res)
		}
		if !w.called {
			t.Fatalf("web transport should be called for empty platform")
		}
	})
}

func TestDispatch_PropagatesGone(t *testing.T) {
	d := &Dispatcher{
		APNs: &stubAPNs{respond: Result{Ok: false, Gone: true, Error: "BadDeviceToken"}},
	}
	res := d.Send(Subscription{Platform: "apns", Endpoint: "apns://t"}, Payload{})
	if res.Ok || !res.Gone {
		t.Fatalf("expected Gone:true, got %+v", res)
	}
}

func TestDispatch_NilTransports(t *testing.T) {
	d := &Dispatcher{} // no transports wired
	for _, plat := range []string{"web", "apns", "fcm"} {
		res := d.Send(Subscription{Platform: plat, Endpoint: plat + "://t"}, Payload{})
		if res.Ok {
			t.Fatalf("expected !Ok for nil %s transport", plat)
		}
	}
}

func TestNewFromEnv_DoesNotPanicWithoutEnv(t *testing.T) {
	d := NewFromEnv()
	if d == nil || d.Web == nil || d.APNs == nil || d.FCM == nil {
		t.Fatalf("NewFromEnv should populate all transports, got %+v", d)
	}
	// All transports should fail with notConfigured rather than crash.
	res := d.Send(Subscription{Platform: "apns", Endpoint: "apns://t"}, Payload{})
	if res.Ok {
		t.Fatalf("expected !Ok without env, got %+v", res)
	}
}
