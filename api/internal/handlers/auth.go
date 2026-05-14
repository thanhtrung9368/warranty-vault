package handlers

import (
	"context"
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

	"github.com/thanhtrung9368/warranty-vault/api/internal/auth"
	"github.com/thanhtrung9368/warranty-vault/api/internal/email"
	"github.com/thanhtrung9368/warranty-vault/api/internal/httpx"
	"github.com/thanhtrung9368/warranty-vault/api/internal/push"
	"github.com/thanhtrung9368/warranty-vault/api/internal/ratelimit"
	store "github.com/thanhtrung9368/warranty-vault/api/internal/store/gen"
)

// Deps bundles the per-process dependencies the handler closures capture.
type Deps struct {
	DB         *pgxpool.Pool
	Limiter    ratelimit.Limiter
	Email      *email.Client
	Dispatcher *push.Dispatcher
}

// ---- response shapes -------------------------------------------------------

type userDTO struct {
	ID    string  `json:"id"`
	Email string  `json:"email"`
	Name  *string `json:"name"`
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

func ptrIfNotEmpty(s string) *string {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil
	}
	return &s
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
			User:        userDTO{ID: user.ID, Email: user.Email, Name: user.Name},
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
			User:        userDTO{ID: user.ID, Email: user.Email, Name: user.Name},
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
		httpx.WriteJSON(w, http.StatusOK, map[string]userDTO{
			"user": {ID: us.UserID, Email: us.Email, Name: us.Name},
		})
	}
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
