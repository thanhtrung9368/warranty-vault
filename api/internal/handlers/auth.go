package handlers

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/thanhtrung9368/warranty-vault/api/internal/ai"
	"github.com/thanhtrung9368/warranty-vault/api/internal/auth"
	"github.com/thanhtrung9368/warranty-vault/api/internal/email"
	"github.com/thanhtrung9368/warranty-vault/api/internal/files"
	"github.com/thanhtrung9368/warranty-vault/api/internal/httpx"
	"github.com/thanhtrung9368/warranty-vault/api/internal/i18n"
	"github.com/thanhtrung9368/warranty-vault/api/internal/push"
	"github.com/thanhtrung9368/warranty-vault/api/internal/ratelimit"
	"github.com/thanhtrung9368/warranty-vault/api/internal/services"
	store "github.com/thanhtrung9368/warranty-vault/api/internal/store/gen"
)

// Deps bundles the per-process dependencies the handler closures capture.
type Deps struct {
	DB         *pgxpool.Pool
	Limiter    ratelimit.Limiter
	Email      *email.Client
	Dispatcher *push.Dispatcher
	AI         *ai.Client
}

// ---- response shapes -------------------------------------------------------

type userDTO struct {
	ID      string  `json:"id"`
	Email   string  `json:"email"`
	Name    *string `json:"name"`
	AiOptIn bool    `json:"aiOptIn"`
	// Locale is the stored language preference (migration 0014), or nil when the
	// user has never chosen one.
	//
	// `omitempty` is deliberate and additive: every existing client ignores
	// unknown fields, but a null-valued `"locale": null` on every response would
	// also change the bytes of GET /auth/me for users who never set it. It is
	// serialised as soon as the user picks a language — and the three clients need
	// it to render which option is currently selected. Contrast `Name`, which has
	// always been emitted as null; that shape is frozen.
	Locale *string `json:"locale,omitempty"`
}

type authTokenResponse struct {
	AccessToken string  `json:"accessToken"`
	ExpiresAt   string  `json:"expiresAt"`
	User        userDTO `json:"user"`
}

// ---- helpers ---------------------------------------------------------------

func decodeJSON(r *http.Request, dst any) error {
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	return dec.Decode(dst)
}

// decodeJSONLoose decodes the body without rejecting unknown fields. Used when
// callers expect extra envelope fields they don't care about.
func decodeJSONLoose(r *http.Request, dst any) error {
	return json.NewDecoder(r.Body).Decode(dst)
}

// remarshal round-trips a generic decoded body through JSON to populate a
// strongly-typed struct. Used by handlers that accept extra optional fields
// (e.g. fromWishlistId) alongside the typed input schema, where the strict
// `DisallowUnknownFields` decode would otherwise reject those extras.
func remarshal(src, dst any) error {
	b, err := json.Marshal(src)
	if err != nil {
		return err
	}
	return json.Unmarshal(b, dst)
}

// badJSONBody / badInput / rateLimited / unauthorized are shared by every handler
// file in this package, so the context argument they now take is about the
// Content-Language header, not about the language of the body: only the auth
// slice is converted in Phase 0, and the two messages below are the generic
// envelope text every endpoint sends.
//
// badInput's message is supplied by the CALLER, which is what lets the converted
// auth handlers pass translated copy while an unconverted caller keeps passing
// Vietnamese. Phase 1 converts the rest.
func badJSONBody(w http.ResponseWriter, ctx context.Context) {
	httpx.WriteErrorC(w, ctx, http.StatusBadRequest, "bad_input", i18n.Text(ctx, "Body phải là JSON hợp lệ"), nil)
}

func badInput(w http.ResponseWriter, ctx context.Context, fieldErrors map[string][]string, message ...string) {
	msg := i18n.Text(ctx, "Dữ liệu không hợp lệ")
	if len(message) > 0 && message[0] != "" {
		msg = message[0]
	}
	httpx.WriteErrorC(w, ctx, http.StatusBadRequest, "bad_input", msg, fieldErrors)
}

func rateLimited(w http.ResponseWriter, ctx context.Context, retryAfterSec int) {
	w.Header().Set("Retry-After", strconvItoa(retryAfterSec))
	msg := i18n.T(ctx, "Thao tác quá nhanh. Đợi %s", ratelimit.FormatRetry(retryAfterSec))
	httpx.WriteErrorC(w, ctx, http.StatusTooManyRequests, "rate_limited", msg, nil)
}

func unauthorized(w http.ResponseWriter, ctx context.Context) {
	httpx.WriteErrorC(w, ctx, http.StatusUnauthorized, "unauthorized", i18n.Text(ctx, "Bạn chưa đăng nhập"), nil)
}

func strconvItoa(n int) string {
	if n == 0 {
		return "0"
	}
	neg := false
	if n < 0 {
		neg = true
		n = -n
	}
	var buf [20]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		buf[i] = '-'
	}
	return string(buf[i:])
}

// validateEmail performs cheap RFC-ish validation matching the strictness
// of Zod's z.string().email().
func validateEmail(s string) bool {
	s = strings.TrimSpace(s)
	if s == "" || len(s) > 254 {
		return false
	}
	at := strings.IndexByte(s, '@')
	if at <= 0 || at == len(s)-1 {
		return false
	}
	local, domain := s[:at], s[at+1:]
	if local == "" || domain == "" {
		return false
	}
	if !strings.Contains(domain, ".") {
		return false
	}
	if strings.Contains(local, " ") || strings.Contains(domain, " ") {
		return false
	}
	return true
}

// ---- POST /api/v1/auth/register ------------------------------------------------

type registerRequest struct {
	Email       string  `json:"email"`
	Name        *string `json:"name"`
	Password    string  `json:"password"`
	DeviceLabel *string `json:"deviceLabel"`
	Platform    *string `json:"platform"`
}

