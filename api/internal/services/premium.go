package services

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/thanhtrung9368/warranty-vault/api/internal/appstore"
	store "github.com/thanhtrung9368/warranty-vault/api/internal/store/gen"
)

// Premium limits. The free values remain the source of truth for every account
// that has not bought anything; these are only chosen after an active
// PremiumEntitlement row is found.
//
// The numbers are deliberately round and documented in docs/SPEC-PREMIUM.md:
// the UI copy and the server refusals both read them from here, so changing a
// number is one edit, not a hunt through three clients.
const (
	PremiumMaxDevicesPerUser       = 200
	PremiumMaxDevicesTotalPerUser  = 2000
	PremiumMaxSubscriptionsPerUser = 500
	PremiumMaxWishlistPerUser      = 1000
)

// App Store identifiers. Product IDs are created in App Store Connect and can
// never be renamed; they are part of the contract between the app and the
// store, not a display string.
const (
	AppBundleID      = "com.warrly"
	PremiumMonthlyID = "com.warrly.premium.monthly"
	PremiumYearlyID  = "com.warrly.premium.yearly"
)

var premiumProductIDs = map[string]struct{}{
	PremiumMonthlyID: {},
	PremiumYearlyID:  {},
}

// Plan is the per-account quota set used by every write path. Keeping it as a
// value (rather than a bool threaded into each function) is what lets the
// refusal messages name the number that actually applies: a premium account
// refused at 200 must not read "giới hạn 50".
type Plan struct {
	MaxActiveDevices int64
	MaxTotalDevices  int64
	MaxSubscriptions int64
	MaxWishlist      int64
	Premium          bool
	// Lapsed is true when the account holds entitlement rows but none is active
	// right now. It does not change a limit: a lapsed account is on FreePlan, so
	// it can be WIDER than the ceiling that now applies. It exists only to choose
	// truthful refusal copy — telling someone whose Premium expired to "mark a
	// device sold" hides the actual cause and is the bug §6.4 exists to fix.
	Lapsed bool
}

var FreePlan = Plan{
	MaxActiveDevices: MaxDevicesPerUser,
	MaxTotalDevices:  MaxDevicesTotalPerUser,
	MaxSubscriptions: MaxSubscriptionsPerUser,
	MaxWishlist:      MaxWishlistPerUser,
}

var PremiumPlan = Plan{
	MaxActiveDevices: PremiumMaxDevicesPerUser,
	MaxTotalDevices:  PremiumMaxDevicesTotalPerUser,
	MaxSubscriptions: PremiumMaxSubscriptionsPerUser,
	MaxWishlist:      PremiumMaxWishlistPerUser,
	Premium:          true,
}

// planFromActivity is the one place an activity snapshot becomes a quota set.
// A lapsed account (rows exist, none active) gets FreePlan with Lapsed set; an
// account that never bought anything is byte-identical to the pre-0029 free
// plan, which is what keeps every free-path refusal message unchanged.
func planFromActivity(a premiumActivity) Plan {
	if a.Active {
		return PremiumPlan
	}
	p := FreePlan
	p.Lapsed = a.HasEntitlement
	return p
}

// ── The active predicate ─────────────────────────────────────────────────────
//
// One definition, used by every read in this file. Since migration 0029 a row
// can be active in one of two ways:
//
//   - "expiresAt" is in the future — the subscription is simply running;
//   - "gracePeriodExpiresAt" is in the future — Apple's Billing Grace Period is
//     covering a failed renewal, and the user is still subscribed even though
//     the paid period ended.
//
// A revoked row is never active, whatever the dates say: a refund wins over
// both. The pre-0029 rows have "gracePeriodExpiresAt" NULL, so their behaviour
// is exactly the old "revokedAt IS NULL AND expiresAt > now()".
//
// The clock is the DATABASE's, not Go's: every quota decision is a comparison
// against stored timestamps, and mixing two clocks across app servers is how an
// account flips in and out of Premium. There is deliberately no cache.
const premiumActivePredicate = `"revokedAt" IS NULL
			  AND ("expiresAt" > (now() AT TIME ZONE 'UTC')
			       OR ("gracePeriodExpiresAt" IS NOT NULL
			           AND "gracePeriodExpiresAt" > (now() AT TIME ZONE 'UTC')))`

