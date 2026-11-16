package services

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/thanhtrung9368/warranty-vault/api/internal/auth"
	"github.com/thanhtrung9368/warranty-vault/api/internal/i18n"
	store "github.com/thanhtrung9368/warranty-vault/api/internal/store/gen"
	"github.com/thanhtrung9368/warranty-vault/api/internal/wire"
)

// Resale handoff (Warrly 2.0) — the seller hands ONE device record to a buyer.
//
// # What moves, and what never moves
//
// The buyer receives a NEW Device row (a copy), that device's Warranty rows, the
// selected Attachment rows (same encrypted blob, no re-encryption) and the Claim
// history. Price and private notes DO NOT travel: "purchasePrice" becomes 0,
// "soldPrice"/"soldAt"/"fxRate"/"Device"."notes" become NULL,
// "Warranty"."cost"/"notes" become NULL and "Claim"."cost" becomes NULL. Those
// zeroes are written by the INSERT ... SELECT statements in
// store/queries/handoff.sql, not filtered in Go afterwards — the redaction has to
// survive a refactor of this file.
//
// The transaction that moves them is described once, here, because it is the
// security boundary of the feature:
//
//	BEGIN
//	SELECT ... FROM "DeviceHandoff" WHERE "codeHash" = $1 FOR UPDATE   -- one winner
//	re-check status / expiry under the lock
//	advisory lock on the BUYER's device writes + quota count
//	INSERT the buyer's Device / Warranty / Attachment / Claim rows
//	UPDATE "DeviceHandoff" SET status = 'CLAIMED' WHERE status = 'PENDING'  -- second gate
//	UPDATE the seller's Device SET status = 'SOLD', "handoffSentAt" = now
//	COMMIT
//
// Either BOTH the copy and the status flip commit, or neither does. An expired,
// cancelled or already-claimed code therefore transfers NOTHING: there is no
// compensating delete for a half-finished handoff, because a half-finished one is
// impossible.
//
// # The code is a capability, but a weak one on its own
//
// 6 characters from a 32-symbol alphabet (~30 bits). That is deliberately short
// because a human reads it off a phone screen, and it is only safe in combination
// with: a 14-day TTL, ONE claim, per-IP rate limiting on the public preview and
// per-user rate limiting on the claim, and seller cancellation. See the header of
// migration 0032 — the sha256 "codeHash" keeps a database dump from containing
// live codes, but it cannot make 30 bits into 256 and is not claimed to.

const (
	// HandoffTTL is how long an unclaimed code stays usable. 14 days: long enough
	// for "I sold it on the weekend, the buyer will open it after payday", short
	// enough that a forwarded screenshot of the code dies on its own.
	HandoffTTL = 14 * 24 * time.Hour

	// HandoffCooldown is the 1-handoff-per-device-per-30-days rule. It is computed
	// from the last row's "createdAt" (the deviceId index covers it), not from a
	// separate counter: the row IS the record of the last mint.
	HandoffCooldown = 30 * 24 * time.Hour

	// HandoffCodeLength is fixed at 6. A code is read aloud, typed from a
	// screenshot, and printed on a receipt — variable length would only invite
	// off-by-one transcriptions.
	HandoffCodeLength = 6
)

// HandoffCodeAlphabet is 32 symbols: digits 2–9 and A–Z without I and O.
// The exclusions are visual, not cryptographic (I/1, O/0 confusion when a buyer
// reads a code to a seller). 32 divides 256 exactly, so mapping a random byte
// with `% 32` is uniform — no rejection sampling needed and no modulo bias.
const HandoffCodeAlphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"

// Handoff statuses. The first is the only non-terminal one; "EXPIRED" is applied
// lazily and is also DERIVED on read (see handoffEffectiveStatus), so a client
// never sees "PENDING" for a code whose deadline passed.
const (
	HandoffStatusPending   = "PENDING"
	HandoffStatusClaimed   = "CLAIMED"
	HandoffStatusExpired   = "EXPIRED"
	HandoffStatusCancelled = "CANCELLED"
)

// handoffZone is the calendar the expiry-boundary arithmetic uses for the preview's
// per-warranty "status" (ACTIVE / EXPIRED). Vietnam has no DST, so a fixed offset
// is exact. It mirrors handlers.vietnamZone and the certificate's rule: an end
// date is inclusive through the end of the holder's Vietnamese day.
var handoffZone = time.FixedZone("ICT", 7*60*60)

// CreateHandoffInput is POST /api/v1/devices/{id}/handoff.
type CreateHandoffInput struct {
	// AttachmentIDs is the seller's EXPLICIT receipt selection. An omitted field
	// and an empty array both mean "no documents travel" — the seller must choose
	// what leaves their account, and a default cannot choose for them. Every id
	// must belong to the device; anything else is a 400 field error.
	AttachmentIDs []string `json:"attachmentIds"`
}

// Handoff is the OWNER-facing status projection. It never carries "code" or
// "claimPath": the code is shown exactly once, by POST, and only its sha256 digest
// survives — the same "list a link, never re-display the credential" rule as
// DeviceShare.Token.
type Handoff struct {
	ID        string  `json:"id"`
	DeviceID  string  `json:"deviceId"`
	Status    string  `json:"status"`
	CreatedAt string  `json:"createdAt"`
	ExpiresAt string  `json:"expiresAt"`
	ClaimedAt *string `json:"claimedAt,omitempty"`
}

// CreatedHandoff is Handoff plus the ONE-TIME code and the client-facing route.
//
// ClaimPath is "/handoff/<code>" — a path on the WEB app (the page that explains
// the handoff and sends the signed-in buyer to claim), NOT an API path. The
// server does not build an absolute URL because it does not know which host the
// caller reached it through.
type CreatedHandoff struct {
	ID        string `json:"id"`
	DeviceID  string `json:"deviceId"`
	Code      string `json:"code"`
	ClaimPath string `json:"claimPath"`
	Status    string `json:"status"`
	CreatedAt string `json:"createdAt"`
	ExpiresAt string `json:"expiresAt"`
}

