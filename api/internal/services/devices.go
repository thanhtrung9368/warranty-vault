package services

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/thanhtrung9368/warranty-vault/api/internal/auth"
	"github.com/thanhtrung9368/warranty-vault/api/internal/fx"
	"github.com/thanhtrung9368/warranty-vault/api/internal/i18n"
	store "github.com/thanhtrung9368/warranty-vault/api/internal/store/gen"
	"github.com/thanhtrung9368/warranty-vault/api/internal/wire"
)

// MaxDevicesPerUser is the ACTIVE-device quota (FEATURE_IDEAS #14): a device
// with `status = 'SOLD'` does NOT occupy one of these 50 slots. See
// CountActiveDevicesByUser for why the predicate is `status <> 'SOLD'`.
const MaxDevicesPerUser = 50

// MaxDevicesTotalPerUser is the storage backstop: every device row counts,
// including sold ones. Without it, "sold devices don't count" would be gameable
// — mark sold, add, un-sell, repeat — and the account could grow without bound.
// 500 = 10× the active cap, i.e. a decade of phone churn for a personal user,
// and it is enforced on both write paths (CreateDevice here, and the backup
// import in backup.go) so neither can be used to walk around the other.
const MaxDevicesTotalPerUser = 500

// validStatus mirrors website/src/lib/types.ts::STATUSES.
var validStatuses = map[string]bool{
	"ACTIVE":  true,
	"EXPIRED": true,
	"SOLD":    true,
	"BROKEN":  true,
	"LOST":    true,
}

// DeviceInput mirrors website/src/lib/services/devices.ts::deviceInputSchema.
// All optional string fields use `*string`; empty string is normalized to nil
// (matching the Zod `blankToNull` preprocess in actions/devices.ts).
//
// SoldAt / SoldPrice are the resale pair added for roadmap #12 (migration 0006).
// Both are nullable pointers: nil means "not sold". They must be supplied
// together — see ValidateDeviceInput.
type DeviceInput struct {
	Name          string  `json:"name"`
	Category      string  `json:"category"`
	Brand         *string `json:"brand,omitempty"`
	Model         *string `json:"model,omitempty"`
	SerialNumber  *string `json:"serialNumber,omitempty"`
	PurchaseDate  string  `json:"purchaseDate"` // YYYY-MM-DD or RFC3339
	PurchasePrice int32   `json:"purchasePrice"`
	PurchasePlace *string `json:"purchasePlace,omitempty"`
	Status        string  `json:"status,omitempty"` // default ACTIVE
	Notes         *string `json:"notes,omitempty"`
	SoldAt        *string `json:"soldAt,omitempty"`    // YYYY-MM-DD or RFC3339; nil = not sold
	SoldPrice     *int32  `json:"soldPrice,omitempty"` // in the device's currency; nil = not sold
	// Currency / FxRate are the multi-currency pair (migration 0022, gap #16).
	//
	//   * Currency is ISO 4217, uppercase. Empty means "not supplied": a CREATE
	//     defaults it to VND (exactly the pre-0022 behaviour); an UPDATE keeps
	//     the stored currency, because the stored value is the locked truth and
	//     resetting it to VND would silently reinterpret every price on the row.
	//     A client that wants to move a device to VND sends "VND" explicitly.
	//   * FxRate is VND per ONE unit of Currency, locked when the purchase is
	//     recorded. It is NULL for VND and required (> 0) for every other
	//     currency — a missing rate is rejected, never defaulted, because a
	//     guessed rate silently corrupts every total (see ValidateDeviceInput).
	//
	// purchasePrice, soldPrice and Warranty.cost are in the DEVICE's currency.
	Currency string `json:"currency,omitempty"`
	FxRate   *int32 `json:"fxRate,omitempty"`
	// ReturnWindowDays / ReceivedAt are the retailer exchange-window pair added
	// for FEATURE_IDEAS #1 (migration 0010). Both are optional and NULL-able:
	//   * ReturnWindowDays nil = "chưa biết" (unknown), 0 = "cửa hàng không cho
	//     đổi trả", > 0 = a real window. There is deliberately NO server default —
	//     the number varies by category and brand (30 days for ICT, 365 for
	//     accessories, none for screen protectors).
	//   * ReceivedAt is when the user actually got the device; it wins over
	//     PurchaseDate when computing the deadline, because an online order is
	//     invoiced before it is delivered.
	// Unlike the soldAt/soldPrice pair these two are independent: a user may know
	// the window without the delivery date, or vice versa.
	ReturnWindowDays *int32  `json:"returnWindowDays,omitempty"`
	ReceivedAt       *string `json:"receivedAt,omitempty"` // YYYY-MM-DD or RFC3339
	// Activation / extended cover (migration 0016, Feature A).
	//
	//   * ActivationRequired: the warranty only starts once the retailer/manufacturer
	//     activates the device. Default false, so every existing row keeps its
	//     behaviour.
	//   * ActivatedAt: when it was activated; the real start when it is LATER than
	//     PurchaseDate. Deliberately independent of PurchaseDate — a timestamp
	//     BEFORE the invoice is a legitimate data-entry state (a shop pre-activating
	//     stock), so the API does not reject it. See the OpenAPI description.
	//   * ExtendedCoverBuyBy: the last day to buy extended cover (AppleCare+ /
	//     Samsung Care+ style). USER-ENTERED. The API does not derive it and does
	//     not assert a day count for any brand; the report behind this feature
	//     could not verify the windows, so there is no default and no cross-field
	//     arithmetic.
	ActivationRequired bool    `json:"activationRequired"`
	ActivatedAt        *string `json:"activatedAt,omitempty"`        // YYYY-MM-DD or RFC3339
	ExtendedCoverBuyBy *string `json:"extendedCoverBuyBy,omitempty"` // YYYY-MM-DD or RFC3339
	// Brand warranty lookup (migration 0023, gap #11).
	//
	// These five fields record what the BRAND's own lookup page said; they do not
	// change the app's warranty arithmetic. All are nullable pointers because
	// "the brand was never checked" is the state of every pre-0023 row and must
	// stay representable.
	//
	//   * BrandWarrantyStatus is the enum ACTIVE | EXPIRED | NOT_REGISTERED |
	//     PRE_ACTIVATED | UNKNOWN. It is REQUIRED as soon as any of the other
	//     four is set; a status alone is valid (NOT_REGISTERED has no dates).
	//   * BrandWarrantyStart / BrandWarrantyEnd are the dates the brand reports.
	//     End must not precede start.
	//   * BrandCheckedAt is when the user last checked.
	//   * BrandLookupUrl is the exact URL the user opened. It is an audit trail
	//     and is NEVER fetched by the server; only an absolute http/https URL is
	//     accepted.
	//
	// PATCH has full-replacement semantics for these like every other optional
	// field except leadDays/currency: an absent key clears the stored value. A
	// client that has recorded a lookup must send all five back.
	BrandWarrantyStatus *string `json:"brandWarrantyStatus,omitempty"`
	BrandWarrantyStart  *string `json:"brandWarrantyStart,omitempty"` // YYYY-MM-DD or RFC3339
	BrandWarrantyEnd    *string `json:"brandWarrantyEnd,omitempty"`   // YYYY-MM-DD or RFC3339
	BrandCheckedAt      *string `json:"brandCheckedAt,omitempty"`     // YYYY-MM-DD or RFC3339
	BrandLookupUrl      *string `json:"brandLookupUrl,omitempty"`     // absolute http/https URL
	// LeadDays is the per-device reminder schedule (migration 0015): one push per
	// milestone, fired that many days before a Warranty end date. nil (absent or
	// JSON null) means "use the create default / keep the stored value on
	// update"; an empty array is a validation error, not "no reminders".
	LeadDays         []int32 `json:"leadDays,omitempty"`
	WarrantyMonths   int32   `json:"warrantyMonths"`
	WarrantyProvider *string `json:"warrantyProvider,omitempty"`
	WarrantyAddress  *string `json:"warrantyAddress,omitempty"`
	WarrantyPhone    *string `json:"warrantyPhone,omitempty"`
	WarrantyNotes    *string `json:"warrantyNotes,omitempty"`
}

// DeviceFilter is the listDevices filter.
type DeviceFilter struct {
	Q        string
	Category string
	Status   string
	Sort     string // purchaseDate | warrantyEndDate | price | name
	Dir      string // asc | desc
}