func Register(d Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Resolve ?lang= / Accept-Language here so the envelope helpers below
		// render in the request's language even when this handler is invoked
		// directly (handler tests) rather than through httpx's middleware chain.
		ctx := i18n.Attach(r)
		var body registerRequest
		if err := decodeJSON(r, &body); err != nil {
			badJSONBody(w, ctx)
			return
		}

		fieldErrors := map[string][]string{}
		emailNorm := strings.ToLower(strings.TrimSpace(body.Email))
		if !validateEmail(emailNorm) {
			fieldErrors["email"] = []string{i18n.Text(ctx, "Email không hợp lệ")}
		}
		if len(body.Password) < 8 {
			fieldErrors["password"] = []string{i18n.Text(ctx, "Mật khẩu tối thiểu 8 ký tự")}
		} else if len(body.Password) > 200 {
			fieldErrors["password"] = []string{i18n.Text(ctx, "Mật khẩu không được quá 200 ký tự")}
		}
		var name *string
		if body.Name != nil {
			trimmed := strings.TrimSpace(*body.Name)
			if len(trimmed) > 80 {
				fieldErrors["name"] = []string{i18n.Text(ctx, "Tên không được quá 80 ký tự")}
			}
			if trimmed != "" {
				name = &trimmed
			}
		}
		platform := normalizePlatform(body.Platform)
		if body.Platform != nil && platform == nil && *body.Platform != "" {
			fieldErrors["platform"] = []string{i18n.Text(ctx, "Platform không hợp lệ")}
		}
		if len(fieldErrors) > 0 {
			badInput(w, ctx, fieldErrors)
			return
		}

		rl, _ := ratelimit.CheckAuth(r.Context(), d.Limiter, "register",
			ratelimit.GetClientIP(r), emailNorm)
		if !rl.Ok {
			rateLimited(w, ctx, rl.RetryAfterSec)
			return
		}

		q := store.New(d.DB)
		existing, err := q.GetUserByEmail(r.Context(), emailNorm)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			slog.Error("get user by email", "err", err)
			httpx.WriteErrorC(w, ctx, http.StatusInternalServerError, "internal_error", i18n.Text(ctx, "Lỗi hệ thống"), nil)
			return
		}
		if err == nil {
			_ = existing
			// Burn equivalent hash time so response latency does not leak existence.
			_, _ = auth.Hash(body.Password)
			httpx.WriteJSON(w, http.StatusOK, map[string]any{
				"ok":      true,
				"message": i18n.Text(ctx, "Nếu email chưa đăng ký, tài khoản đã được tạo. Nếu đã có, vào đăng nhập hoặc quên mật khẩu."),
			})
			return
		}

		hash, err := auth.Hash(body.Password)
		if err != nil {
			slog.Error("bcrypt hash failed", "err", err)
			httpx.WriteErrorC(w, ctx, http.StatusInternalServerError, "internal_error", i18n.Text(ctx, "Lỗi hệ thống"), nil)
			return
		}
		user, err := q.CreateUser(r.Context(), store.CreateUserParams{
			ID:           auth.NewID(),
			Email:        emailNorm,
			PasswordHash: hash,
			Name:         name,
		})
		if err != nil {
			slog.Error("create user failed", "err", err)
			httpx.WriteErrorC(w, ctx, http.StatusInternalServerError, "internal_error", i18n.Text(ctx, "Lỗi hệ thống"), nil)
			return
		}

		issued, err := auth.IssueToken(r.Context(), d.DB, user.ID,
			ptrIfNotEmptyOrPassthrough(body.DeviceLabel), platform)
		if err != nil {
			slog.Error("issue token failed", "err", err)
			httpx.WriteErrorC(w, ctx, http.StatusInternalServerError, "internal_error", i18n.Text(ctx, "Lỗi hệ thống"), nil)
			return
		}

		httpx.WriteJSON(w, http.StatusCreated, authTokenResponse{
			AccessToken: issued.AccessToken,
			ExpiresAt:   issued.ExpiresAt.UTC().Format(time.RFC3339Nano),
			User:        userDTO{ID: user.ID, Email: user.Email, Name: user.Name, AiOptIn: user.AiOptIn, Locale: user.Locale},
		})
	}
}

func normalizePlatform(in *string) *string {
	if in == nil {
		return nil
	}
	v := strings.TrimSpace(*in)
	switch v {
	case "ios", "android", "web":
		return &v
	default:
		return nil
	}
}

func ptrIfNotEmptyOrPassthrough(in *string) *string {
	if in == nil {
		return nil
	}
	v := strings.TrimSpace(*in)
	if v == "" {
		return nil
	}
	if len(v) > 80 {
		v = v[:80]
	}
	return &v
}

// ---- POST /api/v1/auth/login ---------------------------------------------------

type loginRequest struct {
	Email       string  `json:"email"`
	Password    string  `json:"password"`
	DeviceLabel *string `json:"deviceLabel"`
	Platform    *string `json:"platform"`
}

func Login(d Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Resolve ?lang= / Accept-Language here so the envelope helpers below
		// render in the request's language even when this handler is invoked
		// directly (handler tests) rather than through httpx's middleware chain.
		ctx := i18n.Attach(r)
		var body loginRequest
		if err := decodeJSON(r, &body); err != nil {
			badJSONBody(w, ctx)
			return
		}

		fieldErrors := map[string][]string{}
		emailNorm := strings.ToLower(strings.TrimSpace(body.Email))
		if !validateEmail(emailNorm) {
			fieldErrors["email"] = []string{i18n.Text(ctx, "Email không hợp lệ")}
		}
		if body.Password == "" {
			fieldErrors["password"] = []string{i18n.Text(ctx, "Nhập mật khẩu")}
		}
		platform := normalizePlatform(body.Platform)
		if body.Platform != nil && platform == nil && *body.Platform != "" {
			fieldErrors["platform"] = []string{i18n.Text(ctx, "Platform không hợp lệ")}
		}
		if len(fieldErrors) > 0 {
			badInput(w, ctx, fieldErrors)
			return
		}

		rl, _ := ratelimit.CheckAuth(r.Context(), d.Limiter, "login",
			ratelimit.GetClientIP(r), emailNorm)
		if !rl.Ok {
			rateLimited(w, ctx, rl.RetryAfterSec)
			return
		}

		q := store.New(d.DB)
		user, err := q.GetUserByEmail(r.Context(), emailNorm)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				httpx.WriteErrorC(w, ctx, http.StatusUnauthorized, "invalid_credentials",
					i18n.Text(ctx, "Email hoặc mật khẩu không đúng"), nil)
				return
			}
			slog.Error("get user by email", "err", err)
			httpx.WriteErrorC(w, ctx, http.StatusInternalServerError, "internal_error", i18n.Text(ctx, "Lỗi hệ thống"), nil)
			return
		}
		if !auth.Verify(body.Password, user.PasswordHash) {
			httpx.WriteErrorC(w, ctx, http.StatusUnauthorized, "invalid_credentials",
				i18n.Text(ctx, "Email hoặc mật khẩu không đúng"), nil)
			return
		}

		issued, err := auth.IssueToken(r.Context(), d.DB, user.ID,
			ptrIfNotEmptyOrPassthrough(body.DeviceLabel), platform)
		if err != nil {
			slog.Error("issue token failed", "err", err)
			httpx.WriteErrorC(w, ctx, http.StatusInternalServerError, "internal_error", i18n.Text(ctx, "Lỗi hệ thống"), nil)
			return
		}

		httpx.WriteJSON(w, http.StatusOK, authTokenResponse{
			AccessToken: issued.AccessToken,
			ExpiresAt:   issued.ExpiresAt.UTC().Format(time.RFC3339Nano),
			User:        userDTO{ID: user.ID, Email: user.Email, Name: user.Name, AiOptIn: user.AiOptIn, Locale: user.Locale},
		})
	}
}

