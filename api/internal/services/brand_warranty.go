package services

import (
	"context"
	"net/url"
	"strings"
	"time"

	"github.com/thanhtrung9368/warranty-vault/api/internal/i18n"
	store "github.com/thanhtrung9368/warranty-vault/api/internal/store/gen"
	"github.com/thanhtrung9368/warranty-vault/api/internal/wire"
)

// Brand warranty lookup + mismatch flag (gap #11, migration 0023).
//
// The five fields on Device are a USER-ENTERED record of what the BRAND's own
// lookup page said. They are deliberately not a second warranty calculation:
// "purchaseDate" is the invoice date, the brand may have started the clock
// earlier or later, and only the user can copy the brand's answer into the app.
// The server never fetches brandLookupUrl — it is an audit trail, not a request.
//
// Everything computed in this file is DERIVED. warrantyMismatch is never stored;
// it is rebuilt on every device read from the five fields plus purchaseDate and
// the whole-unit warranty rows. A stored copy could disagree with the data it
// claims to describe, which is exactly the failure this feature exists to
// expose in the first place.
const (
	BrandWarrantyStatusActive        = "ACTIVE"
	BrandWarrantyStatusExpired       = "EXPIRED"
	BrandWarrantyStatusNotRegistered = "NOT_REGISTERED"
	BrandWarrantyStatusPreActivated  = "PRE_ACTIVATED"
	BrandWarrantyStatusUnknown       = "UNKNOWN"
)

// validBrandWarrantyStatuses is the frozen enum. Match is exact (the same rule
// as Device.status): a client sends one of these five strings, never a
// human-readable label.
var validBrandWarrantyStatuses = map[string]bool{
	BrandWarrantyStatusActive:        true,
	BrandWarrantyStatusExpired:       true,
	BrandWarrantyStatusNotRegistered: true,
	BrandWarrantyStatusPreActivated:  true,
	BrandWarrantyStatusUnknown:       true,
}

// Mismatch kinds. The direction is in the KIND, so "days" stays a positive
// magnitude and a client never has to interpret a sign:
//
//	STARTS_BEFORE  brand says the warranty began BEFORE the invoice date
//	STARTS_AFTER   brand says it began AFTER the invoice date
//	ENDED_EARLIER  brand says it ends BEFORE the app's effective warranty end
//	ENDED_LATER    brand says it ends AFTER the app's effective warranty end
const (
	WarrantyMismatchStartsBefore = "STARTS_BEFORE"
	WarrantyMismatchStartsAfter  = "STARTS_AFTER"
	WarrantyMismatchEndedEarlier = "ENDED_EARLIER"
	WarrantyMismatchEndedLater   = "ENDED_LATER"
)

// warrantyMismatchPrecedence is the ONE choice this feature makes about which
// mismatch to show when more than one exists. It is ordered by consequence to
// the user, not by which comparison happens to run first:
//
//  1. ENDED_EARLIER — the service centre will refuse a repair the app said was
//     covered. This is the concrete harm named in the feature request ("còn 8
//     tháng" in the app, "hết hạn tuần trước" at the counter): a denied claim.
//  2. ENDED_LATER — the app under-reports cover, so the user may pay for a
//     repair or extended cover they did not need. Real money, but no lost claim.
//  3. STARTS_BEFORE — the brand's clock started before the invoice (grey import,
//     pre-activation). With no brand end date this is the only signal that the
//     user has less time than the invoice suggests.
//  4. STARTS_AFTER — the brand's clock started after the invoice, which normally
//     means MORE cover than expected. The least alarming direction.
//
// Only one entry is returned. A start and an end mismatch can coexist (a brand
// start before the invoice with an unchanged duration produces both), and
// surfacing two overlapping verdicts would make the client choose — the exact
// three-way disagreement the server exists to prevent.
var warrantyMismatchPrecedence = []string{
	WarrantyMismatchEndedEarlier,
	WarrantyMismatchEndedLater,
	WarrantyMismatchStartsBefore,
	WarrantyMismatchStartsAfter,
}

