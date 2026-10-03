package services

import (
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	store "github.com/thanhtrung9368/warranty-vault/api/internal/store/gen"
)

// Subscription audit (FEATURE_IDEAS #4) — the threshold logic, against fixtures.
//
// The three SQL queries are covered in internal/handlers against a per-test
// scratch database; this file pins the RULES, which are the part a client would
// otherwise have to reimplement. All dates are absolute so the suite cannot go red
// on a particular day.

var auditNow = time.Date(2026, time.September, 15, 12, 0, 0, 0, time.UTC)

func tsForAudit(t time.Time) pgtype.Timestamp { return pgtype.Timestamp{Time: t, Valid: true} }

func auditSub(id, name, cycle string, price int32, autoRenew bool) store.ListSubscriptionPaymentAuditRow {
	return store.ListSubscriptionPaymentAuditRow{
		ID:           id,
		Name:         name,
		BillingCycle: cycle,
		Price:        price,
		AutoRenew:    autoRenew,
		Status:       SubscriptionStatusActive,
		RenewalDate:  tsForAudit(auditNow.AddDate(0, 0, 3)),
		StartedAt:    tsForAudit(auditNow.AddDate(-1, 0, 0)),
	}
}

func findAuditKind(f []AuditFinding, kind string) *AuditFinding {
	for i := range f {
		if f[i].Kind == kind {
			return &f[i]
		}
	}
	return nil
}

func TestAuditQuietAutoRenewThresholds(t *testing.T) {
	// A monthly plan auto-charged since well before the cutoff, never manually
	// recorded: the finding fires.
	quiet := auditSub("sub_quiet", "iCloud+", BillingCycleMonthly, 59000, true)
	quiet.AutoRenewCount = AuditQuietMinAutoCharges
	quiet.PaymentCount = AuditQuietMinAutoCharges
	quiet.AutoChargedTotal = 59000 * AuditQuietMinAutoCharges
	quiet.FirstPaidAt = tsForAudit(auditNow.AddDate(0, -AuditQuietMinMonths, 0))
	quiet.LastPaidAt = tsForAudit(auditNow.AddDate(0, 0, -1))

	got := BuildSubscriptionAudit([]store.ListSubscriptionPaymentAuditRow{quiet}, nil, nil, auditNow)
	f := findAuditKind(got.Findings, AuditQuietAutoRenew)
	if f == nil {
		t.Fatalf("expected a QUIET_AUTO_RENEW finding, got %+v", got.Findings)
	}
	if f.Severity != ActionSeverityHigh {
		t.Errorf("severity = %s, want HIGH", f.Severity)
	}
	if f.MonthlyVnd != 59000 {
		t.Errorf("monthlyVnd = %d, want 59000", f.MonthlyVnd)
	}
	if f.ChargedTotalVnd != 177000 {
		t.Errorf("chargedTotalVnd = %d, want 177000", f.ChargedTotalVnd)
	}
	if f.FindingKey != ActionItemKey(AuditQuietAutoRenew, "sub_quiet") {
		t.Errorf("findingKey = %q", f.FindingKey)
	}
	if f.DaysUntilRenewal == nil || *f.DaysUntilRenewal != 3 {
		t.Errorf("daysUntilRenewal = %v, want 3", f.DaysUntilRenewal)
	}
}