// ---- POST /api/v1/auth/logout --------------------------------------------------

func Logout(d Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Resolve ?lang= / Accept-Language here so the envelope helpers below
		// render in the request's language even when this handler is invoked
		// directly (handler tests) rather than through httpx's middleware chain.
		ctx := i18n.Attach(r)
		header := r.Header.Get("Authorization")
		if header == "" {
			unauthorized(w, ctx)
			return
		}
		// Idempotent: returns nil even if the token was already revoked or
		// never existed. The client should still drop it locally.
		if err := auth.RevokeToken(r.Context(), d.DB, header); err != nil {
			if errors.Is(err, auth.ErrInvalidSession) {
				unauthorized(w, ctx)
				return
			}
			slog.Error("revoke token failed", "err", err)
			httpx.WriteErrorC(w, ctx, http.StatusInternalServerError, "internal_error", i18n.Text(ctx, "Lỗi hệ thống"), nil)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, map[string]bool{"ok": true})
	}
}

// ---- GET /api/v1/auth/me -------------------------------------------------------

func Me(d Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Resolve ?lang= / Accept-Language here so the envelope helpers below
		// render in the request's language even when this handler is invoked
		// directly (handler tests) rather than through httpx's middleware chain.
		ctx := i18n.Attach(r)
		us, err := auth.VerifyBearer(r.Context(), d.DB, r.Header.Get("Authorization"))
		if err != nil {
			unauthorized(w, ctx)
			return
		}
		// aiOptIn and locale live on the User row, not on the session — read them
		// so clients can render the Settings toggle state and the language picker.
		//
		// The session DOES carry locale (GetSessionByTokenHash selects it, so the
		// auth middleware can seed the i18n precedence chain), but the row is read
		// anyway for aiOptIn. Both answers come from this one row so the response
		// can never disagree with what the middleware resolved.
		aiOptIn := false
		var locale *string
		if u, uerr := store.New(d.DB).GetUserByID(r.Context(), us.UserID); uerr == nil {
			aiOptIn = u.AiOptIn
			locale = u.Locale
		}
		httpx.WriteJSONC(w, ctx, http.StatusOK, map[string]userDTO{
			"user": {ID: us.UserID, Email: us.Email, Name: us.Name, AiOptIn: aiOptIn, Locale: locale},
		})
	}
}

// ---- PATCH /api/v1/auth/me ----------------------------------------------------
//
// Partial profile update. ONLY `displayName` is accepted. Changing the account
// email is deliberately NOT supported in this pass: it needs a two-step
// verification flow (prove control of the new address, then re-authenticate)
// and is tracked separately. A request carrying `email` / `newEmail` is
// rejected with a Vietnamese fieldError rather than silently ignored, so the
// three clients get an unambiguous answer. See openapi.yaml + api/README.md.
//
// Body:
//
//	{ "displayName": "Nguyễn Văn A" }   → set (trimmed)
//	{ "displayName": "" }               → clear (same as null)
//	{ "displayName": null }             → clear
//
// Responds with the same `{ "user": ... }` envelope as GET /auth/me so a client
// can replace its cached user object straight from the response.

// RegisterProfile wires PATCH /api/v1/auth/me. Registered separately from the
// other auth routes in main.go because this one uses the shared requireUser
// middleware (same as devices/attachments) instead of the older inline
// VerifyBearer pattern the pre-existing auth handlers use.
func RegisterProfile(mux *http.ServeMux, deps Deps) {
	requireUser := auth.RequireUser(deps.DB)
	mux.Handle("PATCH /api/v1/auth/me", requireUser(http.HandlerFunc(updateMeHandler(deps))))
}

func updateMeHandler(d Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Resolve ?lang= / Accept-Language here so the envelope helpers below
		// render in the request's language even when this handler is invoked
		// directly (handler tests) rather than through httpx's middleware chain.
		ctx := i18n.Attach(r)
		us, ok := auth.UserFromContext(r.Context())
		if !ok {
			unauthorized(w, ctx)
			return
		}

		rl, _ := ratelimit.CheckUserWrite(r.Context(), d.Limiter, us.UserID)
		if !rl.Ok {
			rateLimited(w, ctx, rl.RetryAfterSec)
			return
		}

		// Decode into a raw map first so we can (a) distinguish "key absent" from
		// "explicit null / empty string" and (b) answer unknown fields with a
		// field-level Vietnamese message instead of the generic bad-JSON one.
		var raw map[string]json.RawMessage
		if err := decodeJSON(r, &raw); err != nil {
			badJSONBody(w, ctx)
			return
		}

		unknown := map[string][]string{}
		for k := range raw {
			if k == "displayName" || k == "locale" {
				continue
			}
			if k == "email" || k == "newEmail" {
				unknown[k] = []string{i18n.Text(ctx, "Không đổi email ở đây. Dùng POST /api/v1/auth/change-email (cần mật khẩu hiện tại) rồi xác nhận bằng token gửi tới địa chỉ mới.")}
				continue
			}
			unknown[k] = []string{i18n.Text(ctx, "Trường không được hỗ trợ")}
		}
		if len(unknown) > 0 {
			badInput(w, ctx, unknown, i18n.Text(ctx, "Chỉ hỗ trợ sửa tên hiển thị. Đổi email có luồng riêng (change-email + confirm-email-change)."))
			return
		}

		// Both accepted fields are tri-state, and the two halves are read the same
		// way: ABSENT ("locale" not in the map) means leave the stored value alone,
		// while an explicit `null` or `""` clears it. A client that has never heard
		// of `locale` therefore cannot wipe a preference by editing its name.
		//
		// A body with NEITHER field is still rejected. That used to be enforced by
		// `displayName` being the only accepted key; now that `locale` exists, the
		// rule is stated directly, so an empty or mistyped body keeps failing
		// loudly instead of being a silent 200 that changed nothing. Each field
		// individually became optional purely so a language picker can send
		// `{"locale": "vi"}` without also restating the display name.
		rawName, namePresent := raw["displayName"]
		rawLocale, localePresent := raw["locale"]
		if !namePresent && !localePresent {
			badInput(w, ctx, map[string][]string{"displayName": {i18n.Text(ctx, "Thiếu displayName")}})
			return
		}
		var nameIn *string
		if namePresent {
			// `null` unmarshals to a nil *string without error; a number/object/
			// array/bool is rejected here.
			if err := json.Unmarshal(rawName, &nameIn); err != nil {
				badInput(w, ctx, map[string][]string{"displayName": {i18n.Text(ctx, "Tên hiển thị không hợp lệ")}})
				return
			}
		}
		name, nameChanged, verr := services.NormalizeDisplayName(ctx, nameIn, namePresent)
		if verr != nil {
			writeAuthServiceErr(w, ctx, verr, "validate display name")
			return
		}

		var localeIn *string
		if localePresent {
			if err := json.Unmarshal(rawLocale, &localeIn); err != nil {
				badInput(w, ctx, map[string][]string{"locale": {i18n.Text(ctx, "Ngôn ngữ không hợp lệ")}})
				return
			}
		}
		locale, localeChanged, lerr := services.NormalizeLocale(ctx, localeIn, localePresent)
		if lerr != nil {
			writeAuthServiceErr(w, ctx, lerr, "validate locale")
			return
		}

		user, uerr := services.UpdateProfile(ctx, d.DB, us.UserID,
			name, nameChanged, locale, localeChanged)
		if uerr != nil {
			writeAuthServiceErr(w, ctx, uerr, "update profile")
			return
		}

		httpx.WriteJSONC(w, ctx, http.StatusOK, map[string]any{
			"user":    userDTO{ID: user.ID, Email: user.Email, Name: user.Name, AiOptIn: user.AiOptIn, Locale: user.Locale},
			"message": i18n.Text(ctx, "Đã cập nhật hồ sơ"),
		})
	}
}

