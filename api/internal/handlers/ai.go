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
	"github.com/thanhtrung9368/warranty-vault/api/internal/i18n"
	"github.com/thanhtrung9368/warranty-vault/api/internal/ratelimit"
	"github.com/thanhtrung9368/warranty-vault/api/internal/services"
)

// RegisterAI wires the AI extraction surface. Auth is wrapped at registration;
// per-user rate limiting (tighter, since each call hits a paid API) is inside
// the handler.
//
// i18n (docs/I18N_PLAN.md §3, Phase 1). Two things about this file are worth
// knowing before reading it:
//
//  1. `files.DetectAndValidate` is called DIRECTLY here rather than through a
//     service, so the raw error from internal/files reaches this handler with no
//     service in between to render it. The same trick wave 3 used at the service
//     boundary is therefore applied here: files' Vietnamese text IS its catalog
//     key, and `i18n.Text(ctx, verr.Error())` renders it in the request's
//     language. internal/files itself is untouched.
//  2. The messages produced by internal/ai (via services.mapAIError) are the
//     source text of a package with no request context; the service renders them
//     with the same key-as-source rule, so an unknown key — the one message that
//     carries an upstream status code — still arrives byte-for-byte.
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
		// i18n.Attach at the top of every converted handler: the tests build their
		// own mux with no middleware chain, so `?lang=` has to be resolved here.
		ctx := i18n.Attach(r)
		us, _ := auth.UserFromContext(ctx)
		enabled, err := services.GetAIOptIn(ctx, d.DB, us.UserID)
		if err != nil {
			writeAIError(w, ctx, err)
			return
		}
		httpx.WriteJSONC(w, ctx, http.StatusOK, map[string]bool{"aiOptIn": enabled})
	}
}

// setAIOptInHandler flips the user's AI opt-in flag. Body: { "enabled": bool }.
func setAIOptInHandler(d Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := i18n.Attach(r)
		us, _ := auth.UserFromContext(ctx)
		var body struct {
			Enabled bool `json:"enabled"`
		}
		if err := decodeJSONLoose(r, &body); err != nil {
			badJSONBody(w, ctx)
			return
		}
		if err := services.SetAIOptIn(ctx, d.DB, us.UserID, body.Enabled); err != nil {
			writeAIError(w, ctx, err)
			return
		}
		httpx.WriteJSONC(w, ctx, http.StatusOK, map[string]bool{"aiOptIn": body.Enabled})
	}
}

// extractReceiptHandler accepts either:
//   - application/json  { "attachmentId": "..." }  → reuse the decrypt path
//   - multipart/form-data with a `file` field      → direct upload
//
// It returns a DRAFT only — never persists a device.
func extractReceiptHandler(d Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := i18n.Attach(r)
		us, _ := auth.UserFromContext(ctx)

		rl, _ := ratelimit.CheckAIExtract(ctx, d.Limiter, us.UserID)
		if !rl.Ok {
			rateLimited(w, ctx, rl.RetryAfterSec)
			return
		}

		if d.AI == nil || !d.AI.Enabled() {
			httpx.WriteErrorC(w, ctx, http.StatusServiceUnavailable, "feature_disabled",
				i18n.Text(ctx, "Tính năng quét hoá đơn chưa được bật"), nil)
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
				httpx.WriteErrorC(w, ctx, http.StatusBadRequest, "bad_input", i18n.Text(ctx, "Thiếu attachmentId"), nil)
				return
			}
			in.AttachmentID = strings.TrimSpace(body.AttachmentID)

		case strings.HasPrefix(ct, "multipart/form-data"):
			r.Body = http.MaxBytesReader(w, r.Body, maxMultipartBytes)
			if err := r.ParseMultipartForm(10 << 20); err != nil {
				if strings.Contains(err.Error(), "request body too large") {
					httpx.WriteErrorC(w, ctx, http.StatusRequestEntityTooLarge, "bad_input", i18n.Text(ctx, "File quá lớn"), nil)
					return
				}
				httpx.WriteErrorC(w, ctx, http.StatusBadRequest, "bad_input", i18n.Text(ctx, "Không đọc được multipart payload"), nil)
				return
			}
			file, header, ferr := r.FormFile("file")
			if ferr != nil {
				httpx.WriteErrorC(w, ctx, http.StatusBadRequest, "bad_input", i18n.Text(ctx, "Thiếu file"), nil)
				return
			}
			defer func() { _ = file.Close() }()

			body, rerr := io.ReadAll(io.LimitReader(file, services.MaxAttachmentBytes+1))
			if rerr != nil {
				httpx.WriteErrorC(w, ctx, http.StatusBadRequest, "bad_input", i18n.Text(ctx, "Không đọc được nội dung file"), nil)
				return
			}
			if len(body) > services.MaxAttachmentBytes {
				httpx.WriteErrorC(w, ctx, http.StatusRequestEntityTooLarge, "bad_input", i18n.Text(ctx, "File vượt quá 5MB"), nil)
				return
			}
			// The message comes from internal/files, which has no request context.
			// Its Vietnamese text is the catalog key (the wave-3 arrangement), so
			// rendering it here is the whole conversion for this branch —
			// files.DetectAndValidate itself is not touched.
			mime, verr := files.DetectAndValidate(body, header.Header.Get("Content-Type"))
			if verr != nil {
				httpx.WriteErrorC(w, ctx, http.StatusBadRequest, "bad_input", i18n.Text(ctx, verr.Error()), nil)
				return
			}
			// PDF is accepted here as of roadmap #15 (the AI client sends it as a
			// `document` block); GIF/HEIC are stored fine but cannot be OCR'd.
			if !ai.IsSupportedReceiptType(mime) {
				httpx.WriteErrorC(w, ctx, http.StatusBadRequest, "bad_input",
					i18n.Text(ctx, "Chỉ hỗ trợ ảnh JPEG, PNG, WEBP hoặc PDF"), nil)
				return
			}
			in.Body = body
			in.MediaType = mime

		default:
			httpx.WriteErrorC(w, ctx, http.StatusBadRequest, "bad_input",
				i18n.Text(ctx, "Content-Type phải là application/json hoặc multipart/form-data"), nil)
			return
		}

		draft, sErr := services.ExtractReceipt(ctx, d.DB, d.AI, us.UserID, in)
		if sErr != nil {
			writeAIError(w, ctx, sErr)
			return
		}
		httpx.WriteJSONC(w, ctx, http.StatusOK, map[string]any{"draft": draft})
	}
}

// writeAIError maps a services.AttachmentError onto the wire. The code (and
// therefore the status) is contract and does not move with the language;
// `ae.Message` is already the finished sentence in the request's language,
// because every producer of one had the context in scope — services/ai_extract.go
// renders its own copy, wave 3 converted the attachment half this path reuses,
// and files/ai messages are keyed on their own Vietnamese source text.
//
// The 500 fallback is `Lỗi hệ thống` from the shared catalog entry, like every
// other per-domain 500 branch. So is the rate-limit branch, which goes through
// the shared `rateLimited` helper — the two sentences a caller can hit on a path
// that is otherwise fully translated.
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
	httpx.WriteErrorC(w, ctx, http.StatusInternalServerError, "internal_error", i18n.Text(ctx, "Lỗi hệ thống"), nil)
}