func TestAuditQuietAutoRenewIsSuppressed(t *testing.T) {
	base := func() store.ListSubscriptionPaymentAuditRow {
		r := auditSub("sub_x", "Netflix", BillingCycleMonthly, 260000, true)
		r.AutoRenewCount = 6
		r.PaymentCount = 6
		r.AutoChargedTotal = 1560000
		r.FirstPaidAt = tsForAudit(auditNow.AddDate(0, -8, 0))
		r.LastPaidAt = tsForAudit(auditNow.AddDate(0, 0, -1))
		return r
	}

	for _, tc := range []struct {
		name   string
		mutate func(*store.ListSubscriptionPaymentAuditRow)
	}{
		{"one hand-logged payment clears it", func(r *store.ListSubscriptionPaymentAuditRow) {
			r.ManualCount = 1
		}},
		{"too few automatic charges", func(r *store.ListSubscriptionPaymentAuditRow) {
			r.AutoRenewCount = AuditQuietMinAutoCharges - 1
		}},
		{"running for less than the minimum span", func(r *store.ListSubscriptionPaymentAuditRow) {
			r.FirstPaidAt = tsForAudit(auditNow.AddDate(0, -2, 0))
		}},
		{"autoRenew off", func(r *store.ListSubscriptionPaymentAuditRow) { r.AutoRenew = false }},
		{"paused", func(r *store.ListSubscriptionPaymentAuditRow) { r.Status = SubscriptionStatusPaused }},
		{"lifetime is never charged again", func(r *store.ListSubscriptionPaymentAuditRow) {
			r.BillingCycle = BillingCycleLifetime
		}},
		{"no payments at all", func(r *store.ListSubscriptionPaymentAuditRow) {
			r.AutoRenewCount = 0
			r.PaymentCount = 0
			r.FirstPaidAt = pgtype.Timestamp{}
			r.LastPaidAt = pgtype.Timestamp{}
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := base()
			tc.mutate(&r)
			got := BuildSubscriptionAudit([]store.ListSubscriptionPaymentAuditRow{r}, nil, nil, auditNow)
			if f := findAuditKind(got.Findings, AuditQuietAutoRenew); f != nil {
				t.Errorf("expected no finding, got %+v", f)
			}
		})
	}
}

func TestAuditPriceRise(t *testing.T) {
	paid := auditNow.AddDate(0, 0, -3)
	rises := []store.ListSubscriptionPriceRisesRow{{
		SubscriptionID:   "sub_price",
		SubscriptionName: "Spotify",
		BillingCycle:     BillingCycleMonthly,
		PaidAt:           tsForAudit(paid),
		Amount:           69000,
		PrevAmount:       59000,
		PrevPaidAt:       tsForAudit(paid.AddDate(0, -1, 0)),
	}}
	// The cycle lookup comes from the summary rows, so an empty one still yields a
	// finding — but a monthly equivalent of 0, because the cycle is unknown there.
	rows := []store.ListSubscriptionPaymentAuditRow{auditSub("sub_price", "Spotify", BillingCycleMonthly, 69000, true)}

	got := BuildSubscriptionAudit(rows, rises, nil, auditNow)
	f := findAuditKind(got.Findings, AuditPriceIncreased)
	if f == nil {
		t.Fatalf("expected a PRICE_INCREASED finding, got %+v", got.Findings)
	}
	if f.PreviousAmountVnd == nil || *f.PreviousAmountVnd != 59000 {
		t.Errorf("previousAmountVnd = %v", f.PreviousAmountVnd)
	}
	if f.AmountVnd == nil || *f.AmountVnd != 69000 {
		t.Errorf("amountVnd = %v", f.AmountVnd)
	}
	if f.IncreaseVnd == nil || *f.IncreaseVnd != 10000 {
		t.Errorf("increaseVnd = %v", f.IncreaseVnd)
	}
	// 10000/59000 = 16.9% → 17
	if f.IncreasePercent == nil || *f.IncreasePercent != 17 {
		t.Errorf("increasePercent = %v, want 17", f.IncreasePercent)
	}
	if f.Material == nil || !*f.Material {
		t.Errorf("material = %v, want true", f.Material)
	}
	if f.MonthlyVnd != 69000 {
		t.Errorf("monthlyVnd = %d, want 69000 (from the summary row's cycle)", f.MonthlyVnd)
	}
}

func TestAuditPriceRiseMaterialityThreshold(t *testing.T) {
	// A rise smaller than AuditPriceRiseMinPercent is STILL reported — an increase
	// is a fact — but marked immaterial so a client can keep it out of a headline.
	rises := []store.ListSubscriptionPriceRisesRow{{
		SubscriptionID:   "sub_small",
		SubscriptionName: "Gói nhỏ",
		PaidAt:           tsForAudit(auditNow.AddDate(0, 0, -1)),
		Amount:           100000 + 1000,
		PrevAmount:       100000,
	}}
	got := BuildSubscriptionAudit(nil, rises, nil, auditNow)
	f := findAuditKind(got.Findings, AuditPriceIncreased)
	if f == nil {
		t.Fatal("expected the small rise to be reported")
	}
	if f.Material == nil || *f.Material {
		t.Errorf("material = %v, want false for +1%%", f.Material)
	}
}

