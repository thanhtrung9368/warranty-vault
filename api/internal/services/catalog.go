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
// shorter TTL to match the Phase C plan ("60s TTL"). The only things that write
// these tables today are the goose seed migrations (0004 categories; 0008 brands
// / stores / warranty providers) plus manual operator edits — there is no admin
// UI and Prisma Studio is long gone — so freshness within a minute is plenty.
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

// BrandServiceInfoOption is one row of the brand warranty directory
// (FEATURE_IDEAS #15, migration 0012).
//
// There is deliberately no `phone` and no `address` field: the table has no such
// column, because the app cannot verify a hotline and migration 0008 settled that
// a wrong hotline is worse than none. The only phone the app will ever show is
// the one the USER recorded on a warranty (`Warranty.phone`) — see
// ServiceDirectory / WarrantyCentre.Phone, which carry `phoneSource: "user"`.
// Adding a field here would be the first step towards inventing contact data, so
// it is a schema change and a conversation, not a patch.
type BrandServiceInfoOption struct {
	BrandID           string  `json:"brandId"`
	ServiceLocatorURL *string `json:"serviceLocatorUrl"`
	SupportURL        *string `json:"supportUrl"`
	Notes             *string `json:"notes"`
}

// Catalog mirrors the bundle returned by website/src/lib/services/catalog.ts::getDeviceFormCatalog.
//
// Only `Categories` is load-bearing for writes: assertCategoryExists (devices.go)
// and the wishlist create/update path reject a category code that is not an
// active row, so migration 0004 seeds the 20 codes from CATEGORY_LABELS. The
// other three are autocomplete suggestions only — Device.brand,
// Device.purchasePlace and Warranty.provider are free-text columns and no service
// validates them against these tables, so a missing row degrades a picker and
// never blocks a write. They are seeded anyway (migration 0008) because an empty
// picker on a fresh database is real friction: the user has to type and spell
// every store / warranty centre by hand on the first device they add, and an
// empty `Brand` table additionally makes `BrandCategory` and the OCR brand
// matcher (buildDraft → matchBrand) dead code.
type Catalog struct {
	Categories        []CategoryOption         `json:"categories"`
	Brands            []BrandOption            `json:"brands"`
	Stores            []StoreOption            `json:"stores"`
	WarrantyProviders []WarrantyProviderOption `json:"warrantyProviders"`
	// BrandServiceInfo is the brand → "where do I take this" directory added by
	// FEATURE_IDEAS #15 / migration 0012. Additive: clients that do not know the
	// field ignore it, and it ships through the SAME cached payload as the other
	// four so there is no second cache to invalidate.
	BrandServiceInfo []BrandServiceInfoOption `json:"brandServiceInfo"`
}

// catalogCache is a process-wide TTL cache. We use a sync.Map to avoid lock
// contention on reads — there's only ever one entry ("catalog") so this is a
// little overkill but keeps the door open for per-tenant variants later.
var catalogCache sync.Map

type catalogEntry struct {
	mu      sync.Mutex
	value   *Catalog
	expires time.Time
	loading bool
	pending []chan catalogResult
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

// InvalidateCatalogCache drops the cached entry. Nothing calls this in
// production today — there is no admin route or admin page that writes the
// catalog tables (Prisma Studio, which the old comment referenced, was removed
// with the Go migration) — so it exists for tests and for operators who edit the
// rows out-of-band and want the next request to see the change immediately.
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

	brandServiceInfo, err := q.ListBrandServiceInfo(ctx)
	if err != nil {
		return nil, fmt.Errorf("list brand service info: %w", err)
	}
	bsiOpts := make([]BrandServiceInfoOption, 0, len(brandServiceInfo))
	for _, b := range brandServiceInfo {
		bsiOpts = append(bsiOpts, BrandServiceInfoOption{
			BrandID:           b.BrandId,
			ServiceLocatorURL: b.ServiceLocatorUrl,
			SupportURL:        b.SupportUrl,
			Notes:             b.Notes,
		})
	}

	return &Catalog{
		Categories:        categoryOpts,
		Brands:            brandOpts,
		Stores:            storeOpts,
		WarrantyProviders: wpOpts,
		BrandServiceInfo:  bsiOpts,
	}, nil
}
