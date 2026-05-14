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
	store "github.com/thanhtrung9368/warranty-vault/api/internal/store/gen"
)

// MaxSubscriptionsPerUser mirrors website/src/lib/services/subscriptions.ts::MAX_SUBS_PER_USER.
const MaxSubscriptionsPerUser = 100

// SubscriptionInput is the parsed payload for create/update of a subscription.
// Mirrors `subscriptionInputSchema` in subscription-types.ts. All optional
// strings come in as *string; "" should already have been preprocessed to nil
// at the handler layer (matching TS `blankToNull`).
type SubscriptionInput struct {
	Name          string
	Category      *string
	Brand         *string
	Plan          *string
	BillingCycle  string
	IntervalDays  *int32
	Price         int32
	StartedAt     time.Time
	RenewalDate   *time.Time // optional; defaults to NextRenewalDate(StartedAt, ...)
	AutoRenew     bool
	Status        string // defaults to ACTIVE if empty
	AccountEmail  *string
	PaymentMethod *string
	ManageURL     *string
	CancelURL     *string
	Notes         *string
}

// PaymentInput is the parsed payload for logging a manual payment.
type PaymentInput struct {
	Amount int32
	PaidAt time.Time
	Note   *string
}

// SubscriptionDetail bundles a subscription with its payment history, mirroring
// what `GET /api/v1/subscriptions/[id]` returns in the TS app.
type SubscriptionDetail struct {
	Subscription store.Subscription
	Payments     []store.SubscriptionPayment
}

// errBadInput builds a BAD_INPUT domain error with optional field errors.
func errBadInput(message string, fieldErrors FieldErrors) *Error {
	return &Error{Code: "BAD_INPUT", Message: message, FieldErrors: fieldErrors}
}

// validateSubscriptionInput mirrors TS Zod + assertCustomCycleHasInterval.
// Returns a *services.Error for the handler to translate, or nil.
func validateSubscriptionInput(in SubscriptionInput) error {
	fieldErrs := FieldErrors{}

	name := strings.TrimSpace(in.Name)
	if name == "" {
		fieldErrs["name"] = []string{"Tên gói bắt buộc"}
	} else if len([]rune(name)) > 200 {
		fieldErrs["name"] = []string{"Tên gói tối đa 200 ký tự"}
	}

	if !IsValidBillingCycle(in.BillingCycle) {
		fieldErrs["billingCycle"] = []string{"Chu kỳ không hợp lệ"}
	}

	if in.IntervalDays != nil {
		if *in.IntervalDays < 1 || *in.IntervalDays > 3650 {
			fieldErrs["intervalDays"] = []string{"Số ngày phải từ 1 đến 3650"}
		}
	}

	if in.Price < 0 {
		fieldErrs["price"] = []string{"Giá phải ≥ 0"}
	}

	if in.StartedAt.IsZero() {
		fieldErrs["startedAt"] = []string{"Ngày bắt đầu bắt buộc"}
	}

	if in.Status != "" && !IsValidSubscriptionStatus(in.Status) {
		fieldErrs["status"] = []string{"Trạng thái không hợp lệ"}
	}

	if len(fieldErrs) > 0 {
		return ErrValidation(fieldErrs)
	}

	if in.BillingCycle == BillingCycleCustom &&
		(in.IntervalDays == nil || *in.IntervalDays <= 0) {
		return errBadInput(
			"Cần nhập số ngày khi chọn chu kỳ Tuỳ chỉnh",
			FieldErrors{"intervalDays": {"Cần nhập số ngày khi chọn chu kỳ Tuỳ chỉnh"}},
		)
	}

	return nil
}

// ListSubscriptions returns the user's subscriptions sorted by renewalDate ASC.
// Optional status filter narrows the result.
func ListSubscriptions(ctx context.Context, db *pgxpool.Pool, userID string, status *string) ([]store.Subscription, error) {
	q := store.New(db)
	var statusArg string
	if status != nil {
		statusArg = *status
	}
	rows, err := q.ListSubscriptionsByUser(ctx, store.ListSubscriptionsByUserParams{
		UserId:  userID,
		Column2: statusArg,
	})
	if err != nil {
		return nil, fmt.Errorf("list subscriptions: %w", err)
	}
	if rows == nil {
		rows = []store.Subscription{}
	}
	return rows, nil
}

