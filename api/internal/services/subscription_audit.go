package services

import (
	"context"
	"fmt"
	"sort"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	store "github.com/thanhtrung9368/warranty-vault/api/internal/store/gen"
)

// Subscription audit (FEATURE_IDEAS #4): "gói bị bỏ quên / tăng giá / trùng nhau".
//
// Deterministic SQL plus Go. No AI, no model, no network call — every finding is
// reproducible from the user's own rows and can be explained line by line.
//
// ADVISORY ONLY. Nothing in this file writes, cancels or modifies anything, and
// there is no endpoint that does so on its behalf. Turning a finding into an
// action is the user's click, through the subscription endpoints that already
// exist.
//
// ## What the data can and cannot support
//
// The feature doc's first framing was "paid for a long time but rarely/never
// used". That claim CANNOT be made from this schema, and this file does not make
// it. The app has exactly two activity signals, both of them about RECORDING, not
// usage:
//
//   - SubscriptionPayment rows, and whether each was written by the cron
//     (`note = 'Auto-renew'`, see internal/cron/run.go) or logged by hand;
//   - the subscription's own fields, which only change when the user edits them.
//
// There is no usage telemetry, no bank feed (roadmap §5 rejected that: no public
// consumer API exists) and nothing in the schema that says "this service was
// opened". So "used" is defined here as **the user recorded something other than
// the machine's own auto-charge**, and every finding is phrased as
// "lâu rồi không thấy ghi nhận gì" — which is what the rows actually say — rather
// than "bạn không dùng gói này", which they do not.
//
// ## Why this is server-side rather than web-side
//
// Detection is server-side; only rendering is client-side. Three concrete reasons:
//
//  1. Duplicate detection needs `public.wv_unaccent` (migrations 0005/0007), the
//     IMMUTABLE wrapper device search is built on. It exists only in Postgres;
//     doing this in the web would mean a fourth unaccent implementation in the
//     repo.
//  2. The price-rise rule needs LAG over each subscription's full payment history.
//     A client would have to fetch every payment of every subscription — the N+1
//     this query exists to avoid.
//  3. The thresholds below are product decisions. Web, iOS and Android must agree
//     on them or the same account shows different advice per device; the repo has
//     already paid for that class of bug once (money math implemented
//     independently on three clients).
//
// The calculation is cheap, but "cheap" is not the constraint — consistency and
// the unaccent function are.

// Finding kinds.
const (
	AuditQuietAutoRenew = "QUIET_AUTO_RENEW"
	AuditPriceIncreased = "PRICE_INCREASED"
	AuditDuplicate      = "DUPLICATE"
)

// Thresholds. Each is a product decision, documented, and pinned by a test.
const (
	// AuditQuietMinAutoCharges is how many automatic charges a package must have
	// accumulated before the silence is worth reporting. 3 filters out a
	// subscription the user added last week: two charges is a new habit, not a
	// forgotten one.
	AuditQuietMinAutoCharges = 3
	// AuditQuietMinMonths is the second half of that rule. A count alone would
	// flag a QUARTERLY plan after 9 months and a MONTHLY one after 3; requiring
	// the OLDEST auto charge to be at least 6 months old makes the finding mean
	// "this has been running for half a year", which is the same bar for every
	// billing cycle.
	AuditQuietMinMonths = 6
	// AuditUpcomingRenewalDays is how close the next charge must be for a finding
	// to be worth acting on. 14 days gives a full monthly cycle of slack, so the
	// user can still cancel before the money leaves.
	AuditUpcomingRenewalDays = 14
	// AuditPriceRiseMinPercent is the materiality bar for a price rise. There is
	// deliberately NO bar on whether a rise is reported at all — an increase is a
	// fact and is always listed — but a rise below this percentage is marked
	// `material: false` so a client can keep it out of a headline. 5% is roughly
	// where a VN consumer notices: below it, a 199.000đ plan moves by less than
	// 10.000đ, which reads as rounding rather than a decision.
	AuditPriceRiseMinPercent = 5
)

// SubscriptionAuditThresholds is echoed in the response so a client can show the
// rule it applied instead of presenting a finding as an unexplained verdict.
type SubscriptionAuditThresholds struct {
	QuietMinAutoCharges int  `json:"quietMinAutoCharges"`
	QuietMinMonths      int  `json:"quietMinMonths"`
	UpcomingRenewalDays int  `json:"upcomingRenewalDays"`
	PriceRiseMinPercent int  `json:"priceRiseMinPercent"`
	DuplicateNormalized bool `json:"duplicateNormalized"`
}

