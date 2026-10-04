package auth

import (
	"context"
	"errors"
	"log/slog"
	"net/http"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/thanhtrung9368/warranty-vault/api/internal/httpx"
	"github.com/thanhtrung9368/warranty-vault/api/internal/i18n"
)

type ctxKey string

const userKey ctxKey = "wv_user"

// RequireUser is a middleware that resolves the bearer token, attaches the
// resulting *UserSession to the request context, and 401s on miss.
func RequireUser(db *pgxpool.Pool) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			authHeader := r.Header.Get("Authorization")
			if authHeader == "" {
				httpx.WriteError(w, http.StatusUnauthorized, "unauthorized", "Bạn chưa đăng nhập", nil)
				return
			}
			us, err := VerifyBearer(r.Context(), db, authHeader)
			if err != nil {
				if !errors.Is(err, ErrInvalidSession) {
					slog.Error("verify bearer failed", "err", err)
				}
				httpx.WriteError(w, http.StatusUnauthorized, "unauthorized", "Bạn chưa đăng nhập", nil)
				return
			}
			ctx := context.WithValue(r.Context(), userKey, us)
			// Level 3 of the locale precedence chain: the stored preference is
			// only known once the bearer token resolved, so it is attached here.
			// WithUserLocale is a no-op when the request already decided (an
			// explicit Accept-Language or ?lang=), which is what keeps the
			// documented order — request signals beat the stored preference.
			ctx = i18n.WithUserLocale(ctx, us.Locale)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// UserFromContext retrieves the *UserSession set by RequireUser.
func UserFromContext(ctx context.Context) (*UserSession, bool) {
	v, ok := ctx.Value(userKey).(*UserSession)
	return v, ok
}
