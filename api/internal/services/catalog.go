package services

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/thanhtrung9368/warranty-vault/api/internal/i18n"
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
//
// `Name` is the DB's canonical Vietnamese name rendered in the request's
// language by CatalogForRequest. `Code` is never translated: it is the key the
// three clients match on and what the write paths validate against.
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
//
// `name` is the display name from the Brand catalog. It is included because
// GET /api/v1/brands/{brandId}/service-info returns the row on its own, with no
// sibling `brands` array to resolve the id against.
//
// `warrantyLookupUrl` (migration 0023, gap #11) is the brand's own
// warranty-STATUS page — a different question from `serviceLocatorUrl` ("where
// do I take it"). Nullable on purpose: only a URL that could be sourced is
// seeded, and null means the app does not know, not that no page exists.
type BrandServiceInfoOption struct {
	BrandID           string  `json:"brandId"`
	Name              string  `json:"name"`
	ServiceLocatorURL *string `json:"serviceLocatorUrl"`
	SupportURL        *string `json:"supportUrl"`
	WarrantyLookupURL *string `json:"warrantyLookupUrl"`
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
//
// The returned bundle is CANONICAL and language-free: Category.Name holds the
// Vietnamese string stored in the database, exactly as migration 0004 seeded
// it. Callers that need names for one request must go through
// CatalogForRequest, which localizes a copy AFTER this cache read; translating
// the cached value here would pin the first request's language for every user
// until the TTL expired.
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

// CatalogForRequest returns the catalog as one HTTP response must carry it:
// every non-category field comes straight from the cached bundle, and Categories
// is a NEW slice whose Name is rendered in the request's language (resolved on
// ctx — `?lang=` > Accept-Language > User.locale > English).
//
// The cache stores the canonical bundle, so the language decision happens here,
// after the cache read, on a copy. Two properties keep that safe:
//
//   - Copy-on-read. The cached *Catalog is never written, and neither is any
//     CategoryOption inside it: localizeCategoryNames allocates a fresh
//     Categories slice and writes only into that. The other four slices
//     (brands / stores / warranty providers / brand service info) share their
//     backing arrays with the cache, but nothing here or in the handler writes
//     to them — the handler marshals the result and drops it. That is a
//     deliberate difference from keying the cache by language, which would need
//     one cache entry (and one in-flight load) per language.
//   - The cache stays language-keyed by nothing. A language-keyed cache would
//     have to localize at load time, and ListCatalog is also read by
//     ai_extract.go's matchCategory (fuzzy-matching OCR text) and by the
//     device-bulk validator. Feeding those request-language names would change
//     OCR matching and buy validation nothing, since validation only ever looks
//     at the code.
//
// A Name missing from the i18n catalog — an operator renamed the row, or a
// future seed — renders as itself, because i18n.Text returns the key. An edited
// DB value stays visible rather than becoming an empty string.
func CatalogForRequest(ctx context.Context, db *pgxpool.Pool) (*Catalog, error) {
	cached, err := ListCatalog(ctx, db)
	if err != nil {
		return nil, err
	}
	return localizeCategoryNames(ctx, cached), nil
}

// localizeCategoryNames returns a COPY of cached whose category names are
// rendered for ctx. It must never write through to cached.Categories: that
// slice is shared with every other request the 60 s cache serves, and a write
// here would leak one request's language into the next one — the shared-struct
// bug this repo has had before.
func localizeCategoryNames(ctx context.Context, cached *Catalog) *Catalog {
	out := *cached
	out.Categories = make([]CategoryOption, len(cached.Categories))
	for i, c := range cached.Categories {
		out.Categories[i] = CategoryOption{Code: c.Code, Name: i18n.Text(ctx, c.Name)}
	}
	return &out
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
			Name:              b.Name,
			ServiceLocatorURL: b.ServiceLocatorUrl,
			SupportURL:        b.SupportUrl,
			WarrantyLookupURL: b.WarrantyLookupUrl,
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

// GetBrandServiceInfo resolves one brand's directory row for
// GET /api/v1/brands/{brandId}/service-info.
//
// Three outcomes, and the difference between the last two is deliberate:
//
//   - unknown / inactive brand id  ⇒ ErrNotFound (404). The id does not identify
//     a brand the app knows.
//   - known brand, no directory row ⇒ (nil, nil) and the handler writes
//     `{"serviceInfo": null}`. Only 16 of the 49 seeded brands have a directory
//     row (migration 0012), so "this brand has no recorded service info" is a
//     normal answer, not a missing resource. Turning it into a 404 would make a
//     client unable to tell "unknown brand" from "we simply have no links".
//   - known brand with a row ⇒ the row, including warrantyLookupUrl (nullable:
//     only the URLs that could be sourced were seeded in migration 0023).
//
// The lookup goes through ListCatalog's 60s in-process cache rather than a
// separate query, so this endpoint and GET /api/v1/catalog can never disagree
// about a URL, and an operator edit lands in both at the same moment.
func GetBrandServiceInfo(ctx context.Context, db *pgxpool.Pool, brandID string) (*BrandServiceInfoOption, error) {
	brandID = strings.TrimSpace(brandID)
	catalog, err := ListCatalog(ctx, db)
	if err != nil {
		return nil, fmt.Errorf("load catalog: %w", err)
	}

	found := false
	for _, b := range catalog.Brands {
		if b.ID == brandID {
			found = true
			break
		}
	}
	if !found {
		return nil, ErrNotFound(i18n.Text(ctx, "Không tìm thấy hãng"))
	}

	for i := range catalog.BrandServiceInfo {
		if catalog.BrandServiceInfo[i].BrandID == brandID {
			row := catalog.BrandServiceInfo[i]
			return &row, nil
		}
	}
	return nil, nil
}