// GetSubscription returns a single subscription bundled with its payment log.
func GetSubscription(ctx context.Context, db *pgxpool.Pool, userID, id string) (SubscriptionDetail, error) {
	q := store.New(db)
	sub, err := q.GetSubscriptionByID(ctx, store.GetSubscriptionByIDParams{ID: id, UserId: userID})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return SubscriptionDetail{}, ErrNotFound("Không tìm thấy gói")
		}
		return SubscriptionDetail{}, fmt.Errorf("get subscription: %w", err)
	}
	payments, err := q.ListPaymentsBySubscription(ctx, store.ListPaymentsBySubscriptionParams{
		SubscriptionId: id,
		UserId:         userID,
	})
	if err != nil {
		return SubscriptionDetail{}, fmt.Errorf("list payments: %w", err)
	}
	if payments == nil {
		payments = []store.SubscriptionPayment{}
	}
	return SubscriptionDetail{Subscription: sub, Payments: payments}, nil
}

// CreateSubscription inserts a new row after validating + checking the limit.
// If renewalDate is nil, it defaults to NextRenewalDate(startedAt, cycle, …).
func CreateSubscription(ctx context.Context, db *pgxpool.Pool, userID string, in SubscriptionInput) (store.Subscription, error) {
	if err := validateSubscriptionInput(in); err != nil {
		return store.Subscription{}, err
	}

	q := store.New(db)
	count, err := q.CountSubscriptionsByUser(ctx, userID)
	if err != nil {
		return store.Subscription{}, fmt.Errorf("count subscriptions: %w", err)
	}
	if count >= MaxSubscriptionsPerUser {
		return store.Subscription{}, ErrLimit(fmt.Sprintf(
			"Đã đạt giới hạn %d gói. Xoá bớt rồi thử lại.", MaxSubscriptionsPerUser))
	}

	var renewal time.Time
	if in.RenewalDate != nil && !in.RenewalDate.IsZero() {
		renewal = *in.RenewalDate
	} else {
		next, err := NextRenewalDate(in.StartedAt, in.BillingCycle, in.IntervalDays)
		if err != nil {
			return store.Subscription{}, errBadInput(
				"Cần nhập số ngày khi chọn chu kỳ Tuỳ chỉnh",
				FieldErrors{"intervalDays": {"Cần nhập số ngày khi chọn chu kỳ Tuỳ chỉnh"}},
			)
		}
		renewal = next
	}

	status := in.Status
	if status == "" {
		status = SubscriptionStatusActive
	}

	created, err := q.CreateSubscription(ctx, store.CreateSubscriptionParams{
		ID:            auth.NewID(),
		UserId:        userID,
		Name:          strings.TrimSpace(in.Name),
		Category:      trimToPtr(in.Category),
		Brand:         trimToPtr(in.Brand),
		Plan:          trimToPtr(in.Plan),
		BillingCycle:  in.BillingCycle,
		IntervalDays:  in.IntervalDays,
		Price:         in.Price,
		StartedAt:     subPgts(in.StartedAt),
		RenewalDate:   subPgts(renewal),
		AutoRenew:     in.AutoRenew,
		AccountEmail:  trimToPtr(in.AccountEmail),
		PaymentMethod: trimToPtr(in.PaymentMethod),
		ManageUrl:     trimToPtr(in.ManageURL),
		CancelUrl:     trimToPtr(in.CancelURL),
		Notes:         trimToPtr(in.Notes),
		Currency:      nil, // → SQL COALESCE → 'VND'
		Status:        &status,
	})
	if err != nil {
		return store.Subscription{}, fmt.Errorf("create subscription: %w", err)
	}
	return created, nil
}