// HandoffStatus is GET /api/v1/devices/{id}/handoff.
//
// NextAllowedAt is set only while the 30-day cooldown still blocks a new handoff
// (an instant, RFC 3339); it is omitted when a new one may be created now. The
// UI needs it to explain WHY the create button is disabled instead of letting the
// seller discover it through a 409.
type HandoffStatus struct {
	Handoff       *Handoff `json:"handoff"`
	NextAllowedAt *string  `json:"nextAllowedAt,omitempty"`
}

// HandoffClaimSummary is the handoff half of a successful claim.
type HandoffClaimSummary struct {
	ID        string `json:"id"`
	Status    string `json:"status"`
	ClaimedAt string `json:"claimedAt"`
}

// HandoffClaimResult is POST /api/v1/handoff/{code}/claim.
//
// Device is the SAME DeviceDetail payload GET /api/v1/devices/{id} returns
// (device + warranties + attachments + claims), so the buyer's client does not
// need a second round trip and cannot disagree with a later read.
type HandoffClaimResult struct {
	Handoff HandoffClaimSummary `json:"handoff"`
	Device  *DeviceDetail       `json:"device"`
}

// HandoffPreview is the complete projection GET /api/v1/public/handoff/{code}
// exposes to an unauthenticated reader.
//
// Everything absent is absent on purpose, and it is absent from the SQL
// projection as well (see queries/handoff.sql::GetHandoffByCodeHash): the
// seller's user id and email, the device id, purchasePrice/soldPrice,
// Device.notes, Warranty.cost/notes, attachment ids and storage paths, and the
// full serial number. The serial is MASKED — a buyer can compare the shape with
// the sticker and the full value arrives only in their own claimed Device.
type HandoffPreview struct {
	Code       string                   `json:"code"`
	Status     string                   `json:"status"`
	ExpiresAt  string                   `json:"expiresAt"`
	SellerName *string                  `json:"sellerName,omitempty"`
	Device     HandoffPreviewDevice     `json:"device"`
	Warranties []HandoffPreviewWarranty `json:"warranties"`
	// Attachments is metadata for the SELECTED receipts only: no id, no bytes, no
	// storage path. The files become downloadable after the claim, through the
	// authenticated /api/files/{id} route.
	Attachments []HandoffPreviewAttachment `json:"attachments"`
	Claims      []HandoffPreviewClaim      `json:"claims"`
	// Disclaimer is the required honesty copy on a public artifact: the app moves
	// DATA, it is not a legal document. It is rendered in the request's language
	// (the public preview's recipient never chose one — see the handler's language
	// rule), because the alternative is a buyer forwarding the raw JSON and a
	// stranger reading the seller's source language.
	Disclaimer string `json:"disclaimer"`
}

// HandoffPreviewDevice is the safe device projection: name/brand/model/category,
// the purchase date and a MASKED serial. Deliberately not the device id (it would
// let a reader correlate the offer with another endpoint) and not the purchase
// place (it is the seller's usual shop, not a fact the buyer needs before
// claiming).
type HandoffPreviewDevice struct {
	Name         string   `json:"name"`
	Brand        *string  `json:"brand"`
	Model        *string  `json:"model"`
	Category     string   `json:"category"`
	PurchaseDate wire.Day `json:"purchaseDate"`
	SerialMasked *string  `json:"serialMasked"`
}

// HandoffPreviewWarranty is one package as the buyer sees it before claiming.
// Status is DERIVED (ACTIVE / EXPIRED) from endDate against the Vietnamese
// calendar day, never stored, so it cannot go stale.
type HandoffPreviewWarranty struct {
	Type      string   `json:"type"`
	StartDate wire.Day `json:"startDate"`
	EndDate   wire.Day `json:"endDate"`
	Provider  *string  `json:"provider"`
	Status    string   `json:"status"`
}

// HandoffPreviewAttachment is metadata only — no id, no bytes, no storage path.
// The file itself is reachable only after the claim, through the authenticated
// /api/files/{id} route.
type HandoffPreviewAttachment struct {
	FileName  string `json:"fileName"`
	MimeType  string `json:"mimeType"`
	SizeBytes int32  `json:"sizeBytes"`
}

// HandoffPreviewClaim is the repair history summary the buyer inherits. The
// issue/diagnosis text is not published before the claim.
type HandoffPreviewClaim struct {
	Status            string  `json:"status"`
	OpenedAt          string  `json:"openedAt"`
	ClosedAt          *string `json:"closedAt"`
	CoveredByWarranty *bool   `json:"coveredByWarranty"`
}

// HandoffDisclaimer is the Vietnamese source text AND the catalog key for the
// public artifact's honesty sentence. The constant keeps the Vietnamese sentence
// because the constant IS the sentence; the language it is RENDERED in is decided
// per request (see the handler), the same split as SharedCertificateDisclaimer.
const HandoffDisclaimer = "App chỉ chuyển dữ liệu, không phải giấy tờ pháp lý. " +
	"Phiếu bàn giao không thay thế hoá đơn, hợp đồng hay giấy tờ sở hữu; " +
	"hãy kiểm tra số máy và tình trạng thiết bị trước khi nhận."

