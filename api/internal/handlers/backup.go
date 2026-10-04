package handlers

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/thanhtrung9368/warranty-vault/api/internal/auth"
	"github.com/thanhtrung9368/warranty-vault/api/internal/httpx"
	"github.com/thanhtrung9368/warranty-vault/api/internal/i18n"
	"github.com/thanhtrung9368/warranty-vault/api/internal/services"
)

// 50 MB cap on a metadata-only JSON import body — matches the legacy TS comment
// + is plenty for the realistic per-user data graph.
const maxImportBodyBytes = 50 * 1024 * 1024

// Cap for the blob-carrying .zip import (includeBlobs=true export). The blobs are
// AES-256-GCM ciphertext (plaintext + 16-byte tag) of at most
// MAX_UPLOAD_BYTES_PER_USER (100 MB) per user, plus the manifest, so 110 MB lets a
// full backup through while staying bounded. Enforced per user by
// services/attachments.go, and re-checked by services.ImportBackupZip.
const maxImportZipBytes = 110 * 1024 * 1024

// RegisterBackup wires GET /api/v1/backup/export + POST /api/v1/backup/import
// behind RequireUser.
func RegisterBackup(mux *http.ServeMux, deps Deps) {
	requireUser := auth.RequireUser(deps.DB)

	mux.Handle("GET /api/v1/backup/export",
		requireUser(http.HandlerFunc(exportBackupHandler(deps))))
	mux.Handle("POST /api/v1/backup/import",
		requireUser(http.HandlerFunc(importBackupHandler(deps))))
}

func exportBackupHandler(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Attach resolves `?lang=` / Accept-Language for THIS request, so the
		// export's own copy — the two honesty notes in the envelope — and every
		// refusal follow the same language (docs/I18N_PLAN.md §2.2).
		ctx := i18n.Attach(r)
		us, _ := auth.UserFromContext(ctx)

		// Opt-in switch between the two formats (roadmap #2):
		//   absent/false → the JSON export, byte-identical to before (v5, metadata
		//                  only, includesAttachmentBytes=false)
		//   true         → a .zip archive whose entries are the encrypted blobs plus
		//                  a v6 data.json with includesAttachmentBytes=true
		includeBlobs, ok := parseBoolQuery(r.URL.Query().Get("includeBlobs"))
		if !ok {
			httpx.WriteErrorC(w, ctx, http.StatusBadRequest, "bad_input",
				i18n.Text(ctx, "Tham số includeBlobs không hợp lệ"),
				map[string][]string{
					"includeBlobs": {i18n.Text(ctx, "Phải là true hoặc false")},
				})
			return
		}

		base := fmt.Sprintf("warranty-vault-%s-%s",
			safeFilenameSegment(us.UserID), time.Now().UTC().Format("2006-01-02"))
		w.Header().Set("Cache-Control", "private, no-store")

		if includeBlobs {
			w.Header().Set("Content-Type", "application/zip")
			w.Header().Set("Content-Disposition",
				fmt.Sprintf("attachment; filename=%q", base+".zip"))
			// WriteBackupZip streams straight to the response: the archive can be
			// ~100 MB, so it is never buffered. Once the first byte is out the status
			// is fixed — a failure here can only be logged.
			payload, err := services.WriteBackupZip(ctx, deps.DB, us.UserID, w)
			if err != nil {
				slog.Error("backup export with blobs failed", "err", err, "userId", us.UserID)
				return
			}
			slog.Info("backup export with blobs",
				"userId", us.UserID,
				"devices", len(payload.Devices),
				"missingAttachmentIds", len(payload.MissingAttachmentIds))
			return
		}

		out, err := services.ExportBackup(ctx, deps.DB, us.UserID)
		if err != nil {
			slog.Error("backup export failed", "err", err, "userId", us.UserID)
			httpx.WriteErrorC(w, ctx, http.StatusInternalServerError, "internal_error", "Lỗi hệ thống", nil)
			return
		}

		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", base+".json"))
		w.WriteHeader(http.StatusOK)
		if err := json.NewEncoder(w).Encode(out); err != nil {
			slog.Error("backup export write failed", "err", err)
		}
	}
}

