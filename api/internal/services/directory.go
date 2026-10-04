package services

import (
	"context"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/thanhtrung9368/warranty-vault/api/internal/ai"
	"github.com/thanhtrung9368/warranty-vault/api/internal/i18n"
)

// Warranty directory — "giờ tôi mang máy đi đâu?" (FEATURE_IDEAS #15).
//
// The honest answer this type encodes has three tiers, and they are deliberately
// NOT merged into one blob:
//
//  1. What the VENDOR publishes (BrandServiceInfo, migration 0012): the brand's
//     own service-centre locator, copied from migration 0008. It is a URL, not a
//     phone number, because a vendor-maintained page cannot go stale the way a
//     transcribed hotline can.
//  2. What the USER recorded (Warranty.provider / .address / .phone): the only
//     contact details the app will ever present as contact details, and the only
//     ones that can be correct for a specific shop. `phoneSource` says exactly
//     that, so a client can never render an app-supplied number that does not
//     exist.
//  3. What the app does NOT know: `brand == nil` or `provider == nil`, plus a
//     Vietnamese disclaimer. A missing answer is shown as missing — the failure
//     mode this package refuses is a plausible-looking guess.

// DirectoryBrand is a brand's row of the warranty directory, enriched with the
// human-readable brand name from the Brand catalog.
type DirectoryBrand struct {
	BrandID           string  `json:"brandId"`
	Name              string  `json:"name"`
	ServiceLocatorURL *string `json:"serviceLocatorUrl"`
	SupportURL        *string `json:"supportUrl"`
	Notes             *string `json:"notes"`
}

// DirectoryProvider is a matched row of the WarrantyProvider catalog. Its Phone
// and Address are exposed for completeness but are NULL for every seeded row
// (migration 0008) — user-facing rendering must use WarrantyCentre.Address /
// .Phone, which carry the user's own values and a `phoneSource`.
type DirectoryProvider struct {
	ID         string  `json:"id"`
	Name       string  `json:"name"`
	Phone      *string `json:"phone"`
	Address    *string `json:"address"`
	WebsiteURL *string `json:"websiteUrl"`
	Notes      *string `json:"notes"`
}

// WarrantyCentre is one warranty package's answer to "where do I take this".
type WarrantyCentre struct {
	WarrantyID   string  `json:"warrantyId"`
	WarrantyType string  `json:"warrantyType"`
	EndDate      *string `json:"endDate"`
	IsActive     bool    `json:"isActive"`
	// ProviderInput is the free text the user typed. Always present when the
	// warranty has a provider, matched or not, so a client can always show
	// something true instead of an empty box.
	ProviderInput *string `json:"providerInput"`
	// Provider is the catalog row the free text resolved to, or null. Null is a
	// normal outcome, not an error.
	Provider *DirectoryProvider `json:"provider"`
	// Address / Phone are the USER's own values (Warranty.address / .phone).
	Address *string `json:"address"`
	Phone   *string `json:"phone"`
	// PhoneSource is "user" when Phone != null and "none" otherwise. It exists so
	// no client can render a phone number without saying where it came from: the
	// app never supplies one.
	PhoneSource string `json:"phoneSource"`
}

// ServiceDirectory is the response of GET /api/v1/devices/{id}/service-directory.
type ServiceDirectory struct {
	DeviceID   string `json:"deviceId"`
	DeviceName string `json:"deviceName"`
	Category   string `json:"category"`
	// BrandInput is Device.brand exactly as the user typed it (nil when unset).
	BrandInput *string `json:"brandInput"`
	// Brand is the directory row for BrandInput, or null when the app has no
	// entry for that brand (only 16 brands are seeded — see migration 0012).
	Brand *DirectoryBrand `json:"brand"`
	// Centres always has one entry per warranty package on the device, in
	// Warranty order, including packages whose provider matched nothing.
	Centres []WarrantyCentre `json:"centres"`
	// Disclaimer is always present: it is the reason the response has so many
	// nulls, stated where the user can read it. Rendered in the language of the
	// REQUEST (docs/I18N_PLAN.md §3, Phase 1) — the sentence is the app explaining
	// its own limits, so it has to be in the language the reader asked for.
	Disclaimer string `json:"disclaimer"`
}