// BrandWarrantyMismatch is the computed, read-only `warrantyMismatch` object.
//
// BrandDate and PurchaseDate are calendar dates (YYYY-MM-DD), never timestamps:
// a warranty is a day-level promise, and comparing "2025-03-01T00:00:00" with a
// brand page that shows only "01/03/2025" would manufacture a mismatch out of a
// time-of-day difference.
//
// For STARTS_* the pair is (brand start, Device.purchaseDate). For ENDED_* it is
// (brand end, the device's whole-unit effective warranty end). The field name
// `purchaseDate` is the frozen contract's name for "the app's side of the
// comparison" in both cases; the kind says which date it actually is.
type BrandWarrantyMismatch struct {
	Kind         string `json:"kind"`
	Days         int    `json:"days"`
	BrandDate    string `json:"brandDate"`
	PurchaseDate string `json:"purchaseDate"`
}

const mismatchDateLayout = "2006-01-02"

// brandWarrantyValues is the validated, storage-ready form of the five input
// fields. It exists so CreateDevice/UpdateDevice do not have to repeat the
// pointer/parse dance after ValidateDeviceInput.
type brandWarrantyValues struct {
	Status    *string
	Start     wire.Day
	End       wire.Day
	CheckedAt wire.Instant
	LookupURL *string
}

// parseBrandWarranty validates and normalises the five brand-lookup fields. It
// mirrors the style of the other parse helpers in devices.go: it mutates the
// input's pointers (trim, empty-to-nil) and returns both the storage values and
// the field errors, so the caller never has two subtly different definitions of
// the same rule.
//
// Rules (the frozen contract):
//
//   - brandWarrantyStatus is REQUIRED whenever any of the other four is set.
//     A status alone is valid: NOT_REGISTERED has no dates.
//   - brandWarrantyStatus must be one of the five enum values.
//   - each supplied date must parse (YYYY-MM-DD or RFC3339).
//   - brandWarrantyEnd must not precede brandWarrantyStart when both are
//     present.
//   - brandLookupUrl must be an absolute http/https URL. It is NOT fetched.
func parseBrandWarranty(ctx context.Context, in *DeviceInput) (brandWarrantyValues, FieldErrors) {
	trimPtr(&in.BrandWarrantyStatus)
	trimPtr(&in.BrandWarrantyStart)
	trimPtr(&in.BrandWarrantyEnd)
	trimPtr(&in.BrandCheckedAt)
	trimPtr(&in.BrandLookupUrl)

	fieldErrors := FieldErrors{}
	out := brandWarrantyValues{
		Status:    in.BrandWarrantyStatus,
		LookupURL: in.BrandLookupUrl,
	}

	if out.Status != nil && !validBrandWarrantyStatuses[*out.Status] {
		fieldErrors["brandWarrantyStatus"] = []string{
			i18n.Text(ctx, "Trạng thái bảo hành hãng không hợp lệ"),
		}
	}

	anyOther := in.BrandWarrantyStart != nil || in.BrandWarrantyEnd != nil ||
		in.BrandCheckedAt != nil || in.BrandLookupUrl != nil
	if anyOther && out.Status == nil {
		fieldErrors["brandWarrantyStatus"] = []string{
			i18n.Text(ctx, "Trạng thái bảo hành hãng bắt buộc khi đã ghi ngày hoặc link tra cứu"),
		}
	}

	parse := func(raw *string, field, message string) wire.Instant {
		if raw == nil {
			return wire.Instant{}
		}
		t, err := parseDate(*raw)
		if err != nil {
			fieldErrors[field] = []string{i18n.Text(ctx, message)}
			return wire.Instant{}
		}
		return wire.At(t)
	}
	out.Start = parse(in.BrandWarrantyStart, "brandWarrantyStart", "Ngày bắt đầu bảo hành hãng không hợp lệ").Day()
	out.End = parse(in.BrandWarrantyEnd, "brandWarrantyEnd", "Ngày hết hạn bảo hành hãng không hợp lệ").Day()
	out.CheckedAt = parse(in.BrandCheckedAt, "brandCheckedAt", "Thời điểm kiểm tra bảo hành hãng không hợp lệ")

	// Only compare when BOTH parsed. A malformed date has its own field error;
	// adding an end-before-start error on top would point at the wrong field.
	if out.Start.Valid && out.End.Valid && out.End.Time.Before(out.Start.Time) {
		fieldErrors["brandWarrantyEnd"] = []string{
			i18n.Text(ctx, "Ngày hết hạn bảo hành hãng không được trước ngày bắt đầu"),
		}
	}

	if out.LookupURL != nil && !isAbsoluteHTTPURL(*out.LookupURL) {
		fieldErrors["brandLookupUrl"] = []string{
			i18n.Text(ctx, "Link tra cứu bảo hành hãng phải là URL http/https tuyệt đối"),
		}
	}

	return out, fieldErrors
}