func TestAuditPriceRiseFromZeroOmitsPercent(t *testing.T) {
	// A previous amount of 0 cannot yield a percentage. Reporting one would be
	// division by zero dressed up as a number; the absolute increase is the honest
	// answer and must survive on its own.
	rises := []store.ListSubscriptionPriceRisesRow{{
		SubscriptionID:   "sub_zero",
		SubscriptionName: "Khuyến mãi kết thúc",
		PaidAt:           tsForAudit(auditNow.AddDate(0, 0, -1)),
		Amount:           99000,
		PrevAmount:       0,
	}}
	got := BuildSubscriptionAudit(nil, rises, nil, auditNow)
	f := findAuditKind(got.Findings, AuditPriceIncreased)
	if f == nil {
		t.Fatal("expected a finding")
	}
	if f.IncreasePercent != nil {
		t.Errorf("increasePercent = %v, want nil when the previous amount is 0", *f.IncreasePercent)
	}
	if f.IncreaseVnd == nil || *f.IncreaseVnd != 99000 {
		t.Errorf("increaseVnd = %v, want 99000", f.IncreaseVnd)
	}
}

func TestAuditPriceRiseKeepsOnlyTheLatestPerSubscription(t *testing.T) {
	// The query returns rows newest-first; only the most recent increase may be
	// reported per subscription, or a long history would produce a wall of noise
	// for one package.
	rises := []store.ListSubscriptionPriceRisesRow{
		{SubscriptionID: "s1", SubscriptionName: "A", PaidAt: tsForAudit(auditNow.AddDate(0, 0, -1)), Amount: 120000, PrevAmount: 110000},
		{SubscriptionID: "s1", SubscriptionName: "A", PaidAt: tsForAudit(auditNow.AddDate(0, -2, 0)), Amount: 110000, PrevAmount: 100000},
	}
	got := BuildSubscriptionAudit(nil, rises, nil, auditNow)
	if len(got.Findings) != 1 {
		t.Fatalf("expected 1 finding, got %d: %+v", len(got.Findings), got.Findings)
	}
	if got.Findings[0].AmountVnd == nil || *got.Findings[0].AmountVnd != 120000 {
		t.Errorf("kept the wrong rise: %+v", got.Findings[0])
	}
}

func TestAuditDuplicatePairSumsMonthlyCost(t *testing.T) {
	pairs := []store.ListSubscriptionDuplicatePairsRow{{
		IDA: "s1", NameA: "icloud+", PriceA: 59000, BillingCycleA: BillingCycleMonthly,
		IDB: "s2", NameB: "iCloud+", PriceB: 199000, BillingCycleB: BillingCycleMonthly,
		Reason: "SAME_NAME",
	}}
	got := BuildSubscriptionAudit(nil, nil, pairs, auditNow)
	f := findAuditKind(got.Findings, AuditDuplicate)
	if f == nil {
		t.Fatal("expected a DUPLICATE finding")
	}
	if len(f.SubscriptionIDs) != 2 || len(f.Names) != 2 {
		t.Fatalf("expected both sides: %+v", f)
	}
	if f.MonthlyVnd != 258000 {
		t.Errorf("monthlyVnd = %d, want 258000", f.MonthlyVnd)
	}
	if f.Reason == nil || *f.Reason != "SAME_NAME" {
		t.Errorf("reason = %v", f.Reason)
	}
	if f.FindingKey != ActionItemKey(AuditDuplicate, "s1+s2") {
		t.Errorf("findingKey = %q", f.FindingKey)
	}
}

