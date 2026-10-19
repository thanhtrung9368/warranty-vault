package fx

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"
)

// fakeClock is the injectable Now() used for every TTL assertion. A real clock
// would make the 12-hour cache test either slow or flaky; this one jumps.
type fakeClock struct {
	mu  sync.Mutex
	now time.Time
}

func (c *fakeClock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.now
}

func (c *fakeClock) Advance(d time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.now = c.now.Add(d)
}

// upstreamStub is a stand-in for open.er-api.com. It counts calls (that is the
// cache proof), can fail on demand, and can return a table without VND.
type upstreamStub struct {
	mu    sync.Mutex
	calls int
	fail  bool
	// omitVND drops the one rate this service requires, so the response is a
	// 200 that is still unusable.
	omitVND bool
	// delay lets a test prove the client timeout bounds the request.
	delay time.Duration
	rates map[string]float64
}

func (u *upstreamStub) CallCount() int {
	u.mu.Lock()
	defer u.mu.Unlock()
	return u.calls
}

func (u *upstreamStub) SetFail(v bool) {
	u.mu.Lock()
	defer u.mu.Unlock()
	u.fail = v
}

func (u *upstreamStub) handler(w http.ResponseWriter, _ *http.Request) {
	u.mu.Lock()
	u.calls++
	fail := u.fail
	omit := u.omitVND
	delay := u.delay
	rates := u.rates
	u.mu.Unlock()

	if delay > 0 {
		time.Sleep(delay)
	}
	if fail {
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(`{"result":"error","error-type":"down"}`))
		return
	}
	body := map[string]any{"result": "success", "base_code": "USD", "rates": rates}
	if omit {
		body["rates"] = map[string]float64{"USD": 1, "EUR": 0.89}
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(body)
}

func newTestService(t *testing.T, stub *upstreamStub, clock *fakeClock, client *http.Client) *Service {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(stub.handler))
	t.Cleanup(srv.Close)
	if client == nil {
		client = srv.Client()
	}
	return New(Options{Endpoint: srv.URL, Client: client, Now: clock.Now, TTL: DefaultTTL})
}

func fixedRates() map[string]float64 {
	return map[string]float64{"USD": 1, "EUR": 0.8896, "VND": 25860.555369}
}

// The supported list is the contract with the clients and with openapi.yaml.
// A duplicate, a lowercase code or a non-3-letter code would make the enum and
// the validator disagree.
func TestSupportedCurrenciesShape(t *testing.T) {
	seen := map[string]bool{}
	for _, c := range SupportedCurrencies() {
		if len(c) != 3 {
			t.Errorf("currency %q is not 3 letters", c)
		}
		if c != NormalizeCurrency(c) {
			t.Errorf("currency %q is not uppercase", c)
		}
		if seen[c] {
			t.Errorf("currency %q is listed twice", c)
		}
		seen[c] = true
	}
	if !seen["VND"] || !seen["USD"] {
		t.Fatalf("VND and USD must be supported; got %v", SupportedCurrencies())
	}
	if IsSupportedCurrency("VND") != true || IsSupportedCurrency("usd") {
		t.Error("IsSupportedCurrency must require the normalised code")
	}
	if got := NormalizeCurrency("  usd "); got != "USD" {
		t.Errorf("NormalizeCurrency = %q, want USD", got)
	}
	if got := NormalizeCurrency("   "); got != "" {
		t.Errorf("NormalizeCurrency(blank) = %q, want empty (absent)", got)
	}
}

