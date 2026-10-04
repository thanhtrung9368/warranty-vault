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

// errBadInput (the pre-i18n local helper) is GONE, replaced by
// ErrBadInputKeyed in errors.go.
//
// It built `&Error{Code: "BAD_INPUT", Message: message, FieldErrors: …}` — an
// error with NO MessageKey, i.e. the shape the envelope writer sends verbatim.
// Every one of its three callers is a converted code path, so leaving a helper
// around that cannot be translated would have been a trap for the next person.
//
// What the replacement had to PRESERVE is the `bad_input` code: the three
// failures below have always answered `{"error":"bad_input"}`, and openapi.yaml
// documents that for this path. The obvious conversion — ErrValidationKeyed —
// keeps the 400 and the translation but renames the code to `validation`, which
// is a silent contract change no test would have caught.

// customCycleMessage is the "a custom cycle needs a day count" sentence. It is a
// named constant because it is the headline AND the `intervalDays` field error of
// two different failures (validation and a missing interval at renew time), and
// because a key must reach `i18n.Text` as DATA rather than as a literal at the
// call site (`go vet` rejects a non-constant key for the printf-shaped `T`).
const customCycleMessage = "Cần nhập số ngày khi chọn chu kỳ Tuỳ chỉnh"

// amountNotNegativeMessage / paymentDateRequiredMessage are single-field failures
// whose sentence IS the whole story, so they are named constants for the same
// reason as customCycleMessage: the key has to reach `i18n.Text` as DATA, and a
// single-field validation error names itself in the envelope headline
// (ErrValidationKeyed) rather than saying the generic "invalid input".
const (
	amountNotNegativeMessage   = "Số tiền phải ≥ 0"
	paymentDateRequiredMessage = "Ngày thanh toán bắt buộc"
)