// translateKey renders a catalog key that arrived as DATA (a struct field)
// rather than as a literal at the call site. Split out purely so the printf
// analyzer does not read a variable as a caller-supplied format string: the key
// is never used as a format and no arguments are passed.
func translateKey(ctx context.Context, key string) string {
	return i18n.Text(ctx, key)
}

// writeAuthServiceErr maps a services.* domain error onto the shared JSON error
// envelope. Mirrors writeDevicesErr, kept local so auth.go doesn't depend on the
// devices handler file.
//
// A domain error carries its user-facing text twice when it has been converted:
// `MessageKey` names a catalog entry (rendered here in the request's language)
// and `Message` is the Vietnamese source that every unconverted service still
// sets. Rendering the key, when there is one, is what lets a service construct an
// error deep in a call stack with no request in scope and still have it reach the
// client in the right language.
func writeAuthServiceErr(w http.ResponseWriter, ctx context.Context, err error, op string) {
	var svc *services.Error
	if errors.As(err, &svc) {
		message := svc.Message
		if svc.MessageKey != "" {
			// A keyed error names its own message, so the envelope headline is the
			// field message rather than the generic "invalid input" — which is what
			// a single-field validation failure should read like for a client that
			// only renders `message`.
			// MessageKey is a catalog key carried on the error, not a literal at this
			// call site — exactly the shape `go vet`'s printf analyzer rejects for a
			// format-string wrapper. translateKey passes no arguments, so the format
			// contract is trivially satisfied.
			message = translateKey(ctx, svc.MessageKey)
		}
		httpx.WriteErrorC(w, ctx, svc.HTTPStatus(), strings.ToLower(svc.Code), message, svc.FieldErrors)
		return
	}
	slog.Error(op+" failed", "err", err)
	httpx.WriteErrorC(w, ctx, http.StatusInternalServerError, "internal_error", i18n.Text(ctx, "Lỗi hệ thống"), nil)
}

// ---- POST /api/v1/auth/forgot --------------------------------------------------

type forgotRequest struct {
	Email string `json:"email"`
}

const passwordResetTTLMin = 30

func Forgot(d Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Resolve ?lang= / Accept-Language here so the envelope helpers below
		// render in the request's language even when this handler is invoked
		// directly (handler tests) rather than through httpx's middleware chain.
		ctx := i18n.Attach(r)
		var body forgotRequest
		if err := decodeJSON(r, &body); err != nil {
			badJSONBody(w, ctx)
			return
		}
		emailNorm := strings.ToLower(strings.TrimSpace(body.Email))
		if !validateEmail(emailNorm) {
			badInput(w, ctx, map[string][]string{"email": {i18n.Text(ctx, "Email không hợp lệ")}})
			return
		}

		rl, _ := ratelimit.CheckAuth(r.Context(), d.Limiter, "forgot",
			ratelimit.GetClientIP(r), emailNorm)
		if !rl.Ok {
			rateLimited(w, ctx, rl.RetryAfterSec)
			return
		}

		q := store.New(d.DB)
		user, err := q.GetUserByEmail(r.Context(), emailNorm)
		// Never leak whether the email exists. Always reply 200 ok=true.
		if err == nil {
			rawToken, hash, terr := auth.NewTokenAndHash()
			if terr == nil {
				expires := time.Now().Add(passwordResetTTLMin * time.Minute)
				_, perr := q.CreatePasswordReset(r.Context(), store.CreatePasswordResetParams{
					ID:        auth.NewID(),
					UserId:    user.ID,
					TokenHash: hash,
					ExpiresAt: pgtype.Timestamp{Time: expires, Valid: true},
				})
				if perr == nil {
					appURL := os.Getenv("APP_URL")
					if appURL == "" {
						appURL = "http://localhost:3000"
					}
					link := strings.TrimRight(appURL, "/") + "/reset/" + rawToken
					if d.Email != nil {
						sendCtx, cancel := context.WithTimeout(context.Background(), 12*time.Second)
						go func() {
							defer cancel()
							if e := d.Email.SendPasswordReset(sendCtx, user.Email, link); e != nil {
								slog.Error("send password-reset email failed", "err", e)
							}
						}()
					} else {
						slog.Info("password-reset link (email client unavailable)",
							"to", user.Email, "link", link)
					}
				} else {
					slog.Error("create password reset failed", "err", perr)
				}
			}
		} else if !errors.Is(err, pgx.ErrNoRows) {
			slog.Error("forgot lookup failed", "err", err)
		}

		httpx.WriteJSON(w, http.StatusOK, map[string]bool{"ok": true})
	}
}

// ---- POST /api/v1/auth/change-password -----------------------------------------

type changePasswordRequest struct {
	CurrentPassword string `json:"currentPassword"`
	NewPassword     string `json:"newPassword"`
	ConfirmPassword string `json:"confirmPassword"`
}