// DirectoryDisclaimer states the app's limits in the response itself. Kept as a
// constant (not assembled per request) so every client shows the same sentence
// and so a test can assert it verbatim.
//
// It is the Vietnamese SOURCE text and doubles as the catalog key
// (internal/i18n/catalog.go), which is why it is a named constant: the sentence
// reaches `i18n.Text` as DATA in BuildServiceDirectory, and the same wording has
// to stay reviewable in one place. The constant keeps the Vietnamese sentence
// because the constant IS the Vietnamese sentence — what varies is the language
// it is rendered in, which is the language of the directory request.
const DirectoryDisclaimer = "App không lưu sẵn hotline hay địa chỉ trung tâm bảo hành: " +
	"những thông tin đó thay đổi liên tục và app không kiểm chứng được, nên một hotline sai còn tệ hơn " +
	"không có. Số điện thoại và địa chỉ hiện ở đây là do bạn tự ghi cho gói bảo hành. " +
	"Link bên dưới là trang tra cứu chính thức của hãng."

// BuildServiceDirectory resolves the directory bundle for one device the caller
// owns.
//
// Ownership is not re-implemented here: it goes through GetDevice, the audited
// path used by GET /api/v1/devices/{id}, so a device belonging to someone else is
// a NOT_FOUND exactly as it is there.
//
// i18n: only the disclaimer is translated here, and it is rendered through
// `i18n.Text(ctx, DirectoryDisclaimer)` because the sentence travels as DATA
// (a named constant) rather than as a literal at this call site — `i18n.T` is the
// printf-shaped call and `go vet` rejects a non-constant key for it. Everything
// else in the response is the user's own text or a vendor URL, which is not
// translatable by definition.
func BuildServiceDirectory(ctx context.Context, db *pgxpool.Pool, userID, deviceID string) (*ServiceDirectory, error) {
	detail, err := GetDevice(ctx, db, userID, deviceID)
	if err != nil {
		return nil, err
	}
	catalog, err := ListCatalog(ctx, db)
	if err != nil {
		return nil, err
	}

	out := &ServiceDirectory{
		DeviceID:   detail.ID,
		DeviceName: detail.Name,
		Category:   detail.Category,
		BrandInput: detail.Brand,
		Centres:    make([]WarrantyCentre, 0, len(detail.Warranties)),
		Disclaimer: i18n.Text(ctx, DirectoryDisclaimer),
	}

	if detail.Brand != nil {
		out.Brand = resolveBrand(*detail.Brand, catalog)
	}

	now := time.Now()
	for _, w := range detail.Warranties {
		centre := WarrantyCentre{
			WarrantyID:    w.ID,
			WarrantyType:  w.Type,
			ProviderInput: w.Provider,
			Address:       w.Address,
			Phone:         w.Phone,
			PhoneSource:   "none",
		}
		if w.Phone != nil {
			centre.PhoneSource = "user"
		}
		if w.EndDate.Valid {
			end := w.EndDate.Time.UTC().Format(time.RFC3339)
			centre.EndDate = &end
			centre.IsActive = w.EndDate.Time.After(now)
		}
		if w.Provider != nil {
			centre.Provider = resolveProvider(*w.Provider, catalog)
		}
		out.Centres = append(out.Centres, centre)
	}
	return out, nil
}

// resolveBrand maps the free-text Device.brand onto a BrandServiceInfo row.
func resolveBrand(input string, catalog *Catalog) *DirectoryBrand {
	names := make([]string, 0, len(catalog.Brands))
	for _, b := range catalog.Brands {
		names = append(names, b.Name)
	}
	idx, ok := bestCatalogMatch(input, names)
	if !ok {
		return nil
	}
	brand := catalog.Brands[idx]
	for _, info := range catalog.BrandServiceInfo {
		if info.BrandID != brand.ID {
			continue
		}
		return &DirectoryBrand{
			BrandID:           brand.ID,
			Name:              brand.Name,
			ServiceLocatorURL: info.ServiceLocatorURL,
			SupportURL:        info.SupportURL,
			Notes:             info.Notes,
		}
	}
	return nil
}