// handoffSharedFields is the audit snapshot stored in "DeviceHandoff"."sharedFields".
//
// It records WHAT the seller offered when the code was minted: the scalar facts
// the buyer previewed and the ids of the rows the code may copy. It never carries
// a price or a note — its job is to prove what was shared, so it must not become a
// second copy of what must not be shared.
//
// The claim uses AttachmentIDs as SELECTION (a receipt added after minting does
// not silently travel) and otherwise copies the current rows (a typo the seller
// fixed after minting does travel). ClaimIDs and WarrantyIDs are audit only.
type handoffSharedFields struct {
	DeviceName    string   `json:"deviceName"`
	Category      string   `json:"category"`
	Brand         *string  `json:"brand,omitempty"`
	Model         *string  `json:"model,omitempty"`
	HasSerial     bool     `json:"hasSerial"`
	PurchaseDate  string   `json:"purchaseDate"`
	PurchasePlace *string  `json:"purchasePlace,omitempty"`
	DeviceStatus  string   `json:"deviceStatus"`
	WarrantyIDs   []string `json:"warrantyIds"`
	AttachmentIDs []string `json:"attachmentIds"`
	ClaimIDs      []string `json:"claimIds"`
}

// ---- create ----------------------------------------------------------------

// CreateDeviceHandoff mints a code for one device the caller owns.
//
// Rules, in the order the errors are produced:
//   - the device must be the caller's (404 otherwise, same as every device read);
//   - a SOLD or LOST device cannot be handed off (409): the record is history or
//     the device is gone, and the buyer would receive a row that says so;
//   - there must be no OPEN handoff (409) — cancelling is a deliberate act, not
//     something a second POST silently does;
//   - the previous handoff for this device must be at least 30 days old (409
//     LIMIT_REACHED naming the date) — one offer per device per month.
func CreateDeviceHandoff(ctx context.Context, db *pgxpool.Pool, userID, deviceID, clientIP string, in CreateHandoffInput) (*CreatedHandoff, error) {
	if !isSafeID(deviceID) {
		return nil, ErrNotFound(i18n.Text(ctx, "Không tìm thấy thiết bị"))
	}
	q := store.New(db)

	device, err := q.GetDeviceByID(ctx, store.GetDeviceByIDParams{ID: deviceID, UserId: userID})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound(i18n.Text(ctx, "Không tìm thấy thiết bị"))
		}
		return nil, fmt.Errorf("get device: %w", err)
	}
	if device.Status == "SOLD" || device.Status == "LOST" {
		return nil, ErrConflict(i18n.Text(ctx,
			"Thiết bị đã bán hoặc đã mất, không thể tạo phiếu bàn giao"))
	}

	now := time.Now().UTC()
	latest, err := q.GetHandoffForDevice(ctx, store.GetHandoffForDeviceParams{
		DeviceId: deviceID,
		UserId:   userID,
	})
	switch {
	case err == nil:
		if latest.Status == HandoffStatusPending &&
			latest.ExpiresAt.Valid && latest.ExpiresAt.Time.After(now) {
			return nil, ErrConflict(i18n.Text(ctx,
				"Thiết bị đang có một phiếu bàn giao chưa dùng. Huỷ phiếu cũ rồi thử lại."))
		}
		if latest.CreatedAt.Valid {
			next := latest.CreatedAt.Time.Add(HandoffCooldown)
			if next.After(now) {
				// The date is rendered in the request's language: "từ 12/12/2026"
				// vs "from 12/12/2026" — the two formats disagree about which
				// number is the month, and this sentence is the only place the
				// seller learns when the button works again.
				return nil, ErrLimit(i18n.T(ctx,
					"Thiết bị này đã tạo phiếu bàn giao trong 30 ngày qua. Có thể tạo lại từ %s.",
					i18n.FormatDate(i18n.From(ctx), next)))
			}
		}
	case errors.Is(err, pgx.ErrNoRows):
		// First handoff for this device.
	default:
		return nil, fmt.Errorf("get latest handoff: %w", err)
	}

	selected, err := selectHandoffAttachments(ctx, q, userID, deviceID, in.AttachmentIDs)
	if err != nil {
		return nil, err
	}

	// Snapshot the ids that define what the code may copy. Two extra reads on a
	// once-per-month action; in exchange, the offer is self-describing after the
	// device is edited or the code is claimed.
	warranties, err := q.ListWarrantiesByDevice(ctx, store.ListWarrantiesByDeviceParams{
		DeviceId: deviceID,
		UserId:   userID,
	})
	if err != nil {
		return nil, fmt.Errorf("list warranties: %w", err)
	}
	claims, err := q.ListClaimsByDevice(ctx, store.ListClaimsByDeviceParams{
		DeviceId: deviceID,
		UserId:   userID,
	})
	if err != nil {
		return nil, fmt.Errorf("list claims: %w", err)
	}
	snapshot := handoffSharedFields{
		DeviceName:    device.Name,
		Category:      device.Category,
		Brand:         device.Brand,
		Model:         device.Model,
		PurchaseDate:  device.PurchaseDate.String(),
		PurchasePlace: device.PurchasePlace,
		DeviceStatus:  device.Status,
		WarrantyIDs:   make([]string, 0, len(warranties)),
		AttachmentIDs: selected,
		ClaimIDs:      make([]string, 0, len(claims)),
	}
	if device.SerialNumber != nil && strings.TrimSpace(*device.SerialNumber) != "" {
		snapshot.HasSerial = true
	}
	for _, w := range warranties {
		snapshot.WarrantyIDs = append(snapshot.WarrantyIDs, w.ID)
	}
	for _, c := range claims {
		snapshot.ClaimIDs = append(snapshot.ClaimIDs, c.ID)
	}
	blob, err := json.Marshal(snapshot)
	if err != nil {
		return nil, fmt.Errorf("encode shared fields: %w", err)
	}

	var ipHash *string
	if h := handoffIPHash(clientIP); h != "" {
		ipHash = &h
	}
	expiresAt := now.Add(HandoffTTL)

	// A generator collision is astronomically unlikely (32^6 = 1,073,741,824) but
	// it is a REAL outcome of a random function, and the unique index is the only
	// thing that can detect it. Retry rather than fail the seller's request.
	for attempt := 0; attempt < 5; attempt++ {
		code, err := newHandoffCode()
		if err != nil {
			return nil, err
		}
		row, err := q.CreateDeviceHandoff(ctx, store.CreateDeviceHandoffParams{
			ID:            auth.NewID(),
			DeviceId:      deviceID,
			FromUserId:    userID,
			CodeHash:      auth.HashToken(code),
			SharedFields:  blob,
			ExpiresAt:     wire.At(expiresAt),
			RequestIpHash: ipHash,
		})
		if err != nil {
			if isHandoffCodeCollision(err) {
				continue
			}
			return nil, fmt.Errorf("create handoff: %w", err)
		}
		return &CreatedHandoff{
			ID:        row.ID,
			DeviceID:  row.DeviceId,
			Code:      code,
			ClaimPath: HandoffClaimPath(code),
			Status:    row.Status,
			CreatedAt: tsString(row.CreatedAt),
			ExpiresAt: tsString(row.ExpiresAt),
		}, nil
	}
	return nil, fmt.Errorf("create handoff: could not allocate a unique code")
}

