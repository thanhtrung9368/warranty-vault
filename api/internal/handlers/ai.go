package handlers

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"strings"

	"github.com/thanhtrung9368/warranty-vault/api/internal/ai"
	"github.com/thanhtrung9368/warranty-vault/api/internal/auth"
	"github.com/thanhtrung9368/warranty-vault/api/internal/files"
	"github.com/thanhtrung9368/warranty-vault/api/internal/httpx"
	"github.com/thanhtrung9368/warranty-vault/api/internal/ratelimit"
	"github.com/thanhtrung9368/warranty-vault/api/internal/services"
)

// RegisterAI wires the AI extraction surface. Auth is wrapped at registration;
// per-user rate limiting (tighter, since each call hits a paid API) is inside
// the handler.
func RegisterAI(mux *http.ServeMux, deps Deps) {
	requireUser := auth.RequireUser(deps.DB)
	mux.Handle("POST /api/v1/ai/extract-receipt",
		requireUser(http.HandlerFunc(extractReceiptHandler(deps))))
	mux.Handle("GET /api/v1/ai/opt-in",
		requireUser(http.HandlerFunc(getAIOptInHandler(deps))))
	mux.Handle("PUT /api/v1/ai/opt-in",
		requireUser(http.HandlerFunc(setAIOptInHandler(deps))))
}

// getAIOptInHandler returns the user's current AI opt-in state.
func getAIOptInHandler(d Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		us, _ := auth.UserFromContext(r.Context())
		enabled, err := services.GetAIOptIn(r.Context(), d.DB, us.UserID)
		if err != nil {
			writeAIError(w, ctx, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, map[string]bool{"aiOptIn": enabled})
	}
}

// setAIOptInHandler flips the user's AI opt-in flag. Body: { "enabled": bool }.
func setAIOptInHandler(d Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		us, _ := auth.UserFromContext(r.Context())
		var body struct {
			Enabled bool `json:"enabled"`
		}
		if err := decodeJSONLoose(r, &body); err != nil {
			badJSONBody(w, ctx)
			return
		}
		if err := services.SetAIOptIn(r.Context(), d.DB, us.UserID, body.Enabled); err != nil {
			writeAIError(w, ctx, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, map[string]bool{"aiOptIn": body.Enabled})
	}
}

// extractReceiptHandler accepts either:
//   - application/json  { "attachmentId": "..." }  → reuse the decrypt path
//   - multipart/form-data with a `file` field      → direct upload
//
// It returns a DRAFT only — never persists a device.
func extractReceiptHandler(d Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		us, _ := auth.UserFromContext(r.Context())

		rl, _ := ratelimit.CheckAIExtract(r.Context(), d.Limiter, us.UserID)
		if !rl.Ok {
			rateLimited(w, r.Context(), rl.RetryAfterSec)
			return
		}

		if d.AI == nil || !d.AI.Enabled() {
			httpx.WriteErrorC(w, ctx, http.StatusServiceUnavailable, "feature_disabled",
				"Tính năng quét hoá đơn chưa được bật", nil)
			return
		}

		var in services.ExtractInput
		ct := strings.ToLower(r.Header.Get("Content-Type"))
		switch {
		case strings.HasPrefix(ct, "application/json"):
			var body struct {
				AttachmentID string `json:"attachmentId"`
			}
			if err := decodeJSONLoose(r, &body); err != nil {
				badJSONBody(w, ctx)
				return
			}
			if strings.TrimSpace(body.AttachmentID) == "" {
				httpx.WriteErrorC(w, ctx, http.StatusBadRequest, "bad_input", "Thiếu attachmentId", nil)
				return
			}
			in.AttachmentID = strings.TrimSpace(body.AttachmentID)

		case strings.HasPrefix(ct, "multipart/form-data"):
			r.Body = http.MaxBytesReader(w, r.Body, maxMultipartBytes)
			if err := r.ParseMultipartForm(10 << 20); err != nil {
				if strings.Contains(err.Error(), "request body too large") {
					httpx.WriteErrorC(w, ctx, http.StatusRequestEntityTooLarge, "bad_input", "File quá lớn", nil)
					return
				}
				httpx.WriteErrorC(w, ctx, http.StatusBadRequest, "bad_input", "Không đọc được multipart payload", nil)
				return
			}
			file, header, ferr := r.FormFile("file")
			if ferr != nil {
				httpx.WriteErrorC(w, ctx, http.StatusBadRequest, "bad_input", "Thiếu file", nil)
				return
			}
			defer func() { _ = file.Close() }()

			body, rerr := io.ReadAll(io.LimitReader(file, services.MaxAttachmentBytes+1))
			if rerr != nil {
				httpx.WriteErrorC(w, ctx, http.StatusBadRequest, "bad_input", "Không đọc được nội dung file", nil)
				return
			}
			if len(body) > services.MaxAttachmentBytes {
				httpx.WriteErrorC(w, ctx, http.StatusRequestEntityTooLarge, "bad_input", "File vượt quá 5MB", nil)
				return
			}
			mime, verr := files.DetectAndValidate(body, header.Header.Get("Content-Type"))
			if verr != nil {
				httpx.WriteErrorC(w, ctx, http.StatusBadRequest, "bad_input", verr.Error(), nil)
				return
			}
			// PDF is accepted here as of roadmap #15 (the AI client sends it as a
			// `document` block); GIF/HEIC are stored fine but cannot be OCR'd.
			if !ai.IsSupportedReceiptType(mime) {
				httpx.WriteErrorC(w, ctx, http.StatusBadRequest, "bad_input",
					"Chỉ hỗ trợ ảnh JPEG, PNG, WEBP hoặc PDF", nil)
				return
			}
			in.Body = body
			in.MediaType = mime

		default:
			httpx.WriteErrorC(w, ctx, http.StatusBadRequest, "bad_input",
				"Content-Type phải là application/json hoặc multipart/form-data", nil)
			return
		}

		draft, sErr := services.ExtractReceipt(r.Context(), d.DB, d.AI, us.UserID, in)
		if sErr != nil {
			writeAIError(w, ctx, sErr)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, map[string]any{"draft": draft})
	}
}

func writeAIError(w http.ResponseWriter, ctx context.Context, err error) {
	if ae, ok := services.AsAttachmentError(err); ok {
		switch ae.Code {
		case "bad_input":
			httpx.WriteErrorC(w, ctx, http.StatusBadRequest, "bad_input", ae.Message, nil)
		case "not_found":
			httpx.WriteErrorC(w, ctx, http.StatusNotFound, "not_found", ae.Message, nil)
		case "feature_disabled":
			httpx.WriteErrorC(w, ctx, http.StatusServiceUnavailable, "feature_disabled", ae.Message, nil)
		case "ai_optin_required":
			httpx.WriteErrorC(w, ctx, http.StatusForbidden, "ai_optin_required", ae.Message, nil)
		case "ai_rate_limited":
			httpx.WriteErrorC(w, ctx, http.StatusTooManyRequests, "ai_rate_limited", ae.Message, nil)
		case "ai_upstream":
			httpx.WriteErrorC(w, ctx, http.StatusBadGateway, "ai_upstream", ae.Message, nil)
		case "internal_error":
			httpx.WriteErrorC(w, ctx, http.StatusInternalServerError, "internal_error", ae.Message, nil)
		default:
			httpx.WriteErrorC(w, ctx, http.StatusBadRequest, ae.Code, ae.Message, nil)
		}
		return
	}
	slog.Error("ai handler error", "err", err)
	httpx.WriteErrorC(w, ctx, http.StatusInternalServerError, "internal_error", "Lỗi hệ thống", nil)
}