// DeviceVND is a stored Device plus the VND values derived from its LOCKED
// fxRate (migration 0022). Every device read serialises this shape — list,
// detail, search, create and update — so a client never has to do FX maths and
// two clients can never round differently.
//
// purchasePriceVnd is ALWAYS present and is null only when it cannot be known:
// a non-VND row with no usable rate (which only hand-edited or legacy data can
// hold). It is never faked at par for such a row — that is exactly the "999 USD
// summed as 999 dong" bug the feature exists to fix.
//
// soldPriceVnd is present only when the device is sold (SoldPrice != nil) AND
// the rate is usable; otherwise the key is omitted, matching "and soldPriceVnd
// when sold".
//
// The values are *int64, not *int32: purchasePrice and fxRate are each int32, so
// their product can exceed int32 for a perfectly valid input (a 2,000,000,000
// unit price with a 26,100 VND/unit rate is nonsense as data but must not wrap
// to a negative total). int64 holds every product of two int32s.
type DeviceVND struct {
	store.Device
	PurchasePriceVnd *int64 `json:"purchasePriceVnd"`
	SoldPriceVnd     *int64 `json:"soldPriceVnd,omitempty"`
	// WarrantyMismatch is COMPUTED on every device read (gap #11) and is never
	// stored. It compares the brand's dates with the invoice date and the
	// device's whole-unit effective warranty end; nil means "no mismatch" or
	// "nothing to compare". The key is always present (null when nil), matching
	// the contract's "an object or null" shape.
	WarrantyMismatch *BrandWarrantyMismatch `json:"warrantyMismatch"`
}

// withVND attaches the computed VND values to a stored device row. Callers that
// have the device's warranties should use withVNDAndWarranties instead so the
// computed mismatch is attached in the same place; withVND alone leaves it nil,
// which is the correct answer for a caller that genuinely has nothing to compare
// (and the pre-0023 device read shape).
func withVND(d store.Device) DeviceVND {
	out := DeviceVND{
		Device:           d,
		PurchasePriceVnd: vndValue(d.PurchasePrice, d.Currency, d.FxRate),
	}
	if d.SoldPrice != nil {
		out.SoldPriceVnd = vndValue(*d.SoldPrice, d.Currency, d.FxRate)
	}
	return out
}

// withVNDAndWarranties is the device-read constructor: the VND values plus the
// computed brand-warranty mismatch. Every read that has the warranty rows in
// hand (list, detail, search, create, update) must use this so no endpoint
// returns a device without the computed field.
func withVNDAndWarranties(d store.Device, warranties []store.Warranty) DeviceVND {
	out := withVND(d)
	out.WarrantyMismatch = warrantyMismatchFor(d, warranties)
	return out
}

// vndValue converts one money amount stored in `currency` to VND using the rate
// LOCKED on the row. It is the single arithmetic definition used by every device
// read; stats pushes the same rule into SQL (store/queries/stats.sql) so the
// rollup and the per-row values cannot disagree.
//
// A missing/zero rate on a non-VND row returns nil: the VND value is unknown,
// and reporting the face value (999 USD → 999 VND) would be the original bug.
func vndValue(amount int32, currency string, rate *int32) *int64 {
	if currency == "" || currency == "VND" {
		v := int64(amount)
		return &v
	}
	if rate == nil || *rate <= 0 {
		return nil
	}
	v := int64(amount) * int64(*rate)
	return &v
}

// DeviceListItem is a list-row projection: device + counts + the effective
// warranty end (max over the WHOLE-UNIT Warranty.endDate values). Mirrors
// website/src/lib/devices.ts.
type DeviceListItem struct {
	DeviceVND
	AttachmentCount int64 `json:"attachmentCount"`
	// EffectiveWarrantyEnd is computed by wholeUnitWarrantyEnd — the same helper
	// the detail and search reads use, and the rule the share certificate uses.
	// It is max(endDate) over rows whose Component is NULL/blank, never over a
	// component-scoped row: a 10-year motor clock must not claim the whole device
	// is covered for ten years.
	//
	// It is a wire.Day because it IS a Warranty.endDate: a client comparing
	// `warranty.endDate` with `device.effectiveWarrantyEnd` must get one shape for
	// "a day". The old *time.Time serialised the same value as
	// "2026-11-20T00:00:00Z" while the warranty row said "2026-11-20".
	EffectiveWarrantyEnd *wire.Day `json:"effectiveWarrantyEnd"`
	// ReturnDeadline is the derived exchange-window deadline
	// (COALESCE(receivedAt, purchaseDate) + returnWindowDays days), or nil when the
	// window is unknown/absent. Derived server-side so the three clients cannot
	// implement the rule three slightly different ways — the same reason
	// effectiveWarrantyEnd is computed here rather than in each client.
	//
	// A wire.Day for the same reason: both inputs are Day columns and only whole
	// days are added, so it is a day (see deviceReturnDeadline).
	ReturnDeadline *wire.Day `json:"returnDeadline"`
}

// DeviceDetail is the full device read: device + warranties (with reminders) +
// attachments + claims. Mirrors website/src/lib/devices.ts::getDevice.
type DeviceDetail struct {
	DeviceVND
	// EffectiveWarrantyEnd is the same value DeviceListItem.EffectiveWarrantyEnd
	// and a search hit carry, computed by the same wholeUnitWarrantyEnd helper.
	// Detail used to omit the field entirely while the list computed it, so a
	// client that read one device got a different answer from one that read the
	// list. It is max(endDate) over WHOLE-UNIT rows only (Component NULL/blank),
	// and it is a wire.Day for the reason stated on DeviceListItem.
	EffectiveWarrantyEnd *wire.Day               `json:"effectiveWarrantyEnd"`
	Warranties           []WarrantyWithReminders `json:"warranties"`
	Attachments          []AttachmentMeta        `json:"attachments"`
	// Claims is the device's warranty-claim history (migration 0021), newest
	// openedAt first. Always an array — [] when the device has no claims, never
	// null — so a client can render it unconditionally. Additive: a user with no
	// claims gets the same device payload as before, plus an empty array.
	Claims []store.Claim `json:"claims"`
	// ReturnDeadline mirrors DeviceListItem.ReturnDeadline; see the comment there.
	ReturnDeadline *wire.Day `json:"returnDeadline"`
}

// AttachmentMeta is the redacted attachment shape for the device read path.
//
// A store.Attachment row also carries StoragePath, Iv and WrappedKey. Those are
// internal at-rest/encryption details: StoragePath leaks the on-disk layout and
// Iv/WrappedKey are the per-file key material. None of them belongs in a client
// response — the openapi contract has always declared `attachments` as
// AttachmentMeta, and handlers.attachmentDTO already redacts on the list
// endpoint. This type closes the same hole on the device-detail endpoint.
//
// ExtractedText (migration 0019) is the OCR transcript, not an encryption
// internal, so it IS exposed — but only when the user has actually OCR'd this
// attachment. The field is `omitempty`, so an attachment that was never scanned
// serialises exactly as it did before the column existed. It is PLAINTEXT in the
// DB and in this response; the blob remains AES-256-GCM. See the openapi
// AttachmentMeta description for the trade-off.
type AttachmentMeta struct {
	ID            string  `json:"id"`
	FileName      string  `json:"fileName"`
	FileType      string  `json:"fileType"`
	FileSize      int32   `json:"fileSize"`
	Description   *string `json:"description"`
	UploadedAt    string  `json:"uploadedAt"`
	ExtractedText *string `json:"extractedText,omitempty"`
}

// toAttachmentMeta strips a store row down to the public shape. Kept in sync
// with handlers.toAttachmentDTO — both must emit the same JSON.
func toAttachmentMeta(a store.Attachment) AttachmentMeta {
	uploaded := ""
	if a.UploadedAt.Valid {
		uploaded = a.UploadedAt.Time.UTC().Format(time.RFC3339Nano)
	}
	return AttachmentMeta{
		ID:            a.ID,
		FileName:      a.FileName,
		FileType:      a.FileType,
		FileSize:      a.FileSize,
		Description:   a.Description,
		UploadedAt:    uploaded,
		ExtractedText: a.ExtractedText,
	}
}

// WarrantyWithReminders bundles a warranty row with its Reminder rows.
type WarrantyWithReminders struct {
	store.Warranty
	Reminders []store.Reminder `json:"reminders"`
}

