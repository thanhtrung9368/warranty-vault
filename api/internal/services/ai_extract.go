package services

import (
	"context"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/thanhtrung9368/warranty-vault/api/internal/ai"
	"github.com/thanhtrung9368/warranty-vault/api/internal/i18n"
	store "github.com/thanhtrung9368/warranty-vault/api/internal/store/gen"
)

// matchThreshold is the minimum normalized similarity for a free-text field to
// bind to a catalog row's *Id. Below it the text is kept verbatim and the field
// is reported in Unmatched so the UI can flag it for review. Conservative on
// purpose — a wrong silent bind is worse than leaving free-text.
const matchThreshold = 0.82

// OCR draft sanity bounds (roadmap #15).
//
// warrantyMonths: the manual device form bounds this field at min 0
// (website/src/components/device-form.tsx: `min={0}` + validateStep rejects
// < 0) and the write path (ValidateDeviceInput) rejects negative values — but
// neither caps the upper end. A vision model reading a noisy receipt can emit
// e.g. 1200, and the draft is fed straight into that form, so an absurd value
// would silently create a warranty ending a century from now. The draft path
// therefore bounds it to [0, 120] (10 years — longer than any consumer warranty
// this app tracks). 0 stays valid and means "no warranty", matching the form's
// own hint "Để 0 nếu không có".
//
// serialNumber: trimmed; a value longer than 120 bytes is OCR noise (junk line/
// table text) rather than an IMEI/serial, so it is dropped as well.
//
// A value that fails either bound is NOT passed through: it becomes null and the
// field name is appended to `unmatched`, so the UI can ask the user to fill it
// in manually instead of showing a wrong value.
const (
	maxDraftWarrantyMonths = 120
	maxDraftSerialBytes    = 120
)

// ReceiptExtractor is the AI boundary the service depends on. *ai.Client
// satisfies it; tests inject a fake. Keeps the service free of HTTP concerns.
type ReceiptExtractor interface {
	Enabled() bool
	ExtractReceipt(ctx context.Context, imageBytes []byte, mediaType string) (ai.ExtractedReceipt, error)
}

// ExtractInput is either an existing attachment (reuse the decrypt path) or a
// direct in-memory upload already MIME-validated by the handler.
type ExtractInput struct {
	AttachmentID string // optional
	Body         []byte // optional (direct upload)
	MediaType    string // required when Body is set
}

// DraftDevice mirrors DeviceInput field names so a client can map it 1:1 into
// the existing "Thêm thiết bị" form. It is NEVER persisted — purely a draft for
// the user to confirm. Matched catalog rows populate the *Id fields; unmatched
// free-text stays in the plain fields and is listed in Unmatched.
//
// Warnings is the advisory sibling of Unmatched (FEATURE_IDEAS #6): Unmatched
// means "we could not use this value", Warnings means "we kept it, but it looks
// wrong — review before saving". Both are non-blocking; neither empties a field
// on its own. Always `[]`, never null.
type DraftDevice struct {
	Name               *string   `json:"name"`
	Category           *string   `json:"category"` // catalog code when matched
	Brand              *string   `json:"brand"`
	BrandID            *string   `json:"brandId"`
	Model              *string   `json:"model"`
	SerialNumber       *string   `json:"serialNumber"`
	PurchaseDate       *string   `json:"purchaseDate"`
	PurchasePrice      *int64    `json:"purchasePrice"`
	PurchasePlace      *string   `json:"purchasePlace"`
	StoreID            *string   `json:"storeId"`
	WarrantyMonths     *int      `json:"warrantyMonths"`
	WarrantyProviderID *string   `json:"warrantyProviderId"`
	Confidence         string    `json:"confidence"`
	Unmatched          []string  `json:"unmatched"`
	Warnings           []Warning `json:"warnings"`
}

