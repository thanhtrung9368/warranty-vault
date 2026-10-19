// Package fx is the server side of multi-currency devices (gap #16): the list of
// currencies the API accepts, and a small client over a free, keyless
// exchange-rate upstream used ONLY to prefill the rate field in the client UI.
//
// ── The rate that matters is NOT fetched here ─────────────────────────────
//
// A device's "fxRate" is the VND value of one unit of its currency LOCKED when
// the user recorded the purchase (migration 0022). Nothing in this package is
// ever used to compute a device's VND value or a stats total — those read the
// stored rate, so a 2024 purchase counted in 2026 still shows what was actually
// paid. This endpoint exists so a user typing "999" and picking "USD" does not
// have to look up today's rate by hand; once they save, today's number becomes
// history and never moves again.
//
// ── Upstream choice ────────────────────────────────────────────────────────
//
// open.er-api.com (exchangerate-api.com's free tier): keyless, no account, one
// request per currency per TTL, and — the deciding factor — it quotes VND.
// Frankfurter (ECB reference rates) does NOT: the ECB's reference set contains
// no VND, so a Frankfurter-backed endpoint could not answer the one question
// this feature exists to answer (VND per USD/EUR/…). A source that silently
// lacked VND would have forced the client to enter the rate by hand every time.
//
// ── Cache ──────────────────────────────────────────────────────────────────
//
// Results are cached in-process per base currency for DefaultTTL (12 hours).
// Why 12h: the upstream itself refreshes at most once a day (its
// time_next_update_utc is ~24h out), so a shorter TTL would re-request the SAME
// numbers; 12h bounds staleness to at most one upstream refresh while keeping
// outbound traffic to two small GETs per currency per server instance per day.
// It is not a market-data feed and must not become one: a live rate here would
// be a lie about what the user's device is worth.
//
// A failed refresh is NOT cached as if it were a rate. If a cached value exists
// it is served with `stale: true` (and its original fetchedAt); if there is
// none, the endpoint answers 503 and the client asks the user to type the rate.
// Inventing a rate would corrupt every total the locked-rate design protects.
package fx

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"
)

const (
	// DefaultEndpoint is the free, keyless upstream. Called as
	// `<endpoint>/<BASE>` and answered with {"result":"success","base_code":…,
	// "rates":{…}}. It quotes VND (Frankfurter/ECB does not; see the package doc).
	DefaultEndpoint = "https://open.er-api.com/v6/latest"

	// DefaultTTL is how long a fetched table is considered fresh. See the
	// package doc for why 12 hours.
	DefaultTTL = 12 * time.Hour

	// DefaultTimeout bounds ONE upstream request. Deliberately short: prefilling
	// a form field is not worth holding an HTTP request open. It is also well
	// under the server's 30s WriteTimeout, so the client always gets the honest
	// 503 instead of a dead connection.
	DefaultTimeout = 5 * time.Second

	// maxBodyBytes caps the upstream response we will read. The real payload is
	// ~5 KB; the cap only stops a hijacked/misbehaving endpoint from streaming
	// forever.
	maxBodyBytes = 1 << 20

	// baseCurrency is the value every device VND computation is denominated in.
	// The endpoint must return it, otherwise the response is useless for this
	// feature and is treated as an upstream failure rather than served.
	baseCurrency = "VND"
)

// supportedCurrencies is the list this API accepts for Device.currency. It is
// the source of truth for the validation in services.ValidateDeviceInput and
// for the enum in openapi.yaml.
//
// Every entry is an ISO 4217 code quoted by the upstream above. The list is a
// deliberate subset of ISO 4217, not all of it: these are the currencies a
// Vietnamese user plausibly pays in when buying abroad, from an international
// seller, or second-hand. Keeping it closed is what lets the API reject a typo
// ("USDD", "usd") with a field error instead of storing an unusable row.
var supportedCurrencies = []string{
	"VND", // default; 1 VND = 1 VND, fxRate is NULL
	"USD", "EUR", "GBP", "CHF", "JPY", "KRW", "CNY", "TWD", "HKD",
	"SGD", "THB", "MYR", "IDR", "PHP", "INR", "AUD", "NZD", "CAD",
	"SEK", "NOK", "DKK", "PLN", "CZK", "RUB", "TRY", "AED", "BRL",
	"MXN", "ZAR",
}

