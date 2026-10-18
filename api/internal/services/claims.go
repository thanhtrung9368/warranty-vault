// Package services / claims.go — warranty claims (migration 0021).
//
// A claim is the record of what happens to a device after it breaks: where it
// went, what the shop said, whether the warranty paid, and when it came back.
// It hangs off a Device (required) and optionally off one of that device's
// Warranty rows.
//
// # The rules, and where each one lives
//
//   - At most one claim in OPEN or IN_REPAIR per device. The AUTHORITY is the
//     partial unique index "Claim_one_open_per_device_idx" (migration 0021),
//     not this file. A count-then-insert check here would be a TOCTOU race: two
//     concurrent POSTs can both see "no open claim". This file keeps a friendly
//     pre-check (CountOtherOpenClaimsByDevice) so the common case answers a
//     translated 409 without a database-error round-trip, and maps SQLSTATE
//     23505 on that index to the SAME 409 LIMIT_REACHED as the race backstop.
//     The index also covers the backup importer and any future write path.
//
//   - "warrantyId" must belong to the same device. Enforced here, not by the
//     FK: a foreign-key constraint only knows the warranty exists, not that it
//     hangs off this device. A mismatch is 400 with fieldErrors.warrantyId.
//
//   - "closedAt" is server-managed. It is set when the status ENTERS
//     RESOLVED/REJECTED/CANCELLED and cleared when it moves back to OPEN or
//     IN_REPAIR. A client does not have to send it, and a value it does send is
//     ignored on the API write paths (the backup importer preserves the stored
//     value, because there a closedAt is history, not a request).
//
//   - Per-user cap: MAX_CLAIMS_PER_USER = 1000. See the constant.
//
// # Full replacement, with two deliberate exceptions
//
// PATCH replaces every editable field, like the other PATCH endpoints. The two
// fields that are HISTORY rather than settings keep their stored value when the
// request omits them:
//
//   - "openedAt" (omitted/empty on create = now; on update = keep the stored
//     opening date), and
//   - "status" (omitted on create = OPEN; on update = keep the stored status).
//
// Without those exceptions an older or partial client would silently rewrite
// when the device went to the shop or reopen/close a claim as a side effect of
// an unrelated edit. This mirrors the "claimsUsed omitted means keep" rule on
// WarrantyInput, and is documented in openapi.yaml. An explicit value always
// wins.
package services

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/thanhtrung9368/warranty-vault/api/internal/auth"
	"github.com/thanhtrung9368/warranty-vault/api/internal/i18n"
	store "github.com/thanhtrung9368/warranty-vault/api/internal/store/gen"
)

// MaxClaimsPerUser is the per-account claim ceiling.
//
// Why 1000: it is 2× MAX_DEVICES_TOTAL_PER_USER (500), which is the structural
// bound the prompt points at ("a claim is bounded by device count anyway"). A
// device can legitimately be repaired more than once over its life — screen,
// then battery, then a board — so "one claim per device" (500) would block a
// real user with a long-lived phone; 2 per stored device leaves room for that
// history while still keeping the table finite. It is deliberately in the same
// order of magnitude as the other per-user caps (500 devices, 100 subscriptions,
// 200 wishlist items) rather than an unbounded array. Enforced on the create
// path and on the backup import, the only two write paths into "Claim".
const MaxClaimsPerUser = 1000

// String bounds for the claim's free-text fields. These are RUNE counts, the
// same unit as every other user-typed cap in this package (a Vietnamese
// character is one character to the user).
//
//   - "issue" is what the user says is wrong. 1000 runes is a generous paragraph
//     (two or three sentences plus symptom detail) while still bounding the
//     payload; it is the one field that is REQUIRED, so the cap also bounds what
//     a single POST can store.
//   - "diagnosis" and "outcome" are the shop's words, not a document: 500 runes
//     each, the same paragraph budget as Warranty.scope/exclusions.
//   - "ticketNumber" is a reference printed on a receipt (100 runes) and
//     "serviceCenter" is a name/address line (200, the same as Warranty
//     component/region). Neither is a place to paste a contract.
//
// A scanned repair order belongs in an Attachment, not in a text column.
const (
	MaxClaimIssueRunes         = 1000
	MaxClaimDiagnosisRunes     = 500
	MaxClaimOutcomeRunes       = 500
	MaxClaimTicketNumberRunes  = 100
	MaxClaimServiceCenterRunes = 200
)