// premiumCurrentPredicate is the "running normally" half of the active
// predicate. It is used only to tell PREMIUM apart from GRACE_PERIOD.
const premiumCurrentPredicate = `"revokedAt" IS NULL AND "expiresAt" > (now() AT TIME ZONE 'UTC')`

// premiumGracePredicate is active-but-only-through-grace. It is a strict
// subset of premiumActivePredicate; keeping it separate lets the status
// endpoint name the state without a second round trip.
const premiumGracePredicate = `"revokedAt" IS NULL
			  AND "expiresAt" <= (now() AT TIME ZONE 'UTC')
			  AND "gracePeriodExpiresAt" IS NOT NULL
			  AND "gracePeriodExpiresAt" > (now() AT TIME ZONE 'UTC')`

// PremiumStatus is the answer the API and the app both need: is the account
// premium right now, and until when. A row with a future expiresAt but a
// revocation is not active.
type PremiumStatus struct {
	Active      bool
	ProductID   string
	ExpiresAt   time.Time
	Environment string
}

// Premium errors are sentinel values so the HTTP layer can map them without
// parsing strings. The messages live in the i18n catalog.
var (
	ErrPremiumInvalid = errors.New("premium: transaction is not valid")
	ErrPremiumProduct = errors.New("premium: product or bundle is not supported")
	ErrPremiumOwned   = errors.New("premium: transaction already belongs to another account")
)

// premiumQuerier is the one database method the entitlement checks need. The
// pool and an open transaction both implement it, which matters: a quota check
// that runs INSIDE a transaction must reuse that transaction's connection.
// Querying the pool from an open transaction can deadlock when the pool is
// exhausted (and the test suite deliberately runs a small pool).
type premiumQuerier interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// premiumActivity is the two facts every entitlement decision needs, read in
// ONE round trip.
//
// HasEntitlement is what separates a lapsed Premium account from an account
// that never bought anything. Both get FreePlan; only the first one may already
// be above the free ceilings, and its refusal copy must say so.
type premiumActivity struct {
	Active         bool
	HasEntitlement bool
}

func premiumActivityOn(ctx context.Context, q premiumQuerier, userID string) (premiumActivity, error) {
	var a premiumActivity
	err := q.QueryRow(ctx, `
		SELECT
			EXISTS (
				SELECT 1
				FROM public."PremiumEntitlement"
				WHERE "userId" = $1
				  AND `+premiumActivePredicate+`
			),
			EXISTS (
				SELECT 1
				FROM public."PremiumEntitlement"
				WHERE "userId" = $1
			)`, userID).Scan(&a.Active, &a.HasEntitlement)
	if err != nil {
		return premiumActivity{}, fmt.Errorf("premium: check entitlement: %w", err)
	}
	return a, nil
}

// IsPremium is the cheap existence check used by /auth/me and PlanFor. It
// deliberately runs in the database rather than caching: an expiry is a
// timestamp, and a cached "true" past expiresAt is exactly the bug a paid
// feature cannot afford. It is grace-aware: during a Billing Grace Period the
// answer is true, because Apple still considers the subscription live.
func IsPremium(ctx context.Context, db *pgxpool.Pool, userID string) (bool, error) {
	a, err := premiumActivityOn(ctx, db, userID)
	if err != nil {
		return false, err
	}
	return a.Active, nil
}

// PlanFor resolves the quota set for one account from the pool. Every create
// path calls this once and passes the result down; the transaction-scoped
// variant exists for the wishlist transition, which is already inside a tx.
func PlanFor(ctx context.Context, db *pgxpool.Pool, userID string) (Plan, error) {
	return PlanForOn(ctx, db, userID)
}

// PlanForOn is the same check against a pool or an open transaction.
func PlanForOn(ctx context.Context, q premiumQuerier, userID string) (Plan, error) {
	a, err := premiumActivityOn(ctx, q, userID)
	if err != nil {
		return FreePlan, err
	}
	return planFromActivity(a), nil
}