// brandWarrantyForWrite re-runs parseBrandWarranty and turns any field error
// into the normal VALIDATION envelope. Create/Update call this after
// ValidateDeviceInput, so in practice it cannot fail; it exists so a future
// write path that forgets the validator still cannot store an unchecked value.
func brandWarrantyForWrite(ctx context.Context, in *DeviceInput) (brandWarrantyValues, error) {
	values, fieldErrors := parseBrandWarranty(ctx, in)
	if len(fieldErrors) > 0 {
		return values, ErrValidationHeadline(fieldErrors)
	}
	return values, nil
}

// isAbsoluteHTTPURL is the contract's URL rule: an absolute http/https URL with
// a host. Deliberately permissive about path/query/fragment — the server is
// recording what the user opened, not validating a web page. It rejects
// whitespace, control characters, relative paths and any other scheme (a
// `javascript:` or `file:` value must never become an audit-trail link).
func isAbsoluteHTTPURL(raw string) bool {
	if raw == "" || strings.ContainsAny(raw, " \t\r\n") {
		return false
	}
	u, err := url.Parse(raw)
	if err != nil {
		return false
	}
	if !u.IsAbs() || u.Host == "" || u.Hostname() == "" {
		return false
	}
	return strings.EqualFold(u.Scheme, "http") || strings.EqualFold(u.Scheme, "https")
}

