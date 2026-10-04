package handlers

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/thanhtrung9368/warranty-vault/api/internal/auth"
	"github.com/thanhtrung9368/warranty-vault/api/internal/httpx"
	"github.com/thanhtrung9368/warranty-vault/api/internal/i18n"
	"github.com/thanhtrung9368/warranty-vault/api/internal/ratelimit"
	"github.com/thanhtrung9368/warranty-vault/api/internal/services"
	store "github.com/thanhtrung9368/warranty-vault/api/internal/store/gen"
)

// 50 MB safety cap for the whole multipart envelope. Per-file cap is 5 MB
// inside the service, so this only protects against egregious abuse.
const maxMultipartBytes = 50 * 1024 * 1024

// attachmentDTO matches the shape the TS REST surface returns
// (`fileSize` = plaintext bytes; encryption-internal fields are not exposed).
type attachmentDTO struct {
	ID          string  `json:"id"`
	FileName    string  `json:"fileName"`
	FileType    string  `json:"fileType"`
	FileSize    int32   `json:"fileSize"`
	Description *string `json:"description"`
	UploadedAt  string  `json:"uploadedAt"`
}

func toAttachmentDTO(a store.Attachment) attachmentDTO {
	uploaded := ""
	if a.UploadedAt.Valid {
		uploaded = a.UploadedAt.Time.UTC().Format(time.RFC3339Nano)
	}
	return attachmentDTO{
		ID:          a.ID,
		FileName:    a.FileName,
		FileType:    a.FileType,
		FileSize:    a.FileSize,
		Description: a.Description,
		UploadedAt:  uploaded,
	}
}

// RegisterAttachments wires the attachment endpoints onto mux. Kept
// out of cmd/server/main.go per Phase C contract: the mux owner only calls
// RegisterAttachments(mux, deps).
//
// i18n: the four JSON handlers below call i18n.Attach(r) themselves, so `?lang=`
// works even in tests that build a mux without i18n.Middleware. The service
// errors they pass on are already finished strings in the request's language
// (services/attachments.go) and the code → status mapping is unchanged.
// downloadFileHandler is deliberately NOT converted: it answers 404 with an
// empty body on every failure, so it has no copy to translate.
func RegisterAttachments(mux *http.ServeMux, deps Deps) {
	mux.HandleFunc("POST /api/v1/devices/{id}/attachments", uploadAttachmentHandler(deps))
	mux.HandleFunc("GET /api/v1/devices/{id}/attachments", listAttachmentsHandler(deps))
	mux.HandleFunc("PATCH /api/v1/attachments/{id}", updateAttachmentHandler(deps))
	mux.HandleFunc("DELETE /api/v1/attachments/{id}", deleteAttachmentHandler(deps))
	mux.HandleFunc("GET /api/files/{id}", downloadFileHandler(deps))
}

// ---- handlers --------------------------------------------------------------

func listAttachmentsHandler(d Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := i18n.Attach(r)
		us, err := auth.VerifyBearer(ctx, d.DB, r.Header.Get("Authorization"))
		if err != nil {
			unauthorized(w, ctx)
			return
		}
		deviceID := r.PathValue("id")
		rows, sErr := services.ListAttachmentsByDevice(ctx, d.DB, us.UserID, deviceID)
		if sErr != nil {
			writeAttachmentError(w, ctx, sErr)
			return
		}
		out := make([]attachmentDTO, 0, len(rows))
		for _, r := range rows {
			out = append(out, toAttachmentDTO(r))
		}
		httpx.WriteJSON(w, http.StatusOK, map[string]any{"attachments": out})
	}
}