// A fresh fetch is cached: the second call is served from memory, so the
// upstream sees exactly one request. This is the whole point of the cache.
func TestFreshFetchIsCached(t *testing.T) {
	stub := &upstreamStub{rates: fixedRates()}
	clock := &fakeClock{now: time.Date(2026, 10, 19, 8, 0, 0, 0, time.UTC)}
	svc := newTestService(t, stub, clock, nil)

	first, err := svc.Rates(context.Background(), "usd")
	if err != nil {
		t.Fatalf("first Rates: %v", err)
	}
	if first.Base != "USD" {
		t.Errorf("base = %q, want the normalised USD", first.Base)
	}
	if first.Stale {
		t.Error("a fresh fetch must not be marked stale")
	}
	if first.Rates["VND"] != 25860.555369 {
		t.Errorf("rates.VND = %v, want the upstream value", first.Rates["VND"])
	}
	if got, want := first.FetchedAt, clock.Now().Format(time.RFC3339); got != want {
		t.Errorf("fetchedAt = %q, want %q", got, want)
	}

	clock.Advance(DefaultTTL - time.Minute)
	second, err := svc.Rates(context.Background(), "USD")
	if err != nil {
		t.Fatalf("second Rates: %v", err)
	}
	if second.FetchedAt != first.FetchedAt {
		t.Error("a cache hit must keep the original fetchedAt")
	}
	if second.Stale {
		t.Error("a cache hit inside the TTL must not be stale")
	}
	if n := stub.CallCount(); n != 1 {
		t.Errorf("upstream calls = %d, want 1 (second call served from cache)", n)
	}
}

// Past the TTL the table is re-fetched, and a successful refresh is not stale.
func TestCacheRefreshesAfterTTL(t *testing.T) {
	stub := &upstreamStub{rates: fixedRates()}
	clock := &fakeClock{now: time.Date(2026, 10, 19, 8, 0, 0, 0, time.UTC)}
	svc := newTestService(t, stub, clock, nil)

	if _, err := svc.Rates(context.Background(), "USD"); err != nil {
		t.Fatalf("prime: %v", err)
	}
	firstFetchedAt := clock.Now().Format(time.RFC3339)

	clock.Advance(DefaultTTL + time.Second)
	// A new upstream value proves the second read is not the cached table.
	stub.mu.Lock()
	stub.rates = map[string]float64{"USD": 1, "VND": 26100}
	stub.mu.Unlock()

	snap, err := svc.Rates(context.Background(), "USD")
	if err != nil {
		t.Fatalf("after TTL: %v", err)
	}
	if snap.Stale {
		t.Error("a successful refresh must not be stale")
	}
	if snap.Rates["VND"] != 26100 {
		t.Errorf("rates.VND = %v, want the refreshed 26100", snap.Rates["VND"])
	}
	if snap.FetchedAt == firstFetchedAt {
		t.Error("fetchedAt must move when the TTL expires and the refresh succeeds")
	}
	if n := stub.CallCount(); n != 2 {
		t.Errorf("upstream calls = %d, want 2", n)
	}
}

// The stale path: the cache is past its TTL and the refresh fails, so the last
// known good table is served with stale=true and its ORIGINAL fetchedAt. A
// failure is never dressed up as a fresh rate.
func TestExpiredCacheServedStaleWhenRefreshFails(t *testing.T) {
	stub := &upstreamStub{rates: fixedRates()}
	clock := &fakeClock{now: time.Date(2026, 10, 19, 8, 0, 0, 0, time.UTC)}
	svc := newTestService(t, stub, clock, nil)

	first, err := svc.Rates(context.Background(), "USD")
	if err != nil {
		t.Fatalf("prime: %v", err)
	}
	clock.Advance(DefaultTTL + time.Hour)
	stub.SetFail(true)

	stale, err := svc.Rates(context.Background(), "USD")
	if err != nil {
		t.Fatalf("stale read must succeed: %v", err)
	}
	if !stale.Stale {
		t.Error("stale = false, want true when serving a past-TTL value after a failed refresh")
	}
	if stale.Rates["VND"] != first.Rates["VND"] {
		t.Errorf("rates changed on the stale path: %v vs %v", stale.Rates, first.Rates)
	}
	if stale.FetchedAt != first.FetchedAt {
		t.Errorf("stale fetchedAt = %q, want the original %q (not now)", stale.FetchedAt, first.FetchedAt)
	}

	// The failure is not cached: the next call retries. Once the upstream is
	// back, the response is fresh again and the old table is replaced.
	stub.SetFail(false)
	stub.mu.Lock()
	stub.rates = map[string]float64{"USD": 1, "VND": 27000}
	stub.mu.Unlock()

	fresh, err := svc.Rates(context.Background(), "USD")
	if err != nil {
		t.Fatalf("recovery read: %v", err)
	}
	if fresh.Stale {
		t.Error("stale = true after the upstream recovered")
	}
	if fresh.Rates["VND"] != 27000 {
		t.Errorf("rates.VND = %v, want the recovered 27000", fresh.Rates["VND"])
	}
	if n := stub.CallCount(); n != 3 {
		t.Errorf("upstream calls = %d, want 3 (failure was retried, not cached)", n)
	}
}