// ── Lifecycle state (GET /api/v1/billing/status) ────────────────────────────

// PremiumState is the lossless answer to "why is this account (not) Premium".
// The order below is also the precedence used by PremiumLifecycle.State.
type PremiumState string

const (
	// StatePremium: an entitlement is running normally (expiresAt in the future).
	StatePremium PremiumState = "PREMIUM"
	// StateGracePeriod: the paid period ended, but Apple's grace period still
	// covers the account. Kept separate from PREMIUM so the app can say "sắp hết
	// hạn" instead of implying a renewal already happened.
	StateGracePeriod PremiumState = "GRACE_PERIOD"
	// StateBillingRetry: the subscription expired and Apple is retrying the
	// charge. Not the same story as a cancellation, and not silently "expired".
	StateBillingRetry PremiumState = "BILLING_RETRY"
	// StateExpired: a subscription exists, is not revoked, and is neither running
	// nor in grace.
	StateExpired PremiumState = "EXPIRED"
	// StateRevoked: the latest entitlement was refunded/revoked.
	StateRevoked PremiumState = "REVOKED"
	// StateNever: the account has never held an entitlement. The free plan is not
	// a lapse, and this state exists so clients never show lapse copy to a user
	// who never bought anything.
	StateNever PremiumState = "NEVER"
)

// PremiumLifecycle is everything the status query reads, in one value. Exported
// only as far as BillingStatus needs; the SQL predicate itself is pinned by
// tests against a real Postgres.
type PremiumLifecycle struct {
	HasCurrent         bool // a row with expiresAt > now, not revoked
	InGrace            bool // a row only active through gracePeriodExpiresAt
	HasAny             bool // any row at all, active or not
	LatestRevoked      bool // the newest row by expiresAt is revoked
	LatestBillingRetry bool // ... and it is in Apple's billing retry
}

// Active is the same answer as IsPremium, derived from the same predicates.
func (l PremiumLifecycle) Active() bool { return l.HasCurrent || l.InGrace }

// State returns the single lifecycle label. Precedence matters: a running row
// wins over an older grace row, and NEVER must come before REVOKED/EXPIRED so a
// free account is never described as lapsed.
func (l PremiumLifecycle) State() PremiumState {
	switch {
	case l.HasCurrent:
		return StatePremium
	case l.InGrace:
		return StateGracePeriod
	case !l.HasAny:
		return StateNever
	case l.LatestRevoked:
		return StateRevoked
	case l.LatestBillingRetry:
		return StateBillingRetry
	default:
		return StateExpired
	}
}

// BillingUsage is the four counters a plan applies to. Names mirror the limits;
// clients should compare them, not compute their own.
type BillingUsage struct {
	DevicesActive int64 `json:"devicesActive"`
	DevicesTotal  int64 `json:"devicesTotal"`
	Subscriptions int64 `json:"subscriptions"`
	Wishlist      int64 `json:"wishlist"`
}

// BillingLimits is the ceiling that applies to BillingUsage right now.
type BillingLimits struct {
	DevicesActive int64 `json:"devicesActive"`
	DevicesTotal  int64 `json:"devicesTotal"`
	Subscriptions int64 `json:"subscriptions"`
	Wishlist      int64 `json:"wishlist"`
}

// BillingStatus is GET /api/v1/billing/status.
//
// Two booleans deliberately mean different things:
//
//   - OverCap: usage is already ABOVE a ceiling. Only a lapsed account (or an
//     account that un-sold devices past the active ceiling) can be here.
//   - AddsBlocked: a create would be refused RIGHT NOW, which is also true when
//     usage sits exactly ON the ceiling.
//
// CanExport is always true. Export is a read of data the user already owns, and
// §6.4 is explicit that losing Premium must never lock it; the field exists so
// clients can render that promise rather than guess.
type BillingStatus struct {
	State       PremiumState  `json:"state"`
	Usage       BillingUsage  `json:"usage"`
	Limits      BillingLimits `json:"limits"`
	OverCap     bool          `json:"overCap"`
	AddsBlocked bool          `json:"addsBlocked"`
	CanExport   bool          `json:"canExport"`
}