// ValidateDeviceInput hand-rolls the same validation as the Zod schema in
// website/src/lib/services/devices.ts::deviceInputSchema. Returns nil on
// success or *Error{Code: VALIDATION} with field messages on failure.
//
// # i18n
//
// This is part of the converted devices slice (docs/I18N_PLAN.md §3, Phase 1).
// Every message is the EXISTING Vietnamese literal wrapped in `i18n.Text(ctx,
// …)` — the source text is not re-written, it gains an English column in
// internal/i18n/catalog.go. `go vet` is the reason these are `Text` and not `T`:
// `T` is printf-shaped, so a literal key with no arguments is fine there too, but
// keeping argument-free messages on the non-variadic call shape is the rule
// Phase 0 set, and it is what makes a key that later arrives as data safe.
//
// The returned error's headline is the generic "Dữ liệu không hợp lệ", rendered
// through ErrValidationHeadline so it follows the same language as the field
// messages below it. The generic sentence (rather than a specific field's) is
// deliberate: this failure can report several fields at once, so naming one of
// them would be a lie about the others.
func ValidateDeviceInput(ctx context.Context, in *DeviceInput) error {
	in.Name = strings.TrimSpace(in.Name)
	in.Category = strings.TrimSpace(in.Category)
	in.PurchaseDate = strings.TrimSpace(in.PurchaseDate)
	trimPtr(&in.Brand)
	trimPtr(&in.Model)
	trimPtr(&in.SerialNumber)
	trimPtr(&in.PurchasePlace)
	trimPtr(&in.Notes)
	trimPtr(&in.SoldAt)
	trimPtr(&in.ReceivedAt)
	trimPtr(&in.ActivatedAt)
	trimPtr(&in.ExtendedCoverBuyBy)
	trimPtr(&in.WarrantyProvider)
	trimPtr(&in.WarrantyAddress)
	trimPtr(&in.WarrantyPhone)
	trimPtr(&in.WarrantyNotes)
	in.Status = strings.TrimSpace(in.Status)
	// Empty stays empty: it means "not supplied" (create → VND, update → keep the
	// stored currency). Only a supplied code is validated; the create/update
	// resolution below is what turns absence into a stored value.
	in.Currency = fx.NormalizeCurrency(in.Currency)

	fieldErrors := FieldErrors{}
	if in.Name == "" {
		fieldErrors["name"] = []string{i18n.Text(ctx, "Tên thiết bị bắt buộc")}
	}
	if in.Category == "" {
		fieldErrors["category"] = []string{i18n.Text(ctx, "Loại thiết bị bắt buộc")}
	}
	if in.PurchaseDate == "" {
		fieldErrors["purchaseDate"] = []string{i18n.Text(ctx, "Ngày mua bắt buộc")}
	}
	if in.PurchasePrice < 0 {
		fieldErrors["purchasePrice"] = []string{i18n.Text(ctx, "Giá mua không hợp lệ")}
	}
	if in.SoldPrice != nil && *in.SoldPrice < 0 {
		fieldErrors["soldPrice"] = []string{i18n.Text(ctx, "Giá bán không hợp lệ")}
	}
	// Resale pair rule: a sale is recorded either completely (date + price) or
	// not at all. Exactly one of the two is rejected so a client can never
	// persist a half-recorded sale (which would make profit/loss meaningless).
	// `soldAt`/`soldPrice` both null (or absent) clears a previously recorded
	// sale; this is deliberately independent of `status`, which a client may set
	// to SOLD without any resale figures.
	if (in.SoldAt == nil) != (in.SoldPrice == nil) {
		if in.SoldAt == nil {
			fieldErrors["soldAt"] = []string{i18n.Text(ctx, "Thiếu ngày bán")}
		} else {
			fieldErrors["soldPrice"] = []string{i18n.Text(ctx, "Thiếu giá bán")}
		}
	}
	// Activation / extended cover (migration 0016). The ONLY rule is that a value
	// present must be a real date: both columns are user-entered timestamps, and a
	// typo must become a normal 400 with a field error rather than a 500 from the
	// driver. There is deliberately NO cross-field validation here —
	//   * ActivatedAt before PurchaseDate is ALLOWED. A shop can activate a device
	//     before it is invoiced; that is a legitimate data-entry state, not a
	//     mistake this API gets to overrule.
	//   * ExtendedCoverBuyBy before/after anything else is ALLOWED. No brand day
	//     count is asserted anywhere: the value is what the user was told.
	// The parse happens again in Create/Update (as with soldAt/receivedAt); this
	// check exists so the rule is unit-testable without a database and so a bad
	// value is refused before any transaction starts.
	if in.ActivatedAt != nil {
		if _, err := parseDate(*in.ActivatedAt); err != nil {
			fieldErrors["activatedAt"] = []string{i18n.Text(ctx, "Ngày kích hoạt không hợp lệ")}
		}
	}
	if in.ExtendedCoverBuyBy != nil {
		if _, err := parseDate(*in.ExtendedCoverBuyBy); err != nil {
			fieldErrors["extendedCoverBuyBy"] = []string{i18n.Text(ctx, "Hạn mua bảo hiểm mở rộng không hợp lệ")}
		}
	}
	if in.WarrantyMonths < 0 {
		fieldErrors["warrantyMonths"] = []string{i18n.Text(ctx, "Số tháng bảo hành không hợp lệ")}
	}
	// Multi-currency rules (migration 0022). Deliberately strict, in the same
	// direction as the "reject rather than default" rule in the migration: a
	// guessed rate would silently corrupt every total, so the API never supplies
	// one. Only what is independent of the stored row is checked here; the
	// create/update resolvers below handle "absent" (which means default VND on
	// create, keep the stored pair on update).
	switch {
	case in.Currency != "" && !fx.IsSupportedCurrency(in.Currency):
		fieldErrors["currency"] = []string{i18n.Text(ctx, "Loại tiền không hợp lệ")}
	case in.Currency == "VND":
		// 1 VND is 1 VND: a rate on a VND device is meaningless, and accepting it
		// would make the row's meaning depend on which field a reader trusts.
		if in.FxRate != nil {
			fieldErrors["fxRate"] = []string{i18n.Text(ctx, "Thiết bị dùng VND không được có tỷ giá")}
		}
	case in.Currency != "":
		if in.FxRate == nil {
			fieldErrors["fxRate"] = []string{i18n.Text(ctx, "Thiếu tỷ giá")}
		} else if *in.FxRate <= 0 {
			fieldErrors["fxRate"] = []string{i18n.Text(ctx, "Tỷ giá phải là số nguyên dương")}
		}
	case in.FxRate != nil && *in.FxRate <= 0:
		// Currency absent (so the row's currency is not being set by this
		// request): a non-positive rate is invalid in every context.
		fieldErrors["fxRate"] = []string{i18n.Text(ctx, "Tỷ giá phải là số nguyên dương")}
	}
	// 0 is valid and meaningful ("cửa hàng không cho đổi trả"); NULL (absent) means
	// unknown and is also valid. Only out-of-range values are rejected, so a typo
	// cannot store a deadline in the year 9999.
	if in.ReturnWindowDays != nil &&
		(*in.ReturnWindowDays < ReturnWindowDaysMin || *in.ReturnWindowDays > ReturnWindowDaysMax) {
		fieldErrors["returnWindowDays"] = []string{
			i18n.T(ctx, "Số ngày đổi trả phải từ %d tới %d", ReturnWindowDaysMin, ReturnWindowDaysMax),
		}
	}
	// Reminder schedule (migration 0015). nil is valid and means "absent" — the
	// create path defaults it to [30, 7], the update path keeps the stored value.
	// A non-nil slice is validated here and sorted descending for storage.
	if in.LeadDays != nil {
		if sorted, msg := normalizeLeadDays(ctx, in.LeadDays); msg != "" {
			fieldErrors["leadDays"] = []string{msg}
		} else {
			in.LeadDays = sorted
		}
	}
	if in.Status == "" {
		in.Status = "ACTIVE"
	} else if !validStatuses[in.Status] {
		fieldErrors["status"] = []string{i18n.Text(ctx, "Trạng thái không hợp lệ")}
	}
	// Brand warranty lookup (migration 0023, gap #11). The rules live in
	// brand_warranty.go so create, update and any future write path share one
	// definition: status required when any other field is set, enum membership,
	// date parsing, end-not-before-start, and an absolute http/https URL. An
	// absent group is valid — that is the pre-0023 device and the "never checked"
	// state this feature must leave untouched.
	if _, brandErrors := parseBrandWarranty(ctx, in); len(brandErrors) > 0 {
		for field, messages := range brandErrors {
			fieldErrors[field] = messages
		}
	}
	if len(fieldErrors) > 0 {
		// ErrValidationHeadline, not ErrValidation: this validator has translated
		// its fieldErrors, so the envelope headline has to move with them or the
		// response is half English and half Vietnamese (see the doc comments in
		// services/errors.go).
		return ErrValidationHeadline(fieldErrors)
	}
	return nil
}

// resolveCreateCurrency turns DeviceInput's optional currency pair into the
// values persisted on a NEW row.
//
// Absence defaults to VND — exactly the behaviour before migration 0022 — which
// also means a request that sends fxRate without a currency is a 400: fxRate
// belongs to a non-VND currency, and the request named none.
//
// The function repeats checks ValidateDeviceInput already made. That is on
// purpose: it is the only place that knows the CREATE semantics, it is
// unit-testable in isolation, and a future write path that forgets the validator
// must still not store a non-VND device without a locked rate.
func resolveCreateCurrency(ctx context.Context, in DeviceInput) (string, *int32, error) {
	currency := in.Currency
	if currency == "" {
		currency = "VND"
	}
	if !fx.IsSupportedCurrency(currency) {
		return "", nil, ErrValidationHeadline(FieldErrors{
			"currency": {i18n.Text(ctx, "Loại tiền không hợp lệ")},
		})
	}
	if currency == "VND" {
		if in.FxRate != nil {
			return "", nil, ErrValidationHeadline(FieldErrors{
				"fxRate": {i18n.Text(ctx, "Thiết bị dùng VND không được có tỷ giá")},
			})
		}
		return "VND", nil, nil
	}
	if in.FxRate == nil {
		return "", nil, ErrValidationHeadline(FieldErrors{
			"fxRate": {i18n.Text(ctx, "Thiếu tỷ giá")},
		})
	}
	if *in.FxRate <= 0 {
		return "", nil, ErrValidationHeadline(FieldErrors{
			"fxRate": {i18n.Text(ctx, "Tỷ giá phải là số nguyên dương")},
		})
	}
	return currency, in.FxRate, nil
}