func TestAuditDuplicateBrandCategoryReason(t *testing.T) {
	// Different names that the user typed by hand, but the same brand and the same
	// category: the second signal. The title must not claim the names match.
	brand, category := "Netflix", "STREAMING"
	pairs := []store.ListSubscriptionDuplicatePairsRow{{
		IDA: "s1", NameA: "Netflix Premium", BrandA: &brand, CategoryA: &category,
		PriceA: 260000, BillingCycleA: BillingCycleMonthly,
		IDB: "s2", NameB: "Netflix cua vo", BrandB: &brand, CategoryB: &category,
		PriceB: 260000, BillingCycleB: BillingCycleMonthly,
		Reason: "SAME_BRAND_CATEGORY",
	}}
	got := BuildSubscriptionAudit(nil, nil, pairs, auditNow)
	f := findAuditKind(got.Findings, AuditDuplicate)
	if f == nil {
		t.Fatal("expected a DUPLICATE finding")
	}
	if f.Reason == nil || *f.Reason != "SAME_BRAND_CATEGORY" {
		t.Fatalf("reason = %v", f.Reason)
	}
	if f.MonthlyVnd != 520000 {
		t.Errorf("monthlyVnd = %d, want 520000", f.MonthlyVnd)
	}
	if got.Counts.Low != 1 {
		t.Errorf("a duplicate is LOW severity, counts = %+v", got.Counts)
	}
}

func TestAuditOrderingAndCounts(t *testing.T) {
	// High findings first, and within a severity the biggest monthly drain leads:
	// money is the reason this feature exists.
	quietSmall := auditSub("q_small", "Nhỏ", BillingCycleMonthly, 20000, true)
	quietSmall.AutoRenewCount = 4
	quietSmall.FirstPaidAt = tsForAudit(auditNow.AddDate(0, -9, 0))
	quietSmall.LastPaidAt = tsForAudit(auditNow.AddDate(0, 0, -1))

	quietBig := auditSub("q_big", "Lớn", BillingCycleMonthly, 500000, true)
	quietBig.AutoRenewCount = 4
	quietBig.FirstPaidAt = tsForAudit(auditNow.AddDate(0, -9, 0))
	quietBig.LastPaidAt = tsForAudit(auditNow.AddDate(0, 0, -1))

	rise := store.ListSubscriptionPriceRisesRow{
		SubscriptionID: "p1", SubscriptionName: "P", PaidAt: tsForAudit(auditNow.AddDate(0, 0, -1)),
		Amount: 200000, PrevAmount: 100000,
	}

	got := BuildSubscriptionAudit(
		[]store.ListSubscriptionPaymentAuditRow{quietSmall, quietBig},
		[]store.ListSubscriptionPriceRisesRow{rise},
		nil, auditNow,
	)
	if len(got.Findings) != 3 {
		t.Fatalf("expected 3 findings, got %d", len(got.Findings))
	}
	if got.Findings[0].SubscriptionIDs[0] != "q_big" {
		t.Errorf("first finding = %+v, want the big quiet one", got.Findings[0])
	}
	if got.Findings[1].SubscriptionIDs[0] != "q_small" {
		t.Errorf("second finding = %+v, want the small quiet one", got.Findings[1])
	}
	if got.Findings[2].Kind != AuditPriceIncreased {
		t.Errorf("third finding = %s, want the MEDIUM price rise last", got.Findings[2].Kind)
	}
	if got.Counts.Total != 3 || got.Counts.High != 2 || got.Counts.Medium != 1 || got.Counts.Low != 0 {
		t.Errorf("counts = %+v", got.Counts)
	}
	if !got.Advisory {
		t.Error("advisory must always be true")
	}
	if got.Note == "" {
		t.Error("note must explain the limits of the analysis")
	}
}

func TestAuditEmptyIsNotEmptyNull(t *testing.T) {
	got := BuildSubscriptionAudit(nil, nil, nil, auditNow)
	if got.Findings == nil {
		t.Fatal("findings must be an empty slice, not nil — a client rendering the array must not have to null-check")
	}
	if len(got.Findings) != 0 || got.Counts.Total != 0 {
		t.Errorf("expected an empty report, got %+v", got)
	}
}
