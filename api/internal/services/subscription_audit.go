package services

import (
	"context"
	"fmt"
	"sort"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/thanhtrung9368/warranty-vault/api/internal/i18n"
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

// auditNoteKey states the limits of the analysis inside the payload, so no client
// can render these findings as if they were usage data or as if the app had read
// a bank statement.
//
// It is the Vietnamese SOURCE text, unchanged, and it doubles as the catalog key
// (internal/i18n/catalog.go). A named constant rather than an inline literal
// because the sentence reaches `i18n.Text` as DATA — see the two renderings
// below — and because a key that long is easier to keep honest in one place.
const auditNoteKey = "Đây là số liệu TỰ SOÁT từ những gì bạn đã ghi, không phải kết luận về việc bạn có dùng hay không: app không đọc được giao dịch ngân hàng và không có cách nào biết một gói có đang được dùng. «Lâu rồi không thấy ghi nhận gì» nghĩa là không có khoản nào do bạn tự ghi — các khoản tự động trừ vẫn được tính riêng. Không có gì bị sửa hay huỷ tự động."

// GetSubscriptionAudit runs the three detection queries and folds them into one
// advisory report. `now` is passed in so the caller (and the tests) control the
// instant.
//
// i18n: the report's copy is generated here, on the server, rather than by the
// client — the `note`, the finding `title`s and the finding `detail`s are all
// sentences this package owns. The language therefore comes from the request
// context, resolved at the HTTP edge (`i18n.TagFor` → `Attach`), and the money
// and date inside those sentences follow it too (i18n.FormatMoney /
// i18n.FormatDate): a Vietnamese reader gets "177.000 ₫" and "07/05/2026", an
// English one "₫177,000" and "05/07/2026". The two date forms are genuinely
// ambiguous against each other, which is exactly why they cannot be shared.
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
	return BuildSubscriptionAudit(i18n.From(ctx), rows, rises, pairs, now), nil
}

