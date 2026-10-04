package services

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/thanhtrung9368/warranty-vault/api/internal/auth"
	"github.com/thanhtrung9368/warranty-vault/api/internal/i18n"
	store "github.com/thanhtrung9368/warranty-vault/api/internal/store/gen"
)

// Handover certificate + tokenised read-only share link (FEATURE_IDEAS #2).
//
// The service is split in two halves that must stay separated:
//
//   - the OWNER half (Create/List/Revoke) — always called with an authenticated
//     userID and always scoped by it;
//   - the PUBLIC half (ViewSharedCertificate) — takes a raw token and nothing
//     else. It has no userID parameter AT ALL, which is the point: there is no
//     way for a caller (or a future refactor) to pass the wrong owner, because
//     ownership is resolved by the token inside one join.
const (
	// ShareTTLDefault is the lifetime of a share link when the client does not
	// ask for one. 30 days: long enough to cover "I sold it, the buyer will
	// chase the shop next month", short enough that a forwarded link does not
	// stay live forever.
	ShareTTLDefault = 30 * 24 * time.Hour

	// ShareTTLMin / ShareTTLMax bound the client-supplied lifetime. There is no
	// "never expires" value — see migration 0013.
	ShareTTLMin = 24 * time.Hour
	ShareTTLMax = 90 * 24 * time.Hour

	// MaxActiveSharesPerDevice is the per-device cap on live links. A share is
	// cheap to create and each one is a standing read capability, so an unbounded
	// list is both a row-growth problem and an access-management problem.
	MaxActiveSharesPerDevice = 10
)

// DeviceShare is the owner-facing projection. It never carries Token (shown once
// at creation) nor TokenHash (never leaves the server).
type DeviceShare struct {
	ID            string  `json:"id"`
	DeviceID      string  `json:"deviceId"`
	ExpiresAt     string  `json:"expiresAt"`
	RevokedAt     *string `json:"revokedAt"`
	IncludeSerial bool    `json:"includeSerial"`
	ViewCount     int32   `json:"viewCount"`
	LastViewedAt  *string `json:"lastViewedAt"`
	CreatedAt     string  `json:"createdAt"`
}

// CreatedDeviceShare is DeviceShare plus the ONE-TIME raw token.
type CreatedDeviceShare struct {
	DeviceShare
	// Token is the raw credential in the URL path. It is returned exactly once,
	// by POST, and cannot be recovered afterwards: only its sha256 digest is
	// stored (auth.NewTokenAndHash), the same scheme PasswordReset uses.
	Token string `json:"token"`
	// SharePath is the path a client should append to its own base URL. The
	// server deliberately does not build an absolute URL: it does not know
	// whether the caller reached it over the web origin or directly, and a wrong
	// host in a link the user forwards is worse than no link.
	SharePath string `json:"sharePath"`
}

// CreateShareInput is the POST body.
type CreateShareInput struct {
	// ExpiresInDays nil = ShareTTLDefault. Bounded to [1, 90].
	ExpiresInDays *int32 `json:"expiresInDays,omitempty"`
	// IncludeSerial false (default) = the certificate carries only a MASKED
	// serial. true = the full value the user typed.
	IncludeSerial bool `json:"includeSerial,omitempty"`
}

// SharedWarranty is one warranty package as the RECIPIENT sees it: coverage and
// where to claim it. No cost, no notes, no ids beyond the warranty's own.
type SharedWarranty struct {
	Type      string  `json:"type"`
	Provider  *string `json:"provider"`
	StartDate string  `json:"startDate"`
	EndDate   string  `json:"endDate"`
	Months    int32   `json:"months"`
	Address   *string `json:"address"`
	Phone     *string `json:"phone"`
}