// AuditFinding is one advisory conclusion.
type AuditFinding struct {
	FindingKey string `json:"findingKey"`
	Kind       string `json:"kind"`
	Severity   string `json:"severity"`
	Title      string `json:"title"`
	Detail     string `json:"detail"`

	// SubscriptionIDs lists every subscription the finding is about: one for the
	// single-subscription rules, two for DUPLICATE.
	SubscriptionIDs []string `json:"subscriptionIds"`
	Names           []string `json:"names"`

	// MonthlyVnd is the combined monthly equivalent of the subscriptions involved
	// (int64 — a row's price is int32, a total never is). 0 when the cycle has no
	// monthly equivalent (LIFETIME).
	MonthlyVnd int64 `json:"monthlyVnd"`
	// ChargedTotalVnd / ChargeCount describe the automatic charges already taken.
	ChargedTotalVnd int64 `json:"chargedTotalVnd"`
	ChargeCount     int64 `json:"chargeCount"`
	// LastRecordedAt is the newest payment date — NOT a usage date. Absent when
	// the subscription has no payments at all.
	LastRecordedAt *string `json:"lastRecordedAt"`
	// NextRenewalAt / DaysUntilRenewal describe the next automatic charge.
	NextRenewalAt    *string `json:"nextRenewalAt"`
	DaysUntilRenewal *int    `json:"daysUntilRenewal"`
	// Price-rise fields (PRICE_INCREASED only). Amounts are VND.
	PreviousAmountVnd *int64 `json:"previousAmountVnd,omitempty"`
	AmountVnd         *int64 `json:"amountVnd,omitempty"`
	IncreaseVnd       *int64 `json:"increaseVnd,omitempty"`
	IncreasePercent   *int32 `json:"increasePercent,omitempty"`
	// Material is false for a rise smaller than AuditPriceRiseMinPercent. The
	// finding is still reported; only its prominence is left to the client.
	Material *bool `json:"material,omitempty"`
	// Reason explains which duplicate signal fired (SAME_NAME /
	// SAME_BRAND_CATEGORY). DUPLICATE only.
	Reason *string `json:"reason,omitempty"`
}

// SubscriptionAudit is the GET /api/v1/subscriptions/audit payload.
type SubscriptionAudit struct {
	GeneratedAt string                      `json:"generatedAt"`
	Findings    []AuditFinding              `json:"findings"`
	Counts      ActionCounts                `json:"counts"`
	Advisory    bool                        `json:"advisory"`
	Thresholds  SubscriptionAuditThresholds `json:"thresholds"`
	Note        string                      `json:"note"`
}

// auditNoteVN states the limits of the analysis inside the payload, so no client
// can render these findings as if they were usage data or as if the app had read
// a bank statement.
const auditNoteVN = "Đây là số liệu TỰ SOÁT từ những gì bạn đã ghi, không phải kết luận về việc bạn có dùng hay không: app không đọc được giao dịch ngân hàng và không có cách nào biết một gói có đang được dùng. «Lâu rồi không thấy ghi nhận gì» nghĩa là không có khoản nào do bạn tự ghi — các khoản tự động trừ vẫn được tính riêng. Không có gì bị sửa hay huỷ tự động."

// GetSubscriptionAudit runs the three detection queries and folds them into one
// advisory report. `now` is passed in so the caller (and the tests) control the
// instant.
func GetSubscriptionAudit(ctx context.Context, db *pgxpool.Pool, userID string, now time.Time) (SubscriptionAudit, error) {
	q := store.New(db)

	rows, err := q.ListSubscriptionPaymentAudit(ctx, userID)
	if err != nil {
		return SubscriptionAudit{}, fmt.Errorf("audit: payment summary: %w", err)
	}
	rises, err := q.ListSubscriptionPriceRises(ctx, userID)
	if err != nil {
		return SubscriptionAudit{}, fmt.Errorf("audit: price rises: %w", err)
	}
	pairs, err := q.ListSubscriptionDuplicatePairs(ctx, userID)
	if err != nil {
		return SubscriptionAudit{}, fmt.Errorf("audit: duplicate pairs: %w", err)
	}
	return BuildSubscriptionAudit(rows, rises, pairs, now), nil
}