func ChangePassword(d Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Resolve ?lang= / Accept-Language here so the envelope helpers below
		// render in the request's language even when this handler is invoked
		// directly (handler tests) rather than through httpx's middleware chain.
		ctx := i18n.Attach(r)
		us, err := auth.VerifyBearer(r.Context(), d.DB, r.Header.Get("Authorization"))
		if err != nil {
			unauthorized(w, ctx)
			return
		}

		rl, _ := ratelimit.CheckAuth(r.Context(), d.Limiter, "change-password",
			ratelimit.GetClientIP(r), us.UserID)
		if !rl.Ok {
			rateLimited(w, ctx, rl.RetryAfterSec)
			return
		}

		var body changePasswordRequest
		if err := decodeJSON(r, &body); err != nil {
			badJSONBody(w, ctx)
			return
		}

		fieldErrors := map[string][]string{}
		if body.CurrentPassword == "" {
			fieldErrors["currentPassword"] = []string{i18n.Text(ctx, "Nhập mật khẩu hiện tại")}
		}
		if len(body.NewPassword) < 8 {
			fieldErrors["newPassword"] = []string{i18n.Text(ctx, "Mật khẩu mới tối thiểu 8 ký tự")}
		} else if len(body.NewPassword) > 200 {
			fieldErrors["newPassword"] = []string{i18n.Text(ctx, "Mật khẩu không được quá 200 ký tự")}
		}
		if body.ConfirmPassword == "" {
			fieldErrors["confirmPassword"] = []string{i18n.Text(ctx, "Required")}
		}
		if len(fieldErrors) == 0 && body.NewPassword != body.ConfirmPassword {
			fieldErrors["confirmPassword"] = []string{i18n.Text(ctx, "Xác nhận mật khẩu không khớp")}
		}
		if len(fieldErrors) > 0 {
			badInput(w, ctx, fieldErrors)
			return
		}

		q := store.New(d.DB)
		row, err := q.GetUserByID(r.Context(), us.UserID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				httpx.WriteErrorC(w, ctx, http.StatusNotFound, "user_not_found", i18n.Text(ctx, "Không tìm thấy"), nil)
				return
			}
			slog.Error("get user by id", "err", err)
			httpx.WriteErrorC(w, ctx, http.StatusInternalServerError, "internal_error", i18n.Text(ctx, "Lỗi hệ thống"), nil)
			return
		}
		if !auth.Verify(body.CurrentPassword, row.PasswordHash) {
			badInput(w, ctx, map[string][]string{"currentPassword": {i18n.Text(ctx, "Mật khẩu hiện tại không đúng")}})
			return
		}

		newHash, err := auth.Hash(body.NewPassword)
		if err != nil {
			slog.Error("bcrypt hash failed", "err", err)
			httpx.WriteErrorC(w, ctx, http.StatusInternalServerError, "internal_error", i18n.Text(ctx, "Lỗi hệ thống"), nil)
			return
		}
		if err := q.UpdateUserPassword(r.Context(), store.UpdateUserPasswordParams{
			ID:           us.UserID,
			PasswordHash: newHash,
		}); err != nil {
			slog.Error("update password failed", "err", err)
			httpx.WriteErrorC(w, ctx, http.StatusInternalServerError, "internal_error", i18n.Text(ctx, "Lỗi hệ thống"), nil)
			return
		}

		httpx.WriteJSON(w, http.StatusOK, map[string]any{
			"ok":      true,
			"message": i18n.Text(ctx, "Đã đổi mật khẩu thành công"),
		})
	}
}

// ---- POST /api/v1/auth/reset-password -----------------------------------------
//
// Confirm side of the password-reset flow started by /forgot. Body:
//
//	{ "token": "<raw token from reset link>", "newPassword": "..." }
//
// On success: writes the new password, marks the reset row used + invalidates
// every other outstanding reset for the user, and revokes ALL existing
// Session rows so the password change kicks all devices off.

type resetPasswordRequest struct {
	Token       string `json:"token"`
	NewPassword string `json:"newPassword"`
}

func ResetPassword(d Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Resolve ?lang= / Accept-Language here so the envelope helpers below
		// render in the request's language even when this handler is invoked
		// directly (handler tests) rather than through httpx's middleware chain.
		ctx := i18n.Attach(r)
		var body resetPasswordRequest
		if err := decodeJSON(r, &body); err != nil {
			badJSONBody(w, ctx)
			return
		}

		fieldErrors := map[string][]string{}
		body.Token = strings.TrimSpace(body.Token)
		if body.Token == "" {
			fieldErrors["token"] = []string{i18n.Text(ctx, "Thiếu token")}
		}
		if len(body.NewPassword) < 8 {
			fieldErrors["newPassword"] = []string{i18n.Text(ctx, "Mật khẩu tối thiểu 8 ký tự")}
		} else if len(body.NewPassword) > 200 {
			fieldErrors["newPassword"] = []string{i18n.Text(ctx, "Mật khẩu không được quá 200 ký tự")}
		}
		if len(fieldErrors) > 0 {
			badInput(w, ctx, fieldErrors)
			return
		}

		// Same per-IP+identifier bucket as /forgot, keyed by the (hashed) token
		// so brute-forcing a single link is throttled.
		rl, _ := ratelimit.CheckAuth(r.Context(), d.Limiter, "reset",
			ratelimit.GetClientIP(r), body.Token[:min(16, len(body.Token))])
		if !rl.Ok {
			rateLimited(w, ctx, rl.RetryAfterSec)
			return
		}

		tokenHash := sha256Hex(body.Token)

		q := store.New(d.DB)
		reset, err := q.GetPasswordResetByTokenHash(r.Context(), tokenHash)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				httpx.WriteErrorC(w, ctx, http.StatusBadRequest, "invalid_reset_token",
					i18n.Text(ctx, "Link không hợp lệ hoặc đã hết hạn. Yêu cầu link mới."), nil)
				return
			}
			slog.Error("lookup password reset", "err", err)
			httpx.WriteErrorC(w, ctx, http.StatusInternalServerError, "internal_error", i18n.Text(ctx, "Lỗi hệ thống"), nil)
			return
		}

		newHash, err := auth.Hash(body.NewPassword)
		if err != nil {
			slog.Error("bcrypt hash failed", "err", err)
			httpx.WriteErrorC(w, ctx, http.StatusInternalServerError, "internal_error", i18n.Text(ctx, "Lỗi hệ thống"), nil)
			return
		}

		tx, err := d.DB.Begin(r.Context())
		if err != nil {
			slog.Error("begin tx", "err", err)
			httpx.WriteErrorC(w, ctx, http.StatusInternalServerError, "internal_error", i18n.Text(ctx, "Lỗi hệ thống"), nil)
			return
		}
		defer func() { _ = tx.Rollback(r.Context()) }()
		tq := q.WithTx(tx)

		if err := tq.UpdateUserPassword(r.Context(), store.UpdateUserPasswordParams{
			ID:           reset.UserId,
			PasswordHash: newHash,
		}); err != nil {
			slog.Error("update password", "err", err)
			httpx.WriteErrorC(w, ctx, http.StatusInternalServerError, "internal_error", i18n.Text(ctx, "Lỗi hệ thống"), nil)
			return
		}
		if err := tq.ConsumePasswordReset(r.Context(), reset.ID); err != nil {
			slog.Error("consume reset", "err", err)
			httpx.WriteErrorC(w, ctx, http.StatusInternalServerError, "internal_error", i18n.Text(ctx, "Lỗi hệ thống"), nil)
			return
		}
		// Burn every other outstanding reset for this user.
		if err := tq.ConsumeAllPasswordResetsForUser(r.Context(), reset.UserId); err != nil {
			slog.Error("consume other resets", "err", err)
			httpx.WriteErrorC(w, ctx, http.StatusInternalServerError, "internal_error", i18n.Text(ctx, "Lỗi hệ thống"), nil)
			return
		}
		// Revoke every Session — password change kicks all devices off.
		if err := tq.RevokeAllSessionsForUser(r.Context(), reset.UserId); err != nil {
			slog.Error("revoke sessions", "err", err)
			httpx.WriteErrorC(w, ctx, http.StatusInternalServerError, "internal_error", i18n.Text(ctx, "Lỗi hệ thống"), nil)
			return
		}

		if err := tx.Commit(r.Context()); err != nil {
			slog.Error("commit", "err", err)
			httpx.WriteErrorC(w, ctx, http.StatusInternalServerError, "internal_error", i18n.Text(ctx, "Lỗi hệ thống"), nil)
			return
		}

		httpx.WriteJSON(w, http.StatusOK, map[string]any{
			"ok":      true,
			"message": i18n.Text(ctx, "Đã đổi mật khẩu. Vào /login để đăng nhập."),
		})
	}
}