// ExtractReceipt resolves the image bytes (attachment or upload), calls the AI
// extractor, maps free-text to the curated catalog, and returns a draft. It
// never writes a Device row.
//
// i18n (docs/I18N_PLAN.md §3, Phase 1): every message below is the EXISTING
// Vietnamese literal wrapped in `i18n.Text(ctx, …)`, so the ctx must be the
// REQUEST's and the English column in internal/i18n/catalog.go is the only new
// text. Three of them are the interesting part of this wave:
//
//   - `feature_disabled` is reachable from BOTH this service and the handler
//     (handlers/ai.go checks d.AI before calling in), and both sides render the
//     same catalog key, so the two paths cannot drift into two sentences.
//   - the two `ai.AsError` families (mapAIError) carry messages produced by
//     internal/ai, which is a package with no request context — its error TEXT is
//     therefore the Vietnamese source and doubles as the catalog key, exactly the
//     arrangement internal/files has with services.filesText. Because
//     `i18n.Text` returns the key verbatim for an unknown key, a dynamic message
//     such as "Dịch vụ AI lỗi (529)" still reaches the client byte-for-byte: it
//     was never a catalog key and does not become one.
//   - the ATTACHMENT not-found ("Không tìm thấy file") is NOT here on purpose. It
//     belongs to the attachments domain and was already converted by wave 3, so
//     this path inherits it (see decryptAttachment's i18n note).
//
// No Code changes: an extraction that refused with `bad_input` before still
// refuses with `bad_input`, in either language.
func ExtractReceipt(ctx context.Context, db *pgxpool.Pool, client ReceiptExtractor, userID string, in ExtractInput) (DraftDevice, error) {
	if client == nil || !client.Enabled() {
		return DraftDevice{}, &AttachmentError{Code: "feature_disabled", Message: i18n.Text(ctx, "Tính năng quét hoá đơn chưa được bật")}
	}

	// Privacy gate: the user must explicitly opt in, since the (decrypted)
	// image is sent to a third-party AI provider. Default is OFF.
	q := store.New(db)
	user, uerr := q.GetUserByID(ctx, userID)
	if uerr != nil {
		if errors.Is(uerr, pgx.ErrNoRows) {
			return DraftDevice{}, notFound(i18n.Text(ctx, "Người dùng không tồn tại"))
		}
		return DraftDevice{}, internalErr(i18n.Text(ctx, "Lỗi tải người dùng"))
	}
	if !user.AiOptIn {
		return DraftDevice{}, &AttachmentError{
			Code:    "ai_optin_required",
			Message: i18n.Text(ctx, "Cần bật tính năng quét hoá đơn (AI) trong Cài đặt trước khi dùng"),
		}
	}

	// Resolve plaintext image bytes.
	var imgBytes []byte
	var mediaType string
	if in.AttachmentID != "" {
		plain, mime, _, derr := decryptAttachment(ctx, db, userID, in.AttachmentID)
		if derr != nil {
			return DraftDevice{}, derr
		}
		imgBytes, mediaType = plain, mime
	} else {
		if len(in.Body) == 0 {
			return DraftDevice{}, badInput(i18n.Text(ctx, "Thiếu ảnh"))
		}
		imgBytes, mediaType = in.Body, in.MediaType
	}

	// Attachments accept PDF / GIF / HEIC (files.AllowedMIMEs). OCR now accepts
	// PDF as well (roadmap #15): the Messages API takes a `document` block with
	// media_type application/pdf and every active model supports it — see
	// ai.IsSupportedReceiptType. GIF and HEIC still have no block type, so they get
	// a clear 400 here instead of a 502 "Dịch vụ AI lỗi" after a paid round-trip.
	if !ai.IsSupportedReceiptType(mediaType) {
		return DraftDevice{}, badInput(i18n.Text(ctx, "Chỉ hỗ trợ ảnh JPEG, PNG, WEBP hoặc PDF"))
	}

	extracted, err := client.ExtractReceipt(ctx, imgBytes, mediaType)
	if err != nil {
		if ae, ok := ai.AsError(err); ok {
			return DraftDevice{}, mapAIError(ctx, ae)
		}
		return DraftDevice{}, internalErr(i18n.Text(ctx, "Lỗi trích xuất ảnh"))
	}

	cat, err := ListCatalog(ctx, db)
	if err != nil {
		return DraftDevice{}, internalErr(i18n.Text(ctx, "Lỗi tải danh mục"))
	}

	draft := buildDraft(ctx, extracted, cat)

	// Post-check on the serial the model returned (FEATURE_IDEAS #6). Purely
	// advisory: the value stays in the draft so the form is still pre-filled, and
	// the client shows the warnings in yellow next to it. The DB-backed half is the
	// duplicate lookup across this user's other devices — the draft has no device
	// id yet, so there is nothing to exclude.
	draft.Warnings = DeviceSerialWarnings(ctx, db, userID, draft.SerialNumber, "")

	return draft, nil
}

// SetAIOptIn flips the per-user AI opt-in flag.
func SetAIOptIn(ctx context.Context, db *pgxpool.Pool, userID string, enabled bool) error {
	return store.New(db).SetUserAIOptIn(ctx, store.SetUserAIOptInParams{ID: userID, AiOptIn: enabled})
}

// GetAIOptIn reads the per-user AI opt-in flag.
func GetAIOptIn(ctx context.Context, db *pgxpool.Pool, userID string) (bool, error) {
	u, err := store.New(db).GetUserByID(ctx, userID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return false, notFound(i18n.Text(ctx, "Người dùng không tồn tại"))
		}
		return false, internalErr(i18n.Text(ctx, "Lỗi tải người dùng"))
	}
	return u.AiOptIn, nil
}