// BuildSubscriptionAudit is the pure half: it takes the three result sets and
// applies every threshold. Kept free of the database so the rules can be tested
// against fixtures, and so the SQL can change without silently changing a rule.
func BuildSubscriptionAudit(
	rows []store.ListSubscriptionPaymentAuditRow,
	rises []store.ListSubscriptionPriceRisesRow,
	pairs []store.ListSubscriptionDuplicatePairsRow,
	now time.Time,
) SubscriptionAudit {
	findings := make([]AuditFinding, 0, len(rows))

	// Cycle data per subscription, so the price-rise rule can report a monthly
	// equivalent without a second query and without guessing the cycle.
	type cycleInfo struct {
		cycle        string
		intervalDays *int32
	}
	cycleBySub := make(map[string]cycleInfo, len(rows))
	for _, r := range rows {
		cycleBySub[r.ID] = cycleInfo{cycle: r.BillingCycle, intervalDays: r.IntervalDays}
	}

	// ── 1. Quiet auto-renew: the machine has been paying for months and the user
	//      has never recorded anything of their own. ─────────────────────────
	quietCutoff := now.AddDate(0, -AuditQuietMinMonths, 0)
	for _, r := range rows {
		if r.Status != SubscriptionStatusActive || !r.AutoRenew ||
			r.BillingCycle == BillingCycleLifetime {
			continue
		}
		// Any hand-logged payment is the user's own record that they are still
		// engaged with this package, so it clears the finding outright.
		if r.ManualCount > 0 {
			continue
		}
		if r.AutoRenewCount < AuditQuietMinAutoCharges {
			continue
		}
		if !r.FirstPaidAt.Valid || r.FirstPaidAt.Time.After(quietCutoff) {
			continue
		}

		it := AuditFinding{
			FindingKey:      ActionItemKey(AuditQuietAutoRenew, r.ID),
			Kind:            AuditQuietAutoRenew,
			Severity:        ActionSeverityHigh,
			SubscriptionIDs: []string{r.ID},
			Names:           []string{r.Name},
			MonthlyVnd:      MonthlyEquivalent(r.Price, r.BillingCycle, r.IntervalDays),
			ChargedTotalVnd: r.AutoChargedTotal,
			ChargeCount:     r.AutoRenewCount,
		}
		if r.LastPaidAt.Valid {
			it.LastRecordedAt = tsPtrUTC(r.LastPaidAt)
		}
		attachRenewal(&it, r.RenewalDate, now)
		it.Title = "Gói tự trừ tiền đã lâu mà không thấy ghi nhận gì"
		it.Detail = fmt.Sprintf(
			"«%s» đã tự động trừ %d lần, tổng %s, lần đầu từ %s — và bạn chưa từng tự ghi khoản nào cho gói này. Nếu đã lâu không dùng, đây là lúc xem lại.",
			r.Name, r.AutoRenewCount, formatVNDInt64(r.AutoChargedTotal), formatViDate(r.FirstPaidAt.Time))
		findings = append(findings, it)
	}

	// ── 2. Price rise between two consecutive payments. One finding per
	//      subscription: the rows arrive newest-first, so the first row seen for
	//      an id is the most recent increase. ──────────────────────────────────
	seenRise := map[string]bool{}
	for _, r := range rises {
		if seenRise[r.SubscriptionID] {
			continue
		}
		seenRise[r.SubscriptionID] = true
		if !r.PaidAt.Valid {
			continue
		}

		increase := int64(r.Amount) - int64(r.PrevAmount)
		if increase <= 0 {
			continue
		}
		// Basis points, computed on int64 and reported as a whole percent so no
		// client has to divide money. A zero previous amount cannot be a
		// percentage (division by zero) — report no percentage and keep the
		// absolute increase, which is the honest answer.
		var percent *int32
		material := true
		if r.PrevAmount > 0 {
			p := int32((increase*100 + int64(r.PrevAmount)/2) / int64(r.PrevAmount))
			percent = &p
			material = p >= AuditPriceRiseMinPercent
		}

		cycle := cycleBySub[r.SubscriptionID]
		it := AuditFinding{
			FindingKey:        ActionItemKey(AuditPriceIncreased, r.SubscriptionID),
			Kind:              AuditPriceIncreased,
			Severity:          ActionSeverityMedium,
			SubscriptionIDs:   []string{r.SubscriptionID},
			Names:             []string{r.SubscriptionName},
			MonthlyVnd:        MonthlyEquivalent(r.Amount, cycle.cycle, cycle.intervalDays),
			PreviousAmountVnd: ptrOf(int64(r.PrevAmount)),
			AmountVnd:         ptrOf(int64(r.Amount)),
			IncreaseVnd:       ptrOf(increase),
			IncreasePercent:   percent,
			Material:          ptrOf(material),
		}
		if r.PaidAt.Valid {
			it.LastRecordedAt = tsPtrUTC(r.PaidAt)
		}
		it.Title = "Giá gói đã tăng"
		if percent != nil {
			it.Detail = fmt.Sprintf("«%s» tăng từ %s lên %s (+%s, +%d%%) ở kỳ thanh toán ngày %s.",
				r.SubscriptionName, formatVNDInt64(int64(r.PrevAmount)), formatVNDInt64(int64(r.Amount)),
				formatVNDInt64(increase), *percent, formatViDate(r.PaidAt.Time))
		} else {
			it.Detail = fmt.Sprintf("«%s» tăng từ %s lên %s (+%s) ở kỳ thanh toán ngày %s.",
				r.SubscriptionName, formatVNDInt64(int64(r.PrevAmount)), formatVNDInt64(int64(r.Amount)),
				formatVNDInt64(increase), formatViDate(r.PaidAt.Time))
		}
		findings = append(findings, it)
	}

	// ── 3. Likely duplicates. ────────────────────────────────────────────────
	for _, p := range pairs {
		reason := p.Reason
		it := AuditFinding{
			FindingKey:      ActionItemKey(AuditDuplicate, p.IDA+"+"+p.IDB),
			Kind:            AuditDuplicate,
			Severity:        ActionSeverityLow,
			SubscriptionIDs: []string{p.IDA, p.IDB},
			Names:           []string{p.NameA, p.NameB},
			MonthlyVnd: MonthlyEquivalent(p.PriceA, p.BillingCycleA, p.IntervalDaysA) +
				MonthlyEquivalent(p.PriceB, p.BillingCycleB, p.IntervalDaysB),
			Reason: &reason,
		}
		if reason == "SAME_NAME" {
			it.Title = "Hai gói trùng tên"
			it.Detail = fmt.Sprintf("«%s» và «%s» đang cùng hoạt động và trùng tên (khác cách viết). Kiểm tra xem có phải bạn đang trả tiền hai lần cho cùng một thứ.",
				p.NameA, p.NameB)
		} else {
			it.Title = "Hai gói cùng hãng và cùng loại"
			it.Detail = fmt.Sprintf("«%s» và «%s» đang cùng hoạt động, cùng hãng và cùng loại. Kiểm tra xem có phải bạn đang trả tiền hai lần cho cùng một dịch vụ.",
				p.NameA, p.NameB)
		}
		findings = append(findings, it)
	}

	// Ordering: severity, then the biggest monthly drain first, then key. Money is
	// the reason this feature exists, so within a severity the amount leads.
	sort.SliceStable(findings, func(i, j int) bool {
		a, b := findings[i], findings[j]
		if ra, rb := actionSeverityRank(a.Severity), actionSeverityRank(b.Severity); ra != rb {
			return ra < rb
		}
		if a.MonthlyVnd != b.MonthlyVnd {
			return a.MonthlyVnd > b.MonthlyVnd
		}
		return a.FindingKey < b.FindingKey
	})

	counts := ActionCounts{}
	for _, f := range findings {
		counts.Total++
		switch f.Severity {
		case ActionSeverityHigh:
			counts.High++
		case ActionSeverityMedium:
			counts.Medium++
		default:
			counts.Low++
		}
	}

	return SubscriptionAudit{
		GeneratedAt: now.UTC().Format(time.RFC3339Nano),
		Findings:    findings,
		Counts:      counts,
		Advisory:    true,
		Thresholds: SubscriptionAuditThresholds{
			QuietMinAutoCharges: AuditQuietMinAutoCharges,
			QuietMinMonths:      AuditQuietMinMonths,
			UpcomingRenewalDays: AuditUpcomingRenewalDays,
			PriceRiseMinPercent: AuditPriceRiseMinPercent,
			DuplicateNormalized: true,
		},
		Note: auditNoteVN,
	}
}

// attachRenewal fills NextRenewalAt / DaysUntilRenewal when the subscription has
// a renewal date, so a client can sort "what is about to be charged" without
// recomputing cycle arithmetic.
func attachRenewal(it *AuditFinding, renewal pgtype.Timestamp, now time.Time) {
	if !renewal.Valid {
		return
	}
	it.NextRenewalAt = tsPtrUTC(renewal)
	days := DaysUntil(renewal.Time, now)
	it.DaysUntilRenewal = &days
}