// HandoffClaimPath is the WEB route a client should append to its own base URL.
// "/handoff/<code>" (not the API route) because the link is opened by a human who
// must read what a handoff is before signing in and claiming.
func HandoffClaimPath(code string) string {
	return "/handoff/" + code
}

// selectHandoffAttachments validates the seller's explicit selection against the
// device's own attachments and returns it de-duplicated in input order.
//
// An empty selection is valid and means "no documents travel". Each id must name
// an attachment of THIS device owned by THIS user: a client that sends a stale or
// foreign id gets a field error rather than a silently smaller handoff.
func selectHandoffAttachments(ctx context.Context, q *store.Queries, userID, deviceID string, ids []string) ([]string, error) {
	out := make([]string, 0, len(ids))
	if len(ids) == 0 {
		return out, nil
	}
	owned, err := q.ListAttachmentsByDevice(ctx, store.ListAttachmentsByDeviceParams{
		DeviceId: &deviceID,
		UserId:   userID,
	})
	if err != nil {
		return nil, fmt.Errorf("list attachments: %w", err)
	}
	byID := make(map[string]struct{}, len(owned))
	for _, a := range owned {
		byID[a.ID] = struct{}{}
	}
	seen := make(map[string]struct{}, len(ids))
	for _, id := range ids {
		id = strings.TrimSpace(id)
		if id == "" || !isSafeID(id) {
			return nil, handoffAttachmentFieldError(ctx)
		}
		if _, ok := byID[id]; !ok {
			return nil, handoffAttachmentFieldError(ctx)
		}
		if _, dup := seen[id]; dup {
			continue
		}
		seen[id] = struct{}{}
		out = append(out, id)
	}
	// The per-device attachment ceiling is what bounds this in practice (a device
	// can never own more than MaxAttachmentsPerDevice), but a caller cannot know
	// that and the check keeps the rule explicit if the ceiling ever moves.
	if len(out) > MaxAttachmentsPerDevice {
		key := "Chỉ được chọn tối đa %d tệp đính kèm"
		return nil, ErrValidationKeyed(key, FieldErrors{
			"attachmentIds": {i18n.T(ctx, key, MaxAttachmentsPerDevice)},
		})
	}
	return out, nil
}

func handoffAttachmentFieldError(ctx context.Context) error {
	msg := i18n.Text(ctx, "Tệp đính kèm không thuộc thiết bị này")
	return ErrValidationHeadline(FieldErrors{"attachmentIds": {msg}})
}

// ---- owner status / cancel -------------------------------------------------

// GetDeviceHandoff returns the latest handoff of a device the caller owns, with
// the 30-day cooldown hint.
//
// A device with no handoff is NOT a 404: it is `{handoff: null}`, which is what a
// device screen renders as "chưa bàn giao". A foreign device is a 404, because the
// caller has no business knowing whether it exists.
func GetDeviceHandoff(ctx context.Context, db *pgxpool.Pool, userID, deviceID string) (*HandoffStatus, error) {
	if !isSafeID(deviceID) {
		return nil, ErrNotFound(i18n.Text(ctx, "Không tìm thấy thiết bị"))
	}
	q := store.New(db)
	if _, err := q.GetDeviceByID(ctx, store.GetDeviceByIDParams{ID: deviceID, UserId: userID}); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound(i18n.Text(ctx, "Không tìm thấy thiết bị"))
		}
		return nil, fmt.Errorf("get device: %w", err)
	}
	row, err := q.GetHandoffForDevice(ctx, store.GetHandoffForDeviceParams{
		DeviceId: deviceID,
		UserId:   userID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return &HandoffStatus{Handoff: nil}, nil
		}
		return nil, fmt.Errorf("get handoff: %w", err)
	}
	now := time.Now().UTC()
	// Best-effort: keep the stored status honest when the owner looks at it. A
	// failure here must not cost the owner their status screen.
	if row.Status == HandoffStatusPending && handoffExpired(row.ExpiresAt, now) {
		_, _ = q.MarkHandoffExpired(ctx, store.MarkHandoffExpiredParams{
			ID:        row.ID,
			ExpiresAt: wire.At(now),
		})
		row.Status = HandoffStatusExpired
	}
	status := &HandoffStatus{
		Handoff: &Handoff{
			ID:        row.ID,
			DeviceID:  row.DeviceId,
			Status:    handoffEffectiveStatus(row, now),
			CreatedAt: tsString(row.CreatedAt),
			ExpiresAt: tsString(row.ExpiresAt),
			ClaimedAt: tsPtrString(row.ClaimedAt),
		},
	}
	if row.CreatedAt.Valid {
		next := row.CreatedAt.Time.Add(HandoffCooldown)
		if next.After(now) {
			s := next.UTC().Format(time.RFC3339)
			status.NextAllowedAt = &s
		}
	}
	return status, nil
}

