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
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/thanhtrung9368/warranty-vault/api/internal/ai"
	"github.com/thanhtrung9368/warranty-vault/api/internal/auth"
	"github.com/thanhtrung9368/warranty-vault/api/internal/email"
	"github.com/thanhtrung9368/warranty-vault/api/internal/files"
	"github.com/thanhtrung9368/warranty-vault/api/internal/httpx"
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

func badJSONBody(w http.ResponseWriter) {
	httpx.WriteError(w, http.StatusBadRequest, "bad_input", "Body phải là JSON hợp lệ", nil)
}

func badInput(w http.ResponseWriter, fieldErrors map[string][]string, message ...string) {
	msg := "Dữ liệu không hợp lệ"
	if len(message) > 0 && message[0] != "" {
		msg = message[0]
	}
	httpx.WriteError(w, http.StatusBadRequest, "bad_input", msg, fieldErrors)
}

func rateLimited(w http.ResponseWriter, retryAfterSec int) {
	w.Header().Set("Retry-After", strconvItoa(retryAfterSec))
	msg := "Thao tác quá nhanh. Đợi " + ratelimit.FormatRetry(retryAfterSec)
	httpx.WriteError(w, http.StatusTooManyRequests, "rate_limited", msg, nil)
}

func unauthorized(w http.ResponseWriter) {
	httpx.WriteError(w, http.StatusUnauthorized, "unauthorized", "Bạn chưa đăng nhập", nil)
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
		var body registerRequest
		if err := decodeJSON(r, &body); err != nil {
			badJSONBody(w)
			return
		}

		fieldErrors := map[string][]string{}
		emailNorm := strings.ToLower(strings.TrimSpace(body.Email))
		if !validateEmail(emailNorm) {
			fieldErrors["email"] = []string{"Email không hợp lệ"}
		}
		if len(body.Password) < 8 {
			fieldErrors["password"] = []string{"Mật khẩu tối thiểu 8 ký tự"}
		} else if len(body.Password) > 200 {
			fieldErrors["password"] = []string{"Mật khẩu không được quá 200 ký tự"}
		}
		var name *string
		if body.Name != nil {
			trimmed := strings.TrimSpace(*body.Name)
			if len(trimmed) > 80 {
				fieldErrors["name"] = []string{"Tên không được quá 80 ký tự"}
			}
			if trimmed != "" {
				name = &trimmed
			}
		}
		platform := normalizePlatform(body.Platform)
		if body.Platform != nil && platform == nil && *body.Platform != "" {
			fieldErrors["platform"] = []string{"Platform không hợp lệ"}
		}
		if len(fieldErrors) > 0 {
			badInput(w, fieldErrors)
			return
		}

		rl, _ := ratelimit.CheckAuth(r.Context(), d.Limiter, "register",
			ratelimit.GetClientIP(r), emailNorm)
		if !rl.Ok {
			rateLimited(w, rl.RetryAfterSec)
			return
		}

		q := store.New(d.DB)
		existing, err := q.GetUserByEmail(r.Context(), emailNorm)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			slog.Error("get user by email", "err", err)
			httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "Lỗi hệ thống", nil)
			return
		}
		if err == nil {
			_ = existing
			// Burn equivalent hash time so response latency does not leak existence.
			_, _ = auth.Hash(body.Password)
			httpx.WriteJSON(w, http.StatusOK, map[string]any{
				"ok":      true,
				"message": "Nếu email chưa đăng ký, tài khoản đã được tạo. Nếu đã có, vào đăng nhập hoặc quên mật khẩu.",
			})
			return
		}

		hash, err := auth.Hash(body.Password)
		if err != nil {
			slog.Error("bcrypt hash failed", "err", err)
			httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "Lỗi hệ thống", nil)
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
			httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "Lỗi hệ thống", nil)
			return
		}

		issued, err := auth.IssueToken(r.Context(), d.DB, user.ID,
			ptrIfNotEmptyOrPassthrough(body.DeviceLabel), platform)
		if err != nil {
			slog.Error("issue token failed", "err", err)
			httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "Lỗi hệ thống", nil)
			return
		}

		httpx.WriteJSON(w, http.StatusCreated, authTokenResponse{
			AccessToken: issued.AccessToken,
			ExpiresAt:   issued.ExpiresAt.UTC().Format(time.RFC3339Nano),
			User:        userDTO{ID: user.ID, Email: user.Email, Name: user.Name, AiOptIn: user.AiOptIn},
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
		var body loginRequest
		if err := decodeJSON(r, &body); err != nil {
			badJSONBody(w)
			return
		}

		fieldErrors := map[string][]string{}
		emailNorm := strings.ToLower(strings.TrimSpace(body.Email))
		if !validateEmail(emailNorm) {
			fieldErrors["email"] = []string{"Email không hợp lệ"}
		}
		if body.Password == "" {
			fieldErrors["password"] = []string{"Nhập mật khẩu"}
		}
		platform := normalizePlatform(body.Platform)
		if body.Platform != nil && platform == nil && *body.Platform != "" {
			fieldErrors["platform"] = []string{"Platform không hợp lệ"}
		}
		if len(fieldErrors) > 0 {
			badInput(w, fieldErrors)
			return
		}

		rl, _ := ratelimit.CheckAuth(r.Context(), d.Limiter, "login",
			ratelimit.GetClientIP(r), emailNorm)
		if !rl.Ok {
			rateLimited(w, rl.RetryAfterSec)
			return
		}

		q := store.New(d.DB)
		user, err := q.GetUserByEmail(r.Context(), emailNorm)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				httpx.WriteError(w, http.StatusUnauthorized, "invalid_credentials",
					"Email hoặc mật khẩu không đúng", nil)
				return
			}
			slog.Error("get user by email", "err", err)
			httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "Lỗi hệ thống", nil)
			return
		}
		if !auth.Verify(body.Password, user.PasswordHash) {
			httpx.WriteError(w, http.StatusUnauthorized, "invalid_credentials",
				"Email hoặc mật khẩu không đúng", nil)
			return
		}

		issued, err := auth.IssueToken(r.Context(), d.DB, user.ID,
			ptrIfNotEmptyOrPassthrough(body.DeviceLabel), platform)
		if err != nil {
			slog.Error("issue token failed", "err", err)
			httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "Lỗi hệ thống", nil)
			return
		}

		httpx.WriteJSON(w, http.StatusOK, authTokenResponse{
			AccessToken: issued.AccessToken,
			ExpiresAt:   issued.ExpiresAt.UTC().Format(time.RFC3339Nano),
			User:        userDTO{ID: user.ID, Email: user.Email, Name: user.Name, AiOptIn: user.AiOptIn},
		})
	}
}