// Claim statuses. The first two are "at the shop" and share the single-open
// rule; the last three are terminal and are the statuses that carry closedAt.
const (
	ClaimStatusOpen      = "OPEN"
	ClaimStatusInRepair  = "IN_REPAIR"
	ClaimStatusResolved  = "RESOLVED"
	ClaimStatusRejected  = "REJECTED"
	ClaimStatusCancelled = "CANCELLED"
)

// ClaimOpenConflictMessage is the 409 body for the single-open rule. It is a
// named constant because it is both the user-facing text and its own catalog
// key (the catalog is keyed on the Vietnamese source string), and because the
// service builds it in two places: the pre-check and the unique-violation
// backstop. One string, one translation.
const ClaimOpenConflictMessage = "Thiết bị đã có yêu cầu bảo hành đang mở. Hãy đóng yêu cầu cũ trước khi tạo yêu cầu mới."

var validClaimStatuses = map[string]bool{
	ClaimStatusOpen:      true,
	ClaimStatusInRepair:  true,
	ClaimStatusResolved:  true,
	ClaimStatusRejected:  true,
	ClaimStatusCancelled: true,
}

var openClaimStatuses = map[string]bool{
	ClaimStatusOpen:     true,
	ClaimStatusInRepair: true,
}

var closedClaimStatuses = map[string]bool{
	ClaimStatusResolved:  true,
	ClaimStatusRejected:  true,
	ClaimStatusCancelled: true,
}

func isOpenClaimStatus(status string) bool   { return openClaimStatuses[status] }
func isClosedClaimStatus(status string) bool { return closedClaimStatuses[status] }

// ClaimInput is the POST/PATCH body.
//
// "closedAt" is accepted but ignored: it is in the frozen entity contract, so a
// client doing a full replacement may send it back, and rejecting the field
// would make a harmless round-trip a 400. The server resolves the column from
// the status transition (see resolveClaimClosedAt).
type ClaimInput struct {
	DeviceID          string  `json:"deviceId"`
	WarrantyID        *string `json:"warrantyId,omitempty"`
	Status            string  `json:"status,omitempty"`
	OpenedAt          *string `json:"openedAt,omitempty"`
	ExpectedReturnAt  *string `json:"expectedReturnAt,omitempty"`
	ClosedAt          *string `json:"closedAt,omitempty"`
	TicketNumber      *string `json:"ticketNumber,omitempty"`
	ServiceCenter     *string `json:"serviceCenter,omitempty"`
	Issue             string  `json:"issue"`
	Diagnosis         *string `json:"diagnosis,omitempty"`
	Outcome           *string `json:"outcome,omitempty"`
	Cost              *int32  `json:"cost,omitempty"`
	CoveredByWarranty *bool   `json:"coveredByWarranty,omitempty"`
}

// ClaimFilter is the GET /api/v1/claims filter. Empty strings mean "no filter";
// "ALL" is the sentinel the device list also accepts.
type ClaimFilter struct {
	DeviceID string
	Status   string
}

// normalizeClaimInput trims every string field and turns blank optional strings
// into nil, exactly like trimPtr elsewhere. Blank required fields stay "" so the
// validator below can name them (trimming "  " to nil would hide the field).
func normalizeClaimInput(in *ClaimInput) {
	in.DeviceID = strings.TrimSpace(in.DeviceID)
	in.Issue = strings.TrimSpace(in.Issue)
	in.Status = strings.TrimSpace(in.Status)
	trimPtr(&in.WarrantyID)
	trimPtr(&in.OpenedAt)
	trimPtr(&in.ExpectedReturnAt)
	trimPtr(&in.ClosedAt)
	trimPtr(&in.TicketNumber)
	trimPtr(&in.ServiceCenter)
	trimPtr(&in.Diagnosis)
	trimPtr(&in.Outcome)
}