func uploadAttachmentHandler(d Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := i18n.Attach(r)
		us, err := auth.VerifyBearer(ctx, d.DB, r.Header.Get("Authorization"))
		if err != nil {
			unauthorized(w, ctx)
			return
		}
		// Per-user write rate-limit. Mirrors rateLimitUserWrite() in TS.
		rl, _ := ratelimit.CheckUserWrite(ctx, d.Limiter, us.UserID)
		if !rl.Ok {
			rateLimited(w, ctx, rl.RetryAfterSec)
			return
		}

		deviceID := r.PathValue("id")
		ct := r.Header.Get("Content-Type")
		if !strings.HasPrefix(strings.ToLower(ct), "multipart/form-data") {
			httpx.WriteErrorC(w, ctx, http.StatusBadRequest, "bad_input",
				i18n.Text(ctx, "Content-Type phải là multipart/form-data"), nil)
			return
		}

		// Cap the request body before ParseMultipartForm allocates buffers.
		r.Body = http.MaxBytesReader(w, r.Body, maxMultipartBytes)
		if err := r.ParseMultipartForm(10 << 20); err != nil {
			// MaxBytesReader returns an error stating size — translate to 413.
			if strings.Contains(err.Error(), "request body too large") {
				httpx.WriteErrorC(w, ctx, http.StatusRequestEntityTooLarge, "bad_input",
					i18n.Text(ctx, "File quá lớn"), nil)
				return
			}
			httpx.WriteErrorC(w, ctx, http.StatusBadRequest, "bad_input",
				i18n.Text(ctx, "Không đọc được multipart payload"), nil)
			return
		}

		file, header, ferr := r.FormFile("file")
		if ferr != nil {
			httpx.WriteErrorC(w, ctx, http.StatusBadRequest, "bad_input", i18n.Text(ctx, "Thiếu file"), nil)
			return
		}
		defer func() { _ = file.Close() }()

		// Buffer the body — the service needs full bytes for magic-byte
		// detection + image resize.
		body, rerr := io.ReadAll(io.LimitReader(file, services.MaxAttachmentBytes+1))
		if rerr != nil {
			httpx.WriteErrorC(w, ctx, http.StatusBadRequest, "bad_input",
				i18n.Text(ctx, "Không đọc được nội dung file"), nil)
			return
		}
		if len(body) > services.MaxAttachmentBytes {
			httpx.WriteErrorC(w, ctx, http.StatusRequestEntityTooLarge, "bad_input",
				i18n.Text(ctx, "File vượt quá 5MB"), nil)
			return
		}

		var description *string
		if v := strings.TrimSpace(r.FormValue("description")); v != "" {
			description = &v
		}

		declaredCT := header.Header.Get("Content-Type")

		att, sErr := services.Upload(ctx, d.DB, us.UserID, services.UploadAttachmentInput{
			DeviceID:    deviceID,
			FileName:    header.Filename,
			DeclaredCT:  declaredCT,
			Body:        body,
			Description: description,
		})
		if sErr != nil {
			writeAttachmentError(w, ctx, sErr)
			return
		}
		httpx.WriteJSON(w, http.StatusCreated, map[string]any{
			"attachment": toAttachmentDTO(att),
		})
	}
}

// updateAttachmentHandler edits an attachment's description. `description` is
// the ONLY accepted field — file bytes are immutable once uploaded (replace by
// delete + re-upload instead). Body:
//
//	{ "description": "Hoá đơn FPT Shop" }   → set (trimmed)
//	{ "description": "" } / { "description": null }  → clear
//
// Ownership is resolved through the owning device inside the service query; a
// row that belongs to someone else is a 404, exactly like GET /api/files/{id}.
func updateAttachmentHandler(d Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := i18n.Attach(r)
		us, err := auth.VerifyBearer(ctx, d.DB, r.Header.Get("Authorization"))
		if err != nil {
			unauthorized(w, ctx)
			return
		}
		rl, _ := ratelimit.CheckUserWrite(ctx, d.Limiter, us.UserID)
		if !rl.Ok {
			rateLimited(w, ctx, rl.RetryAfterSec)
			return
		}
		id := r.PathValue("id")
		if id == "" {
			httpx.WriteErrorC(w, ctx, http.StatusBadRequest, "bad_input", i18n.Text(ctx, "Thiếu id file"), nil)
			return
		}

		// Raw-map decode so "key absent" is distinguishable from "explicit null /
		// empty" and so unknown fields get a field-level message. Both the headline
		// and the per-field entry are rendered HERE, because the map holds finished
		// strings by the time the writer sees it.
		var raw map[string]json.RawMessage
		if err := decodeJSON(r, &raw); err != nil {
			badJSONBody(w, ctx)
			return
		}
		unknown := map[string][]string{}
		for k := range raw {
			if k != "description" {
				unknown[k] = []string{i18n.Text(ctx, "Chỉ hỗ trợ sửa mô tả")}
			}
		}
		if len(unknown) > 0 {
			badInput(w, ctx, unknown, i18n.Text(ctx, "Chỉ hỗ trợ sửa mô tả"))
			return
		}
		rawDesc, present := raw["description"]
		if !present {
			badInput(w, ctx, map[string][]string{"description": {i18n.Text(ctx, "Thiếu description")}})
			return
		}
		var descIn *string
		if err := json.Unmarshal(rawDesc, &descIn); err != nil {
			badInput(w, ctx, map[string][]string{"description": {i18n.Text(ctx, "Mô tả không hợp lệ")}})
			return
		}

		att, sErr := services.UpdateDescription(ctx, d.DB, us.UserID, id,
			services.NormalizeDescription(descIn))
		if sErr != nil {
			writeAttachmentError(w, ctx, sErr)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, map[string]any{
			"attachment": toAttachmentDTO(att),
		})
	}
}