// UpdateSubscription replaces the row's fields. Ownership is enforced by the
// SQL `WHERE userId = $2`. Missing renewalDate keeps the existing value.
func UpdateSubscription(ctx context.Context, db *pgxpool.Pool, userID, id string, in SubscriptionInput) (store.Subscription, error) {
	if err := validateSubscriptionInput(in); err != nil {
		return store.Subscription{}, err
	}

	q := store.New(db)
	existing, err := q.GetSubscriptionByID(ctx, store.GetSubscriptionByIDParams{ID: id, UserId: userID})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return store.Subscription{}, ErrNotFound("Không tìm thấy gói")
		}
		return store.Subscription{}, fmt.Errorf("get subscription: %w", err)
	}

	renewal := existing.RenewalDate
	if in.RenewalDate != nil && !in.RenewalDate.IsZero() {
		renewal = subPgts(*in.RenewalDate)
	}

	status := in.Status
	if status == "" {
		status = existing.Status
	}

	updated, err := q.UpdateSubscription(ctx, store.UpdateSubscriptionParams{
		ID:            id,
		UserId:        userID,
		Name:          strings.TrimSpace(in.Name),
		Category:      trimToPtr(in.Category),
		Brand:         trimToPtr(in.Brand),
		Plan:          trimToPtr(in.Plan),
		BillingCycle:  in.BillingCycle,
		IntervalDays:  in.IntervalDays,
		Price:         in.Price,
		Currency:      existing.Currency,
		StartedAt:     subPgts(in.StartedAt),
		RenewalDate:   renewal,
		AutoRenew:     in.AutoRenew,
		Status:        status,
		AccountEmail:  trimToPtr(in.AccountEmail),
		PaymentMethod: trimToPtr(in.PaymentMethod),
		ManageUrl:     trimToPtr(in.ManageURL),
		CancelUrl:     trimToPtr(in.CancelURL),
		Notes:         trimToPtr(in.Notes),
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return store.Subscription{}, ErrNotFound("Không tìm thấy gói")
		}
		return store.Subscription{}, fmt.Errorf("update subscription: %w", err)
	}
	return updated, nil
}

// DeleteSubscription removes a subscription owned by userID. Cascade in the
// schema also drops SubscriptionPayment rows.
func DeleteSubscription(ctx context.Context, db *pgxpool.Pool, userID, id string) error {
	q := store.New(db)
	rows, err := q.DeleteSubscription(ctx, store.DeleteSubscriptionParams{ID: id, UserId: userID})
	if err != nil {
		return fmt.Errorf("delete subscription: %w", err)
	}
	if rows == 0 {
		return ErrNotFound("Không tìm thấy gói")
	}
	return nil
}

// LogPayment appends a SubscriptionPayment row after verifying ownership.
func LogPayment(ctx context.Context, db *pgxpool.Pool, userID, subID string, amount int32, paidAt time.Time, note *string) (store.SubscriptionPayment, error) {
	if amount < 0 {
		return store.SubscriptionPayment{}, ErrValidation(FieldErrors{
			"amount": {"Số tiền phải ≥ 0"},
		})
	}
	if paidAt.IsZero() {
		return store.SubscriptionPayment{}, ErrValidation(FieldErrors{
			"paidAt": {"Ngày thanh toán bắt buộc"},
		})
	}

	q := store.New(db)
	if _, err := q.GetSubscriptionByID(ctx, store.GetSubscriptionByIDParams{
		ID: subID, UserId: userID,
	}); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return store.SubscriptionPayment{}, ErrNotFound("Không tìm thấy gói")
		}
		return store.SubscriptionPayment{}, fmt.Errorf("get subscription: %w", err)
	}

	noteCleaned := trimToPtr(note)
	created, err := q.CreateSubscriptionPayment(ctx, store.CreateSubscriptionPaymentParams{
		ID:             auth.NewID(),
		SubscriptionId: subID,
		Amount:         amount,
		PaidAt:         subPgts(paidAt),
		Note:           noteCleaned,
	})
	if err != nil {
		return store.SubscriptionPayment{}, fmt.Errorf("create payment: %w", err)
	}
	return created, nil
}

