package auth

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	store "github.com/thanhtrung9368/warranty-vault/api/internal/store/gen"
)

// ErrSessionNotFound means "no such session row FOR THIS USER". It is returned
// for an unknown id and for another user's id alike, so a caller cannot use the
// answer to probe whether a foreign session id exists. Handlers map it to 404.
var ErrSessionNotFound = errors.New("session not found")

// SessionSummary is one row of GET /api/v1/auth/sessions.
//
// The `id` here is Session.id — the row's surrogate key (a cuid), NOT the bearer
// token and NOT its hash. Only the raw token can authenticate, it is never
// stored, and `tokenHash` is never selected into this shape.
type SessionSummary struct {
	ID          string  `json:"id"`
	DeviceLabel *string `json:"deviceLabel"`
	Platform    *string `json:"platform"`
	// Current marks the session that issued this request, so a client can label
	// it "thiết bị này" and refuse to revoke it by accident.
	Current bool `json:"current"`
	// Timestamps are RFC3339Nano in UTC, matching the rest of the API.
	LastSeenAt string `json:"lastSeenAt"`
	CreatedAt  string `json:"createdAt"`
	ExpiresAt  string `json:"expiresAt"`
}

// ListSessions returns the user's active sessions (not revoked, not expired at
// `now`), most recently used first.
//
// `now` is a parameter rather than time.Now() inside the function so the boundary
// is testable with a fixed clock, and so the comparison uses the same clock the
// app wrote "expiresAt" with (see the query comment).
func ListSessions(ctx context.Context, db *pgxpool.Pool, userID, currentSessionID string, now time.Time) ([]SessionSummary, error) {
	rows, err := store.New(db).ListActiveSessionsForUser(ctx, store.ListActiveSessionsForUserParams{
		UserId:    userID,
		ExpiresAt: pgtype.Timestamp{Time: now, Valid: true},
	})
	if err != nil {
		return nil, err
	}
	out := make([]SessionSummary, 0, len(rows))
	for _, r := range rows {
		out = append(out, SessionSummary{
			ID:          r.ID,
			DeviceLabel: r.DeviceLabel,
			Platform:    r.Platform,
			Current:     r.ID == currentSessionID,
			LastSeenAt:  formatSessionTime(r.LastSeenAt),
			CreatedAt:   formatSessionTime(r.CreatedAt),
			ExpiresAt:   formatSessionTime(r.ExpiresAt),
		})
	}
	return out, nil
}

// RevokeSessionForUser revokes one of the caller's own sessions and reports
// whether it was already revoked before this call.
//
// Ownership is enforced by the query (`AND "userId" = $2`): an unknown id and
// another user's id both produce ErrSessionNotFound, so the two are
// indistinguishable from outside. Revoking an already-revoked session is NOT an
// error — it reports alreadyRevoked=true and changes nothing, which makes
// retries safe.
//
// Expired-but-owned rows are accepted too (they are still the caller's own row);
// the extra revocation timestamp is harmless and the next prune removes it.
func RevokeSessionForUser(ctx context.Context, db *pgxpool.Pool, userID, sessionID string) (alreadyRevoked bool, err error) {
	q := store.New(db)
	row, err := q.GetSessionByIDForUser(ctx, store.GetSessionByIDForUserParams{ID: sessionID, UserId: userID})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return false, ErrSessionNotFound
		}
		return false, err
	}
	if row.RevokedAt.Valid {
		return true, nil
	}
	if _, err := q.RevokeSessionByID(ctx, store.RevokeSessionByIDParams{ID: sessionID, UserId: userID}); err != nil {
		return false, err
	}
	return false, nil
}

func formatSessionTime(ts pgtype.Timestamp) string {
	if !ts.Valid {
		return ""
	}
	return ts.Time.UTC().Format(time.RFC3339Nano)
}