// SharedCertificate is the ENTIRE projection a share link exposes.
//
// Everything absent from this struct is absent on purpose — most importantly the
// device id, Device.notes, purchasePrice/soldPrice, Warranty.cost/notes and any
// attachment row. Adding a field here widens what an unauthenticated reader sees,
// so it is a security decision (see the openapi description of the endpoint,
// which pins the same list).
type SharedCertificate struct {
	DeviceName    string  `json:"deviceName"`
	Category      string  `json:"category"`
	Brand         *string `json:"brand"`
	Model         *string `json:"model"`
	PurchaseDate  string  `json:"purchaseDate"`
	PurchasePlace *string `json:"purchasePlace"`
	Status        string  `json:"status"`
	// SoldAt is included when recorded: the buyer's own proof of when the
	// handover happened.
	SoldAt *string `json:"soldAt"`
	// SerialNumber is present ONLY when the owner opted in (includeSerial).
	SerialNumber *string `json:"serialNumber"`
	// SerialMasked is always present when the device has a serial, whatever the
	// opt-in: the buyer can confirm the sticker matches without the link itself
	// carrying a full identifier.
	SerialMasked *string `json:"serialNumberMasked"`
	// EffectiveWarrantyEnd is max(endDate) over the packages below — the single
	// number the buyer actually asked for. nil when no package has an end date.
	EffectiveWarrantyEnd *string          `json:"effectiveWarrantyEnd"`
	Warranties           []SharedWarranty `json:"warranties"`
	// ExpiresAt is when the link stops working, so the recipient knows the
	// document has a shelf life.
	ExpiresAt string `json:"expiresAt"`
	// IssuedAt is when the link was created, not when the page was opened.
	IssuedAt   string `json:"issuedAt"`
	Disclaimer string `json:"disclaimer"`
}

// SharedCertificateDisclaimer is shown on every certificate (JSON and HTML). It
// says what the document is NOT, because the recipient has no other way to know:
// no prices, no invoice images, no identity of the seller.
//
// It is the Vietnamese SOURCE text and doubles as the catalog key
// (internal/i18n/catalog.go). The constant keeps the Vietnamese sentence because
// the constant IS the Vietnamese sentence; what varies is the language it is
// RENDERED in, which is decided per request (see ViewSharedCertificate and
// handlers/publicShareHandler for the certificate's language rule — the recipient
// is a third party who never chose one).
const SharedCertificateDisclaimer = "Phiếu này do chủ máy tạo từ ứng dụng Warranty Vault và chỉ chứa " +
	"thông tin bảo hành của một thiết bị. Phiếu không phải hoá đơn, không thay thế hoá đơn gốc và không " +
	"kèm ảnh chứng từ. Người nhận nên đối chiếu số máy (IMEI/serial) in trên máy với phiếu trước khi nhận."

// ---- owner half ------------------------------------------------------------