// No cache and no upstream is an error — the handler turns it into a 503 and the
// client asks the user to type the rate. The service never invents one.
func TestUpstreamDownWithNoCacheIsError(t *testing.T) {
	stub := &upstreamStub{fail: true}
	clock := &fakeClock{now: time.Now()}
	svc := newTestService(t, stub, clock, nil)

	snap, err := svc.Rates(context.Background(), "USD")
	if !errors.Is(err, ErrUpstream) {
		t.Fatalf("error = %v, want ErrUpstream", err)
	}
	if snap.Rates != nil {
		t.Errorf("a failed read must return no rates, got %v", snap.Rates)
	}
}

// A 200 whose table has no VND is a failure, not an empty answer: VND is the
// only thing the endpoint exists to supply.
func TestUpstreamTableWithoutVNDIsError(t *testing.T) {
	stub := &upstreamStub{rates: fixedRates(), omitVND: true}
	clock := &fakeClock{now: time.Now()}
	svc := newTestService(t, stub, clock, nil)

	if _, err := svc.Rates(context.Background(), "USD"); !errors.Is(err, ErrUpstream) {
		t.Fatalf("error = %v, want ErrUpstream for a table without VND", err)
	}
}

// The upstream must not be called for a currency the API does not accept.
func TestUnsupportedBaseIsRejectedWithoutUpstreamCall(t *testing.T) {
	stub := &upstreamStub{rates: fixedRates()}
	clock := &fakeClock{now: time.Now()}
	svc := newTestService(t, stub, clock, nil)

	if _, err := svc.Rates(context.Background(), "XYZ"); !errors.Is(err, ErrUnsupportedBase) {
		t.Fatalf("error = %v, want ErrUnsupportedBase", err)
	}
	if n := stub.CallCount(); n != 0 {
		t.Errorf("upstream calls = %d, want 0", n)
	}
}

// An empty base defaults to USD, the documented default of the endpoint.
func TestEmptyBaseDefaultsToUSD(t *testing.T) {
	stub := &upstreamStub{rates: fixedRates()}
	clock := &fakeClock{now: time.Now()}
	svc := newTestService(t, stub, clock, nil)

	snap, err := svc.Rates(context.Background(), "  ")
	if err != nil {
		t.Fatalf("Rates: %v", err)
	}
	if snap.Base != "USD" {
		t.Errorf("base = %q, want USD", snap.Base)
	}
}

// "Never block a request on the upstream for longer than a short timeout" is a
// hard requirement: a slow upstream must surface as ErrUpstream within the
// configured timeout, not hold the HTTP request open.
func TestSlowUpstreamIsBoundedByClientTimeout(t *testing.T) {
	stub := &upstreamStub{rates: fixedRates(), delay: 300 * time.Millisecond}
	clock := &fakeClock{now: time.Now()}
	client := &http.Client{Timeout: 20 * time.Millisecond}
	svc := newTestService(t, stub, clock, client)

	start := time.Now()
	_, err := svc.Rates(context.Background(), "USD")
	elapsed := time.Since(start)
	if !errors.Is(err, ErrUpstream) {
		t.Fatalf("error = %v, want ErrUpstream on timeout", err)
	}
	if elapsed > 200*time.Millisecond {
		t.Errorf("request took %v; the 20ms client timeout must bound it", elapsed)
	}
}

// The production defaults are part of the contract: 12h TTL (explained in the
// package doc) and a 5s ceiling on one upstream request.
func TestProductionDefaults(t *testing.T) {
	svc := New(Options{})
	if svc.ttl != 12*time.Hour {
		t.Errorf("default TTL = %v, want 12h", svc.ttl)
	}
	if svc.client.Timeout != DefaultTimeout || DefaultTimeout != 5*time.Second {
		t.Errorf("default timeout = %v, want 5s", svc.client.Timeout)
	}
	if svc.endpoint != "https://open.er-api.com/v6/latest" {
		t.Errorf("default endpoint = %q", svc.endpoint)
	}
}