// CancelDeviceHandoff cuts the open PENDING handoff of a device the caller owns.
//
// Idempotent for an already-CANCELLED row (nothing to do = success), a 404 when
// the device has no handoff at all, and a 409 once the code reached a terminal
// state the seller must not be able to rewrite (CLAIMED by a buyer, or EXPIRED).
func CancelDeviceHandoff(ctx context.Context, db *pgxpool.Pool, userID, deviceID string) error {
	if !isSafeID(deviceID) {
		return ErrNotFound(i18n.Text(ctx, "Không tìm thấy thiết bị"))
	}
	q := store.New(db)
	if _, err := q.GetDeviceByID(ctx, store.GetDeviceByIDParams{ID: deviceID, UserId: userID}); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound(i18n.Text(ctx, "Không tìm thấy thiết bị"))
		}
		return fmt.Errorf("get device: %w", err)
	}
	row, err := q.GetHandoffForDevice(ctx, store.GetHandoffForDeviceParams{
		DeviceId: deviceID,
		UserId:   userID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound(i18n.Text(ctx, "Không tìm thấy phiếu bàn giao"))
		}
		return fmt.Errorf("get handoff: %w", err)
	}
	now := time.Now().UTC()
	switch row.Status {
	case HandoffStatusCancelled:
		// A second DELETE is a success: the seller's intent ("this code must not
		// work") is already true.
		return nil
	case HandoffStatusClaimed:
		return ErrConflict(i18n.Text(ctx,
			"Phiếu bàn giao đã được người mua nhận, không thể huỷ"))
	case HandoffStatusExpired, HandoffStatusPending:
		if row.Status == HandoffStatusExpired || handoffExpired(row.ExpiresAt, now) {
			return ErrConflict(i18n.Text(ctx, "Phiếu bàn giao đã hết hạn, không thể huỷ"))
		}
	default:
		return ErrConflict(i18n.Text(ctx, "Không thể huỷ phiếu bàn giao ở trạng thái này"))
	}

	// Ownership and PENDING are both in the WHERE clause, so a concurrent claim
	// wins cleanly (0 rows) instead of being overwritten.
	rows, err := q.CancelHandoff(ctx, store.CancelHandoffParams{ID: row.ID, UserId: userID})
	if err != nil {
		return fmt.Errorf("cancel handoff: %w", err)
	}
	if rows == 0 {
		// The row changed between the read and the update: the only transition
		// that can do that is a claim (or an expiry sweep).
		return ErrConflict(i18n.Text(ctx,
			"Phiếu bàn giao đã được người mua nhận, không thể huỷ"))
	}
	return nil
}

// ---- public preview --------------------------------------------------------

// PreviewHandoff resolves a code into the buyer's pre-claim projection.
//
// EVERY unusable code — unknown, expired, cancelled, already claimed, or a
// handoff whose device was deleted — returns the SAME ErrNotFound, so this
// unauthenticated route is not an enumeration oracle. The caller renders one
// indistinguishable 404. (The CLAIM path is allowed to be more precise — 410 for a
// dead code, 409 for one somebody else used — because a signed-in buyer holding a
// real code needs to know whether to ask for a new one; that distinction is
// documented on the claim endpoint.)
func PreviewHandoff(ctx context.Context, db *pgxpool.Pool, code string) (*HandoffPreview, error) {
	code = normalizeHandoffCode(code)
	if !isHandoffCode(code) {
		return nil, ErrHandoffCodeNotFound()
	}
	q := store.New(db)
	row, err := q.GetHandoffByCodeHash(ctx, auth.HashToken(code))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrHandoffCodeNotFound()
		}
		return nil, fmt.Errorf("get handoff: %w", err)
	}
	now := time.Now().UTC()
	// One condition covers all four dead states on purpose: a single `if` is
	// easier to keep honest than four branches that must each return the same
	// error.
	if row.HandoffStatus != HandoffStatusPending || handoffExpired(row.HandoffExpiresAt, now) {
		return nil, ErrHandoffCodeNotFound()
	}
	sf, err := decodeHandoffSharedFields(row.HandoffSharedFields)
	if err != nil {
		return nil, fmt.Errorf("decode shared fields: %w", err)
	}

	out := &HandoffPreview{
		Code:      code,
		Status:    HandoffStatusPending,
		ExpiresAt: tsString(row.HandoffExpiresAt),
		// Rendered through `i18n.Text` rather than `i18n.T`: the sentence travels
		// as DATA (a named constant) and `go vet`'s printf analyzer rejects a
		// non-constant key for the variadic form. Same shape as the certificate.
		Disclaimer:  i18n.Text(ctx, HandoffDisclaimer),
		Warranties:  make([]HandoffPreviewWarranty, 0),
		Attachments: make([]HandoffPreviewAttachment, 0),
		Claims:      make([]HandoffPreviewClaim, 0),
	}
	out.Device = HandoffPreviewDevice{
		Name:         row.DeviceName,
		Brand:        row.DeviceBrand,
		Model:        row.DeviceModel,
		Category:     row.DeviceCategory,
		PurchaseDate: row.DevicePurchaseDate,
	}
	if row.DeviceSerialNumber != nil && strings.TrimSpace(*row.DeviceSerialNumber) != "" {
		masked := MaskSerial(*row.DeviceSerialNumber)
		out.Device.SerialMasked = &masked
	}
	out.SellerName = row.SellerName

	warranties, err := q.ListWarrantiesForHandoff(ctx, row.HandoffDeviceID)
	if err != nil {
		return nil, fmt.Errorf("list warranties: %w", err)
	}
	for _, w := range warranties {
		out.Warranties = append(out.Warranties, HandoffPreviewWarranty{
			Type:      w.Type,
			StartDate: w.StartDate,
			EndDate:   w.EndDate,
			Provider:  w.Provider,
			Status:    handoffWarrantyStatus(w.EndDate, now),
		})
	}

	if len(sf.AttachmentIDs) > 0 {
		atts, err := q.ListAttachmentsForHandoff(ctx, store.ListAttachmentsForHandoffParams{
			DeviceId:      &row.HandoffDeviceID,
			UserId:        row.SellerUserID,
			AttachmentIds: sf.AttachmentIDs,
		})
		if err != nil {
			return nil, fmt.Errorf("list attachments: %w", err)
		}
		for _, a := range atts {
			out.Attachments = append(out.Attachments, HandoffPreviewAttachment{
				FileName:  a.FileName,
				MimeType:  a.FileType,
				SizeBytes: a.FileSize,
			})
		}
	}

	claims, err := q.ListClaimsForHandoff(ctx, row.HandoffDeviceID)
	if err != nil {
		return nil, fmt.Errorf("list claims: %w", err)
	}
	for _, c := range claims {
		out.Claims = append(out.Claims, HandoffPreviewClaim{
			Status:            c.Status,
			OpenedAt:          tsString(c.OpenedAt),
			ClosedAt:          tsPtrString(c.ClosedAt),
			CoveredByWarranty: c.CoveredByWarranty,
		})
	}
	return out, nil
}