// BillingStatusFor assembles the status response: one lifecycle query, the plan
// derived from it, and four counters. It is a read-only endpoint and is NOT
// logged per call (the metric that matters is billing.quota.refused on the
// write paths), so the cost of a handful of indexed counts is fine.
func BillingStatusFor(ctx context.Context, db *pgxpool.Pool, userID string) (BillingStatus, error) {
	var l PremiumLifecycle
	err := db.QueryRow(ctx, `
		SELECT
			EXISTS (
				SELECT 1 FROM public."PremiumEntitlement"
				WHERE "userId" = $1 AND `+premiumCurrentPredicate+`
			),
			EXISTS (
				SELECT 1 FROM public."PremiumEntitlement"
				WHERE "userId" = $1 AND `+premiumGracePredicate+`
			),
			EXISTS (
				SELECT 1 FROM public."PremiumEntitlement"
				WHERE "userId" = $1
			),
			COALESCE((
				SELECT "revokedAt" IS NOT NULL
				FROM public."PremiumEntitlement"
				WHERE "userId" = $1
				ORDER BY "expiresAt" DESC, "createdAt" DESC
				LIMIT 1
			), false),
			COALESCE((
				SELECT "inBillingRetryPeriod"
				FROM public."PremiumEntitlement"
				WHERE "userId" = $1
				ORDER BY "expiresAt" DESC, "createdAt" DESC
				LIMIT 1
			), false)`, userID).Scan(
		&l.HasCurrent, &l.InGrace, &l.HasAny, &l.LatestRevoked, &l.LatestBillingRetry)
	if err != nil {
		return BillingStatus{}, fmt.Errorf("premium: read lifecycle: %w", err)
	}

	plan := planFromActivity(premiumActivity{Active: l.Active(), HasEntitlement: l.HasAny})
	q := store.New(db)

	activeDevices, err := q.CountActiveDevicesByUser(ctx, userID)
	if err != nil {
		return BillingStatus{}, fmt.Errorf("count active devices: %w", err)
	}
	totalDevices, err := q.CountAllDevicesByUser(ctx, userID)
	if err != nil {
		return BillingStatus{}, fmt.Errorf("count all devices: %w", err)
	}
	subscriptions, err := q.CountSubscriptionsByUser(ctx, userID)
	if err != nil {
		return BillingStatus{}, fmt.Errorf("count subscriptions: %w", err)
	}
	wishlist, err := q.CountWishlistByUser(ctx, userID)
	if err != nil {
		return BillingStatus{}, fmt.Errorf("count wishlist: %w", err)
	}

	usage := BillingUsage{
		DevicesActive: activeDevices,
		DevicesTotal:  totalDevices,
		Subscriptions: subscriptions,
		Wishlist:      wishlist,
	}
	limits := BillingLimits{
		DevicesActive: plan.MaxActiveDevices,
		DevicesTotal:  plan.MaxTotalDevices,
		Subscriptions: plan.MaxSubscriptions,
		Wishlist:      plan.MaxWishlist,
	}
	return BillingStatus{
		State:  l.State(),
		Usage:  usage,
		Limits: limits,
		OverCap: usage.DevicesActive > limits.DevicesActive ||
			usage.DevicesTotal > limits.DevicesTotal ||
			usage.Subscriptions > limits.Subscriptions ||
			usage.Wishlist > limits.Wishlist,
		AddsBlocked: usage.DevicesActive >= limits.DevicesActive ||
			usage.DevicesTotal >= limits.DevicesTotal ||
			usage.Subscriptions >= limits.Subscriptions ||
			usage.Wishlist >= limits.Wishlist,
		CanExport: true,
	}, nil
}

