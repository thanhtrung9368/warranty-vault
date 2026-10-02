// Package services / profile.go — the PATCH /api/v1/auth/me write path.
//
// Scope note: this endpoint edits the *display name* only. Changing the account
// email has its own two-step verification flow (POST /api/v1/auth/change-email →
// token emailed to the NEW address → POST /api/v1/auth/confirm-email-change),
// implemented in handlers/auth.go on top of the PasswordReset table
// (`pendingEmail`, migration 0009). This handler still rejects an `email` /
// `newEmail` field — with a Vietnamese fieldError that now points at those
// endpoints — so a client that tries the wrong surface gets a clear answer
// instead of a silent no-op.

package services

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	store "github.com/thanhtrung9368/warranty-vault/api/internal/store/gen"
)

// MaxDisplayNameBytes mirrors the register handler's cap
// (handlers/auth.go::Register: `len(trimmed) > 80` → "Tên không được quá 80 ký
// tự"). It is a *byte* cap, not a rune cap, because that is what register has
// always enforced; clients must apply the same rule to stay in sync.
const MaxDisplayNameBytes = 80

// NormalizeDisplayName validates and normalizes the `displayName` field of a
// PATCH /api/v1/auth/me body.
//
//	raw     — the decoded JSON value: nil for `null` or a JSON string pointer
//	present — whether the key existed in the body at all
//
// Returns nil (→ SQL NULL) when the caller wants to CLEAR the name: both an
// explicit `"displayName": null` and an empty / whitespace-only string clear it.
// Empty-clears was chosen over rejecting "" because it matches how Register
// already treats a blank `name` (blank → NULL) and because web form encoders
// naturally send "" for an emptied text input; requiring null would make
// "xoá tên" silently fail for those clients.
//
// A body with no `displayName` key at all is rejected (not a silent no-op) so a
// client bug — wrong field name — surfaces immediately.
func NormalizeDisplayName(raw *string, present bool) (*string, error) {
	if !present {
		return nil, ErrValidation(FieldErrors{"displayName": {"Thiếu displayName"}})
	}
	if raw == nil {
		return nil, nil
	}
	v := strings.TrimSpace(*raw)
	if len(v) > MaxDisplayNameBytes {
		return nil, ErrValidation(FieldErrors{"displayName": {"Tên không được quá 80 ký tự"}})
	}
	if v == "" {
		return nil, nil
	}
	return &v, nil
}

// UpdateDisplayName writes the (already normalized) name and returns the fresh
// User row so the handler can answer with the same DTO shape as GET /auth/me.
func UpdateDisplayName(ctx context.Context, db *pgxpool.Pool, userID string, name *string) (store.User, error) {
	u, err := store.New(db).UpdateUserDisplayName(ctx, store.UpdateUserDisplayNameParams{
		ID:   userID,
		Name: name,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// A valid session always has a user row (FK), so this only happens if
			// the account was deleted mid-request.
			return store.User{}, ErrNotFound("Không tìm thấy người dùng")
		}
		return store.User{}, fmt.Errorf("update display name: %w", err)
	}
	return u, nil
}
