package fx

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	store "github.com/thanhtrung9368/warranty-vault/api/internal/store/gen"
	"github.com/thanhtrung9368/warranty-vault/api/internal/wire"
)

// CachedRate is one SUCCESSFUL upstream table, as stored in the snapshot cache.
//
// FetchedAt is the instant the upstream call succeeded, never "now" and never
// the time a failed attempt was made — the TTL and the stale label are both
// measured from it. Source names the upstream the table came from, so a client
// can label the reference number.
type CachedRate struct {
	Rates     map[string]float64
	FetchedAt time.Time
	Source    string
}

// Cache is the persistence seam behind the ExchangeRate snapshot table
// (migration 0035).
//
// The contract is deliberately narrow, and the one rule that matters is: a
// failed fetch is NEVER stored. Save is called only with a table the upstream
// just returned successfully, and Latest returns only what Save wrote — so the
// service's stale-on-failure path can serve an old rate as old, but can never
// dress a failure up as a rate.
//
// Latest returns ok=false (and a nil error) when the base has no snapshot yet.
type Cache interface {
	Latest(ctx context.Context, base string) (rate CachedRate, ok bool, err error)
	Save(ctx context.Context, base string, rate CachedRate) error
}

// NewPostgresCache is the production Cache: the shared ExchangeRate table every
// instance of the deployment reads. A successful snapshot therefore serves the
// whole deployment for its 24h TTL, and survives a restart (the pre-0035 cache
// was per process and died with it).
func NewPostgresCache(pool *pgxpool.Pool) Cache {
	return &postgresCache{queries: store.New(pool)}
}

type postgresCache struct {
	queries *store.Queries
}

func (c *postgresCache) Latest(ctx context.Context, base string) (CachedRate, bool, error) {
	row, err := c.queries.GetLatestExchangeRate(ctx, base)
	if errors.Is(err, pgx.ErrNoRows) {
		return CachedRate{}, false, nil
	}
	if err != nil {
		return CachedRate{}, false, fmt.Errorf("fx cache: read %s: %w", base, err)
	}

	var rates map[string]float64
	if err := json.Unmarshal(row.Rates, &rates); err != nil {
		// A row this service wrote always decodes. Treat an undecodable one as
		// absent rather than as a rate: it can only come from a hand edit, and
		// the next successful fetch replaces it (same base, today's day key).
		slog.Warn("fx cache: undecodable snapshot ignored", "base", base, "err", err)
		return CachedRate{}, false, nil
	}
	if rates[baseCurrency] <= 0 {
		slog.Warn("fx cache: snapshot without a usable VND rate ignored", "base", base)
		return CachedRate{}, false, nil
	}

	return CachedRate{
		Rates:     rates,
		FetchedAt: row.FetchedAt.Time,
		Source:    row.Source,
	}, true, nil
}

func (c *postgresCache) Save(ctx context.Context, base string, rate CachedRate) error {
	raw, err := json.Marshal(rate.Rates)
	if err != nil {
		return fmt.Errorf("fx cache: encode %s: %w", base, err)
	}
	err = c.queries.UpsertExchangeRate(ctx, store.UpsertExchangeRateParams{
		Base: base,
		// The day key is the UTC calendar day of the fetch, the same instant the
		// 24h TTL is measured from. Two successful fetches on one day replace
		// one row (base, day is the primary key) instead of piling up.
		Day:       pgtype.Date{Time: rate.FetchedAt.UTC(), Valid: true},
		Rates:     raw,
		FetchedAt: wire.At(rate.FetchedAt),
		Source:    rate.Source,
	})
	if err != nil {
		return fmt.Errorf("fx cache: write %s: %w", base, err)
	}
	return nil
}

// memoryCache is the default Cache when Options.Cache is nil: a process-local
// map for unit tests and for a Service built without a database. Production
// wiring (cmd/server) always injects NewPostgresCache, which is what makes the
// TTL deployment-wide instead of per process — this type is NOT that cache.
//
// It is safe for concurrent use.
type memoryCache struct {
	mu      sync.Mutex
	entries map[string]CachedRate
}

func newMemoryCache() *memoryCache {
	return &memoryCache{entries: make(map[string]CachedRate)}
}

func (c *memoryCache) Latest(_ context.Context, base string) (CachedRate, bool, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	rate, ok := c.entries[base]
	return rate, ok, nil
}

func (c *memoryCache) Save(_ context.Context, base string, rate CachedRate) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.entries[base] = rate
	return nil
}