// ErrHandoffCodeNotFound is the ONE answer every unusable public code produces.
//
// The sentence names the three things the holder cannot distinguish (unknown,
// expired, already used) because the alternative — telling them which — is what
// makes a 30-bit code enumerable. Kept context-free for the same reason as
// ErrShareNotFound: the handler picks the language once, at the request edge, and
// applies it to every case identically.
func ErrHandoffCodeNotFound() *Error {
	return ErrNotFoundKeyed("Mã bàn giao không tồn tại, đã hết hạn hoặc đã được sử dụng")
}

// ---- claim -----------------------------------------------------------------

// ClaimHandoff transfers the device record into the caller's account, exactly
// once.
//
// Outcomes, and why each one is distinct:
//   - PENDING + valid + caller is not the seller → copy everything and flip the
//     handoff to CLAIMED inside ONE transaction;
//   - CLAIMED by THIS caller → 200 with the device they already received, so a
//     retried request (a dropped connection, a double tap) is not an error. The
//     copy is never performed twice: the row is no longer PENDING;
//   - CLAIMED by somebody else → 409: the code is single-use and the buyer must be
//     told, not shown an empty success;
//   - CANCELLED/EXPIRED → 410: nothing moved and nothing will;
//   - unknown → 404;
//   - the seller → 403: a handoff is a transfer, not a re-import;
//   - the seller's device became SOLD/LOST after minting → 409. The record no
//     longer describes a device that is available, and silently copying it would
//     hand the buyer a row that says it is gone.
//
// Quota: the buyer's ceilings are enforced through the SAME plan-aware predicate
// every other Device write uses (assertDeviceQuotaWithLimits), under the same
// per-user advisory lock, so a handoff cannot be used to slip past 50/500 or
// 200/2 000.
func ClaimHandoff(ctx context.Context, db *pgxpool.Pool, buyerID, code string) (*HandoffClaimResult, error) {
	code = normalizeHandoffCode(code)
	if !isHandoffCode(code) {
		return nil, ErrHandoffCodeNotFound()
	}

	// The plan is read before the transaction (it is a per-user, low-churn read)
	// and passed into the locked quota check below.
	plan, err := PlanFor(ctx, db, buyerID)
	if err != nil {
		return nil, err
	}

	q := store.New(db)
	tx, err := db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	tq := q.WithTx(tx)
	now := time.Now().UTC()

	// The row lock is what makes "single-use" true under concurrency: the second
	// claimer blocks here and then reads CLAIMED, instead of both reading PENDING.
	handoff, err := tq.LockHandoffByCodeHash(ctx, auth.HashToken(code))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrHandoffCodeNotFound()
		}
		return nil, fmt.Errorf("lock handoff: %w", err)
	}

	switch handoff.Status {
	case HandoffStatusClaimed:
		// A different caller gets 409: the code is single-use, and a buyer who
		// holds a used code needs to be told, not shown an empty success.
		if handoff.ClaimedByUserId == nil || *handoff.ClaimedByUserId != buyerID {
			return nil, ErrConflict(i18n.Text(ctx, "Mã bàn giao đã được người khác sử dụng"))
		}
		// The SAME buyer retrying: 200 with the device they already received, so a
		// dropped connection or a double tap is not an error. The copy is never
		// repeated — the row is no longer PENDING.
		if handoff.ClaimedDeviceId == nil {
			// They claimed this code and have since deleted the device. Nothing is
			// left to return, and the code stays dead: same answer as any other
			// unusable code.
			if err := tx.Commit(ctx); err != nil {
				return nil, fmt.Errorf("commit: %w", err)
			}
			return nil, ErrHandoffCodeNotFound()
		}
		claimedID := *handoff.ClaimedDeviceId
		claimedAt := tsString(handoff.ClaimedAt)
		if err := tx.Commit(ctx); err != nil {
			return nil, fmt.Errorf("commit: %w", err)
		}
		detail, derr := GetDevice(ctx, db, buyerID, claimedID)
		if derr != nil {
			if svc, ok := As(derr); ok && svc.Code == "NOT_FOUND" {
				return nil, ErrHandoffCodeNotFound()
			}
			return nil, derr
		}
		return &HandoffClaimResult{
			Handoff: HandoffClaimSummary{ID: handoff.ID, Status: HandoffStatusClaimed, ClaimedAt: claimedAt},
			Device:  detail,
		}, nil
	case HandoffStatusCancelled, HandoffStatusExpired:
		return nil, ErrGone(i18n.Text(ctx, "Mã bàn giao đã hết hạn hoặc đã bị huỷ"))
	}

	// PENDING from here on.
	if handoffExpired(handoff.ExpiresAt, now) {
		// Persist the transition so the seller's screen and the 30-day rule see the
		// truth. The claim itself moves nothing.
		if _, err := tq.MarkHandoffExpired(ctx, store.MarkHandoffExpiredParams{
			ID:        handoff.ID,
			ExpiresAt: wire.At(now),
		}); err != nil {
			return nil, fmt.Errorf("mark handoff expired: %w", err)
		}
		if err := tx.Commit(ctx); err != nil {
			return nil, fmt.Errorf("commit expiry: %w", err)
		}
		return nil, ErrGone(i18n.Text(ctx, "Mã bàn giao đã hết hạn hoặc đã bị huỷ"))
	}
	if handoff.FromUserId == buyerID {
		return nil, ErrForbidden(i18n.Text(ctx, "Bạn không thể nhận lại thiết bị của chính mình"))
	}

	// The source row is read with the seller's id that came OUT of the handoff
	// row — never with anything the caller sent. This is the IDOR defence.
	source, err := tq.GetDeviceByID(ctx, store.GetDeviceByIDParams{
		ID:     handoff.DeviceId,
		UserId: handoff.FromUserId,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrHandoffCodeNotFound()
		}
		return nil, fmt.Errorf("get source device: %w", err)
	}
	if source.Status == "SOLD" || source.Status == "LOST" {
		return nil, ErrConflict(i18n.Text(ctx,
			"Thiết bị không còn ở trạng thái có thể bàn giao"))
	}
	// The copied row keeps its category; a category removed from the catalog
	// would produce a Device no client can render, so the claim refuses with the
	// same CATEGORY_INVALID the create path uses.
	if err := assertCategoryExists(ctx, tq, source.Category); err != nil {
		return nil, err
	}

	if err := lockUserDeviceWrites(ctx, tx, buyerID); err != nil {
		return nil, err
	}
	if err := assertDeviceQuotaWithLimits(ctx, tq, buyerID,
		deviceActiveIncoming(source.Status), 1, plan); err != nil {
		return nil, err
	}

	seller, err := tq.GetUserByID(ctx, handoff.FromUserId)
	if err != nil {
		return nil, fmt.Errorf("get seller: %w", err)
	}

	sf, err := decodeHandoffSharedFields(handoff.SharedFields)
	if err != nil {
		return nil, fmt.Errorf("decode shared fields: %w", err)
	}

	// 1) The buyer's Device row. The INSERT ... SELECT is where the price/notes
	//    redaction lives (see queries/handoff.sql).
	newDevice, err := tq.CreateDeviceFromHandoff(ctx, store.CreateDeviceFromHandoffParams{
		ID:                auth.NewID(),
		UserId:            buyerID,
		HandoffReceivedAt: wire.At(now),
		HandoffSellerName: seller.Name,
		ID_2:              source.ID,
		UserId_2:          source.UserId,
	})
	if err != nil {
		return nil, fmt.Errorf("copy device: %w", err)
	}

	// 2) Warranty rows. Every row the seller had at claim time travels; the id map
	//    lets the copied claims keep pointing at the copied warranty.
	warranties, err := tq.ListWarrantiesByDevice(ctx, store.ListWarrantiesByDeviceParams{
		DeviceId: source.ID,
		UserId:   source.UserId,
	})
	if err != nil {
		return nil, fmt.Errorf("list warranties: %w", err)
	}
	warrantyIDMap := make(map[string]string, len(warranties))
	for _, w := range warranties {
		copied, err := tq.CopyWarrantyFromHandoff(ctx, store.CopyWarrantyFromHandoffParams{
			ID:         auth.NewID(),
			DeviceId:   newDevice.ID,
			ID_2:       w.ID,
			DeviceId_2: source.ID,
		})
		if err != nil {
			return nil, fmt.Errorf("copy warranty: %w", err)
		}
		warrantyIDMap[w.ID] = copied.ID
	}

	// 3) The SELECTED attachments. A row the seller deleted between minting and
	//    claiming is skipped, not an error: the rest of the handoff is still
	//    exactly what the buyer saw, and failing the whole claim would strand a
	//    live code over a file the seller no longer offers.
	for _, attID := range sf.AttachmentIDs {
		if !isSafeID(attID) {
			continue
		}
		_, err := tq.CopyAttachmentFromHandoff(ctx, store.CopyAttachmentFromHandoffParams{
			ID:         auth.NewID(),
			DeviceId:   &newDevice.ID,
			UserId:     buyerID,
			ID_2:       attID,
			DeviceId_2: &source.ID,
			UserId_2:   source.UserId,
		})
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("copy attachment: %w", err)
		}
	}

	// 4) The repair history. Claim.warrantyId is remapped; a claim that referenced
	//    a warranty the copy did not include is copied with a NULL link rather than
	//    a dangling id.
	claims, err := tq.ListClaimsByDevice(ctx, store.ListClaimsByDeviceParams{
		DeviceId: source.ID,
		UserId:   source.UserId,
	})
	if err != nil {
		return nil, fmt.Errorf("list claims: %w", err)
	}
	for _, c := range claims {
		var warrantyID *string
		if c.WarrantyId != nil {
			if mapped, ok := warrantyIDMap[*c.WarrantyId]; ok {
				warrantyID = &mapped
			}
		}
		if _, err := tq.CopyClaimFromHandoff(ctx, store.CopyClaimFromHandoffParams{
			ID:         auth.NewID(),
			DeviceId:   newDevice.ID,
			WarrantyId: warrantyID,
			ID_2:       c.ID,
			DeviceId_2: source.ID,
		}); err != nil {
			return nil, fmt.Errorf("copy claim: %w", err)
		}
	}

	// 5) The single-use gate, INSIDE the transaction. The status predicate makes a
	//    concurrent claim lose here even if it somehow passed the row lock.
	rows, err := tq.ClaimHandoff(ctx, store.ClaimHandoffParams{
		ID:              handoff.ID,
		ClaimedByUserId: &buyerID,
		ClaimedDeviceId: &newDevice.ID,
		ClaimedAt:       wire.At(now),
	})
	if err != nil {
		return nil, fmt.Errorf("claim handoff: %w", err)
	}
	if rows == 0 {
		return nil, ErrConflict(i18n.Text(ctx, "Mã bàn giao đã được người khác sử dụng"))
	}

	// 6) The seller keeps a SOLD row marked "đã chuyển". soldAt/soldPrice are NOT
	//    written: this is not a sale record and the app must not invent a price.
	if _, err := tq.MarkDeviceHandedOff(ctx, store.MarkDeviceHandedOffParams{
		ID:            source.ID,
		UserId:        source.UserId,
		HandoffSentAt: wire.At(now),
	}); err != nil {
		return nil, fmt.Errorf("mark device handed off: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit: %w", err)
	}

	// Read the buyer's copy through the ordinary detail query, so the claim
	// response is byte-for-byte the shape GET /devices/{id} returns.
	detail, err := GetDevice(ctx, db, buyerID, newDevice.ID)
	if err != nil {
		return nil, err
	}
	return &HandoffClaimResult{
		Handoff: HandoffClaimSummary{
			ID:        handoff.ID,
			Status:    HandoffStatusClaimed,
			ClaimedAt: tsString(wire.At(now)),
		},
		Device: detail,
	}, nil
}