// resolveUpdateCurrency turns DeviceInput's optional currency pair into the
// values persisted on an EXISTING row, given what is already stored.
//
// # Why an absent currency does NOT default to VND on update
//
// PATCH replaces every field of a device (returnWindowDays, activationRequired,
// …), and `currency` would normally join that list. It deliberately does not,
// for one reason: the stored currency is not a preference, it is the unit the
// row's money is denominated in. Defaulting an absent `currency` to VND would
// mean that any client built before this field existed — or any hand-written
// PATCH that changes only the name — silently reinterprets "USD 999" as
// "999 VND" and corrupts every total that includes the device. That is the exact
// failure mode this feature exists to remove, so absence means KEEP.
//
// Sending `currency: "VND"` explicitly still moves the device to VND, and that
// is the only way to do it.
//
// # Changing the currency (the chosen rule: RE-REQUIRE)
//
// When a request supplies a currency different from the stored one, the old
// rate is never carried over (it is a rate for a different unit). The target
// must supply its own rate:
//   - target VND  ⇒ fxRate omitted, and the stored rate is CLEARED;
//   - target != VND ⇒ fxRate is REQUIRED (a missing one is a 400), and the
//     supplied rate becomes the new lock.
//
// "Clear" would also have been defensible, but clearing alone cannot express
// "change the currency AND lock its rate in the same request", which is exactly
// what the device form does when the user picks a currency and confirms the
// prefilled rate. Re-requiring is also the safer direction: the server never
// guesses which number belongs to which unit.
//
// An explicit currency equal to the stored one re-locks the rate with the
// supplied value (or rejects a missing one), so a client that sends the pair
// always gets a full replacement. Only the absent-currency case above is
// lenient, and only because absence cannot be told apart from an old client.
func resolveUpdateCurrency(ctx context.Context, in DeviceInput, current store.Device) (string, *int32, error) {
	stored := current.Currency
	if stored == "" {
		// Every row gets 'VND' from the 0022 column default, but a hand-edited
		// row could be NULL-free empty; treat it as the default it should have.
		stored = "VND"
	}

	if in.Currency == "" {
		if stored == "VND" {
			if in.FxRate != nil {
				return "", nil, ErrValidationHeadline(FieldErrors{
					"fxRate": {i18n.Text(ctx, "Thiết bị dùng VND không được có tỷ giá")},
				})
			}
			return "VND", nil, nil
		}
		// Non-VND device: an fxRate without a currency re-locks the rate; without
		// one, the existing lock is kept.
		if in.FxRate != nil {
			if *in.FxRate <= 0 {
				return "", nil, ErrValidationHeadline(FieldErrors{
					"fxRate": {i18n.Text(ctx, "Tỷ giá phải là số nguyên dương")},
				})
			}
			return stored, in.FxRate, nil
		}
		if current.FxRate == nil || *current.FxRate <= 0 {
			// Inconsistent stored row (only a hand edit can produce it). It must
			// not stay non-VND without a rate, and the server must not invent one.
			return "", nil, ErrValidationHeadline(FieldErrors{
				"fxRate": {i18n.Text(ctx, "Thiếu tỷ giá")},
			})
		}
		return stored, current.FxRate, nil
	}

	if !fx.IsSupportedCurrency(in.Currency) {
		return "", nil, ErrValidationHeadline(FieldErrors{
			"currency": {i18n.Text(ctx, "Loại tiền không hợp lệ")},
		})
	}
	if in.Currency == "VND" {
		if in.FxRate != nil {
			return "", nil, ErrValidationHeadline(FieldErrors{
				"fxRate": {i18n.Text(ctx, "Thiết bị dùng VND không được có tỷ giá")},
			})
		}
		return "VND", nil, nil
	}
	if in.FxRate == nil {
		// Includes the currency-change case: the old rate is for a different unit,
		// so it is never carried over.
		return "", nil, ErrValidationHeadline(FieldErrors{
			"fxRate": {i18n.Text(ctx, "Thiếu tỷ giá")},
		})
	}
	if *in.FxRate <= 0 {
		return "", nil, ErrValidationHeadline(FieldErrors{
			"fxRate": {i18n.Text(ctx, "Tỷ giá phải là số nguyên dương")},
		})
	}
	return in.Currency, in.FxRate, nil
}

// sortableVND is the ordering key for sort=price: the VND value when it is
// known, otherwise the stored face amount. The fallback only applies to a
// non-VND row whose rate is missing (hand-edited data); it keeps the sort total
// and deterministic instead of dropping the row.
func sortableVND(d DeviceVND) int64 {
	if d.PurchasePriceVnd != nil {
		return *d.PurchasePriceVnd
	}
	return int64(d.PurchasePrice)
}

// ListDevices mirrors website/src/lib/devices.ts::listDevices. Filter values
// are passed straight to the sqlc query (which uses NULLIF semantics via the
// ($N::text IS NULL OR ...) pattern); empty strings act as "no filter".
func ListDevices(ctx context.Context, db *pgxpool.Pool, userID string, f DeviceFilter) ([]DeviceListItem, error) {
	q := store.New(db)

	cat := f.Category
	if cat == "ALL" {
		cat = ""
	}
	st := f.Status
	if st == "ALL" {
		st = ""
	}

	rows, err := q.ListDevicesByUser(ctx, store.ListDevicesByUserParams{
		UserId:  userID,
		Column2: cat,
		Column3: st,
		Column4: strings.TrimSpace(f.Q),
	})
	if err != nil {
		return nil, fmt.Errorf("list devices: %w", err)
	}

	// Hydrate per-row attachment count + effective warranty end. The TS layer
	// does this via Prisma's `_count` + an `include`. Rather than two queries
	// per row (~101 round-trips for a full 50-device list), we gather the
	// device ids and issue two batch queries (`= ANY($1)`), then index the
	// results by deviceId in Go — same pattern as ExportBackup in backup.go.
	out := make([]DeviceListItem, 0, len(rows))
	if len(rows) == 0 {
		return out, nil
	}

	deviceIDs := make([]string, 0, len(rows))
	for _, d := range rows {
		deviceIDs = append(deviceIDs, d.ID)
	}

	warrantyRows, err := q.ListWarrantiesByDeviceIDs(ctx, store.ListWarrantiesByDeviceIDsParams{
		Column1: deviceIDs,
		UserId:  userID,
	})
	if err != nil {
		return nil, fmt.Errorf("list warranties: %w", err)
	}
	warByDevice := map[string][]store.Warranty{}
	for _, w := range warrantyRows {
		warByDevice[w.DeviceId] = append(warByDevice[w.DeviceId], w)
	}

	countRows, err := q.CountAttachmentsByDeviceIDs(ctx, store.CountAttachmentsByDeviceIDsParams{
		Column1: deviceIDs,
		UserId:  userID,
	})
	if err != nil {
		return nil, fmt.Errorf("count attachments: %w", err)
	}
	countByDevice := map[string]int64{}
	for _, c := range countRows {
		if c.DeviceID != nil {
			countByDevice[*c.DeviceID] = c.Count
		}
	}

	for _, d := range rows {
		out = append(out, DeviceListItem{
			DeviceVND:            withVNDAndWarranties(d, warByDevice[d.ID]),
			AttachmentCount:      countByDevice[d.ID],
			EffectiveWarrantyEnd: wholeUnitWarrantyEnd(warByDevice[d.ID]),
			ReturnDeadline:       deviceReturnDeadline(d),
		})
	}

	sort := f.Sort
	if sort == "" {
		sort = "purchaseDate"
	}
	dir := f.Dir
	if dir == "" {
		dir = "desc"
	}
	desc := dir != "asc"

	switch sort {
	case "name":
		sortInPlace(out, func(a, b DeviceListItem) bool {
			return a.Name < b.Name
		}, desc)
	case "price":
		// Sort by the VND value, not the face amount: mixing USD 999 and
		// 25,000,000 VND by face value would order them as 999 < 25,000,000,
		// which is the exact comparison bug this feature removes. A row whose
		// VND value is unknown (non-VND, no usable rate) sorts by its face
		// amount, deterministically, and never crashes the sort.
		sortInPlace(out, func(a, b DeviceListItem) bool {
			return sortableVND(a.DeviceVND) < sortableVND(b.DeviceVND)
		}, desc)
	case "warrantyEndDate":
		sortInPlace(out, func(a, b DeviceListItem) bool {
			// Missing warranty sorts as "infinitely far away" so devices
			// with warranties show first when ordering "BH sắp hết".
			var av, bv int64
			if a.EffectiveWarrantyEnd == nil {
				if desc {
					av = -1 << 62
				} else {
					av = 1 << 62
				}
			} else {
				av = a.EffectiveWarrantyEnd.Time.UnixNano()
			}
			if b.EffectiveWarrantyEnd == nil {
				if desc {
					bv = -1 << 62
				} else {
					bv = 1 << 62
				}
			} else {
				bv = b.EffectiveWarrantyEnd.Time.UnixNano()
			}
			return av < bv
		}, desc)
	default: // purchaseDate
		sortInPlace(out, func(a, b DeviceListItem) bool {
			return a.PurchaseDate.Time.Before(b.PurchaseDate.Time)
		}, desc)
	}

	return out, nil
}