// Renew is the manual-renewal flow:
//  1. Ownership-check via GetSubscriptionByID
//  2. Reject LIFETIME (matches TS renewSubscriptionNow)
//  3. In a pgx.Tx: CreateSubscriptionPayment(amount=sub.price, paidAt=current renewalDate)
//     and AdvanceSubscriptionRenewal(renewalDate = NextRenewalDate(...)).
//  4. Status stays ACTIVE.
func Renew(ctx context.Context, db *pgxpool.Pool, userID, subID string) (store.Subscription, error) {
	q := store.New(db)
	existing, err := q.GetSubscriptionByID(ctx, store.GetSubscriptionByIDParams{
		ID: subID, UserId: userID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return store.Subscription{}, ErrNotFound("Không tìm thấy gói")
		}
		return store.Subscription{}, fmt.Errorf("get subscription: %w", err)
	}
	if existing.BillingCycle == BillingCycleLifetime {
		return store.Subscription{}, errBadInput("Gói lifetime không có gia hạn", nil)
	}

	currentRenewal := existing.RenewalDate.Time
	next, err := NextRenewalDate(currentRenewal, existing.BillingCycle, existing.IntervalDays)
	if err != nil {
		// CUSTOM cycle without intervalDays — bad data, surface as bad_input.
		return store.Subscription{}, errBadInput(
			"Gói chu kỳ Tuỳ chỉnh thiếu số ngày — không thể gia hạn",
			FieldErrors{"intervalDays": {"Cần nhập số ngày khi chọn chu kỳ Tuỳ chỉnh"}},
		)
	}

	tx, err := db.Begin(ctx)
	if err != nil {
		return store.Subscription{}, fmt.Errorf("begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	tq := store.New(tx)
	manualNote := "Gia hạn (manual)"
	if _, err := tq.CreateSubscriptionPayment(ctx, store.CreateSubscriptionPaymentParams{
		ID:             auth.NewID(),
		SubscriptionId: subID,
		Amount:         existing.Price,
		PaidAt:         existing.RenewalDate,
		Note:           &manualNote,
	}); err != nil {
		return store.Subscription{}, fmt.Errorf("create payment: %w", err)
	}

	updated, err := tq.AdvanceSubscriptionRenewal(ctx, store.AdvanceSubscriptionRenewalParams{
		ID:                    subID,
		RenewalDate:           subPgts(next),
		LastNotifiedRenewalAt: existing.LastNotifiedRenewalAt,
	})
	if err != nil {
		return store.Subscription{}, fmt.Errorf("advance renewal: %w", err)
	}

	// Manual renew always implies ACTIVE — flip back if the row had been
	// auto-expired by the cron.
	if updated.Status != SubscriptionStatusActive {
		updated, err = tq.SetSubscriptionStatus(ctx, store.SetSubscriptionStatusParams{
			ID:     subID,
			UserId: userID,
			Status: SubscriptionStatusActive,
		})
		if err != nil {
			return store.Subscription{}, fmt.Errorf("set status active: %w", err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return store.Subscription{}, fmt.Errorf("commit tx: %w", err)
	}
	return updated, nil
}

// ─── helpers ──────────────────────────────────────────────────────────────

// trimToPtr returns a *string with surrounding whitespace stripped, or nil if
// the result is empty / the input was already nil. Local to this file to
// avoid colliding with the in-place trimPtr helper in devices.go.
func trimToPtr(p *string) *string {
	if p == nil {
		return nil
	}
	v := strings.TrimSpace(*p)
	if v == "" {
		return nil
	}
	return &v
}

func subPgts(t time.Time) pgtype.Timestamp {
	if t.IsZero() {
		return pgtype.Timestamp{}
	}
	return pgtype.Timestamp{Time: t.UTC(), Valid: true}
}

// Compile-time check: tx satisfies the store DBTX interface used by Queries.
var _ store.DBTX = (pgx.Tx)(nil)