// ---- POST /api/v1/auth/change-email ------------------------------------------
//
// Step 1 of 2 of the email-change flow (roadmap #10). Body:
//
//	{ "newEmail": "...", "currentPassword": "..." }
//
// The account email is NOT touched here: the old address keeps working until the
// confirm step succeeds. What this endpoint does is prove the password (so a
// stolen bearer token alone cannot move the account) and send a single-use,
// 30-minute token to the NEW address — receiving it there is the proof of
// ownership that a naive UPDATE would skip.
//
// Storage reuses PasswordReset with `pendingEmail` set (migration 0009), and the
// token is issued/expired/consumed exactly like a password reset.
//
// Enumeration: when the requested address already belongs to another account the
// response is the same neutral 200 as the success path and no email is sent —
// mirroring how Register treats an existing address. Nothing in the response
// reveals whether the address exists.

type changeEmailRequest struct {
	NewEmail        string `json:"newEmail"`
	CurrentPassword string `json:"currentPassword"`
}

// emailChangeNeutralMessage is deliberately identical for "token sent" and
// "address already in use" so the response cannot be used to enumerate accounts.
const emailChangeNeutralMessage = "Nếu địa chỉ mới hợp lệ và chưa được dùng cho tài khoản khác, một email xác nhận đã được gửi tới địa chỉ mới. Địa chỉ cũ vẫn dùng được cho tới khi bạn xác nhận."

func RequestEmailChange(d Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Resolve ?lang= / Accept-Language here so the envelope helpers below
		// render in the request's language even when this handler is invoked
		// directly (handler tests) rather than through httpx's middleware chain.
		ctx := i18n.Attach(r)
		us, err := auth.VerifyBearer(r.Context(), d.DB, r.Header.Get("Authorization"))
		if err != nil {
			unauthorized(w, ctx)
			return
		}

		var body changeEmailRequest
		if err := decodeJSON(r, &body); err != nil {
			badJSONBody(w, ctx)
			return
		}

		fieldErrors := map[string][]string{}
		newEmail := strings.ToLower(strings.TrimSpace(body.NewEmail))
		if !validateEmail(newEmail) {
			fieldErrors["newEmail"] = []string{i18n.Text(ctx, "Email không hợp lệ")}
		}
		if body.CurrentPassword == "" {
			fieldErrors["currentPassword"] = []string{i18n.Text(ctx, "Nhập mật khẩu hiện tại")}
		}
		if len(fieldErrors) > 0 {
			badInput(w, ctx, fieldErrors)
			return
		}

		rl, _ := ratelimit.CheckAuth(r.Context(), d.Limiter, "change-email",
			ratelimit.GetClientIP(r), us.UserID)
		if !rl.Ok {
			rateLimited(w, ctx, rl.RetryAfterSec)
			return
		}

		q := store.New(d.DB)
		user, err := q.GetUserByID(r.Context(), us.UserID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				httpx.WriteErrorC(w, ctx, http.StatusNotFound, "user_not_found", i18n.Text(ctx, "Không tìm thấy"), nil)
				return
			}
			slog.Error("get user by id", "err", err)
			httpx.WriteErrorC(w, ctx, http.StatusInternalServerError, "internal_error", i18n.Text(ctx, "Lỗi hệ thống"), nil)
			return
		}
		if !auth.Verify(body.CurrentPassword, user.PasswordHash) {
			badInput(w, ctx, map[string][]string{"currentPassword": {i18n.Text(ctx, "Mật khẩu hiện tại không đúng")}})
			return
		}
		if newEmail == strings.ToLower(user.Email) {
			// Not an enumeration risk: this is the caller's own address.
			badInput(w, ctx, map[string][]string{"newEmail": {i18n.Text(ctx, "Email mới trùng với email hiện tại")}})
			return
		}

		// Address already taken by someone else → neutral 200, no token, no email.
		if other, gerr := q.GetUserByEmail(r.Context(), newEmail); gerr == nil && other.ID != user.ID {
			slog.Info("email change requested for an address already in use", "userId", user.ID)
			httpx.WriteJSON(w, http.StatusOK, map[string]any{
				"ok":      true,
				"message": i18n.Text(ctx, emailChangeNeutralMessage),
			})
			return
		} else if gerr != nil && !errors.Is(gerr, pgx.ErrNoRows) {
			slog.Error("email change lookup failed", "err", gerr)
			httpx.WriteErrorC(w, ctx, http.StatusInternalServerError, "internal_error", i18n.Text(ctx, "Lỗi hệ thống"), nil)
			return
		}

		rawToken, hash, terr := auth.NewTokenAndHash()
		if terr != nil {
			slog.Error("email change token generation failed", "err", terr)
			httpx.WriteErrorC(w, ctx, http.StatusInternalServerError, "internal_error", i18n.Text(ctx, "Lỗi hệ thống"), nil)
			return
		}
		expires := time.Now().Add(passwordResetTTLMin * time.Minute)
		if _, perr := q.CreateEmailChange(r.Context(), store.CreateEmailChangeParams{
			ID:           auth.NewID(),
			UserId:       user.ID,
			TokenHash:    hash,
			PendingEmail: &newEmail,
			ExpiresAt:    pgtype.Timestamp{Time: expires, Valid: true},
		}); perr != nil {
			slog.Error("create email change failed", "err", perr)
			httpx.WriteErrorC(w, ctx, http.StatusInternalServerError, "internal_error", i18n.Text(ctx, "Lỗi hệ thống"), nil)
			return
		}

		appURL := os.Getenv("APP_URL")
		if appURL == "" {
			appURL = "http://localhost:3000"
		}
		link := strings.TrimRight(appURL, "/") + "/confirm-email/" + rawToken
		if d.Email != nil {
			sendCtx, cancel := context.WithTimeout(context.Background(), 12*time.Second)
			go func() {
				defer cancel()
				if e := d.Email.SendEmailChange(sendCtx, newEmail, user.Email, link, rawToken); e != nil {
					slog.Error("send email-change email failed", "err", e)
				}
			}()
		} else {
			slog.Info("email-change link (email client unavailable)",
				"to", newEmail, "from", user.Email, "link", link)
		}

		httpx.WriteJSON(w, http.StatusOK, map[string]any{
			"ok":      true,
			"message": i18n.Text(ctx, emailChangeNeutralMessage),
		})
	}
}

