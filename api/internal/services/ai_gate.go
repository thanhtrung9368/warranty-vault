package services

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/thanhtrung9368/warranty-vault/api/internal/i18n"
	store "github.com/thanhtrung9368/warranty-vault/api/internal/store/gen"
)

// The two gates every AI feature shares.
//
// Receipt extraction and claim assessment are separate products, but they have
// exactly one privacy contract: the server must have an ANTHROPIC_API_KEY, and
// the user must have switched AI on (User.aiOptIn, migration 0003) because their
// data leaves the box to a third-party provider. Duplicating those checks in a
// second service is how a future feature ships with only half of them, so this
// helper is the single place the two conditions live; each service maps the
// result to its own user-facing sentence and the same frozen error codes.
//
// The feature-specific copy is deliberately NOT here: a user who has never
// opted in is looking at a Settings toggle labelled "AI", and telling them to go
// turn on "receipt scanning" when they asked about a warranty claim would send
// them to the wrong switch.
type aiGateStatus int

const (
	// aiGateOpen means both conditions passed.
	aiGateOpen aiGateStatus = iota
	// aiGateFeatureDisabled means no API key is configured (503 feature_disabled).
	aiGateFeatureDisabled
	// aiGateOptInRequired means the user has not opted in (403 ai_optin_required).
	aiGateOptInRequired
)

// checkAIGate enforces the shared gate. `enabled` is the caller's
// client.Enabled() result (a nil client is "disabled"); the user lookup is
// skipped entirely on that branch, preserving the pre-existing behaviour of
// refusing an unconfigured deployment before touching the database.
//
// A missing user is NOT_FOUND and a read failure is internal_error, exactly as
// the receipt service has always mapped them. Returning a status plus an error
// keeps those two data-layer failures distinguishable from the gate refusals,
// which are ordinary flow control rather than errors.
func checkAIGate(ctx context.Context, db *pgxpool.Pool, enabled bool, userID string) (aiGateStatus, error) {
	if !enabled {
		return aiGateFeatureDisabled, nil
	}
	user, err := store.New(db).GetUserByID(ctx, userID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return aiGateOpen, notFound(i18n.Text(ctx, "Người dùng không tồn tại"))
		}
		return aiGateOpen, internalErr(i18n.Text(ctx, "Lỗi tải người dùng"))
	}
	if !user.AiOptIn {
		return aiGateOptInRequired, nil
	}
	return aiGateOpen, nil
}
