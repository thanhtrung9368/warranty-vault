package services

import (
	"context"
	"fmt"
	"sort"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	store "github.com/thanhtrung9368/warranty-vault/api/internal/store/gen"
)

// CatalogTTL is how long the in-process catalog cache lives. Mirrors the
// `unstable_cache({ revalidate: 3600 })` TS setup conceptually but uses a
// shorter TTL to match the Phase C plan ("60s TTL"). The catalog is
// admin-edited via Prisma Studio so freshness within a minute is fine.
const CatalogTTL = 60 * time.Second

// CategoryOption mirrors website/src/lib/services/catalog.ts::CategoryOption.
type CategoryOption struct {
	Code string `json:"code"`
	Name string `json:"name"`
}

// BrandOption mirrors website/src/lib/services/catalog.ts::BrandOption.
// `categoryCodes` is the empty array for global brands.
type BrandOption struct {
	ID            string   `json:"id"`
	Name          string   `json:"name"`
	CategoryCodes []string `json:"categoryCodes"`
}

// StoreOption mirrors website/src/lib/services/catalog.ts::StoreOption.
type StoreOption struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Type string `json:"type"`
}

// WarrantyProviderOption mirrors website/src/lib/services/catalog.ts::WarrantyProviderOption.
type WarrantyProviderOption struct {
	ID         string  `json:"id"`
	Name       string  `json:"name"`
	Phone      *string `json:"phone"`
	Address    *string `json:"address"`
	WebsiteUrl *string `json:"websiteUrl"`
	Notes      *string `json:"notes"`
}

// Catalog mirrors the bundle returned by website/src/lib/services/catalog.ts::getDeviceFormCatalog.
type Catalog struct {
	Categories         []CategoryOption         `json:"categories"`
	Brands             []BrandOption            `json:"brands"`
	Stores             []StoreOption            `json:"stores"`
	WarrantyProviders  []WarrantyProviderOption `json:"warrantyProviders"`
}

// catalogCache is a process-wide TTL cache. We use a sync.Map to avoid lock
// contention on reads — there's only ever one entry ("catalog") so this is a
// little overkill but keeps the door open for per-tenant variants later.
var catalogCache sync.Map

type catalogEntry struct {
	mu       sync.Mutex
	value    *Catalog
	expires  time.Time
	loading  bool
	pending  []chan catalogResult
}

type catalogResult struct {
	value *Catalog
	err   error
}

// ListCatalog returns the bundled catalog, populating the in-process TTL cache.
// Concurrent callers during a miss share the in-flight load.
func ListCatalog(ctx context.Context, db *pgxpool.Pool) (*Catalog, error) {
	const key = "catalog"
	rawAny, _ := catalogCache.LoadOrStore(key, &catalogEntry{})
	entry := rawAny.(*catalogEntry)

	entry.mu.Lock()
	if entry.value != nil && time.Now().Before(entry.expires) {
		v := entry.value
		entry.mu.Unlock()
		return v, nil
	}
	if entry.loading {
		ch := make(chan catalogResult, 1)
		entry.pending = append(entry.pending, ch)
		entry.mu.Unlock()
		select {
		case res := <-ch:
			return res.value, res.err
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}
	entry.loading = true
	entry.mu.Unlock()

	value, err := loadCatalog(ctx, db)

	entry.mu.Lock()
	entry.loading = false
	if err == nil {
		entry.value = value
		entry.expires = time.Now().Add(CatalogTTL)
	}
	pending := entry.pending
	entry.pending = nil
	entry.mu.Unlock()

	for _, ch := range pending {
		ch <- catalogResult{value: value, err: err}
	}
	return value, err
}

// InvalidateCatalogCache drops the cached entry. Called after admin writes
// (currently only Prisma Studio touches these tables, so this is mostly here
// for tests).
func InvalidateCatalogCache() {
	catalogCache.Delete("catalog")
}

func loadCatalog(ctx context.Context, db *pgxpool.Pool) (*Catalog, error) {
	q := store.New(db)

	cats, err := q.ListCategories(ctx)
	if err != nil {
		return nil, fmt.Errorf("list categories: %w", err)
	}
	categoryOpts := make([]CategoryOption, 0, len(cats))
	for _, c := range cats {
		categoryOpts = append(categoryOpts, CategoryOption{Code: c.Code, Name: c.Name})
	}

	brands, err := q.ListBrands(ctx)
	if err != nil {
		return nil, fmt.Errorf("list brands: %w", err)
	}
	bcRows, err := q.ListAllBrandCategories(ctx)
	if err != nil {
		return nil, fmt.Errorf("list brand categories: %w", err)
	}
	bcMap := make(map[string][]string, len(brands))
	for _, bc := range bcRows {
		bcMap[bc.BrandId] = append(bcMap[bc.BrandId], bc.CategoryCode)
	}
	for k := range bcMap {
		sort.Strings(bcMap[k])
	}
	brandOpts := make([]BrandOption, 0, len(brands))
	for _, b := range brands {
		codes := bcMap[b.ID]
		if codes == nil {
			codes = []string{}
		}
		brandOpts = append(brandOpts, BrandOption{
			ID:            b.ID,
			Name:          b.Name,
			CategoryCodes: codes,
		})
	}

	stores, err := q.ListStores(ctx)
	if err != nil {
		return nil, fmt.Errorf("list stores: %w", err)
	}
	storeOpts := make([]StoreOption, 0, len(stores))
	for _, s := range stores {
		storeOpts = append(storeOpts, StoreOption{ID: s.ID, Name: s.Name, Type: s.Type})
	}

	wps, err := q.ListWarrantyProviders(ctx)
	if err != nil {
		return nil, fmt.Errorf("list warranty providers: %w", err)
	}
	wpOpts := make([]WarrantyProviderOption, 0, len(wps))
	for _, w := range wps {
		wpOpts = append(wpOpts, WarrantyProviderOption{
			ID:         w.ID,
			Name:       w.Name,
			Phone:      w.Phone,
			Address:    w.Address,
			WebsiteUrl: w.WebsiteUrl,
			Notes:      w.Notes,
		})
	}

	return &Catalog{
		Categories:        categoryOpts,
		Brands:            brandOpts,
		Stores:            storeOpts,
		WarrantyProviders: wpOpts,
	}, nil
}
