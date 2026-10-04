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
//
// # i18n
//
// The 401 is written in the request's language, which matters more here than
// anywhere else in the service: this middleware guards every authenticated route
// (devices, subscriptions, backup, AI, shares, the action queue), so a hardcoded
// Vietnamese sentence meant that a client holding an expired token got Vietnamese
// back from endpoints that were otherwise fully converted. It was left alone
// through four waves for exactly that reason — translating it flips the wording
// of every domain at once — and wave 5 is the wave that owns it.
//
// i18n.Attach resolves `?lang=` and Accept-Language. Level 3 of the precedence
// chain (the stored preference) is unavailable BY CONSTRUCTION here: the whole
// point of this branch is that no User row was resolved, so there is no
// `User.locale` to read. A client that wants its saved preference honoured on an
// expired token has to send a request signal, which is the only honest answer.
func RequireUser(db *pgxpool.Pool) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ctx := i18n.Attach(r)
			authHeader := r.Header.Get("Authorization")
			if authHeader == "" {
				httpx.WriteErrorC(w, ctx, http.StatusUnauthorized, "unauthorized",
					i18n.Text(ctx, "Bạn chưa đăng nhập"), nil)
				return
			}
			us, err := VerifyBearer(ctx, db, authHeader)
			if err != nil {
				if !errors.Is(err, ErrInvalidSession) {
					slog.Error("verify bearer failed", "err", err)
				}
				httpx.WriteErrorC(w, ctx, http.StatusUnauthorized, "unauthorized",
					i18n.Text(ctx, "Bạn chưa đăng nhập"), nil)
				return
			}
			ctx = context.WithValue(ctx, userKey, us)
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