func buildDraft(ctx context.Context, e ai.ExtractedReceipt, cat *Catalog) DraftDevice {
	d := DraftDevice{
		Name:          e.Name,
		Model:         e.Model,
		PurchaseDate:  e.PurchaseDate,
		PurchasePrice: e.PurchasePrice,
		Confidence:    "medium",
		Unmatched:     []string{},
		// Local (no-database) advisories are applied here so the draft is already
		// useful on its own; ExtractReceipt then adds the duplicate-serial lookup.
		Warnings: []Warning{},
	}
	if e.Confidence != nil && *e.Confidence != "" {
		d.Confidence = *e.Confidence
	}

	// Serial/IMEI — the real warranty identifier in Vietnam. Trimmed; a value
	// that is empty or implausibly long (OCR noise) is dropped and flagged.
	if sn, ok := sanitizeSerialNumber(e.SerialNumber); ok {
		d.SerialNumber = sn
		if sn != nil {
			d.Warnings = append(d.Warnings, SerialWarnings(ctx, *sn, 0)...)
		}
	} else {
		d.Unmatched = append(d.Unmatched, "serialNumber")
	}

	// Warranty duration — bounded to [0, 120] months; out-of-range is dropped and
	// flagged rather than passed into the form.
	if wm, ok := sanitizeWarrantyMonths(e.WarrantyMonths); ok {
		d.WarrantyMonths = wm
	} else {
		d.Unmatched = append(d.Unmatched, "warrantyMonths")
	}

	// Brand → catalog Brands.
	if e.Brand != nil && *e.Brand != "" {
		d.Brand = e.Brand
		if id, ok := matchBrand(*e.Brand, cat.Brands); ok {
			d.BrandID = &id
		} else {
			d.Unmatched = append(d.Unmatched, "brand")
		}
	}

	// PurchasePlace → catalog Stores.
	if e.PurchasePlace != nil && *e.PurchasePlace != "" {
		d.PurchasePlace = e.PurchasePlace
		if id, ok := matchStore(*e.PurchasePlace, cat.Stores); ok {
			d.StoreID = &id
		} else {
			d.Unmatched = append(d.Unmatched, "purchasePlace")
		}
	}

	// Category → catalog Categories (bind the code when matched).
	if e.Category != nil && *e.Category != "" {
		if code, ok := matchCategory(*e.Category, cat.Categories); ok {
			d.Category = &code
		} else {
			raw := *e.Category
			d.Category = &raw
			d.Unmatched = append(d.Unmatched, "category")
		}
	}

	return d
}

// sanitizeSerialNumber trims an OCR'd serial/IMEI. ok=false means the value was
// present but implausible (longer than any real identifier — junk table text),
// so the caller flags the field instead of forwarding it. nil/empty is simply
// "not found on the receipt" and is not an error.
func sanitizeSerialNumber(raw *string) (*string, bool) {
	if raw == nil {
		return nil, true
	}
	v := strings.TrimSpace(*raw)
	if v == "" {
		return nil, true
	}
	if len(v) > maxDraftSerialBytes {
		return nil, false
	}
	return &v, true
}

// sanitizeWarrantyMonths enforces the [0, maxDraftWarrantyMonths] bound.
func sanitizeWarrantyMonths(raw *int) (*int, bool) {
	if raw == nil {
		return nil, true
	}
	if *raw < 0 || *raw > maxDraftWarrantyMonths {
		return nil, false
	}
	return raw, true
}

func matchBrand(text string, brands []BrandOption) (string, bool) {
	best, bestScore := "", 0.0
	for _, b := range brands {
		if s := ai.MatchScore(text, b.Name); s > bestScore {
			best, bestScore = b.ID, s
		}
	}
	if bestScore >= matchThreshold {
		return best, true
	}
	return "", false
}

func matchStore(text string, stores []StoreOption) (string, bool) {
	best, bestScore := "", 0.0
	for _, s := range stores {
		if sc := ai.MatchScore(text, s.Name); sc > bestScore {
			best, bestScore = s.ID, sc
		}
	}
	if bestScore >= matchThreshold {
		return best, true
	}
	return "", false
}

func matchCategory(text string, cats []CategoryOption) (string, bool) {
	best, bestScore := "", 0.0
	for _, c := range cats {
		// match on both human name and code
		s := ai.MatchScore(text, c.Name)
		if cs := ai.MatchScore(text, c.Code); cs > s {
			s = cs
		}
		if s > bestScore {
			best, bestScore = c.Code, s
		}
	}
	if bestScore >= matchThreshold {
		return best, true
	}
	return "", false
}

// mapAIError translates an ai.Error code into the AttachmentError codes the
// handler already knows how to map to HTTP statuses.
//
// The CODE is ai's and is passed through untouched — only the sentence is
// rendered. `e.Message` is a Vietnamese literal produced by internal/ai, a package
// with no request context, so it is also the catalog key; `i18n.Text` returns it
// verbatim when the catalog does not know it, which is the case for the one
// message that carries a number ("Dịch vụ AI lỗi (%d)"). That is deliberate
// rather than a gap: interpolating it here would need the argument list, and the
// sentence already renders correctly in the language the model call was made in —
// it is the raw upstream status, not app copy.
func mapAIError(ctx context.Context, e *ai.Error) error {
	switch e.Code {
	case "disabled":
		return &AttachmentError{Code: "feature_disabled", Message: i18n.Text(ctx, e.Message)}
	case "rate_limited":
		return &AttachmentError{Code: "ai_rate_limited", Message: i18n.Text(ctx, e.Message)}
	case "upstream", "bad_output":
		return &AttachmentError{Code: "ai_upstream", Message: i18n.Text(ctx, e.Message)}
	default:
		return internalErr(i18n.Text(ctx, e.Message))
	}
}