// GetDevice mirrors website/src/lib/devices.ts::getDevice.
func GetDevice(ctx context.Context, db *pgxpool.Pool, userID, id string) (*DeviceDetail, error) {
	q := store.New(db)
	d, err := q.GetDeviceByID(ctx, store.GetDeviceByIDParams{ID: id, UserId: userID})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound(i18n.Text(ctx, "Không tìm thấy thiết bị"))
		}
		return nil, fmt.Errorf("get device: %w", err)
	}
	warranties, err := q.ListWarrantiesByDevice(ctx, store.ListWarrantiesByDeviceParams{
		DeviceId: id,
		UserId:   userID,
	})
	if err != nil {
		return nil, fmt.Errorf("list warranties: %w", err)
	}
	atts, err := q.ListAttachmentsByDevice(ctx, store.ListAttachmentsByDeviceParams{
		DeviceId: &id,
		UserId:   userID,
	})
	if err != nil {
		return nil, fmt.Errorf("list attachments: %w", err)
	}
	// Warranty claims (migration 0021). Additive and always an array: a device
	// with no claims serialises `claims: []`, exactly what a client needs to
	// render the section unconditionally. Newest openedAt first, matching the
	// top-level GET /api/v1/claims ordering.
	claims, err := q.ListClaimsByDevice(ctx, store.ListClaimsByDeviceParams{
		DeviceId: id,
		UserId:   userID,
	})
	if err != nil {
		return nil, fmt.Errorf("list claims: %w", err)
	}

	wr := make([]WarrantyWithReminders, 0, len(warranties))
	for _, w := range warranties {
		// Fetch the latest non-dismissed reminder (if any) for client convenience.
		// The TS layer includes the full reminder list ordered by createdAt asc,
		// but in practice each warranty has 0..1 active rows; the existing sqlc
		// surface only exposes GetActiveReminderForWarranty so we project that.
		rem := []store.Reminder{}
		if r, rerr := q.GetActiveReminderForWarranty(ctx, w.ID); rerr == nil {
			rem = append(rem, r)
		}
		wr = append(wr, WarrantyWithReminders{Warranty: w, Reminders: rem})
	}
	metas := make([]AttachmentMeta, 0, len(atts))
	for _, a := range atts {
		metas = append(metas, toAttachmentMeta(a))
	}
	claimRows := make([]store.Claim, 0, len(claims))
	claimRows = append(claimRows, claims...)
	return &DeviceDetail{
		DeviceVND:            withVNDAndWarranties(d, warranties),
		EffectiveWarrantyEnd: wholeUnitWarrantyEnd(warranties),
		Warranties:           wr,
		Attachments:          metas,
		Claims:               claimRows,
		ReturnDeadline:       deviceReturnDeadline(d),
	}, nil
}