// BuildSubscriptionAudit is the pure half: it takes the three result sets and
// applies every threshold. Kept free of the database so the rules can be tested
// against fixtures, and so the SQL can change without silently changing a rule.
//
// `lang` is a parameter rather than something read from a context because this
// function has no context by design: it is the pure half, and the language is an
// INPUT to the sentences it produces in the same way `now` is an input to the
// thresholds it applies. The one caller with a request (GetSubscriptionAudit)
// resolves it with i18n.From(ctx), which sees whatever the handler put there.
func BuildSubscriptionAudit(
	lang i18n.Tag,
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
		it.Title = textIn(lang, quietAutoRenewTitle)
		// Singular/plural PAIR with a separate argument list per form: the count
		// is what makes it singular, so the singular template has no `%d` slot.
		// Handing one list to both forms is the bug wave 0 shipped
		// (`... expires in 1 day%!(EXTRA int=7)`).
		it.Detail = pluralText(lang, int(r.AutoRenewCount),
			"«%s» đã tự động trừ %d lần, tổng %s, lần đầu từ %s — và bạn chưa từng tự ghi khoản nào cho gói này. Nếu đã lâu không dùng, đây là lúc xem lại.",
			"«%s» đã tự động trừ 1 lần, tổng %s, lần đầu từ %s — và bạn chưa từng tự ghi khoản nào cho gói này. Nếu đã lâu không dùng, đây là lúc xem lại.",
			[]any{r.Name, r.AutoRenewCount, formatMoney(lang, r.AutoChargedTotal), formatDate(lang, r.FirstPaidAt.Time)},
			[]any{r.Name, formatMoney(lang, r.AutoChargedTotal), formatDate(lang, r.FirstPaidAt.Time)})
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
		it.Title = textIn(lang, priceRaisedTitle)
		if percent != nil {
			it.Detail = i18n.Translate(lang,
				"«%s» tăng từ %s lên %s (+%s, +%d%%) ở kỳ thanh toán ngày %s.",
				r.SubscriptionName, formatMoney(lang, int64(r.PrevAmount)), formatMoney(lang, int64(r.Amount)),
				formatMoney(lang, increase), *percent, formatDate(lang, r.PaidAt.Time))
		} else {
			it.Detail = i18n.Translate(lang,
				"«%s» tăng từ %s lên %s (+%s) ở kỳ thanh toán ngày %s.",
				r.SubscriptionName, formatMoney(lang, int64(r.PrevAmount)), formatMoney(lang, int64(r.Amount)),
				formatMoney(lang, increase), formatDate(lang, r.PaidAt.Time))
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
			it.Title = textIn(lang, duplicateNameTitle)
			it.Detail = i18n.Translate(lang, "«%s» và «%s» đang cùng hoạt động và trùng tên (khác cách viết). Kiểm tra xem có phải bạn đang trả tiền hai lần cho cùng một thứ.",
				p.NameA, p.NameB)
		} else {
			it.Title = textIn(lang, duplicateBrandCategoryTitle)
			it.Detail = i18n.Translate(lang, "«%s» và «%s» đang cùng hoạt động, cùng hãng và cùng loại. Kiểm tra xem có phải bạn đang trả tiền hai lần cho cùng một dịch vụ.",
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
		Note: textIn(lang, auditNoteKey),
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

// ─── i18n helpers for the pure builder ───────────────────────────────────────

// The finding titles. Named constants because each one reaches the catalog
// through `auditText`, i.e. as DATA rather than as a literal at the call site.
//
// `auditText` (not `i18n.Text`) is what the pure builder needs: BuildSubscriptionAudit
// has a `lang` and no request, and `i18n.Text` takes a context. The distinction
// matters for `go vet` too — `i18n.Translate` is printf-shaped and therefore
// rejects a key that arrives from a variable, which is exactly why the lookup
// goes through `i18n.Lookup` + `i18n.Interpolate` here.
const (
	quietAutoRenewTitle         = "Gói tự trừ tiền đã lâu mà không thấy ghi nhận gì"
	priceRaisedTitle            = "Giá gói đã tăng"
	duplicateNameTitle          = "Hai gói trùng tên"
	duplicateBrandCategoryTitle = "Hai gói cùng hãng và cùng loại"
)

// auditText renders an argument-free catalog key in `lang`.
//
// Keyed on the Vietnamese source text like every other entry; an unknown key
// degrades to the key itself, which IS the correct Vietnamese sentence.
func textIn(lang i18n.Tag, key string) string {
	text, ok := i18n.Lookup(lang, key)
	if !ok {
		return key
	}
	return text
}

// pluralText renders one of a singular/plural KEY PAIR, taking a SEPARATE
// argument list for each form: the count is what makes the singular form
// singular, so its template has no slot for the number. Passing the plural's
// list to the singular template is the mistake that produced
// `... expires in 1 day%!(EXTRA int=7)` in wave 0, and
// internal/i18n/catalog_test.go::TestSingularPluralPairsAgreeOnVerbCounts pins
// the two templates against it.
func pluralText(lang i18n.Tag, n int, pluralKey, singularKey string, pluralArgs, singularArgs []any) string {
	key, args := pluralKey, pluralArgs
	if n == 1 {
		key, args = singularKey, singularArgs
	}
	text, ok := i18n.Lookup(lang, key)
	if !ok {
		text = key
	}
	return i18n.Interpolate(text, args...)
}

// formatMoney renders a VND amount for `lang`, delegating to i18n.FormatMoney —
// the same helper the cron's push bodies use, so an audit row and a notification
// about the same money cannot disagree.
//
//	vi → 1.200.000 ₫   (dot grouping, trailing symbol — byte-for-byte what
//	                    formatVNDInt64 in actions.go produces, which is what the
//	                    Vietnamese side must keep emitting)
//	en → ₫1,200,000    (comma grouping, leading symbol)
//
// The narrowing to int32 is safe and deliberate: every amount here originates in
// `Subscription.price` / `SubscriptionPayment.amount`, which are int32 VND
// columns, and the only arithmetic applied is a SUM over one subscription's
// payments. The int64 fields on AuditFinding stay int64 — they are the wire shape
// and a total is not a price — but no total this code can build overflows the
// cast. (If it ever could, the fix is to widen i18n.FormatMoney, not to truncate
// here.)
//
// Only the VALUES and their rendering follow the language; the currency does not,
// because đồng is not denominated per language (see i18n.FormatMoney).
func formatMoney(lang i18n.Tag, amount int64) string {
	return i18n.FormatMoney(lang, int32(amount))
}

// formatDate renders a calendar date in `lang`: vi dd/mm/yyyy, en mm/dd/yyyy.
//
// It is a thin alias for i18n.FormatDate and NOT a call to the package-local
// formatViDate in actions.go — that helper is Vietnamese-only by definition, and
// the action queue it belongs to is a later wave. Aliasing keeps this file's
// three call sites reading as "the audit's own date rendering" while there is
// exactly one implementation of each language's format in the repo.
func formatDate(lang i18n.Tag, t time.Time) string {
	return i18n.FormatDate(lang, t)
}
