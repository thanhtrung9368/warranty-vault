package services

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/thanhtrung9368/warranty-vault/api/internal/i18n"
	store "github.com/thanhtrung9368/warranty-vault/api/internal/store/gen"
	"github.com/thanhtrung9368/warranty-vault/api/internal/wire"
)

// Installment plan ("trả góp") — FEATURE_RESEARCH_2026-11 §6.5, migration 0031.
//
// # What this is, and what it deliberately is not
//
// This is the USER'S OWN declaration of a financing schedule: how much was paid
// up front, how many months, how much per month, when the first payment is due,
// the optional fees, and how many payments the user says they have made. It is
// NOT a bank ledger: the app never sees a transaction and the server never
// guesses whether a payment actually happened. That is why
//
//   - wave 1 has no reminder and no push (`notifiedDueAt`/`notifiedLeadDay` are
//     reserved columns, nothing writes them), and
//   - there is no `overdue` flag anywhere. A wrong "quá hạn" would be the most
//     trust-destroying error a money feature can make, and `paidCount` alone
//     cannot support it. `nextDueAt` states the schedule; the UI may say a date
//     is in the past, but the server does not call the user late.
//
// # The money basis
//
// `Device.purchasePrice` is the sticker price. What the device actually costs
// its owner is the instalment total:
//
//	totalCost = downPayment + months×monthlyAmount
//	          + fileFee + months×monthlyFee        (fees omitted when unknown)
//
// That total is the basis for cost-per-day, resale profit and the /stats
// rollup, and it is exported to clients as `ownershipCostVnd` (VND, converted
// through the device's LOCKED fxRate exactly like `purchasePriceVnd`) plus
// `installment.totalCost` in the device's own currency. Clients never re-do
// this arithmetic, so three clients cannot round it three ways.
//
// # Storage rules
//
// Amounts are in the DEVICE's currency (`Device.currency`). That is the reason
// `UpdateDevice` refuses a currency change while a plan exists: the stored
// amounts would silently change meaning. Details are not stored — total, paid,
// remaining and next-due are derived here on every read (migration 0031).

// Installment month bounds, straight from the contract (§6.5): "months 1-60".
const (
	MinInstallmentMonths = 1
	MaxInstallmentMonths = 60
)

// InstallmentInput is the PUT /api/v1/devices/{id}/installment body.
//
// It is deliberately NOT part of DeviceInput: the device PATCH replaces the
// whole device, and an older client (build 23 is in App Review) would erase the
// plan on every edit. A separate endpoint is the only writer.
type InstallmentInput struct {
	// DownPayment is what the user paid at signing, in the device's currency.
	// `0` is a real answer (a 0% down promotion); only negative is rejected.
	DownPayment int32 `json:"downPayment"`
	// Months is the number of monthly payments, 1..60. The plan completes when
	// paidCount reaches it.
	Months int32 `json:"months"`
	// MonthlyAmount is the scheduled payment per month, > 0.
	MonthlyAmount int32 `json:"monthlyAmount"`
	// FirstDueAt is the day the FIRST payment is due, `YYYY-MM-DD` (or an
	// RFC3339 instant, of which only the day is kept). A calendar day, not an
	// instant: the day a payment is due must not move with a timezone.
	FirstDueAt string `json:"firstDueAt"`
	// FileFee / MonthlyFee are optional. NULL means "the user did not say", not
	// zero — an unknown fee makes the derived total a LOWER BOUND, which
	// `InstallmentPlan.HasUnknownFees` reports so the UI can say so.
	FileFee    *int32 `json:"fileFee"`
	MonthlyFee *int32 `json:"monthlyFee"`
	// PaidCount is how many monthly payments the user has made, 0..Months.
	// Self-reported; the server never derives it.
	PaidCount int32 `json:"paidCount"`
	// Lender is who financed it ("Home Credit", "FPT Shop trả góp"...). Free
	// text, optional, ≤100 characters.
	Lender *string `json:"lender"`
}

