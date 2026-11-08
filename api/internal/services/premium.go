package services

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/thanhtrung9368/warranty-vault/api/internal/appstore"
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

// IsPremium is the cheap existence check used by /auth/me and PlanFor. It
// deliberately runs in the database rather than caching: an expiry is a
// timestamp, and a cached "true" past expiresAt is exactly the bug a paid
// feature cannot afford.
func IsPremium(ctx context.Context, db *pgxpool.Pool, userID string) (bool, error) {
	return isPremiumOn(ctx, db, userID)
}

func isPremiumOn(ctx context.Context, q premiumQuerier, userID string) (bool, error) {
	var active bool
	err := q.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1
			FROM public."PremiumEntitlement"
			WHERE "userId" = $1
			  AND "revokedAt" IS NULL
			  AND "expiresAt" > (now() AT TIME ZONE 'UTC')
		)`, userID).Scan(&active)
	if err != nil {
		return false, fmt.Errorf("premium: check entitlement: %w", err)
	}
	return active, nil
}

// PlanFor resolves the quota set for one account from the pool. Every create
// path calls this once and passes the result down; the transaction-scoped
// variant exists for the wishlist transition, which is already inside a tx.
func PlanFor(ctx context.Context, db *pgxpool.Pool, userID string) (Plan, error) {
	return PlanForOn(ctx, db, userID)
}

// PlanForOn is the same check against a pool or an open transaction.
func PlanForOn(ctx context.Context, q premiumQuerier, userID string) (Plan, error) {
	premium, err := isPremiumOn(ctx, q, userID)
	if err != nil {
		return FreePlan, err
	}
	if premium {
		return PremiumPlan, nil
	}
	return FreePlan, nil
}

// PremiumStatusFor returns the newest active entitlement. No row (or only
// expired/revoked rows) means Active=false, not an error: "not premium" is a
// normal state, not a failure.
func PremiumStatusFor(ctx context.Context, db *pgxpool.Pool, userID string) (PremiumStatus, error) {
	var s PremiumStatus
	err := db.QueryRow(ctx, `
		SELECT "productId", "expiresAt", "environment"
		FROM public."PremiumEntitlement"
		WHERE "userId" = $1
		  AND "revokedAt" IS NULL
		  AND "expiresAt" > (now() AT TIME ZONE 'UTC')
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