// CreateDeviceShare mints a link for one device the caller owns.
//
// i18n (docs/I18N_PLAN.md §3, Phase 1): every message below is the EXISTING
// Vietnamese literal wrapped in `i18n.Text`/`i18n.T`, so the ctx must be the
// REQUEST's. The codes do not move: the not-found stays NOT_FOUND (404) and the
// per-device ceiling stays LIMIT_REACHED (409) — `ErrLimit` keys its own message,
// which is how the headline reaches the client in the request's language without
// this function having to know which language that is.
func CreateDeviceShare(ctx context.Context, db *pgxpool.Pool, userID, deviceID string, in CreateShareInput) (*CreatedDeviceShare, error) {
	if !isSafeID(deviceID) {
		return nil, ErrNotFound(i18n.Text(ctx, "Không tìm thấy thiết bị"))
	}
	q := store.New(db)

	// Ownership first: 404 for a device that is not the caller's, identical to
	// every other device read. This is also what makes "deviceId" trustworthy
	// before it is written into the share row.
	if _, err := q.GetDeviceByID(ctx, store.GetDeviceByIDParams{ID: deviceID, UserId: userID}); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound(i18n.Text(ctx, "Không tìm thấy thiết bị"))
		}
		return nil, fmt.Errorf("get device: %w", err)
	}

	ttl, err := shareTTL(ctx, in.ExpiresInDays)
	if err != nil {
		return nil, err
	}

	now := time.Now()
	active, err := q.CountActiveSharesForDevice(ctx, store.CountActiveSharesForDeviceParams{
		DeviceId:  deviceID,
		ExpiresAt: pgtype.Timestamp{Time: now, Valid: true},
	})
	if err != nil {
		return nil, fmt.Errorf("count shares: %w", err)
	}
	if active >= MaxActiveSharesPerDevice {
		return nil, ErrLimit(i18n.T(ctx,
			"Đã đạt giới hạn %d link chia sẻ còn hiệu lực cho thiết bị này. Thu hồi bớt rồi thử lại.",
			MaxActiveSharesPerDevice))
	}

	token, hash, err := auth.NewTokenAndHash()
	if err != nil {
		return nil, fmt.Errorf("mint share token: %w", err)
	}
	expiresAt := now.Add(ttl)

	row, err := q.CreateDeviceShare(ctx, store.CreateDeviceShareParams{
		ID:            auth.NewID(),
		DeviceId:      deviceID,
		UserId:        userID,
		TokenHash:     hash,
		ExpiresAt:     pgtype.Timestamp{Time: expiresAt, Valid: true},
		IncludeSerial: in.IncludeSerial,
	})
	if err != nil {
		return nil, fmt.Errorf("create share: %w", err)
	}

	return &CreatedDeviceShare{
		DeviceShare: shareDTO(row),
		Token:       token,
		SharePath:   SharePath(token),
	}, nil
}

// SharePath is the public path for a raw token. Kept in one place so the handler,
// the openapi description and any client agree on the shape.
func SharePath(token string) string {
	return "/api/v1/public/shares/" + token
}

// ListDeviceShares returns every share of a device the caller owns, newest first.
// An unknown or foreign device id yields an empty list (the query is user-scoped),
// which is the same information a client would get from an empty device.
func ListDeviceShares(ctx context.Context, db *pgxpool.Pool, userID, deviceID string) ([]DeviceShare, error) {
	rows, err := store.New(db).ListSharesForDevice(ctx, store.ListSharesForDeviceParams{
		DeviceId: deviceID,
		UserId:   userID,
	})
	if err != nil {
		return nil, fmt.Errorf("list shares: %w", err)
	}
	out := make([]DeviceShare, 0, len(rows))
	for _, r := range rows {
		out = append(out, DeviceShare{
			ID:            r.ID,
			DeviceID:      r.DeviceId,
			ExpiresAt:     tsString(r.ExpiresAt),
			RevokedAt:     tsPtrString(r.RevokedAt),
			IncludeSerial: r.IncludeSerial,
			ViewCount:     r.ViewCount,
			LastViewedAt:  tsPtrString(r.LastViewedAt),
			CreatedAt:     tsString(r.CreatedAt),
		})
	}
	return out, nil
}

// RevokeDeviceShare cuts a link. Idempotent: revoking an already-revoked share is
// a success (nothing to do), while a share id that is not the caller's is a 404 —
// foreign and non-existent are indistinguishable.
func RevokeDeviceShare(ctx context.Context, db *pgxpool.Pool, userID, shareID string) error {
	if strings.TrimSpace(shareID) == "" {
		return ErrNotFound(i18n.Text(ctx, "Không tìm thấy link chia sẻ"))
	}
	q := store.New(db)
	// A second revoke affects 0 rows, so distinguish "already mine and revoked"
	// from "not mine" with an ownership-scoped read first.
	if _, err := q.GetShareByIDForUser(ctx, store.GetShareByIDForUserParams{
		ID:     shareID,
		UserId: userID,
	}); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound(i18n.Text(ctx, "Không tìm thấy link chia sẻ"))
		}
		return fmt.Errorf("get share: %w", err)
	}
	if _, err := q.RevokeShareByID(ctx, store.RevokeShareByIDParams{
		ID:     shareID,
		UserId: userID,
	}); err != nil {
		return fmt.Errorf("revoke share: %w", err)
	}
	return nil
}