// InstallmentPlan is the response shape: the stored row plus the derived
// numbers. Mirrors openapi `InstallmentPlan`.
//
// The embedded row is the contract's own field list. Every `…Amount`/`…Cost`
// field is money in the DEVICE's currency; the only VND figure is
// `DeviceVND.OwnershipCostVnd`, computed at the locked rate.
type InstallmentPlan struct {
	store.InstallmentPlan
	// TotalCost is what the device will have cost once every payment is made:
	// down payment + all monthly payments + any fees the user recorded. Money
	// in the device's currency. A lower bound when HasUnknownFees is true.
	TotalCost int64 `json:"totalCost"`
	// PaidAmount is the part of TotalCost already paid: the down payment and
	// file fee are paid at signing, plus PaidCount monthly payments. Equals
	// TotalCost when the plan is Complete.
	PaidAmount int64 `json:"paidAmount"`
	// RemainingAmount is TotalCost − PaidAmount: the money still owed under
	// this plan. `0` when complete.
	RemainingAmount int64 `json:"remainingAmount"`
	// NextDueAt is the day the next monthly payment is due: `firstDueAt` plus
	// PaidCount months, clamped to the last day of the target month (31 Jan +
	// 1 month = 28/29 Feb). `null` when the plan is complete — there is no next
	// payment to be late for.
	NextDueAt *wire.Day `json:"nextDueAt"`
	// Completed is PaidCount == Months. Not `>=`: the validator forbids
	// paidCount > months, and the CHECK constraint backs it up.
	Completed bool `json:"completed"`
	// HasUnknownFees is true when fileFee or monthlyFee is NULL: the user has
	// not told the app, so TotalCost (and therefore the ownership cost, the
	// remaining amount and the profit basis) is a LOWER BOUND, not a fact.
	HasUnknownFees bool `json:"hasUnknownFees"`
}

// newInstallmentPlan derives the response shape from a stored row. The single
// definition of every derived number — list, detail, create, update and backup
// all go through it, so no endpoint can answer differently.
func newInstallmentPlan(p store.InstallmentPlan) *InstallmentPlan {
	fileFee := int64(0)
	monthlyFee := int64(0)
	hasUnknownFees := p.FileFee == nil || p.MonthlyFee == nil
	if p.FileFee != nil {
		fileFee = int64(*p.FileFee)
	}
	if p.MonthlyFee != nil {
		monthlyFee = int64(*p.MonthlyFee)
	}

	months := int64(p.Months)
	monthlyAmount := int64(p.MonthlyAmount)
	downPayment := int64(p.DownPayment)
	paidCount := int64(p.PaidCount)

	total := downPayment + months*monthlyAmount + fileFee + months*monthlyFee
	// The money left in instalments, not the whole remaining cost: the down
	// payment and the file fee were paid at signing, so they are never "owed".
	remaining := (months - paidCount) * (monthlyAmount + monthlyFee)
	paid := total - remaining
	completed := paidCount >= months

	out := &InstallmentPlan{
		InstallmentPlan: p,
		TotalCost:       total,
		PaidAmount:      paid,
		RemainingAmount: remaining,
		Completed:       completed,
		HasUnknownFees:  hasUnknownFees,
	}
	if !completed {
		day := addMonthsClamped(p.FirstDueAt.Time, int(paidCount))
		out.NextDueAt = wire.Date(day).Ptr()
	}
	return out
}

// addMonthsClamped adds whole months to a day, clamping the day of month to the
// last day of the target month. 31 Jan + 1 month is 28 Feb (29 in a leap year),
// not 3 March — the rule every instalment schedule in Vietnam uses, and the
// reason this arithmetic lives in one place instead of in three clients.
func addMonthsClamped(day time.Time, months int) time.Time {
	y, m, d := day.UTC().Date()
	total := int(m) - 1 + months
	year := y + total/12
	month := time.Month(total%12 + 1)
	// Day 0 of the NEXT month is the last day of this one.
	last := time.Date(year, month+1, 0, 0, 0, 0, 0, time.UTC).Day()
	if d > last {
		d = last
	}
	return time.Date(year, month, d, 0, 0, 0, 0, time.UTC)
}