// ---- POST /api/v1/auth/confirm-email-change ----------------------------------
//
// Step 2 of 2. Body: { "token": "<raw token from the email>" }
//
// Unauthenticated on purpose: the token is the credential, and the link is often
// opened on another device. On success it updates User.email, marks the token (and
// every other outstanding token for the user, of both kinds) used, and revokes ALL
// sessions — the same "kick every device off" behaviour as a password reset, so a
// session created for the old address cannot outlive the change.

type confirmEmailChangeRequest struct {
	Token string `json:"token"`
}

func ConfirmEmailChange(d Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Resolve ?lang= / Accept-Language here so the envelope helpers below
		// render in the request's language even when this handler is invoked
		// directly (handler tests) rather than through httpx's middleware chain.
		ctx := i18n.Attach(r)
		var body confirmEmailChangeRequest
		if err := decodeJSON(r, &body); err != nil {
			badJSONBody(w, ctx)
			return
		}
		body.Token = strings.TrimSpace(body.Token)
		if body.Token == "" {
			badInput(w, ctx, map[string][]string{"token": {i18n.Text(ctx, "Thiếu token")}})
			return
		}

		rl, _ := ratelimit.CheckAuth(r.Context(), d.Limiter, "confirm-email-change",
			ratelimit.GetClientIP(r), body.Token[:min(16, len(body.Token))])
		if !rl.Ok {
			rateLimited(w, ctx, rl.RetryAfterSec)
			return
		}

		tokenHash := sha256Hex(body.Token)
		q := store.New(d.DB)
		change, err := q.GetEmailChangeByTokenHash(r.Context(), tokenHash)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				// Covers unknown, already-used and expired tokens: the query filters
				// usedAt + expiresAt, so a replayed token lands here.
				httpx.WriteErrorC(w, ctx, http.StatusBadRequest, "invalid_email_change_token",
					i18n.Text(ctx, "Link xác nhận không hợp lệ hoặc đã hết hạn. Yêu cầu link mới."), nil)
				return
			}
			slog.Error("lookup email change", "err", err)
			httpx.WriteErrorC(w, ctx, http.StatusInternalServerError, "internal_error", i18n.Text(ctx, "Lỗi hệ thống"), nil)
			return
		}
		if change.PendingEmail == nil || strings.TrimSpace(*change.PendingEmail) == "" {
			// Defensive: the query already requires a non-NULL pendingEmail.
			httpx.WriteErrorC(w, ctx, http.StatusBadRequest, "invalid_email_change_token",
				i18n.Text(ctx, "Link xác nhận không hợp lệ hoặc đã hết hạn. Yêu cầu link mới."), nil)
			return
		}
		newEmail := strings.ToLower(strings.TrimSpace(*change.PendingEmail))

		// The address may have been registered by someone else while the token was
		// outstanding. Say so plainly: at this point the caller has proven control of
		// the address, so there is nothing left to enumerate.
		if other, gerr := q.GetUserByEmail(r.Context(), newEmail); gerr == nil && other.ID != change.UserId {
			httpx.WriteErrorC(w, ctx, http.StatusBadRequest, "email_in_use",
				i18n.Text(ctx, "Email này đã được dùng cho một tài khoản khác. Yêu cầu đổi sang địa chỉ khác."), nil)
			return
		} else if gerr != nil && !errors.Is(gerr, pgx.ErrNoRows) {
			slog.Error("email change lookup failed", "err", gerr)
			httpx.WriteErrorC(w, ctx, http.StatusInternalServerError, "internal_error", i18n.Text(ctx, "Lỗi hệ thống"), nil)
			return
		}

		tx, err := d.DB.Begin(r.Context())
		if err != nil {
			slog.Error("begin tx", "err", err)
			httpx.WriteErrorC(w, ctx, http.StatusInternalServerError, "internal_error", i18n.Text(ctx, "Lỗi hệ thống"), nil)
			return
		}
		defer func() { _ = tx.Rollback(r.Context()) }()
		tq := q.WithTx(tx)

		rows, err := tq.UpdateUserEmail(r.Context(), store.UpdateUserEmailParams{
			ID:    change.UserId,
			Email: newEmail,
		})
		if err != nil {
			if isUniqueViolation(err) {
				httpx.WriteErrorC(w, ctx, http.StatusBadRequest, "email_in_use",
					i18n.Text(ctx, "Email này đã được dùng cho một tài khoản khác. Yêu cầu đổi sang địa chỉ khác."), nil)
				return
			}
			slog.Error("update user email", "err", err)
			httpx.WriteErrorC(w, ctx, http.StatusInternalServerError, "internal_error", i18n.Text(ctx, "Lỗi hệ thống"), nil)
			return
		}
		if rows == 0 {
			// The user disappeared between issuing and confirming the token.
			httpx.WriteErrorC(w, ctx, http.StatusBadRequest, "invalid_email_change_token",
				i18n.Text(ctx, "Link xác nhận không hợp lệ hoặc đã hết hạn. Yêu cầu link mới."), nil)
			return
		}
		if err := tq.ConsumePasswordReset(r.Context(), change.ID); err != nil {
			slog.Error("consume email change", "err", err)
			httpx.WriteErrorC(w, ctx, http.StatusInternalServerError, "internal_error", i18n.Text(ctx, "Lỗi hệ thống"), nil)
			return
		}
		// Burn every other outstanding token (password reset + email change).
		if err := tq.ConsumeAllPasswordResetsForUser(r.Context(), change.UserId); err != nil {
			slog.Error("consume other resets", "err", err)
			httpx.WriteErrorC(w, ctx, http.StatusInternalServerError, "internal_error", i18n.Text(ctx, "Lỗi hệ thống"), nil)
			return
		}
		// Email change kicks all devices off, exactly like the password-reset path:
		// sessions issued for the old address must not survive it.
		if err := tq.RevokeAllSessionsForUser(r.Context(), change.UserId); err != nil {
			slog.Error("revoke sessions", "err", err)
			httpx.WriteErrorC(w, ctx, http.StatusInternalServerError, "internal_error", i18n.Text(ctx, "Lỗi hệ thống"), nil)
			return
		}

		if err := tx.Commit(r.Context()); err != nil {
			slog.Error("commit", "err", err)
			httpx.WriteErrorC(w, ctx, http.StatusInternalServerError, "internal_error", i18n.Text(ctx, "Lỗi hệ thống"), nil)
			return
		}

		httpx.WriteJSON(w, http.StatusOK, map[string]any{
			"ok":      true,
			"message": i18n.Text(ctx, "Đã đổi email. Vào /login để đăng nhập lại bằng địa chỉ mới."),
		})
	}
}

