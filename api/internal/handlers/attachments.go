package handlers

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/thanhtrung9368/warranty-vault/api/internal/auth"
	"github.com/thanhtrung9368/warranty-vault/api/internal/httpx"
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

// RegisterAttachments wires the three attachment endpoints onto mux. Kept
// out of cmd/server/main.go per Phase C contract: the mux owner only calls
// RegisterAttachments(mux, deps).
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
		us, err := auth.VerifyBearer(r.Context(), d.DB, r.Header.Get("Authorization"))
		if err != nil {
			unauthorized(w)
			return
		}
		deviceID := r.PathValue("id")
		rows, sErr := services.ListAttachmentsByDevice(r.Context(), d.DB, us.UserID, deviceID)
		if sErr != nil {
			writeAttachmentError(w, sErr)
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
		us, err := auth.VerifyBearer(r.Context(), d.DB, r.Header.Get("Authorization"))
		if err != nil {
			unauthorized(w)
			return
		}
		// Per-user write rate-limit. Mirrors rateLimitUserWrite() in TS.
		rl, _ := ratelimit.CheckUserWrite(r.Context(), d.Limiter, us.UserID)
		if !rl.Ok {
			rateLimited(w, rl.RetryAfterSec)
			return
		}

		deviceID := r.PathValue("id")
		ct := r.Header.Get("Content-Type")
		if !strings.HasPrefix(strings.ToLower(ct), "multipart/form-data") {
			httpx.WriteError(w, http.StatusBadRequest, "bad_input",
				"Content-Type phải là multipart/form-data", nil)
			return
		}

		// Cap the request body before ParseMultipartForm allocates buffers.
		r.Body = http.MaxBytesReader(w, r.Body, maxMultipartBytes)
		if err := r.ParseMultipartForm(10 << 20); err != nil {
			// MaxBytesReader returns an error stating size — translate to 413.
			if strings.Contains(err.Error(), "request body too large") {
				httpx.WriteError(w, http.StatusRequestEntityTooLarge, "bad_input",
					"File quá lớn", nil)
				return
			}
			httpx.WriteError(w, http.StatusBadRequest, "bad_input",
				"Không đọc được multipart payload", nil)
			return
		}

		file, header, ferr := r.FormFile("file")
		if ferr != nil {
			httpx.WriteError(w, http.StatusBadRequest, "bad_input", "Thiếu file", nil)
			return
		}
		defer func() { _ = file.Close() }()

		// Buffer the body — the service needs full bytes for magic-byte
		// detection + image resize.
		body, rerr := io.ReadAll(io.LimitReader(file, services.MaxAttachmentBytes+1))
		if rerr != nil {
			httpx.WriteError(w, http.StatusBadRequest, "bad_input",
				"Không đọc được nội dung file", nil)
			return
		}
		if len(body) > services.MaxAttachmentBytes {
			httpx.WriteError(w, http.StatusRequestEntityTooLarge, "bad_input",
				"File vượt quá 5MB", nil)
			return
		}

		var description *string
		if v := strings.TrimSpace(r.FormValue("description")); v != "" {
			description = &v
		}

		declaredCT := header.Header.Get("Content-Type")

		att, sErr := services.Upload(r.Context(), d.DB, us.UserID, services.UploadAttachmentInput{
			DeviceID:    deviceID,
			FileName:    header.Filename,
			DeclaredCT:  declaredCT,
			Body:        body,
			Description: description,
		})
		if sErr != nil {
			writeAttachmentError(w, sErr)
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
		us, err := auth.VerifyBearer(r.Context(), d.DB, r.Header.Get("Authorization"))
		if err != nil {
			unauthorized(w)
			return
		}
		rl, _ := ratelimit.CheckUserWrite(r.Context(), d.Limiter, us.UserID)
		if !rl.Ok {
			rateLimited(w, rl.RetryAfterSec)
			return
		}
		id := r.PathValue("id")
		if id == "" {
			httpx.WriteError(w, http.StatusBadRequest, "bad_input", "Thiếu id file", nil)
			return
		}

		// Raw-map decode so "key absent" is distinguishable from "explicit null /
		// empty" and so unknown fields get a field-level Vietnamese message.
		var raw map[string]json.RawMessage
		if err := decodeJSON(r, &raw); err != nil {
			badJSONBody(w)
			return
		}
		unknown := map[string][]string{}
		for k := range raw {
			if k != "description" {
				unknown[k] = []string{"Chỉ hỗ trợ sửa mô tả"}
			}
		}
		if len(unknown) > 0 {
			badInput(w, unknown, "Chỉ hỗ trợ sửa mô tả")
			return
		}
		rawDesc, present := raw["description"]
		if !present {
			badInput(w, map[string][]string{"description": {"Thiếu description"}})
			return
		}
		var descIn *string
		if err := json.Unmarshal(rawDesc, &descIn); err != nil {
			badInput(w, map[string][]string{"description": {"Mô tả không hợp lệ"}})
			return
		}

		att, sErr := services.UpdateDescription(r.Context(), d.DB, us.UserID, id,
			services.NormalizeDescription(descIn))
		if sErr != nil {
			writeAttachmentError(w, sErr)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, map[string]any{
			"attachment": toAttachmentDTO(att),
		})
	}
}

func deleteAttachmentHandler(d Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		us, err := auth.VerifyBearer(r.Context(), d.DB, r.Header.Get("Authorization"))
		if err != nil {
			unauthorized(w)
			return
		}
		rl, _ := ratelimit.CheckUserWrite(r.Context(), d.Limiter, us.UserID)
		if !rl.Ok {
			rateLimited(w, rl.RetryAfterSec)
			return
		}
		id := r.PathValue("id")
		if sErr := services.Delete(r.Context(), d.DB, us.UserID, id); sErr != nil {
			writeAttachmentError(w, sErr)
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

func writeAttachmentError(w http.ResponseWriter, err error) {
	if ae, ok := services.AsAttachmentError(err); ok {
		switch ae.Code {
		case "bad_input":
			httpx.WriteError(w, http.StatusBadRequest, "bad_input", ae.Message, nil)
		case "not_found":
			httpx.WriteError(w, http.StatusNotFound, "not_found", ae.Message, nil)
		case "limit_reached":
			httpx.WriteError(w, http.StatusBadRequest, "limit_reached", ae.Message, nil)
		case "internal_error":
			httpx.WriteError(w, http.StatusInternalServerError, "internal_error", ae.Message, nil)
		default:
			httpx.WriteError(w, http.StatusBadRequest, ae.Code, ae.Message, nil)
		}
		return
	}
	slog.Error("attachment handler error", "err", err)
	httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "Lỗi hệ thống", nil)
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