// ValidateInstallmentInput trims, normalises and validates the PUT body,
// returning the same `fieldErrors` shape every other write path uses. The
// messages are Vietnamese catalog keys wrapped in i18n.Text so the HTTP edge
// renders them in the request's language.
//
// The rules are the contract's (§6.5) plus the ones the derived money needs:
//   - months is 1..60 (0 would mean "no plan"; DELETE is how you remove one);
//   - monthlyAmount > 0 (a 0 payment is not a plan);
//   - paidCount is 0..months (paying ahead is fine, paying past the end is not);
//   - downPayment and any recorded fee are ≥ 0;
//   - firstDueAt is a required, readable day;
//   - lender is at most 100 characters.
func ValidateInstallmentInput(ctx context.Context, in *InstallmentInput) error {
	in.FirstDueAt = strings.TrimSpace(in.FirstDueAt)
	trimPtr(&in.Lender)

	fieldErrors := FieldErrors{}
	if in.Months < MinInstallmentMonths || in.Months > MaxInstallmentMonths {
		fieldErrors["months"] = []string{i18n.Text(ctx, "Số tháng phải từ 1 đến 60")}
	}
	if in.MonthlyAmount <= 0 {
		fieldErrors["monthlyAmount"] = []string{i18n.Text(ctx, "Số tiền mỗi tháng phải lớn hơn 0")}
	}
	if in.DownPayment < 0 {
		fieldErrors["downPayment"] = []string{i18n.Text(ctx, "Trả trước không hợp lệ")}
	}
	if in.FileFee != nil && *in.FileFee < 0 {
		fieldErrors["fileFee"] = []string{i18n.Text(ctx, "Phí hồ sơ không hợp lệ")}
	}
	if in.MonthlyFee != nil && *in.MonthlyFee < 0 {
		fieldErrors["monthlyFee"] = []string{i18n.Text(ctx, "Phí hàng tháng không hợp lệ")}
	}
	// paidCount is checked against months only when months itself is valid;
	// otherwise the user gets two messages for one mistake.
	if in.Months >= MinInstallmentMonths && in.Months <= MaxInstallmentMonths {
		if in.PaidCount < 0 || in.PaidCount > in.Months {
			fieldErrors["paidCount"] = []string{i18n.Text(ctx, "Số kỳ đã trả không hợp lệ")}
		}
	}
	if in.FirstDueAt == "" {
		fieldErrors["firstDueAt"] = []string{i18n.Text(ctx, "Ngày kỳ đầu bắt buộc")}
	} else if _, err := parseDate(in.FirstDueAt); err != nil {
		fieldErrors["firstDueAt"] = []string{i18n.Text(ctx, "Ngày kỳ đầu không hợp lệ")}
	}
	if in.Lender != nil && len([]rune(*in.Lender)) > 100 {
		fieldErrors["lender"] = []string{i18n.Text(ctx, "Nơi trả góp tối đa 100 ký tự")}
	}
	if len(fieldErrors) > 0 {
		return ErrValidationHeadline(fieldErrors)
	}
	return nil
}