// isUniqueViolation reports whether err is a PostgreSQL unique-constraint
// violation (SQLSTATE 23505). The email unique index is the last race guard of the
// email-change confirm step, and a duplicate must surface as a clean 400 rather
// than a 500.
func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

func sha256Hex(s string) string {
	sum := sha256.Sum256([]byte(s))
	return hex.EncodeToString(sum[:])
}

// ---- DELETE /api/v1/auth/me --------------------------------------------------
//
// Permanently deletes the authenticated user. Requires the current
// password in the body so a stolen bearer token can't nuke the account.
// The schema's `User → *` ON DELETE CASCADE constraints take care of
// Devices, Subscriptions, WishlistItems, Sessions and PasswordResets in a
// single statement.
//
// After the DB commit we best-effort remove the user's encrypted blobs from
// disk. The path layout is `<PRIVATE_UPLOAD_ROOT>/<deviceId>/<uuid>.enc`,
// without a per-user dir, so we iterate the snapshotted device ids.

type deleteMeRequest struct {
	Password string `json:"password"`
}

func DeleteMe(d Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Resolve ?lang= / Accept-Language here so the envelope helpers below
		// render in the request's language even when this handler is invoked
		// directly (handler tests) rather than through httpx's middleware chain.
		ctx := i18n.Attach(r)
		us, err := auth.VerifyBearer(r.Context(), d.DB, r.Header.Get("Authorization"))
		if err != nil {
			unauthorized(w, ctx)
			return
		}

		// Body is optional — if absent, we still require it. Decode loose so a
		// trailing CSRF / confirm phrase doesn't 400 on us.
		var body deleteMeRequest
		if r.ContentLength > 0 || r.Header.Get("Content-Type") != "" {
			_ = decodeJSONLoose(r, &body)
		}
		if strings.TrimSpace(body.Password) == "" {
			badInput(w, ctx, map[string][]string{"password": {i18n.Text(ctx, "Nhập mật khẩu để xác nhận")}})
			return
		}

		q := store.New(d.DB)
		row, gerr := q.GetUserByID(r.Context(), us.UserID)
		if gerr != nil {
			if errors.Is(gerr, pgx.ErrNoRows) {
				httpx.WriteErrorC(w, ctx, http.StatusNotFound, "user_not_found", i18n.Text(ctx, "Không tìm thấy"), nil)
				return
			}
			slog.Error("get user by id", "err", gerr)
			httpx.WriteErrorC(w, ctx, http.StatusInternalServerError, "internal_error", i18n.Text(ctx, "Lỗi hệ thống"), nil)
			return
		}
		if !auth.Verify(body.Password, row.PasswordHash) {
			badInput(w, ctx, map[string][]string{"password": {i18n.Text(ctx, "Mật khẩu không đúng")}})
			return
		}

		// Snapshot device ids BEFORE delete so we know which on-disk dirs to
		// purge afterwards.
		devices, derr := q.ListDevicesByUserSimple(r.Context(), us.UserID)
		if derr != nil {
			slog.Error("list devices for delete", "err", derr, "userId", us.UserID)
			httpx.WriteErrorC(w, ctx, http.StatusInternalServerError, "internal_error", i18n.Text(ctx, "Lỗi hệ thống"), nil)
			return
		}

		if err := q.DeleteUser(r.Context(), us.UserID); err != nil {
			slog.Error("delete user", "err", err, "userId", us.UserID)
			httpx.WriteErrorC(w, ctx, http.StatusInternalServerError, "internal_error", i18n.Text(ctx, "Lỗi hệ thống"), nil)
			return
		}

		// Best-effort disk cleanup. A failure here is logged but does not
		// produce a 500 — the user's data is gone from the DB which is what
		// matters for privacy / GDPR.
		root := files.PrivateUploadRoot()
		for _, dev := range devices {
			if !files.SafeSegment(dev.ID) {
				continue
			}
			abs, perr := files.ResolveSafe(root, dev.ID)
			if perr != nil {
				continue
			}
			if rmErr := osRemoveAll(abs); rmErr != nil {
				slog.Warn("remove device upload dir failed",
					"err", rmErr, "userId", us.UserID, "deviceId", dev.ID)
			}
		}

		httpx.WriteJSON(w, http.StatusOK, map[string]any{
			"ok":      true,
			"message": i18n.Text(ctx, "Đã xoá tài khoản"),
		})
	}
}

// osRemoveAll is a thin wrapper indirected through a var so tests can stub it
// without pulling in os.RemoveAll directly across packages.
var osRemoveAll = os.RemoveAll