// PremiumStatusFor returns the newest active entitlement. No row (or only
// expired/revoked rows) means Active=false, not an error: "not premium" is a
// normal state, not a failure. "Active" here includes the grace period.
func PremiumStatusFor(ctx context.Context, db *pgxpool.Pool, userID string) (PremiumStatus, error) {
	var s PremiumStatus
	err := db.QueryRow(ctx, `
		SELECT "productId", "expiresAt", "environment"
		FROM public."PremiumEntitlement"
		WHERE "userId" = $1
		  AND `+premiumActivePredicate+`
		ORDER BY "expiresAt" DESC
		LIMIT 1`, userID).Scan(&s.ProductID, &s.ExpiresAt, &s.Environment)
	if errors.Is(err, pgx.ErrNoRows) {
		return s, nil
	}
	if err != nil {
		return s, fmt.Errorf("premium: read entitlement: %w", err)
	}
	s.Active = true
	return s, nil
}

// VerifyAndStorePremium verifies one StoreKit 2 transaction and records it.
// The operation is serialised per originalTransactionId with an advisory lock,
// because two different accounts presenting two renewals of the same chain at
// the same time must not both pass the "does anyone own this?" check.
func VerifyAndStorePremium(ctx context.Context, db *pgxpool.Pool, userID, jws string) (PremiumStatus, error) {
	tx, err := appstore.Verify(jws)
	if err != nil {
		return PremiumStatus{}, fmt.Errorf("%w: %v", ErrPremiumInvalid, err)
	}
	if tx.BundleID != AppBundleID {
		return PremiumStatus{}, fmt.Errorf("%w: bundle %q", ErrPremiumProduct, tx.BundleID)
	}
	if _, ok := premiumProductIDs[tx.ProductID]; !ok {
		return PremiumStatus{}, fmt.Errorf("%w: product %q", ErrPremiumProduct, tx.ProductID)
	}

	dbtx, err := db.Begin(ctx)
	if err != nil {
		return PremiumStatus{}, fmt.Errorf("premium: begin: %w", err)
	}
	defer func() { _ = dbtx.Rollback(ctx) }()

	// One lock per purchase chain. Different chains proceed in parallel; two
	// claims for the same original transaction serialise before the ownership
	// read, so the second sees the first's row.
	if _, err := dbtx.Exec(ctx,
		`SELECT pg_advisory_xact_lock(hashtext('wv:premium'), hashtext($1))`,
		tx.OriginalTransactionID); err != nil {
		return PremiumStatus{}, fmt.Errorf("premium: lock: %w", err)
	}

	var owner string
	err = dbtx.QueryRow(ctx, `
		SELECT "userId"
		FROM public."PremiumEntitlement"
		WHERE "transactionId" = $1
		   OR "originalTransactionId" = $2
		LIMIT 1`, tx.TransactionID, tx.OriginalTransactionID).Scan(&owner)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return PremiumStatus{}, fmt.Errorf("premium: check owner: %w", err)
	}
	if owner != "" && owner != userID {
		return PremiumStatus{}, ErrPremiumOwned
	}

	var revokedAt any
	if tx.RevokedAt != nil {
		revokedAt = tx.RevokedAt.UTC()
	}
	_, err = dbtx.Exec(ctx, `
		INSERT INTO public."PremiumEntitlement"
			("transactionId", "originalTransactionId", "userId", "productId",
			 "expiresAt", "revokedAt", "environment", "updatedAt")
		VALUES ($1, $2, $3, $4, $5, $6, $7, (now() AT TIME ZONE 'UTC'))
		ON CONFLICT ("transactionId") DO UPDATE SET
			"userId" = EXCLUDED."userId",
			"productId" = EXCLUDED."productId",
			"expiresAt" = EXCLUDED."expiresAt",
			"revokedAt" = EXCLUDED."revokedAt",
			"environment" = EXCLUDED."environment",
			"updatedAt" = (now() AT TIME ZONE 'UTC')
		WHERE "PremiumEntitlement"."userId" = EXCLUDED."userId"`,
		tx.TransactionID, tx.OriginalTransactionID, userID, tx.ProductID,
		tx.ExpiresAt.UTC(), revokedAt, tx.Environment)
	if err != nil {
		return PremiumStatus{}, fmt.Errorf("premium: store transaction: %w", err)
	}

	if err := dbtx.Commit(ctx); err != nil {
		return PremiumStatus{}, fmt.Errorf("premium: commit: %w", err)
	}
	return PremiumStatusFor(ctx, db, userID)
}