// ValidateClaimInput validates the fields that can be checked without a
// database. It applies the create defaults (status → OPEN) so callers that just
// want to test validation see the same normalised input the create path uses.
//
// Timestamps are parsed by the write paths, not here, because parsing produces
// the same fieldErrors shape and the write paths need the parsed values anyway.
func ValidateClaimInput(ctx context.Context, in *ClaimInput) error {
	normalizeClaimInput(in)
	if in.Status == "" {
		in.Status = ClaimStatusOpen
	}
	return validateClaimFields(ctx, in)
}

func validateClaimFields(ctx context.Context, in *ClaimInput) error {
	fieldErrors := FieldErrors{}

	if in.DeviceID == "" {
		fieldErrors["deviceId"] = []string{i18n.Text(ctx, "Thiết bị bắt buộc")}
	}
	if in.Issue == "" {
		fieldErrors["issue"] = []string{i18n.Text(ctx, "Nội dung lỗi bắt buộc")}
	}
	if in.Status != "" && !validClaimStatuses[in.Status] {
		fieldErrors["status"] = []string{i18n.Text(ctx, "Trạng thái không hợp lệ")}
	}
	if in.Cost != nil && *in.Cost < 0 {
		fieldErrors["cost"] = []string{i18n.Text(ctx, "Chi phí không hợp lệ")}
	}
	if len([]rune(in.Issue)) > MaxClaimIssueRunes {
		fieldErrors["issue"] = []string{i18n.T(ctx,
			"Nội dung lỗi tối đa %d ký tự", MaxClaimIssueRunes)}
	}
	if in.Diagnosis != nil && len([]rune(*in.Diagnosis)) > MaxClaimDiagnosisRunes {
		fieldErrors["diagnosis"] = []string{i18n.T(ctx,
			"Chẩn đoán tối đa %d ký tự", MaxClaimDiagnosisRunes)}
	}
	if in.Outcome != nil && len([]rune(*in.Outcome)) > MaxClaimOutcomeRunes {
		fieldErrors["outcome"] = []string{i18n.T(ctx,
			"Kết quả tối đa %d ký tự", MaxClaimOutcomeRunes)}
	}
	if in.TicketNumber != nil && len([]rune(*in.TicketNumber)) > MaxClaimTicketNumberRunes {
		fieldErrors["ticketNumber"] = []string{i18n.T(ctx,
			"Mã phiếu tối đa %d ký tự", MaxClaimTicketNumberRunes)}
	}
	if in.ServiceCenter != nil && len([]rune(*in.ServiceCenter)) > MaxClaimServiceCenterRunes {
		fieldErrors["serviceCenter"] = []string{i18n.T(ctx,
			"Trung tâm bảo hành tối đa %d ký tự", MaxClaimServiceCenterRunes)}
	}

	if len(fieldErrors) > 0 {
		// The validator translated its fieldErrors, so the headline follows the
		// same language (see services/errors.go).
		return ErrValidationHeadline(fieldErrors)
	}
	return nil
}

// parseClaimOpenedAt resolves the required openedAt. A missing value is not an
// error: on create it means "the claim was opened now", on update it means
// "keep the stored opening date". `fallback` is the stored value on update and
// the zero time on create.
func parseClaimOpenedAt(ctx context.Context, raw *string, fallback time.Time) (pgtype.Timestamp, error) {
	if raw == nil {
		if !fallback.IsZero() {
			return pgtype.Timestamp{Time: fallback, Valid: true}, nil
		}
		return pgtype.Timestamp{Time: time.Now().UTC(), Valid: true}, nil
	}
	t, err := parseDate(*raw)
	if err != nil {
		return pgtype.Timestamp{}, ErrValidationHeadline(FieldErrors{
			"openedAt": {i18n.Text(ctx, "Ngày mở yêu cầu không hợp lệ")},
		})
	}
	return pgtype.Timestamp{Time: t, Valid: true}, nil
}

