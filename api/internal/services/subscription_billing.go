package services

import (
	"errors"
	"math"
	"time"
)

// Billing-cycle and status enums kept in lockstep with
// website/src/lib/subscription-types.ts.

// Valid billing cycles. Mirrors `BILLING_CYCLES` in TS.
const (
	BillingCycleMonthly   = "MONTHLY"
	BillingCycleQuarterly = "QUARTERLY"
	BillingCycleYearly    = "YEARLY"
	BillingCycleLifetime  = "LIFETIME"
	BillingCycleCustom    = "CUSTOM"
)

// Valid subscription statuses. Mirrors `SUBSCRIPTION_STATUSES`.
const (
	SubscriptionStatusActive   = "ACTIVE"
	SubscriptionStatusPaused   = "PAUSED"
	SubscriptionStatusCanceled = "CANCELED"
	SubscriptionStatusExpired  = "EXPIRED"
)

// IsValidBillingCycle reports whether cycle is one of the five accepted enum
// values.
func IsValidBillingCycle(cycle string) bool {
	switch cycle {
	case BillingCycleMonthly, BillingCycleQuarterly, BillingCycleYearly,
		BillingCycleLifetime, BillingCycleCustom:
		return true
	}
	return false
}

// IsValidSubscriptionStatus reports whether status is one of the four accepted
// enum values.
func IsValidSubscriptionStatus(status string) bool {
	switch status {
	case SubscriptionStatusActive, SubscriptionStatusPaused,
		SubscriptionStatusCanceled, SubscriptionStatusExpired:
		return true
	}
	return false
}

// ErrCustomCycleNeedsInterval is returned by NextRenewalDate when CUSTOM is
// requested without a positive intervalDays. Handlers translate this to a
// field error on `intervalDays`.
var ErrCustomCycleNeedsInterval = errors.New("CUSTOM billing cycle requires positive intervalDays")

// NextRenewalDate computes the next renewal date for a subscription billing
// cycle. Mirrors `nextRenewalDate` in website/src/lib/subscription-types.ts,
// adjusted per the Phase C plan:
//   - MONTHLY     -> +1 calendar month
//   - QUARTERLY   -> +3 calendar months
//   - YEARLY      -> +1 calendar year
//   - LIFETIME    -> returns current (lifetime never renews; callers should
//     not call this for LIFETIME, they get a no-op for safety)
//   - CUSTOM      -> +intervalDays days; error if intervalDays nil/<=0
//
// Date arithmetic uses `time.AddDate`, which handles month-end clamping the
// same way JavaScript's `Date.setMonth` does (Jan 31 + 1 month -> Mar 3 in JS,
// Mar 3 in Go too because both normalise the overflow day).
func NextRenewalDate(current time.Time, cycle string, intervalDays *int32) (time.Time, error) {
	switch cycle {
	case BillingCycleMonthly:
		return current.AddDate(0, 1, 0), nil
	case BillingCycleQuarterly:
		return current.AddDate(0, 3, 0), nil
	case BillingCycleYearly:
		return current.AddDate(1, 0, 0), nil
	case BillingCycleLifetime:
		return current, nil
	case BillingCycleCustom:
		if intervalDays == nil || *intervalDays <= 0 {
			return time.Time{}, ErrCustomCycleNeedsInterval
		}
		return current.AddDate(0, 0, int(*intervalDays)), nil
	default:
		return time.Time{}, errors.New("invalid billing cycle: " + cycle)
	}
}

// MonthlyEquivalent normalises a per-cycle price into a monthly cost in VND
// (rounded). Returns 0 for LIFETIME and 0 for CUSTOM with a missing/invalid
// intervalDays.
//
// Per the Phase C plan:
//   - MONTHLY    -> price
//   - QUARTERLY  -> price/3   (truncated toward zero — integer division)
//   - YEARLY     -> price/12  (truncated)
//   - LIFETIME   -> 0
//   - CUSTOM     -> round(price * 30 / intervalDays)
//
// Note: this differs slightly from the TS dashboard helper, which divides by
// average days (30/91, 30/365). The simpler integer formulas above match the
// Phase C spec exactly.
func MonthlyEquivalent(price int32, cycle string, intervalDays *int32) int64 {
	switch cycle {
	case BillingCycleMonthly:
		return int64(price)
	case BillingCycleQuarterly:
		return int64(price) / 3
	case BillingCycleYearly:
		return int64(price) / 12
	case BillingCycleLifetime:
		return 0
	case BillingCycleCustom:
		if intervalDays == nil || *intervalDays <= 0 {
			return 0
		}
		return int64(math.Round(float64(price) * 30.0 / float64(*intervalDays)))
	default:
		return 0
	}
}