var supportedSet = func() map[string]bool {
	m := make(map[string]bool, len(supportedCurrencies))
	for _, c := range supportedCurrencies {
		m[c] = true
	}
	return m
}()

// SupportedCurrencies returns a copy of the accepted ISO 4217 codes. VND is
// first; the order is otherwise the one clients may use for a picker.
func SupportedCurrencies() []string {
	out := make([]string, len(supportedCurrencies))
	copy(out, supportedCurrencies)
	return out
}

// NormalizeCurrency trims and upper-cases a currency code. An empty input stays
// empty, which callers read as "absent" (create: default VND; update: keep the
// stored currency). It does NOT validate — call IsSupportedCurrency.
func NormalizeCurrency(code string) string {
	return strings.ToUpper(strings.TrimSpace(code))
}

// IsSupportedCurrency reports whether code is one of SupportedCurrencies. The
// caller is expected to have normalised it first.
func IsSupportedCurrency(code string) bool {
	return supportedSet[code]
}

// ErrUnsupportedBase is returned when `base` is not in SupportedCurrencies. The
// handler maps it to a 400 with fieldErrors.base; it is a caller mistake, not an
// upstream failure.
var ErrUnsupportedBase = errors.New("fx: unsupported base currency")

// ErrUpstream means the rate table could not be obtained or was not usable. The
// handler maps it to 503 and tells the user to enter the rate by hand. The
// wrapped detail is for the server log only — never for the client.
var ErrUpstream = errors.New("fx: upstream unavailable")

// Snapshot is the JSON body of GET /api/v1/fx/rates.
//
// Rates are the upstream's table for Base, in the upstream's units: `Rates["VND"]`
// is how many VND one unit of Base is worth and MAY be fractional (e.g.
// 25860.555369). Device.fxRate is an integer, so a client prefills the field with
// `round(Rates.VND)`; the exact number is intentionally not rounded here, so the
// endpoint never hides what the upstream actually said.
type Snapshot struct {
	Base      string             `json:"base"`
	Rates     map[string]float64 `json:"rates"`
	FetchedAt string             `json:"fetchedAt"`
	// Stale is true only when this body is a cached value served PAST its TTL
	// because the refresh failed. A fresh fetch and a fresh cache hit both
	// report false. A stale response means "this is the last rate we could
	// verify, not today's" — the client should say so next to the field.
	Stale bool `json:"stale"`
}

// Options are the injectable seams for tests. The zero value of each field picks
// the production default.
type Options struct {
	Endpoint string
	Client   *http.Client
	TTL      time.Duration
	Now      func() time.Time
}

// Service owns the in-process cache. Safe for concurrent use; one instance per
// process (wired in cmd/server/main.go).
type Service struct {
	endpoint string
	client   *http.Client
	ttl      time.Duration
	now      func() time.Time

	mu    sync.Mutex
	cache map[string]cacheEntry
}

type cacheEntry struct {
	rates     map[string]float64
	fetchedAt time.Time
}

// NewFromEnv builds the production service.
func NewFromEnv() *Service {
	return New(Options{})
}

// New builds a Service, filling omitted options with production defaults.
func New(opts Options) *Service {
	if strings.TrimSpace(opts.Endpoint) == "" {
		opts.Endpoint = DefaultEndpoint
	}
	if opts.Client == nil {
		opts.Client = &http.Client{Timeout: DefaultTimeout}
	}
	if opts.TTL <= 0 {
		opts.TTL = DefaultTTL
	}
	if opts.Now == nil {
		opts.Now = time.Now
	}
	return &Service{
		endpoint: strings.TrimRight(opts.Endpoint, "/"),
		client:   opts.Client,
		ttl:      opts.TTL,
		now:      opts.Now,
		cache:    make(map[string]cacheEntry),
	}
}