// ---- helpers ---------------------------------------------------------------

// newHandoffCode returns a 6-symbol code from HandoffCodeAlphabet.
//
// crypto/rand is the only acceptable source: math/rand seeded by the clock would
// make codes predictable from a creation timestamp, and 30 bits of predictability
// is the whole budget.
func newHandoffCode() (string, error) {
	buf := make([]byte, HandoffCodeLength)
	if _, err := rand.Read(buf); err != nil {
		return "", fmt.Errorf("read random for handoff code: %w", err)
	}
	out := make([]byte, HandoffCodeLength)
	for i, b := range buf {
		// len(HandoffCodeAlphabet) is 32, which divides 256, so this is uniform.
		out[i] = HandoffCodeAlphabet[int(b)%len(HandoffCodeAlphabet)]
	}
	return string(out), nil
}

// normalizeHandoffCode makes the public input forgiving: "a7k2q9" and
// " A7K2Q9 " are the same code a human read off a screen. Anything else is left
// for isHandoffCode to reject.
func normalizeHandoffCode(code string) string {
	return strings.ToUpper(strings.TrimSpace(code))
}

// isHandoffCode reports whether s is exactly HandoffCodeLength symbols of the
// alphabet. Checked BEFORE any database access, so a malformed guess costs one
// comparison rather than a query.
func isHandoffCode(s string) bool {
	if len(s) != HandoffCodeLength {
		return false
	}
	for i := 0; i < len(s); i++ {
		if !strings.ContainsRune(HandoffCodeAlphabet, rune(s[i])) {
			return false
		}
	}
	return true
}

