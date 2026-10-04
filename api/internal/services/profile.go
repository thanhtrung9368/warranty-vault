// Package services / profile.go — the PATCH /api/v1/auth/me write path.
//
// Scope note: this endpoint edits the *display name* and the *language
// preference* only. Changing the account email has its own two-step verification
// flow (POST /api/v1/auth/change-email → token emailed to the NEW address →
// POST /api/v1/auth/confirm-email-change), implemented in handlers/auth.go on top
// of the PasswordReset table (`pendingEmail`, migration 0009). This handler still
// rejects an `email` / `newEmail` field — with a fieldError that now points at
// those endpoints — so a client that tries the wrong surface gets a clear answer
// instead of a silent no-op.
//
// Both fields follow the SAME tri-state convention, which is the whole reason
// `NormalizeDisplayName` and `NormalizeLocale` take a `present` flag rather than
// just a pointer:
//
//	key absent in the JSON body → leave the stored value ALONE
//	"key": null                 → CLEAR it (SQL NULL)
//	"key": ""                   → CLEAR it (matches how Register treats a blank name)
//	"key": "<value>"            → set it
//
// The absent case is not cosmetic. Every client in the field today sends only
// `displayName`, so a naive `SET locale = $n` would reset the language preference
// on every display-name edit.
//
// # i18n
//
// This file is part of the converted auth slice (docs/I18N_PLAN.md §3, Phase 0):
// its two user-facing strings are rendered through internal/i18n. Every other
// file in this package still returns Vietnamese literals and is Phase 1's job.

package services

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/thanhtrung9368/warranty-vault/api/internal/i18n"
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
// Returns (nil, false) when the key was absent: "leave the stored name alone".
// The handler decides whether a body with neither accepted field is an error —
// it now accepts `{"locale": "vi"}` on its own, so "no displayName" is no longer
// the same question as "nothing to do".
//
// Returns (*nil, true) when the caller wants to CLEAR the name: both an explicit
// `"displayName": null` and an empty / whitespace-only string clear it.
// Empty-clears was chosen over rejecting "" because it matches how Register
// already treats a blank `name` (blank → NULL) and because web form encoders
// naturally send "" for an emptied text input; requiring null would make
// "xoá tên" silently fail for those clients.
//
// The messages are rendered in the language resolved for ctx.
func NormalizeDisplayName(ctx context.Context, raw *string, present bool) (*string, bool, error) {
	if !present {
		return nil, false, nil
	}
	if raw == nil {
		return nil, true, nil
	}
	v := strings.TrimSpace(*raw)
	if len(v) > MaxDisplayNameBytes {
		return nil, false, ErrValidationKeyed("Tên không được quá 80 ký tự",
			FieldErrors{"displayName": {i18n.Text(ctx, "Tên không được quá 80 ký tự")}})
	}
	if v == "" {
		return nil, true, nil
	}
	return &v, true, nil
}

// NormalizeLocale validates the `locale` field of the same body, under the same
// tri-state rules as the display name:
//
//	absent         → (nil, false, nil)   leave the stored preference alone
//	null or ""     → (nil, true, nil)    clear it → NULL → the request decides again
//	"en" / "vi"    → (&"en", true, nil)  store it
//	anything else  → validation error, in the request's language
//
// An explicit `null` CLEARS rather than errors because that is the only way a
// client can undo a choice and get back to "follow my phone's language", and
// because it is what `displayName` already does next to it. An unsupported VALUE
// is a 400 rather than a silent clear: "fr" is a client bug (or a language we do
// not ship), and silently storing NULL would leave the user wondering why the
// setting never sticks.
//
// `i18n.Normalize` accepts the shapes a real client sends — "vi", "VI", "vi-VN",
// "en-US" — and stores the base two-letter code, which is the shape the column
// accepts (migration 0014).
func NormalizeLocale(ctx context.Context, raw *string, present bool) (*string, bool, error) {
	if !present {
		return nil, false, nil
	}
	if raw == nil {
		return nil, true, nil
	}
	v := strings.TrimSpace(*raw)
	if v == "" {
		return nil, true, nil
	}
	tag, ok := i18n.Normalize(v)
	if !ok {
		return nil, false, ErrValidationKeyed("Ngôn ngữ không hợp lệ",
			FieldErrors{"locale": {i18n.Text(ctx, "Ngôn ngữ không hợp lệ")}})
	}
	code := string(tag)
	return &code, true, nil
}

// SupportedLocales renders the accepted `locale` values for the fieldError hint
// and for openapi. Derived from i18n.Supported rather than hard-coded so adding a
// language to the catalog cannot leave the message lying.
func SupportedLocales() string {
	parts := make([]string, 0, len(i18n.Supported))
	for _, tag := range i18n.Supported {
		parts = append(parts, string(tag))
	}
	return strings.Join(parts, ", ")
}

// UpdateProfile writes the (already normalized) fields and returns the fresh User
// row so the handler can answer with the same DTO shape as GET /auth/me.
//
// Either field may be "unchanged": pass changed=false and the column keeps its
// current contents. Passing changed=true with a nil value CLEARS it.
func UpdateProfile(ctx context.Context, db *pgxpool.Pool, userID string, name *string, nameChanged bool, locale *string, localeChanged bool) (store.User, error) {
	u, err := store.New(db).UpdateUserProfile(ctx, store.UpdateUserProfileParams{
		ID:            userID,
		Name:          name,
		Locale:        locale,
		NamePresent:   nameChanged,
		LocalePresent: localeChanged,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// A valid session always has a user row (FK), so this only happens if
			// the account was deleted mid-request.
			return store.User{}, ErrNotFound(i18n.Text(ctx, "Không tìm thấy người dùng"))
		}
		return store.User{}, fmt.Errorf("update profile: %w", err)
	}
	return u, nil
}