func importBackupHandler(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := i18n.Attach(r)
		us, _ := auth.UserFromContext(ctx)
		if !ensureUserWriteRate(w, r, deps, us.UserID) {
			return
		}

		mode := services.ImportMode(strings.TrimSpace(r.URL.Query().Get("mode")))
		if mode == "" {
			mode = services.ImportMerge
		}
		if mode != services.ImportMerge && mode != services.ImportReplace {
			// The same words as the service's own refusal, deliberately: one
			// catalog entry, and the CODE differs by layer (this one is
			// `bad_input`, the service's is `validation`) exactly as before.
			badInput(w, ctx, nil, i18n.Text(ctx, "Mode không hợp lệ"))
			return
		}

		// Body cap depends on the format the caller is sending. A blob-carrying
		// archive can legitimately reach ~100 MB (the per-user upload cap) plus the
		// manifest; a metadata-only JSON payload stays at 50 MB. Anything that is not
		// declared JSON gets the larger cap, because the format is sniffed below.
		contentType := strings.ToLower(r.Header.Get("Content-Type"))
		limit := int64(maxImportZipBytes)
		limitLabel := "110MB"
		if strings.HasPrefix(contentType, "application/json") {
			limit = maxImportBodyBytes
			limitLabel = "50MB"
		}
		r.Body = http.MaxBytesReader(w, r.Body, limit)
		raw, err := io.ReadAll(r.Body)
		if err != nil {
			// MaxBytesReader sets a typed error; surface it as a friendly message.
			var mberr *http.MaxBytesError
			if errors.As(err, &mberr) {
				httpx.WriteErrorC(w, ctx, http.StatusRequestEntityTooLarge, "bad_input",
					i18n.T(ctx, "File backup quá lớn (giới hạn %s)", limitLabel), nil)
				return
			}
			badInput(w, ctx, nil, i18n.Text(ctx, "Không đọc được nội dung file"))
			return
		}

		// Two accepted formats on the same endpoint:
		//   - a v5/v6 JSON document (unchanged), and
		//   - a .zip produced by GET /api/v1/backup/export?includeBlobs=true, which
		//     carries the encrypted attachment bytes (roadmap #2).
		// The format is decided by the ZIP magic ("PK\x03\x04") rather than by
		// Content-Type, because clients (and curl) send application/octet-stream for
		// binary uploads.
		var result *services.ImportResult
		var ierr error
		if isZipArchive(raw) {
			result, ierr = services.ImportBackupZip(ctx, deps.DB, us.UserID, raw, mode)
		} else {
			var payload services.BackupExport
			dec := json.NewDecoder(bytes.NewReader(raw))
			// Allow unknown fields — older / future versions might carry extras.
			if derr := dec.Decode(&payload); derr != nil {
				badInput(w, ctx, nil, i18n.Text(ctx, "File JSON không hợp lệ"))
				return
			}
			result, ierr = services.ImportBackup(ctx, deps.DB, us.UserID, &payload, mode)
		}

		if ierr != nil {
			var svc *services.Error
			if errors.As(ierr, &svc) {
				// domainErrorMessage, not svc.Message: a keyed error (the device
				// ceilings come from ErrLimit) renders the headline in the request's
				// language, while an unkeyed one is written out verbatim — which is
				// byte-for-byte what this handler did before it knew about languages.
				httpx.WriteErrorC(w, ctx, svc.HTTPStatus(), strings.ToLower(svc.Code),
					domainErrorMessage(ctx, svc), svc.FieldErrors)
				return
			}
			slog.Error("backup import failed", "err", ierr, "userId", us.UserID)
			httpx.WriteErrorC(w, ctx, http.StatusInternalServerError, "internal_error", "Lỗi hệ thống", nil)
			return
		}

		httpx.WriteJSON(w, http.StatusOK, map[string]any{
			"ok":     true,
			"result": result,
		})
	}
}

// isZipArchive reports whether raw starts with a ZIP local file header
// ("PK\x03\x04"). An empty body is not an archive (the JSON path then produces the
// usual "File JSON không hợp lệ").
func isZipArchive(raw []byte) bool {
	return len(raw) >= 4 && raw[0] == 'P' && raw[1] == 'K' && raw[2] == 0x03 && raw[3] == 0x04
}

// safeFilenameSegment strips anything outside [A-Za-z0-9_-] from s so it's
// safe to drop straight into a Content-Disposition filename without quoting
// games. Keeps the user id readable for ops debugging.
func safeFilenameSegment(s string) string {
	var b strings.Builder
	for _, r := range s {
		switch {
		case r >= 'a' && r <= 'z',
			r >= 'A' && r <= 'Z',
			r >= '0' && r <= '9',
			r == '-' || r == '_':
			b.WriteRune(r)
		}
	}
	if b.Len() == 0 {
		return "user"
	}
	return b.String()
}