// warrantyMismatchFor computes the single mismatch the contract exposes, or nil
// when there is none or when there is nothing to compare.
//
// # What "effectiveWarrantyEnd" means here
//
// The contract defines the comparison target as the max endDate over WHOLE-UNIT
// warranty rows only, and points at the share certificate as the rule. This uses
// exactly that rule (wholeUnitWarrantyEnd below) rather than the longer-standing
// DeviceListItem.effectiveWarrantyEnd helper, which predates migration 0017 and
// still takes the max over every row. Changing that existing field would change
// list payloads for users who never recorded a brand lookup — out of scope, and
// the mismatch must not claim a component clock (a 10-year motor warranty) is
// the whole device's expiry.
//
// # Nothing to compare
//
//   - no brandWarrantyStart and no brandWarrantyEnd → nil;
//   - a brand start needs purchaseDate (always present in practice);
//   - a brand end needs at least one whole-unit warranty row with an end date.
//     A device with only component rows therefore gets no end comparison, and a
//     status alone (NOT_REGISTERED) always gets nil.
func warrantyMismatchFor(d store.Device, warranties []store.Warranty) *BrandWarrantyMismatch {
	if !d.PurchaseDate.Valid {
		return nil
	}
	purchase := dateOnly(d.PurchaseDate.Time)

	candidates := map[string]BrandWarrantyMismatch{}

	if d.BrandWarrantyStart.Valid {
		brand := dateOnly(d.BrandWarrantyStart.Time)
		switch {
		case brand.Before(purchase):
			candidates[WarrantyMismatchStartsBefore] = BrandWarrantyMismatch{
				Kind:         WarrantyMismatchStartsBefore,
				Days:         daysBetween(brand, purchase),
				BrandDate:    brand.Format(mismatchDateLayout),
				PurchaseDate: purchase.Format(mismatchDateLayout),
			}
		case brand.After(purchase):
			candidates[WarrantyMismatchStartsAfter] = BrandWarrantyMismatch{
				Kind:         WarrantyMismatchStartsAfter,
				Days:         daysBetween(purchase, brand),
				BrandDate:    brand.Format(mismatchDateLayout),
				PurchaseDate: purchase.Format(mismatchDateLayout),
			}
		}
	}

	if d.BrandWarrantyEnd.Valid {
		if end := wholeUnitWarrantyEnd(warranties); end != nil {
			brandEnd := dateOnly(d.BrandWarrantyEnd.Time)
			appEnd := dateOnly(*end)
			switch {
			case brandEnd.Before(appEnd):
				candidates[WarrantyMismatchEndedEarlier] = BrandWarrantyMismatch{
					Kind:         WarrantyMismatchEndedEarlier,
					Days:         daysBetween(brandEnd, appEnd),
					BrandDate:    brandEnd.Format(mismatchDateLayout),
					PurchaseDate: appEnd.Format(mismatchDateLayout),
				}
			case brandEnd.After(appEnd):
				candidates[WarrantyMismatchEndedLater] = BrandWarrantyMismatch{
					Kind:         WarrantyMismatchEndedLater,
					Days:         daysBetween(appEnd, brandEnd),
					BrandDate:    brandEnd.Format(mismatchDateLayout),
					PurchaseDate: appEnd.Format(mismatchDateLayout),
				}
			}
		}
	}

	for _, kind := range warrantyMismatchPrecedence {
		if m, ok := candidates[kind]; ok {
			return &m
		}
	}
	return nil
}

// wholeUnitWarrantyEnd returns the latest end date among WHOLE-UNIT rows
// (Component == nil or blank), or nil.
//
// This is the ONE definition of `effectiveWarrantyEnd` for the device reads:
// services.ListDevices, services.GetDevice and services.Search all call it, so a
// device cannot report one date in the list and a different one on its detail
// page. It is also the rule shares.go::maxWholeUnitEndDate applies to the
// certificate, and the one warrantyMismatchFor uses to compare against the
// brand's end date.
//
// A blank Component is treated as whole-unit: the service normalizes "" to NULL
// on write, but a hand-edited row must not be silently excluded from the
// comparison while also rendering without a component label.
func wholeUnitWarrantyEnd(warranties []store.Warranty) *time.Time {
	var max time.Time
	found := false
	for _, w := range warranties {
		if w.Component != nil && strings.TrimSpace(*w.Component) != "" {
			continue
		}
		if !w.EndDate.Valid {
			continue
		}
		if !found || w.EndDate.Time.After(max) {
			max = w.EndDate.Time
			found = true
		}
	}
	if !found {
		return nil
	}
	return &max
}

// dateOnly truncates to UTC midnight. Stored timestamps are
// `timestamp without time zone` with UTC semantics (every other date comparison
// in this package does the same), and the brand's page is a calendar date.
func dateOnly(t time.Time) time.Time {
	y, m, d := t.UTC().Date()
	return time.Date(y, m, d, 0, 0, 0, 0, time.UTC)
}

// daysBetween returns the whole-day distance between two already-truncated
// dates, always >= 0. The caller passes them in ascending order; the kinds carry
// the direction, so the number never needs a sign.
func daysBetween(from, to time.Time) int {
	return int(to.Sub(from) / (24 * time.Hour))
}