// resolveProvider maps the free-text Warranty.provider onto a WarrantyProvider
// row. Returns nil when nothing matched — a warranty whose provider the user
// typed by hand is completely normal and stays useful (ProviderInput is still
// echoed).
func resolveProvider(input string, catalog *Catalog) *DirectoryProvider {
	names := make([]string, 0, len(catalog.WarrantyProviders))
	for _, p := range catalog.WarrantyProviders {
		names = append(names, p.Name)
	}
	idx, ok := bestCatalogMatch(input, names)
	if !ok {
		return nil
	}
	p := catalog.WarrantyProviders[idx]
	return &DirectoryProvider{
		ID:         p.ID,
		Name:       p.Name,
		Phone:      p.Phone,
		Address:    p.Address,
		WebsiteURL: p.WebsiteUrl,
		Notes:      p.Notes,
	}
}

// bestCatalogMatch returns the index of the catalog name that `input` refers to,
// or ok=false.
//
// Rule (deliberately conservative — a wrong referral sends the user to the wrong
// counter, which is the one outcome worth avoiding):
//
//  1. Both sides are tokenised with ai.Normalize, the same diacritic-folding
//     normaliser the OCR brand matcher uses, so "Điện thoại Samsung" and
//     "dien thoai samsung" behave identically.
//
//  2. A candidate is eligible ONLY when its whole token set appears in the input:
//     the user's text must CONTAIN the catalog name, not merely overlap it.
//
//     That direction-only rule is what stops the generic half of a provider name
//     from matching anything at all. If either containment direction were allowed,
//     "uỷ quyền" would be a token-subset of exactly one seeded row ("Trung tâm bảo
//     hành Apple uỷ quyền") and would silently resolve to Apple — a wrong referral
//     produced by a word that identifies nothing. Same for "bảo hành", "trung tâm".
//
//     It still covers every realistic input, because the values being matched come
//     from pickers whose options ARE the catalog names:
//     "Trung tâm bảo hành Samsung" (picker value) ≡ the row; "Trung tâm bảo hành
//     Samsung Quận 7" contains it; a brand field of "Samsung Galaxy S24 Ultra" or
//     "Điện thoại Samsung" contains "Samsung".
//
//  3. Among eligible candidates the most specific (longest) wins, so a short name
//     that also appears inside a longer one cannot shadow it.
//
//  4. A TIE returns ok=false. "Apple Samsung" in the brand field contains two brand
//     names equally well; picking one is a guess, and a guess is exactly what this
//     feature must not do. The caller still has the user's own text to show.
func bestCatalogMatch(input string, names []string) (int, bool) {
	inTokens := tokenSet(input)
	if len(inTokens) == 0 {
		return -1, false
	}

	best, bestScore, tied := -1, 0, false
	for i, name := range names {
		candTokens := tokenSet(name)
		if len(candTokens) == 0 || !subset(candTokens, inTokens) {
			continue
		}
		score := len(candTokens)
		switch {
		case best < 0 || score > bestScore:
			best, bestScore, tied = i, score, false
		case score == bestScore:
			tied = true
		}
	}
	if best < 0 || tied {
		return -1, false
	}
	return best, true
}

func tokenSet(s string) map[string]bool {
	out := map[string]bool{}
	for _, tok := range strings.Fields(ai.Normalize(s)) {
		out[tok] = true
	}
	return out
}

func subset(a, b map[string]bool) bool {
	if len(a) == 0 || len(a) > len(b) {
		return false
	}
	for tok := range a {
		if !b[tok] {
			return false
		}
	}
	return true
}