// handoffExpired is the deadline comparison used by every read and by the claim.
// A NULL/invalid deadline counts as expired: no code is valid forever, so the
// strict direction is the safe one.
func handoffExpired(expiresAt wire.Instant, now time.Time) bool {
	if !expiresAt.Valid {
		return true
	}
	return !expiresAt.Time.After(now)
}

// handoffEffectiveStatus folds the lazily-applied expiry into the stored status,
// so a PENDING row whose deadline passed never renders as still usable.
func handoffEffectiveStatus(row store.DeviceHandoff, now time.Time) string {
	if row.Status == HandoffStatusPending && handoffExpired(row.ExpiresAt, now) {
		return HandoffStatusExpired
	}
	return row.Status
}

// handoffWarrantyStatus derives the preview's ACTIVE / EXPIRED pill. A calendar
// end date is inclusive through the end of the Vietnamese day, the same boundary
// the handover certificate uses, so "hết hạn hôm nay" is not shown as expired at
// 00:00 ICT.
func handoffWarrantyStatus(end wire.Day, now time.Time) string {
	if !end.Valid {
		return HandoffStatusExpired
	}
	day := end.Time
	y, m, d := day.Date()
	endOfDay := time.Date(y, m, d, 23, 59, 59, 0, handoffZone)
	if now.Before(endOfDay) {
		return "ACTIVE"
	}
	return HandoffStatusExpired
}

// decodeHandoffSharedFields reads the jsonb snapshot written at mint time.
//
// A row with an empty/invalid blob is not fatal: the snapshot is an audit record
// and the device fields are read from the live rows anyway. An empty snapshot
// simply means "no selected attachments", i.e. only the device+warranties+claims
// travel.
func decodeHandoffSharedFields(raw []byte) (handoffSharedFields, error) {
	var sf handoffSharedFields
	if len(raw) == 0 {
		return sf, nil
	}
	if err := json.Unmarshal(raw, &sf); err != nil {
		return sf, err
	}
	if sf.AttachmentIDs == nil {
		sf.AttachmentIDs = []string{}
	}
	return sf, nil
}

// handoffIPHash stores sha256(IP), never the address itself. The hash is enough to
// correlate two abuse reports ("these 30 codes came from one caller") and not
// enough to keep a log of who was where.
func handoffIPHash(ip string) string {
	ip = strings.TrimSpace(ip)
	if ip == "" {
		return ""
	}
	sum := sha256.Sum256([]byte(ip))
	return hex.EncodeToString(sum[:])
}

// isHandoffCodeCollision reports a UNIQUE violation on "DeviceHandoff"."codeHash".
// The insert statement has exactly one unique index, so any 23505 on this statement
// is a code collision and is retried with a fresh code.
func isHandoffCodeCollision(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}