// SetInstallmentPlan implements `PUT /api/v1/devices/{id}/installment`: an
// idempotent full replacement of the device's plan, returning the device read
// (which carries `installment` and `ownershipCostVnd`).
//
// Ownership is checked by the upsert's own SELECT: a device the caller does not
// own inserts nothing and the query returns no row, which is NOT_FOUND — the
// same answer a foreign device id gets everywhere else.
func SetInstallmentPlan(ctx context.Context, db *pgxpool.Pool, userID, deviceID string, in InstallmentInput) (*DeviceDetail, error) {
	if err := ValidateInstallmentInput(ctx, &in); err != nil {
		return nil, err
	}
	firstDue, err := parseDate(in.FirstDueAt)
	if err != nil {
		// Unreachable after validation; kept because parseDate is the single
		// definition of what a day is.
		return nil, ErrValidationHeadline(FieldErrors{
			"firstDueAt": {i18n.Text(ctx, "Ngày kỳ đầu không hợp lệ")},
		})
	}

	q := store.New(db)
	// Ownership first, in the same shape CreateClaim uses: the plan has no
	// userId column of its own (it is owned through the Device row), so this is
	// the one place a foreign device id can be told apart from a real one.
	if _, err := q.GetDeviceByID(ctx, store.GetDeviceByIDParams{ID: deviceID, UserId: userID}); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound(i18n.Text(ctx, "Không tìm thấy thiết bị"))
		}
		return nil, fmt.Errorf("get device: %w", err)
	}
	if _, err := q.UpsertInstallmentPlan(ctx, store.UpsertInstallmentPlanParams{
		DeviceId:      deviceID,
		DownPayment:   in.DownPayment,
		Months:        in.Months,
		MonthlyAmount: in.MonthlyAmount,
		FirstDueAt:    wire.Date(firstDue),
		FileFee:       in.FileFee,
		MonthlyFee:    in.MonthlyFee,
		PaidCount:     in.PaidCount,
		Lender:        in.Lender,
	}); err != nil {
		return nil, fmt.Errorf("upsert installment plan: %w", err)
	}

	return GetDevice(ctx, db, userID, deviceID)
}

// DeleteInstallmentPlan implements `DELETE /api/v1/devices/{id}/installment`.
//
// Idempotent: removing a device that has no plan is a success (the desired end
// state is reached either way), matching the contract. A device the caller does
// not own is still NOT_FOUND — the ownership check comes first, so this cannot
// be used to probe for other users' device ids.
func DeleteInstallmentPlan(ctx context.Context, db *pgxpool.Pool, userID, deviceID string) (*DeviceDetail, error) {
	q := store.New(db)
	if _, err := q.GetDeviceByID(ctx, store.GetDeviceByIDParams{ID: deviceID, UserId: userID}); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound(i18n.Text(ctx, "Không tìm thấy thiết bị"))
		}
		return nil, fmt.Errorf("get device: %w", err)
	}
	if _, err := q.DeleteInstallmentPlan(ctx, deviceID); err != nil {
		return nil, fmt.Errorf("delete installment plan: %w", err)
	}
	return GetDevice(ctx, db, userID, deviceID)
}

// installmentPlanForDevice loads one device's plan, mapping "no plan" to nil
// rather than an error. Used by the read paths that return a device payload.
func installmentPlanForDevice(ctx context.Context, q *store.Queries, userID, deviceID string) (*store.InstallmentPlan, error) {
	p, err := q.GetInstallmentPlanByDevice(ctx, store.GetInstallmentPlanByDeviceParams{
		DeviceId: deviceID,
		UserId:   userID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &p, nil
}

// installmentPlansByDevice indexes the plans of many devices in one query, the
// same shape ListDevices uses for warranties and attachments. Devices without a
// plan are simply absent from the map.
func installmentPlansByDevice(ctx context.Context, q *store.Queries, userID string, deviceIDs []string) (map[string]*store.InstallmentPlan, error) {
	out := map[string]*store.InstallmentPlan{}
	if len(deviceIDs) == 0 {
		return out, nil
	}
	rows, err := q.ListInstallmentPlansByDeviceIDs(ctx, store.ListInstallmentPlansByDeviceIDsParams{
		Column1: deviceIDs,
		UserId:  userID,
	})
	if err != nil {
		return nil, err
	}
	for i := range rows {
		out[rows[i].DeviceId] = &rows[i]
	}
	return out, nil
}

// ownershipCostVnd is the VND basis the money rollups must use: the
// instalment total when a plan exists, the sticker price otherwise.
//
// It is null in exactly the case the sticker price is null: a non-VND device
// with no usable locked rate. It is never faked, because at-par would treat
// $999 as 999 ₫ — the bug `purchasePriceVnd` exists to prevent.
func ownershipCostVnd(d store.Device, plan *InstallmentPlan) *int64 {
	if plan != nil {
		return vndValue64(plan.TotalCost, d.Currency, d.FxRate)
	}
	return vndValue(d.PurchasePrice, d.Currency, d.FxRate)
}