// CreateDevice mirrors website/src/lib/services/devices.ts::createDevice
// including the optional inline-warranty side effect when warrantyMonths > 0.
//
// The quota rule is checked TWICE, deliberately:
//
//  1. before the date/currency parsing, exactly where it has always been. A
//     request at the ceiling must keep returning 409 even when another field is
//     also malformed; moving the only check into the transaction would make the
//     error precedence depend on the transaction's position.
//  2. again inside the transaction, after taking the per-user device-write
//     advisory lock. The first check races with a concurrent create (two
//     requests can both read 49 and both insert), so the second is the one that
//     actually enforces the ceiling. Both create paths take the same lock — see
//     lockUserDeviceWrites.
//
// The two checks use the same counter queries and the same error, so a
// sequential request sees byte-identical behaviour to the pre-bulk version.
func CreateDevice(ctx context.Context, db *pgxpool.Pool, userID string, in DeviceInput, fromWishlistID string) (DeviceVND, error) {
	if err := ValidateDeviceInput(ctx, &in); err != nil {
		return DeviceVND{}, err
	}
	q := store.New(db)
	if err := assertCategoryExists(ctx, q, in.Category); err != nil {
		return DeviceVND{}, err
	}

	// Cheap pre-check, kept at its historic position for error precedence. It is
	// NOT the concurrency-safe check; the one under the lock below is.
	if err := assertDeviceQuota(ctx, q, userID, deviceActiveIncoming(in.Status), 1); err != nil {
		return DeviceVND{}, err
	}

	values, err := prepareDeviceCreate(ctx, in)
	if err != nil {
		return DeviceVND{}, err
	}

	tx, err := db.Begin(ctx)
	if err != nil {
		return DeviceVND{}, fmt.Errorf("begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if err := lockUserDeviceWrites(ctx, tx, userID); err != nil {
		return DeviceVND{}, err
	}
	tq := q.WithTx(tx)

	// The authoritative check: count and insert now happen in one transaction
	// serialised per user, so two concurrent creates cannot both pass a 49→50
	// read and write a 51st active row.
	if err := assertDeviceQuota(ctx, tq, userID, deviceActiveIncoming(in.Status), 1); err != nil {
		return DeviceVND{}, err
	}

	created, err := createDeviceWithWarranty(ctx, tq, userID, in, values)
	if err != nil {
		return DeviceVND{}, err
	}

	// Wishlist cross-link: if the device was seeded from a wishlist item, mark
	// it purchased and back-reference. The TS layer also does this in a
	// post-create step; we keep it inside the same transaction for atomicity.
	if fromWishlistID != "" && isSafeID(fromWishlistID) {
		if _, gerr := tq.GetWishlistByID(ctx, store.GetWishlistByIDParams{
			ID:     fromWishlistID,
			UserId: userID,
		}); gerr == nil {
			_, _ = tq.MarkWishlistPurchased(ctx, store.MarkWishlistPurchasedParams{
				ID:                fromWishlistID,
				UserId:            userID,
				PurchasedDeviceId: &created.ID,
			})
		}
	}

	// Read the just-written warranty rows inside the same transaction: the
	// computed warrantyMismatch compares the brand's end date with the whole-unit
	// effective end, and the create response must carry the same value a
	// subsequent GET returns. One extra query on a create is cheap; returning a
	// null mismatch here and a non-null one on the detail read would make the
	// device form's "saved" state disagree with the list.
	warranties, err := tq.ListWarrantiesByDevice(ctx, store.ListWarrantiesByDeviceParams{
		DeviceId: created.ID,
		UserId:   userID,
	})
	if err != nil {
		return DeviceVND{}, fmt.Errorf("list warranties after create: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return DeviceVND{}, fmt.Errorf("commit: %w", err)
	}
	return withVNDAndWarranties(created, warranties), nil
}

// deviceCreateValues is the result of the create-only preparation step: every
// input value that needs parsing, normalising or resolving before the INSERT.
//
// It exists so the single create and the bulk create run the SAME preparation
// code. Duplicating parseSoldAt/resolveCreateCurrency/... in the bulk service
// would be the fastest way for the two paths to drift into different messages or
// different defaults — exactly what the bulk contract forbids.
type deviceCreateValues struct {
	purchaseDate       time.Time
	soldAt             wire.Day
	receivedAt         wire.Day
	activatedAt        wire.Day
	extendedCoverBuyBy wire.Day
	currency           string
	fxRate             *int32
	brandWarranty      brandWarrantyValues
}

// prepareDeviceCreate parses and resolves a DeviceInput that has ALREADY passed
// ValidateDeviceInput. It is the create half of the old CreateDevice body,
// extracted verbatim so both create paths reuse it.
//
// The caller must run ValidateDeviceInput first (it normalises status, currency,
// leadDays and the optional pointers); this function deliberately does not
// repeat it so each caller can keep its own category-check position. The parse
// functions still defend themselves, as they did before.
func prepareDeviceCreate(ctx context.Context, in DeviceInput) (deviceCreateValues, error) {
	purchaseDate, err := parseDate(in.PurchaseDate)
	if err != nil {
		return deviceCreateValues{}, ErrValidationHeadline(FieldErrors{
			"purchaseDate": {i18n.Text(ctx, "Ngày mua không hợp lệ")},
		})
	}
	soldAt, err := parseSoldAt(ctx, in.SoldAt)
	if err != nil {
		return deviceCreateValues{}, err
	}
	receivedAt, err := parseReceivedAt(ctx, in.ReceivedAt)
	if err != nil {
		return deviceCreateValues{}, err
	}
	activatedAt, err := parseActivatedAt(ctx, in.ActivatedAt)
	if err != nil {
		return deviceCreateValues{}, err
	}
	extendedCoverBuyBy, err := parseExtendedCoverBuyBy(ctx, in.ExtendedCoverBuyBy)
	if err != nil {
		return deviceCreateValues{}, err
	}
	currency, fxRate, err := resolveCreateCurrency(ctx, in)
	if err != nil {
		return deviceCreateValues{}, err
	}
	brandWarranty, err := brandWarrantyForWrite(ctx, &in)
	if err != nil {
		return deviceCreateValues{}, err
	}
	return deviceCreateValues{
		purchaseDate:       purchaseDate,
		soldAt:             soldAt,
		receivedAt:         receivedAt,
		activatedAt:        activatedAt,
		extendedCoverBuyBy: extendedCoverBuyBy,
		currency:           currency,
		fxRate:             fxRate,
		brandWarranty:      brandWarranty,
	}, nil
}

// createDeviceParams is the single place a DeviceInput becomes a store row. Both
// create paths call it through createDeviceWithWarranty, so field mapping,
// defaulting (leadDays) and the status pointer cannot differ between them.
func createDeviceParams(userID string, in DeviceInput, values deviceCreateValues) store.CreateDeviceParams {
	status := in.Status
	return store.CreateDeviceParams{
		ID:            auth.NewID(),
		UserId:        userID,
		Name:          in.Name,
		Category:      in.Category,
		Brand:         in.Brand,
		Model:         in.Model,
		SerialNumber:  in.SerialNumber,
		PurchaseDate:  wire.Date(values.purchaseDate),
		PurchasePrice: in.PurchasePrice,
		PurchasePlace: in.PurchasePlace,
		Notes:         in.Notes,
		SoldAt:        values.soldAt,
		SoldPrice:     in.SoldPrice,
		Status:        &status,

		ReturnWindowDays: in.ReturnWindowDays,
		ReceivedAt:       values.receivedAt,
		LeadDays:         leadDaysForCreate(in.LeadDays, DefaultDeviceLeadDays),

		ActivationRequired: in.ActivationRequired,
		ActivatedAt:        values.activatedAt,
		ExtendedCoverBuyBy: values.extendedCoverBuyBy,

		Currency: values.currency,
		FxRate:   values.fxRate,

		BrandWarrantyStatus: values.brandWarranty.Status,
		BrandWarrantyStart:  values.brandWarranty.Start,
		BrandWarrantyEnd:    values.brandWarranty.End,
		BrandCheckedAt:      values.brandWarranty.CheckedAt,
		BrandLookupUrl:      values.brandWarranty.LookupURL,
	}
}

// createDeviceWithWarranty inserts the device and its optional inline STANDARD
// warranty in the caller's transaction. Shared by CreateDevice and
// BulkCreateDevices so the two paths write the same rows from the same input.
func createDeviceWithWarranty(ctx context.Context, tq *store.Queries, userID string, in DeviceInput, values deviceCreateValues) (store.Device, error) {
	created, err := tq.CreateDevice(ctx, createDeviceParams(userID, in, values))
	if err != nil {
		return store.Device{}, fmt.Errorf("create device: %w", err)
	}

	if in.WarrantyMonths > 0 {
		end := addMonths(values.purchaseDate, int(in.WarrantyMonths))
		if _, err := tq.CreateWarranty(ctx, store.CreateWarrantyParams{
			ID:        auth.NewID(),
			DeviceId:  created.ID,
			Type:      "STANDARD",
			Provider:  in.WarrantyProvider,
			StartDate: wire.Date(values.purchaseDate),
			EndDate:   wire.Date(end),
			Months:    in.WarrantyMonths,
			Cost:      nil,
			Address:   in.WarrantyAddress,
			Phone:     in.WarrantyPhone,
			Notes:     in.WarrantyNotes,
		}); err != nil {
			return store.Device{}, fmt.Errorf("create warranty: %w", err)
		}
	}

	return created, nil
}

// UpdateDevice mirrors website/src/lib/services/devices.ts::updateDevice.
// Manages the single STANDARD warranty inline: creates / updates / deletes
// based on warrantyMonths.
func UpdateDevice(ctx context.Context, db *pgxpool.Pool, userID, id string, in DeviceInput) (DeviceVND, error) {
	if err := ValidateDeviceInput(ctx, &in); err != nil {
		return DeviceVND{}, err
	}
	if err := assertCategoryExists(ctx, store.New(db), in.Category); err != nil {
		return DeviceVND{}, err
	}

	q := store.New(db)
	// The stored row is needed for update semantics that are "leave it alone when
	// the request omits the field": leadDays, and — migration 0022 — the locked
	// currency/fxRate pair (see resolveUpdateCurrency for why an absent currency
	// must not default to VND here).
	current, err := q.GetDeviceByID(ctx, store.GetDeviceByIDParams{ID: id, UserId: userID})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return DeviceVND{}, ErrNotFound(i18n.Text(ctx, "Không tìm thấy thiết bị"))
		}
		return DeviceVND{}, fmt.Errorf("get device: %w", err)
	}

	purchaseDate, err := parseDate(in.PurchaseDate)
	if err != nil {
		return DeviceVND{}, ErrValidationHeadline(FieldErrors{
			"purchaseDate": {i18n.Text(ctx, "Ngày mua không hợp lệ")},
		})
	}
	soldAt, err := parseSoldAt(ctx, in.SoldAt)
	if err != nil {
		return DeviceVND{}, err
	}
	receivedAt, err := parseReceivedAt(ctx, in.ReceivedAt)
	if err != nil {
		return DeviceVND{}, err
	}
	activatedAt, err := parseActivatedAt(ctx, in.ActivatedAt)
	if err != nil {
		return DeviceVND{}, err
	}
	extendedCoverBuyBy, err := parseExtendedCoverBuyBy(ctx, in.ExtendedCoverBuyBy)
	if err != nil {
		return DeviceVND{}, err
	}
	currency, fxRate, err := resolveUpdateCurrency(ctx, in, current)
	if err != nil {
		return DeviceVND{}, err
	}
	brandWarranty, err := brandWarrantyForWrite(ctx, &in)
	if err != nil {
		return DeviceVND{}, err
	}

	tx, err := db.Begin(ctx)
	if err != nil {
		return DeviceVND{}, fmt.Errorf("begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	tq := q.WithTx(tx)

	updated, err := tq.UpdateDevice(ctx, store.UpdateDeviceParams{
		ID:            id,
		UserId:        userID,
		Name:          in.Name,
		Category:      in.Category,
		Brand:         in.Brand,
		Model:         in.Model,
		SerialNumber:  in.SerialNumber,
		PurchaseDate:  wire.Date(purchaseDate),
		PurchasePrice: in.PurchasePrice,
		PurchasePlace: in.PurchasePlace,
		Status:        in.Status,
		Notes:         in.Notes,
		SoldAt:        soldAt,
		SoldPrice:     in.SoldPrice,

		ReturnWindowDays: in.ReturnWindowDays,
		ReceivedAt:       receivedAt,
		LeadDays:         leadDaysForUpdate(in.LeadDays, current.LeadDays),

		ActivationRequired: in.ActivationRequired,
		ActivatedAt:        activatedAt,
		ExtendedCoverBuyBy: extendedCoverBuyBy,

		Currency: currency,
		FxRate:   fxRate,

		BrandWarrantyStatus: brandWarranty.Status,
		BrandWarrantyStart:  brandWarranty.Start,
		BrandWarrantyEnd:    brandWarranty.End,
		BrandCheckedAt:      brandWarranty.CheckedAt,
		BrandLookupUrl:      brandWarranty.LookupURL,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return DeviceVND{}, ErrNotFound(i18n.Text(ctx, "Không tìm thấy thiết bị"))
		}
		return DeviceVND{}, fmt.Errorf("update device: %w", err)
	}

	existing, err := tq.GetStandardWarrantyForDevice(ctx, id)
	hasExisting := err == nil
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return DeviceVND{}, fmt.Errorf("get standard warranty: %w", err)
	}

	if in.WarrantyMonths > 0 {
		end := addMonths(purchaseDate, int(in.WarrantyMonths))
		if hasExisting {
			// The device form edits the coverage WINDOW, not the contract terms.
			// UpdateWarranty is a full replacement, so the nine migration-0017
			// columns must be carried through from the stored row or saving an
			// unrelated device edit would silently delete the user's cap,
			// deductible, exclusions and claim counter.
			if _, uerr := tq.UpdateWarranty(ctx, store.UpdateWarrantyParams{
				ID:            existing.ID,
				UserId:        userID,
				Type:          "STANDARD",
				Provider:      in.WarrantyProvider,
				StartDate:     wire.Date(purchaseDate),
				EndDate:       wire.Date(end),
				Months:        in.WarrantyMonths,
				Cost:          existing.Cost,
				Address:       in.WarrantyAddress,
				Phone:         in.WarrantyPhone,
				Notes:         in.WarrantyNotes,
				Component:     existing.Component,
				Scope:         existing.Scope,
				Cap:           existing.Cap,
				Deductible:    existing.Deductible,
				Exclusions:    existing.Exclusions,
				Region:        existing.Region,
				Transferable:  existing.Transferable,
				ClaimsAllowed: existing.ClaimsAllowed,
				ClaimsUsed:    existing.ClaimsUsed,
			}); uerr != nil {
				return DeviceVND{}, fmt.Errorf("update warranty: %w", uerr)
			}
		} else {
			// This is a second door into "Warranty", so it must obey the same
			// per-device ceiling as the warranty form (services.CreateWarranty).
			// `hasExisting` is false for a device with five EXTENDED/THIRD_PARTY
			// rows and no STANDARD row — the inline sync used to treat that as
			// "no warranty" and insert a sixth. Count inside this transaction,
			// before the insert, and return the identical ErrLimit shape.
			count, cerr := tq.CountWarrantiesByDevice(ctx, id)
			if cerr != nil {
				return DeviceVND{}, fmt.Errorf("count warranties: %w", cerr)
			}
			if qerr := enforceWarrantyQuota(ctx, count); qerr != nil {
				return DeviceVND{}, qerr
			}
			if _, cerr := tq.CreateWarranty(ctx, store.CreateWarrantyParams{
				ID:        auth.NewID(),
				DeviceId:  id,
				Type:      "STANDARD",
				Provider:  in.WarrantyProvider,
				StartDate: wire.Date(purchaseDate),
				EndDate:   wire.Date(end),
				Months:    in.WarrantyMonths,
				Cost:      nil,
				Address:   in.WarrantyAddress,
				Phone:     in.WarrantyPhone,
				Notes:     in.WarrantyNotes,
			}); cerr != nil {
				return DeviceVND{}, fmt.Errorf("create warranty: %w", cerr)
			}
		}
	} else if hasExisting {
		if _, derr := tq.DeleteWarranty(ctx, store.DeleteWarrantyParams{
			ID:     existing.ID,
			UserId: userID,
		}); derr != nil {
			return DeviceVND{}, fmt.Errorf("delete warranty: %w", derr)
		}
	}

	// Same reason as CreateDevice: the computed mismatch must reflect the
	// warranties this update just created/edited/deleted, and the response is a
	// device read in every way that matters to a client.
	warranties, err := tq.ListWarrantiesByDevice(ctx, store.ListWarrantiesByDeviceParams{
		DeviceId: id,
		UserId:   userID,
	})
	if err != nil {
		return DeviceVND{}, fmt.Errorf("list warranties after update: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return DeviceVND{}, fmt.Errorf("commit: %w", err)
	}
	return withVNDAndWarranties(updated, warranties), nil
}

// DeleteDevice removes the device row (cascade handles warranties / attachments
// / reminders). Disk cleanup of encrypted blobs lives in the attachments
// service; per Phase C task split, this function only touches the DB.
func DeleteDevice(ctx context.Context, db *pgxpool.Pool, userID, id string) error {
	q := store.New(db)
	rows, err := q.DeleteDevice(ctx, store.DeleteDeviceParams{ID: id, UserId: userID})
	if err != nil {
		return fmt.Errorf("delete device: %w", err)
	}
	if rows == 0 {
		return ErrNotFound(i18n.Text(ctx, "Không tìm thấy thiết bị"))
	}
	return nil
}

// ---- helpers ---------------------------------------------------------------

// categoryLookup is the slice of store.Queries that assertCategoryExists needs.
// Declaring it as an interface (instead of taking *pgxpool.Pool) keeps the
// validation path unit-testable: production passes store.New(db), while
// category_seed_test.go passes an in-memory lookup so it can prove that every
// code seeded by migration 0004 is accepted without needing a live database.
type categoryLookup interface {
	GetCategoryByCode(ctx context.Context, code string) (store.Category, error)
}

// assertCategoryExists rejects a category code that is not an active row of
// public."Category". The catalog rows come from migration 0004 — before that
// migration existed the table was empty and this check rejected every write.
//
// The `category` fieldError is rendered here rather than taken from
// ErrCategoryInvalid so it follows the request's language like the headline does
// (see the ErrCategoryInvalidMessage doc comment). `store.New(db)` callers in
// this package all have a request context; the wishlist paths pass the one they
// already have, so their response gains a translated field error without any
// behaviour change on the Vietnamese side.
func assertCategoryExists(ctx context.Context, q categoryLookup, code string) error {
	if _, err := q.GetCategoryByCode(ctx, code); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			invalid := ErrCategoryInvalid()
			invalid.FieldErrors["category"] = []string{i18n.Text(ctx, ErrCategoryInvalidMessage)}
			return invalid
		}
		return fmt.Errorf("get category: %w", err)
	}
	return nil
}