// ---- POST /api/v1/auth/logout --------------------------------------------------

func Logout(d Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		header := r.Header.Get("Authorization")
		if header == "" {
			unauthorized(w)
			return
		}
		// Idempotent: returns nil even if the token was already revoked or
		// never existed. The client should still drop it locally.
		if err := auth.RevokeToken(r.Context(), d.DB, header); err != nil {
			if errors.Is(err, auth.ErrInvalidSession) {
				unauthorized(w)
				return
			}
			slog.Error("revoke token failed", "err", err)
			httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "Lỗi hệ thống", nil)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, map[string]bool{"ok": true})
	}
}

// ---- GET /api/v1/auth/me -------------------------------------------------------

func Me(d Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		us, err := auth.VerifyBearer(r.Context(), d.DB, r.Header.Get("Authorization"))
		if err != nil {
			unauthorized(w)
			return
		}
		// aiOptIn lives on the User row, not the session — read it so clients
		// can render the Settings toggle state.
		aiOptIn := false
		if u, uerr := store.New(d.DB).GetUserByID(r.Context(), us.UserID); uerr == nil {
			aiOptIn = u.AiOptIn
		}
		httpx.WriteJSON(w, http.StatusOK, map[string]userDTO{
			"user": {ID: us.UserID, Email: us.Email, Name: us.Name, AiOptIn: aiOptIn},
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
		us, ok := auth.UserFromContext(r.Context())
		if !ok {
			unauthorized(w)
			return
		}

		rl, _ := ratelimit.CheckUserWrite(r.Context(), d.Limiter, us.UserID)
		if !rl.Ok {
			rateLimited(w, rl.RetryAfterSec)
			return
		}

		// Decode into a raw map first so we can (a) distinguish "key absent" from
		// "explicit null / empty string" and (b) answer unknown fields with a
		// field-level Vietnamese message instead of the generic bad-JSON one.
		var raw map[string]json.RawMessage
		if err := decodeJSON(r, &raw); err != nil {
			badJSONBody(w)
			return
		}

		unknown := map[string][]string{}
		for k := range raw {
			if k == "displayName" {
				continue
			}
			if k == "email" || k == "newEmail" {
				unknown[k] = []string{"Đổi email chưa được hỗ trợ. Chỉ có thể sửa tên hiển thị."}
				continue
			}
			unknown[k] = []string{"Trường không được hỗ trợ"}
		}
		if len(unknown) > 0 {
			badInput(w, unknown, "Chỉ hỗ trợ sửa tên hiển thị")
			return
		}

		rawName, present := raw["displayName"]
		var nameIn *string
		if present {
			// `null` unmarshals to a nil *string without error; a number/object/
			// array/bool is rejected here.
			if err := json.Unmarshal(rawName, &nameIn); err != nil {
				badInput(w, map[string][]string{"displayName": {"Tên hiển thị không hợp lệ"}})
				return
			}
		}
		name, verr := services.NormalizeDisplayName(nameIn, present)
		if verr != nil {
			writeAuthServiceErr(w, verr, "validate display name")
			return
		}

		user, uerr := services.UpdateDisplayName(r.Context(), d.DB, us.UserID, name)
		if uerr != nil {
			writeAuthServiceErr(w, uerr, "update display name")
			return
		}

		httpx.WriteJSON(w, http.StatusOK, map[string]any{
			"user":    userDTO{ID: user.ID, Email: user.Email, Name: user.Name, AiOptIn: user.AiOptIn},
			"message": "Đã cập nhật hồ sơ",
		})
	}
}

// writeAuthServiceErr maps a services.* domain error onto the shared JSON error
// envelope. Mirrors writeDevicesErr, kept local so auth.go doesn't depend on the
// devices handler file.
func writeAuthServiceErr(w http.ResponseWriter, err error, op string) {
	var svc *services.Error
	if errors.As(err, &svc) {
		httpx.WriteError(w, svc.HTTPStatus(), strings.ToLower(svc.Code), svc.Message, svc.FieldErrors)
		return
	}
	slog.Error(op+" failed", "err", err)
	httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "Lỗi hệ thống", nil)
}