// parseClaimNullableTimestamp parses an optional date-time field. nil/blank →
// SQL NULL (the "not recorded" state). `field` is both the fieldErrors key and
// the message's subject, so the two can never drift.
func parseClaimNullableTimestamp(ctx context.Context, field, messageKey string, raw *string) (pgtype.Timestamp, error) {
	if raw == nil {
		return pgtype.Timestamp{}, nil
	}
	t, err := parseDate(*raw)
	if err != nil {
		return pgtype.Timestamp{}, ErrValidationHeadline(FieldErrors{
			field: {i18n.Text(ctx, messageKey)},
		})
	}
	return pgtype.Timestamp{Time: t, Valid: true}, nil
}

// resolveClaimClosedAt implements the automatic closedAt rule. `current` is nil
// on create.
//
//   - new status terminal:
//   - if the stored status was already terminal and the row has a closedAt, keep
//     it (the claim did not "become" closed again, so its resolution date must
//     not move);
//   - otherwise the claim is entering a terminal state now → NOW.
//   - new status open → NULL. This is the "cleared if it moves back" half.
func resolveClaimClosedAt(current *store.Claim, status string, now time.Time) pgtype.Timestamp {
	if !isClosedClaimStatus(status) {
		return pgtype.Timestamp{}
	}
	if current != nil && isClosedClaimStatus(current.Status) && current.ClosedAt.Valid {
		return current.ClosedAt
	}
	return pgtype.Timestamp{Time: now, Valid: true}
}

// GetClaim fetches one claim with the ownership chain. A claim owned by someone
// else matches no row and is a 404, never a 403.
func GetClaim(ctx context.Context, db *pgxpool.Pool, userID, id string) (store.Claim, error) {
	q := store.New(db)
	row, err := q.GetClaimByID(ctx, store.GetClaimByIDParams{ID: id, UserId: userID})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return store.Claim{}, ErrNotFound(i18n.Text(ctx, "Không tìm thấy yêu cầu bảo hành"))
		}
		return store.Claim{}, fmt.Errorf("get claim: %w", err)
	}
	return row, nil
}

// ListClaims returns the caller's claims newest-opened first. Filters mirror the
// device list: an empty value (or "ALL") means "no filter", and an unknown
// status simply matches nothing rather than erroring.
func ListClaims(ctx context.Context, db *pgxpool.Pool, userID string, f ClaimFilter) ([]store.Claim, error) {
	status := strings.TrimSpace(f.Status)
	if status == "ALL" {
		status = ""
	}
	deviceID := strings.TrimSpace(f.DeviceID)
	if deviceID == "ALL" {
		deviceID = ""
	}

	q := store.New(db)
	rows, err := q.ListClaimsByUser(ctx, store.ListClaimsByUserParams{
		UserId:   userID,
		DeviceId: deviceID,
		Status:   status,
	})
	if err != nil {
		return nil, fmt.Errorf("list claims: %w", err)
	}
	if rows == nil {
		rows = []store.Claim{}
	}
	return rows, nil
}