// validateSubscriptionInput mirrors TS Zod + assertCustomCycleHasInterval.
// Returns a *services.Error for the handler to translate, or nil.
//
// i18n: every message below is the EXISTING Vietnamese literal wrapped in
// `i18n.Text(ctx, …)`; Vietnamese stays the original and only gains an English
// column in internal/i18n/catalog.go. Argument-free messages go through `Text`
// rather than `T` — the printf-shaped call is reserved for messages with verbs
// (`go vet` is the reason: it classifies `T` as a printf wrapper and rejects a
// computed key).
//
// The headline is ErrValidationHeadline, not the bare ErrValidation: this
// validator translated its fieldErrors, so the envelope's `message` has to move
// with them or the response is half English and half Vietnamese.
func validateSubscriptionInput(ctx context.Context, in SubscriptionInput) error {
	fieldErrs := FieldErrors{}

	name := strings.TrimSpace(in.Name)
	if name == "" {
		fieldErrs["name"] = []string{i18n.Text(ctx, "Tên gói bắt buộc")}
	} else if len([]rune(name)) > 200 {
		fieldErrs["name"] = []string{i18n.Text(ctx, "Tên gói tối đa 200 ký tự")}
	}

	if !IsValidBillingCycle(in.BillingCycle) {
		fieldErrs["billingCycle"] = []string{i18n.Text(ctx, "Chu kỳ không hợp lệ")}
	}

	if in.IntervalDays != nil {
		if *in.IntervalDays < 1 || *in.IntervalDays > 3650 {
			fieldErrs["intervalDays"] = []string{i18n.Text(ctx, "Số ngày phải từ 1 đến 3650")}
		}
	}

	if in.Price < 0 {
		fieldErrs["price"] = []string{i18n.Text(ctx, "Giá phải ≥ 0")}
	}

	if in.StartedAt.IsZero() {
		fieldErrs["startedAt"] = []string{i18n.Text(ctx, "Ngày bắt đầu bắt buộc")}
	}

	if in.Status != "" && !IsValidSubscriptionStatus(in.Status) {
		fieldErrs["status"] = []string{i18n.Text(ctx, "Trạng thái không hợp lệ")}
	}

	if len(fieldErrs) > 0 {
		return ErrValidationHeadline(fieldErrs)
	}

	if in.BillingCycle == BillingCycleCustom &&
		(in.IntervalDays == nil || *in.IntervalDays <= 0) {
		return ErrBadInputKeyed(customCycleMessage, FieldErrors{
			"intervalDays": {i18n.Text(ctx, customCycleMessage)},
		})
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
			return SubscriptionDetail{}, ErrNotFound(i18n.Text(ctx, "Không tìm thấy gói"))
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
	if err := validateSubscriptionInput(ctx, in); err != nil {
		return store.Subscription{}, err
	}

	q := store.New(db)
	count, err := q.CountSubscriptionsByUser(ctx, userID)
	if err != nil {
		return store.Subscription{}, fmt.Errorf("count subscriptions: %w", err)
	}
	if count >= MaxSubscriptionsPerUser {
		return store.Subscription{}, ErrLimit(subscriptionLimitMessage(ctx, MaxSubscriptionsPerUser))
	}

	var renewal time.Time
	if in.RenewalDate != nil && !in.RenewalDate.IsZero() {
		renewal = *in.RenewalDate
	} else {
		next, err := NextRenewalDate(in.StartedAt, in.BillingCycle, in.IntervalDays)
		if err != nil {
			return store.Subscription{}, ErrBadInputKeyed(customCycleMessage, FieldErrors{
				"intervalDays": {i18n.Text(ctx, customCycleMessage)},
			})
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
	if err := validateSubscriptionInput(ctx, in); err != nil {
		return store.Subscription{}, err
	}

	q := store.New(db)
	existing, err := q.GetSubscriptionByID(ctx, store.GetSubscriptionByIDParams{ID: id, UserId: userID})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return store.Subscription{}, ErrNotFound(i18n.Text(ctx, "Không tìm thấy gói"))
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
			return store.Subscription{}, ErrNotFound(i18n.Text(ctx, "Không tìm thấy gói"))
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
		return ErrNotFound(i18n.Text(ctx, "Không tìm thấy gói"))
	}
	return nil
}

// LogPayment appends a SubscriptionPayment row after verifying ownership.
func LogPayment(ctx context.Context, db *pgxpool.Pool, userID, subID string, amount int32, paidAt time.Time, note *string) (store.SubscriptionPayment, error) {
	if amount < 0 {
		return store.SubscriptionPayment{}, ErrValidationKeyed(
			amountNotNegativeMessage,
			FieldErrors{"amount": {i18n.Text(ctx, amountNotNegativeMessage)}},
		)
	}
	if paidAt.IsZero() {
		return store.SubscriptionPayment{}, ErrValidationKeyed(
			paymentDateRequiredMessage,
			FieldErrors{"paidAt": {i18n.Text(ctx, paymentDateRequiredMessage)}},
		)
	}

	q := store.New(db)
	if _, err := q.GetSubscriptionByID(ctx, store.GetSubscriptionByIDParams{
		ID: subID, UserId: userID,
	}); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return store.SubscriptionPayment{}, ErrNotFound(i18n.Text(ctx, "Không tìm thấy gói"))
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
			return store.Subscription{}, ErrNotFound(i18n.Text(ctx, "Không tìm thấy gói"))
		}
		return store.Subscription{}, fmt.Errorf("get subscription: %w", err)
	}
	if existing.BillingCycle == BillingCycleLifetime {
		return store.Subscription{}, ErrBadInputKeyed("Gói lifetime không có gia hạn", nil)
	}

	currentRenewal := existing.RenewalDate.Time
	next, err := NextRenewalDate(currentRenewal, existing.BillingCycle, existing.IntervalDays)
	if err != nil {
		// CUSTOM cycle without intervalDays — bad data, surface as validation.
		//
		// The headline is the SUBSCRIPTION-truthful sentence (there is no interval
		// to advance by) while the field error is the generic "enter a day count"
		// one the form shows next to the input. They are two different sentences on
		// purpose: "Gói chu kỳ Tuỳ chỉnh thiếu số ngày — không thể gia hạn" would be
		// a confusing thing to render under a form field.
		return store.Subscription{}, ErrBadInputKeyed(
			"Gói chu kỳ Tuỳ chỉnh thiếu số ngày — không thể gia hạn",
			FieldErrors{"intervalDays": {i18n.Text(ctx, customCycleMessage)}},
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

// subscriptionLimitPlural / subscriptionLimitSingular are the two forms of the
// subscription-ceiling refusal. A pair, not one key, because the count is what
// makes the singular singular: the singular template has no `%d` slot at all and
// is rendered with an EMPTY argument list, so the two forms can never be handed
// each other's arguments — which is the bug wave 0 produced
// (`... expires in 1 day%!(EXTRA int=7)`) and which
// internal/i18n/catalog_test.go::TestSingularPluralPairsAgreeOnVerbCounts now
// forbids. They are constants, not inline literals, because a computed key has to
// reach `i18n.Lookup` as DATA.
const (
	subscriptionLimitPlural   = "Đã đạt giới hạn %d gói. Xoá bớt rồi thử lại."
	subscriptionLimitSingular = "Đã đạt giới hạn 1 gói. Xoá bớt rồi thử lại."
)

// subscriptionLimitMessage renders the subscription-ceiling refusal in the
// language resolved for ctx.
//
// `n` is a parameter rather than the constant read from inside so the singular
// branch is reachable and testable without a 100-subscription fixture, and so the
// sentence states the ceiling it actually applied. A hard 100 is what the caller
// passes today; English still must not render "1 subscriptions" if that ever
// becomes 1.
func subscriptionLimitMessage(ctx context.Context, n int) string {
	return renderCount(i18n.From(ctx), n, subscriptionLimitPlural, subscriptionLimitSingular,
		[]any{n}, []any{})
}

// renderCount renders one of a singular/plural KEY PAIR, taking a separate
// argument list for each form.
//
// Local to this package and deliberately a mirror of internal/cron/run.go's
// helper of the same name — the cron's copy is unexported and the two packages do
// not import each other. The separation is not a convenience: the singular
// template genuinely takes fewer verbs, because the count is what makes it
// singular ("1 subscription" has no slot for a number). Feeding the plural's
// argument list to the singular template is what produced
// `... expires in 1 day%!(EXTRA int=7)` in wave 0.
//
// Both lists are passed on every call, so the caller states each form's arguments
// once and neither branch can drift from the other. The lookup and the
// interpolation are separate steps because `i18n.T` is printf-shaped — that is
// what keeps a hand-written `%` in a source string away from Sprintf — and `go
// vet` therefore rejects it for a key that arrives from a variable.
func renderCount(tag i18n.Tag, n int, pluralKey, singularKey string, pluralArgs, singularArgs []any) string {
	if n == 1 {
		return renderPluralKey(tag, singularKey, singularArgs...)
	}
	return renderPluralKey(tag, pluralKey, pluralArgs...)
}

// renderPluralKey looks up a computed key and fills in its arguments. An unknown
// key degrades to the key text itself, which IS the Vietnamese source sentence —
// exactly what i18n.Translate does.
func renderPluralKey(tag i18n.Tag, key string, args ...any) string {
	text, ok := i18n.Lookup(tag, key)
	if !ok {
		text = key
	}
	return i18n.Interpolate(text, args...)
}

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