// ---- POST /api/v1/auth/forgot --------------------------------------------------

type forgotRequest struct {
	Email string `json:"email"`
}

const passwordResetTTLMin = 30

func Forgot(d Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body forgotRequest
		if err := decodeJSON(r, &body); err != nil {
			badJSONBody(w)
			return
		}
		emailNorm := strings.ToLower(strings.TrimSpace(body.Email))
		if !validateEmail(emailNorm) {
			badInput(w, map[string][]string{"email": {"Email không hợp lệ"}})
			return
		}

		rl, _ := ratelimit.CheckAuth(r.Context(), d.Limiter, "forgot",
			ratelimit.GetClientIP(r), emailNorm)
		if !rl.Ok {
			rateLimited(w, rl.RetryAfterSec)
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
		us, err := auth.VerifyBearer(r.Context(), d.DB, r.Header.Get("Authorization"))
		if err != nil {
			unauthorized(w)
			return
		}

		rl, _ := ratelimit.CheckAuth(r.Context(), d.Limiter, "change-password",
			ratelimit.GetClientIP(r), us.UserID)
		if !rl.Ok {
			rateLimited(w, rl.RetryAfterSec)
			return
		}

		var body changePasswordRequest
		if err := decodeJSON(r, &body); err != nil {
			badJSONBody(w)
			return
		}

		fieldErrors := map[string][]string{}
		if body.CurrentPassword == "" {
			fieldErrors["currentPassword"] = []string{"Nhập mật khẩu hiện tại"}
		}
		if len(body.NewPassword) < 8 {
			fieldErrors["newPassword"] = []string{"Mật khẩu mới tối thiểu 8 ký tự"}
		} else if len(body.NewPassword) > 200 {
			fieldErrors["newPassword"] = []string{"Mật khẩu không được quá 200 ký tự"}
		}
		if body.ConfirmPassword == "" {
			fieldErrors["confirmPassword"] = []string{"Required"}
		}
		if len(fieldErrors) == 0 && body.NewPassword != body.ConfirmPassword {
			fieldErrors["confirmPassword"] = []string{"Xác nhận mật khẩu không khớp"}
		}
		if len(fieldErrors) > 0 {
			badInput(w, fieldErrors)
			return
		}

		q := store.New(d.DB)
		row, err := q.GetUserByID(r.Context(), us.UserID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				httpx.WriteError(w, http.StatusNotFound, "user_not_found", "Không tìm thấy", nil)
				return
			}
			slog.Error("get user by id", "err", err)
			httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "Lỗi hệ thống", nil)
			return
		}
		if !auth.Verify(body.CurrentPassword, row.PasswordHash) {
			badInput(w, map[string][]string{"currentPassword": {"Mật khẩu hiện tại không đúng"}})
			return
		}

		newHash, err := auth.Hash(body.NewPassword)
		if err != nil {
			slog.Error("bcrypt hash failed", "err", err)
			httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "Lỗi hệ thống", nil)
			return
		}
		if err := q.UpdateUserPassword(r.Context(), store.UpdateUserPasswordParams{
			ID:           us.UserID,
			PasswordHash: newHash,
		}); err != nil {
			slog.Error("update password failed", "err", err)
			httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "Lỗi hệ thống", nil)
			return
		}

		httpx.WriteJSON(w, http.StatusOK, map[string]any{
			"ok":      true,
			"message": "Đã đổi mật khẩu thành công",
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
		var body resetPasswordRequest
		if err := decodeJSON(r, &body); err != nil {
			badJSONBody(w)
			return
		}

		fieldErrors := map[string][]string{}
		body.Token = strings.TrimSpace(body.Token)
		if body.Token == "" {
			fieldErrors["token"] = []string{"Thiếu token"}
		}
		if len(body.NewPassword) < 8 {
			fieldErrors["newPassword"] = []string{"Mật khẩu tối thiểu 8 ký tự"}
		} else if len(body.NewPassword) > 200 {
			fieldErrors["newPassword"] = []string{"Mật khẩu không được quá 200 ký tự"}
		}
		if len(fieldErrors) > 0 {
			badInput(w, fieldErrors)
			return
		}

		// Same per-IP+identifier bucket as /forgot, keyed by the (hashed) token
		// so brute-forcing a single link is throttled.
		rl, _ := ratelimit.CheckAuth(r.Context(), d.Limiter, "reset",
			ratelimit.GetClientIP(r), body.Token[:min(16, len(body.Token))])
		if !rl.Ok {
			rateLimited(w, rl.RetryAfterSec)
			return
		}

		tokenHash := sha256Hex(body.Token)

		q := store.New(d.DB)
		reset, err := q.GetPasswordResetByTokenHash(r.Context(), tokenHash)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				httpx.WriteError(w, http.StatusBadRequest, "invalid_reset_token",
					"Link không hợp lệ hoặc đã hết hạn. Yêu cầu link mới.", nil)
				return
			}
			slog.Error("lookup password reset", "err", err)
			httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "Lỗi hệ thống", nil)
			return
		}

		newHash, err := auth.Hash(body.NewPassword)
		if err != nil {
			slog.Error("bcrypt hash failed", "err", err)
			httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "Lỗi hệ thống", nil)
			return
		}

		tx, err := d.DB.Begin(r.Context())
		if err != nil {
			slog.Error("begin tx", "err", err)
			httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "Lỗi hệ thống", nil)
			return
		}
		defer func() { _ = tx.Rollback(r.Context()) }()
		tq := q.WithTx(tx)

		if err := tq.UpdateUserPassword(r.Context(), store.UpdateUserPasswordParams{
			ID:           reset.UserId,
			PasswordHash: newHash,
		}); err != nil {
			slog.Error("update password", "err", err)
			httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "Lỗi hệ thống", nil)
			return
		}
		if err := tq.ConsumePasswordReset(r.Context(), reset.ID); err != nil {
			slog.Error("consume reset", "err", err)
			httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "Lỗi hệ thống", nil)
			return
		}
		// Burn every other outstanding reset for this user.
		if err := tq.ConsumeAllPasswordResetsForUser(r.Context(), reset.UserId); err != nil {
			slog.Error("consume other resets", "err", err)
			httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "Lỗi hệ thống", nil)
			return
		}
		// Revoke every Session — password change kicks all devices off.
		if err := tq.RevokeAllSessionsForUser(r.Context(), reset.UserId); err != nil {
			slog.Error("revoke sessions", "err", err)
			httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "Lỗi hệ thống", nil)
			return
		}

		if err := tx.Commit(r.Context()); err != nil {
			slog.Error("commit", "err", err)
			httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "Lỗi hệ thống", nil)
			return
		}

		httpx.WriteJSON(w, http.StatusOK, map[string]any{
			"ok":      true,
			"message": "Đã đổi mật khẩu. Vào /login để đăng nhập.",
		})
	}
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
		us, err := auth.VerifyBearer(r.Context(), d.DB, r.Header.Get("Authorization"))
		if err != nil {
			unauthorized(w)
			return
		}

		// Body is optional — if absent, we still require it. Decode loose so a
		// trailing CSRF / confirm phrase doesn't 400 on us.
		var body deleteMeRequest
		if r.ContentLength > 0 || r.Header.Get("Content-Type") != "" {
			_ = decodeJSONLoose(r, &body)
		}
		if strings.TrimSpace(body.Password) == "" {
			badInput(w, map[string][]string{"password": {"Nhập mật khẩu để xác nhận"}})
			return
		}

		q := store.New(d.DB)
		row, gerr := q.GetUserByID(r.Context(), us.UserID)
		if gerr != nil {
			if errors.Is(gerr, pgx.ErrNoRows) {
				httpx.WriteError(w, http.StatusNotFound, "user_not_found", "Không tìm thấy", nil)
				return
			}
			slog.Error("get user by id", "err", gerr)
			httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "Lỗi hệ thống", nil)
			return
		}
		if !auth.Verify(body.Password, row.PasswordHash) {
			badInput(w, map[string][]string{"password": {"Mật khẩu không đúng"}})
			return
		}

		// Snapshot device ids BEFORE delete so we know which on-disk dirs to
		// purge afterwards.
		devices, derr := q.ListDevicesByUserSimple(r.Context(), us.UserID)
		if derr != nil {
			slog.Error("list devices for delete", "err", derr, "userId", us.UserID)
			httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "Lỗi hệ thống", nil)
			return
		}

		if err := q.DeleteUser(r.Context(), us.UserID); err != nil {
			slog.Error("delete user", "err", err, "userId", us.UserID)
			httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "Lỗi hệ thống", nil)
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
			"message": "Đã xoá tài khoản",
		})
	}
}

// osRemoveAll is a thin wrapper indirected through a var so tests can stub it
// without pulling in os.RemoveAll directly across packages.
var osRemoveAll = os.RemoveAll