// CreateClaim records a new claim. See the file header for the rule split.
func CreateClaim(ctx context.Context, db *pgxpool.Pool, userID string, in ClaimInput) (store.Claim, error) {
	normalizeClaimInput(&in)
	if in.Status == "" {
		in.Status = ClaimStatusOpen
	}
	if err := validateClaimFields(ctx, &in); err != nil {
		return store.Claim{}, err
	}

	q := store.New(db)
	if _, err := q.GetDeviceByID(ctx, store.GetDeviceByIDParams{
		ID: in.DeviceID, UserId: userID,
	}); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return store.Claim{}, ErrNotFound(i18n.Text(ctx, "Không tìm thấy thiết bị"))
		}
		return store.Claim{}, fmt.Errorf("get device: %w", err)
	}
	warrantyID, err := resolveClaimWarranty(ctx, q, userID, in.DeviceID, in.WarrantyID)
	if err != nil {
		return store.Claim{}, err
	}

	count, err := q.CountClaimsByUser(ctx, userID)
	if err != nil {
		return store.Claim{}, fmt.Errorf("count claims: %w", err)
	}
	if count >= MaxClaimsPerUser {
		return store.Claim{}, ErrLimit(i18n.T(ctx,
			"Đã đạt giới hạn %d yêu cầu bảo hành.", MaxClaimsPerUser))
	}

	// Friendly pre-check; the partial unique index is the real authority (see
	// the header). It runs for BOTH open statuses because a phone can be moved
	// straight to IN_REPAIR.
	if isOpenClaimStatus(in.Status) {
		other, err := q.CountOtherOpenClaimsByDevice(ctx, store.CountOtherOpenClaimsByDeviceParams{
			DeviceId: in.DeviceID,
			ID:       "",
		})
		if err != nil {
			return store.Claim{}, fmt.Errorf("count open claims: %w", err)
		}
		if other > 0 {
			return store.Claim{}, ErrLimit(i18n.Text(ctx, ClaimOpenConflictMessage))
		}
	}

	now := time.Now().UTC()
	openedAt, err := parseClaimOpenedAt(ctx, in.OpenedAt, time.Time{})
	if err != nil {
		return store.Claim{}, err
	}
	expectedReturnAt, err := parseClaimNullableTimestamp(ctx, "expectedReturnAt",
		"Ngày trả dự kiến không hợp lệ", in.ExpectedReturnAt)
	if err != nil {
		return store.Claim{}, err
	}
	closedAt := resolveClaimClosedAt(nil, in.Status, now)

	row, err := q.CreateClaim(ctx, store.CreateClaimParams{
		ID:                auth.NewID(),
		DeviceId:          in.DeviceID,
		WarrantyId:        warrantyID,
		Status:            in.Status,
		OpenedAt:          openedAt,
		ExpectedReturnAt:  expectedReturnAt,
		ClosedAt:          closedAt,
		TicketNumber:      in.TicketNumber,
		ServiceCenter:     in.ServiceCenter,
		Issue:             in.Issue,
		Diagnosis:         in.Diagnosis,
		Outcome:           in.Outcome,
		Cost:              in.Cost,
		CoveredByWarranty: in.CoveredByWarranty,
	})
	if err != nil {
		if isClaimOpenUniqueViolation(err) {
			return store.Claim{}, ErrLimit(i18n.Text(ctx, ClaimOpenConflictMessage))
		}
		return store.Claim{}, fmt.Errorf("create claim: %w", err)
	}
	return row, nil
}