// deviceQuotaCounter is the slice of store.Queries the shared quota rule needs.
// Declaring it as an interface (instead of taking *pgxpool.Pool or
// store.Queries) keeps the rule unit-testable without a live database — the same
// trick assertCategoryExists uses with categoryLookup.
type deviceQuotaCounter interface {
	CountActiveDevicesByUser(ctx context.Context, userID string) (int64, error)
	CountAllDevicesByUser(ctx context.Context, userID string) (int64, error)
}

// assertDeviceQuota enforces both device ceilings for a write that is about to
// add `incomingActive` active rows and `incomingTotal` rows in total.
// FEATURE_IDEAS #14.
//
// Two independent ceilings, because "sold devices are free" on its own is
// gameable (mark sold → add → un-sell → repeat):
//
//   - active ≤ MaxDevicesPerUser      (50)  — rows with status <> 'SOLD'
//   - total  ≤ MaxDevicesTotalPerUser (500) — every row, sold ones included
//
// A write that adds no active rows skips the active count entirely: a 500-row
// archive import must not be slowed down (or refused) for a set it cannot affect.
//
// Reversal ("đánh dấu đã bán nhầm rồi bỏ đánh dấu") is deliberately NOT blocked
// here. Un-selling frees no slot, it takes one back, and this rule is only
// consulted on writes that ADD rows — so an account can sit at 51 active devices
// after a reversal. That is bounded by the total ceiling, and it is far better
// than refusing to undo a mistaken sale, which is precisely the trap this
// feature exists to remove. Clients must therefore treat `status` (not the
// quota) as the source of truth for "how many devices do I have".
//
// ctx is only used to render the two refusal messages in the request's language
// (docs/I18N_PLAN.md §3, Phase 1). It is a real parameter rather than something
// read later so a nil context is impossible to pass by accident: this is called
// from the HTTP handlers AND from the backup importer / wishlist transitions,
// and all of them already carry one.
func assertDeviceQuota(ctx context.Context, q deviceQuotaCounter, userID string, incomingActive, incomingTotal int64) error {
	if incomingTotal <= 0 {
		return nil
	}
	total, err := q.CountAllDevicesByUser(ctx, userID)
	if err != nil {
		return fmt.Errorf("count all devices: %w", err)
	}
	if incomingActive <= 0 {
		return enforceDeviceQuota(ctx, 0, total, 0, incomingTotal)
	}
	active, err := q.CountActiveDevicesByUser(ctx, userID)
	if err != nil {
		return fmt.Errorf("count active devices: %w", err)
	}
	return enforceDeviceQuota(ctx, active, total, incomingActive, incomingTotal)
}

// lockUserDeviceWrites serialises every device-creating transaction for one
// user. It is a PostgreSQL transaction-scoped advisory lock, so it is released
// automatically on COMMIT or ROLLBACK — there is no unlock call to forget.
//
// # Why a count-and-check needs this
//
// Read-committed counting is not a constraint: two concurrent creates can both
// read "49 active" and both insert, leaving 51. There is no row to lock for a
// row that does not exist yet, and a unique index cannot express "at most 50
// rows per user". A per-user advisory lock gives the count and the INSERTs one
// serial order per user, which is what makes the ceiling true rather than
// best-effort:
//
//	BEGIN
//	SELECT pg_advisory_xact_lock('device-write', <userId>)
//	SELECT count(active), count(all)          -- now stable for this user
//	INSERT ... (all candidates)
//	COMMIT                                    -- lock released here
//
// Both create paths take this lock — CreateDevice and BulkCreateDevices — so a
// single create and a 50-row batch cannot interleave their count/insert pairs.
// Different users use different second keys and never block each other. The
// fixed first key keeps the lock namespace separate from any future advisory
// lock in this service.
//
// The other two Device write paths (backup import and wishlist → PURCHASED) keep
// their existing pre-checks; adding the lock there would change behaviour this
// task was told not to touch. The guarantee here is specifically about creates.
func lockUserDeviceWrites(ctx context.Context, tx pgx.Tx, userID string) error {
	// hashtext() maps the string keys onto the two int4 arguments of the
	// two-key advisory-lock overload. A hash collision between two users can
	// only make them wait for each other — never let one past a ceiling — so the
	// failure mode is safe. The lock is held until the transaction ends.
	if _, err := tx.Exec(ctx,
		`SELECT pg_advisory_xact_lock(hashtext('wv:device-write'), hashtext($1))`,
		userID); err != nil {
		return fmt.Errorf("lock device writes: %w", err)
	}
	return nil
}

