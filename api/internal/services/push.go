package services

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/thanhtrung9368/warranty-vault/api/internal/auth"
	"github.com/thanhtrung9368/warranty-vault/api/internal/i18n"
	store "github.com/thanhtrung9368/warranty-vault/api/internal/store/gen"
)

// PushPlatform enumerates the values the DB accepts in PushSubscription.platform.
// Mirrors website/src/lib/services/push.ts.
const (
	PushPlatformWeb  = "web"
	PushPlatformAPNs = "apns"
	PushPlatformFCM  = "fcm"
)

// PushInput is the union shape the registration endpoint accepts. Mirrors
// the discriminated `webPushInputSchema | nativePushInputSchema` in TS.
//
// Web:    Platform="web", Endpoint=URL, P256dh, Auth.
// Native: Platform="apns"|"fcm", Endpoint = "<platform>://<token>". P256dh/Auth nil.
//
// The handler is responsible for synthesizing Endpoint from a `token` field
// when a native client posts the simpler shape.
type PushInput struct {
	Platform  string  `json:"platform"`
	Endpoint  string  `json:"endpoint"`
	P256dh    *string `json:"p256dh,omitempty"`
	Auth      *string `json:"auth,omitempty"`
	UserAgent *string `json:"userAgent,omitempty"`
}

// PushSubscriptionDTO is the slimmed-down list response. Mirrors the TS
// `select` projection in `listMySubscriptions`.
type PushSubscriptionDTO struct {
	ID        string  `json:"id"`
	Endpoint  string  `json:"endpoint"`
	Platform  string  `json:"platform"`
	UserAgent *string `json:"userAgent"`
	CreatedAt string  `json:"createdAt"`
}

// ValidatePushInput hand-rolls the same validation as the Zod union. Trims
// whitespace; populates Endpoint from a bare token for native rows; returns
// an Error{VALIDATION} on bad input.
//
// It takes a context because every field error below is a sentence a person
// reads, and the envelope headline has to be in the same language as the
// per-field hints under it (ErrValidationHeadline is what keeps those together —
// the plain ErrValidation would leave "Dữ liệu không hợp lệ" in Vietnamese above
// English field errors).
func ValidatePushInput(ctx context.Context, in *PushInput) error {
	in.Platform = strings.TrimSpace(in.Platform)
	if in.Platform == "" {
		in.Platform = PushPlatformWeb
	}
	in.Endpoint = strings.TrimSpace(in.Endpoint)
	trimPtr(&in.UserAgent)
	trimPtr(&in.P256dh)
	trimPtr(&in.Auth)

	fe := FieldErrors{}
	switch in.Platform {
	case PushPlatformWeb:
		if in.Endpoint == "" {
			fe["endpoint"] = []string{i18n.Text(ctx, "Bắt buộc")}
		}
		if in.P256dh == nil || *in.P256dh == "" {
			fe["p256dh"] = []string{i18n.Text(ctx, "Bắt buộc")}
		}
		if in.Auth == nil || *in.Auth == "" {
			fe["auth"] = []string{i18n.Text(ctx, "Bắt buộc")}
		}
	case PushPlatformAPNs, PushPlatformFCM:
		// For native, `Endpoint` should already be `<platform>://<token>`
		// (handler synthesizes it). Verify the token portion is non-empty.
		prefix := in.Platform + "://"
		if !strings.HasPrefix(in.Endpoint, prefix) || strings.TrimSpace(strings.TrimPrefix(in.Endpoint, prefix)) == "" {
			fe["endpoint"] = []string{i18n.Text(ctx, "Token thiết bị không hợp lệ")}
		}
		// Native rows must NOT carry crypto fields.
		in.P256dh = nil
		in.Auth = nil
	default:
		fe["platform"] = []string{i18n.Text(ctx, "Nền tảng không hợp lệ")}
	}
	if in.UserAgent != nil && len(*in.UserAgent) > 500 {
		fe["userAgent"] = []string{i18n.Text(ctx, "Tối đa 500 ký tự")}
	}

	if len(fe) > 0 {
		return ErrValidationHeadline(fe)
	}
	return nil
}