// UpdateClaim replaces a claim. The stored row is read first so "status /
// openedAt omitted means keep" can be applied against the state the write will
// actually produce (see the file header).
func UpdateClaim(ctx context.Context, db *pgxpool.Pool, userID, id string, in ClaimInput) (store.Claim, error) {
	q := store.New(db)

	current, err := q.GetClaimByID(ctx, store.GetClaimByIDParams{ID: id, UserId: userID})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return store.Claim{}, ErrNotFound(i18n.Text(ctx, "Không tìm thấy yêu cầu bảo hành"))
		}
		return store.Claim{}, fmt.Errorf("get claim: %w", err)
	}

	normalizeClaimInput(&in)
	if in.Status == "" {
		in.Status = current.Status
	}
	if err := validateClaimFields(ctx, &in); err != nil {
		return store.Claim{}, err
	}

	// The NEW device must belong to the caller. The UPDATE query separately
	// proves the OLD device does, so a claim cannot be moved out of the account.
	if _, err := q.GetDeviceByID(ctx, store.GetDeviceByIDParams{
		ID: in.DeviceID, UserId: userID,
	}); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return store.Claim{}, ErrNotFound(i18n.Text(ctx, "Không tìm thấy thiết bị"))
		}
		return store.Claim{}, fmt.Errorf("get device: %w", err)
	}
	warrantyID, err := resolveClaimWarranty(ctx, q, userID, in.DeviceID, in.WarrantyID)
	if err != nil {
		return store.Claim{}, err
	}

	// Re-check the single-open rule only when the row will be open. excludeId is
	// the row being updated: an open claim is not a conflict with itself.
	if isOpenClaimStatus(in.Status) {
		other, err := q.CountOtherOpenClaimsByDevice(ctx, store.CountOtherOpenClaimsByDeviceParams{
			DeviceId: in.DeviceID,
			ID:       id,
		})
		if err != nil {
			return store.Claim{}, fmt.Errorf("count open claims: %w", err)
		}
		if other > 0 {
			return store.Claim{}, ErrLimit(i18n.Text(ctx, ClaimOpenConflictMessage))
		}
	}

	var openedFallback time.Time
	if current.OpenedAt.Valid {
		openedFallback = current.OpenedAt.Time
	}
	openedAt, err := parseClaimOpenedAt(ctx, in.OpenedAt, openedFallback)
	if err != nil {
		return store.Claim{}, err
	}
	expectedReturnAt, err := parseClaimNullableTimestamp(ctx, "expectedReturnAt",
		"Ngày trả dự kiến không hợp lệ", in.ExpectedReturnAt)
	if err != nil {
		return store.Claim{}, err
	}
	closedAt := resolveClaimClosedAt(&current, in.Status, time.Now().UTC())

	row, err := q.UpdateClaim(ctx, store.UpdateClaimParams{
		ID:                id,
		UserId:            userID,
		DeviceId:          in.DeviceID,
		WarrantyId:        warrantyID,
		Status:            in.Status,
		OpenedAt:          openedAt,
		ExpectedReturnAt:  expectedReturnAt,
		ClosedAt:          closedAt,
		TicketNumber:      in.TicketNumber,
		ServiceCenter:     in.ServiceCenter,
		Issue:             in.Issue,
		Diagnosis:         in.Diagnosis,
		Outcome:           in.Outcome,
		Cost:              in.Cost,
		CoveredByWarranty: in.CoveredByWarranty,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return store.Claim{}, ErrNotFound(i18n.Text(ctx, "Không tìm thấy yêu cầu bảo hành"))
		}
		if isClaimOpenUniqueViolation(err) {
			return store.Claim{}, ErrLimit(i18n.Text(ctx, ClaimOpenConflictMessage))
		}
		return store.Claim{}, fmt.Errorf("update claim: %w", err)
	}
	return row, nil
}

// DeleteClaim removes a claim after enforcing the ownership chain.
func DeleteClaim(ctx context.Context, db *pgxpool.Pool, userID, id string) error {
	q := store.New(db)
	rows, err := q.DeleteClaim(ctx, store.DeleteClaimParams{ID: id, UserId: userID})
	if err != nil {
		return fmt.Errorf("delete claim: %w", err)
	}
	if rows == 0 {
		return ErrNotFound(i18n.Text(ctx, "Không tìm thấy yêu cầu bảo hành"))
	}
	return nil
}

// resolveClaimWarranty checks that the optional warranty belongs to the SAME
// device the claim is being attached to, and returns the value to store.
//
// A warranty that does not exist, belongs to another user, or belongs to another
// device of the SAME user is all the same 400 on fieldErrors.warrantyId. That is
// deliberate: a nonexistent id and a foreign id must not be distinguishable, and
// the contract names this as a field error rather than a 404.
func resolveClaimWarranty(ctx context.Context, q *store.Queries, userID, deviceID string, warrantyID *string) (*string, error) {
	if warrantyID == nil {
		return nil, nil
	}
	row, err := q.GetWarrantyByID(ctx, store.GetWarrantyByIDParams{
		ID:     *warrantyID,
		UserId: userID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrValidationHeadline(FieldErrors{
				"warrantyId": {i18n.Text(ctx, "Gói bảo hành không thuộc thiết bị này")},
			})
		}
		return nil, fmt.Errorf("get warranty: %w", err)
	}
	if row.DeviceId != deviceID {
		return nil, ErrValidationHeadline(FieldErrors{
			"warrantyId": {i18n.Text(ctx, "Gói bảo hành không thuộc thiết bị này")},
		})
	}
	return warrantyID, nil
}

// isClaimOpenUniqueViolation reports whether err is the partial unique index
// from migration 0021. Checking the constraint name (not just SQLSTATE 23505)
// keeps an unrelated unique violation — e.g. a generated id collision — from
// being reported to the user as "this device already has an open claim".
func isClaimOpenUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) &&
		pgErr.Code == "23505" &&
		pgErr.ConstraintName == "Claim_one_open_per_device_idx"
}