// ---- public half -----------------------------------------------------------

// ViewSharedCertificate resolves a raw token into the certificate the recipient
// sees.
//
// Every failure — unknown, expired, revoked, or a share whose device vanished —
// returns the same ErrShareNotFound, and the handler renders it as one
// byte-identical 404. That is a hard requirement, not a nicety: distinguishing
// "expired" from "wrong" tells an attacker which guesses were once valid.
//
// # i18n
//
// The disclaimer is rendered in the request's language. This is the one place a
// language is chosen with NO `User.locale` to fall back on: the recipient is a
// third party holding a forwarded link and has never had a chance to set a
// preference, so the language comes from what their own client sends —
// `?lang=` first, then Accept-Language, and a documented Vietnamese fallback
// (see handlers.publicShareLanguage). The context is built by that handler.
//
// Every FAILURE stays language-independent in an important sense: whichever
// language is chosen, the four failure cases render the same bytes as each other,
// which is what keeps this route from being an enumeration oracle. The language
// itself is client-supplied and carries no information about the token.
func ViewSharedCertificate(ctx context.Context, db *pgxpool.Pool, token string) (*SharedCertificate, error) {
	token = strings.TrimSpace(token)
	if token == "" {
		return nil, ErrShareNotFound()
	}
	q := store.New(db)
	now := time.Now()

	row, err := q.GetShareByTokenHash(ctx, store.GetShareByTokenHashParams{
		TokenHash: auth.HashToken(token),
		ExpiresAt: pgtype.Timestamp{Time: now, Valid: true},
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrShareNotFound()
		}
		return nil, fmt.Errorf("get share: %w", err)
	}

	// The warranty read is keyed on the device id that came OUT of the share row,
	// never on anything the caller supplied. This is the whole IDOR defence.
	warranties, err := q.ListWarrantiesForShare(ctx, row.DeviceID)
	if err != nil {
		return nil, fmt.Errorf("list warranties for share: %w", err)
	}

	out := &SharedCertificate{
		DeviceName:    row.DeviceName,
		Category:      row.DeviceCategory,
		Brand:         row.DeviceBrand,
		Model:         row.DeviceModel,
		PurchaseDate:  tsString(row.DevicePurchaseDate),
		PurchasePlace: row.DevicePurchasePlace,
		Status:        row.DeviceStatus,
		SoldAt:        tsPtrString(row.DeviceSoldAt),
		ExpiresAt:     tsString(row.ShareExpiresAt),
		IssuedAt:      tsString(row.ShareCreatedAt),
		Warranties:    make([]SharedWarranty, 0, len(warranties)),
		// Rendered through `i18n.Text` rather than `i18n.T` because the sentence
		// travels as DATA (a named constant) and `go vet`'s printf analyzer rejects
		// a non-constant key for the variadic form.
		Disclaimer: i18n.Text(ctx, SharedCertificateDisclaimer),
	}
	if row.DeviceSerialNumber != nil && strings.TrimSpace(*row.DeviceSerialNumber) != "" {
		masked := MaskSerial(*row.DeviceSerialNumber)
		out.SerialMasked = &masked
		if row.ShareIncludeSerial {
			full := *row.DeviceSerialNumber
			out.SerialNumber = &full
		}
	}
	for _, w := range warranties {
		out.Warranties = append(out.Warranties, SharedWarranty{
			Type:      w.Type,
			Provider:  w.Provider,
			StartDate: tsString(w.StartDate),
			EndDate:   tsString(w.EndDate),
			Months:    w.Months,
			Address:   w.Address,
			Phone:     w.Phone,
		})
	}
	out.EffectiveWarrantyEnd = maxEndDate(warranties)

	// Best-effort telemetry for the owner. A failure here must never cost the
	// recipient their certificate.
	_ = q.TouchShareView(ctx, store.TouchShareViewParams{
		ID:           row.ShareID,
		LastViewedAt: pgtype.Timestamp{Time: now, Valid: true},
	})
	return out, nil
}