// enforceDeviceQuota is the pure ceiling arithmetic shared by CreateDevice
// (which counts the user's existing rows) and the backup importer (which knows
// its own base: `replace` wipes first, so its base is zero). Split out so the
// boundary cases are unit-testable without a database.
//
// Both refusals name a FIXED ceiling (50 / 500), so neither message needs a
// singular form: Vietnamese does not inflect for number and English does not
// either at these values. What the messages must do is say what actually counts
// — "đã bán" devices are free under the active ceiling but counted under the
// storage one — because the flat "Đã đạt giới hạn 50 thiết bị" this replaced was
// wrong on exactly that point.
func enforceDeviceQuota(ctx context.Context, active, total, incomingActive, incomingTotal int64) error {
	if incomingTotal <= 0 {
		return nil
	}
	if total+incomingTotal > MaxDevicesTotalPerUser {
		return ErrLimit(i18n.T(ctx,
			"Đã đạt giới hạn %d thiết bị lưu trữ (tính cả thiết bị đã bán). Xoá bớt hồ sơ cũ rồi thử lại.",
			MaxDevicesTotalPerUser))
	}
	if incomingActive > 0 && active+incomingActive > MaxDevicesPerUser {
		return ErrLimit(i18n.T(ctx,
			"Đã đạt giới hạn %d thiết bị chưa bán. Thiết bị đã đánh dấu \"Đã bán\" không chiếm suất — đánh dấu đã bán một thiết bị rồi thử lại.",
			MaxDevicesPerUser))
	}
	return nil
}

// deviceActiveIncoming maps a device status to its contribution to the ACTIVE
// quota: 0 for SOLD, 1 for everything else.
//
// The comparison is LITERAL (`status == "SOLD"`, no trimming) on purpose: the
// database predicate is literal too (`status <> 'SOLD'` in
// CountActiveDevicesByUser), so the two must agree on every byte. A stray
// ' SOLD ' is therefore counted as active by both — the strict direction, and the
// one that cannot be used to slip past the ceiling. The API's own write path
// already trims and normalises `status` in ValidateDeviceInput, so this only ever
// concerns legacy or hand-edited rows.
func deviceActiveIncoming(status string) int64 {
	if status == "SOLD" {
		return 0
	}
	return 1
}

// parseDate accepts both "YYYY-MM-DD" (the Zod schema's expected shape, since
// the form sends a date input) and full RFC3339 timestamps. Returns the parsed
// instant in UTC midnight when only the date portion is supplied — matching
// the TS `new Date(input.purchaseDate)` behavior on date-only strings.
func parseDate(s string) (time.Time, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return time.Time{}, errors.New("empty")
	}
	if t, err := time.Parse(time.RFC3339, s); err == nil {
		return t.UTC(), nil
	}
	if t, err := time.Parse(time.RFC3339Nano, s); err == nil {
		return t.UTC(), nil
	}
	if t, err := time.Parse("2006-01-02", s); err == nil {
		return t.UTC(), nil
	}
	if t, err := time.Parse("2006-01-02T15:04:05", s); err == nil {
		return t.UTC(), nil
	}
	return time.Time{}, errors.New("invalid date")
}

// parseSoldAt converts the optional `soldAt` input (same accepted formats as
// purchaseDate: YYYY-MM-DD or RFC3339) into the calendar-day column for the write
// path. nil / absent → zero (invalid) timestamp, which pgx writes as SQL NULL —
// the "not sold" state.
func parseSoldAt(ctx context.Context, in *string) (wire.Day, error) {
	if in == nil {
		return wire.Day{}, nil
	}
	t, err := parseDate(*in)
	if err != nil {
		return wire.Day{}, ErrValidationHeadline(FieldErrors{
			"soldAt": {i18n.Text(ctx, "Ngày bán không hợp lệ")},
		})
	}
	return wire.Date(t), nil
}

// parseReceivedAt converts the optional `receivedAt` input (same accepted formats
// as purchaseDate: YYYY-MM-DD or RFC3339) into the calendar-day column for the write
// path. nil / absent → zero (invalid) timestamp, which pgx writes as SQL NULL —
// "delivery date not recorded", which is deliberately different from "delivered on
// the purchase date": the deadline falls back to purchaseDate but the UI can still
// say the date is unknown.
func parseReceivedAt(ctx context.Context, in *string) (wire.Day, error) {
	if in == nil {
		return wire.Day{}, nil
	}
	t, err := parseDate(*in)
	if err != nil {
		return wire.Day{}, ErrValidationHeadline(FieldErrors{
			"receivedAt": {i18n.Text(ctx, "Ngày nhận hàng không hợp lệ")},
		})
	}
	return wire.Date(t), nil
}

// parseActivatedAt converts the optional `activatedAt` input (YYYY-MM-DD or
// RFC3339) into its calendar-day column. nil / absent → SQL NULL = "not activated",
// which is also what the once-only activation reminder keys on.
//
// There is NO comparison against purchaseDate here, on purpose. An activation
// timestamp BEFORE the invoice is a legitimate state — a shop can activate stock
// before selling it — and the frozen contract says so explicitly. Rejecting it
// would turn real data into a validation error.
func parseActivatedAt(ctx context.Context, in *string) (wire.Day, error) {
	if in == nil {
		return wire.Day{}, nil
	}
	t, err := parseDate(*in)
	if err != nil {
		return wire.Day{}, ErrValidationHeadline(FieldErrors{
			"activatedAt": {i18n.Text(ctx, "Ngày kích hoạt không hợp lệ")},
		})
	}
	return wire.Date(t), nil
}

// parseExtendedCoverBuyBy converts the optional `extendedCoverBuyBy` input
// (YYYY-MM-DD or RFC3339) into its calendar-day column. nil / absent → SQL NULL =
// "no extended-cover deadline".
//
// No day count is added or subtracted: the deadline is whatever the user entered.
// The API does not know, and must not pretend to know, AppleCare+'s or any other
// brand's window.
func parseExtendedCoverBuyBy(ctx context.Context, in *string) (wire.Day, error) {
	if in == nil {
		return wire.Day{}, nil
	}
	t, err := parseDate(*in)
	if err != nil {
		return wire.Day{}, ErrValidationHeadline(FieldErrors{
			"extendedCoverBuyBy": {i18n.Text(ctx, "Hạn mua bảo hiểm mở rộng không hợp lệ")},
		})
	}
	return wire.Date(t), nil
}

// addMonths mirrors date-fns/addMonths: clamps the day-of-month to the last
// day of the target month so e.g. Jan 31 + 1 month → Feb 28 / 29.
func addMonths(t time.Time, months int) time.Time {
	if months == 0 {
		return t
	}
	year, month, day := t.Date()
	hh, mm, ss := t.Clock()
	ns := t.Nanosecond()

	target := time.Date(year, month+time.Month(months), 1, hh, mm, ss, ns, t.Location())
	last := lastDayOfMonth(target.Year(), target.Month(), t.Location())
	if day > last {
		day = last
	}
	return time.Date(target.Year(), target.Month(), day, hh, mm, ss, ns, t.Location())
}

func lastDayOfMonth(year int, month time.Month, loc *time.Location) int {
	first := time.Date(year, month, 1, 0, 0, 0, 0, loc)
	next := first.AddDate(0, 1, 0)
	return next.AddDate(0, 0, -1).Day()
}

func trimPtr(p **string) {
	if p == nil || *p == nil {
		return
	}
	v := strings.TrimSpace(**p)
	if v == "" {
		*p = nil
		return
	}
	*p = &v
}

func isSafeID(s string) bool {
	if s == "" {
		return false
	}
	for _, r := range s {
		switch {
		case r >= 'a' && r <= 'z',
			r >= 'A' && r <= 'Z',
			r >= '0' && r <= '9',
			r == '_' || r == '-':
		default:
			return false
		}
	}
	return true
}

// sortInPlace is a tiny in-place sort that flips less() when desc.
func sortInPlace[T any](items []T, less func(a, b T) bool, desc bool) {
	cmp := less
	if desc {
		cmp = func(a, b T) bool { return less(b, a) }
	}
	// Insertion sort — N ≤ 50 in practice, allocates nothing.
	for i := 1; i < len(items); i++ {
		for j := i; j > 0 && cmp(items[j], items[j-1]); j-- {
			items[j], items[j-1] = items[j-1], items[j]
		}
	}
}
