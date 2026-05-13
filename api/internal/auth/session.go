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

// Session lifetime mirrors website/src/lib/api-auth.ts.
const (
	SessionTTL        = 30 * 24 * time.Hour
	SessionTTLSliding = 7 * 24 * time.Hour
)

var ErrInvalidSession = errors.New("invalid session")

// UserSession is the authenticated context attached to a request.
type UserSession struct {
	UserID    string
	Email     string
	Name      *string
	SessionID string
	ExpiresAt time.Time
}

type IssuedToken struct {
	AccessToken string
	ExpiresAt   time.Time
	SessionID   string
}

// IssueToken creates a Session row and returns the raw bearer token (only
// time it leaves the server) plus its expiry.
func IssueToken(ctx context.Context, db *pgxpool.Pool, userID string, deviceLabel, platform *string) (*IssuedToken, error) {
	token, hash, err := newTokenAndHash()
	if err != nil {
		return nil, err
	}
	expiresAt := time.Now().Add(SessionTTL)
	q := store.New(db)
	row, err := q.CreateSession(ctx, store.CreateSessionParams{
		ID:          NewID(),
		UserId:      userID,
		TokenHash:   hash,
		DeviceLabel: deviceLabel,
		Platform:    platform,
		ExpiresAt:   pgtype.Timestamp{Time: expiresAt, Valid: true},
	})
	if err != nil {
		return nil, err
	}
	return &IssuedToken{
		AccessToken: token,
		ExpiresAt:   expiresAt,
		SessionID:   row.ID,
	}, nil
}

// VerifyBearer parses an Authorization header, looks up the session, and
// returns the resolved user. Slides expiresAt forward when the remaining
// lifetime is below SessionTTLSliding. Returns ErrInvalidSession on miss.
func VerifyBearer(ctx context.Context, db *pgxpool.Pool, authHeader string) (*UserSession, error) {
	hash := hashFromBearer(authHeader)
	if hash == "" {
		return nil, ErrInvalidSession
	}
	q := store.New(db)
	row, err := q.GetSessionByTokenHash(ctx, hash)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrInvalidSession
		}
		return nil, err
	}

	now := time.Now()
	if row.RevokedAt.Valid {
		return nil, ErrInvalidSession
	}
	if !row.ExpiresAt.Valid || !row.ExpiresAt.Time.After(now) {
		return nil, ErrInvalidSession
	}
	// Sessions issued before the user's last password change are stale.
	if row.UPasswordChangedAt.Valid && row.CreatedAt.Valid &&
		row.UPasswordChangedAt.Time.After(row.CreatedAt.Time) {
		return nil, ErrInvalidSession
	}

	remaining := row.ExpiresAt.Time.Sub(now)
	if remaining < SessionTTLSliding {
		newExpiry := now.Add(SessionTTL)
		_ = q.ExtendSession(ctx, store.ExtendSessionParams{
			ID:        row.SessionID,
			ExpiresAt: pgtype.Timestamp{Time: newExpiry, Valid: true},
		})
		row.ExpiresAt = pgtype.Timestamp{Time: newExpiry, Valid: true}
	} else {
		_ = q.TouchSession(ctx, row.SessionID)
	}

	return &UserSession{
		UserID:    row.UID,
		Email:     row.UEmail,
		Name:      row.UName,
		SessionID: row.SessionID,
		ExpiresAt: row.ExpiresAt.Time,
	}, nil
}

// RevokeToken marks the session row revoked. Idempotent.
func RevokeToken(ctx context.Context, db *pgxpool.Pool, authHeader string) error {
	hash := hashFromBearer(authHeader)
	if hash == "" {
		return ErrInvalidSession
	}
	return store.New(db).RevokeSessionByTokenHash(ctx, hash)
}

// PruneExpired deletes expired and long-revoked Session rows.
func PruneExpired(ctx context.Context, db *pgxpool.Pool) (int64, error) {
	return store.New(db).PruneExpiredSessions(ctx)
}