// MaskSerial hides the middle of a serial/IMEI, keeping at most the first four
// and the last four characters. At least one character is ALWAYS hidden, so no
// input length can round-trip the full value:
//
//	"356938035643809" (15) -> "3569*******3809"
//	"ABC123"          (6)  -> "A****3"
//	"12"              (2)  -> "**"
//
// Length is preserved on purpose: the buyer holding the device can see that the
// masked string has the same shape as the sticker, which is the point of showing
// it at all.
func MaskSerial(s string) string {
	r := []rune(strings.TrimSpace(s))
	n := len(r)
	switch {
	case n == 0:
		return ""
	case n <= 2:
		return strings.Repeat("*", n)
	case n <= 8:
		return string(r[0]) + strings.Repeat("*", n-2) + string(r[n-1])
	default:
		return string(r[:4]) + strings.Repeat("*", n-8) + string(r[n-4:])
	}
}

// ---- helpers ---------------------------------------------------------------

// shareTTL validates the client-supplied lifetime.
//
// i18n: the refusal is a field-level failure — the whole story is the one field,
// which is exactly what `ErrValidationKeyed` exists for — so the `expiresInDays`
// entry is rendered AT THE CALL SITE (the map holds finished strings) and the
// headline carries the same catalog key so the envelope is not half-translated.
// `i18n.T` because the sentence names both bounds.
func shareTTL(ctx context.Context, days *int32) (time.Duration, error) {
	if days == nil {
		return ShareTTLDefault, nil
	}
	ttl := time.Duration(*days) * 24 * time.Hour
	if ttl < ShareTTLMin || ttl > ShareTTLMax {
		key := "Số ngày hiệu lực phải từ %d tới %d"
		return 0, ErrValidationKeyed(key, FieldErrors{"expiresInDays": {i18n.T(ctx, key,
			int(ShareTTLMin/(24*time.Hour)), int(ShareTTLMax/(24*time.Hour)))}})
	}
	return ttl, nil
}

func shareDTO(row store.DeviceShare) DeviceShare {
	return DeviceShare{
		ID:            row.ID,
		DeviceID:      row.DeviceId,
		ExpiresAt:     tsString(row.ExpiresAt),
		RevokedAt:     tsPtrString(row.RevokedAt),
		IncludeSerial: row.IncludeSerial,
		ViewCount:     row.ViewCount,
		LastViewedAt:  tsPtrString(row.LastViewedAt),
		CreatedAt:     tsString(row.CreatedAt),
	}
}

// maxEndDate returns the latest end date as RFC3339, or nil.
func maxEndDate(rows []store.ListWarrantiesForShareRow) *string {
	var max time.Time
	found := false
	for _, w := range rows {
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
	s := max.UTC().Format(time.RFC3339)
	return &s
}

func tsString(ts pgtype.Timestamp) string {
	if !ts.Valid {
		return ""
	}
	return ts.Time.UTC().Format(time.RFC3339)
}

func tsPtrString(ts pgtype.Timestamp) *string {
	if !ts.Valid {
		return nil
	}
	s := ts.Time.UTC().Format(time.RFC3339)
	return &s
}

// ErrShareNotFound is the single error every public failure maps to.
//
// It takes no context and stays Vietnamese on purpose. The four failure cases
// (unknown / expired / revoked / deleted device) must render as one
// indistinguishable answer, and the handler chooses the language once, at the
// request edge, where it already knows which language the recipient asked for —
// `handlers.writeShareLookupFailure`. Threading a context in here would put a
// per-call-site language decision in the one function whose whole job is that
// there is only ever ONE answer.
func ErrShareNotFound() *Error {
	return ErrNotFound("Link chia sẻ không tồn tại, đã hết hạn hoặc đã bị thu hồi")
}