// SubscribePush upserts the (userId, endpoint) row. Mirrors `subscribePush`
// in website/src/lib/services/push.ts. Returns the resulting row.
func SubscribePush(ctx context.Context, db *pgxpool.Pool, userID string, in PushInput) (store.PushSubscription, error) {
	if err := ValidatePushInput(ctx, &in); err != nil {
		return store.PushSubscription{}, err
	}

	q := store.New(db)
	row, err := q.UpsertPushSubscription(ctx, store.UpsertPushSubscriptionParams{
		ID:        auth.NewID(),
		UserId:    userID,
		Endpoint:  in.Endpoint,
		Platform:  in.Platform,
		P256dh:    in.P256dh,
		Auth:      in.Auth,
		UserAgent: in.UserAgent,
	})
	if err != nil {
		return store.PushSubscription{}, fmt.Errorf("upsert push subscription: %w", err)
	}
	return row, nil
}

// ListPushSubscriptions mirrors `listMySubscriptions`. Always returns a
// non-nil slice for stable JSON.
func ListPushSubscriptions(ctx context.Context, db *pgxpool.Pool, userID string) ([]PushSubscriptionDTO, error) {
	q := store.New(db)
	rows, err := q.ListPushSubscriptionsByUser(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("list push subscriptions: %w", err)
	}
	out := make([]PushSubscriptionDTO, 0, len(rows))
	for _, r := range rows {
		dto := PushSubscriptionDTO{
			ID:        r.ID,
			Endpoint:  r.Endpoint,
			Platform:  r.Platform,
			UserAgent: r.UserAgent,
		}
		if r.CreatedAt.Valid {
			dto.CreatedAt = r.CreatedAt.Time.UTC().Format("2006-01-02T15:04:05.000Z")
		}
		out = append(out, dto)
	}
	return out, nil
}

// DeletePushSubscriptionByID mirrors `deleteSubscriptionById`. Verifies
// ownership via the (id, userId) WHERE clause. Returns NOT_FOUND when the
// row is absent or owned by someone else.
func DeletePushSubscriptionByID(ctx context.Context, db *pgxpool.Pool, userID, id string) error {
	id = strings.TrimSpace(id)
	if id == "" {
		return ErrNotFound(i18n.Text(ctx, "Không tìm thấy đăng ký"))
	}
	q := store.New(db)
	// Ownership check via GetPushSubscriptionByID (id + userId). Returning
	// the same NOT_FOUND for both "missing" and "owned by another user"
	// matches the TS behavior + avoids leaking existence.
	if _, err := q.GetPushSubscriptionByID(ctx, store.GetPushSubscriptionByIDParams{
		ID:     id,
		UserId: userID,
	}); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound(i18n.Text(ctx, "Không tìm thấy đăng ký"))
		}
		return fmt.Errorf("get push subscription: %w", err)
	}
	if _, err := q.DeletePushSubscriptionByID(ctx, store.DeletePushSubscriptionByIDParams{
		ID:     id,
		UserId: userID,
	}); err != nil {
		return fmt.Errorf("delete push subscription: %w", err)
	}
	return nil
}

// DeletePushSubscriptionByEndpoint mirrors `unsubscribePush`. Used when a
// client unregisters by endpoint string instead of id. No-op when the row
// is absent (matches TS deleteMany semantics).
func DeletePushSubscriptionByEndpoint(ctx context.Context, db *pgxpool.Pool, userID, endpoint string) error {
	endpoint = strings.TrimSpace(endpoint)
	if endpoint == "" {
		return ErrValidationKeyed(i18n.Text(ctx, "Bắt buộc"),
			FieldErrors{"endpoint": {i18n.Text(ctx, "Bắt buộc")}})
	}
	q := store.New(db)
	if _, err := q.DeletePushSubscriptionByEndpoint(ctx, store.DeletePushSubscriptionByEndpointParams{
		Endpoint: endpoint,
		UserId:   userID,
	}); err != nil {
		return fmt.Errorf("delete push subscription by endpoint: %w", err)
	}
	return nil
}