func deleteAttachmentHandler(d Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := i18n.Attach(r)
		us, err := auth.VerifyBearer(ctx, d.DB, r.Header.Get("Authorization"))
		if err != nil {
			unauthorized(w, ctx)
			return
		}
		rl, _ := ratelimit.CheckUserWrite(ctx, d.Limiter, us.UserID)
		if !rl.Ok {
			rateLimited(w, ctx, rl.RetryAfterSec)
			return
		}
		id := r.PathValue("id")
		if sErr := services.Delete(ctx, d.DB, us.UserID, id); sErr != nil {
			writeAttachmentError(w, ctx, sErr)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, map[string]bool{"ok": true})
	}
}

// downloadFileHandler streams the decrypted blob. We always 404 on auth /
// ownership / disk miss to avoid leaking which IDs exist.
func downloadFileHandler(d Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		us, err := auth.VerifyBearer(r.Context(), d.DB, r.Header.Get("Authorization"))
		if err != nil {
			http.NotFound(w, r)
			return
		}
		id := r.PathValue("id")
		mime, name, body, size, sErr := services.OpenStream(r.Context(), d.DB, us.UserID, id)
		if sErr != nil {
			// All service errors map to 404 here per the TS route.
			http.NotFound(w, r)
			return
		}
		defer func() { _ = body.Close() }()

		download := r.URL.Query().Get("download") == "1"
		w.Header().Set("Content-Type", mime)
		w.Header().Set("Cache-Control", "private, no-store, max-age=0")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Content-Security-Policy", "default-src 'none'; sandbox; img-src 'self' data:")
		if size > 0 {
			w.Header().Set("Content-Length", strconvItoa64(size))
		}
		if download {
			safe := sanitizeFilename(name)
			w.Header().Set("Content-Disposition", `attachment; filename="`+safe+`"`)
		} else {
			w.Header().Set("Content-Disposition", "inline")
		}
		w.WriteHeader(http.StatusOK)
		if _, copyErr := io.Copy(w, body); copyErr != nil {
			slog.Warn("file stream copy failed", "err", copyErr, "attachmentId", id)
		}
	}
}

// ---- helpers ---------------------------------------------------------------

// writeAttachmentError maps a services.AttachmentError onto the wire. The code
// (and therefore the status) is contract and does not move with the language;
// `ae.Message` is already the finished sentence in the request's language,
// because the service that built the error had the context in scope
// (services/attachments.go — see the note on AttachmentError there).
//
// `limit_reached` stays a 400 here. services.Error's LIMIT_REACHED is a 409, but
// this is a different type on a different code path, and the attachment upload
// has answered 400 since before i18n existed. openapi.yaml documents 409 for that
// endpoint — a pre-existing disagreement this wave did not touch (reported, not
// silently "fixed": changing it would move a status real clients key off).
func writeAttachmentError(w http.ResponseWriter, ctx context.Context, err error) {
	if ae, ok := services.AsAttachmentError(err); ok {
		switch ae.Code {
		case "bad_input":
			httpx.WriteErrorC(w, ctx, http.StatusBadRequest, "bad_input", ae.Message, nil)
		case "not_found":
			httpx.WriteErrorC(w, ctx, http.StatusNotFound, "not_found", ae.Message, nil)
		case "limit_reached":
			httpx.WriteErrorC(w, ctx, http.StatusBadRequest, "limit_reached", ae.Message, nil)
		case "internal_error":
			httpx.WriteErrorC(w, ctx, http.StatusInternalServerError, "internal_error", ae.Message, nil)
		default:
			httpx.WriteErrorC(w, ctx, http.StatusBadRequest, ae.Code, ae.Message, nil)
		}
		return
	}
	slog.Error("attachment handler error", "err", err)
	httpx.WriteErrorC(w, ctx, http.StatusInternalServerError, "internal_error", i18n.Text(ctx, "Lỗi hệ thống"), nil)
}

func sanitizeFilename(s string) string {
	if s == "" {
		return "download"
	}
	out := make([]rune, 0, len(s))
	for _, r := range s {
		switch {
		case r >= '0' && r <= '9':
			out = append(out, r)
		case r >= 'a' && r <= 'z':
			out = append(out, r)
		case r >= 'A' && r <= 'Z':
			out = append(out, r)
		case r == '.' || r == '-' || r == '_' || r == ' ':
			out = append(out, r)
		default:
			out = append(out, '_')
		}
	}
	return string(out)
}

func strconvItoa64(n int64) string {
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