// Rates returns the upstream table for base (defaulting base to USD when empty,
// which is the documented default of the endpoint).
//
// Order of operations:
//  1. a fresh cache entry is returned without touching the network and with
//     stale=false;
//  2. otherwise the upstream is fetched (bounded by the HTTP client timeout);
//  3. on success the entry is cached and returned with stale=false;
//  4. on failure, a cached entry — even expired — is returned with stale=true
//     and its ORIGINAL fetchedAt. The failure is not cached: the next request
//     tries again;
//  5. on failure with no cached entry, ErrUpstream is returned. The caller
//     answers 503 and asks the user for the rate. Nothing is invented.
func (s *Service) Rates(ctx context.Context, base string) (Snapshot, error) {
	base = NormalizeCurrency(base)
	if base == "" {
		base = "USD"
	}
	if !IsSupportedCurrency(base) {
		return Snapshot{}, ErrUnsupportedBase
	}

	now := s.now()
	entry, cached := s.lookup(base)
	if cached && now.Sub(entry.fetchedAt) < s.ttl {
		return snapshotOf(base, entry, false), nil
	}

	rates, err := s.fetch(ctx, base)
	if err == nil {
		s.store(base, rates, now)
		return snapshotOf(base, cacheEntry{rates: rates, fetchedAt: now}, false), nil
	}

	if cached {
		// The last known good table, clearly labelled: served past its TTL, with
		// the timestamp of the fetch that produced it (not "now").
		return snapshotOf(base, entry, true), nil
	}
	return Snapshot{}, err
}

func (s *Service) lookup(base string) (cacheEntry, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	e, ok := s.cache[base]
	return e, ok
}

func (s *Service) store(base string, rates map[string]float64, at time.Time) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.cache[base] = cacheEntry{rates: rates, fetchedAt: at}
}

func snapshotOf(base string, e cacheEntry, stale bool) Snapshot {
	return Snapshot{
		Base:      base,
		Rates:     e.rates,
		FetchedAt: e.fetchedAt.UTC().Format(time.RFC3339),
		Stale:     stale,
	}
}

// upstreamResponse is the shape of open.er-api.com's /v6/latest/<BASE>.
type upstreamResponse struct {
	Result   string             `json:"result"`
	BaseCode string             `json:"base_code"`
	Rates    map[string]float64 `json:"rates"`
}

// fetch performs one upstream request and returns a usable table, or an error
// wrapping ErrUpstream. It never blocks longer than the HTTP client's timeout.
func (s *Service) fetch(ctx context.Context, base string) (map[string]float64, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.endpoint+"/"+base, nil)
	if err != nil {
		return nil, fmt.Errorf("%w: build request: %v", ErrUpstream, err)
	}
	req.Header.Set("Accept", "application/json")

	resp, err := s.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrUpstream, err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, maxBodyBytes))
		return nil, fmt.Errorf("%w: HTTP %d", ErrUpstream, resp.StatusCode)
	}

	var body upstreamResponse
	dec := json.NewDecoder(io.LimitReader(resp.Body, maxBodyBytes))
	if err := dec.Decode(&body); err != nil {
		return nil, fmt.Errorf("%w: decode: %v", ErrUpstream, err)
	}
	// "result" is the upstream's own success flag; a 200 with "error" is a
	// failure, not an empty rate table.
	if body.Result != "success" {
		return nil, fmt.Errorf("%w: result %q", ErrUpstream, body.Result)
	}
	if len(body.Rates) == 0 {
		return nil, fmt.Errorf("%w: empty rate table", ErrUpstream)
	}

	// Normalise keys (the upstream already upper-cases) and, critically, require
	// the one rate this feature depends on. A table without VND cannot answer the
	// question the endpoint exists for, so it is a failure — not something to
	// serve with a missing key the client would have to notice.
	rates := make(map[string]float64, len(body.Rates))
	for code, value := range body.Rates {
		rates[strings.ToUpper(code)] = value
	}
	if v, ok := rates[baseCurrency]; !ok || v <= 0 {
		return nil, fmt.Errorf("%w: table has no usable %s rate", ErrUpstream, baseCurrency)
	}
	return rates, nil
}
